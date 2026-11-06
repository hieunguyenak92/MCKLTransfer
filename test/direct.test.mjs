import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { createDirectBroker } from '../lib/direct.mjs';
import { createDirectClient, authenticationCode } from '../public/direct.js';

const owner = { clientId: 'a'.repeat(16), role: 'peer' };
const recipient = { clientId: 'b'.repeat(16), role: 'peer' };
const other = { clientId: 'c'.repeat(16), role: 'peer' };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fingerprint = value => Array.from({ length: 32 }, () => value.toString(16).padStart(2, '0')).join(':').toUpperCase();
const sdp = value => 'v=0\r\na=fingerprint:sha-256 ' + fingerprint(value) + '\r\n';
const metadata = { recipientId: recipient.clientId, name: 'photo.jpg', size: 12, sha256: 'a'.repeat(64) };
const signal = (broker, transfer, session, type, payload = {}) => broker.signal(transfer.id, session, { type, payload: { attempt: transfer.attempt, ...payload } });

async function ready(broker, transfer) {
  signal(broker, transfer, owner, 'description', { type: 'offer', sdp: sdp(1) });
  signal(broker, transfer, recipient, 'accept');
  signal(broker, transfer, recipient, 'description', { type: 'answer', sdp: sdp(2) });
  const sas = await authenticationCode(transfer.id, sdp(1), sdp(2), transfer);
  signal(broker, transfer, owner, 'confirm', { sas });
  signal(broker, transfer, recipient, 'confirm', { sas });
  return sas;
}

test('broker isolates all metadata and signals, including from an administrator outside the transfer', () => {
  const broker = createDirectBroker();
  const transfer = broker.create(owner, metadata);
  for (const outsider of [other, { ...other, role: 'admin' }]) {
    assert.deepEqual(broker.list(outsider), []);
    assert.throws(() => broker.get(transfer.id, outsider), error => error.statusCode === 404);
    assert.throws(() => broker.poll(transfer.id, outsider), error => error.statusCode === 404);
    assert.throws(() => signal(broker, transfer, outsider, 'candidate', { candidate: null }), error => error.statusCode === 404);
  }
  assert.throws(() => broker.create({ ...owner, approved: false }, metadata), error => error.statusCode === 403);
  assert.throws(() => signal(broker, transfer, owner, 'accept'), error => error.statusCode === 403);
});

test('confirmation requires explicit acceptance, valid descriptions and exactly matching transcript codes', async () => {
  const broker = createDirectBroker(); const transfer = broker.create(owner, metadata);
  assert.throws(() => signal(broker, transfer, owner, 'confirm', { sas: '1111-2222-3333' }), error => error.code === 'DIRECT_NOT_READY');
  signal(broker, transfer, owner, 'description', { type: 'offer', sdp: sdp(1) });
  assert.throws(() => signal(broker, transfer, recipient, 'description', { type: 'answer', sdp: sdp(2) }), error => error.code === 'DIRECT_DESCRIPTION_CONFLICT');
  signal(broker, transfer, recipient, 'accept');
  signal(broker, transfer, recipient, 'description', { type: 'answer', sdp: sdp(2) });
  assert.throws(() => signal(broker, transfer, owner, 'confirm', { sas: '1111-2222-3333' }), error => error.code === 'DIRECT_AUTH_CODE_MISMATCH');
  const sas = await authenticationCode(transfer.id, sdp(1), sdp(2), transfer);
  assert.equal(await authenticationCode(transfer.id, sdp(2), sdp(1), transfer), sas);
  assert.notEqual(await authenticationCode(transfer.id, sdp(1), sdp(2), { ...transfer, sha256: 'b'.repeat(64) }), sas);
  signal(broker, transfer, owner, 'confirm', { sas });
  assert.equal(broker.get(transfer.id, owner).status, 'confirming');
  signal(broker, transfer, recipient, 'confirm', { sas });
  assert.equal(broker.get(transfer.id, owner).status, 'active');
});

