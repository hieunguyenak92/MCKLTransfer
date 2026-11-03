// Incremental SHA-256 (FIPS 180-4). File contents stay in bounded chunks.
const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotateRight = (value, bits) => (value >>> bits) | (value << (32 - bits));

export class Sha256 {
  constructor() {
    this.state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    this.words = new Uint32Array(64);
    this.tail = new Uint8Array(64);
    this.tailLength = 0;
    this.length = 0;
    this.result = null;
  }

  update(input) {
    if (this.result) throw new Error('SHA-256 has already been finalized');
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    this.length += bytes.length;
    let offset = 0;
    if (this.tailLength) {
      const count = Math.min(64 - this.tailLength, bytes.length);
      this.tail.set(bytes.subarray(0, count), this.tailLength);
      this.tailLength += count;
      offset = count;
      if (this.tailLength === 64) {
        this.processBlock(this.tail, 0);
        this.tailLength = 0;
      }
    }
    while (offset + 64 <= bytes.length) {
      this.processBlock(bytes, offset);
      offset += 64;
    }
    if (offset < bytes.length) {
      this.tail.set(bytes.subarray(offset), 0);
      this.tailLength = bytes.length - offset;
    }
    return this;
  }

  processBlock(bytes, offset) {
    const words = this.words;
    for (let index = 0; index < 16; index++) {
      const start = offset + index * 4;
      words[index] = (bytes[start] << 24) | (bytes[start + 1] << 16) | (bytes[start + 2] << 8) | bytes[start + 3];
    }
    for (let index = 16; index < 64; index++) {
      const x = words[index - 15];
      const y = words[index - 2];
      const s0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const s1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let a = this.state[0]; let b = this.state[1]; let c = this.state[2]; let d = this.state[3];
    let e = this.state[4]; let f = this.state[5]; let g = this.state[6]; let h = this.state[7];
    for (let index = 0; index < 64; index++) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choose + ROUND_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    this.state[0] = (this.state[0] + a) >>> 0;
    this.state[1] = (this.state[1] + b) >>> 0;
    this.state[2] = (this.state[2] + c) >>> 0;
    this.state[3] = (this.state[3] + d) >>> 0;
    this.state[4] = (this.state[4] + e) >>> 0;
    this.state[5] = (this.state[5] + f) >>> 0;
    this.state[6] = (this.state[6] + g) >>> 0;
    this.state[7] = (this.state[7] + h) >>> 0;
  }

  hex() {
    if (this.result) return this.result;
    const padded = new Uint8Array(this.tailLength < 56 ? 64 : 128);
    padded.set(this.tail.subarray(0, this.tailLength));
    padded[this.tailLength] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(this.length / 0x20000000));
    view.setUint32(padded.length - 4, (this.length * 8) >>> 0);
    for (let offset = 0; offset < padded.length; offset += 64) this.processBlock(padded, offset);
    this.result = [...this.state].map(value => value.toString(16).padStart(8, '0')).join('');
    return this.result;
  }
}

if (typeof self !== 'undefined' && typeof document === 'undefined') {
  self.addEventListener('message', async ({ data }) => {
    const { id, blob } = data;
    try {
      if (!(blob instanceof Blob)) throw new Error('Expected a file or blob');
      // Native hashing is faster for bounded chunks. Large files always use the
      // incremental path, so memory does not grow with the file's total size.
      if (blob.size <= 8 * 1024 * 1024 && self.crypto?.subtle) {
        const digest = await self.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        self.postMessage({ id, digest: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') });
        return;
      }
      const hash = new Sha256();
      const chunkSize = 4 * 1024 * 1024;
      let lastProgress = 0;
      for (let offset = 0; offset < blob.size; offset += chunkSize) {
        const end = Math.min(blob.size, offset + chunkSize);
        hash.update(await blob.slice(offset, end).arrayBuffer());
        if (performance.now() - lastProgress >= 100 || end === blob.size) {
          self.postMessage({ id, progress: end, total: blob.size });
          lastProgress = performance.now();
        }
      }
      self.postMessage({ id, digest: hash.hex() });
    } catch (error) {
      self.postMessage({ id, error: error.message || 'Cannot calculate checksum' });
    }
  });
}
