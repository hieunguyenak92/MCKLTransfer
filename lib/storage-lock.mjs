import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const LOCK_DIRECTORY = '.mckl-lock';
const OWNER_FILE = /^owner-[a-f0-9]{32}\.json$/;
const locked = () => Object.assign(new Error('This data directory is already in use, or its previous lock cannot be safely recovered.'), { statusCode: 503, code: 'STORAGE_LOCKED' });

// Some platforms/filesystems cannot fsync directories. File fsync remains
// mandatory; only an explicitly unsupported directory operation is ignored.
export async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fsp.open(directory, fs.constants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    const unsupported = ['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR'].includes(error.code)
      || process.platform === 'win32' && ['EPERM', 'EACCES', 'EBADF'].includes(error.code);
    if (!unsupported) throw error;
  } finally { await handle?.close(); }
}

function definitelyDead(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; }
}

async function recoverDeadOwner(directory) {
  const stat = await fsp.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw locked();
  const entries = await fsp.readdir(directory);
  if (entries.length !== 1 || !OWNER_FILE.test(entries[0])) throw locked();
  const filename = path.join(directory, entries[0]);
  let handle;
  let record;
  try {
    const before = await fsp.lstat(filename);
    if (!before.isFile() || before.isSymbolicLink() || before.size > 2048) throw locked();
    handle = await fsp.open(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw locked();
    record = JSON.parse(await handle.readFile('utf8'));
  } finally { await handle?.close(); }
  if (record.version !== 1 || record.hostname !== os.hostname() || !Number.isSafeInteger(record.pid) || record.pid < 1 || !definitelyDead(record.pid)) throw locked();
  // An owner has a unique filename. Only the process that successfully removes
  // that exact dead owner's file may remove the now-empty directory. A second
  // reclaimer must not rmdir a directory acquired by a new owner in between.
  try { await fsp.unlink(filename); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  try { await fsp.rmdir(directory); }
  catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
}

export async function acquireStorageLock(shareDir) {
  const root = await fsp.realpath(shareDir);
  const directory = path.join(root, LOCK_DIRECTORY);
  const token = crypto.randomBytes(16).toString('hex');
  const filename = path.join(directory, `owner-${token}.json`);
  let acquired = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await fsp.mkdir(directory, { mode: 0o700 }); acquired = true; break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try { await recoverDeadOwner(directory); }
      catch (failure) {
        if (failure.code === 'ENOENT') continue;
        if (failure.code === 'STORAGE_LOCKED') throw failure;
        throw locked();
      }
    }
  }
  if (!acquired) throw locked();
  let released = false;
  async function release() {
    if (released) return;
    released = true;
    try { await fsp.unlink(filename); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await fsp.rmdir(directory); }
    catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
    await syncDirectory(root);
  }
  let handle;
  try {
    handle = await fsp.open(filename, 'wx', 0o600);
    await handle.writeFile(JSON.stringify({ version: 1, pid: process.pid, hostname: os.hostname(), token }));
    await handle.sync();
    await handle.close();
    handle = undefined;
    await syncDirectory(directory);
    await syncDirectory(root);
    return release;
  } catch (error) {
    await handle?.close().catch(() => {});
    await release().catch(() => {});
    throw error;
  }
}
