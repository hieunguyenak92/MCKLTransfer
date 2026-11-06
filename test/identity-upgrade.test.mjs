import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSessions } from '../lib/sessions.mjs';
import { createSharing } from '../lib/sharing.mjs';

const PIN = '123456';
const ADMIN = 'synthetic-administrator-code-for-identity';
const request = token => ({ headers: token ? { cookie: `mckl_session=${token}` } : {} });
const code = expected => error => error.code === expected;
const ids = { admin: 'a'.repeat(16), sender: 'b'.repeat(16), recipient: 'c'.repeat(16), stranger: 'd'.repeat(16), pending: 'e'.repeat(16) };
const peer = id => ({ clientId: id, role: 'peer', approved: true });
const admin = { clientId: ids.admin, role: 'admin', approved: true };

async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mckl-identity-'));
  return dir;
}
async function sessionFixture(t, options = {}) {
  const dir = await directory(t);
  const revoked = [];
  const settings = { shareDir: dir, shareCode: PIN, adminCode: ADMIN, onRevoke: id => revoked.push(id), ...options };
  let sessions = createSessions(settings);
  await sessions.init();
  t.after(async () => { await sessions.stop(); await fs.rm(dir, { recursive: true, force: true }); });
  return { dir, revoked, get sessions() { return sessions; }, async restart() { await sessions.stop(); sessions = createSessions(settings); await sessions.init(); return sessions; } };
}
async function sharingFixture(t, options = {}) {
  const dir = await directory(t);
  const getDevice = id => Object.values(ids).includes(id) ? { id, approved: id !== ids.pending } : null;
  const settings = { shareDir: dir, getDevice, ...options };
  let sharing = createSharing(settings);
  await sharing.init();
  t.after(async () => { await sharing.stop(); await fs.rm(dir, { recursive: true, force: true }); });
  return { dir, get sharing() { return sharing; }, async restart() { await sharing.stop(); sharing = createSharing(settings); await sharing.init(); return sharing; } };
}

test('approval is explicit, persistent and cannot be granted through authentication body fields', async t => {
  const f = await sessionFixture(t, { requireApproval: true });
  const auth = await f.sessions.authenticate({ code: PIN, approved: true, role: 'admin', deviceName: 'Synthetic peer', rememberDevice: true }, request());
  assert.equal(auth.role, 'peer'); assert.equal(auth.status, 'pending');
  assert.equal(f.sessions.get(request(auth.token)).approved, false);
  assert.equal(f.sessions.listPublic().length, 0);
  const host = await f.sessions.authenticate({ code: ADMIN }, request());
  assert.equal(host.status, 'approved');
  assert.equal(f.sessions.getById(auth.clientId).status, 'pending');
  await f.sessions.approveDevice(auth.clientId);
  await f.restart();
  assert.equal(f.sessions.get(request(auth.token)).approved, true);
  assert.equal(f.sessions.listPublic().length, 2);
  const persisted = await fs.readFile(path.join(f.dir, '.mckl-devices.json'), 'utf8');
  for (const secret of [PIN, ADMIN, auth.token, host.token]) assert.equal(persisted.includes(secret), false);
});

test('durable revocation survives device snapshot failure and a clean restart', async t => {
  const f = await sessionFixture(t);
  const auth = await f.sessions.authenticate({ code: PIN, rememberDevice: true }, request());
  const tokenHash = crypto.createHash('sha256').update(auth.token).digest('hex');
  const original = fs.rename;
  const mock = t.mock.method(fs, 'rename', async (source, destination) => {
    if (destination === path.join(f.dir, '.mckl-devices.json')) throw Object.assign(new Error('Synthetic snapshot failure'), { code: 'EIO' });
    return original(source, destination);
  });
  await assert.rejects(f.sessions.revoke(tokenHash), code('EIO'));
  assert.equal(f.sessions.get(request(auth.token)), null);
  assert.ok(f.revoked.includes(tokenHash));
  mock.mock.restore();
  await f.restart();
  assert.equal(f.sessions.get(request(auth.token)), null, 'durable tombstone excludes token from old device snapshot');
  const next = await f.sessions.authenticate({ code: PIN }, request());
  assert.equal(f.sessions.get(request(next.token)).role, 'peer');
});

