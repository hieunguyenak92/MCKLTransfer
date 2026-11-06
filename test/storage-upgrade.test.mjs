import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable, PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createFileStore } from '../lib/file-store.mjs';
import { acquireStorageLock } from '../lib/storage-lock.mjs';

const OWNER = '1111111111111111';
const OTHER = '2222222222222222';
const TAB_A = 'a'.repeat(32);
const TAB_B = 'b'.repeat(32);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const body = bytes => Readable.from([Buffer.from(bytes)]);
const code = expected => error => error.code === expected;

async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mckl-storage-upgrade-'));
  const settings = { shareDir: dir, minFreeSpace: 0, ...options };
  let store = createFileStore(settings);
  await store.init();
  t.after(async () => { await store.stop(); await fs.rm(dir, { recursive: true, force: true }); });
  return { dir, get store() { return store; }, restart: async () => { await store.stop(); store = createFileStore(settings); await store.init(); return store; } };
}

async function put(store, bytes = 'payload', metadata = {}, owner = OWNER) {
  return store.upload(body(bytes), { name: 'example.bin', expectedSize: Buffer.byteLength(bytes), expectedHash: hash(bytes), ownerId: owner, ...metadata });
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Test condition did not become true');
}

test('single-writer lock prevents two store instances from overwriting the same manifest', async t => {
  const setup = await fixture(t);
  const second = createFileStore({ shareDir: setup.dir });
  await assert.rejects(second.init(), code('STORAGE_LOCKED'));
  const first = await put(setup.store, 'first');
  await setup.store.stop();
  await second.init();
  try {
    const next = await put(second, 'second');
    assert.deepEqual(second.list().map(file => file.id).sort(), [first.id, next.id].sort());
  } finally { await second.stop(); }
});

test('initialization failure releases its lock without touching a live owner lock', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mckl-lock-init-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, '.mckl-manifest.json'), 'broken');
  const first = createFileStore({ shareDir: dir });
  await assert.rejects(first.init());
  await fs.rm(path.join(dir, '.mckl-manifest.json'));
  const second = createFileStore({ shareDir: dir });
  await second.init();
  await assert.rejects(first.init(), code('STORAGE_LOCKED'));
  await second.stop();
});

test('stale lock recovery requires a proven dead process and refuses ambiguous locks', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mckl-lock-dead-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const lockModule = new URL('../lib/storage-lock.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { acquireStorageLock } from ${JSON.stringify(lockModule)}; await acquireStorageLock(${JSON.stringify(dir)});`], { stdio: 'ignore' });
  const [exit] = await once(child, 'exit');
  assert.equal(exit, 0);
  const release = await acquireStorageLock(dir);
  await assert.rejects(acquireStorageLock(dir), code('STORAGE_LOCKED'));
  await release();
  await fs.mkdir(path.join(dir, '.mckl-lock'));
  await assert.rejects(acquireStorageLock(dir), code('STORAGE_LOCKED'));
});

test('completion and status survive a lost response and restart without duplicate publication', async t => {
  const setup = await fixture(t);
  const transfer = await setup.store.begin({ name: 'saved.bin', size: 4, sha256: hash('data') }, OWNER);
  await setup.store.append(transfer.id, OWNER, body('data'), { offset: 0, checksum: hash('data') });
  const completed = await setup.store.complete(transfer.id, OWNER);
  assert.equal((await setup.store.complete(transfer.id, OWNER)).id, completed.id);
  await assert.rejects(setup.store.head(transfer.id, OTHER), code('UPLOAD_NOT_FOUND'));
  await assert.rejects(setup.store.complete(transfer.id, OTHER), code('UPLOAD_NOT_FOUND'));
  await setup.restart();
  const status = await setup.store.head(transfer.id, OWNER);
  assert.equal(status.state, 'complete');
  assert.equal(status.offset, 4);
  assert.equal(status.file.hash, hash('data'));
  assert.equal((await setup.store.complete(transfer.id, OWNER)).id, transfer.id);
  assert.equal(setup.store.list().length, 1);
  await setup.store.remove(transfer.id);
  await assert.rejects(setup.store.complete(transfer.id, OWNER), code('UPLOAD_NOT_FOUND'));
});

