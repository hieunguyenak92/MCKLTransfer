import crypto from 'node:crypto';

const ID = /^[a-f0-9]{24}$/;
const DEVICE = /^[a-f0-9]{16}$/;
const HASH = /^[a-f0-9]{64}$/;
const TERMINAL = new Set(['completed', 'rejected', 'cancelled', 'expired', 'failed']);
const SIGNAL_TYPES = new Set(['accept', 'description', 'candidate', 'confirm', 'restart', 'error']);
const failure = (statusCode, code, message = code) => Object.assign(new Error(message), { statusCode, code });
const token = () => crypto.randomBytes(12).toString('hex');

function device(value) {
  if (typeof value !== 'string' || !DEVICE.test(value)) throw failure(400, 'INVALID_DEVICE');
  return value;
}
function sessionId(session) {
  if (!session || !['peer', 'admin'].includes(session.role) || session.approved === false) throw failure(403, 'FORBIDDEN');
  return device(session.clientId);
}
function name(value) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 180 || /[\u0000-\u001f\u007f\\/]/u.test(value)) throw failure(400, 'INVALID_FILE_NAME');
  return value.normalize('NFC').toWellFormed().trim();
}
function payload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure(400, 'INVALID_SIGNAL');
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > 80 * 1024) throw failure(413, 'SIGNAL_TOO_LARGE');
  return JSON.parse(encoded);
}
function fingerprint(sdp) {
  const values = [...String(sdp).matchAll(/^a=fingerprint:sha-256\s+((?:[0-9A-F]{2}:){31}[0-9A-F]{2})\s*$/gim)].map(match => match[1].toUpperCase());
  const unique = [...new Set(values)];
  if (unique.length !== 1) throw failure(400, 'DIRECT_FINGERPRINT_UNAVAILABLE');
  return unique[0];
}
function authenticationCode(t) {
  const fingerprints = [fingerprint(t.offer.sdp), fingerprint(t.answer.sdp)].sort();
  const transcript = JSON.stringify({ version: 1, id: t.id, attempt: t.attempt, ownerId: t.ownerId, recipientId: t.recipientId, name: t.name, size: t.size, sha256: t.sha256, fingerprints });
  const hex = crypto.createHash('sha256').update(transcript).digest('hex').toUpperCase().slice(0, 12);
  return hex.slice(0, 4) + '-' + hex.slice(4, 8) + '-' + hex.slice(8);
}
function publicTransfer(t) {
  const { id, ownerId, recipientId, name, size, sha256, mime, createdAt, expiresAt, status, updatedAt, attempt } = t;
  return { id, ownerId, recipientId, name, size, sha256, mime, createdAt, expiresAt, status, updatedAt, attempt };
}

