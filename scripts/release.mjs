import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { collectSourceFiles, sourceRoot } from './check-source.mjs';

function writeOctal(header, offset, length, value) {
  const octal = value.toString(8);
  if (octal.length > length - 1) throw new Error('Archive field exceeds ustar capacity');
  header.write(octal.padStart(length - 1, '0') + '\0', offset, length, 'ascii');
}

function splitTarPath(name) {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: '' };
  for (let slash = name.lastIndexOf('/'); slash > 0; slash = name.lastIndexOf('/', slash - 1)) {
    const prefix = name.slice(0, slash);
    const basename = name.slice(slash + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(basename) <= 100) return { name: basename, prefix };
  }
  throw new Error('Source path cannot be represented safely in ustar');
}

export function makeArchive(files, prefix) {
  const parts = [];
  for (const file of files) {
    const archivePath = `${prefix}/${file.path}`;
    const fields = splitTarPath(archivePath);
    const header = Buffer.alloc(512);
    header.write(fields.name, 0, 100, 'utf8');
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, file.data.length);
    writeOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header[156] = 0x30;
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    header.write(fields.prefix, 345, 155, 'utf8');
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    parts.push(header, file.data, Buffer.alloc((512 - file.data.length % 512) % 512));
  }
  parts.push(Buffer.alloc(1024));
  const compressed = gzipSync(Buffer.concat(parts), { level: 9 });
  compressed[9] = 255; // Normalize the gzip operating-system field.
  return compressed;
}

function tarString(buffer, offset, length) {
  return buffer.subarray(offset, offset + length).toString('utf8').replace(/\0.*$/s, '');
}

export function inspectArchive(archive, files, prefix) {
  const tar = gunzipSync(archive, { maxOutputLength: 24 * 1024 * 1024 });
  const expected = new Map(files.map(file => [`${prefix}/${file.path}`, file]));
  const seen = new Set();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (seen.size !== expected.size || !tar.subarray(offset).every(byte => byte === 0)) throw new Error('Archive terminator or file count mismatch');
      return [...seen];
    }
    const storedChecksum = Number.parseInt(tarString(header, 148, 8).trim(), 8);
    const calculatedChecksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 0x20 : byte), 0);
    if (storedChecksum !== calculatedChecksum) throw new Error('Archive header checksum mismatch');
    const name = tarString(header, 0, 100);
    const parent = tarString(header, 345, 155);
    const fullName = parent ? `${parent}/${name}` : name;
    const expectedFile = expected.get(fullName);
    const size = Number.parseInt(tarString(header, 124, 12), 8);
    if (header[156] !== 0x30 || !expectedFile || seen.has(fullName) || size !== expectedFile.size) throw new Error('Archive member does not match approved source manifest');
    const content = tar.subarray(offset + 512, offset + 512 + size);
    if (content.length !== size || crypto.createHash('sha256').update(content).digest('hex') !== expectedFile.sha256) throw new Error('Archive member integrity mismatch');
    seen.add(fullName);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('Archive is missing a valid terminator');
}

export async function createSourceRelease({ root = sourceRoot, outputDir = path.join(root, 'release') } = {}) {
  const review = await collectSourceFiles({ root });
  const name = `mckl-transfer-${review.package.version}`;
  const archiveName = `${name}-source.tar.gz`;
  const manifestName = `${name}-source.manifest.json`;
  const checksumName = `${name}-source.sha256`;
  const archive = makeArchive(review.files, name);
  const members = inspectArchive(archive, review.files, name);
  const digest = crypto.createHash('sha256').update(archive).digest('hex');
  const manifest = JSON.stringify({ name: review.package.name, version: review.package.version, license: review.package.license, artifact: archiveName, sha256: digest, files: review.files.map(({ path: filePath, size, sha256 }) => ({ path: filePath, size, sha256 })) }, null, 2) + '\n';
  // A release directory may not be a symlink to an unrelated/private location.
  const existing = await fs.lstat(outputDir).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('Release output must be a regular directory');
  await fs.mkdir(outputDir, { recursive: true });
  for (const [filename, data] of [[archiveName, archive], [manifestName, manifest], [checksumName, `${digest}  ${archiveName}\n`]]) {
    const destination = path.join(outputDir, filename);
    const entry = await fs.lstat(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (entry?.isSymbolicLink() || (entry && !entry.isFile())) throw new Error('Release destination must be a regular file');
    const temporary = `${destination}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, destination);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  // Read back the saved artifact, not only the in-memory candidate.
  const saved = await fs.readFile(path.join(outputDir, archiveName));
  if (crypto.createHash('sha256').update(saved).digest('hex') !== digest) throw new Error('Saved release checksum mismatch');
  inspectArchive(saved, review.files, name);
  return { status: 'pass', artifact: archiveName, manifest: manifestName, checksum: checksumName, sha256: digest, sourceFiles: members.length, archiveBytes: saved.length, deterministic: true, published: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await createSourceRelease(), null, 2)); }
  catch (error) { console.error(`Source release failed: ${error.message}`); process.exitCode = 1; }
}