test('revocation journal failure disables all access and forces re-pairing after restart', async t => {
  const f = await sessionFixture(t);
  const auth = await f.sessions.authenticate({ code: PIN }, request());
  const host = await f.sessions.authenticate({ code: ADMIN }, request());
  const original = fs.rename;
  const mock = t.mock.method(fs, 'rename', async (source, destination) => {
    if (destination === path.join(f.dir, '.mckl-revocations.json')) throw Object.assign(new Error('Synthetic journal failure'), { code: 'EIO' });
    return original(source, destination);
  });
  await assert.rejects(f.sessions.revokeDevice(auth.clientId), code('SESSION_STORAGE_UNAVAILABLE'));
  assert.equal(f.sessions.health().degraded, true);
  assert.equal(f.sessions.get(request(host.token)), null);
  await assert.rejects(f.sessions.authenticate({ code: ADMIN }, request()), code('SESSION_STORAGE_UNAVAILABLE'));
  mock.mock.restore();
  await f.restart();
  assert.equal(f.sessions.get(request(auth.token)), null);
  assert.equal(f.sessions.get(request(host.token)), null);
  const next = await f.sessions.authenticate({ code: ADMIN }, request());
  assert.equal(next.role, 'admin');
});

test('clean session restart preserves identity; an unclean marker invalidates old sessions', async t => {
  const f = await sessionFixture(t);
  const auth = await f.sessions.authenticate({ code: PIN, rememberDevice: true }, request());
  await f.restart();
  assert.equal(f.sessions.get(request(auth.token)).clientId, auth.clientId);
  await f.sessions.stop();
  await fs.writeFile(path.join(f.dir, '.mckl-sessions-active.json'), JSON.stringify({ version: 1, active: true }));
  const crashed = createSessions({ shareDir: f.dir, shareCode: PIN, adminCode: ADMIN });
  await crashed.init();
  assert.equal(crashed.get(request(auth.token)), null);
  await crashed.stop();
});

test('invitations are random, expiring, single-use and exclude secrets from list and disk', async t => {
  let time = 1000;
  const f = await sharingFixture(t, { now: () => time });
  const invite = f.sharing.createInvite({ ttlMs: 1000 });
  assert.match(invite.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(f.sharing.listInvites()).includes(invite.token), false);
  let resolve;
  let calls = 0;
  const first = f.sharing.redeemInvite(invite.token, async () => { calls++; return new Promise(done => { resolve = done; }); });
  await assert.rejects(f.sharing.redeemInvite(invite.token, async () => { calls++; }), code('INVALID_INVITE'));
  assert.throws(() => f.sharing.revokeInvite(invite.id), code('INVITE_BUSY'));
  resolve({ ok: true });
  assert.deepEqual(await first, { ok: true });
  assert.equal(calls, 1);
  await assert.rejects(f.sharing.redeemInvite(invite.token, async () => {}), code('INVALID_INVITE'));
  const expired = f.sharing.createInvite({ ttlMs: 1000 });
  time += 1000;
  await assert.rejects(f.sharing.redeemInvite(expired.token, async () => {}), code('INVALID_INVITE'));
  assert.throws(() => f.sharing.createInvite({ ttlMs: 3600001 }), code('INVALID_INVITE_EXPIRY'));
  const transient = f.sharing.createInvite();
  await f.restart();
  await assert.rejects(f.sharing.redeemInvite(transient.token, async () => {}), code('INVALID_INVITE'));
  assert.equal((await fs.readdir(f.dir)).some(name => name.includes('invite')), false);
});

test('failed session creation releases invite reservation for a safe retry', async t => {
  const f = await sharingFixture(t);
  const invite = f.sharing.createInvite();
  await assert.rejects(f.sharing.redeemInvite(invite.token, async () => { throw new Error('Synthetic write failure'); }));
  assert.equal(await f.sharing.redeemInvite(invite.token, async () => 'created'), 'created');
});

