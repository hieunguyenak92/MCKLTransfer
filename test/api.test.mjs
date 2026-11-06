import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';

const PIN = '123456';
const ADMIN_CODE = 'synthetic-admin-code-for-api-tests';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

async function fixture(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mckl-api-'));
  let app;
  let base;
  async function start() {
    app = createApp({ host: '127.0.0.1', port: 0, shareDir: dir, shareCode: PIN, adminCode: ADMIN_CODE, minFreeSpace: 0, logger: { log() {}, warn() {} }, ...options });
    await app.start();
    base = `http://127.0.0.1:${app.server.address().port}`;
  }
  t.after(async () => {
    await app?.stop();
    await rm(dir, { recursive: true, force: true });
  });
  await start();
  async function request(route, init = {}) {
    return fetch(`${base}${route}`, { ...init, signal: init.signal ?? AbortSignal.timeout(3000) });
  }
  async function auth(code = PIN, body = {}, cookie) {
    const response = await request('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ code, ...body }) });
    assert.equal(response.status, 200);
    const issued = response.headers.get('set-cookie');
    assert.match(issued, /HttpOnly/i);
    assert.match(issued, /SameSite=Strict/i);
    return { cookie: issued.split(';')[0], response, payload: await response.json() };
  }
  async function upload(cookie, name, body) {
    const response = await request('/api/upload', { method: 'POST', headers: { cookie, 'x-file-name': encodeURIComponent(name), 'x-file-size': String(body.length), 'x-file-type': 'application/octet-stream', 'x-file-sha256': sha256(body) }, body });
    assert.equal(response.status, 201);
    return response.json();
  }
  async function begin(cookie, name, body, expectedHash = sha256(body)) {
    const response = await request('/api/uploads', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name, size: body.length, mime: 'application/octet-stream', sha256: expectedHash }) });
    assert.equal(response.status, 201);
    const upload = await response.json();
    assert.equal(response.headers.get('location'), `/api/uploads/${upload.id}`);
    return upload;
  }
  async function append(cookie, id, offset, body, checksum = sha256(body)) {
    return request(`/api/uploads/${id}`, { method: 'PATCH', headers: { cookie, 'upload-offset': String(offset), 'x-chunk-sha256': checksum }, body });
  }
  return { dir, request, auth, upload, begin, append, get port() { return app.server.address().port; }, async restart() { await app.stop(); await start(); } };
}

async function expectError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal((await response.json()).error, code);
}

async function within(promise, timeout, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), timeout); })]);
  } finally { clearTimeout(timer); }
}

test('peer and administrator permissions protect files and device management', async t => {
  const app = await fixture(t);
  const owner = await app.auth(PIN, { deviceName: 'Synthetic sender' });
  const other = await app.auth(PIN, { deviceName: 'Synthetic recipient' });
  const admin = await app.auth(ADMIN_CODE, { deviceName: 'Synthetic administrator' });
  assert.equal(owner.payload.role, 'peer');
  assert.equal(admin.payload.role, 'admin');
  assert.notEqual(owner.payload.clientId, other.payload.clientId);
  const ownerConfig = await app.request('/api/config', { headers: { cookie: owner.cookie } }).then(response => response.json());
  const adminConfig = await app.request('/api/config', { headers: { cookie: admin.cookie } }).then(response => response.json());
  assert.deepEqual(ownerConfig.permissions, { deleteOwn: true, deleteAll: false, manageDevices: false });
  assert.deepEqual(adminConfig.permissions, { deleteOwn: true, deleteAll: true, manageDevices: true });
  await expectError(await app.request('/api/devices', { headers: { cookie: owner.cookie } }), 403, 'FORBIDDEN');
  await expectError(await app.request(`/api/devices/${other.payload.clientId}`, { method: 'DELETE', headers: { cookie: owner.cookie } }), 403, 'FORBIDDEN');
  const devices = await app.request('/api/devices', { headers: { cookie: admin.cookie } }).then(response => response.json());
  assert.equal(devices.devices.length, 3);
  assert.equal(devices.devices.find(device => device.id === owner.payload.clientId).name, 'Synthetic sender');
  assert.equal(devices.devices.some(device => Object.hasOwn(device, 'token') || Object.hasOwn(device, 'tokenHash')), false);
  const body = Buffer.from('synthetic permission fixture');
  const file = await app.upload(owner.cookie, 'permissions.bin', body);
  assert.equal(file.ownerId, owner.payload.clientId);
  for (const [session, canDelete] of [[owner, true], [other, false], [admin, true]]) {
    const list = await app.request('/api/files', { headers: { cookie: session.cookie } }).then(response => response.json());
    assert.equal(list.files.find(item => item.id === file.id).canDelete, canDelete);
  }
  await expectError(await app.request(`/api/files/${file.id}`, { method: 'DELETE', headers: { cookie: other.cookie } }), 403, 'FORBIDDEN');
  const download = await app.request(`/api/files/${file.id}/download`, { headers: { cookie: other.cookie } });
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), body);
  assert.equal((await app.request(`/api/files/${file.id}`, { method: 'DELETE', headers: { cookie: admin.cookie } })).status, 200);
  const ownFile = await app.upload(owner.cookie, 'owned.bin', body);
  assert.equal((await app.request(`/api/files/${ownFile.id}`, { method: 'DELETE', headers: { cookie: owner.cookie } })).status, 200);
});

