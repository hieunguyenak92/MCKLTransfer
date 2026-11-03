import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PIN = '123456';
const ADMIN_CODE = 'synthetic-admin-code-for-tests';
const SERVER_URL = pathToFileURL(path.resolve('server.mjs')).href;
const CHILD_SOURCE = `
  import { createApp } from ${JSON.stringify(SERVER_URL)};
  const options = JSON.parse(process.env.MCKL_TEST_OPTIONS);
  const app = createApp(options);
  await app.start();
  process.send({ type: 'ready', port: app.server.address().port });
  process.on('message', (message) => {
    if (message.type === 'file-path') process.send({ type: 'file-path', id: message.id, path: app.files.get(message.id)?.path });
  });
  process.on('SIGTERM', () => app.stop().finally(() => process.exit(0)));
`;

async function fixture(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mckl-security-'));
  const child = spawn(process.execPath, ['--input-type=module', '-e', CHILD_SOURCE], {
    cwd: path.resolve('.'),
    env: { ...process.env, MCKL_TEST_OPTIONS: JSON.stringify({ host: '127.0.0.1', port: 0, shareCode: PIN, adminCode: ADMIN_CODE, shareDir: dir, deviceName: 'Synthetic test host', ...options }) },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 500);
      await exited;
      clearTimeout(timer);
    }
    await chmod(dir, 0o700).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Synthetic server did not start within 5 seconds')); }, 5000);
    const onExit = () => { clearTimeout(timeout); reject(new Error(`Synthetic server exited during startup: ${stderr.slice(-1200)}`)); };
    child.once('exit', onExit);
    child.once('error', reject);
    child.on('message', message => {
      if (message.type !== 'ready') return;
      clearTimeout(timeout);
      child.removeListener('exit', onExit);
      resolve(message.port);
    });
  });
  const base = `http://127.0.0.1:${port}`;
  async function request(route, init = {}) {
    return fetch(`${base}${route}`, { ...init, signal: init.signal ?? AbortSignal.timeout(2000) });
  }
  async function auth(code = PIN) {
    const response = await request('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    assert.equal(response.status, 200, 'synthetic credentials must authenticate');
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie, 'authentication must issue a cookie');
    return { cookie, response, payload: await response.json() };
  }
  async function upload(cookie, name, body = Buffer.from('synthetic payload')) {
    return request('/api/upload', { method: 'POST', headers: { cookie, 'x-file-name': encodeURIComponent(name), 'x-file-size': String(body.length), 'x-file-type': 'application/octet-stream' }, body });
  }
  async function filePath(id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.removeListener('message', listener); reject(new Error('Synthetic file-path lookup timed out')); }, 2000);
      function listener(message) {
        if (message.type !== 'file-path' || message.id !== id) return;
        clearTimeout(timer);
        child.removeListener('message', listener);
        resolve(message.path);
      }
      child.on('message', listener);
      child.send({ type: 'file-path', id });
    });
  }
  return { dir, child, base, port, request, auth, upload, filePath, get stderr() { return stderr; } };
}

async function rawRequest(port, route, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: route, headers }, res => {
      res.resume();
      res.once('end', () => resolve(res.statusCode));
    });
    req.once('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('Synthetic HTTP request timed out')));
    req.end();
  });
}

