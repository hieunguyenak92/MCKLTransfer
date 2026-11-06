import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { acquireStorageLock, syncDirectory } from './storage-lock.mjs';

const MANIFEST = '.mckl-manifest.json';
const UPLOADS = '.mckl-uploads.json';
const OBJECTS = '.mckl-objects';
const NAME_BYTES = 180;
const ID_PATTERN = /^[a-f0-9]{24}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const BUFFER_SIZE = 1024 * 1024;
const CLIENT_ID_PATTERN = /^[a-f0-9]{32}$/;
const MAX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const LEASE_MS = 30_000;

function failure(statusCode, code, message = code) {
  return Object.assign(new Error(message), { statusCode, code });
}

function integer(value, fallback, minimum = 0) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError('Storage limits must be safe integers');
  return value;
}

function fitBytes(value, maximum) {
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const length = Buffer.byteLength(character);
    if (bytes + length > maximum) break;
    result += character;
    bytes += length;
  }
  return result;
}

function fileName(value, now) {
  if (typeof value !== 'string' || !value.trim()) throw failure(400, 'INVALID_FILE_NAME');
  const normalized = value.normalize('NFKC').toWellFormed();
  // Check before flattening paths as well as after sanitizing the display name.
  if (normalized.split(/[\\/]/).some(part => /^\.mckl-/i.test(part.trim()))) throw failure(400, 'INVALID_FILE_NAME');
  let name = normalized.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  if (!name || /^\.+$/.test(name)) name = `file-${now()}`;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) name = `_${name}`;
  name = fitBytes(name, NAME_BYTES).replace(/[. ]+$/, '');
  if (/^\.mckl-/i.test(name)) throw failure(400, 'INVALID_FILE_NAME');
  return name || `file-${now()}`;
}

function duplicateName(base, sequence) {
  if (sequence === 1) return base;
  const suffix = ` (${sequence})`;
  const available = NAME_BYTES - Buffer.byteLength(suffix);
  const extension = fitBytes(path.extname(base), Math.min(80, available - 1));
  const stem = base.slice(0, base.length - path.extname(base).length);
  return `${fitBytes(stem, available - Buffer.byteLength(extension)) || '_'}${suffix}${extension}`;
}

function mimeType(value) {
  const mime = String(value || 'application/octet-stream');
  return mime.length <= 160 && /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(mime) ? mime : 'application/octet-stream';
}

function owner(value) {
  if (typeof value !== 'string' || !value || value.length > 128) throw failure(400, 'INVALID_OWNER');
  return value;
}

function digest(value, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw failure(400, 'CHECKSUM_REQUIRED');
    return null;
  }
  if (typeof value !== 'string' || !HASH_PATTERN.test(value.toLowerCase())) throw failure(400, 'INVALID_CHECKSUM');
  return value.toLowerCase();
}

function sharingMetadata(metadata = {}) {
  const roomId = metadata.roomId ?? 'shared';
  if (typeof roomId !== 'string' || !/^(?:shared|inbox|[a-f0-9]{24})$/.test(roomId)) throw failure(400, 'INVALID_ROOM');
  const recipientId = metadata.recipientId ?? null;
  if (recipientId !== null && (typeof recipientId !== 'string' || !/^[a-f0-9]{16}$/.test(recipientId))) throw failure(400, 'INVALID_RECIPIENT');
  const relativePath = metadata.relativePath ?? null;
  if (relativePath !== null) {
    if (typeof relativePath !== 'string' || !relativePath || relativePath !== relativePath.normalize('NFC').toWellFormed() || Buffer.byteLength(relativePath) > 1024) throw failure(400, 'INVALID_RELATIVE_PATH');
    const parts = relativePath.split('/');
    if (parts.length > 32 || parts.some(part => !part || part === '.' || part === '..' || /[\\:*?"<>|\u0000-\u001f\u007f]/.test(part) || /[. ]$/.test(part) || /^\.mckl-/i.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || Buffer.byteLength(part) > 180)) throw failure(400, 'INVALID_RELATIVE_PATH');
  }
  return { roomId, recipientId, relativePath };
}

function retention(value = 0) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_RETENTION_MS) throw failure(400, 'INVALID_RETENTION');
  return value;
}

function uploadClient(value) {
  if (value !== undefined && value !== null && (typeof value !== 'string' || !CLIENT_ID_PATTERN.test(value))) throw failure(400, 'INVALID_UPLOAD_CLIENT');
  return value ?? null;
}

function permission({ signal, authorize, resource } = {}, current = resource) {
  signal?.throwIfAborted();
  // Authorization receives the current persisted scope, never request-body scope.
  // Pass a copy so a policy check cannot accidentally mutate storage metadata.
  if (authorize && authorize(current ? { ...current } : undefined) === false) throw failure(403, 'AUTH_REVOKED');
}

async function regularFile(filename, writable = false) {
  let handle;
  try {
    const before = await fsp.lstat(filename);
    if (!before.isFile() || before.isSymbolicLink()) throw failure(404, 'NOT_FOUND');
    const flags = (writable ? fs.constants.O_RDWR : fs.constants.O_RDONLY) | (fs.constants.O_NOFOLLOW ?? 0);
    handle = await fsp.open(filename, flags);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino) throw failure(404, 'NOT_FOUND');
    return { handle, stat };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error.statusCode) throw error;
    if (['ENOENT', 'ELOOP', 'ENOTDIR'].includes(error.code)) throw failure(404, 'NOT_FOUND');
    throw error;
  }
}