test('remembered device identity, rotated cookies and ownership survive a clean restart', async t => {
  const app = await fixture(t);
  const initial = await app.auth(PIN, { deviceName: 'Synthetic remembered device', rememberDevice: true });
  assert.equal(initial.payload.expiresIn, 30 * 24 * 60 * 60 * 1000);
  assert.match(initial.response.headers.get('set-cookie'), /Max-Age=2592000/);
  const file = await app.upload(initial.cookie, 'remembered.txt', Buffer.from('persisted owner fixture'));
  await app.restart();
  const config = await app.request('/api/config', { headers: { cookie: initial.cookie } }).then(response => response.json());
  assert.equal(config.clientId, initial.payload.clientId);
  const list = await app.request('/api/files', { headers: { cookie: initial.cookie } }).then(response => response.json());
  assert.equal(list.files.find(item => item.id === file.id).canDelete, true);
  const rotated = await app.auth(PIN, { rememberDevice: true }, initial.cookie);
  assert.equal(rotated.payload.clientId, initial.payload.clientId);
  assert.notEqual(rotated.cookie, initial.cookie);
  await expectError(await app.request('/api/files', { headers: { cookie: initial.cookie } }), 401, 'AUTH_REQUIRED');
  const persisted = await readFile(path.join(app.dir, '.mckl-devices.json'), 'utf8');
  for (const secret of [initial.cookie.split('=')[1], rotated.cookie.split('=')[1], ADMIN_CODE]) assert.equal(persisted.includes(secret), false, 'device state must store token hashes without credentials');
  const state = JSON.parse(persisted);
  assert.equal(Object.hasOwn(state, 'shareCode') || Object.hasOwn(state, 'adminCode'), false);
  assert.equal(state.devices.length, 1);
  assert.match(state.devices[0].tokenHash, /^[a-f0-9]{64}$/);
  await app.restart();
  assert.equal((await app.request(`/api/files/${file.id}`, { method: 'DELETE', headers: { cookie: rotated.cookie } })).status, 200);
  await expectError(await app.request('/api/files', { headers: { cookie: initial.cookie } }), 401, 'AUTH_REQUIRED');
});

test('administrator revocation closes a peer event stream and remains effective after restart', async t => {
  const app = await fixture(t);
  const peer = await app.auth(PIN, { rememberDevice: true });
  const admin = await app.auth(ADMIN_CODE);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const events = await app.request('/api/events', { headers: { cookie: peer.cookie }, signal: controller.signal });
  assert.equal(events.status, 200);
  const reader = events.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: ready/);
  assert.equal((await app.request(`/api/devices/${peer.payload.clientId}`, { method: 'DELETE', headers: { cookie: admin.cookie } })).status, 200);
  await within((async () => { while (!(await reader.read()).done) {} })(), 1500, 'revoked device retained its event stream');
  await expectError(await app.request('/api/files', { headers: { cookie: peer.cookie } }), 401, 'AUTH_REQUIRED');
  await app.restart();
  await expectError(await app.request('/api/files', { headers: { cookie: peer.cookie } }), 401, 'AUTH_REQUIRED');
  const devices = await app.request('/api/devices', { headers: { cookie: admin.cookie } }).then(response => response.json());
  assert.equal(devices.devices.some(device => device.id === peer.payload.clientId), false);
});

