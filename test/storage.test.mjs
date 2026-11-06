import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { createFileStore } from '../lib/file-store.mjs';

const OWNER = 'synthetic-device-a';
const OTHER = 'synthetic-device-b';
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const body = value => Readable.from([Buffer.from(value)]);
const errorCode = (statusCode, code) => error => error.statusCode === statusCode && (!code || error.code === code);

async function fixture(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mckl-storage-'));
  const settings = { shareDir: dir, maxFileSize: 1024, maxTotalSize: 8192, chunkSize: 4, minFreeSpace: 0, ...options };
  let store = createFileStore(settings);
  await store.init();
  t.after(async () => { await store.stop(); await rm(dir, { recursive: true, force: true }); });
  return { dir, get store() { return store; }, async restart() { await store.stop(); store = createFileStore(settings); await store.init(); return store; } };
}

async function bytesOf(store, id) {
  const { handle } = await store.open(id);
  try { return await handle.readFile(); }
  finally { await handle.close(); }
}

async function put(store, name, value, extra = {}) {
  const data = Buffer.from(value);
  return store.upload(body(data), { name, ownerId: OWNER, mime: 'text/plain', expectedSize: data.length, expectedHash: hash(data), ...extra });
}

test('completed payloads use internal IDs and have durable whitelisted metadata', async t => {
  const { store, dir } = await fixture(t);
  const file = await put(store, 'document.txt', 'payload');
  assert.match(file.id, /^[a-f0-9]{24}$/);
  assert.equal(file.hash, hash('payload'));
  assert.equal(file.ownerId, OWNER);
  assert.equal(file.path, path.join(dir, '.mckl-objects', `${file.id}.bin`));
  assert.equal(await bytesOf(store, file.id).then(value => value.toString()), 'payload');
  assert.equal((await readdir(dir)).includes('document.txt'), false);
  const manifest = JSON.parse(await readFile(path.join(dir, '.mckl-manifest.json'), 'utf8'));
  assert.equal(manifest[0].storage, 'object');
  assert.equal(Object.hasOwn(manifest[0], 'path'), false);
  assert.equal(store.usage().usedBytes, 7);
  await store.remove(file.id);
  assert.equal(store.files.size, 0);
  assert.equal(store.usage().usedBytes, 0);
});

test('restart rejects indexed objects whose length differs from committed metadata', async t => {
  const state = await fixture(t);
  const truncated = await put(state.store, 'truncated.bin', 'original payload');
  const extended = await put(state.store, 'extended.bin', 'original payload');
  await state.store.stop();
  await writeFile(truncated.path, 'short');
  await appendFile(extended.path, 'extra');
  const store = await state.restart();
  assert.equal(store.files.size, 0);
  assert.equal(store.usage().usedBytes, 0);
  await assert.rejects(store.open(truncated.id), errorCode(404));
  await assert.rejects(store.open(extended.id), errorCode(404));
  assert.equal(await readFile(truncated.path, 'utf8'), 'short');
  assert.equal(await readFile(extended.path, 'utf8'), 'original payloadextra');
});

test('duplicate long ASCII and Unicode names preserve suffixes within the byte limit', async t => {
  const { store } = await fixture(t);
  for (const name of ['a'.repeat(180), `${'ế'.repeat(180)}.txt`]) {
    const first = await put(store, name, 'one');
    const second = await put(store, name, 'two');
    assert.notEqual(first.name.toLowerCase(), second.name.toLowerCase());
    assert.ok(Buffer.byteLength(first.name) <= 180);
    assert.ok(Buffer.byteLength(second.name) <= 180);
    assert.equal((await bytesOf(store, first.id)).toString(), 'one');
    assert.equal((await bytesOf(store, second.id)).toString(), 'two');
  }
});

test('reserved metadata names are rejected even within paths and in another case', async t => {
  const { store } = await fixture(t);
  for (const name of ['.mckl-manifest.json', '.MCKL-UPLOADS.JSON', 'folder/.mckl-manifest.json', 'folder\\.mckl-objects']) {
    await assert.rejects(async () => put(store, name, 'payload'), errorCode(400, 'INVALID_FILE_NAME'));
  }
  assert.equal(store.usage().reservedBytes, 0);
});