test('file-count quota includes empty completed files and pending reservations', async t => {
  const setup = await fixture(t, { maxFileSize: 0, maxTotalSize: 0, maxFiles: 2 });
  await put(setup.store, '');
  const pending = await setup.store.begin({ name: 'second', size: 0, sha256: hash('') }, OWNER);
  await assert.rejects(put(setup.store, ''), code('FILE_COUNT_LIMIT'));
  assert.equal(setup.store.usage().usedBytes, 0);
  await setup.store.cancel(pending.id, OWNER);
  await put(setup.store, '');
  await setup.restart();
  await assert.rejects(put(setup.store, ''), code('FILE_COUNT_LIMIT'));
});

test('per-owner quotas preserve capacity for other devices and count reservations', async t => {
  const setup = await fixture(t, { maxOwnerBytes: 6, maxOwnerFiles: 3, maxOwnerPendingUploads: 1 });
  const pending = await setup.store.begin({ name: 'first', size: 4, sha256: hash('data') }, OWNER);
  await assert.rejects(setup.store.begin({ name: 'second', size: 0, sha256: hash('') }, OWNER), code('OWNER_PENDING_LIMIT'));
  await put(setup.store, 'other', {}, OTHER);
  await setup.store.cancel(pending.id, OWNER);
  await put(setup.store, '123456');
  await assert.rejects(put(setup.store, '7'), code('OWNER_STORAGE_QUOTA_EXCEEDED'));
  await put(setup.store, '');
  await put(setup.store, '');
  await assert.rejects(put(setup.store, ''), code('OWNER_FILE_LIMIT'));
});

test('sharing scope and folder metadata survive resume and completed retention expires safely', async t => {
  let time = 1000;
  const setup = await fixture(t, { now: () => time });
  const transfer = await setup.store.begin({ name: 'report.txt', size: 4, sha256: hash('data'), roomId: 'c'.repeat(24), recipientId: OTHER, relativePath: 'Folder/日本語/report.txt', retentionMs: 2000 }, OWNER);
  await setup.store.append(transfer.id, OWNER, body('data'), { offset: 0, checksum: hash('data') });
  await setup.restart();
  const file = await setup.store.complete(transfer.id, OWNER);
  assert.equal(file.roomId, 'c'.repeat(24));
  assert.equal(file.recipientId, OTHER);
  assert.equal(file.relativePath, 'Folder/日本語/report.txt');
  assert.equal(file.expiresAt, 3000);
  await setup.restart();
  assert.equal(setup.store.list()[0].expiresAt, 3000);
  time = 3000;
  assert.equal(setup.store.list().length, 0);
  await assert.rejects(setup.store.open(file.id), code('NOT_FOUND'));
  await assert.rejects(setup.store.complete(file.id, OWNER), code('UPLOAD_NOT_FOUND'));
  await setup.store.sweep();
  assert.equal(setup.store.usage().usedBytes, 0);
  await assert.rejects(fs.stat(path.join(setup.dir, '.mckl-objects', `${file.id}.bin`)), code('ENOENT'));
});

test('folder paths reject traversal, absolute paths, reserved components and excessive depth', async t => {
  const { store } = await fixture(t);
  for (const relativePath of ['../secret', '/absolute', 'a/../../b', 'a\\b', 'C:/path', 'a//b', 'a/./b', 'a/NUL.txt', '.mckl-objects/file', 'a/end.', 'a/end ', Array(33).fill('a').join('/'), 'é'.repeat(600)]) {
    await assert.rejects(store.begin({ name: 'item', size: 0, sha256: hash(''), relativePath }, OWNER), code('INVALID_RELATIVE_PATH'));
  }
  await assert.rejects(store.begin({ name: 'item', size: 0, sha256: hash(''), retentionMs: 31 * 86400000 }, OWNER), code('INVALID_RETENTION'));
  assert.equal(store.usage().pendingUploads, 0);
});