async function within(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

test('public configuration never reveals an access code or local identity', async t => {
  const app = await fixture(t);
  const response = await app.request('/api/config');
  assert.equal(response.status, 200);
  const config = await response.json();
  for (const key of ['code', 'shareCode', 'adminCode', 'deviceName', 'addresses']) {
    assert.equal(Object.hasOwn(config, key), false, `${key} must not be disclosed before authentication, including on loopback`);
  }
});

test('untrusted Host is rejected before authentication', async t => {
  const app = await fixture(t);
  const hostStatus = await rawRequest(app.port, '/api/config', { host: 'untrusted.invalid' });
  assert.ok([400, 403, 421].includes(hostStatus), `untrusted Host was accepted with HTTP ${hostStatus}`);
});

test('cross-origin requests cannot establish an authenticated session', async t => {
  const app = await fixture(t);
  const response = await app.request('/api/auth', {
    method: 'POST', headers: { origin: 'https://untrusted.invalid', 'content-type': 'application/json' }, body: JSON.stringify({ code: PIN }),
  });
  assert.equal(response.status, 403, 'a foreign Origin must not establish an authenticated session');
});

test('duplicate maximum-length names remain distinct and leave the server responsive', async t => {
  const app = await fixture(t);
  const { cookie } = await app.auth();
  const name = 'a'.repeat(180);
  const firstResponse = await app.upload(cookie, name, Buffer.from('first payload'));
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json();
  const secondResponse = await app.upload(cookie, name, Buffer.from('second payload'));
  assert.equal(secondResponse.status, 201);
  const second = await secondResponse.json();
  assert.notEqual(first.name.toLowerCase(), second.name.toLowerCase());
  assert.equal((await app.request('/api/health')).status, 200);
  const firstDownload = await app.request(`/api/files/${first.id}/download`, { headers: { cookie } });
  const secondDownload = await app.request(`/api/files/${second.id}/download`, { headers: { cookie } });
  assert.equal(await firstDownload.text(), 'first payload');
  assert.equal(await secondDownload.text(), 'second payload');
});

test('an internal manifest filename cannot overwrite uploaded content or metadata', async t => {
  const app = await fixture(t);
  const { cookie } = await app.auth();
  const response = await app.upload(cookie, '.mckl-manifest.json');
  assert.equal(response.status, 400, 'internal metadata filenames must be rejected before file creation');
  const ordinary = await app.upload(cookie, 'ordinary.txt', Buffer.from('ordinary content'));
  assert.equal(ordinary.status, 201);
  const file = await ordinary.json();
  const download = await app.request(`/api/files/${file.id}/download`, { headers: { cookie } });
  assert.equal(await download.text(), 'ordinary content');
});

test('a storage open error rejects the upload without crashing the process', { skip: process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0) }, async t => {
  const app = await fixture(t);
  const { cookie } = await app.auth();
  await chmod(app.dir, 0o500);
  try {
    await new Promise(resolve => {
      const req = http.request({ hostname: '127.0.0.1', port: app.port, path: '/api/upload', method: 'POST', headers: { cookie, 'content-length': '2', 'x-file-name': 'disk-error.txt', 'x-file-size': '2' } }, res => {
        res.resume();
        res.once('end', resolve);
      });
      req.on('error', resolve);
      req.setTimeout(2000, () => { req.destroy(); resolve(); });
      req.write('a');
      const endTimer = setTimeout(() => { if (!req.destroyed) req.end('b'); }, 100);
      req.once('close', () => clearTimeout(endTimer));
    });
    assert.equal(app.child.exitCode, null, `storage error terminated the server: ${app.stderr.slice(-1200)}`);
    const response = await app.request('/api/health');
    assert.equal(response.status, 200, 'health must remain reachable after an upload storage failure');
  } finally {
    await chmod(app.dir, 0o700);
  }
});

test('logout revokes the server session and expires its HttpOnly cookie', async t => {
  const app = await fixture(t);
  const { cookie } = await app.auth();
  const response = await app.request('/api/logout', { method: 'POST', headers: { cookie } });
  assert.equal(response.status, 200);
  const expired = response.headers.get('set-cookie') ?? '';
  assert.match(expired, /mckl_session=/);
  assert.match(expired, /Max-Age=0/i);
  assert.match(expired, /HttpOnly/i);
  assert.equal((await app.request('/api/files', { headers: { cookie } })).status, 401, 'replaying the old cookie must fail after logout');
});

test('SSE connections close when their session expires', async t => {
  const app = await fixture(t, { sessionTtlMs: 600 });
  const { cookie } = await app.auth();
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await app.request('/api/events', { headers: { cookie }, signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.match(new TextDecoder().decode(first.value), /event: ready/);
  const closed = (async () => {
    while (!(await reader.read()).done) { /* consume heartbeat or expiry notification */ }
  })();
  await within(closed, 2200, 'SSE remained open beyond its session expiry');
  assert.equal((await app.request('/api/files', { headers: { cookie } })).status, 401);
});

test('logout also closes the existing SSE stream for that session', async t => {
  const app = await fixture(t);
  const { cookie } = await app.auth();
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await app.request('/api/events', { headers: { cookie }, signal: controller.signal });
  const reader = response.body.getReader();
  await reader.read();
  assert.equal((await app.request('/api/logout', { method: 'POST', headers: { cookie } })).status, 200);
  const closed = (async () => { while (!(await reader.read()).done) {} })();
  await within(closed, 1500, 'Logged-out session retained its SSE connection');
});

test('download refuses a symlink swapped in for an indexed payload', { skip: process.platform === 'win32' }, async t => {
  const app = await fixture(t);
  const { cookie } = await app.auth();
  const upload = await app.upload(cookie, 'inside.txt', Buffer.from('inside fixture'));
  assert.equal(upload.status, 201);
  const file = await upload.json();
  const stored = await app.filePath(file.id);
  assert.ok(stored, 'the indexed payload path is available to the isolated fixture');
  const outside = `${app.dir}-outside.txt`;
  t.after(() => rm(outside, { force: true }));
  await writeFile(outside, 'outside fixture must not be disclosed');
  await rm(stored);
  await symlink(outside, stored);
  assert.equal((await app.request(`/api/files/${file.id}/download`, { headers: { cookie } })).status, 404);
  assert.equal(await readFile(outside, 'utf8'), 'outside fixture must not be disclosed');
});