test('resumable API preserves verified offsets, ownership and data across a clean restart', async t => {
  const app = await fixture(t, { chunkSize: 4 });
  const owner = await app.auth(PIN, { rememberDevice: true });
  const other = await app.auth();
  const body = Buffer.from('abcdefghij');
  const upload = await app.begin(owner.cookie, 'resumable.bin', body);
  assert.equal(upload.offset, 0);
  assert.equal(upload.chunkSize, 4);
  const head = await app.request(`/api/uploads/${upload.id}`, { method: 'HEAD', headers: { cookie: owner.cookie } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('upload-offset'), '0');
  assert.equal(head.headers.get('upload-length'), String(body.length));
  assert.equal(new Date(head.headers.get('upload-expires')).getTime(), Math.floor(upload.expiresAt / 1000) * 1000, 'Upload-Expires must be an HTTP date');
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal((await app.request(`/api/uploads/${upload.id}`, { method: 'HEAD', headers: { cookie: other.cookie } })).status, 404);
  await expectError(await app.append(other.cookie, upload.id, 0, body.subarray(0, 4)), 404, 'UPLOAD_NOT_FOUND');
  await expectError(await app.request(`/api/uploads/${upload.id}/complete`, { method: 'POST', headers: { cookie: other.cookie } }), 404, 'UPLOAD_NOT_FOUND');
  await expectError(await app.request(`/api/uploads/${upload.id}`, { method: 'DELETE', headers: { cookie: other.cookie } }), 404, 'UPLOAD_NOT_FOUND');
  await expectError(await app.append(owner.cookie, upload.id, 1, body.subarray(0, 4)), 409, 'OFFSET_MISMATCH');
  await expectError(await app.append(owner.cookie, upload.id, 0, body.subarray(0, 4), '0'.repeat(64)), 422, 'CHECKSUM_MISMATCH');
  const afterMismatch = await app.request(`/api/uploads/${upload.id}`, { method: 'HEAD', headers: { cookie: owner.cookie } });
  assert.equal(afterMismatch.headers.get('upload-offset'), '0');
  await expectError(await app.request(`/api/uploads/${upload.id}/complete`, { method: 'POST', headers: { cookie: owner.cookie } }), 409, 'UPLOAD_INCOMPLETE');
  const first = await app.append(owner.cookie, upload.id, 0, body.subarray(0, 4));
  assert.equal(first.status, 204);
  assert.equal(first.headers.get('upload-offset'), '4');
  await app.restart();
  const restored = await app.request(`/api/uploads/${upload.id}`, { method: 'HEAD', headers: { cookie: owner.cookie } });
  assert.equal(restored.status, 200);
  assert.equal(restored.headers.get('upload-offset'), '4');
  for (const [offset, end] of [[4, 8], [8, 10]]) {
    const patched = await app.append(owner.cookie, upload.id, offset, body.subarray(offset, end));
    assert.equal(patched.status, 204);
    assert.equal(Number(patched.headers.get('upload-offset')), end);
  }
  const completed = await app.request(`/api/uploads/${upload.id}/complete`, { method: 'POST', headers: { cookie: owner.cookie } });
  assert.equal(completed.status, 201);
  const file = await completed.json();
  assert.equal(file.hash, sha256(body));
  assert.equal(file.ownerId, owner.payload.clientId);
  assert.equal(file.size, body.length);
  assert.equal((await app.request(`/api/uploads/${upload.id}`, { method: 'HEAD', headers: { cookie: owner.cookie } })).headers.get('Upload-State'), 'complete');
  const downloaded = await app.request(`/api/files/${file.id}/download`, { headers: { cookie: owner.cookie } });
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), body);
});

test('whole-file checksum failure never publishes data and pending upload can be cancelled', async t => {
  const app = await fixture(t, { chunkSize: 4 });
  const { cookie } = await app.auth();
  const body = Buffer.from('abcd');
  const upload = await app.begin(cookie, 'bad-hash.bin', body, sha256('different content'));
  assert.equal((await app.append(cookie, upload.id, 0, body)).status, 204);
  await expectError(await app.request(`/api/uploads/${upload.id}/complete`, { method: 'POST', headers: { cookie } }), 422, 'CHECKSUM_MISMATCH');
  const list = await app.request('/api/files', { headers: { cookie } }).then(response => response.json());
  assert.equal(list.files.length, 0);
  const head = await app.request(`/api/uploads/${upload.id}`, { method: 'HEAD', headers: { cookie } });
  assert.equal(head.headers.get('upload-offset'), '4');
  assert.equal((await app.request(`/api/uploads/${upload.id}`, { method: 'DELETE', headers: { cookie } })).status, 200);
  assert.equal((await app.request(`/api/uploads/${upload.id}`, { method: 'HEAD', headers: { cookie } })).status, 404);
});

