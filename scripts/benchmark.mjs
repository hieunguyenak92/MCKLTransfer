import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

// Usage: node scripts/benchmark.mjs --mode=resumable --mib=64 --runs=3 --concurrency=1
// --mode=stream retains the legacy one-request upload measurement.
// --url=https://host.example/ uses BENCH_SHARE_CODE from the environment.
// The default resumable mode includes source prehash in the overall upload metric;
// transfer-phase timings include chunk hashing and final server verification/commit.
// Node crypto and loopback measurements do not represent browser CPU or LAN speed.

const MIB = 1024 * 1024;
const script = fileURLToPath(import.meta.url);

function positiveOption(name, fallback, max) {
  const raw = process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`Invalid --${name}; allowed range 1..${max}`);
  return value;
}

function percentile(values, fraction) {
  return [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)];
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function worker() {
  const { createApp } = await import('../server.mjs');
  const app = createApp({ host: '127.0.0.1', port: 0, shareDir: process.env.MCKL_BENCH_SHARE_DIR, shareCode: '123456', deviceName: 'Synthetic benchmark host' });
  await app.start();
  let peakRss = process.memoryUsage().rss;
  const cpuStart = process.cpuUsage();
  const sample = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 25);
  process.on('message', async message => {
    if (message?.type === 'metrics') {
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      process.send?.({ type: 'metrics', peakRssBytes: peakRss, cpuMicros: process.cpuUsage(cpuStart), sampleIntervalMs: 25 });
    }
    if (message?.type === 'stop') {
      clearInterval(sample);
      await app.stop();
      process.disconnect?.();
    }
  });
  process.send?.({ type: 'ready', port: app.server.address().port });
}

async function startWorker(shareDir) {
  const child = fork(script, ['--worker'], { env: { ...process.env, MCKL_BENCH_SHARE_DIR: shareDir }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Local benchmark server startup timed out')); }, 10_000);
    const fail = () => { clearTimeout(timer); reject(new Error('Local benchmark server stopped before startup')); };
    child.once('exit', fail);
    child.once('error', reject);
    child.on('message', message => {
      if (message?.type === 'ready') { clearTimeout(timer); child.off('exit', fail); resolve(message); }
    });
  });
  return { child, base: new URL(`http://127.0.0.1:${ready.port}`) };
}

function workerMetrics(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.off('message', onMessage); reject(new Error('Server metrics request timed out')); }, 3000);
    function onMessage(message) {
      if (message?.type === 'metrics') { clearTimeout(timer); child.off('message', onMessage); resolve(message); }
    }
    child.on('message', onMessage);
    child.send({ type: 'metrics' });
  });
}

async function stopWorker(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => child.kill('SIGTERM'), 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    if (child.connected) child.send({ type: 'stop' });
    else child.kill('SIGTERM');
  });
}

async function authenticate(base, code) {
  const response = await fetch(new URL('/api/auth', base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Benchmark authentication failed with HTTP ${response.status}`);
  const headers = response.headers.getSetCookie();
  const cookies = headers.map(value => value.split(';')[0]).join('; ');
  if (!cookies) throw new Error('Server did not issue a benchmark session');
  return cookies;
}

function checkUploadedFile(file, bytes, expectedHash) {
  if (!/^[a-f0-9]{24}$/.test(file.id) || file.size !== bytes || file.hash !== expectedHash) throw new Error('Upload result does not match the synthetic source length/hash');
}

async function uploadStream(base, cookie, filePath, bytes, expectedHash) {
  const start = performance.now();
  const url = new URL('/api/upload', base);
  const transport = url.protocol === 'https:' ? https : http;
  let request;
  const responsePromise = new Promise((resolve, reject) => {
    request = transport.request(url, { method: 'POST', headers: { Cookie: cookie, 'Content-Length': bytes, 'x-file-size': bytes, 'x-file-name': `benchmark-${crypto.randomBytes(8).toString('hex')}.bin`, 'x-file-type': 'application/octet-stream' } }, response => {
      const chunks = [];
      let length = 0;
      response.on('data', chunk => {
        length += chunk.length;
        if (length > 64 * 1024) response.destroy(new Error('Unexpectedly large benchmark metadata response'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode !== 201) return reject(new Error(`Upload failed with HTTP ${response.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('Invalid upload metadata response')); }
      });
    });
    request.on('error', reject);
    request.setTimeout(120_000, () => request.destroy(new Error('Benchmark upload was idle for 120 seconds')));
  });
  const [file] = await Promise.all([responsePromise, pipeline(createReadStream(filePath, { highWaterMark: MIB }), request)]);
  checkUploadedFile(file, bytes, expectedHash);
  return { file, phases: { sourceReadAndUploadSeconds: (performance.now() - start) / 1000, note: 'One streaming request; source read, network and server hashing overlap.' } };
}