test('invite session issuance stays pending and never trusts requested administrator role', async t => {
  const f = await sessionFixture(t, { requireApproval: true });
  const auth = await f.sessions.authenticateInvite({ role: 'admin', approved: true }, request());
  assert.equal(auth.role, 'peer'); assert.equal(auth.approved, false);
});

test('room and recipient authorization covers lists, membership removal, owner and trusted admin', async t => {
  const f = await sharingFixture(t);
  const sender = peer(ids.sender), recipient = peer(ids.recipient), stranger = peer(ids.stranger);
  const room = await f.sharing.createRoom({ name: 'Private project', members: [ids.sender, ids.recipient] }, admin);
  assert.equal(f.sharing.listRooms(stranger).some(item => item.id === room.id), false);
  assert.equal(f.sharing.listRooms(recipient).some(item => item.id === room.id), true);
  assert.deepEqual(f.sharing.validateTarget({ roomId: room.id, recipientId: ids.recipient }, sender), { roomId: room.id, recipientId: ids.recipient });
  assert.throws(() => f.sharing.validateTarget({ roomId: room.id }, stranger), code('FORBIDDEN'));
  assert.throws(() => f.sharing.validateTarget({ roomId: 'inbox' }, sender), code('RECIPIENT_REQUIRED'));
  assert.throws(() => f.sharing.validateTarget({ recipientId: ids.pending }, sender), code('DEVICE_NOT_APPROVED'));
  const resource = { ownerId: ids.sender, roomId: room.id, recipientId: ids.recipient };
  for (const person of [sender, recipient, admin]) assert.equal(f.sharing.canRead(resource, person), true);
  assert.equal(f.sharing.canRead(resource, stranger), false);
  assert.equal(f.sharing.canRead(resource, { ...recipient, approved: false }), false);
  await f.sharing.updateRoom(room.id, { members: [ids.sender] }, admin);
  assert.equal(f.sharing.canRead(resource, recipient), false);
  assert.equal(f.sharing.canRead(resource, sender), true);
  await assert.rejects(f.sharing.createRoom({ name: 'Unauthorized', members: [] }, sender), code('FORBIDDEN'));
  await f.restart();
  assert.deepEqual(f.sharing.getRoom(room.id).members, [ids.sender]);
});

test('bounded history and receipts preserve recipient scope, whitelist and expiry across restart', async t => {
  let time = 1000;
  const f = await sharingFixture(t, { maxHistory: 2, historyTtlMs: 1000, now: () => time });
  const sender = peer(ids.sender), recipient = peer(ids.recipient), stranger = peer(ids.stranger);
  const file = { id: 'f'.repeat(24), name: 'Private file.txt', size: 8, ownerId: ids.sender, roomId: 'inbox', recipientId: ids.recipient };
  await f.sharing.record({ type: 'uploaded', fileId: file.id, ...file, secret: 'must-not-persist', path: 'must-not-persist' });
  time++;
  await f.sharing.receipt(file, recipient, 'verified');
  assert.equal(f.sharing.history(stranger).length, 0);
  assert.equal(f.sharing.history(sender).length, 2);
  await assert.rejects(f.sharing.receipt(file, stranger, 'saved'), code('NOT_FOUND'));
  await assert.rejects(f.sharing.receipt(file, recipient, 'arbitrary'), code('INVALID_RECEIPT'));
  time++;
  await f.sharing.receipt(file, recipient, 'saved');
  assert.equal(f.sharing.history(sender).length, 2);
  const persisted = await fs.readFile(path.join(f.dir, '.mckl-sharing.json'), 'utf8');
  assert.equal(persisted.includes('must-not-persist'), false);
  await f.restart();
  assert.equal(f.sharing.history(recipient)[0].type, 'saved');
  time += 1001;
  assert.equal(f.sharing.history(recipient).length, 0);
});