test('server-side tab leases reject concurrent ownership, survive restart and transfer after release', async t => {
  let time = 1000;
  const setup = await fixture(t, { now: () => time });
  const transfer = await setup.store.begin({ name: 'data', size: 4, sha256: hash('data'), clientId: TAB_A }, OWNER);
  await assert.rejects(setup.store.claim(transfer.id, OWNER, TAB_B), code('UPLOAD_CLAIMED'));
  await assert.rejects(setup.store.cancel(transfer.id, OWNER), code('UPLOAD_CLAIMED'));
  await setup.restart();
  await assert.rejects(setup.store.claim(transfer.id, OWNER, TAB_B), code('UPLOAD_CLAIMED'));
  await setup.store.releaseClaim(transfer.id, OWNER, TAB_A);
  assert.equal((await setup.store.head(transfer.id, OWNER)).leaseExpiresAt, 0);
  await setup.store.claim(transfer.id, OWNER, TAB_B);
  await assert.rejects(setup.store.append(transfer.id, OWNER, body('data'), { offset: 0, checksum: hash('data'), clientId: TAB_A }), code('UPLOAD_CLAIMED'));
  await setup.store.append(transfer.id, OWNER, body('data'), { offset: 0, checksum: hash('data'), clientId: TAB_B });
  time += 30001;
  await setup.store.claim(transfer.id, OWNER, TAB_A);
  assert.equal((await setup.store.complete(transfer.id, OWNER, { clientId: TAB_A })).size, 4);
});

test('expired lease cannot be stolen while an append is active', async t => {
  let time = 1000;
  const { store } = await fixture(t, { now: () => time });
  const transfer = await store.begin({ name: 'slow', size: 4, sha256: hash('data'), clientId: TAB_A }, OWNER);
  const stream = new PassThrough();
  const operation = store.append(transfer.id, OWNER, stream, { offset: 0, checksum: hash('data'), clientId: TAB_A });
  stream.write('d');
  await waitFor(() => store.usage().activeUploads === 1);
  time += 31000;
  await assert.rejects(store.claim(transfer.id, OWNER, TAB_B), code('UPLOAD_BUSY'));
  stream.end('ata');
  await operation;
  await assert.rejects(store.claim(transfer.id, OWNER, TAB_B), code('UPLOAD_CLAIMED'));
});

test('revoking an active streaming upload aborts its body and never publishes it', async t => {
  const { store } = await fixture(t);
  const controller = new AbortController();
  const stream = new PassThrough();
  const operation = store.upload(stream, { name: 'revoked', ownerId: OWNER, expectedSize: 4 }, { signal: controller.signal });
  const rejected = assert.rejects(operation, error => error.name === 'AbortError');
  stream.write('d');
  await waitFor(() => store.usage().reservedBytes === 4);
  controller.abort();
  await rejected;
  assert.equal(store.list().length, 0);
  assert.equal(store.usage().reservedBytes, 0);
});

test('authorization is checked again immediately before durable publication', async t => {
  const { store } = await fixture(t);
  const transfer = await store.begin({ name: 'revoked', size: 4, sha256: hash('data') }, OWNER);
  await store.append(transfer.id, OWNER, body('data'), { offset: 0, checksum: hash('data') });
  let authorized = true;
  const originalOpen = fs.open;
  t.mock.method(fs, 'open', async function (filename, ...args) {
    const handle = await originalOpen.call(this, filename, ...args);
    if (String(filename).includes('.mckl-manifest.json.') && String(filename).endsWith('.tmp')) {
      const originalSync = handle.sync.bind(handle);
      handle.sync = async () => { await originalSync(); authorized = false; };
    }
    return handle;
  });
  await assert.rejects(store.complete(transfer.id, OWNER, { authorize: () => authorized }), code('AUTH_REVOKED'));
  assert.equal(store.list().length, 0);
  assert.equal((await store.head(transfer.id, OWNER)).offset, 4);
  t.mock.restoreAll();
  assert.equal((await store.complete(transfer.id, OWNER)).size, 4);
});