test('recipient completion checks size and hash, is idempotent only after completion, and cannot resurrect cancelled state', async () => {
  const broker = createDirectBroker(); const transfer = broker.create(owner, metadata);
  await ready(broker, transfer);
  assert.throws(() => broker.complete(transfer.id, owner, { sha256: metadata.sha256, size: 12 }), error => error.statusCode === 403);
  assert.throws(() => broker.complete(transfer.id, recipient, { sha256: metadata.sha256 }), error => error.statusCode === 422);
  assert.throws(() => broker.complete(transfer.id, recipient, { sha256: 'b'.repeat(64), size: 12 }), error => error.statusCode === 422);
  assert.equal(broker.complete(transfer.id, recipient, { sha256: metadata.sha256, size: 12 }).status, 'completed');
  assert.equal(broker.complete(transfer.id, recipient, { sha256: metadata.sha256, size: 12 }).status, 'completed');
  assert.throws(() => signal(broker, transfer, owner, 'candidate', { candidate: null }), error => error.statusCode === 410);
  const cancelled = broker.create(owner, metadata); await ready(broker, cancelled);
  broker.cancel(cancelled.id, recipient, 'rejected');
  assert.throws(() => broker.complete(cancelled.id, recipient, { sha256: metadata.sha256, size: 12 }), error => error.statusCode === 409);
});

test('signaling queue loss is explicit and terminal records are reclaimed', () => {
  let time = 1000; const broker = createDirectBroker({ now: () => time, ttlMs: 100, terminalTtlMs: 50, maxTransfers: 1, maxSignals: 2 });
  const transfer = broker.create(owner, metadata);
  for (let i = 0; i < 3; i++) signal(broker, transfer, owner, 'candidate', { candidate: 'candidate:' + i });
  const polled = broker.poll(transfer.id, recipient, 0);
  assert.equal(polled.signals.length, 2); assert.equal(polled.reset, true);
  assert.throws(() => broker.create(owner, metadata), error => error.statusCode === 429);
  time = 1101; broker.sweep(); assert.equal(broker.get(transfer.id, owner).status, 'expired');
  time = 1152; broker.sweep();
  assert.throws(() => broker.get(transfer.id, owner), error => error.statusCode === 404);
  assert.equal(broker.create(owner, metadata).status, 'offered');
});

test('restart invalidates previous authentication and stale SDP/ICE messages', async () => {
  const broker = createDirectBroker(); const transfer = broker.create(owner, metadata);
  await ready(broker, transfer);
  const restarted = signal(broker, transfer, recipient, 'restart');
  assert.equal(restarted.attempt, 1);
  assert.throws(() => signal(broker, transfer, owner, 'candidate', { candidate: null }), error => error.code === 'DIRECT_ATTEMPT_CHANGED');
  assert.throws(() => broker.complete(transfer.id, recipient, { size: metadata.size, sha256: metadata.sha256 }), error => error.code === 'DIRECT_NOT_ACTIVE');
  const current = broker.get(transfer.id, owner);
  const sas = await ready(broker, current);
  assert.equal(current.attempt, 1);
  assert.equal(typeof sas, 'string');
});

test('revocation delivers a terminal notice to both peers', () => {
  const broker = createDirectBroker(); const transfer = broker.create(owner, metadata);
  broker.revoke(owner.clientId);
  for (const session of [owner, recipient]) {
    const result = broker.poll(transfer.id, session);
    assert.equal(result.transfer.status, 'cancelled');
    assert.equal(result.signals.at(-1).payload.reason, 'revoked');
  }
});

test('malformed names, fingerprints, oversized payloads and candidate floods are rejected', () => {
  const broker = createDirectBroker();
  assert.throws(() => broker.create(owner, { ...metadata, name: '../secret' }), error => error.code === 'INVALID_FILE_NAME');
  const transfer = broker.create(owner, metadata);
  assert.throws(() => signal(broker, transfer, owner, 'description', { type: 'offer', sdp: 'v=0' }), error => error.code === 'DIRECT_FINGERPRINT_UNAVAILABLE');
  assert.throws(() => signal(broker, transfer, owner, 'description', { type: 'offer', sdp: 'x'.repeat(90_000) }), error => error.code === 'SIGNAL_TOO_LARGE');
  for (let i = 0; i < 64; i++) signal(broker, transfer, owner, 'candidate', { candidate: null });
  assert.throws(() => signal(broker, transfer, owner, 'candidate', { candidate: null }), error => error.code === 'DIRECT_CANDIDATE_LIMIT');
});

