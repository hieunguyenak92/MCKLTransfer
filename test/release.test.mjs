import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { collectSourceFiles } from '../scripts/check-source.mjs';
import { makeArchive, inspectArchive, createSourceRelease } from '../scripts/release.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mckl-source-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = {
    LICENSE: await fs.readFile(path.join(projectRoot, 'LICENSE')),
    NOTICE: 'MCKL Transfer\nCopyright 2026 hieunguyenak92\n',
    'package.json': JSON.stringify({ name: 'mckl-transfer', version: '0.2.0-alpha.1', license: 'Apache-2.0', private: true }),
    'server.mjs': 'export const fixture = true;\n',
    'README.md': '# Fixture\n',
    'SECURITY.md': '# Fixture security policy\n',
    'CONTRIBUTING.md': '# Fixture contribution guide\n',
    'public/index.html': '<!doctype html><title>Fixture</title>\n',
  };
  for (const [name, data] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), data);
  }
  return root;
}

test('source export excludes local transfers, environment, Finder metadata and release output', async t => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'shared'));
  await fs.writeFile(path.join(root, 'shared', 'private.txt'), 'local synthetic payload');
  await fs.writeFile(path.join(root, '.env'), 'SYNTHETIC_ONLY=true');
  await fs.writeFile(path.join(root, '.DS_Store'), Buffer.from([0, 1, 2]));
  await fs.mkdir(path.join(root, 'release'));
  await fs.writeFile(path.join(root, 'release', 'old.tar.gz'), 'old synthetic artifact');
  const review = await collectSourceFiles({ root });
  assert.equal(review.files.length, 8);
  const paths = inspectArchive(makeArchive(review.files, 'fixture'), review.files, 'fixture');
  assert.equal(paths.length, 8);
  assert.ok(paths.every(name => !/shared|\.env|DS_Store|old\.tar/.test(name)));
});

test('source export refuses new top-level files that were not approved', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'personal.txt'), 'synthetic data');
  await assert.rejects(collectSourceFiles({ root }), /outside source allowlist/);
});

test('source export rejects credentials without printing their value', async t => {
  const root = await fixture(t);
  const token = 'gh' + 'p_' + 'A'.repeat(36);
  await fs.writeFile(path.join(root, 'public', 'fixture.js'), `const value = '${token}';`);
  await assert.rejects(collectSourceFiles({ root }), error => {
    assert.match(error.message, /GITHUB_TOKEN/);
    assert.ok(!error.message.includes(token));
    return true;
  });
});

test('source export rejects hidden config and binary content inside an allowed directory', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'public', '.env'), 'SYNTHETIC_ONLY=true');
  await assert.rejects(collectSourceFiles({ root }), /Unexpected hidden/);
  await fs.rm(path.join(root, 'public', '.env'));
  await fs.writeFile(path.join(root, 'public', 'fixture.js'), Buffer.from([0xff, 0xfe, 0x00]));
  await assert.rejects(collectSourceFiles({ root }), /valid UTF-8/);
});

test('source export rejects symlinks even to another approved source file', async t => {
  const root = await fixture(t);
  try { await fs.symlink(path.join(root, 'LICENSE'), path.join(root, 'public', 'linked.txt')); }
  catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) return t.skip('Windows runner does not permit creating symbolic links');
    throw error;
  }
  await assert.rejects(collectSourceFiles({ root }), /Symlink/);
});

test('source export refuses missing or modified license text', async t => {
  const root = await fixture(t);
  await fs.rm(path.join(root, 'LICENSE'));
  await assert.rejects(collectSourceFiles({ root }), /Required source file missing/);
  await fs.writeFile(path.join(root, 'LICENSE'), 'not the standard license');
  await assert.rejects(collectSourceFiles({ root }), /canonical Apache-2.0/);
});

test('archive reader rejects altered member names and payload', async t => {
  const root = await fixture(t);
  const review = await collectSourceFiles({ root });
  const archive = makeArchive(review.files, 'fixture');
  const payload = gunzipSync(archive);
  payload[512] ^= 1;
  assert.throws(() => inspectArchive(gzipSync(payload), review.files, 'fixture'), /integrity mismatch/);
  const header = gunzipSync(archive);
  header[0] ^= 1;
  assert.throws(() => inspectArchive(gzipSync(header), review.files, 'fixture'), /header checksum mismatch/);
});

test('saved source release is read back and reproducible for the same source bytes', async t => {
  const root = await fixture(t);
  const first = await createSourceRelease({ root });
  const second = await createSourceRelease({ root });
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.published, false);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'release', first.manifest), 'utf8'));
  assert.equal(manifest.sha256, first.sha256);
  assert.equal(manifest.files.length, 8);
  assert.ok(manifest.files.every(file => !path.isAbsolute(file.path)));
  assert.ok(!JSON.stringify(manifest).includes(root));
});
