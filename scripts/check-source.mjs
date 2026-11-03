import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

export const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ROOT_FILES = new Set([
  '.gitattributes', '.gitignore', 'LICENSE', 'NOTICE', 'package.json',
  'server.mjs', 'README.md', 'SECURITY.md', 'CONTRIBUTING.md',
  'CHANGELOG.md', 'PLAN.md', 'RESEARCH.md',
]);
const ROOT_DIRECTORIES = new Set(['public', 'lib', 'test', 'scripts', 'docs', '.github']);
const REQUIRED_FILES = ['LICENSE', 'NOTICE', 'package.json', 'server.mjs', 'README.md', 'SECURITY.md', 'CONTRIBUTING.md'];
const TEXT_EXTENSIONS = new Set(['.md', '.mjs', '.js', '.css', '.html', '.json', '.yml', '.yaml', '.txt', '.svg']);
const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_FILES = 2000;
const APACHE_2_LICENSE_SHA256 = 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30';
const decoder = new TextDecoder('utf-8', { fatal: true });

// Only these known local/build entries may coexist with the release allowlist.
// Unknown top-level content fails review instead of silently entering an archive.
function isLocalOnly(name) {
  return ['.git', 'shared', 'release', 'node_modules', '.DS_Store', 'Thumbs.db', 'Desktop.ini', '.aws', '.ssh', '.codex', '.agents', '.npmrc'].includes(name)
    || /^\.env(?:\.|$)/i.test(name)
    || /\.(?:pem|key|p12|pfx|part|log|tgz|zip|tar|gz|bak)$/i.test(name)
    || name.startsWith('._');
}

function safeSourcePath(relative) {
  const parts = relative.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[\u0000-\u001f\u007f\\:]/u.test(part))) return false;
  return Buffer.byteLength(relative) <= 240;
}

export function scanText(text, relative) {
  const checks = [
    ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
    ['GITHUB_TOKEN', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/],
    ['AWS_ACCESS_KEY', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
    ['SLACK_TOKEN', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
    ['GOOGLE_API_KEY', /\bAIza[0-9A-Za-z_-]{30,}\b/],
    ['PERSONAL_HOME_PATH', /(?:\/Users|\/home)\/[A-Za-z0-9._-]+\//],
    ['PERSONAL_WINDOWS_HOME_PATH', /\b[A-Za-z]:\\Users\\[^\\\s"'<>]+\\/],
  ];
  for (const [rule, pattern] of checks) {
    if (pattern.test(text)) throw new Error(`${rule}: suspected private data in allowed source file ${relative}; value redacted`);
  }
}

export async function collectSourceFiles({ root = sourceRoot } = {}) {
  root = await fs.realpath(root);
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  let bytes = 0;
  let excludedLocalItems = 0;

  async function visit(relative) {
    if (!safeSourcePath(relative)) throw new Error('Unsafe source path; path redacted');
    const full = path.join(root, ...relative.split('/'));
    const before = await fs.lstat(full);
    if (before.isSymbolicLink()) throw new Error(`Symlink is forbidden in source export: ${relative}`);
    if (before.isDirectory()) {
      for (const entry of (await fs.readdir(full)).sort()) {
        if (entry === '.DS_Store' || entry.startsWith('._') || entry === 'Thumbs.db' || entry === 'Desktop.ini') {
          const stat = await fs.lstat(path.join(full, entry));
          if (stat.isSymbolicLink()) throw new Error('Symlink is forbidden even when its filename is excluded');
          excludedLocalItems++;
          continue;
        }
        if (entry.startsWith('.') && relative !== '.github') throw new Error(`Unexpected hidden source entry in ${relative}; filename redacted`);
        await visit(`${relative}/${entry}`);
      }
      return;
    }
    if (!before.isFile()) throw new Error(`Non-regular source entry is forbidden: ${relative}`);
    const name = path.posix.basename(relative);
    if (isLocalOnly(name) || (!ROOT_FILES.has(relative) && !TEXT_EXTENSIONS.has(path.posix.extname(name)))) {
      throw new Error(`Unapproved source file type or private filename: ${relative}`);
    }
    if (before.size > MAX_SOURCE_FILE_BYTES) throw new Error(`Source file exceeds export limit: ${relative}`);
    const handle = await fs.open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let data;
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('Source entry changed during review');
      data = await handle.readFile();
    } finally { await handle.close(); }
    if (data.length > MAX_SOURCE_FILE_BYTES) throw new Error(`Source file exceeds export limit: ${relative}`);
    let text;
    try { text = decoder.decode(data); }
    catch { throw new Error(`Source file is not valid UTF-8 text: ${relative}`); }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) throw new Error(`Binary control characters in source file: ${relative}`);
    scanText(text, relative);
    bytes += data.length;
    if (bytes > MAX_SOURCE_BYTES || files.length >= MAX_SOURCE_FILES) throw new Error('Source export exceeds bounded size/file count');
    files.push({ path: relative, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), data });
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ROOT_FILES.has(entry.name) || ROOT_DIRECTORIES.has(entry.name)) await visit(entry.name);
    else if (isLocalOnly(entry.name)) excludedLocalItems++;
    else throw new Error('Unexpected top-level entry outside source allowlist; inspect locally before exporting');
  }
  for (const required of REQUIRED_FILES) {
    if (!files.some(file => file.path === required)) throw new Error(`Required source file missing: ${required}`);
  }
  if (!files.some(file => file.path === 'public/index.html')) throw new Error('Required browser entry point missing');
  const license = files.find(file => file.path === 'LICENSE').data.toString('utf8').replace(/\r\n/g, '\n');
  if (crypto.createHash('sha256').update(license).digest('hex') !== APACHE_2_LICENSE_SHA256) throw new Error('LICENSE differs from the canonical Apache-2.0 text');
  const pkg = JSON.parse(files.find(file => file.path === 'package.json').data.toString('utf8'));
  if (pkg.license !== 'Apache-2.0' || pkg.private !== true) throw new Error('Package license/private release policy mismatch');
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) throw new Error('Unsafe package version');
  return { root, package: pkg, files: files.sort((a, b) => a.path.localeCompare(b.path)), bytes, excludedLocalItems };
}

export function verifySyntax(review) {
  let count = 0;
  for (const file of review.files.filter(file => /\.(?:mjs|js)$/.test(file.path))) {
    const result = spawnSync(process.execPath, ['--check', path.join(review.root, ...file.path.split('/'))], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`JavaScript syntax check failed: ${file.path}\n${result.stderr}`);
    count++;
  }
  return count;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const review = await collectSourceFiles();
    const syntaxFiles = process.argv.includes('--syntax') ? verifySyntax(review) : 0;
    console.log(JSON.stringify({ status: 'pass', sourceFiles: review.files.length, sourceBytes: review.bytes, excludedLocalItems: review.excludedLocalItems, syntaxFiles, scope: 'Explicit source snapshot allowlist and local pattern checks; not a full Git history or secret-scanner audit.' }, null, 2));
  } catch (error) {
    console.error(`Source review failed: ${error.message}`);
    process.exitCode = 1;
  }
}
