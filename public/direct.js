/* Reliable direct transfer with explicit consent, transcript verification and a disk sink. */
import { Sha256 } from './hash-worker.js';

const CHUNK_SIZE = 64 * 1024;
const MAX_BUFFERED = 1024 * 1024;
const TERMINAL = new Set(['completed', 'rejected', 'cancelled', 'expired', 'failed']);
const HASH = /^[a-f0-9]{64}$/i;
const DEVICE = /^[a-f0-9]{16}$/;
const fail = (code, message = code) => Object.assign(new Error(message), { code });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function fingerprint(sdp) {
  const values = [...String(sdp).matchAll(/^a=fingerprint:sha-256\s+((?:[0-9A-F]{2}:){31}[0-9A-F]{2})\s*$/gim)].map(match => match[1].toUpperCase());
  const unique = [...new Set(values)];
  if (unique.length !== 1) throw fail('DIRECT_FINGERPRINT_UNAVAILABLE');
  return unique[0];
}
export async function authenticationCode(transferId, localSdp, remoteSdp, transfer = {}) {
  if (!globalThis.crypto?.subtle) throw fail('DIRECT_SECURE_CONTEXT_REQUIRED');
  const fingerprints = [fingerprint(localSdp), fingerprint(remoteSdp)].sort();
  const transcript = JSON.stringify({ version: 1, id: transferId, attempt: transfer.attempt ?? 0, ownerId: transfer.ownerId, recipientId: transfer.recipientId, name: transfer.name, size: transfer.size, sha256: transfer.sha256, fingerprints });
  const bytes = new TextEncoder().encode(transcript);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = [...digest].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase().slice(0, 12);
  return hex.slice(0, 4) + '-' + hex.slice(4, 8) + '-' + hex.slice(8);
}

function snapshot(entry) {
  const { id, ownerId, recipientId, name, size, sha256, mime, createdAt, expiresAt, role, phase, loaded, sas, route, error, file, attempt, receipt } = entry;
  return { id, ownerId, recipientId, name, size, sha256, mime, createdAt, expiresAt, role, phase, status: phase, loaded: loaded || 0, transferred: loaded || 0, progress: size ? (loaded || 0) / size : phase === 'completed' ? 1 : 0, sas, route: route || 'unknown', error, file, attempt, receipt };
}
function isResponse(value) { return value && typeof value.json === 'function' && typeof value.ok === 'boolean'; }
async function defaultSink(transfer) {
  if (typeof globalThis.showSaveFilePicker !== 'function') throw fail('DIRECT_SINK_UNAVAILABLE');
  // This call must remain before any network await in accept(): browsers require
  // transient user activation, and unsupported extensions must not break saving.
  const handle = await globalThis.showSaveFilePicker({ suggestedName: transfer.name });
  return handle.createWritable();
}

/**
 * API: start/refresh/stop, offer(file,recipientId,sha256), accept(id),
 * confirm(id,sas?), reject/cancel(id), restart(id), diagnostics(id).
 * onOffer/onConfirm/onUpdate/onComplete/onFallback get a flat immutable snapshot.
 * A receive sink must support async write/close/abort; no whole-file Blob fallback.
 * Restart is for this live page only: the same receiver sink/hash and sender File
 * stay open, while a new DTLS transcript must be compared by both people.
 */
