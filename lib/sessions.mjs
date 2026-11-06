import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const failure = (statusCode, code, message = code) => Object.assign(new Error(message), { statusCode, code });
const TOKEN_HASH = /^[a-f0-9]{64}$/;
const DEVICE_ID = /^[a-f0-9]{16}$/;

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function tokenFrom(req) {
  for (const item of String(req?.headers?.cookie || '').split(';')) {
    const [name, ...value] = item.trim().split('=');
    if (name !== 'mckl_session') continue;
    try { return decodeURIComponent(value.join('=')); } catch { return ''; }
  }
  return String(req?.headers?.authorization || '').match(/^Bearer ([A-Za-z0-9_-]{43})$/i)?.[1] || '';
}

async function syncDirectory(directory) {
  let handle;
  try { handle = await fsp.open(directory, fs.constants.O_RDONLY); await handle.sync(); }
  catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR', ...(process.platform === 'win32' ? ['EPERM', 'EACCES'] : [])].includes(error.code)) throw error; }
  finally { await handle?.close(); }
}

async function readState(filename, limit = 1024 * 1024) {
  let handle;
  try {
    handle = await fsp.open(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error('Session state must be a small regular file.');
    return JSON.parse(await handle.readFile('utf8'));
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  finally { await handle?.close(); }
}

export function createSessions({ shareDir, shareCode, adminCode, sessionTtlMs = 12 * 60 * 60 * 1000, rememberTtlMs = 30 * 24 * 60 * 60 * 1000, maxDevices = 128, requireApproval = false, now = Date.now, onRevoke = () => {} }) {
  const devices = new Map();
  const revoked = new Map();
  const filename = path.join(shareDir, '.mckl-devices.json');
  const journal = path.join(shareDir, '.mckl-revocations.json');
  const marker = path.join(shareDir, '.mckl-sessions-active.json');
  let writes = Promise.resolve();
  let degraded = false;
  let initialized = false;
  let stopped = false;

  function serialized(operation) {
    const result = writes.then(operation);
    writes = result.catch(() => {});
    return result;
  }

  async function atomicJson(destination, data) {
    const temp = `${destination}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    let handle;
    try {
      handle = await fsp.open(temp, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(data));
      await handle.sync();
      await handle.close(); handle = undefined;
      await fsp.rename(temp, destination);
      await syncDirectory(shareDir);
    } finally { await handle?.close().catch(() => {}); await fsp.rm(temp, { force: true }).catch(() => {}); }
  }

  function persist() { return atomicJson(filename, { version: 2, devices: [...devices.values()] }); }
  function persistRevocations() { return atomicJson(journal, { version: 1, revoked: [...revoked].map(([tokenHash, expires]) => ({ tokenHash, expires })) }); }
  function ensureHealthy() {
    if (!initialized || stopped || degraded) throw failure(503, 'SESSION_STORAGE_UNAVAILABLE', 'Session storage is unavailable. Restart after repairing storage; devices may need pairing again.');
  }
  function invalidateAll() {
    degraded = true;
    for (const [key, device] of devices) onRevoke(key, publicDevice(device));
    devices.clear();
  }

  async function init() {
    if (initialized) return;
    await fsp.mkdir(shareDir, { recursive: true, mode: 0o700 });
    const active = await readState(marker);
    const saved = await readState(filename);
    const previousRevocations = await readState(journal);
    if (saved && (![1, 2].includes(saved.version) || !Array.isArray(saved.devices) || saved.devices.length > maxDevices)) throw new Error('Invalid device state.');
    if (previousRevocations && (previousRevocations.version !== 1 || !Array.isArray(previousRevocations.revoked))) throw new Error('Invalid revocation state.');
    for (const value of previousRevocations?.revoked || []) {
      if (!TOKEN_HASH.test(value?.tokenHash) || !Number.isSafeInteger(value.expires)) throw new Error('Invalid revocation state.');
      if (value.expires > now()) revoked.set(value.tokenHash, value.expires);
    }
    if (!active) for (const value of saved?.devices || []) {
      if (!TOKEN_HASH.test(value?.tokenHash) || !DEVICE_ID.test(value.id) || !['peer', 'admin'].includes(value.role) || !Number.isSafeInteger(value.expires) || value.expires <= now() || revoked.has(value.tokenHash)) continue;
      const approved = value.role === 'admin' || (saved.version === 1 ? true : value.approved === true);
      devices.set(value.tokenHash, {
        tokenHash: value.tokenHash, id: value.id, role: value.role, expires: value.expires, approved,
        name: String(value.name || 'Device').slice(0, 64), createdAt: String(value.createdAt || ''), lastSeenAt: String(value.lastSeenAt || ''),
      });
    }
    // An unclean shutdown cannot certify that a failed revoke reached disk.
    // Re-pairing after a crash is conservative; clean restart retains identities.
    if (active) await persist();
    await atomicJson(marker, { version: 1, active: true });
    initialized = true;
  }

  function get(req) {
    if (!initialized || stopped || degraded) return null;
    const token = tokenFrom(req);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const tokenHash = hashToken(token);
    const device = devices.get(tokenHash);
    if (!device || device.expires <= now() || revoked.has(tokenHash)) {
      if (device) { devices.delete(tokenHash); onRevoke(tokenHash, publicDevice(device)); }
      return null;
    }
    device.lastSeenAt = new Date(now()).toISOString();
    return { ...device, clientId: device.id, status: device.approved ? 'approved' : 'pending' };
  }

  function publicDevice(device) {
    const { id, name, role, createdAt, lastSeenAt, expires, approved } = device;
    return { id, name, role, approved, status: approved ? 'approved' : 'pending', createdAt, lastSeenAt, expiresAt: new Date(expires).toISOString() };
  }
  function list() { return [...devices.values()].filter(device => device.expires > now() && !revoked.has(device.tokenHash)).map(publicDevice); }
  function getById(id) { return list().find(device => device.id === id) || null; }

  async function tombstone(records) {
    for (const device of records) {
      revoked.set(device.tokenHash, device.expires);
      devices.delete(device.tokenHash);
      onRevoke(device.tokenHash, publicDevice(device));
    }
    try { await persistRevocations(); }
    catch (error) { invalidateAll(); throw failure(503, 'SESSION_STORAGE_UNAVAILABLE', 'Revocation could not be saved. Access is disabled until storage is repaired and the host restarts.'); }
  }

  async function issue(body, req, role) {
    return serialized(async () => {
      ensureHealthy(); sweep();
      const existing = get(req);
      if (!existing && devices.size >= maxDevices) throw failure(429, 'DEVICE_LIMIT_REACHED', 'The host has reached its device limit.');
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = hashToken(token);
      const ttl = body.rememberDevice === true ? rememberTtlMs : sessionTtlMs;
      const timestamp = new Date(now()).toISOString();
      const approved = role === 'admin' || existing?.approved === true || !requireApproval;
      const device = {
        tokenHash, id: existing?.id || crypto.randomBytes(8).toString('hex'), role, approved,
        name: String(body.deviceName || existing?.name || 'Device').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64) || 'Device',
        expires: now() + ttl, createdAt: existing?.createdAt || timestamp, lastSeenAt: timestamp,
      };
      if (existing) await tombstone([existing]);
      devices.set(tokenHash, device);
      try { await persist(); }
      catch (error) { devices.delete(tokenHash); throw error; }
      // The device snapshot no longer contains tombstoned tokens. Compact only
      // after its durable commit; a failed compaction is safe and retried later.
      revoked.clear(); await persistRevocations().catch(() => {});
      return { token, expiresIn: ttl, clientId: device.id, role, name: device.name, approved, status: approved ? 'approved' : 'pending' };
    });
  }

  async function authenticate(body, req) {
    const code = String(body.code || '').trim();
    const role = safeEqual(code, adminCode) ? 'admin' : /^\d{6}$/.test(code) && safeEqual(code, shareCode) ? 'peer' : null;
    if (!role) throw failure(401, 'INVALID_CODE', 'That code is not correct.');
    return issue(body, req, role);
  }
  // Internal capability: callers must reserve a validated invite through
  // sharing.redeemInvite before calling this method. Body fields grant no roles.
  function authenticateInvite(body, req) { return issue(body, req, 'peer'); }

  async function approveDevice(id) {
    return serialized(async () => {
      ensureHealthy();
      const device = [...devices.values()].find(value => value.id === id && value.expires > now());
      if (!device) throw failure(404, 'NOT_FOUND', 'Device not found.');
      const next = { ...device, approved: true };
      try { await atomicJson(filename, { version: 2, devices: [...devices.values()].map(value => value.tokenHash === next.tokenHash ? next : value) }); } catch (error) {
        invalidateAll();
        throw failure(503, 'SESSION_STORAGE_UNAVAILABLE', 'Device approval could not be saved. Access is disabled until the host restarts.');
      }
      devices.set(next.tokenHash, next);
      return publicDevice(next);
    });
  }

  async function revoke(tokenHash) {
    return serialized(async () => {
      ensureHealthy();
      const device = devices.get(tokenHash);
      if (!device) return;
      await tombstone([device]);
      await persist();
      revoked.clear(); await persistRevocations().catch(() => {});
    });
  }

  async function revokeDevice(id) {
    return serialized(async () => {
      ensureHealthy();
      const records = [...devices.values()].filter(device => device.id === id);
      if (!records.length) throw failure(404, 'NOT_FOUND', 'Device not found.');
      await tombstone(records);
      await persist();
      revoked.clear(); await persistRevocations().catch(() => {});
    });
  }

  function sweep() {
    for (const [key, device] of devices) if (device.expires <= now()) { devices.delete(key); onRevoke(key, publicDevice(device)); }
    for (const [key, expires] of revoked) if (expires <= now()) revoked.delete(key);
  }
  async function stop() {
    if (stopped) return writes;
    stopped = true;
    await writes;
    if (initialized && !degraded) { await fsp.rm(marker, { force: true }); await syncDirectory(shareDir); }
  }

  return { init, get, getById, authenticate, authenticateInvite, approveDevice, revoke, revokeDevice, sweep, list,
    listPublic: () => list().filter(device => device.approved), health: () => ({ degraded, reason: degraded ? 'SESSION_STORAGE_UNAVAILABLE' : null }), stop };
}