class FakeChannel {
  constructor(network) {
    this.network = network; this.label = 'mckl-v1'; this.ordered = true; this.maxPacketLifeTime = null; this.maxRetransmits = null;
    this.readyState = 'connecting'; this.bufferedAmount = 0;
  }
  send(data) {
    if (this.readyState !== 'open') throw new Error('closed channel');
    const copied = typeof data === 'string' ? data : data.slice(0);
    if (typeof data !== 'string') { this.network.binarySent++; this.network.inFlight++; this.network.maxInFlight = Math.max(this.network.maxInFlight, this.network.inFlight); }
    setTimeout(() => {
      if (this.other.readyState !== 'open') return;
      let delivered = copied;
      if (typeof copied !== 'string') {
        this.network.inFlight--;
        if (this.network.corruptNext) { this.network.corruptNext = false; const bytes = new Uint8Array(copied); bytes[0] ^= 255; delivered = bytes.buffer; }
      }
      this.other.onmessage?.({ data: delivered });
    }, 0);
  }
  close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.onclose?.(); if (this.other?.readyState !== 'closed') { this.other.readyState = 'closed'; this.other.onclose?.(); } }
}
function fakeNetwork() {
  const peers = new Map(); let sequence = 0;
  const network = { binarySent: 0, inFlight: 0, maxInFlight: 0, peers, corruptNext: false };
  network.factory = () => {
    const id = ++sequence;
    const peer = {
      id, localDescription: null, remoteDescription: null, connectionState: 'new',
      createDataChannel() { this.channel = new FakeChannel(network); return this.channel; },
      async createOffer() { return { type: 'offer', sdp: sdp(id) + 'a=x-peer:' + id + '\r\n' }; },
      async createAnswer() { return { type: 'answer', sdp: sdp(id) + 'a=x-peer:' + id + '\r\n' }; },
      async setLocalDescription(description) { this.localDescription = description; },
      async setRemoteDescription(description) {
        this.remoteDescription = description;
        const remoteId = Number(/a=x-peer:(\d+)/.exec(description.sdp)[1]);
        const remote = peers.get(remoteId);
        if (description.type === 'offer') {
          this.channel = new FakeChannel(network);
          this.channel.other = remote.channel; remote.channel.other = this.channel;
          this.ondatachannel?.({ channel: this.channel });
        } else {
          for (const p of [this, remote]) {
            p.connectionState = 'connected'; p.channel.readyState = 'open';
            setTimeout(() => { p.onconnectionstatechange?.(); p.channel.onopen?.(); }, 0);
          }
        }
      },
      async addIceCandidate() {},
      async getStats() { return new Map([['transport', { type: 'transport', selectedCandidatePairId: 'pair' }], ['pair', { type: 'candidate-pair', state: 'succeeded', localCandidateId: 'local', remoteCandidateId: 'remote' }], ['local', { candidateType: 'host' }], ['remote', { candidateType: 'host' }]]); },
      close() { this.connectionState = 'closed'; this.channel?.close(); },
    };
    peers.set(id, peer); return peer;
  };
  return network;
}
function api(broker, session) {
  return async (route, options = {}) => {
    await wait(0);
    const url = new URL(route, 'https://synthetic.test'); const body = options.body ? JSON.parse(options.body) : {};
    try {
      if (url.pathname === '/api/direct') return options.method === 'POST' ? broker.create(session, body) : { transfers: broker.list(session) };
      const match = /^\/api\/direct\/([a-f0-9]{24})(\/signals|\/complete)?$/.exec(url.pathname);
      if (!match) throw new Error('Unknown route ' + route);
      if (match[2] === '/signals') return broker.signal(match[1], session, body);
      if (match[2] === '/complete') return broker.complete(match[1], session, body);
      if (options.method === 'DELETE') return broker.cancel(match[1], session, body.reason);
      return broker.poll(match[1], session, Number(url.searchParams.get('after') || 0));
    } catch (error) { error.status = error.statusCode; throw error; }
  };
}
async function until(predicate, message, ms = 3000) {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > ms) throw new Error(message); await wait(5); }
}
async function clients(t, bytes, extras = {}) {
  const broker = createDirectBroker(); const network = fakeNetwork(); let offered;
  const output = []; const writes = []; let closed = false; let aborted = false; let maxQueued = 0; let writing = 0;
  const sink = {
    async write(value) { writing++; maxQueued = Math.max(maxQueued, writing); await wait(3); output.push(Buffer.from(value)); writes.push(value.byteLength); writing--; },
    async close() { closed = true; },
    async abort() { aborted = true; },
  };
  const common = { createPeer: network.factory, pollMs: 5, timeoutMs: 2000, allowInsecureForTests: true };
  const sender = createDirectClient({ ...common, clientId: owner.clientId, api: api(broker, owner), ...extras.sender });
  const receiver = createDirectClient({ ...common, clientId: recipient.clientId, api: api(broker, recipient), createSink: async () => sink, onOffer: entry => { offered = entry; }, ...extras.receiver });
  t.after(() => { sender.stop(); receiver.stop(); });
  await sender.start(); await receiver.start();
  const source = new File([bytes], 'fixture.bin');
  const transfer = await sender.offer(source, recipient.clientId, hash(bytes));
  await until(() => offered, 'incoming offer');
  return { broker, network, sender, receiver, transfer, output, writes, sink, get closed() { return closed; }, get aborted() { return aborted; }, get maxQueued() { return maxQueued; } };
}

