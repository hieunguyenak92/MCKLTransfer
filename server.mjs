import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createFileStore } from './lib/file-store.mjs';
import { createSessions } from './lib/sessions.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const VERSION = '0.2.0-alpha.2';
const MAX_MESSAGES = 200;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_SSE_BUFFER = 64 * 1024;
const error = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });

function numberOption(value, fallback, min = 0) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) throw new Error(`Invalid numeric configuration (minimum ${min}).`);
  return parsed;
}

function networkScope(address) {
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)) return 'lan';
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address) || address.startsWith('fd7a:115c:a1e0:')) return 'overlay';
  return 'other';
}

function networkAddresses(port, protocol = 'http:') {
  const found = new Map();
  for (const [interfaceName, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.internal || String(entry.family) !== 'IPv4' && String(entry.family) !== 'IPv6' || entry.address.startsWith('fe80:')) continue;
      const address = entry.address;
      found.set(address, { address, family: String(entry.family), interface: interfaceName, scope: networkScope(address), url: `${protocol}//${address.includes(':') ? `[${address}]` : address}:${port}` });
    }
  }
  const order = { lan: 0, overlay: 1, other: 2 };
  return [...found.values()].sort((a, b) => order[a.scope] - order[b.scope]);
}

function sendJson(res, status, payload, headers = {}) {
  if (res.destroyed || res.writableEnded) return;
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

async function readJson(req, limit = 32 * 1024) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw error(415, 'JSON_REQUIRED', 'Content-Type must be application/json.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw error(413, 'REQUEST_TOO_LARGE', 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { throw error(400, 'INVALID_JSON', 'Request must be a JSON object.'); }
}

function contentDisposition(name) {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function downloadRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !size || !match[1] && !match[2]) throw error(416, 'RANGE_NOT_SATISFIABLE', 'Invalid download range.');
  let start;
  let end = size - 1;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) throw error(416, 'RANGE_NOT_SATISFIABLE', 'Invalid download range.');
    start = Math.max(0, size - suffix);
  } else {
    start = Number(match[1]);
    if (match[2]) end = Number(match[2]);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw error(416, 'RANGE_NOT_SATISFIABLE', 'Invalid download range.');
  return { start, end: Math.min(end, size - 1) };
}