/** Bounded signaling metadata only. File bytes stay on the negotiated data channel. */
export function createDirectBroker(options = {}) {
  const now = options.now ?? Date.now;
  const limit = (value, fallback, min = 1) => Number.isSafeInteger(value) && value >= min ? value : fallback;
  const ttlMs = limit(options.ttlMs, 30 * 60 * 1000);
  const terminalTtlMs = limit(options.terminalTtlMs, 5 * 60 * 1000);
  const maxTransfers = limit(options.maxTransfers, 128);
  const maxOwnerTransfers = limit(options.maxOwnerTransfers, 8);
  const maxFileSize = limit(options.maxFileSize, 20 * 1024 ** 3, 0);
  const maxSignals = limit(options.maxSignals, 128);
  const transfers = new Map();
  const change = options.onChange ?? (() => {});

  function notify(t, kind) { change({ type: kind, transfer: t.id, ownerId: t.ownerId, recipientId: t.recipientId }); }
  function enqueue(t, target, type, value, from = 'system') {
    const queue = t.queues.get(target);
    const item = { seq: ++t.sequence, from, type, payload: value, createdAt: new Date(now()).toISOString() };
    queue.push(item);
    while (queue.length > maxSignals) t.dropped.set(target, queue.shift().seq);
    notify(t, 'signal');
  }
  function terminal(t, status, who, reason) {
    if (TERMINAL.has(t.status)) return;
    t.status = status; t.updatedAt = now(); t.terminalAt = now();
    for (const target of [t.ownerId, t.recipientId]) enqueue(t, target, 'cancel', { reason, attempt: t.attempt }, who);
    notify(t, status);
  }
  function sweep() {
    for (const [id, t] of transfers) {
      if (!TERMINAL.has(t.status) && t.expiresAt <= now()) terminal(t, 'expired', 'system', 'expired');
      if (TERMINAL.has(t.status) && now() - t.terminalAt >= terminalTtlMs) transfers.delete(id);
    }
  }
  function ensure(value) {
    if (!ID.test(value)) throw failure(400, 'INVALID_DIRECT_ID');
    const t = transfers.get(value);
    if (!t) throw failure(404, 'DIRECT_NOT_FOUND');
    if (!TERMINAL.has(t.status) && t.expiresAt <= now()) terminal(t, 'expired', 'system', 'expired');
    return t;
  }
  function participant(t, session) {
    const who = sessionId(session);
    if (who !== t.ownerId && who !== t.recipientId) throw failure(404, 'DIRECT_NOT_FOUND');
    return who;
  }
  function create(session, body = {}) {
    sweep();
    const ownerId = sessionId(session); const recipientId = device(body.recipientId);
    if (recipientId === ownerId) throw failure(400, 'DIRECT_SELF_TARGET');
    if (transfers.size >= maxTransfers || [...transfers.values()].filter(t => !TERMINAL.has(t.status) && (t.ownerId === ownerId || t.recipientId === recipientId)).length >= maxOwnerTransfers) throw failure(429, 'DIRECT_LIMIT_REACHED');
    if (!Number.isSafeInteger(body.size) || body.size < 0 || body.size > maxFileSize) throw failure(413, 'FILE_TOO_LARGE');
    if (typeof body.sha256 !== 'string' || !HASH.test(body.sha256.toLowerCase())) throw failure(400, 'INVALID_CHECKSUM');
    const created = now();
    const t = { id: token(), ownerId, recipientId, name: name(body.name), size: body.size, sha256: body.sha256.toLowerCase(), mime: typeof body.mime === 'string' && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(body.mime) && body.mime.length <= 160 ? body.mime : 'application/octet-stream', createdAt: new Date(created).toISOString(), expiresAt: created + ttlMs, status: 'offered', updatedAt: created, attempt: 0, accepted: false, sequence: 0, queues: new Map([[ownerId, []], [recipientId, []]]), dropped: new Map(), confirms: new Set(), candidateCounts: new Map(), offer: null, answer: null };
    transfers.set(t.id, t); notify(t, 'created'); return publicTransfer(t);
  }
  function get(id, session) { const t = ensure(id); participant(t, session); return publicTransfer(t); }
  function list(session) { const who = sessionId(session); sweep(); return [...transfers.values()].filter(t => t.ownerId === who || t.recipientId === who).map(publicTransfer); }
  function signal(id, session, body = {}) {
    const t = ensure(id); const who = participant(t, session);
    if (TERMINAL.has(t.status)) throw failure(410, 'DIRECT_TERMINAL');
    const type = body.type;
    if (!SIGNAL_TYPES.has(type)) throw failure(400, 'INVALID_SIGNAL_TYPE');
    const value = payload(body.payload ?? {}); const target = who === t.ownerId ? t.recipientId : t.ownerId;
    if (type !== 'accept' && value.attempt !== t.attempt) throw failure(409, 'DIRECT_ATTEMPT_CHANGED');
    if (type === 'accept') {
      if (who !== t.recipientId) throw failure(403, 'FORBIDDEN');
      if (t.accepted) return { ok: true, attempt: t.attempt, status: t.status };
      t.accepted = true; t.status = 'accepted';
    } else if (type === 'description') {
      if (!['offer', 'answer'].includes(value.type) || typeof value.sdp !== 'string' || value.sdp.length > 64 * 1024) throw failure(400, 'INVALID_DESCRIPTION');
      fingerprint(value.sdp);
      if (value.type === 'offer') {
        if (who !== t.ownerId || t.offer) throw failure(409, 'DIRECT_DESCRIPTION_CONFLICT');
        t.offer = { type: 'offer', sdp: value.sdp }; t.status = t.accepted ? 'connecting' : 'offered';
      } else {
        if (who !== t.recipientId || !t.accepted || !t.offer || t.answer) throw failure(409, 'DIRECT_DESCRIPTION_CONFLICT');
        t.answer = { type: 'answer', sdp: value.sdp }; t.status = 'confirming';
      }
    } else if (type === 'candidate') {
      if (value.candidate !== null && (typeof value.candidate !== 'string' || value.candidate.length > 4096) || value.sdpMid !== undefined && value.sdpMid !== null && (typeof value.sdpMid !== 'string' || value.sdpMid.length > 80) || value.sdpMLineIndex !== undefined && value.sdpMLineIndex !== null && (!Number.isSafeInteger(value.sdpMLineIndex) || value.sdpMLineIndex < 0 || value.sdpMLineIndex > 16)) throw failure(400, 'INVALID_CANDIDATE');
      const count = (t.candidateCounts.get(who) || 0) + 1;
      if (count > 64) throw failure(429, 'DIRECT_CANDIDATE_LIMIT');
      t.candidateCounts.set(who, count);
    } else if (type === 'confirm') {
      if (!t.offer || !t.answer || !t.accepted) throw failure(409, 'DIRECT_NOT_READY');
      if (value.sas !== authenticationCode(t)) throw failure(422, 'DIRECT_AUTH_CODE_MISMATCH');
      t.confirms.add(who); t.status = t.confirms.size === 2 ? 'active' : 'confirming';
    } else if (type === 'restart') {
      if (!t.accepted || t.attempt >= 5) throw failure(409, 'DIRECT_RESTART_UNAVAILABLE');
      t.attempt++; t.offer = null; t.answer = null; t.confirms.clear(); t.candidateCounts.clear(); t.status = 'reconnecting';
      for (const destination of [t.ownerId, t.recipientId]) enqueue(t, destination, 'restart', { attempt: t.attempt }, who);
      return { ok: true, status: t.status, attempt: t.attempt };
    } else if (type === 'error') {
      terminal(t, 'failed', who, String(value.code || 'peer-error').slice(0, 80)); return { ok: true, status: t.status };
    }
    t.updatedAt = now(); enqueue(t, target, type, { ...value, attempt: t.attempt }, who);
    return { ok: true, status: t.status, attempt: t.attempt, seq: t.sequence };
  }
  function poll(id, session, after = 0) {
    const t = ensure(id); const who = participant(t, session);
    if (!Number.isSafeInteger(after) || after < 0) throw failure(400, 'INVALID_SEQUENCE');
    const queue = t.queues.get(who);
    return { transfer: publicTransfer(t), signals: queue.filter(item => item.seq > after), next: t.sequence, reset: after < (t.dropped.get(who) || 0) };
  }
  function cancel(id, session, reason = 'cancelled') {
    const t = ensure(id); const who = participant(t, session);
    if (reason && typeof reason === 'object') reason = reason.reason;
    terminal(t, who === t.recipientId && reason === 'rejected' ? 'rejected' : 'cancelled', who, reason === 'rejected' ? 'rejected' : 'cancelled');
    return publicTransfer(t);
  }
  function complete(id, session, receipt = {}) {
    const t = ensure(id); const who = participant(t, session);
    if (who !== t.recipientId) throw failure(403, 'FORBIDDEN');
    if (typeof receipt.sha256 !== 'string' || receipt.sha256.toLowerCase() !== t.sha256 || receipt.size !== t.size) throw failure(422, 'CHECKSUM_MISMATCH');
    if (t.status === 'completed') return publicTransfer(t);
    if (TERMINAL.has(t.status) || t.status !== 'active' || t.confirms.size !== 2) throw failure(409, 'DIRECT_NOT_ACTIVE');
    t.status = 'completed'; t.terminalAt = now(); t.updatedAt = now();
    enqueue(t, t.ownerId, 'receipt', { verified: true, saved: true, size: t.size, sha256: t.sha256, attempt: t.attempt }, who);
    notify(t, 'completed'); return publicTransfer(t);
  }
  function revoke(id) { for (const t of transfers.values()) if (t.ownerId === id || t.recipientId === id) terminal(t, 'cancelled', id, 'revoked'); }
  return { create, get, list, signal, poll, cancel, complete, revoke, sweep };
}