test('resumable uploads enforce ownership, offsets, chunk digests and final integrity', async t => {
  const { store } = await fixture(t);
  const data = Buffer.from('abcdefgh');
  const transfer = await store.begin({ name: 'resumable.txt', size: data.length, mime: 'text/plain', sha256: hash(data) }, OWNER);
  assert.equal(transfer.offset, 0);
  assert.equal(transfer.chunkSize, 4);
  await assert.rejects(store.head(transfer.id, OTHER), errorCode(404));
  await assert.rejects(store.append(transfer.id, OWNER, body('abcd'), { offset: 1, checksum: hash('abcd') }), errorCode(409));
  await assert.rejects(store.append(transfer.id, OTHER, body('abcd'), { offset: 0, checksum: hash('abcd') }), errorCode(404));
  await assert.rejects(store.append(transfer.id, OWNER, body('abcd'), { offset: 0 }), errorCode(400, 'CHECKSUM_REQUIRED'));
  await assert.rejects(store.append(transfer.id, OWNER, body('abcd'), { offset: 0, checksum: hash('wrong') }), errorCode(422));
  assert.equal((await store.head(transfer.id, OWNER)).offset, 0);
  assert.deepEqual(await store.append(transfer.id, OWNER, body('abcd'), { offset: 0, checksum: hash('abcd') }), { offset: 4 });
  await assert.rejects(store.complete(transfer.id, OWNER), errorCode(409, 'UPLOAD_INCOMPLETE'));
  await store.append(transfer.id, OWNER, body('efgh'), { offset: 4, checksum: hash('efgh') });
  const file = await store.complete(transfer.id, OWNER);
  assert.equal(file.hash, hash(data));
  assert.deepEqual(await bytesOf(store, file.id), data);
  assert.equal((await store.head(transfer.id, OWNER)).state, 'complete');
  assert.equal(store.usage().reservedBytes, 0);
});

test('a failed oversized chunk is truncated before the next valid retry', async t => {
  const { store, dir } = await fixture(t);
  const transfer = await store.begin({ name: 'retry.bin', size: 8, sha256: hash('abcdefgh') }, OWNER);
  await store.append(transfer.id, OWNER, body('abcd'), { offset: 0, checksum: hash('abcd') });
  await assert.rejects(store.append(transfer.id, OWNER, body('efghi'), { offset: 4, checksum: hash('efghi') }), errorCode(413));
  assert.equal((await store.head(transfer.id, OWNER)).offset, 4);
  assert.equal((await readFile(path.join(dir, '.mckl-objects', `${transfer.id}.part`))).toString(), 'abcd');
  await store.append(transfer.id, OWNER, body('efgh'), { offset: 4, checksum: hash('efgh') });
  assert.equal((await bytesOf(store, (await store.complete(transfer.id, OWNER)).id)).toString(), 'abcdefgh');
});

test('restart resumes at the last durable offset and discards an uncommitted tail', async t => {
  const fixtureState = await fixture(t);
  let store = fixtureState.store;
  const transfer = await store.begin({ name: 'restart.bin', size: 8, sha256: hash('abcdefgh') }, OWNER);
  await store.append(transfer.id, OWNER, body('abcd'), { offset: 0, checksum: hash('abcd') });
  await appendFile(path.join(fixtureState.dir, '.mckl-objects', `${transfer.id}.part`), 'uncommitted');
  store = await fixtureState.restart();
  assert.equal((await store.head(transfer.id, OWNER)).offset, 4);
  assert.equal((await readFile(path.join(fixtureState.dir, '.mckl-objects', `${transfer.id}.part`))).toString(), 'abcd');
  await store.append(transfer.id, OWNER, body('efgh'), { offset: 4, checksum: hash('efgh') });
  const file = await store.complete(transfer.id, OWNER);
  store = await fixtureState.restart();
  assert.equal((await bytesOf(store, file.id)).toString(), 'abcdefgh');
});

test('reservations enforce total quota and cancel releases the reserved name and capacity', async t => {
  const { store } = await fixture(t, { maxTotalSize: 10 });
  const transfer = await store.begin({ name: 'quota.bin', size: 8, sha256: hash('abcdefgh') }, OWNER);
  await assert.rejects(store.begin({ name: 'another.bin', size: 3, sha256: hash('abc') }, OWNER), errorCode(507, 'STORAGE_QUOTA_EXCEEDED'));
  await assert.rejects(store.cancel(transfer.id, OTHER), errorCode(404));
  await store.cancel(transfer.id, OWNER);
  assert.equal(store.usage().reservedBytes, 0);
  const file = await put(store, 'quota.bin', 'abcdefgh');
  assert.equal(file.name, 'quota.bin');
  await assert.rejects(async () => put(store, 'too-big.bin', 'abc'), errorCode(507));
});