async function sourcePrehash(filename) {
  const start = performance.now();
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(filename, { highWaterMark: MIB })) hash.update(chunk);
  return { hash: hash.digest('hex'), seconds: (performance.now() - start) / 1000 };
}

async function metadataJson(response) {
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 64 * 1024) throw new Error('Unexpectedly large benchmark metadata response');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid benchmark metadata response'); }
}

async function cancelTransfer(base, cookie, id) {
  const response = await fetch(new URL(`/api/uploads/${id}`, base), { method: 'DELETE', headers: { Cookie: cookie }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok && response.status !== 404) throw new Error(`Synthetic transfer cleanup failed with HTTP ${response.status}`);
}

async function uploadResumable(base, cookie, filename, bytes, expectedHash, pendingTransfers, uploaded) {
  let id;
  let source;
  const phases = { createRequestSeconds: 0, sourceReadSeconds: 0, chunkDigestSeconds: 0, chunkRequestSeconds: 0, completionRequestSeconds: 0, chunkCount: 0, chunkSizeBytes: null };
  try {
    let start = performance.now();
    const createdResponse = await fetch(new URL('/api/uploads', base), {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `benchmark-${crypto.randomBytes(8).toString('hex')}.bin`, size: bytes, mime: 'application/octet-stream', sha256: expectedHash }),
      signal: AbortSignal.timeout(30_000),
    });
    if (createdResponse.status !== 201) throw new Error(`Resumable creation failed with HTTP ${createdResponse.status}`);
    const created = await metadataJson(createdResponse);
    phases.createRequestSeconds = (performance.now() - start) / 1000;
    if (!/^[a-f0-9]{24}$/.test(created.id)) throw new Error('Invalid resumable upload identifier');
    id = created.id;
    pendingTransfers.set(id, true);
    if (created.offset !== 0 || created.size !== bytes || !Number.isSafeInteger(created.chunkSize) || created.chunkSize < 1 || created.chunkSize > 16 * MIB) throw new Error('Invalid resumable upload limits');
    phases.chunkSizeBytes = created.chunkSize;
    const buffer = Buffer.allocUnsafe(Math.min(created.chunkSize, bytes));
    source = await fs.open(filename, 'r');
    for (let offset = 0; offset < bytes;) {
      const length = Math.min(buffer.length, bytes - offset);
      start = performance.now();
      const { bytesRead } = await source.read(buffer, 0, length, offset);
      phases.sourceReadSeconds += (performance.now() - start) / 1000;
      if (bytesRead !== length) throw new Error('Synthetic source changed while reading a chunk');
      const chunk = buffer.subarray(0, bytesRead);
      start = performance.now();
      const checksum = crypto.createHash('sha256').update(chunk).digest('hex');
      phases.chunkDigestSeconds += (performance.now() - start) / 1000;
      start = performance.now();
      const response = await fetch(new URL(`/api/uploads/${id}`, base), {
        method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(offset), 'X-Chunk-SHA256': checksum },
        body: chunk, signal: AbortSignal.timeout(120_000),
      });
      if (response.status !== 204) throw new Error(`Resumable chunk failed with HTTP ${response.status}`);
      if (Number(response.headers.get('upload-offset')) !== offset + bytesRead) throw new Error('Server acknowledged an unexpected resumable offset');
      phases.chunkRequestSeconds += (performance.now() - start) / 1000;
      phases.chunkCount++;
      offset += bytesRead;
    }
    await source.close();
    source = undefined;
    start = performance.now();
    const completedResponse = await fetch(new URL(`/api/uploads/${id}/complete`, base), { method: 'POST', headers: { Cookie: cookie }, signal: AbortSignal.timeout(15 * 60_000) });
    if (completedResponse.status !== 201) throw new Error(`Resumable completion failed with HTTP ${completedResponse.status}`);
    const file = await metadataJson(completedResponse);
    phases.completionRequestSeconds = (performance.now() - start) / 1000;
    // The request created this ID; retain it for cleanup even if metadata is invalid.
    uploaded.set(id, { id });
    pendingTransfers.delete(id);
    checkUploadedFile(file, bytes, expectedHash);
    if (file.id !== id) throw new Error('Resumable completion changed the created identifier');
    return { file, phases };
  } catch (error) {
    if (id && pendingTransfers.has(id)) {
      await cancelTransfer(base, cookie, id).then(() => pendingTransfers.delete(id)).catch(() => {});
    }
    throw error;
  } finally { await source?.close().catch(() => {}); }
}

