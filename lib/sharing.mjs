import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const failure = (statusCode, code, message = code) => Object.assign(new Error(message), { statusCode, code });
const DEVICE_ID = /^[a-f0-9]{16}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/;
const ROOM_ID = /^(?:shared|inbox|[a-f0-9]{24})$/;
const MAX_RETENTION = 30 * 24 * 60 * 60 * 1000;
const hashToken = value => crypto.createHash('sha256').update(value).digest('hex');
const label = (value, max = 128) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const identity = session => session?.clientId || session?.id;
const approved = session => Boolean(session && (session.role === 'admin' || session.approved === true));

async function syncDirectory(directory) {
  let handle;
  try { handle = await fsp.open(directory, fs.constants.O_RDONLY); await handle.sync(); }
  catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR', ...(process.platform === 'win32' ? ['EPERM', 'EACCES'] : [])].includes(error.code)) throw error; }
  finally { await handle?.close(); }
}

export function createSharing({ shareDir, now = Date.now, getDevice = () => null, maxRooms = 100, maxHistory = 1000, historyTtlMs = 7 * 24 * 60 * 60 * 1000, maxInvites = 100 } = {}) {
  if (!shareDir) throw new TypeError('shareDir is required');
  for (const value of [maxRooms, maxHistory, historyTtlMs, maxInvites]) if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Sharing limits must be positive integers');
  if (historyTtlMs > MAX_RETENTION) throw new TypeError('History retention must not exceed 30 days');
  const filename = path.join(shareDir, '.mckl-sharing.json');
  const rooms = new Map();
  const invites = new Map();
  let events = [];
  let writes = Promise.resolve();
  let initialized = false;
  let stopped = false;
  let degraded = false;

  function transaction(operation) {
    const result = writes.then(operation);
    writes = result.catch(() => {});
    return result;
  }
  function ensureRunning() { if (!initialized || stopped || degraded) throw failure(503, 'SHARING_UNAVAILABLE'); }
  function administrator(session) { if (!approved(session) || session.role !== 'admin') throw failure(403, 'FORBIDDEN', 'Host administrator access is required.'); }
  function publicRoom(room) { return { ...room, members: [...room.members] }; }
  function prune() {
    events = events.filter(event => event.expiresAt > now()).slice(-maxHistory);
    for (const [key, invite] of invites) if (invite.expiresAt <= now() && !invite.reserved) invites.delete(key);
  }
  async function persist(nextRooms = [...rooms.values()], nextEvents = events) {
    const temp = `${filename}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    let handle; let renamed = false;
    try {
      handle = await fsp.open(temp, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ version: 1, rooms: nextRooms, history: nextEvents }));
      await handle.sync();
      await handle.close(); handle = undefined;
      await fsp.rename(temp, filename); renamed = true;
      await syncDirectory(shareDir);
    } catch (error) {
      // A rename followed by a failed directory sync has an uncertain durable
      // outcome. Stop granting access until restart reads the authoritative file.
      if (renamed) degraded = true;
      throw error;
    } finally { await handle?.close().catch(() => {}); await fsp.rm(temp, { force: true }).catch(() => {}); }
  }
  async function init() {
    if (initialized) return;
    await fsp.mkdir(shareDir, { recursive: true, mode: 0o700 });
    let handle;
    try {
      handle = await fsp.open(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error('Sharing state must be a bounded regular file.');
      const saved = JSON.parse(await handle.readFile('utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.rooms) || !Array.isArray(saved.history) || saved.rooms.length > maxRooms || saved.history.length > maxHistory) throw new Error('Invalid sharing state.');
      for (const room of saved.rooms) {
        if (!OBJECT_ID.test(room?.id) || !DEVICE_ID.test(room.createdBy) || !Array.isArray(room.members) || room.members.length > 128 || room.members.some(id => !DEVICE_ID.test(id)) || typeof room.name !== 'string' || !room.name || room.name.length > 128 || !Number.isSafeInteger(room.createdAt)) throw new Error('Invalid room state.');
        rooms.set(room.id, { id: room.id, name: room.name, members: [...new Set(room.members)], createdBy: room.createdBy, createdAt: room.createdAt });
      }
      for (const event of saved.history) {
        if (!OBJECT_ID.test(event?.id) || !Number.isSafeInteger(event.at) || !Number.isSafeInteger(event.expiresAt) || !DEVICE_ID.test(event.ownerId) || !ROOM_ID.test(event.roomId) || (event.recipientId && !DEVICE_ID.test(event.recipientId))) throw new Error('Invalid history state.');
        events.push(normalizeEvent(event, { persisted: true }));
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    finally { await handle?.close(); }
    prune(); initialized = true;
  }
  function getRoom(id) {
    if (id === 'shared') return { id: 'shared', name: 'Shared space', members: null };
    if (id === 'inbox') return { id: 'inbox', name: 'Private inbox', members: null };
    const room = rooms.get(id);
    return room ? publicRoom(room) : null;
  }
  function member(roomId, deviceId) {
    return roomId === 'shared' || roomId === 'inbox' || rooms.get(roomId)?.members.includes(deviceId) === true;
  }
  function listRooms(session) {
    ensureRunning();
    if (!approved(session)) return [];
    return [getRoom('shared'), getRoom('inbox'), ...[...rooms.values()].filter(room => session.role === 'admin' || room.members.includes(identity(session))).map(publicRoom)];
  }
  function membersInput(values) {
    if (!Array.isArray(values) || values.length > 128 || values.some(id => !DEVICE_ID.test(id))) throw failure(400, 'INVALID_ROOM_MEMBERS');
    const unique = [...new Set(values)];
    if (unique.some(id => !getDevice(id)?.approved)) throw failure(400, 'DEVICE_NOT_APPROVED', 'Room members must be approved devices.');
    return unique;
  }
  async function createRoom(body, session) {
    return transaction(async () => {
      ensureRunning(); administrator(session);
      if (rooms.size >= maxRooms) throw failure(429, 'ROOM_LIMIT_REACHED');
      const name = label(body?.name);
      if (!name) throw failure(400, 'INVALID_ROOM_NAME');
      const room = { id: crypto.randomBytes(12).toString('hex'), name, members: membersInput(body.members || []), createdBy: identity(session), createdAt: now() };
      await persist([...rooms.values(), room]);
      rooms.set(room.id, room);
      return publicRoom(room);
    });
  }
  async function updateRoom(id, body, session) {
    return transaction(async () => {
      ensureRunning(); administrator(session);
      const previous = rooms.get(id);
      if (!previous) throw failure(404, 'ROOM_NOT_FOUND');
      const name = body.name === undefined ? previous.name : label(body.name);
      if (!name) throw failure(400, 'INVALID_ROOM_NAME');
      const room = { ...previous, name, members: body.members === undefined ? previous.members : membersInput(body.members) };
      await persist([...rooms.values()].map(value => value.id === id ? room : value));
      rooms.set(id, room);
      return publicRoom(room);
    });
  }
  function canRead(resource, session) {
    if (!initialized || stopped || degraded || !approved(session) || !resource) return false;
    if (resource.expiresAt && resource.expiresAt <= now()) return false;
    const roomId = resource.roomId || 'shared';
    if (!ROOM_ID.test(roomId)) return false;
    if (session.role === 'admin' || resource.ownerId === identity(session)) return true;
    if (!getRoom(roomId) || !member(roomId, identity(session))) return false;
    if (resource.recipientId) return resource.recipientId === identity(session);
    return roomId !== 'inbox';
  }
  function validateTarget({ roomId = 'shared', recipientId = null } = {}, session) {
    ensureRunning();
    if (!approved(session)) throw failure(403, 'DEVICE_NOT_APPROVED');
    if (!ROOM_ID.test(roomId) || !getRoom(roomId)) throw failure(404, 'ROOM_NOT_FOUND');
    if (session.role !== 'admin' && !member(roomId, identity(session))) throw failure(403, 'FORBIDDEN');
    if (roomId === 'inbox' && !recipientId) throw failure(400, 'RECIPIENT_REQUIRED');
    if (recipientId !== null && recipientId !== '') {
      if (!DEVICE_ID.test(recipientId) || !getDevice(recipientId)?.approved) throw failure(400, 'DEVICE_NOT_APPROVED');
      if (!member(roomId, recipientId)) throw failure(403, 'RECIPIENT_NOT_IN_ROOM');
    }
    return { roomId, recipientId: recipientId || null };
  }

  function createInvite({ ttlMs = 10 * 60 * 1000 } = {}) {
    ensureRunning(); prune();
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 60 * 60 * 1000) throw failure(400, 'INVALID_INVITE_EXPIRY');
    if (invites.size >= maxInvites) throw failure(429, 'INVITE_LIMIT_REACHED');
    const token = crypto.randomBytes(32).toString('base64url');
    const invite = { id: crypto.randomBytes(12).toString('hex'), createdAt: now(), expiresAt: now() + ttlMs, reserved: false };
    invites.set(hashToken(token), invite);
    return { id: invite.id, token, createdAt: invite.createdAt, expiresAt: invite.expiresAt };
  }
  async function redeemInvite(token, action) {
    ensureRunning(); prune();
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw failure(401, 'INVALID_INVITE');
    const key = hashToken(token);
    const invite = invites.get(key);
    if (!invite || invite.expiresAt <= now() || invite.reserved) throw failure(401, 'INVALID_INVITE', 'This invitation has expired or was already used.');
    if (typeof action !== 'function') throw new TypeError('Invite redemption needs a session-creation callback');
    invite.reserved = true;
    try {
      const result = await action({ id: invite.id, expiresAt: invite.expiresAt });
      invites.delete(key);
      return result;
    } catch (error) { invite.reserved = false; if (invite.expiresAt <= now()) invites.delete(key); throw error; }
  }
  function listInvites() {
    ensureRunning(); prune();
    return [...invites.values()].map(({ id, createdAt, expiresAt, reserved }) => ({ id, createdAt, expiresAt, status: reserved ? 'redeeming' : 'available' }));
  }
  function revokeInvite(id) {
    ensureRunning();
    const entry = [...invites].find(([, invite]) => invite.id === id);
    if (!entry) throw failure(404, 'INVITE_NOT_FOUND');
    if (entry[1].reserved) throw failure(409, 'INVITE_BUSY');
    invites.delete(entry[0]);
  }

  function normalizeEvent(value, { persisted = false } = {}) {
    const types = ['uploaded', 'downloaded', 'deleted', 'expired', 'received', 'verified', 'saved', 'direct'];
    if (!types.includes(value.type) || !DEVICE_ID.test(value.ownerId) || !ROOM_ID.test(value.roomId || 'shared') || (value.recipientId && !DEVICE_ID.test(value.recipientId))) throw failure(400, 'INVALID_HISTORY_EVENT');
    if (value.fileId && !OBJECT_ID.test(value.fileId)) throw failure(400, 'INVALID_HISTORY_EVENT');
    if (value.size !== undefined && (!Number.isSafeInteger(value.size) || value.size < 0)) throw failure(400, 'INVALID_HISTORY_EVENT');
    const event = { id: persisted ? value.id : crypto.randomBytes(12).toString('hex'), type: value.type,
      at: persisted ? value.at : now(), expiresAt: persisted ? value.expiresAt : now() + historyTtlMs,
      ownerId: value.ownerId, roomId: value.roomId || 'shared', recipientId: value.recipientId || null };
    if (value.fileId) event.fileId = value.fileId;
    if (value.name !== undefined) event.name = label(value.name, 180);
    if (value.size !== undefined) event.size = value.size;
    if (value.actorId && DEVICE_ID.test(value.actorId)) event.actorId = value.actorId;
    if (['hub', 'direct', 'relay'].includes(value.transport)) event.transport = value.transport;
    return event;
  }
  async function record(value) {
    return transaction(async () => {
      ensureRunning(); prune();
      const event = normalizeEvent(value);
      const existing = event.fileId && events.find(previous => previous.type === event.type && previous.fileId === event.fileId && previous.actorId === event.actorId && previous.ownerId === event.ownerId);
      if (existing) return { ...existing };
      const nextEvents = [...events, event].slice(-maxHistory);
      await persist([...rooms.values()], nextEvents);
      events = nextEvents;
      return { ...event };
    });
  }
  function history(session, { limit = 100, before } = {}) {
    ensureRunning(); prune();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw failure(400, 'INVALID_PAGE');
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 0)) throw failure(400, 'INVALID_PAGE');
    return events.filter(event => canRead(event, session) && (before === undefined || event.at < before)).slice(-limit).reverse().map(event => ({ ...event }));
  }
  async function receipt(file, session, status = 'received') {
    if (!['received', 'verified', 'saved'].includes(status)) throw failure(400, 'INVALID_RECEIPT');
    if (!canRead(file, session)) throw failure(404, 'NOT_FOUND');
    return record({ type: status, fileId: file.id, name: file.name, size: file.size, roomId: file.roomId || 'shared', recipientId: file.recipientId, ownerId: file.ownerId, actorId: identity(session), transport: 'hub' });
  }
  async function stop() { stopped = true; await writes; invites.clear(); }
  return { init, stop, createInvite, redeemInvite, listInvites, revokeInvite, createRoom, updateRoom, listRooms, getRoom, canRead, validateTarget, record, history, receipt, health: () => ({ degraded }) };
}