test('download HEAD, validators and single ranges return consistent bytes and lengths', async t => {
  const app = await fixture(t);
  const { cookie } = await app.auth();
  const body = Buffer.from('0123456789');
  const name = 'tệp tổng hợp.bin';
  const file = await app.upload(cookie, name, body);
  const route = `/api/files/${file.id}/download`;
  const head = await app.request(route, { method: 'HEAD', headers: { cookie } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal(head.headers.get('accept-ranges'), 'bytes');
  assert.match(head.headers.get('content-disposition'), /^attachment;/);
  assert.ok(head.headers.get('content-disposition').includes(`filename*=UTF-8''${encodeURIComponent(name)}`));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const etag = head.headers.get('etag');
  assert.equal(etag, `"${sha256(body)}"`);
  for (const [range, expected, expectedRange] of [['bytes=2-4', '234', 'bytes 2-4/10'], ['bytes=7-', '789', 'bytes 7-9/10'], ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=8-999', '89', 'bytes 8-9/10'], ['bytes=-99', '0123456789', 'bytes 0-9/10']]) {
    const response = await app.request(route, { headers: { cookie, range } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), expectedRange);
    assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(expected));
    assert.equal(await response.text(), expected);
  }
  const rangedHead = await app.request(route, { method: 'HEAD', headers: { cookie, range: 'bytes=2-4' } });
  assert.equal(rangedHead.status, 206);
  assert.equal(rangedHead.headers.get('content-length'), '3');
  assert.equal((await rangedHead.arrayBuffer()).byteLength, 0);
  for (const range of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5', 'items=0-1', 'bytes=9007199254740992-']) {
    const response = await app.request(route, { headers: { cookie, range } });
    assert.equal(response.status, 416, `invalid range ${range} must fail`);
    assert.equal(response.headers.get('content-range'), 'bytes */10');
    await response.arrayBuffer();
  }
  const unchanged = await app.request(route, { headers: { cookie, 'if-none-match': etag } });
  assert.equal(unchanged.status, 304);
  assert.equal((await unchanged.arrayBuffer()).byteLength, 0);
  const matching = await app.request(route, { headers: { cookie, range: 'bytes=2-4', 'if-range': etag } });
  assert.equal(matching.status, 206);
  assert.equal(await matching.text(), '234');
  const changed = await app.request(route, { headers: { cookie, range: 'bytes=2-4', 'if-range': '"other-content"' } });
  assert.equal(changed.status, 200);
  assert.deepEqual(Buffer.from(await changed.arrayBuffer()), body);
  const empty = await app.upload(cookie, 'zero.bin', Buffer.alloc(0));
  const emptyRoute = `/api/files/${empty.id}/download`;
  const emptyResponse = await app.request(emptyRoute, { headers: { cookie } });
  assert.equal(emptyResponse.status, 200);
  assert.equal(emptyResponse.headers.get('content-length'), '0');
  assert.equal((await emptyResponse.arrayBuffer()).byteLength, 0);
  const emptyRange = await app.request(emptyRoute, { headers: { cookie, range: 'bytes=0-' } });
  assert.equal(emptyRange.status, 416);
  assert.equal(emptyRange.headers.get('content-range'), 'bytes */0');
});

test('oversized JSON receives a bounded error and the host remains responsive', async t => {
  const app = await fixture(t);
  const response = await app.request('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: PIN, deviceName: 'x'.repeat(40 * 1024) }) });
  await expectError(response, 413, 'REQUEST_TOO_LARGE');
  assert.equal((await app.request('/api/health')).status, 200);
});

test('oversized streaming JSON receives a structured error before the sender ends the body', async t => {
  const app = await fixture(t);
  const result = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: app.port, path: '/api/auth', method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.once('end', () => { req.destroy(); resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.once('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('oversized streaming JSON did not receive a bounded response')));
    // Keep the request open after exceeding the JSON limit, as a streaming
    // client can. The server must reject without waiting for an unbounded body.
    req.write('{"deviceName":"' + 'x'.repeat(40 * 1024));
  });
  assert.equal(result.status, 413);
  assert.equal(JSON.parse(result.body).error, 'REQUEST_TOO_LARGE');
  assert.equal((await app.request('/api/health')).status, 200);
});
