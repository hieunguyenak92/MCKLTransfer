import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const failure = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function tokenFrom(req) {
  for (const item of String(req.headers.cookie || '').split(';')) {
    const [name, ...value] = item.trim().split('=');
    if (name !== 'mckl_session') continue;
    try { return decodeURIComponent(value.join('=')); } catch { return ''; }
  }
  return String(req.headers.authorization || '').match(/^Bearer ([A-Za-z0-9_-]{43})$/i)?.[1] || '';
}

export function createSessions({ shareDir, shareCode, adminCode, sessionTtlMs = 12 * 60 * 60 * 1000, rememberTtlMs = 30 * 24 * 60 * 60 * 1000, maxDevices = 128, now = Date.now, onRevoke = () => {} }) {
  const devices = new Map();
  const filename = path.join(shareDir, '.mckl-devices.json');
  let writes = Promise.resolve();

  function serialized(operation) {
    const result = writes.then(operation);
    writes = result.catch(() => {});
    return result;
  }

  async function persist() {
    const temp = `${filename}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      await fsp.writeFile(temp, JSON.stringify({ version: 1, devices: [...devices.values()] }), { mode: 0o600, flag: 'wx' });
      await fsp.rename(temp, filename);
    } finally { await fsp.rm(temp, { force: true }).catch(() => {}); }
  }

  async function init() {
    await fsp.mkdir(shareDir, { recursive: true, mode: 0o700 });
    let handle;
    try {
      handle = await fsp.open(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Device state must be a small regular file.');
      const parsed = JSON.parse(await handle.readFile('utf8'));
      if (parsed.version !== 1 || !Array.isArray(parsed.devices) || parsed.devices.length > maxDevices) throw new Error('Invalid device state.');
      for (const value of parsed.devices) {
        if (!/^[a-f0-9]{64}$/.test(value.tokenHash) || !/^[a-f0-9]{16}$/.test(value.id) || !['peer', 'admin'].includes(value.role) || !Number.isSafeInteger(value.expires) || value.expires <= now()) continue;
        devices.set(value.tokenHash, {
          tokenHash: value.tokenHash, id: value.id, role: value.role, expires: value.expires,
          name: String(value.name || 'Device').slice(0, 64), createdAt: String(value.createdAt || ''), lastSeenAt: String(value.lastSeenAt || ''),
        });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    } finally { await handle?.close(); }
  }

  function get(req) {
    const token = tokenFrom(req);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const tokenHash = hashToken(token);
    const device = devices.get(tokenHash);
    if (!device || device.expires <= now()) {
      if (device) { devices.delete(tokenHash); onRevoke(tokenHash); }
      return null;
    }
    device.lastSeenAt = new Date(now()).toISOString();
    return { ...device, clientId: device.id };
  }

  function publicDevice(device) {
    const { id, name, role, createdAt, lastSeenAt, expires } = device;
    return { id, name, role, createdAt, lastSeenAt, expiresAt: new Date(expires).toISOString() };
  }

  async function authenticate(body, req) {
    const code = String(body.code || '').trim();
    const role = safeEqual(code, adminCode) ? 'admin' : /^\d{6}$/.test(code) && safeEqual(code, shareCode) ? 'peer' : null;
    if (!role) throw failure(401, 'INVALID_CODE', 'That code is not correct.');
    return serialized(async () => {
      for (const [key, device] of devices) if (device.expires <= now()) { devices.delete(key); onRevoke(key); }
      const existing = get(req);
      if (!existing && devices.size >= maxDevices) throw failure(429, 'DEVICE_LIMIT_REACHED', 'The host has reached its device limit.');
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = hashToken(token);
      const ttl = body.rememberDevice === true ? rememberTtlMs : sessionTtlMs;
      const timestamp = new Date(now()).toISOString();
      const device = {
        tokenHash, id: existing?.id || crypto.randomBytes(8).toString('hex'), role,
        name: String(body.deviceName || existing?.name || 'Device').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64) || 'Device',
        expires: now() + ttl, createdAt: existing?.createdAt || timestamp, lastSeenAt: timestamp,
      };
      if (existing) { devices.delete(existing.tokenHash); onRevoke(existing.tokenHash); }
      devices.set(tokenHash, device);
      try { await persist(); } catch (error) {
        devices.delete(tokenHash);
        if (existing) devices.set(existing.tokenHash, existing);
        throw error;
      }
      return { token, expiresIn: ttl, clientId: device.id, role, name: device.name };
    });
  }

  async function revoke(tokenHash) {
    return serialized(async () => {
      if (!devices.delete(tokenHash)) return;
      onRevoke(tokenHash);
      await persist();
    });
  }

  async function revokeDevice(id) {
    return serialized(async () => {
      let removed = false;
      for (const [key, device] of devices) if (device.id === id) { devices.delete(key); onRevoke(key); removed = true; }
      if (!removed) throw failure(404, 'NOT_FOUND', 'Device not found.');
      await persist();
    });
  }

  function sweep() {
    for (const [key, device] of devices) if (device.expires <= now()) { devices.delete(key); onRevoke(key); }
  }

  return { init, get, authenticate, revoke, revokeDevice, sweep, list: () => [...devices.values()].filter(device => device.expires > now()).map(publicDevice), stop: () => writes };
}