test('pending count, per-file size and free-space checks reject before consuming a body', async t => {
  const { store } = await fixture(t, { maxPendingUploads: 1, maxFileSize: 8 });
  const transfer = await store.begin({ name: 'pending.bin', size: 8, sha256: hash('abcdefgh') }, OWNER);
  await assert.rejects(store.begin({ name: 'second.bin', size: 1, sha256: hash('a') }, OWNER), errorCode(429, 'PENDING_UPLOAD_LIMIT'));
  await store.cancel(transfer.id, OWNER);
  await assert.rejects(store.begin({ name: 'large.bin', size: 9, sha256: hash('abcdefghi') }, OWNER), errorCode(413));
  const tight = await fixture(t, { minFreeSpace: Number.MAX_SAFE_INTEGER });
  await assert.rejects(tight.store.begin({ name: 'disk.bin', size: 1, sha256: hash('a') }, OWNER), errorCode(507, 'INSUFFICIENT_STORAGE'));
});

test('active write cap applies across simultaneous streaming callers', async t => {
  const { store } = await fixture(t, { maxConcurrentUploads: 1 });
  const source = new PassThrough();
  const first = store.upload(source, { ownerId: OWNER, name: 'active.bin', expectedSize: 1 });
  try {
    await assert.rejects(async () => put(store, 'extra.bin', 'b'), errorCode(429, 'UPLOAD_LIMIT_REACHED'));
  } finally { source.end('a'); }
  const file = await first;
  assert.equal((await bytesOf(store, file.id)).toString(), 'a');
  assert.equal(store.usage().activeUploads, 0);
});

test('stream abort cleans its temporary file and capacity without harming the next upload', async t => {
  const { store, dir } = await fixture(t);
  const source = new Readable({ read() { this.push(Buffer.from('abc')); this.destroy(new Error('Synthetic disconnect')); } });
  await assert.rejects(store.upload(source, { name: 'aborted.bin', ownerId: OWNER, expectedSize: 8 }), /Synthetic disconnect/);
  assert.equal(store.usage().reservedBytes, 0);
  assert.equal(store.usage().activeUploads, 0);
  assert.deepEqual(await readdir(path.join(dir, '.mckl-objects')), []);
  assert.equal((await put(store, 'next.bin', 'good')).size, 4);
});

test('manifest commit failure rolls back the file and quota', async t => {
  const { store, dir } = await fixture(t);
  await mkdir(path.join(dir, '.mckl-manifest.json'));
  await assert.rejects(async () => put(store, 'not-committed.bin', 'payload'));
  assert.equal(store.files.size, 0);
  assert.equal(store.usage().reservedBytes, 0);
  assert.deepEqual(await readdir(path.join(dir, '.mckl-objects')), []);
});

test('failed removal restores the payload and its metadata', async t => {
  const { store, dir } = await fixture(t);
  const file = await put(store, 'keep.bin', 'keep');
  await rm(path.join(dir, '.mckl-manifest.json'));
  await mkdir(path.join(dir, '.mckl-manifest.json'));
  await assert.rejects(store.remove(file.id));
  assert.equal((await bytesOf(store, file.id)).toString(), 'keep');
  assert.equal(store.usage().usedBytes, 4);
});

test('final digest mismatch never publishes a file', async t => {
  const { store } = await fixture(t);
  const transfer = await store.begin({ name: 'bad.bin', size: 4, sha256: hash('wrong') }, OWNER);
  await store.append(transfer.id, OWNER, body('data'), { offset: 0, checksum: hash('data') });
  await assert.rejects(store.complete(transfer.id, OWNER), errorCode(422, 'CHECKSUM_MISMATCH'));
  assert.equal(store.files.size, 0);
  await store.cancel(transfer.id, OWNER);
});

test('expired session cleanup only removes indexed internal temporary files', async t => {
  let clock = Date.now();
  const { store, dir } = await fixture(t, { now: () => clock, uploadTtlMs: 1000 });
  const transfer = await store.begin({ name: 'expired.bin', size: 1, sha256: hash('a') }, OWNER);
  await writeFile(path.join(dir, 'personal.part'), 'keep root fixture');
  await writeFile(path.join(dir, '.mckl-objects', 'unindexed.part'), 'keep unindexed fixture');
  clock += 1001;
  await assert.rejects(store.head(transfer.id, OWNER), errorCode(404));
  await store.begin({ name: 'replacement.bin', size: 1, sha256: hash('a') }, OWNER);
  const names = await readdir(path.join(dir, '.mckl-objects'));
  assert.equal(names.includes(`${transfer.id}.part`), false);
  assert.equal(await readFile(path.join(dir, 'personal.part'), 'utf8'), 'keep root fixture');
  assert.equal(await readFile(path.join(dir, '.mckl-objects', 'unindexed.part'), 'utf8'), 'keep unindexed fixture');
});