async function download(base, cookie, file, expectedHash) {
  const response = await fetch(new URL(`/api/files/${file.id}/download`, base), { headers: { Cookie: cookie }, signal: AbortSignal.timeout(15 * 60_000) });
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.length; hash.update(chunk); }
  if (bytes !== file.size || hash.digest('hex') !== expectedHash) throw new Error('Downloaded payload does not match the source length/hash');
}

async function removeFile(base, cookie, file) {
  const response = await fetch(new URL(`/api/files/${file.id}`, base), { method: 'DELETE', headers: { Cookie: cookie }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Synthetic benchmark file cleanup failed with HTTP ${response.status}`);
}

async function benchmark() {
  const mib = positiveOption('mib', 64, 16_384);
  const runs = positiveOption('runs', 3, 20);
  const concurrency = positiveOption('concurrency', 1, 4);
  const uploadMode = process.argv.find(value => value.startsWith('--mode='))?.slice(7) ?? 'resumable';
  if (!['stream', 'resumable'].includes(uploadMode)) throw new Error('--mode must be stream or resumable');
  const remote = process.argv.find(value => value.startsWith('--url='))?.slice(6);
  const base = remote ? new URL(remote) : null;
  if (base && (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/')) throw new Error('--url must be an HTTP(S) origin without credentials, path, query or fragment');
  if (base && !process.env.BENCH_SHARE_CODE) throw new Error('Set BENCH_SHARE_CODE in the environment when testing a specified server');
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'mckl-benchmark-'));
  let local;
  let clientPeakRss = process.memoryUsage().rss;
  let sampler;
  const uploaded = new Map();
  const pendingTransfers = new Map();
  let cookie;
  let endpoint;
  try {
    const sourcePath = path.join(scratch, 'synthetic-source.bin');
    const bytes = mib * MIB;
    const sourceHash = crypto.createHash('sha256');
    await pipeline(Readable.from((async function* () {
      for (let remaining = bytes; remaining > 0;) {
        const chunk = crypto.randomBytes(Math.min(remaining, MIB));
        sourceHash.update(chunk);
        remaining -= chunk.length;
        yield chunk;
      }
    })(), { objectMode: false, highWaterMark: MIB }), createWriteStream(sourcePath, { flags: 'wx', mode: 0o600 }));
    const expectedHash = sourceHash.digest('hex');
    if (!base) local = await startWorker(path.join(scratch, 'server-data'));
    endpoint = base ?? local.base;
    cookie = await authenticate(endpoint, base ? process.env.BENCH_SHARE_CODE : '123456');
    sampler = setInterval(() => { clientPeakRss = Math.max(clientPeakRss, process.memoryUsage().rss); }, 25);
    const results = [];
    for (let run = 1; run <= runs; run++) {
      const overallUploadStart = performance.now();
      const prehashStart = performance.now();
      const prehashes = uploadMode === 'resumable' ? await Promise.all(Array.from({ length: concurrency }, () => sourcePrehash(sourcePath))) : [];
      if (prehashes.some(result => result.hash !== expectedHash)) throw new Error('Source prehash does not match the generated synthetic fixture');
      const sourcePrehashSeconds = uploadMode === 'resumable' ? (performance.now() - prehashStart) / 1000 : 0;
      const uploadStart = performance.now();
      const transferResults = await Promise.allSettled(Array.from({ length: concurrency }, async () => {
        const transfer = uploadMode === 'resumable'
          ? await uploadResumable(endpoint, cookie, sourcePath, bytes, expectedHash, pendingTransfers, uploaded)
          : await uploadStream(endpoint, cookie, sourcePath, bytes, expectedHash);
        const file = transfer.file;
        uploaded.set(file.id, file);
        return transfer;
      }));
      const failedTransfer = transferResults.find(result => result.status === 'rejected');
      if (failedTransfer) throw failedTransfer.reason;
      const transfers = transferResults.map(result => result.value);
      const uploadTransferSeconds = (performance.now() - uploadStart) / 1000;
      const overallUploadSeconds = (performance.now() - overallUploadStart) / 1000;
      const files = transfers.map(transfer => transfer.file);
      const downloadStart = performance.now();
      await Promise.all(files.map(file => download(endpoint, cookie, file, expectedHash)));
      const downloadSeconds = (performance.now() - downloadStart) / 1000;
      for (const file of files) { await removeFile(endpoint, cookie, file); uploaded.delete(file.id); }
      results.push({ run, payloadBytes: bytes * concurrency, sourcePrehashSeconds, sourcePrehashPerFileSeconds: prehashes.map(result => result.seconds), uploadTransferSeconds, uploadTransferMiBPerSecond: mib * concurrency / uploadTransferSeconds, overallUploadSeconds, overallUploadMiBPerSecond: mib * concurrency / overallUploadSeconds, perFileTransferPhases: transfers.map(transfer => transfer.phases), downloadSeconds, downloadMiBPerSecond: mib * concurrency / downloadSeconds, sourceAndReceiverSha256Match: true });
    }
    const serverMetrics = local ? await workerMetrics(local.child) : null;
    clientPeakRss = Math.max(clientPeakRss, process.memoryUsage().rss);
    console.log(JSON.stringify({ mode: uploadMode, endpointScope: local ? 'local-loopback-only' : 'specified-server-path', transport: endpoint.protocol.slice(0, -1), payloadMiBPerFile: mib, concurrentFiles: concurrency, runs, sourceGenerationExcludedFromTiming: true, sourceReadCache: 'warm after fixture generation', sourcePrehashIncludedInOverallUpload: uploadMode === 'resumable', concurrencyScheduling: 'Each run prehashes all logical files before concurrent transfers; phase durations are batch wall times, per-file durations overlap.', completionPhaseScope: 'Completion request includes server whole-file hash verification and metadata commit, plus request/response overhead.', durabilityScope: 'HTTP completion and hash verification; does not certify power-loss durability', sourcePrehashMedianSeconds: median(results.map(result => result.sourcePrehashSeconds)), uploadTransferMedianMiBPerSecond: median(results.map(result => result.uploadTransferMiBPerSecond)), overallUploadMedianMiBPerSecond: median(results.map(result => result.overallUploadMiBPerSecond)), overallUploadP95Seconds: percentile(results.map(result => result.overallUploadSeconds), 0.95), downloadMedianMiBPerSecond: median(results.map(result => result.downloadMiBPerSecond)), clientSampledPeakRssBytes: clientPeakRss, serverMetrics, results, syntheticFilesRemoved: true, clientCpuLimitation: 'Source and chunk SHA-256 use Node crypto; this does not measure browser hashing, rendering or browser memory.', limitation: local ? 'Loopback combines disk, runtime and local networking; this is not a LAN/Wi-Fi or fastest-transport result.' : 'Only this client/server path was measured; server RSS and other devices were not observed.' }, null, 2));
  } finally {
    clearInterval(sampler);
    if (endpoint && cookie) for (const id of pendingTransfers.keys()) await cancelTransfer(endpoint, cookie, id).catch(() => {});
    if (endpoint && cookie) for (const file of uploaded.values()) await removeFile(endpoint, cookie, file).catch(() => {});
    if (local) await stopWorker(local.child);
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

try {
  if (process.argv.includes('--worker')) await worker();
  else await benchmark();
} catch (error) {
  console.error(`Benchmark failed: ${error.message}`);
  process.exitCode = 1;
  if (process.argv.includes('--worker')) process.disconnect?.();
}