export function createDirectClient(options = {}) {
  if (!DEVICE.test(options.clientId || '')) throw fail('INVALID_DEVICE');
  const entries = new Map();
  const intervalMs = options.pollMs ?? 500;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxEntries = 32;
  let stopped = true;
  let refreshTimer;
  let refreshing;
  let generation = 0;

  async function call(path, init = {}) {
    const api = options.api;
    const value = typeof api === 'function' ? await api(path, init) : await api.request(path, init);
    if (!isResponse(value)) return value;
    const body = value.status === 204 ? null : await value.json().catch(() => ({}));
    if (!value.ok) throw Object.assign(fail(body.error || 'HTTP_' + value.status, body.message || body.error || 'HTTP ' + value.status), { status: value.status });
    return body;
  }
  function update(entry, patch = {}) {
    Object.assign(entry, patch);
    const value = snapshot(entry);
    options.onUpdate?.(value);
    return value;
  }
  function get(id) { const entry = entries.get(id); if (!entry) throw fail('DIRECT_NOT_FOUND'); return entry; }
  function signal(entry, type, payload = {}) {
    return call('/api/direct/' + entry.id + '/signals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, payload: { ...payload, attempt: entry.attempt } }) });
  }
  function closePeer(entry, reason = fail('DIRECT_CONNECTION_REPLACED')) {
    entry.peerEpoch = (entry.peerEpoch || 0) + 1;
    clearTimeout(entry.disconnectTimer);
    clearTimeout(entry.ackTimer);
    entry.pendingReply?.reject(reason); entry.pendingReply = null;
    if (entry.peer) { entry.peer.onconnectionstatechange = null; entry.peer.onicecandidate = null; entry.peer.close(); }
    entry.peer = null; entry.channel = null; entry.started = false; entry.channelOpen = false; entry.header = false; entry.resumeSent = false; entry.localConfirmed = false; entry.remoteConfirmed = false; entry.sas = null; entry.candidates = [];
  }
  async function abortSink(entry) {
    const sink = entry.sink; entry.sink = null;
    if (sink) await sink.abort?.().catch(() => {});
  }
  async function terminate(entry, phase, error) {
    if (entry.terminal) return;
    entry.terminal = true;
    closePeer(entry, error || fail('DIRECT_CANCELLED'));
    // Wait for an in-progress disk write before aborting its writable handle.
    await entry.receiveQueue.catch(() => {});
    await abortSink(entry);
    update(entry, { phase, error });
    if (phase === 'failed') options.onFallback?.(snapshot(entry));
  }
  async function failTransfer(entry, error) {
    if (entry.terminal) return;
    void signal(entry, 'error', { code: error.code || 'DIRECT_FAILED' }).catch(() => {});
    await terminate(entry, 'failed', error);
  }
  async function disconnected(entry, error) {
    if (entry.terminal) return;
    closePeer(entry, error);
    await entry.receiveQueue.catch(() => {});
    // Keep the disk stream, incremental digest and File in this live page. A
    // deliberate restart renegotiates authentication, then resumes at this offset.
    update(entry, { phase: 'disconnected', sas: null, error });
    options.onFallback?.(snapshot(entry));
  }
  function newEntry(transfer, role) {
    return { ...transfer, role, phase: role === 'receiver' ? 'offered' : 'awaiting-accept', sequence: 0, attempt: transfer.attempt ?? 0, loaded: 0, offset: 0, candidates: [], receiveQueue: Promise.resolve(), terminal: false, started: false, peerEpoch: 0, localConfirmed: false, remoteConfirmed: false, lastActivity: Date.now() };
  }
  function boundEntries() {
    if (entries.size < maxEntries) return;
    for (const [id, entry] of entries) if (entry.terminal) { entries.delete(id); if (entries.size < maxEntries) return; }
    if (entries.size >= maxEntries) throw fail('DIRECT_LIMIT_REACHED');
  }
  function createPeer(entry, receiving) {
    const peer = options.createPeer ? options.createPeer({ iceServers: options.iceServers || [] }) : new RTCPeerConnection({ iceServers: options.iceServers || [] });
    entry.peer = peer;
    const epoch = entry.peerEpoch;
    const current = () => !entry.terminal && entry.peer === peer && entry.peerEpoch === epoch;
    peer.onicecandidate = event => {
      if (!current()) return;
      const candidate = event.candidate?.toJSON ? event.candidate.toJSON() : event.candidate;
      const value = candidate ? { candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex, usernameFragment: candidate.usernameFragment } : { candidate: null };
      signal(entry, 'candidate', value).catch(error => { if (current() && error.status !== 409) void failTransfer(entry, error); });
    };
    peer.onconnectionstatechange = () => {
      if (!current()) return;
      if (peer.connectionState === 'failed' || peer.connectionState === 'closed') { void disconnected(entry, fail('DIRECT_CONNECTION_LOST')); return; }
      if (peer.connectionState === 'disconnected') {
        clearTimeout(entry.disconnectTimer);
        entry.disconnectTimer = setTimeout(() => { if (current() && peer.connectionState === 'disconnected') void disconnected(entry, fail('DIRECT_CONNECTION_LOST')); }, 5000);
      } else if (peer.connectionState === 'connected') {
        clearTimeout(entry.disconnectTimer);
        void diagnostics(entry.id).then(value => { if (current()) update(entry, { route: value.path }); }).catch(() => {});
      }
    };
    if (receiving) peer.ondatachannel = event => {
      if (!current()) { event.channel.close(); return; }
      if (entry.channel || event.channel.label !== 'mckl-v1' || event.channel.ordered !== true || event.channel.maxPacketLifeTime != null || event.channel.maxRetransmits != null) { event.channel.close(); void failTransfer(entry, fail('DIRECT_CHANNEL_INVALID')); return; }
      bindChannel(entry, event.channel);
    };
    return peer;
  }
  function bindChannel(entry, channel) {
    entry.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = MAX_BUFFERED / 2;
    const epoch = entry.peerEpoch;
    const current = () => !entry.terminal && entry.channel === channel && entry.peerEpoch === epoch;
    channel.onopen = () => { if (current()) { entry.channelOpen = true; void maybeStart(entry).catch(error => failTransfer(entry, error)); } };
    channel.onclose = () => { if (current()) void disconnected(entry, fail('DIRECT_CHANNEL_CLOSED')); };
    channel.onerror = event => { if (current()) void disconnected(entry, event.error || fail('DIRECT_CHANNEL_ERROR')); };
    channel.onmessage = event => {
      if (!current()) return;
      const data = event.data;
      // A cooperative sender has only one chunk awaiting ACK. Reject a hostile
      // sender before an unbounded Promise/write queue can form.
      const size = typeof data === 'string' ? data.length : data.byteLength ?? data.size;
      if (!Number.isSafeInteger(size) || size > CHUNK_SIZE || entry.queuedBytes + size > CHUNK_SIZE * 2) { void failTransfer(entry, fail('DIRECT_RECEIVE_LIMIT')); return; }
      entry.queuedBytes += size;
      entry.receiveQueue = entry.receiveQueue.then(() => { if (current()) return receiveChannel(entry, data); }).finally(() => { entry.queuedBytes -= size; });
      entry.receiveQueue.catch(error => { if (current()) void failTransfer(entry, error); });
    };
  }
  async function waitBuffered(entry) {
    const channel = entry.channel;
    const start = Date.now();
    while (channel && channel.readyState === 'open' && channel.bufferedAmount > MAX_BUFFERED) {
      if (entry.terminal || entry.channel !== channel) throw fail('DIRECT_CONNECTION_LOST');
      if (Date.now() - start >= timeoutMs) throw fail('DIRECT_BACKPRESSURE_TIMEOUT');
      await sleep(10);
    }
    if (!channel || channel.readyState !== 'open') throw fail('DIRECT_CONNECTION_LOST');
  }
  function reply(entry, kind, offset) {
    if (entry.pendingReply) throw fail('DIRECT_PROTOCOL_STATE');
    let resolve; let reject;
    const promise = new Promise((ok, bad) => { resolve = ok; reject = bad; });
    entry.pendingReply = { kind, offset, resolve, reject };
    entry.ackTimer = setTimeout(() => { const pending = entry.pendingReply; entry.pendingReply = null; pending?.reject(fail('DIRECT_ACK_TIMEOUT')); }, timeoutMs);
    return promise;
  }
  function resolveReply(entry, kind, offset) {
    const pending = entry.pendingReply;
    if (!pending || pending.kind !== kind || pending.offset !== undefined && pending.offset !== offset) throw fail('DIRECT_ACK_INVALID');
    clearTimeout(entry.ackTimer); entry.pendingReply = null; pending.resolve(offset);
  }
  function sendControl(entry, value) {
    if (!entry.channel || entry.channel.readyState !== 'open') throw fail('DIRECT_CONNECTION_LOST');
    entry.channel.send(JSON.stringify(value));
  }
  async function maybeStart(entry) {
    if (entry.terminal || !entry.channelOpen || !entry.localConfirmed || !entry.remoteConfirmed) return;
    if (entry.role === 'receiver') {
      if (entry.header && !entry.resumeSent) { entry.resumeSent = true; sendControl(entry, { type: 'resume', offset: entry.offset }); }
      update(entry, { phase: 'receiving', error: null }); return;
    }
    if (entry.started) return;
    entry.started = true; entry.lastActivity = Date.now();
    update(entry, { phase: 'sending', error: null });
    const resumed = reply(entry, 'resume');
    sendControl(entry, { type: 'header', size: entry.size, sha256: entry.sha256, attempt: entry.attempt });
    const offset = await resumed;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > entry.size) throw fail('DIRECT_OFFSET_INVALID');
    entry.offset = offset; entry.loaded = offset;
    await sendFile(entry);
  }
  async function sendFile(entry) {
    const epoch = entry.peerEpoch;
    while (entry.offset < entry.size) {
      if (entry.terminal || epoch !== entry.peerEpoch) throw fail('DIRECT_CONNECTION_LOST');
      const bytes = await entry.file.slice(entry.offset, Math.min(entry.size, entry.offset + CHUNK_SIZE)).arrayBuffer();
      await waitBuffered(entry);
      const next = entry.offset + bytes.byteLength;
      const acknowledged = reply(entry, 'ack', next);
      entry.channel.send(bytes);
      await acknowledged;
      entry.offset = next; entry.lastActivity = Date.now();
      update(entry, { loaded: next });
    }
    const receipt = reply(entry, 'saved', entry.size);
    sendControl(entry, { type: 'complete', sha256: entry.sha256, size: entry.size });
    update(entry, { phase: 'verifying' });
    await receipt;
    entry.terminal = true; closePeer(entry);
    update(entry, { phase: 'completed', loaded: entry.size, error: null, receipt: { verified: true, saved: true } });
    options.onComplete?.(snapshot(entry));
  }
  async function receiveChannel(entry, data) {
    if (!entry.localConfirmed) throw fail('DIRECT_CONFIRM_REQUIRED');
    entry.lastActivity = Date.now();
    if (typeof data === 'string') {
      if (data.length > 4096) throw fail('DIRECT_CONTROL_TOO_LARGE');
      let message;
      try { message = JSON.parse(data); } catch { throw fail('DIRECT_CONTROL_INVALID'); }
      if (!message || typeof message !== 'object') throw fail('DIRECT_CONTROL_INVALID');
      if (entry.role === 'sender') {
        if (!entry.remoteConfirmed) throw fail('DIRECT_CONFIRM_REQUIRED');
        if (message.type === 'resume') { resolveReply(entry, 'resume', message.offset); return; }
        if (message.type === 'ack') { resolveReply(entry, 'ack', message.offset); return; }
        if (message.type === 'saved') {
          if (message.sha256 !== entry.sha256 || message.size !== entry.size) throw fail('DIRECT_CHECKSUM_MISMATCH');
          resolveReply(entry, 'saved', message.size); return;
        }
        throw fail('DIRECT_CONTROL_INVALID');
      }
      if (message.type === 'header') {
        if (entry.header || message.size !== entry.size || message.sha256 !== entry.sha256 || message.attempt !== entry.attempt || !entry.sink) throw fail('DIRECT_HEADER_INVALID');
        entry.header = true;
        await maybeStart(entry); return;
      }
      if (message.type === 'complete') {
        if (!entry.remoteConfirmed) throw fail('DIRECT_CONFIRM_REQUIRED');
        if (!entry.header || message.size !== entry.size || message.sha256 !== entry.sha256 || entry.offset !== entry.size) throw fail('DIRECT_SIZE_MISMATCH');
        await finishReceive(entry); return;
      }
      throw fail('DIRECT_CONTROL_INVALID');
    }
    if (!entry.remoteConfirmed) throw fail('DIRECT_CONFIRM_REQUIRED');
    if (entry.role !== 'receiver' || !entry.sink || !entry.header) throw fail('DIRECT_HEADER_REQUIRED');
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(await data.arrayBuffer());
    if (!bytes.length || bytes.length > CHUNK_SIZE || entry.offset + bytes.length > entry.size) throw fail('DIRECT_SIZE_MISMATCH');
    await entry.sink.write(bytes);
    entry.hasher.update(bytes); entry.offset += bytes.length;
    update(entry, { loaded: entry.offset, phase: 'receiving' });
    sendControl(entry, { type: 'ack', offset: entry.offset });
  }
  async function finishReceive(entry) {
    update(entry, { phase: 'verifying' });
    const actual = entry.hasher.hex();
    if (actual !== entry.sha256) throw fail('DIRECT_CHECKSUM_MISMATCH');
    await entry.sink.close();
    entry.sink = null;
    // Closing a writable proves the receiver saved the verified bytes. Signal the
    // sender over the already authenticated channel even if the hub is offline.
    sendControl(entry, { type: 'saved', size: entry.size, sha256: actual });
    entry.terminal = true;
    clearTimeout(entry.ackTimer);
    update(entry, { phase: 'completed', loaded: entry.size, receipt: { verified: true, saved: true }, error: null });
    options.onComplete?.(snapshot(entry));
    call('/api/direct/' + entry.id + '/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sha256: actual, size: entry.size }) }).catch(() => {});
    // Give SCTP time to flush the final receipt before releasing the transport.
    setTimeout(() => closePeer(entry), 1000);
  }
  async function prepareSas(entry) {
    entry.sas = await authenticationCode(entry.id, entry.peer.localDescription.sdp, entry.peer.remoteDescription.sdp, entry);
    if (entry.pendingConfirm) {
      if (entry.pendingConfirm !== entry.sas) throw fail('DIRECT_AUTH_CODE_MISMATCH');
      entry.remoteConfirmed = true;
    }
    update(entry, { phase: 'confirming' });
    options.onConfirm?.(snapshot(entry));
  }
  async function drainCandidates(entry) {
    if (!entry.peer?.remoteDescription) return;
    for (const candidate of entry.candidates.splice(0)) await entry.peer.addIceCandidate(candidate.candidate === null ? null : candidate);
  }
  async function createOffer(entry) {
    const peer = createPeer(entry, false);
    const channel = peer.createDataChannel('mckl-v1', { ordered: true });
    bindChannel(entry, channel);
    await peer.setLocalDescription(await peer.createOffer());
    await signal(entry, 'description', { type: 'offer', sdp: peer.localDescription.sdp });
    update(entry, { phase: 'awaiting-accept', error: null });
  }
  async function answerOffer(entry) {
    if (!entry.accepted || !entry.pendingDescription || entry.answerSent || !entry.sink) return;
    entry.answerSent = true;
    const peer = createPeer(entry, true);
    await peer.setRemoteDescription(entry.pendingDescription);
    await drainCandidates(entry);
    await peer.setLocalDescription(await peer.createAnswer());
    await signal(entry, 'description', { type: 'answer', sdp: peer.localDescription.sdp });
    await prepareSas(entry);
  }
  async function resetAttempt(entry, attempt) {
    if (attempt <= entry.attempt) return;
    closePeer(entry);
    await entry.receiveQueue.catch(() => {});
    entry.attempt = attempt; entry.pendingDescription = null; entry.answerSent = false; entry.pendingConfirm = null;
    update(entry, { phase: 'connecting', error: null, sas: null });
    if (entry.role === 'sender') await createOffer(entry);
  }
  async function receiveSignal(entry, message) {
    const value = message.payload || {};
    if (message.type === 'cancel') { await terminate(entry, value.reason === 'rejected' ? 'rejected' : value.reason === 'expired' ? 'expired' : value.reason === 'peer-error' ? 'failed' : 'cancelled', value.reason === 'revoked' ? fail('DIRECT_SESSION_REVOKED') : undefined); return; }
    if (message.type === 'restart') { await resetAttempt(entry, value.attempt); return; }
    if (value.attempt !== entry.attempt) return;
    if (message.type === 'accept') { entry.accepted = true; update(entry, { phase: 'connecting' }); return; }
    if (message.type === 'description') {
      if (entry.role === 'sender') {
        if (value.type !== 'answer' || !entry.peer || entry.peer.remoteDescription) throw fail('DIRECT_DESCRIPTION_INVALID');
        await entry.peer.setRemoteDescription({ type: 'answer', sdp: value.sdp });
        await drainCandidates(entry); await prepareSas(entry);
      } else {
        if (value.type !== 'offer' || entry.pendingDescription) throw fail('DIRECT_DESCRIPTION_INVALID');
        entry.pendingDescription = { type: 'offer', sdp: value.sdp }; await answerOffer(entry);
      }
    } else if (message.type === 'candidate') {
      const candidate = { candidate: value.candidate, sdpMid: value.sdpMid, sdpMLineIndex: value.sdpMLineIndex, usernameFragment: value.usernameFragment };
      if (entry.candidates.length >= 64) throw fail('DIRECT_CANDIDATE_LIMIT');
      entry.candidates.push(candidate); await drainCandidates(entry);
    } else if (message.type === 'confirm') {
      if (entry.sas && value.sas !== entry.sas) throw fail('DIRECT_AUTH_CODE_MISMATCH');
      entry.pendingConfirm = value.sas; entry.remoteConfirmed = Boolean(entry.sas);
      await maybeStart(entry);
    } else if (message.type === 'receipt') {
      if (value.sha256 !== entry.sha256 || value.size !== entry.size || !value.verified || !value.saved) throw fail('DIRECT_RECEIPT_INVALID');
      // Normally the reliable channel receipt wins. Broker receipt recovers when
      // the final SCTP packet is lost after the sink has already closed.
      if (entry.role === 'sender' && entry.localConfirmed && entry.remoteConfirmed) {
        clearTimeout(entry.ackTimer); entry.pendingReply?.resolve(entry.size); entry.pendingReply = null;
        entry.terminal = true; closePeer(entry);
        update(entry, { phase: 'completed', loaded: entry.size, receipt: value, error: null }); options.onComplete?.(snapshot(entry));
      }
    }
  }
  async function pollEntry(entry) {
    if (entry.terminal || entry.polling) return;
    entry.polling = true;
    try {
      const result = await call('/api/direct/' + entry.id + '?after=' + entry.sequence);
      if (stopped) return;
      if (result.reset) throw fail('DIRECT_SIGNAL_GAP');
      if (['cancelled','rejected','expired','failed'].includes(result.transfer?.status)) { await terminate(entry, result.transfer.status, result.transfer.status === 'failed' ? fail('DIRECT_REMOTE_ERROR') : undefined); return; }
      for (const message of result.signals || []) {
        await receiveSignal(entry, message);
        entry.sequence = Math.max(entry.sequence, message.seq);
        if (entry.terminal) break;
      }
      entry.sequence = Math.max(entry.sequence, result.next || 0);
      const status = result.transfer?.status;
      if (!entry.terminal && TERMINAL.has(status)) {
        if (status === 'completed' && entry.role === 'sender' && entry.localConfirmed && entry.remoteConfirmed) {
          entry.terminal = true; closePeer(entry); update(entry, { phase: 'completed', loaded: entry.size, receipt: { verified: true, saved: true } }); options.onComplete?.(snapshot(entry));
        } else await terminate(entry, status, status === 'failed' ? fail('DIRECT_REMOTE_ERROR') : undefined);
      }
    } catch (error) {
      if (error.status === 401 || error.status === 403 || error.status === 404 || error.code === 'DIRECT_SIGNAL_GAP') await terminate(entry, 'failed', error);
      else if (error.code !== 'DIRECT_ATTEMPT_CHANGED' && !entry.terminal) update(entry, { error });
    } finally { entry.polling = false; }
  }
  async function refresh() {
    if (stopped) return;
    if (refreshing) return refreshing;
    const currentGeneration = generation;
    refreshing = (async () => {
      const result = await call('/api/direct');
      if (stopped || currentGeneration !== generation) return;
      const list = Array.isArray(result) ? result : result.transfers || [];
      for (const transfer of list) {
        if (entries.has(transfer.id) || transfer.recipientId !== options.clientId || TERMINAL.has(transfer.status)) continue;
        boundEntries();
        const entry = newEntry(transfer, 'receiver'); entry.queuedBytes = 0; entries.set(entry.id, entry);
        options.onOffer?.(snapshot(entry)); update(entry);
      }
      await Promise.all([...entries.values()].map(entry => pollEntry(entry)));
    })();
    try { await refreshing; }
    catch (error) {
      if ([401, 403].includes(error.status)) for (const entry of entries.values()) await terminate(entry, 'failed', error);
      throw error;
    } finally { refreshing = null; }
  }
  function schedule() {
    clearTimeout(refreshTimer);
    if (!stopped) refreshTimer = setTimeout(() => { refresh().catch(error => options.onError?.(error)).finally(schedule); }, intervalMs);
  }
  async function start() {
    if (!stopped) return refresh();
    stopped = false; generation++;
    try { await refresh(); } finally { schedule(); }
  }
  function stop() {
    stopped = true; generation++; clearTimeout(refreshTimer);
    for (const entry of entries.values()) if (!entry.terminal) void terminate(entry, 'cancelled', fail('DIRECT_CLIENT_STOPPED'));
  }
  async function offer(file, recipientId, sha256) {
    if (!globalThis.isSecureContext && !options.allowInsecureForTests) throw fail('DIRECT_SECURE_CONTEXT_REQUIRED');
    if (!file || typeof file.slice !== 'function' || !Number.isSafeInteger(file.size) || file.size < 0 || !HASH.test(sha256 || '')) throw fail('DIRECT_METADATA_INVALID');
    if (stopped) await start();
    boundEntries();
    const transfer = await call('/api/direct', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipientId, name: file.name, size: file.size, mime: file.type, sha256: sha256.toLowerCase() }) });
    const entry = newEntry(transfer, 'sender'); entry.file = file; entry.queuedBytes = 0; entries.set(entry.id, entry);
    try { await createOffer(entry); } catch (error) { await failTransfer(entry, error); throw error; }
    return snapshot(entry);
  }
  async function accept(id) {
    const entry = get(id);
    if (entry.role !== 'receiver' || entry.terminal || entry.accepting || entry.accepted) throw fail('DIRECT_ACCEPT_UNAVAILABLE');
    entry.accepting = true;
    // Invoke the picker synchronously under the UI click. Do not insert an await
    // before this call, including a poll or a dynamic import.
    const sinkPromise = options.createSink ? options.createSink({ transfer: snapshot(entry), file: snapshot(entry) }) : defaultSink(entry);
    try {
      const sink = await sinkPromise;
      if (!sink || typeof sink.write !== 'function' || typeof sink.close !== 'function' || typeof sink.abort !== 'function') throw fail('DIRECT_SINK_INVALID');
      if (entry.terminal || stopped) { await sink.abort(); return; }
      entry.sink = sink; entry.hasher = new Sha256(); entry.offset = 0; entry.accepted = true;
      await signal(entry, 'accept');
      update(entry, { phase: 'connecting', error: null });
      await answerOffer(entry);
      return snapshot(entry);
    } catch (error) {
      entry.accepted = false; await abortSink(entry);
      if (error.name !== 'AbortError') update(entry, { error });
      throw error;
    } finally { entry.accepting = false; }
  }
  async function confirm(id, sas) {
    const entry = get(id);
    if (!entry.sas || entry.terminal) throw fail('DIRECT_AUTH_CODE_UNAVAILABLE');
    if (sas && sas !== entry.sas) throw fail('DIRECT_AUTH_CODE_MISMATCH');
    await signal(entry, 'confirm', { sas: entry.sas });
    entry.localConfirmed = true; update(entry, { phase: 'confirming', error: null });
    void maybeStart(entry).catch(error => failTransfer(entry, error));
    return entry.sas;
  }
  async function reject(id, reason = 'rejected') {
    const entry = get(id);
    await call('/api/direct/' + id, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
    await terminate(entry, reason === 'rejected' ? 'rejected' : 'cancelled');
  }
  async function restart(id) {
    const entry = get(id);
    if (entry.terminal || entry.role === 'sender' && !entry.file || entry.role === 'receiver' && !entry.sink) throw fail('DIRECT_RESTART_UNAVAILABLE');
    const result = await signal(entry, 'restart');
    await resetAttempt(entry, result.attempt);
    return snapshot(entry);
  }
  async function diagnostics(id) {
    const peer = get(id).peer;
    if (!peer?.getStats) return { path: 'unknown', reason: 'stats-unavailable' };
    const report = await peer.getStats(); let pair;
    report.forEach(item => {
      if (item.type === 'transport' && item.selectedCandidatePairId) pair = report.get(item.selectedCandidatePairId);
    });
    if (!pair) report.forEach(item => { if (item.type === 'candidate-pair' && item.state === 'succeeded' && (item.selected || item.nominated)) pair = item; });
    if (!pair) return { path: 'unknown', reason: 'candidate-pair-unavailable' };
    const candidates = [report.get(pair.localCandidateId), report.get(pair.remoteCandidateId)].filter(Boolean);
    const types = candidates.map(item => item.candidateType);
    return { path: types.includes('relay') ? 'relay' : types.length === 2 && types.every(value => ['host', 'srflx', 'prflx'].includes(value)) ? 'direct' : 'unknown', candidateTypes: types };
  }
  return { start, refresh, stop, offer, accept, confirm, reject, cancel: id => reject(id, 'cancelled'), restart, diagnostics, poll: id => pollEntry(get(id)), get: id => snapshot(get(id)), list: () => [...entries.values()].map(snapshot) };
}

if (typeof window !== 'undefined') window.MCKLDirect = { createDirectClient, authenticationCode };