test('legacy manifest loading ignores caller-supplied paths and preserves legacy payloads', async t => {
  const { store, dir, restart } = await fixture(t);
  await store.stop();
  await writeFile(path.join(dir, 'legacy.txt'), 'legacy fixture');
  const id = '1'.repeat(24);
  await writeFile(path.join(dir, '.mckl-manifest.json'), JSON.stringify([{ id, name: 'legacy.txt', size: Buffer.byteLength('legacy fixture'), mime: 'text/plain', hash: hash('legacy fixture'), path: '/untrusted-path-must-be-ignored', arbitrary: 'untrusted' }]));
  const loaded = await restart();
  assert.equal((await bytesOf(loaded, id)).toString(), 'legacy fixture');
  assert.equal(loaded.files.get(id).path, path.join(dir, 'legacy.txt'));
  assert.equal(Object.hasOwn(loaded.files.get(id), 'arbitrary'), false);
});

test('legacy records without a size load, while mismatched known sizes stay private', async t => {
  const state = await fixture(t);
  await state.store.stop();
  await writeFile(path.join(state.dir, 'without-size.txt'), 'legacy fixture');
  await writeFile(path.join(state.dir, 'wrong-size.txt'), 'changed legacy fixture');
  const unknown = '2'.repeat(24);
  const mismatched = '3'.repeat(24);
  await writeFile(path.join(state.dir, '.mckl-manifest.json'), JSON.stringify([
    { id: unknown, name: 'without-size.txt' },
    { id: mismatched, name: 'wrong-size.txt', size: 0, hash: hash('') },
  ]));
  const store = await state.restart();
  assert.equal((await bytesOf(store, unknown)).toString(), 'legacy fixture');
  assert.equal(store.files.get(unknown).size, Buffer.byteLength('legacy fixture'));
  assert.equal(store.files.has(mismatched), false);
  await assert.rejects(store.open(mismatched), errorCode(404));
  assert.equal(await readFile(path.join(state.dir, 'wrong-size.txt'), 'utf8'), 'changed legacy fixture');
});

test('symlink replacement is refused without reading or deleting the external file', { skip: process.platform === 'win32' }, async t => {
  const { store, dir } = await fixture(t);
  const file = await put(store, 'inside.txt', 'inside');
  const outside = `${dir}-outside.txt`;
  t.after(() => rm(outside, { force: true }));
  await writeFile(outside, 'outside');
  await rm(file.path);
  await symlink(outside, file.path);
  await assert.rejects(store.open(file.id), errorCode(404));
  await assert.rejects(store.remove(file.id), errorCode(404));
  assert.equal(await readFile(outside, 'utf8'), 'outside');
});