function createApp(options = {}) {
  const port = numberOption(options.port ?? process.env.PORT, 8787);
  if (port > 65535) throw new Error('PORT must be between 0 and 65535.');
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  const shareDir = path.resolve(options.shareDir ?? process.env.SHARE_DIR ?? path.join(ROOT, 'shared'));
  const shareCode = String(options.shareCode ?? process.env.SHARE_CODE ?? process.env.LAN_SHARE_CODE ?? crypto.randomInt(100000, 1000000));
  const adminCode = String(options.adminCode ?? process.env.ADMIN_CODE ?? crypto.randomBytes(32).toString('base64url'));
  if (!/^\d{6}$/.test(shareCode)) throw new Error('SHARE_CODE must contain exactly six digits.');
  if (adminCode.length < 24 || adminCode === shareCode) throw new Error('ADMIN_CODE must contain at least 24 characters.');
  const now = options.now ?? Date.now;
  const log = options.logger ?? console;
  const deviceName = String(options.deviceName ?? process.env.DEVICE_NAME ?? os.hostname()).slice(0, 128);
  const maxFileSize = numberOption(options.maxFileSize ?? process.env.MAX_FILE_SIZE, 20 * 1024 ** 3);
  const maxTotalSize = numberOption(options.maxTotalSize ?? process.env.MAX_TOTAL_SIZE, 100 * 1024 ** 3);
  const chunkSize = numberOption(options.chunkSize ?? process.env.CHUNK_SIZE, 4 * 1024 ** 2, 1);
  if (chunkSize > 16 * 1024 ** 2) throw new Error('CHUNK_SIZE must not exceed 16 MiB.');
  const maxConcurrentUploads = numberOption(options.maxConcurrentUploads ?? process.env.MAX_CONCURRENT_UPLOADS, 4, 1);
  const sessionTtlMs = numberOption(options.sessionTtlMs ?? process.env.SESSION_TTL_MS, 12 * 60 * 60 * 1000, 1);
  const maxDevices = numberOption(options.maxDevices ?? process.env.MAX_DEVICES, 128, 1);
  const tlsKeyFile = options.tlsKeyFile ?? process.env.TLS_KEY_FILE;
  const tlsCertFile = options.tlsCertFile ?? process.env.TLS_CERT_FILE;
  if (Boolean(tlsKeyFile) !== Boolean(tlsCertFile)) throw new Error('TLS_KEY_FILE and TLS_CERT_FILE must be configured together.');
  const publicUrl = options.publicUrl ?? process.env.PUBLIC_URL;
  const canonicalUrl = publicUrl ? new URL(publicUrl) : null;
  if (canonicalUrl && (!['http:', 'https:'].includes(canonicalUrl.protocol) || canonicalUrl.username || canonicalUrl.password || canonicalUrl.pathname !== '/' || canonicalUrl.search || canonicalUrl.hash)) throw new Error('PUBLIC_URL must be an HTTP(S) origin.');
  const protocol = tlsKeyFile ? 'https:' : 'http:';
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', os.hostname().toLowerCase(), ...networkAddresses(port).map(entry => entry.address.includes(':') ? `[${entry.address}]` : entry.address)]);
  if (host !== '0.0.0.0' && host !== '::') allowedHosts.add(host.includes(':') ? `[${host}]` : host.toLowerCase());
  if (canonicalUrl) allowedHosts.add(canonicalUrl.hostname.toLowerCase());
  const extraHosts = options.allowedHosts ?? process.env.ALLOWED_HOSTS?.split(',') ?? [];
  for (const hostname of extraHosts) {
    const value = String(hostname).trim().toLowerCase();
    if (!value || /[\s\/*@?#]/.test(value)) throw new Error('ALLOWED_HOSTS must contain explicit hostnames or IP addresses.');
    allowedHosts.add(value);
  }

  const sseClients = new Map();
  const attempts = new Map();
  const chatAttempts = new Map();
  const messages = [];
  let server;
  let sweepTimer;
  let stopping = false;

  function closeEvents(tokenHash) {
    for (const [res, client] of sseClients) if (client.tokenHash === tokenHash) res.end();
  }

  const sessions = createSessions({ shareDir, shareCode, adminCode, sessionTtlMs, maxDevices, now, onRevoke: closeEvents });
  const store = createFileStore({
    shareDir, maxFileSize, maxTotalSize, maxConcurrentUploads, chunkSize, now,
    uploadTtlMs: numberOption(options.uploadTtlMs ?? process.env.UPLOAD_TTL_MS, 24 * 60 * 60 * 1000, 1),
    maxPendingUploads: numberOption(options.maxPendingUploads ?? process.env.MAX_PENDING_UPLOADS, 128, 1),
    minFreeSpace: numberOption(options.minFreeSpace ?? process.env.MIN_FREE_SPACE, 128 * 1024 ** 2),
  });

  function publicFile(file, session) {
    const { id, name, size, mime, hash, uploadedAt, ownerId } = file;
    return { id, name, size, mime, hash, uploadedAt, ownerId, canDelete: session.role === 'admin' || ownerId === session.clientId };
  }

  function broadcast(event) {
    const body = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const [res, client] of sseClients) {
      if (client.expires <= now()) { res.end(); continue; }
      if (res.destroyed || res.writableLength > MAX_SSE_BUFFER) { res.destroy(); continue; }
      try { if (!res.write(body)) res.destroy(); } catch { res.destroy(); }
    }
  }

  function rateLimit(map, key, maximum, maxKeys = 2048) {
    const time = now();
    for (const [entry, record] of map) if (record.resetAt <= time) map.delete(entry);
    if (!map.has(key) && map.size >= maxKeys) return false;
    const record = map.get(key) || { count: 0, resetAt: time + 60_000 };
    record.count += 1;
    map.set(key, record);
    return record.count <= maximum;
  }

  function requestOrigin(req) {
    if (typeof req.headers.host !== 'string') throw error(400, 'HOST_REQUIRED', 'Host is required.');
    let address;
    try { address = new URL(`${req.socket.encrypted ? 'https:' : 'http:'}//${req.headers.host}`); } catch { throw error(400, 'INVALID_HOST', 'Invalid Host.'); }
    if (address.username || address.password || address.pathname !== '/' || address.search || address.hash || !allowedHosts.has(address.hostname.toLowerCase())) throw error(403, 'HOST_NOT_ALLOWED', 'Host is not allowed.');
    if (req.headers.origin) {
      let origin;
      try { origin = new URL(req.headers.origin).origin; } catch { throw error(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed.'); }
      if (origin !== address.origin && origin !== canonicalUrl?.origin) throw error(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed.');
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') throw error(403, 'ORIGIN_NOT_ALLOWED', 'Cross-site requests are not allowed.');
    return address;
  }

  function cookie(req, value, ttl) {
    const secure = req.socket.encrypted || canonicalUrl?.protocol === 'https:';
    return `mckl_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(0, Math.floor(ttl / 1000))}${secure ? '; Secure' : ''}`;
  }

  function requireSession(req) {
    const session = sessions.get(req);
    if (!session) throw error(401, 'AUTH_REQUIRED', 'Enter the access code shown on the host device.');
    return session;
  }

  function openEvents(req, res, session) {
    if (sseClients.size >= 128 || [...sseClients.values()].filter(client => client.tokenHash === session.tokenHash).length >= 4) throw error(429, 'EVENT_LIMIT_REACHED', 'Too many event connections.');
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('event: ready\ndata: {"type":"ready"}\n\n');
    const client = { tokenHash: session.tokenHash, expires: session.expires };
    sseClients.set(res, client);
    let expiry;
    function expire() {
      const remaining = session.expires - now();
      if (remaining <= 0) res.end();
      else { expiry = setTimeout(expire, Math.min(remaining, 2_147_483_647)); expiry.unref(); }
    }
    expire();
    const heartbeat = setInterval(() => {
      if (!sessions.get(req)) return res.end();
      try { if (res.writableLength > MAX_SSE_BUFFER || !res.write(': ping\n\n')) res.destroy(); } catch { res.destroy(); }
    }, 25_000);
    heartbeat.unref();
    res.once('close', () => { clearTimeout(expiry); clearInterval(heartbeat); sseClients.delete(res); });
  }

  async function download(req, res, id) {
    const { handle, stat, file } = await store.open(id);
    let transferred = false;
    try {
      const etag = `"${file.hash}"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-store' }); res.end(); return; }
      let range;
      try { range = downloadRange(!req.headers['if-range'] || req.headers['if-range'] === etag ? req.headers.range : '', stat.size); }
      catch (failure) { return sendJson(res, failure.statusCode, { error: failure.code, message: failure.message }, { 'Content-Range': `bytes */${stat.size}` }); }
      const start = range?.start ?? 0;
      const end = range?.end ?? Math.max(0, stat.size - 1);
      const headers = {
        'Content-Type': file.mime || 'application/octet-stream', 'Content-Length': stat.size ? end - start + 1 : 0,
        'Content-Disposition': contentDisposition(file.name), 'Cache-Control': 'no-store', ETag: etag,
        'Accept-Ranges': 'bytes', 'Last-Modified': stat.mtime.toUTCString(),
      };
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      res.writeHead(range ? 206 : 200, headers);
      if (req.method === 'HEAD' || !stat.size) { res.end(); return; }
      const stream = handle.createReadStream({ start, end, highWaterMark: 1024 * 1024, autoClose: true });
      stream.on('error', () => res.destroy());
      res.once('close', () => stream.destroy());
      transferred = true;
      stream.pipe(res);
    } finally { if (!transferred) await handle.close(); }
  }

  async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; img-src 'self' data:");
    const origin = requestOrigin(req);
    let url;
    let pathname;
    try { url = new URL(req.url, origin); pathname = decodeURIComponent(url.pathname); } catch { throw error(400, 'INVALID_URL', 'Invalid request URL.'); }
    if (stopping) throw error(503, 'STOPPING', 'The host is shutting down.');

    if (pathname === '/api/health' && req.method === 'GET') return sendJson(res, 200, { ok: true });
    if (pathname === '/api/config' && req.method === 'GET') {
      const session = sessions.get(req);
      const payload = { version: VERSION, maxFileSize, chunkSize, maxConcurrentUploads, secure: Boolean(req.socket.encrypted || canonicalUrl?.protocol === 'https:') };
      if (session) Object.assign(payload, {
        deviceName, addresses: networkAddresses(server.address().port, protocol), clientId: session.clientId, role: session.role,
        permissions: { deleteOwn: true, deleteAll: session.role === 'admin', manageDevices: session.role === 'admin' }, storage: store.usage(),
      });
      return sendJson(res, 200, payload);
    }
    if (pathname === '/api/auth' && req.method === 'POST') {
      const address = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      if (!rateLimit(attempts, address, 12) || !rateLimit(attempts, '*global*', 120)) return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'Too many attempts. Try again in a minute.' }, { 'Retry-After': '60' });
      const auth = await sessions.authenticate(await readJson(req), req);
      const { token, ...payload } = auth;
      return sendJson(res, 200, { ok: true, ...payload }, { 'Set-Cookie': cookie(req, encodeURIComponent(token), auth.expiresIn) });
    }
    if (pathname.startsWith('/api/')) {
      const session = requireSession(req);
      if (pathname === '/api/logout' && req.method === 'POST') {
        try { await sessions.revoke(session.tokenHash); }
        finally { res.setHeader('Set-Cookie', cookie(req, '', 0)); }
        return sendJson(res, 200, { ok: true });
      }
      if (pathname === '/api/devices' && req.method === 'GET') {
        if (session.role !== 'admin') throw error(403, 'FORBIDDEN', 'Host administrator access is required.');
        return sendJson(res, 200, { devices: sessions.list() });
      }
      const deviceAction = /^\/api\/devices\/([a-f0-9]{16})$/.exec(pathname);
      if (deviceAction && req.method === 'DELETE') {
        if (session.role !== 'admin') throw error(403, 'FORBIDDEN', 'Host administrator access is required.');
        await sessions.revokeDevice(deviceAction[1]);
        return sendJson(res, 200, { ok: true });
      }
      if (pathname === '/api/files' && req.method === 'GET') return sendJson(res, 200, { files: store.list().map(file => publicFile(file, session)) });
      if (pathname === '/api/messages' && req.method === 'GET') return sendJson(res, 200, { messages, clientId: session.clientId });
      if (pathname === '/api/messages' && req.method === 'POST') {
        if (!rateLimit(chatAttempts, session.clientId, 60)) throw error(429, 'RATE_LIMITED', 'Too many messages. Try again in a minute.');
        const body = await readJson(req, 16 * 1024);
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text) throw error(400, 'MESSAGE_EMPTY', 'Message cannot be empty.');
        if (Array.from(text).length > MAX_MESSAGE_LENGTH) throw error(413, 'MESSAGE_TOO_LONG', 'Message is too long.');
        const message = { id: crypto.randomBytes(12).toString('hex'), text, senderId: session.clientId, sentAt: new Date(now()).toISOString() };
        messages.push(message);
        if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);
        broadcast({ type: 'chat', message });
        return sendJson(res, 201, message);
      }
      if (pathname === '/api/events' && req.method === 'GET') return openEvents(req, res, session);
      if (pathname === '/api/upload' && req.method === 'POST') {
        if (!req.headers['x-file-name']) throw error(400, 'FILE_NAME_REQUIRED', 'A filename is required.');
        let name;
        try { name = decodeURIComponent(String(req.headers['x-file-name'])); } catch { throw error(400, 'INVALID_FILE_NAME', 'Invalid filename encoding.'); }
        const sizeHeader = req.headers['x-file-size'] ?? req.headers['content-length'];
        const expectedSize = sizeHeader === undefined ? undefined : Number(sizeHeader);
        if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 0)) throw error(400, 'INVALID_SIZE', 'Invalid file size.');
        const file = await store.upload(req, { ownerId: session.clientId, name, mime: String(req.headers['x-file-type'] || 'application/octet-stream').slice(0, 160), expectedSize, expectedHash: req.headers['x-file-sha256'] });
        broadcast({ type: 'files', action: 'added' });
        return sendJson(res, 201, publicFile(file, session));
      }
      if (pathname === '/api/uploads' && req.method === 'POST') {
        const created = await store.begin(await readJson(req), session.clientId);
        return sendJson(res, 201, created, { Location: `/api/uploads/${created.id}` });
      }
      const transfer = /^\/api\/uploads\/([a-f0-9]{24})(\/complete)?$/.exec(pathname);
      if (transfer) {
        const id = transfer[1];
        if (!transfer[2] && req.method === 'HEAD') {
          const upload = await store.head(id, session.clientId);
          res.writeHead(200, { 'Upload-Offset': String(upload.offset), 'Upload-Length': String(upload.size), 'Upload-Expires': new Date(upload.expiresAt).toUTCString(), 'Cache-Control': 'no-store' });
          return res.end();
        }
        if (!transfer[2] && req.method === 'PATCH') {
          const offsetText = req.headers['upload-offset'];
          if (typeof offsetText !== 'string' || !/^\d+$/.test(offsetText) || !Number.isSafeInteger(Number(offsetText))) throw error(400, 'INVALID_OFFSET', 'Upload-Offset must be a nonnegative integer.');
          const updated = await store.append(id, session.clientId, req, { offset: Number(offsetText), checksum: req.headers['x-chunk-sha256'] });
          res.writeHead(204, { 'Upload-Offset': String(updated.offset), 'Cache-Control': 'no-store' });
          return res.end();
        }
        if (!transfer[2] && req.method === 'DELETE') { await store.cancel(id, session.clientId); return sendJson(res, 200, { ok: true }); }
        if (transfer[2] && req.method === 'POST') {
          const file = await store.complete(id, session.clientId);
          broadcast({ type: 'files', action: 'added' });
          return sendJson(res, 201, publicFile(file, session));
        }
      }
      const fileRoute = /^\/api\/files\/([a-f0-9]{24})(\/download)?$/.exec(pathname);
      if (fileRoute?.[2] && ['GET', 'HEAD'].includes(req.method)) return download(req, res, fileRoute[1]);
      if (fileRoute && !fileRoute[2] && req.method === 'DELETE') {
        const file = store.files.get(fileRoute[1]);
        if (!file) throw error(404, 'NOT_FOUND', 'File not found.');
        if (session.role !== 'admin' && file.ownerId !== session.clientId) throw error(403, 'FORBIDDEN', 'Only the sender or host administrator may delete this file.');
        await store.remove(file.id);
        broadcast({ type: 'files', action: 'removed' });
        return sendJson(res, 200, { ok: true });
      }
      throw error(404, 'NOT_FOUND', 'Not found.');
    }

    if (!['GET', 'HEAD'].includes(req.method)) throw error(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    const filePath = path.resolve(PUBLIC_DIR, relative);
    if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) || relative.split('/').some(part => part.startsWith('.'))) throw error(404, 'NOT_FOUND', 'Not found.');
    let file;
    try {
      file = await fsp.open(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const stat = await file.stat();
      if (!stat.isFile()) throw error(404, 'NOT_FOUND', 'Not found.');
      const ext = path.extname(filePath).toLowerCase();
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/manifest+json', '.svg': 'image/svg+xml' };
      const headers = { 'Content-Type': types[ext] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-cache' };
      if (relative === 'sw.js') headers['Service-Worker-Allowed'] = '/';
      res.writeHead(200, headers);
      if (req.method === 'HEAD') { await file.close(); return res.end(); }
      const stream = file.createReadStream({ autoClose: true });
      stream.on('error', () => res.destroy());
      res.once('close', () => stream.destroy());
      stream.pipe(res);
    } catch (failure) {
      await file?.close().catch(() => {});
      if (failure.code === 'ENOENT' || failure.code === 'ELOOP') throw error(404, 'NOT_FOUND', 'Not found.');
      throw failure;
    }
  }

  async function start() {
    if (server) throw new Error('Application has already started.');
    await store.init();
    await sessions.init();
    const listener = (req, res) => {
      handle(req, res).catch(failure => {
        if (res.destroyed || res.writableEnded) return;
        if (res.headersSent) return res.destroy();
        const status = failure.statusCode || (failure.code === 'ENOSPC' ? 507 : 500);
        sendJson(res, status, { error: failure.statusCode ? failure.code || 'REQUEST_FAILED' : 'INTERNAL_ERROR', message: failure.statusCode ? failure.message : 'The host could not complete this request.' });
      });
    };
    server = tlsKeyFile ? https.createServer({ key: await fsp.readFile(tlsKeyFile), cert: await fsp.readFile(tlsCertFile), minVersion: 'TLSv1.2' }, listener) : http.createServer(listener);
    server.requestTimeout = numberOption(options.requestTimeoutMs ?? process.env.REQUEST_TIMEOUT_MS, 30 * 60 * 1000, 1);
    server.headersTimeout = Math.min(server.requestTimeout, 30_000);
    server.setTimeout(60_000, socket => socket.destroy());
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    sweepTimer = setInterval(() => { sessions.sweep(); }, 30_000);
    sweepTimer.unref();
    const actualPort = server.address().port;
    log.log(`MCKL Transfer ${VERSION} running on ${protocol}//localhost:${actualPort}`);
    log.log(`Access code: ${shareCode}`);
    log.log(`Host admin code: ${adminCode}`);
    for (const entry of networkAddresses(actualPort, protocol)) log.log(`${entry.scope === 'lan' ? 'LAN' : entry.scope === 'overlay' ? 'Overlay' : 'Other network'}: ${entry.url}`);
    log.log(`Shared folder: ${shareDir}`);
    if (!tlsKeyFile && canonicalUrl?.protocol !== 'https:') log.warn('HTTP is not encrypted. Use only on a trusted network; configure HTTPS before using an untrusted network.');
    return { server, port: actualPort, shareCode, adminCode, shareDir };
  }

  async function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(sweepTimer);
    for (const res of sseClients.keys()) res.destroy();
    if (server?.listening) {
      const closed = new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
      await closed;
    }
    await store.stop();
    await sessions.stop();
  }

  return { start, stop, get server() { return server; }, files: store.files, shareCode, adminCode, shareDir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const app = createApp();
  app.start().catch(failure => { console.error(failure.message); process.exitCode = 1; });
  process.on('SIGINT', () => app.stop().finally(() => process.exit(0)));
  process.on('SIGTERM', () => app.stop().finally(() => process.exit(0)));
}

export { createApp };
