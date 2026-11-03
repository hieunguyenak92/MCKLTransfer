import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { Sha256 } from '../public/hash-worker.js';

test('incremental SHA-256 matches published vectors', () => {
  const vectors = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['a'.repeat(1_000_000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
  ];
  for (const [input, expected] of vectors) {
    const hash = new Sha256().update(new TextEncoder().encode(input));
    assert.equal(hash.hex(), expected);
    assert.equal(hash.hex(), expected, 'finalization is idempotent');
    assert.throws(() => hash.update(new Uint8Array([1])), /finalized/);
  }
});

test('SHA-256 padding and partial updates agree with the native implementation', () => {
  for (const size of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 1024, 65537]) {
    const bytes = Uint8Array.from({ length: size }, (_, index) => (index * 17 + size) % 256);
    const expected = crypto.createHash('sha256').update(bytes).digest('hex');
    for (const chunkSize of [1, 17, 64, 163, 8192]) {
      const hash = new Sha256();
      for (let offset = 0; offset < bytes.length; offset += chunkSize) hash.update(bytes.subarray(offset, offset + chunkSize));
      assert.equal(hash.hex(), expected, `size=${size}, update=${chunkSize}`);
    }
  }
});

test('SHA-256 encodes lengths beyond 32 bits without retaining the full input', { timeout: 60_000 }, () => {
  // 512 MiB crosses 2^32 input bits; a low-word-only length field fails here.
  // The fixture reuses 64 KiB and never allocates a 512 MiB payload.
  const block = Uint8Array.from({ length: 64 * 1024 }, (_, index) => (index * 29 + 7) % 256);
  const total = 512 * 1024 * 1024 + 137;
  const hash = new Sha256();
  const reference = crypto.createHash('sha256');
  for (let offset = 0; offset < total; offset += block.length) {
    const chunk = block.subarray(0, Math.min(block.length, total - offset));
    hash.update(chunk);
    reference.update(chunk);
  }
  assert.equal(hash.hex(), reference.digest('hex'));
});

test('the shipped hash worker responds correctly on native and incremental paths', { timeout: 15_000 }, async t => {
  const adapter = `
    import { parentPort, workerData } from 'node:worker_threads';
    import { webcrypto } from 'node:crypto';
    globalThis.self = {
      crypto: webcrypto,
      postMessage: data => parentPort.postMessage(data),
      addEventListener: (type, handler) => parentPort.on(type, data => handler({ data })),
    };
    await import(workerData.module);
    parentPort.postMessage({ ready: true });
  `;
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(adapter)}`), { workerData: { module: new URL('../public/hash-worker.js', import.meta.url).href } });
  t.after(() => worker.terminate());
  assert.deepEqual((await once(worker, 'message'))[0], { ready: true });
  async function digest(id, blob) {
    return new Promise((resolve, reject) => {
      let progressEvents = 0;
      const cleanup = () => { worker.off('message', message); worker.off('error', error); };
      const error = failure => { cleanup(); reject(failure); };
      const message = data => {
        if (data.id !== id) return;
        if (data.progress !== undefined) { progressEvents++; return; }
        cleanup();
        if (data.error) reject(new Error(data.error));
        else resolve({ value: data.digest, progressEvents });
      };
      worker.on('message', message); worker.on('error', error);
      worker.postMessage({ id, blob });
    });
  }
  for (const [id, size] of [[1, 17], [2, 9 * 1024 * 1024 + 13]]) {
    const bytes = Uint8Array.from({ length: size }, (_, index) => index % 251);
    const result = await digest(id, new Blob([bytes]));
    assert.equal(result.value, crypto.createHash('sha256').update(bytes).digest('hex'));
    if (size > 8 * 1024 * 1024) assert.ok(result.progressEvents > 0, 'large input emits incremental progress');
  }
});