test('simulated browser peers require both code confirmations and stream exact bytes to a bounded sink', async t => {
  const bytes = crypto.randomBytes(3 * 64 * 1024 + 17);
  const pair = await clients(t, bytes);
  assert.equal(pair.network.binarySent, 0);
  await pair.receiver.accept(pair.transfer.id);
  await until(() => pair.sender.get(pair.transfer.id).sas && pair.receiver.get(pair.transfer.id).sas, 'authentication codes');
  const code = pair.sender.get(pair.transfer.id).sas;
  assert.equal(pair.receiver.get(pair.transfer.id).sas, code);
  await pair.sender.confirm(pair.transfer.id, code);
  await wait(25); assert.equal(pair.network.binarySent, 0, 'one confirmation cannot send payload');
  await pair.receiver.confirm(pair.transfer.id, code);
  await until(() => pair.sender.get(pair.transfer.id).phase === 'completed', 'sender completion');
  assert.equal(pair.receiver.get(pair.transfer.id).phase, 'completed');
  assert.deepEqual(Buffer.concat(pair.output), bytes);
  assert.equal(pair.closed, true); assert.equal(pair.aborted, false);
  assert.equal(pair.maxQueued, 1); assert.equal(pair.network.maxInFlight, 1);
  assert.ok(pair.writes.every(size => size <= 64 * 1024));
  assert.equal((await pair.sender.diagnostics(pair.transfer.id)).path, 'unknown', 'peer is closed after completion');
});

test('zero-byte files complete through a verified close without allocating a payload buffer', async t => {
  const pair = await clients(t, Buffer.alloc(0));
  await pair.receiver.accept(pair.transfer.id);
  await until(() => pair.sender.get(pair.transfer.id).sas && pair.receiver.get(pair.transfer.id).sas, 'authentication codes');
  await pair.sender.confirm(pair.transfer.id); await pair.receiver.confirm(pair.transfer.id);
  await until(() => pair.sender.get(pair.transfer.id).phase === 'completed', 'empty completion');
  assert.equal(pair.network.binarySent, 0); assert.equal(pair.closed, true);
});

test('corrupt payload aborts the sink and never sends a successful receipt', async t => {
  const pair = await clients(t, crypto.randomBytes(90_000));
  await pair.receiver.accept(pair.transfer.id);
  await until(() => pair.sender.get(pair.transfer.id).sas && pair.receiver.get(pair.transfer.id).sas, 'authentication codes');
  pair.network.corruptNext = true;
  await pair.sender.confirm(pair.transfer.id); await pair.receiver.confirm(pair.transfer.id);
  await until(() => pair.receiver.get(pair.transfer.id).phase === 'failed', 'checksum failure');
  assert.equal(pair.closed, false); assert.equal(pair.aborted, true);
  assert.notEqual(pair.sender.get(pair.transfer.id).phase, 'completed');
});

test('recipient cancellation closes the transport and aborts unfinished disk output', async t => {
  const pair = await clients(t, crypto.randomBytes(100_000));
  await pair.receiver.accept(pair.transfer.id);
  await pair.receiver.cancel(pair.transfer.id);
  assert.equal(pair.aborted, true); assert.equal(pair.closed, false);
  await until(() => ['cancelled','failed'].includes(pair.sender.get(pair.transfer.id).phase), 'sender cancellation: ' + pair.sender.get(pair.transfer.id).phase);
  assert.equal(pair.sender.get(pair.transfer.id).phase, 'cancelled');
  assert.equal(pair.network.binarySent, 0);
});

test('receiver picker is invoked within accept before any network await', async t => {
  let inAcceptCall = false; let pickerSynchronous = false;
  const pair = await clients(t, Buffer.from('picker test'), { receiver: { createSink() { pickerSynchronous = inAcceptCall; return { async write() {}, async close() {}, async abort() {} }; } } });
  inAcceptCall = true; const accepted = pair.receiver.accept(pair.transfer.id); inAcceptCall = false;
  await accepted;
  assert.equal(pickerSynchronous, true);
});