test('a directory sync failure after manifest rename preserves its published payload for recovery', async t => {
  const setup = await fixture(t);
  const transfer = await setup.store.begin({ name: 'durable', size: 4, sha256: hash('data') }, OWNER);
  await setup.store.append(transfer.id, OWNER, body('data'), { offset: 0, checksum: hash('data') });
  const originalRename = fs.rename;
  const originalOpen = fs.open;
  let manifestRenamed = false;
  t.mock.method(fs, 'rename', async function (from, to) {
    const result = await originalRename.call(this, from, to);
    if (String(to).endsWith('.mckl-manifest.json')) manifestRenamed = true;
    return result;
  });
  t.mock.method(fs, 'open', async function (filename, ...args) {
    const handle = await originalOpen.call(this, filename, ...args);
    if (filename === setup.dir && manifestRenamed) handle.sync = async () => { throw Object.assign(new Error('Injected directory sync failure'), { code: 'EIO' }); };
    return handle;
  });
  await assert.rejects(setup.store.complete(transfer.id, OWNER), error => error.code === 'EIO' && error.metadataCommitted === true);
  await assert.rejects(setup.store.begin({ name: 'blocked', size: 0, sha256: hash('') }, OWNER), code('STORE_UNAVAILABLE'));
  t.mock.restoreAll();
  await setup.restart();
  assert.equal((await setup.store.complete(transfer.id, OWNER)).hash, hash('data'));
  assert.equal((await fs.stat(path.join(setup.dir, '.mckl-objects', `${transfer.id}.bin`))).size, 4);
});

test('scope authorization uses persisted upload metadata after room membership changes', async t => {
  const { store } = await fixture(t);
  const roomId = 'c'.repeat(24);
  let member = true;
  const observed = [];
  const context = { authorize(resource) {
    assert.ok(resource, 'every policy check has authoritative resource metadata');
    observed.push({ ...resource });
    return resource.ownerId === OWNER && resource.roomId === roomId && member;
  } };
  const transfer = await store.begin({ name: 'private.bin', size: 4, sha256: hash('data'), roomId, recipientId: OTHER }, OWNER, context);
  await store.append(transfer.id, OWNER, body('data'), { offset: 0, checksum: hash('data'), ...context });
  member = false;
  await assert.rejects(async () => store.complete(transfer.id, OWNER, context), code('AUTH_REVOKED'));
  assert.equal(store.list().length, 0);
  assert.equal((await store.head(transfer.id, OWNER)).offset, 4);
  member = true;
  const file = await store.complete(transfer.id, OWNER, context);
  assert.equal(file.recipientId, OTHER);
  member = false;
  await assert.rejects(async () => store.complete(transfer.id, OWNER, context), code('AUTH_REVOKED'));
  assert.ok(observed.length > 5);
  assert.ok(observed.every(resource => resource.roomId === roomId && resource.recipientId === OTHER));
});

test('a removed room member cannot durably advance an in-flight chunk', async t => {
  const { store } = await fixture(t);
  const roomId = 'd'.repeat(24);
  const transfer = await store.begin({ name: 'private.bin', size: 4, sha256: hash('data'), roomId }, OWNER);
  let member = true;
  const input = new PassThrough();
  const operation = store.append(transfer.id, OWNER, input, { offset: 0, checksum: hash('data'), authorize: resource => resource.roomId === roomId && member });
  const rejected = assert.rejects(operation, code('AUTH_REVOKED'));
  input.write('d');
  await waitFor(() => store.usage().activeUploads === 1);
  member = false;
  input.end('ata');
  await rejected;
  assert.equal((await store.head(transfer.id, OWNER)).offset, 0);
  await store.append(transfer.id, OWNER, body('data'), { offset: 0, checksum: hash('data') });
  assert.equal((await store.complete(transfer.id, OWNER)).hash, hash('data'));
});

test('streaming authorization receives scope and cannot mutate stored targeting', async t => {
  const { store } = await fixture(t);
  const roomId = 'e'.repeat(24);
  const resources = [];
  const file = await store.upload(body('data'), { name: 'private.bin', ownerId: OWNER, expectedSize: 4, roomId, recipientId: OTHER }, { authorize(resource) {
    assert.ok(resource);
    resources.push({ ...resource });
    resource.roomId = 'shared';
    return true;
  } });
  assert.equal(file.roomId, roomId);
  assert.equal(file.recipientId, OTHER);
  assert.ok(resources.length >= 4);
  assert.ok(resources.every(resource => resource.roomId === roomId && resource.ownerId === OWNER));
});