test('device approval becomes visible only after its durable snapshot commits', async t => {
  const f = await sessionFixture(t, { requireApproval: true });
  const auth = await f.sessions.authenticate({ code: PIN }, request());
  const original = fs.rename;
  let entered, release;
  const reached = new Promise(resolve => { entered = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  const mock = t.mock.method(fs, 'rename', async (source, destination) => {
    if (destination === path.join(f.dir, '.mckl-devices.json')) { entered(); await barrier; }
    return original(source, destination);
  });
  const approving = f.sessions.approveDevice(auth.clientId);
  await reached;
  assert.equal(f.sessions.get(request(auth.token)).approved, false);
  release();
  await approving;
  mock.mock.restore();
  assert.equal(f.sessions.get(request(auth.token)).approved, true);
});

test('room grants are not visible before persistence and failed updates preserve the old ACL', async t => {
  const f = await sharingFixture(t);
  const room = await f.sharing.createRoom({ name: 'Scoped room', members: [ids.sender] }, admin);
  const file = { ownerId: ids.sender, roomId: room.id };
  const recipient = peer(ids.recipient);
  const original = fs.rename;
  let entered, release;
  const reached = new Promise(resolve => { entered = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  const mock = t.mock.method(fs, 'rename', async (source, destination) => {
    if (destination === path.join(f.dir, '.mckl-sharing.json')) { entered(); await barrier; throw Object.assign(new Error('Synthetic pre-commit failure'), { code: 'EIO' }); }
    return original(source, destination);
  });
  const updating = f.sharing.updateRoom(room.id, { members: [ids.sender, ids.recipient] }, admin);
  const rejected = assert.rejects(updating, code('EIO'));
  await reached;
  assert.equal(f.sharing.canRead(file, recipient), false);
  release(); await rejected;
  mock.mock.restore();
  assert.equal(f.sharing.canRead(file, recipient), false);
  assert.deepEqual(f.sharing.getRoom(room.id).members, [ids.sender]);
});

test('uncertain sharing durability fails closed until restart reads the committed ACL', async t => {
  const f = await sharingFixture(t);
  const room = await f.sharing.createRoom({ name: 'Scoped room', members: [ids.sender, ids.recipient] }, admin);
  const file = { ownerId: ids.sender, roomId: room.id };
  const original = fs.open;
  const mock = t.mock.method(fs, 'open', async (filename, ...args) => {
    if (filename === f.dir) return { async sync() { throw Object.assign(new Error('Synthetic directory sync failure'), { code: 'EIO' }); }, async close() {} };
    return original(filename, ...args);
  });
  await assert.rejects(f.sharing.updateRoom(room.id, { members: [ids.sender] }, admin), code('EIO'));
  assert.equal(f.sharing.health().degraded, true);
  assert.equal(f.sharing.canRead(file, peer(ids.recipient)), false);
  assert.equal(f.sharing.canRead(file, admin), false);
  assert.throws(() => f.sharing.history(admin), code('SHARING_UNAVAILABLE'));
  mock.mock.restore();
  await f.restart();
  assert.equal(f.sharing.canRead(file, peer(ids.recipient)), false);
  assert.equal(f.sharing.canRead(file, peer(ids.sender)), true);
});

test('expiry, rotation and revoke callbacks identify the ended device without credentials', async t => {
  let time = 1000;
  const ended = [];
  const f = await sessionFixture(t, { now: () => time, sessionTtlMs: 1000, onRevoke: (hash, device) => ended.push({ hash, device }) });
  const first = await f.sessions.authenticate({ code: PIN }, request());
  const second = await f.sessions.authenticate({ code: PIN }, request(first.token));
  assert.equal(ended[0].device.id, first.clientId);
  assert.equal(ended[0].device.name, first.name);
  assert.equal('tokenHash' in ended[0].device, false);
  assert.equal('token' in ended[0].device, false);
  time += 1000;
  f.sessions.sweep();
  assert.equal(ended.length, 2);
  assert.equal(ended[1].device.id, second.clientId);
});
