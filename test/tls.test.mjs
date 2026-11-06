import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createApp } from '../server.mjs';

const opensslAvailable = spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0;

function request(port, ca, route, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body;
    const req = https.request({ hostname: '127.0.0.1', port, path: route, ca, rejectUnauthorized: true, method: options.method || 'GET', headers: options.headers || {} }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.once('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('Synthetic TLS request timed out')));
    req.end(body);
  });
}

test('HTTPS verifies its certificate, protects the session cookie, and transfers intact data', { skip: !opensslAvailable && 'OpenSSL is required to generate an ephemeral test certificate' }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mckl-tls-'));
  const key = path.join(dir, 'fixture.key');
  const cert = path.join(dir, 'fixture.pem');
  const generated = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { encoding: 'utf8' });
  assert.equal(generated.status, 0, 'OpenSSL must generate a fresh certificate');
  const app = createApp({ host: '127.0.0.1', port: 0, shareDir: path.join(dir, 'data'), shareCode: '123456', deviceName: 'Synthetic HTTPS host', tlsKeyFile: key, tlsCertFile: cert, logger: { log() {}, warn() {} } });
  await app.start();
  t.after(async () => { await app.stop(); await rm(dir, { recursive: true, force: true }); });
  const port = app.server.address().port;
  const ca = await readFile(cert);
  const config = await request(port, ca, '/api/config');
  assert.equal(config.status, 200);
  assert.equal(JSON.parse(config.body).secure, true);
  await assert.rejects(request(port, undefined, '/api/health'), 'an untrusted certificate must not be silently accepted');
  const auth = await request(port, ca, '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: '123456' }) });
  assert.equal(auth.status, 200);
  const setCookie = auth.headers['set-cookie'][0];
  assert.match(setCookie, /; Secure(?:;|$)/);
  assert.match(setCookie, /; HttpOnly(?:;|$)/);
  const cookie = setCookie.split(';')[0];
  const payload = Buffer.from('synthetic TLS payload');
  const upload = await request(port, ca, '/api/upload', { method: 'POST', headers: { cookie, 'content-length': payload.length, 'x-file-size': payload.length, 'x-file-name': 'secure.txt', 'x-file-sha256': crypto.createHash('sha256').update(payload).digest('hex') }, body: payload });
  assert.equal(upload.status, 201);
  const file = JSON.parse(upload.body);
  const download = await request(port, ca, `/api/files/${file.id}/download`, { headers: { cookie } });
  assert.equal(download.status, 200);
  assert.deepEqual(download.body, payload);
});

test('partial TLS configuration fails before opening a listener', () => {
  assert.throws(() => createApp({ tlsKeyFile: 'synthetic-only.key', tlsCertFile: '' }), /configured together/);
});