test('invalid upload sizes and missing metadata fail as client errors', async t => {
  const { store } = await fixture(t);
  for (const size of [-1, 1.5, '8', undefined, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(store.begin({ name: 'invalid.bin', size, sha256: hash('a') }, OWNER), errorCode(400, 'INVALID_FILE_SIZE'));
  }
  await assert.rejects(store.begin(null, OWNER), errorCode(400, 'INVALID_UPLOAD_METADATA'));
  await assert.rejects(async () => store.upload(body('a'), null), errorCode(400, 'INVALID_UPLOAD_METADATA'));
});

test('one active append excludes completion, cancellation and another append', async t => {
  const { store } = await fixture(t);
  const transfer = await store.begin({ name: 'locked.bin', size: 4, sha256: hash('data') }, OWNER);
  const source = new PassThrough();
  const pending = store.append(transfer.id, OWNER, source, { offset: 0, checksum: hash('data') });
  try {
    await assert.rejects(store.complete(transfer.id, OWNER), errorCode(409, 'UPLOAD_BUSY'));
    await assert.rejects(store.cancel(transfer.id, OWNER), errorCode(409, 'UPLOAD_BUSY'));
    await assert.rejects(store.append(transfer.id, OWNER, body('data'), { offset: 0, checksum: hash('data') }), errorCode(409, 'UPLOAD_BUSY'));
  } finally { source.end('data'); }
  await pending;
  assert.equal((await bytesOf(store, (await store.complete(transfer.id, OWNER)).id)).toString(), 'data');
});

test('resumable commit failure leaves a complete session available for retry', async t => {
  const { store, dir } = await fixture(t);
  const transfer = await store.begin({ name: 'commit-retry.bin', size: 4, sha256: hash('data') }, OWNER);
  await store.append(transfer.id, OWNER, body('data'), { offset: 0, checksum: hash('data') });
  await mkdir(path.join(dir, '.mckl-manifest.json'));
  await assert.rejects(store.complete(transfer.id, OWNER));
  assert.equal(store.files.size, 0);
  assert.equal((await store.head(transfer.id, OWNER)).offset, 4);
  await rm(path.join(dir, '.mckl-manifest.json'), { recursive: true });
  const completed = await store.complete(transfer.id, OWNER);
  assert.equal((await bytesOf(store, completed.id)).toString(), 'data');
});

test('unknown-length streaming uploads release unused reserved capacity', async t => {
  const { store } = await fixture(t, { maxFileSize: 8, maxTotalSize: 8 });
  const file = await store.upload(body('abc'), { name: 'unknown.bin', ownerId: OWNER });
  assert.equal(file.size, 3);
  assert.equal(store.usage().reservedBytes, 0);
  assert.equal(store.usage().availableBytes, 5);
});

test('stop aborts an active stream and removes its unpublished temporary data', async t => {
  const { store, dir } = await fixture(t);
  const source = new PassThrough();
  const pending = store.upload(source, { name: 'stopping.bin', expectedSize: 4, ownerId: OWNER });
  const rejected = assert.rejects(pending, error => error.name === 'AbortError');
  await store.stop();
  await rejected;
  assert.equal(store.files.size, 0);
  assert.equal(store.usage().reservedBytes, 0);
  assert.deepEqual(await readdir(path.join(dir, '.mckl-objects')), []);
});

test('unpaired UTF-16 surrogates are normalized before constructing a display name', async t => {
  const { store } = await fixture(t);
  const file = await put(store, `invalid-\ud800.txt`, 'a');
  assert.doesNotThrow(() => encodeURIComponent(file.name));
  assert.equal((await bytesOf(store, file.id)).toString(), 'a');
});

test('a symlink used as the internal metadata file is rejected at startup', { skip: process.platform === 'win32' }, async t => {
  const { store, dir } = await fixture(t);
  await store.stop();
  const outside = `${dir}-metadata.json`;
  t.after(() => rm(outside, { force: true }));
  await writeFile(outside, '[]');
  await symlink(outside, path.join(dir, '.mckl-manifest.json'));
  await assert.rejects(store.init(), errorCode(500, 'INVALID_STORAGE_METADATA'));
  assert.equal(await readFile(outside, 'utf8'), '[]');
});

test('restart recovers a resumable publication interrupted before its manifest committed', async t => {
  const state = await fixture(t);
  const transfer = await state.store.begin({ name: 'publish-retry.bin', size: 4, sha256: hash('data') }, OWNER);
  await state.store.append(transfer.id, OWNER, body('data'), { offset: 0, checksum: hash('data') });
  await state.store.stop();
  const objects = path.join(state.dir, '.mckl-objects');
  await writeFile(path.join(objects, `${transfer.id}.bin`), 'data');
  const recovered = await state.restart();
  assert.equal((await readdir(objects)).includes(`${transfer.id}.bin`), false);
  assert.equal((await recovered.head(transfer.id, OWNER)).offset, 4);
  assert.equal((await bytesOf(recovered, (await recovered.complete(transfer.id, OWNER)).id)).toString(), 'data');
});

test('restart cleans only the streaming objects identified by its durable journal', async t => {
  const state = await fixture(t);
  await state.store.stop();
  const id = '2'.repeat(24);
  const objects = path.join(state.dir, '.mckl-objects');
  await writeFile(path.join(objects, `${id}.part`), 'uncommitted private fixture');
  await writeFile(path.join(objects, `${id}.bin`), 'uncommitted private fixture');
  await writeFile(path.join(objects, 'unindexed.bin'), 'preserved fixture');
  await writeFile(path.join(state.dir, '.mckl-uploads.json'), JSON.stringify([{ id, kind: 'stream' }]));
  await state.restart();
  assert.deepEqual(await readdir(objects), ['unindexed.bin']);
  assert.deepEqual(JSON.parse(await readFile(path.join(state.dir, '.mckl-uploads.json'), 'utf8')), []);
});

test('restart restores an interrupted deletion when the file manifest still owns the payload', async t => {
  const state = await fixture(t);
  const file = await put(state.store, 'restore.bin', 'original');
  await state.store.stop();
  const tombstone = path.join(state.dir, '.mckl-objects', `${file.id}.trash`);
  await (await import('node:fs/promises')).rename(file.path, tombstone);
  await writeFile(path.join(state.dir, '.mckl-uploads.json'), JSON.stringify([{ id: file.id, kind: 'delete' }]));
  const recovered = await state.restart();
  assert.equal((await bytesOf(recovered, file.id)).toString(), 'original');
  assert.equal((await readdir(path.dirname(tombstone))).includes(path.basename(tombstone)), false);
});

test('restart finishes an interrupted deletion once removal from the manifest committed', async t => {
  const state = await fixture(t);
  const file = await put(state.store, 'removed.bin', 'original');
  await state.store.stop();
  const tombstone = path.join(state.dir, '.mckl-objects', `${file.id}.trash`);
  await (await import('node:fs/promises')).rename(file.path, tombstone);
  await writeFile(path.join(state.dir, '.mckl-manifest.json'), '[]');
  await writeFile(path.join(state.dir, '.mckl-uploads.json'), JSON.stringify([{ id: file.id, kind: 'delete' }]));
  const recovered = await state.restart();
  assert.equal(recovered.files.size, 0);
  assert.equal((await readdir(path.dirname(tombstone))).includes(path.basename(tombstone)), false);
});

test('open rejects a regular payload whose length changed after indexing', async t => {
  const { store } = await fixture(t);
  const file = await put(store, 'mutated.bin', 'original');
  await writeFile(file.path, 'changed-length');
  await assert.rejects(store.open(file.id), errorCode(404));
});

test('publication falls back to an exclusive copy on filesystems without hardlinks', async t => {
  const { store } = await fixture(t);
  const fsp = (await import('node:fs/promises')).default;
  const original = fsp.link;
  fsp.link = async () => { throw Object.assign(new Error('Synthetic unsupported filesystem'), { code: 'EOPNOTSUPP' }); };
  try {
    const file = await put(store, 'portable.bin', 'portable');
    assert.equal((await bytesOf(store, file.id)).toString(), 'portable');
    assert.equal(file.hash, hash('portable'));
  } finally { fsp.link = original; }
});

test('exclusive publication never replaces an existing destination', async t => {
  const { store } = await fixture(t);
  const fsp = (await import('node:fs/promises')).default;
  const original = fsp.link;
  let existing;
  fsp.link = async (source, destination) => {
    existing = destination;
    await writeFile(destination, 'preserve existing fixture');
    return original(source, destination);
  };
  try {
    await assert.rejects(async () => put(store, 'collision.bin', 'new payload'), error => error.code === 'EEXIST');
    assert.equal(await readFile(existing, 'utf8'), 'preserve existing fixture');
    assert.equal(store.files.size, 0);
  } finally { fsp.link = original; }
});

test('a file is not visible while its manifest transaction is still uncommitted', async t => {
  const { store, dir } = await fixture(t);
  const fsp = (await import('node:fs/promises')).default;
  const original = fsp.rename;
  let enter;
  let release;
  const entered = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  fsp.rename = async (source, destination) => {
    if (destination === path.join(dir, '.mckl-manifest.json')) { enter(); await gate; }
    return original(source, destination);
  };
  const pending = put(store, 'pending-commit.bin', 'data');
  try {
    await entered;
    assert.equal(store.list().length, 0, 'an uncommitted file must not be available to API readers');
  } finally { release(); await pending; fsp.rename = original; }
});

test('HEAD only exposes offsets confirmed by durable upload metadata', async t => {
  const { store, dir } = await fixture(t);
  const transfer = await store.begin({ name: 'pending-offset.bin', size: 4, sha256: hash('data') }, OWNER);
  const fsp = (await import('node:fs/promises')).default;
  const original = fsp.rename;
  let enter;
  let release;
  const entered = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  fsp.rename = async (source, destination) => {
    if (destination === path.join(dir, '.mckl-uploads.json')) { enter(); await gate; }
    return original(source, destination);
  };
  const pending = store.append(transfer.id, OWNER, body('data'), { offset: 0, checksum: hash('data') });
  try {
    await entered;
    assert.equal((await store.head(transfer.id, OWNER)).offset, 0, 'uncommitted bytes cannot be acknowledged by HEAD');
  } finally { release(); await pending; fsp.rename = original; }
  assert.equal((await store.head(transfer.id, OWNER)).offset, 4);
});