export function createFileStore(options = {}) {
  if (!options.shareDir) throw new TypeError('shareDir is required');
  const shareDir = path.resolve(options.shareDir);
  const objectDir = path.join(shareDir, OBJECTS);
  const manifestPath = path.join(shareDir, MANIFEST);
  const uploadPath = path.join(shareDir, UPLOADS);
  const now = options.now ?? Date.now;
  const maxFileSize = integer(options.maxFileSize, 20 * 1024 ** 3);
  const maxTotalSize = integer(options.maxTotalSize, 100 * 1024 ** 3);
  const maxConcurrentUploads = integer(options.maxConcurrentUploads, 4, 1);
  const chunkSize = integer(options.chunkSize, 4 * 1024 ** 2, 1);
  const uploadTtlMs = integer(options.uploadTtlMs, 24 * 60 * 60 * 1000, 1);
  const maxPendingUploads = integer(options.maxPendingUploads, 128, 1);
  const minFreeSpace = integer(options.minFreeSpace, 128 * 1024 ** 2);
  const maxFiles = integer(options.maxFiles, 10_000);
  const maxOwnerFiles = integer(options.maxOwnerFiles, 1000);
  const maxOwnerBytes = integer(options.maxOwnerBytes, 20 * 1024 ** 3);
  const maxOwnerPendingUploads = integer(options.maxOwnerPendingUploads, 16);
  const files = new Map();
  const uploads = new Map();
  const transient = new Map();
  const deletions = new Map();
  const busy = new Set();
  const activeControllers = new Set();
  const operations = new Set();
  let queue = Promise.resolve();
  let activeWrites = 0;
  let initialized = false;
  let stopping = false;
  let expiryTimer;
  let releaseLock;
  let initializing;

  function transaction(action) {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  }

  function ensureRunning() {
    if (!initialized || stopping) throw failure(503, 'STORE_UNAVAILABLE');
  }

  function tracked(operation) {
    operations.add(operation);
    operation.then(() => operations.delete(operation), () => operations.delete(operation));
    return operation;
  }

  function payloadPath(id) { return path.join(objectDir, `${id}.bin`); }
  function partPath(id) { return path.join(objectDir, `${id}.part`); }
  function trashPath(id) { return path.join(objectDir, `${id}.trash`); }
  function indexedFile(file) {
    const { id, name, size, mime, hash, uploadedAt, ownerId, storage, roomId, recipientId, relativePath, expiresAt } = file;
    return { id, name, size, mime, hash, uploadedAt, ownerId, storage, roomId, recipientId, relativePath, expiresAt };
  }
  function indexedUpload(upload) {
    const { id, name, size, mime, sha256, ownerId, offset, expiresAt, kind, roomId, recipientId, relativePath, retentionMs, clientId, leaseExpiresAt } = upload;
    return { id, name, size, mime, sha256, ownerId, offset, expiresAt, kind, roomId, recipientId, relativePath, retentionMs, clientId, leaseExpiresAt };
  }

  async function atomicJson(filename, data, context = {}) {
    const temp = `${filename}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    let handle;
    try {
      handle = await fsp.open(temp, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(data, null, 2));
      await handle.sync();
      await handle.close();
      handle = undefined;
      permission(context);
      await fsp.rename(temp, filename);
      try { await syncDirectory(path.dirname(filename)); }
      catch (error) {
        // The rename is already authoritative. Stop accepting work rather than
        // rolling its payload back and leaving a manifest that points nowhere.
        stopping = true;
        error.metadataCommitted = true;
        throw error;
      }
    } finally {
      await handle?.close().catch(() => {});
      await fsp.rm(temp, { force: true }).catch(() => {});
    }
  }

  function saveFiles(change = {}, context = {}) {
    const snapshot = [...files.values()].filter(file => file.id !== change.remove);
    if (change.add) snapshot.push(change.add);
    return atomicJson(manifestPath, snapshot.map(indexedFile), context);
  }
  function saveUploads(updated, context = {}) {
    return atomicJson(uploadPath, [
      ...uploads.values(), ...transient.values(),
    ].map(upload => indexedUpload(updated?.id === upload.id ? updated : upload)).concat([...deletions.keys()].map(id => ({ id, kind: 'delete' }))), context);
  }

  async function loadJson(filename) {
    try {
      const { handle } = await regularFile(filename);
      try {
        const stat = await handle.stat();
        if (stat.size > 32 * 1024 ** 2) throw failure(500, 'INVALID_STORAGE_METADATA');
        const value = JSON.parse(await handle.readFile('utf8'));
        if (!Array.isArray(value)) throw failure(500, 'INVALID_STORAGE_METADATA');
        return value;
      } finally { await handle.close(); }
    } catch (error) {
      if (error.statusCode === 404) {
        const stat = await fsp.lstat(filename).catch(() => null);
        if (stat) throw failure(500, 'INVALID_STORAGE_METADATA');
        return [];
      }
      throw error;
    }
  }

  function usage() {
    const usedBytes = [...files.values()].reduce((sum, file) => sum + file.size, 0);
    const pending = [...uploads.values(), ...transient.values()];
    const reservedBytes = pending.reduce((sum, upload) => sum + upload.size, 0);
    return { usedBytes, reservedBytes, fileCount: files.size, maxFiles, maxOwnerFiles, maxOwnerBytes, maxOwnerPendingUploads, maxTotalSize, availableBytes: Math.max(0, maxTotalSize - usedBytes - reservedBytes), pendingUploads: pending.length, activeUploads: activeWrites, maxFileSize, maxConcurrentUploads, chunkSize };
  }

  async function freeSpaceNeeded(bytes) {
    const stat = await fsp.statfs(shareDir, { bigint: true });
    const remainingReservations = [...uploads.values(), ...transient.values()].reduce((sum, upload) => sum + Math.max(0, upload.size - upload.offset), 0);
    if (stat.bavail * stat.bsize < BigInt(remainingReservations) + BigInt(bytes) + BigInt(minFreeSpace)) throw failure(507, 'INSUFFICIENT_STORAGE');
  }

  async function checkReservation(size, ownerId) {
    const current = usage();
    const pending = [...uploads.values(), ...transient.values()];
    const ownedPending = pending.filter(item => item.ownerId === ownerId);
    const owned = [...files.values(), ...pending].filter(item => item.ownerId === ownerId);
    if (files.size + pending.length >= maxFiles) throw failure(429, 'FILE_COUNT_LIMIT');
    if (owned.length >= maxOwnerFiles) throw failure(429, 'OWNER_FILE_LIMIT');
    if (ownedPending.length >= maxOwnerPendingUploads) throw failure(429, 'OWNER_PENDING_LIMIT');
    if (owned.reduce((sum, item) => sum + item.size, 0) + size > maxOwnerBytes) throw failure(507, 'OWNER_STORAGE_QUOTA_EXCEEDED');
    if (size > maxFileSize) throw failure(413, 'FILE_TOO_LARGE');
    if (current.pendingUploads >= maxPendingUploads) throw failure(429, 'PENDING_UPLOAD_LIMIT');
    if (current.usedBytes + current.reservedBytes + size > maxTotalSize) throw failure(507, 'STORAGE_QUOTA_EXCEEDED');
    await freeSpaceNeeded(size);
  }

  async function nameAvailable(name) {
    const lower = name.toLowerCase();
    for (const item of [...files.values(), ...uploads.values(), ...transient.values()]) {
      if (item.name.toLowerCase() === lower) return false;
    }
    try { await fsp.lstat(path.join(shareDir, name)); return false; }
    catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  }

  async function reserveName(base) {
    for (let sequence = 1; sequence <= 10000; sequence++) {
      const candidate = duplicateName(base, sequence);
      if (await nameAvailable(candidate)) return candidate;
    }
    throw failure(409, 'NAME_RESERVATION_EXHAUSTED');
  }

  async function identifier() {
    for (let attempt = 0; attempt < 10; attempt++) {
      const id = crypto.randomBytes(12).toString('hex');
      if (files.has(id) || uploads.has(id) || transient.has(id)) continue;
      const present = await Promise.all([payloadPath(id), partPath(id)].map(filename => fsp.lstat(filename).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })));
      if (present.every(value => !value)) return id;
    }
    throw failure(500, 'ID_ALLOCATION_FAILED');
  }

  async function cleanExpired() {
    return transaction(async () => {
      const expired = [...uploads.values()].filter(upload => upload.expiresAt <= now() && !busy.has(upload.id));
      if (!expired.length) return;
      // Keep the journal until the owned part is gone, so a crash cannot orphan it.
      for (const upload of expired) await fsp.rm(partPath(upload.id), { force: true });
      for (const upload of expired) uploads.delete(upload.id);
      await saveUploads();
    });
  }

  async function init() {
    if (initialized) return;
    if (initializing) return initializing;
    initializing = initialize().finally(() => { initializing = null; });
    return initializing;
  }

  async function initialize() {
    files.clear();
    uploads.clear();
    transient.clear();
    deletions.clear();
    await fsp.mkdir(shareDir, { recursive: true, mode: 0o700 });
    releaseLock = await acquireStorageLock(shareDir);
    try {
      await fsp.mkdir(objectDir, { recursive: true, mode: 0o700 });
      const objectStat = await fsp.lstat(objectDir);
      if (!objectStat.isDirectory() || objectStat.isSymbolicLink()) throw failure(500, 'INVALID_STORAGE_DIRECTORY');
      const manifestItems = await loadJson(manifestPath);
      const pendingItems = await loadJson(uploadPath);
      const committed = new Map(manifestItems.filter(item => item && ID_PATTERN.test(item.id)).map(item => [item.id, item]));
      let uploadsChanged = false;
      // A deletion journal is written before moving a payload. Restore it if its
      // manifest removal never committed; otherwise finish removing its tombstone.
      for (const item of pendingItems) {
        if (!item || !ID_PATTERN.test(item.id) || item.kind !== 'delete') continue;
        const previous = committed.get(item.id);
        const tombstone = trashPath(item.id);
        const exists = await fsp.lstat(tombstone).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
        if (exists && previous) {
          const name = fileName(previous.name, now);
          if (name !== previous.name) throw failure(500, 'INVALID_STORAGE_METADATA');
          const destination = previous.storage === 'object' ? payloadPath(item.id) : path.join(shareDir, name);
          const occupied = await fsp.lstat(destination).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
          if (occupied) throw failure(500, 'STORAGE_RECOVERY_CONFLICT');
          await fsp.rename(tombstone, destination);
        } else if (exists) await fsp.rm(tombstone, { force: true });
        uploadsChanged = true;
      }
      for (const item of manifestItems) {
        if (!item || !ID_PATTERN.test(item.id) || typeof item.name !== 'string') continue;
        let name;
        try { name = fileName(item.name, now); } catch { continue; }
        if (name !== item.name || files.has(item.id)) continue;
        const storage = item.storage === 'object' ? 'object' : 'legacy';
        // Object records always carry a committed length. Older legacy records
        // may omit it, but a known length must never be replaced by changed bytes.
        const hasDeclaredSize = item.size !== undefined;
        if (storage === 'object' && !hasDeclaredSize) continue;
        if (hasDeclaredSize && (!Number.isSafeInteger(item.size) || item.size < 0)) continue;
        const filename = storage === 'object' ? payloadPath(item.id) : path.join(shareDir, name);
        try {
          const { handle, stat } = await regularFile(filename);
          await handle.close();
          if (hasDeclaredSize && stat.size !== item.size) continue;
          files.set(item.id, { id: item.id, name, size: stat.size, mime: mimeType(item.mime), hash: typeof item.hash === 'string' && HASH_PATTERN.test(item.hash) ? item.hash : null, uploadedAt: typeof item.uploadedAt === 'string' && Number.isFinite(Date.parse(item.uploadedAt)) ? item.uploadedAt : stat.mtime.toISOString(), ownerId: typeof item.ownerId === 'string' && item.ownerId.length <= 128 ? item.ownerId : null, ...sharingMetadata(item), expiresAt: item.expiresAt == null ? null : integer(item.expiresAt, 0), storage, path: filename });
        } catch (error) { if (error.statusCode !== 404) throw error; }
      }
      for (const item of pendingItems) {
        if (!item || !ID_PATTERN.test(item.id) || uploads.has(item.id)) continue;
        if (item.kind === 'delete') continue;
        if (item.kind === 'stream') {
          if (!committed.has(item.id)) {
            await fsp.rm(payloadPath(item.id), { force: true });
            await fsp.rm(partPath(item.id), { force: true });
          } else if (files.has(item.id)) await fsp.rm(partPath(item.id), { force: true });
          uploadsChanged = true;
          continue;
        }
        let valid = false;
        try {
          sharingMetadata(item); retention(item.retentionMs); uploadClient(item.clientId);
          if (item.leaseExpiresAt !== undefined && (!Number.isSafeInteger(item.leaseExpiresAt) || item.leaseExpiresAt < 0)) throw failure(500, 'INVALID_STORAGE_METADATA');
          valid = typeof item.name === 'string' && fileName(item.name, now) === item.name && typeof item.ownerId === 'string' && item.ownerId.length > 0 && item.ownerId.length <= 128 && Number.isSafeInteger(item.size) && item.size >= 0 && item.size <= maxFileSize && Number.isSafeInteger(item.offset) && item.offset >= 0 && item.offset <= item.size && Number.isSafeInteger(item.expiresAt) && HASH_PATTERN.test(item.sha256);
        } catch { /* invalid metadata does not confer filesystem access */ }
        if (!committed.has(item.id)) {
          // A crash may have published an exclusive object before the manifest.
          // Only this indexed upload ID authorizes cleanup of that unpublished object.
          await fsp.rm(payloadPath(item.id), { force: true });
        }
        if (!valid || files.has(item.id) || item.expiresAt <= now()) {
          uploadsChanged = true;
          await fsp.rm(partPath(item.id), { force: true }).catch(() => {});
          continue;
        }
        try {
          const { handle, stat } = await regularFile(partPath(item.id), true);
          try {
            if (stat.size < item.offset) throw failure(404, 'INCOMPLETE_UPLOAD');
            if (stat.size > item.offset) await handle.truncate(item.offset);
          } finally { await handle.close(); }
          uploads.set(item.id, { id: item.id, name: item.name, size: item.size, mime: mimeType(item.mime), sha256: item.sha256, ownerId: item.ownerId, offset: item.offset, expiresAt: item.expiresAt, ...sharingMetadata(item), retentionMs: retention(item.retentionMs), clientId: uploadClient(item.clientId), leaseExpiresAt: item.leaseExpiresAt ?? 0 });
        } catch (error) {
          if (error.statusCode !== 404) throw error;
          uploadsChanged = true;
          await fsp.rm(partPath(item.id), { force: true }).catch(() => {});
        }
      }
      if (uploadsChanged) await saveUploads();
      initialized = true;
      stopping = false;
      expiryTimer = setInterval(() => { sweep().catch(() => {}); }, Math.max(1000, Math.min(30_000, uploadTtlMs)));
      expiryTimer.unref();
    } catch (error) {
      await releaseLock?.().catch(() => {});
      releaseLock = null;
      throw error;
    }
  }

  function active(action, context = {}) {
    if (activeWrites >= maxConcurrentUploads) throw failure(429, 'UPLOAD_LIMIT_REACHED');
    activeWrites++;
    const controller = new AbortController();
    activeControllers.add(controller);
    const signal = context.signal ? AbortSignal.any([controller.signal, context.signal]) : controller.signal;
    return Promise.resolve().then(() => { permission({ ...context, signal }); return action(signal); }).finally(() => { activeWrites--; activeControllers.delete(controller); });
  }

  function session(id, ownerId) {
    const upload = uploads.get(id);
    if (!upload || upload.ownerId !== ownerId || upload.expiresAt <= now()) throw failure(404, 'UPLOAD_NOT_FOUND');
    return upload;
  }

  function requireClaim(upload, clientId) {
    uploadClient(clientId);
    if (upload.clientId && upload.clientId !== clientId) throw failure(409, 'UPLOAD_CLAIMED');
    if (upload.clientId) upload.leaseExpiresAt = now() + LEASE_MS;
  }

  async function locked(id, ownerId, action, context = {}) {
    ensureRunning();
    const upload = session(id, ownerId);
    context = { ...context, resource: upload };
    permission(context);
    if (busy.has(id)) throw failure(409, 'UPLOAD_BUSY');
    requireClaim(upload, context.clientId);
    busy.add(id);
    try { return await action(upload, context); }
    finally {
      if (upload.clientId && !context.release) upload.leaseExpiresAt = now() + LEASE_MS;
      busy.delete(id);
    }
  }

  function publicUpload(upload) {
    return { id: upload.id, state: 'pending', offset: upload.offset, size: upload.size, chunkSize, expiresAt: upload.expiresAt, leaseExpiresAt: upload.clientId ? upload.leaseExpiresAt : null, ...sharingMetadata(upload) };
  }

  function committed(id, ownerId) {
    const file = files.get(id);
    return file && file.ownerId === ownerId && (!file.expiresAt || file.expiresAt > now()) ? file : null;
  }

  async function claim(id, ownerId, clientId) {
    ensureRunning();
    if (!uploadClient(clientId)) throw failure(400, 'INVALID_UPLOAD_CLIENT');
    if (committed(id, ownerId)) return head(id, ownerId);
    return transaction(async () => {
      ensureRunning();
      const upload = session(id, ownerId);
      if (busy.has(id)) throw failure(409, 'UPLOAD_BUSY');
      if (upload.clientId && upload.clientId !== clientId && upload.leaseExpiresAt > now()) throw failure(409, 'UPLOAD_CLAIMED');
      busy.add(id);
      try {
        const next = { ...upload, clientId, leaseExpiresAt: now() + LEASE_MS };
        await saveUploads(next);
        Object.assign(upload, next);
        return publicUpload(upload);
      } finally { busy.delete(id); }
    });
  }

  async function releaseClaim(id, ownerId, clientId) {
    ensureRunning();
    return locked(id, ownerId, upload => transaction(async () => {
      const next = { ...upload, leaseExpiresAt: 0 };
      await saveUploads(next);
      upload.leaseExpiresAt = 0;
      return { ok: true };
    }), { clientId, release: true });
  }

  async function begin(metadata, ownerId, context = {}) {
    ensureRunning();
    if (!metadata || typeof metadata !== 'object') throw failure(400, 'INVALID_UPLOAD_METADATA');
    const base = fileName(metadata.name, now);
    const size = metadata.size;
    if (!Number.isSafeInteger(size) || size < 0) throw failure(400, 'INVALID_FILE_SIZE');
    const sha256 = digest(metadata.sha256, true);
    const ownerIdValue = owner(ownerId);
    const scope = sharingMetadata(metadata);
    const retentionMs = retention(metadata.retentionMs);
    const clientId = uploadClient(metadata.clientId);
    context = { ...context, resource: { ...scope, name: base, size, ownerId: ownerIdValue } };
    permission(context);
    await sweep();
    return transaction(async () => {
      ensureRunning();
      permission(context);
      await checkReservation(size, ownerIdValue);
      const upload = { id: await identifier(), name: await reserveName(base), size, mime: mimeType(metadata.mime), sha256, ownerId: ownerIdValue, offset: 0, expiresAt: now() + uploadTtlMs, kind: 'resumable', ...scope, retentionMs, clientId, leaseExpiresAt: clientId ? now() + LEASE_MS : 0 };
      context = { ...context, resource: upload };
      permission(context);
      const handle = await fsp.open(partPath(upload.id), 'wx', 0o600);
      await handle.close();
      uploads.set(upload.id, upload);
      try { await saveUploads(undefined, context); }
      catch (error) {
        if (!error.metadataCommitted) { uploads.delete(upload.id); await fsp.rm(partPath(upload.id), { force: true }).catch(() => {}); }
        throw error;
      }
      return publicUpload(upload);
    });
  }

  async function head(id, ownerId) {
    ensureRunning();
    const file = committed(id, ownerId);
    if (file) return { id, state: 'complete', offset: file.size, size: file.size, expiresAt: null, file: indexedFile(file) };
    return publicUpload(session(id, ownerId));
  }

  async function writeBody(req, filename, { signal, offset, limit, expectedHash = null, progress }) {
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    let handle;
    let output;
    try {
      if (offset === undefined) {
        output = fs.createWriteStream(filename, { flags: 'wx', mode: 0o600, highWaterMark: BUFFER_SIZE });
      } else {
        const opened = await regularFile(filename, true);
        handle = opened.handle;
        if (opened.stat.size !== offset) throw failure(409, 'OFFSET_MISMATCH');
        output = handle.createWriteStream({ start: offset, autoClose: false, highWaterMark: BUFFER_SIZE });
      }
      const measure = new Transform({ transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > limit) return callback(failure(413, 'CHUNK_TOO_LARGE'));
        hash.update(chunk);
        progress?.(bytes);
        callback(null, chunk);
      } });
      await pipeline(req, measure, output, { signal });
      const result = hash.digest('hex');
      if (expectedHash && result !== expectedHash) throw failure(422, 'CHECKSUM_MISMATCH');
      if (handle) await handle.sync();
      else {
        const completed = await regularFile(filename, true);
        try { await completed.handle.sync(); }
        finally { await completed.handle.close(); }
      }
      return { bytes, hash: result };
    } finally {
      output?.destroy();
      await handle?.close().catch(() => {});
    }
  }

  async function rollbackPart(id, offset) {
    const { handle } = await regularFile(partPath(id), true);
    try { await handle.truncate(offset); await handle.sync(); }
    finally { await handle.close(); }
  }

  function append(id, ownerId, req, context = {}) {
    const { offset, checksum } = context;
    return tracked(locked(id, ownerId, (upload, scopedContext) => active(async signal => {
      if (!Number.isSafeInteger(offset) || offset !== upload.offset) throw failure(409, 'OFFSET_MISMATCH');
      const expectedHash = digest(checksum, true);
      const limit = Math.min(chunkSize, upload.size - upload.offset);
      const oldOffset = upload.offset;
      let written;
      try {
        await freeSpaceNeeded(0);
        written = await writeBody(req, partPath(id), { signal, offset: oldOffset, limit, expectedHash });
        await transaction(async () => {
          permission({ ...scopedContext, signal });
          const nextOffset = oldOffset + written.bytes;
          await saveUploads({ ...upload, offset: nextOffset }, { ...scopedContext, signal });
          upload.offset = nextOffset;
        });
      } catch (error) {
        if (error.metadataCommitted && written) upload.offset = oldOffset + written.bytes;
        else await rollbackPart(id, oldOffset).catch(() => {});
        throw error;
      }
      return { offset: upload.offset };
    }, scopedContext), context));
  }

  async function fileHash(filename, expectedSize, signal) {
    const { handle, stat } = await regularFile(filename);
    if (stat.size !== expectedSize) { await handle.close(); throw failure(409, 'CONTENT_LENGTH_MISMATCH'); }
    const hash = crypto.createHash('sha256');
    const stream = handle.createReadStream({ autoClose: false, highWaterMark: BUFFER_SIZE });
    try {
      for await (const chunk of stream) {
        signal?.throwIfAborted();
        hash.update(chunk);
      }
      return hash.digest('hex');
    }
    finally { stream.destroy(); await handle.close(); }
  }

  async function commit(upload, hash, size, resumable, context = {}) {
    context = { ...context, resource: upload };
    return transaction(async () => {
      permission(context);
      const destination = payloadPath(upload.id);
      // The usual path is a constant-time hard link. Filesystems without hard
      // links use an exclusive reflink/copy while retaining the same safety rule.
      try { await fsp.link(partPath(upload.id), destination); }
      catch (error) {
        if (!['EPERM', 'ENOSYS', 'EOPNOTSUPP', 'ENOTSUP', 'EXDEV'].includes(error.code)) throw error;
        try {
          await fsp.copyFile(partPath(upload.id), destination, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
          const copied = await regularFile(destination, true);
          try { await copied.handle.sync(); } finally { await copied.handle.close(); }
        } catch (copyError) {
          if (copyError.code !== 'EEXIST') await fsp.rm(destination, { force: true }).catch(() => {});
          throw copyError;
        }
      }
      const file = { id: upload.id, name: upload.name, size, mime: upload.mime, hash, uploadedAt: new Date(now()).toISOString(), ownerId: upload.ownerId, ...sharingMetadata(upload), expiresAt: upload.retentionMs ? now() + upload.retentionMs : null, storage: 'object', path: destination };
      try { permission(context, file); await syncDirectory(objectDir); await saveFiles({ add: file }, { ...context, resource: file }); }
      catch (error) {
        if (error.metadataCommitted) files.set(file.id, file);
        else await fsp.rm(destination, { force: true }).catch(() => {});
        throw error;
      }
      files.set(file.id, file);
      await fsp.rm(partPath(upload.id), { force: true }).catch(() => {});
      if (resumable) {
        uploads.delete(upload.id);
        // The file manifest is authoritative. A stale upload record is discarded on init.
        await saveUploads().catch(() => {});
      } else {
        transient.delete(upload.id);
        await saveUploads().catch(() => {});
      }
      return { ...file };
    });
  }

  function complete(id, ownerId, context = {}) {
    ensureRunning();
    const file = committed(id, ownerId);
    if (file) { permission(context, file); return Promise.resolve({ ...file }); }
    return tracked(locked(id, ownerId, (upload, scopedContext) => active(async signal => {
      if (upload.offset !== upload.size) throw failure(409, 'UPLOAD_INCOMPLETE');
      const hash = await fileHash(partPath(id), upload.size, signal);
      if (hash !== upload.sha256) throw failure(422, 'CHECKSUM_MISMATCH');
      return commit(upload, hash, upload.size, true, { ...scopedContext, signal });
    }, scopedContext), context));
  }

  async function cancel(id, ownerId, context = {}) {
    return locked(id, ownerId, (upload, scopedContext) => transaction(async () => {
      ensureRunning();
      permission(scopedContext);
      await fsp.rm(partPath(id), { force: true });
      uploads.delete(id);
      // Removal is already complete. A stale record is harmless and init drops it.
      await saveUploads().catch(() => {});
      return { ok: true };
    }), context);
  }

  function upload(req, metadata, context = {}) {
    ensureRunning();
    if (!metadata || typeof metadata !== 'object') throw failure(400, 'INVALID_UPLOAD_METADATA');
    const ownerId = owner(metadata.ownerId);
    const base = fileName(metadata.name, now);
    const expectedHash = digest(metadata.expectedHash);
    const expectedSize = metadata.expectedSize;
    const scope = sharingMetadata(metadata);
    const retentionMs = retention(metadata.retentionMs);
    context = { ...context, resource: { ...scope, name: base, size: expectedSize, ownerId } };
    if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 0)) throw failure(400, 'INVALID_FILE_SIZE');
    return tracked(active(async signal => {
      await sweep();
      const reservation = await transaction(async () => {
        permission({ ...context, signal });
        await checkReservation(expectedSize ?? maxFileSize, ownerId);
        const item = { id: await identifier(), name: await reserveName(base), size: expectedSize ?? maxFileSize, offset: 0, mime: mimeType(metadata.mime), ownerId, kind: 'stream', ...scope, retentionMs };
        context = { ...context, resource: item };
        permission({ ...context, signal });
        transient.set(item.id, item);
        try { await saveUploads(undefined, { ...context, signal }); }
        catch (error) { transient.delete(item.id); throw error; }
        return item;
      });
      try {
        const result = await writeBody(req, partPath(reservation.id), { signal, limit: reservation.size, expectedHash, progress: bytes => { reservation.offset = bytes; } });
        if (expectedSize !== undefined && result.bytes !== expectedSize) throw failure(400, 'CONTENT_LENGTH_MISMATCH');
        return await commit(reservation, result.hash, result.bytes, false, { ...context, signal });
      } finally {
        if (!stopping || !files.has(reservation.id)) {
          await fsp.rm(partPath(reservation.id), { force: true }).catch(() => {});
          if (transient.delete(reservation.id)) await transaction(() => saveUploads()).catch(() => {});
        }
      }
    }, context));
  }

  async function open(id) {
    ensureRunning();
    const file = files.get(id);
    if (!file || file.expiresAt && file.expiresAt <= now()) throw failure(404, 'NOT_FOUND');
    const { handle, stat } = await regularFile(file.path);
    if (stat.size !== file.size) { await handle.close(); throw failure(404, 'NOT_FOUND'); }
    return { handle, stat, file: { ...file } };
  }

  async function remove(id) {
    ensureRunning();
    return transaction(async () => {
      ensureRunning();
      const file = files.get(id);
      if (!file) throw failure(404, 'NOT_FOUND');
      const { handle } = await regularFile(file.path);
      await handle.close();
      const tombstone = trashPath(id);
      deletions.set(id, file);
      try { await saveUploads(); }
      catch (error) { deletions.delete(id); throw error; }
      try { await fsp.rename(file.path, tombstone); }
      catch (error) { deletions.delete(id); await saveUploads().catch(() => {}); throw error; }
      try { await saveFiles({ remove: id }); }
      catch (error) {
        if (error.metadataCommitted) { files.delete(id); throw error; }
        await fsp.rename(tombstone, file.path);
        deletions.delete(id);
        await saveUploads().catch(() => {});
        throw error;
      }
      files.delete(id);
      await fsp.rm(tombstone, { force: true });
      deletions.delete(id);
      await saveUploads().catch(() => {});
      return { ok: true };
    });
  }

  async function sweep() {
    ensureRunning();
    await cleanExpired();
    for (const file of [...files.values()]) {
      if (file.expiresAt && file.expiresAt <= now()) {
        try { await remove(file.id); }
        catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
      }
    }
  }

  async function stop() {
    if (initializing) await initializing.catch(() => {});
    stopping = true;
    clearInterval(expiryTimer);
    for (const controller of activeControllers) controller.abort();
    await Promise.allSettled([...operations]);
    await queue;
    initialized = false;
    await releaseLock?.();
    releaseLock = null;
  }

  return { init, stop, files, list: () => [...files.values()].filter(file => !file.expiresAt || file.expiresAt > now()).map(file => ({ ...file })), usage, upload, begin, head, append, complete, cancel, claim, releaseClaim, sweep, remove, open };
}
