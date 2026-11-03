import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { setTimeout as sleep } from 'node:timers/promises';

const appSource = await fs.readFile(new URL('../public/client.js', import.meta.url), 'utf8');
const i18nSource = await fs.readFile(new URL('../public/i18n.js', import.meta.url), 'utf8');

// These tests execute the shipped client and its real UI handlers. The DOM and
// transport are deterministic adapters; browser/backend integration is separate.
class Element {
  constructor() {
    this.children = []; this.listeners = {}; this.attributes = {}; this.style = {};
    this.value = ''; this.className = ''; this.textContent = ''; this.disabled = false; this.checked = false;
    this.clientHeight = 200; this.scrollHeight = 200; this.scrollTop = 0;
    this.classList = {
      contains: name => this.className.split(' ').includes(name),
      add: name => { if (!this.classList.contains(name)) this.className += ` ${name}`; },
      remove: name => { this.className = this.className.split(' ').filter(value => value !== name).join(' '); },
      toggle: (name, force) => {
        const enabled = force ?? !this.classList.contains(name);
        if (enabled) this.classList.add(name); else this.classList.remove(name);
        return enabled;
      },
    };
  }
  append(...elements) { for (const element of elements) { element.parent = this; this.children.push(element); } }
  replaceChildren(...elements) { this.children = []; this.append(...elements); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(element => element !== this); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  closest() { return null; }
  click() { if (!this.disabled) this.onclick?.({ target: this, preventDefault() {} }); }
  focus() { this.onFocus?.(); }
}

function fixtureServer() {
  return { authenticated: true, clientId: 'fixture-client', uploads: new Map(), completed: new Map(), sequence: 0, active: 0, peak: 0, createCalls: 0, deleteCalls: 0, logoutCalls: 0, authCalls: 0, failRefresh: false, failLogout: false, failAuth: false, chunkFailure: null, chunkFailures: [] };
}

function createClient(server = fixtureServer(), storage = new Map()) {
  const elements = new Map(); const timers = new Set(); const sources = [];
  let disposed = false;
  const element = selector => {
    if (!elements.has(selector)) {
      const node = new Element();
      node.onFocus = () => { document.activeElement = node; };
      elements.set(selector, node);
    }
    return elements.get(selector);
  };
  const document = {
    querySelector: element,
    querySelectorAll(selector) {
      const attribute = /^\[([^\]]+)\]$/.exec(selector)?.[1];
      return [...elements.values()].filter(node => attribute && node.getAttribute(attribute) !== null);
    },
    createElement: () => new Element(), body: new Element(), documentElement: new Element(), activeElement: null,
  };
  element('#transferList').className = 'transfer-list empty-state';
  const schedule = (callback, ms, ...args) => {
    if (disposed) return undefined;
    const timer = setTimeout(() => { timers.delete(timer); callback(...args); }, ms);
    timers.add(timer); return timer;
  };
  const cancel = timer => { clearTimeout(timer); timers.delete(timer); };
  const response = (body, status = 200, headers = {}) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const context = {
    console, performance, Blob, File, Response, Headers, AbortController, DOMException, Math, JSON, Promise, Map, Set, Array, Object, Number, String, Date, Error, Uint8Array, TextEncoder,
    setTimeout: schedule, clearTimeout: cancel,
    requestAnimationFrame: callback => schedule(callback, 0),
    window: { isSecureContext: false, prompt() {}, addEventListener() {} }, navigator: { languages: ['vi-VN'], language: 'vi-VN' }, location: { origin: 'http://127.0.0.1:8787', protocol: 'http:' },
    document,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }, confirm: () => true,
  };
  context.Worker = class {
    constructor() { this.closed = false; }
    postMessage({ id, blob }) {
      void blob.arrayBuffer().then(bytes => {
        schedule(() => {
          if (this.closed) return;
          this.onmessage?.({ data: { id, progress: blob.size, total: blob.size } });
          this.onmessage?.({ data: { id, digest: crypto.createHash('sha256').update(new Uint8Array(bytes)).digest('hex') } });
        }, 2);
      });
    }
    terminate() { this.closed = true; }
  };
  context.EventSource = class {
    constructor() { this.listeners = {}; this.closed = false; sources.push(this); }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    emit(type, body) { if (!this.closed) this.listeners[type]?.({ data: JSON.stringify(body) }); }
    close() { this.closed = true; }
  };
  context.fetch = async (url, options = {}) => {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (url === '/api/config') return response({ version: 'fixture', maxFileSize: 100_000, chunkSize: 4, maxConcurrentUploads: 2, ...(server.authenticated ? { clientId: server.clientId, role: 'peer', permissions: { deleteOwn: true } } : {}) });
    if (url === '/api/auth') {
      server.authCalls++;
      if (server.failAuth) return response({ error: 'INVALID_CODE', message: 'That code is not correct.' }, 401);
      server.authenticated = true; server.clientId = `fixture-${++server.sequence}`; return response({ clientId: server.clientId });
    }
    if (url === '/api/logout') {
      server.logoutCalls++;
      if (server.failLogout) return response({ message: 'Fixture logout failure' }, 500);
      server.authenticated = false; return response({ ok: true });
    }
    if (!server.authenticated) return response({ message: 'Authentication required' }, 401);
    if (url === '/api/files') return server.failRefresh ? response({ message: 'Fixture list failure' }, 500) : response({ files: [] });
    if (url === '/api/messages') return response({ messages: [], clientId: server.clientId });
    if (url === '/api/uploads' && options.method === 'POST') {
      const body = JSON.parse(options.body); const id = String(++server.sequence);
      server.createCalls++; server.uploads.set(id, { ...body, offset: 0, chunks: [] });
      return response({ id, offset: 0, chunkSize: 4 }, 201);
    }
    const match = url.match(/^\/api\/uploads\/(\d+)(\/complete)?$/);
    if (match) {
      const upload = server.uploads.get(match[1]);
      if (!upload) return response({ message: 'Not found' }, 404);
      if (options.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Upload-Offset': String(upload.offset) } });
      if (options.method === 'DELETE') {
        server.deleteCalls++;
        const override = await server.deleteUpload?.(match[1]);
        if (override) return override;
        server.uploads.delete(match[1]); return response({ ok: true });
      }
      if (match[2] && options.method === 'POST') {
        assert.equal(upload.offset, upload.size);
        assert.equal(crypto.createHash('sha256').update(Buffer.concat(upload.chunks)).digest('hex'), upload.sha256);
        server.completed.set(match[1], upload); server.uploads.delete(match[1]);
        return response({ id: match[1], hash: upload.sha256, size: upload.size }, 201);
      }
    }
    throw new Error(`Unexpected fixture request: ${options.method || 'GET'} ${url}`);
  };
  context.XMLHttpRequest = class {
    constructor() { this.upload = {}; this.headers = {}; this.done = false; }
    open(method, url) { assert.equal(method, 'PATCH'); this.url = url; }
    setRequestHeader(key, value) { this.headers[key] = value; }
    getResponseHeader(key) { return this.responseHeaders?.[key] ?? null; }
    send(blob) {
      this.partial = server.uploads.get(this.url.split('/').pop());
      const offset = Number(this.headers['Upload-Offset']);
      if (offset !== this.partial.offset) { this.status = 409; schedule(() => this.onload(), 0); return; }
      server.active++; server.peak = Math.max(server.peak, server.active);
      this.progressTimer = schedule(() => this.upload.onprogress?.({ loaded: Math.ceil(blob.size / 2) }), 5);
      this.timer = schedule(() => {
        void blob.arrayBuffer().then(data => {
          if (this.done) return;
          this.done = true; server.active--;
          const bytes = Buffer.from(data);
          assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), this.headers['x-chunk-sha256']);
          const chunkFailure = server.chunkFailures.shift() || server.chunkFailure;
          if (chunkFailure) {
            const { status, ...body } = chunkFailure;
            this.status = status; this.responseText = JSON.stringify(body); this.onload(); return;
          }
          this.partial.chunks.push(bytes); this.partial.offset += bytes.length;
          this.responseHeaders = { 'Upload-Offset': String(this.partial.offset) }; this.status = 204; this.onload();
        });
      }, 25);
    }
    abort() {
      if (this.done) return;
      this.done = true; cancel(this.timer); cancel(this.progressTimer);
      if (this.partial) server.active--;
      this.onabort?.();
    }
  };
  vm.createContext(context);
  vm.runInContext(i18nSource, context, { filename: 'public/i18n.js' });
  vm.runInContext(appSource, context, { filename: 'public/client.js' });
  const evaluate = expression => vm.runInContext(expression, context);
  return {
    server, storage, element, sources, evaluate, document,
    transfers: () => evaluate('[...state.transfers.values()]'),
    selectFiles(files) { const input = element('#fileInput'); input.files = files; input.onchange({ target: input }); },
    selectLanguage(language) { const select = element('#languageSelect'); select.value = language; select.onchange({ target: select }); },
    dispose() {
      evaluate('showAuth();');
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}

async function until(predicate, description) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(5);
  }
  assert.fail(`Timed out: ${description}`);
}
async function ready(client) { await until(() => client.evaluate('state.authenticated'), 'initial session'); }
function uploadButton(item, action) { return action === 'pause' || action === 'resume' ? item.elements.toggle : item.elements.cancel; }

test('client keeps a single two-worker queue across picks and finishes despite list refresh failures', async t => {
  const client = createClient(); t.after(() => client.dispose()); await ready(client);
  const files = ['one', 'two', 'three', 'four', 'five'].map((name, index) => new File(['12345678'], `${name}.txt`, { lastModified: index + 1 }));
  client.server.failRefresh = true;
  client.selectFiles(files.slice(0, 3)); client.selectFiles(files.slice(3));
  await until(() => client.transfers().filter(item => item.phase === 'done').length === 5, 'all five uploads finish');
  await until(() => client.evaluate('state.activeUploads') === 0, 'all worker slots released');
  assert.equal(client.server.peak, 2);
  assert.equal(client.server.completed.size, 5);
});

test('client pauses an in-flight chunk and resumes the server offset after a reload and file reselection', async t => {
  const server = fixtureServer(); const storage = new Map(); const first = createClient(server, storage);
  t.after(() => first.dispose()); await ready(first);
  const file = new File(['ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'], 'resume.txt', { lastModified: 100 });
  first.selectFiles([file]);
  await until(() => first.transfers()[0]?.offset >= 4 && server.active > 0, 'a committed chunk and an active next chunk');
  const original = first.transfers()[0]; const uploadId = original.uploadId;
  uploadButton(original, 'pause').click();
  await until(() => !original.running, 'paused upload releases worker');
  assert.equal(original.phase, 'paused');
  assert.equal(server.active, 0);
  const committedOffset = server.uploads.get(uploadId).offset;
  assert.ok(committedOffset > 0 && committedOffset < file.size);
  first.dispose();
  const second = createClient(server, storage); t.after(() => second.dispose()); await ready(second);
  second.selectFiles([file]);
  await until(() => second.transfers()[0]?.phase === 'done', 'reselected file completes');
  assert.equal(server.createCalls, 1, 'resume reuses the existing upload session');
  assert.equal(server.completed.get(uploadId).offset, file.size);
  assert.equal(Buffer.concat(server.completed.get(uploadId).chunks).toString(), await file.text());
});

test('client cancellation aborts a live request and deletes its partial upload', async t => {
  const client = createClient(); t.after(() => client.dispose()); await ready(client);
  client.selectFiles([new File(['abcdefghijklmnopqrstuvwxyz'], 'cancel.txt', { lastModified: 200 })]);
  await until(() => client.server.active > 0, 'live chunk request');
  const item = client.transfers()[0]; const uploadId = item.uploadId;
  uploadButton(item, 'cancel').click();
  await until(() => item.phase === 'cancelled' && !item.running, 'confirmed cancellation');
  assert.equal(client.server.active, 0);
  assert.equal(client.server.uploads.has(uploadId), false);
  assert.equal(client.server.completed.has(uploadId), false);
});

test('a repeated file selection owns a separate upload and cancellation preserves the first partial', async t => {
  const client = createClient(); t.after(() => client.dispose()); await ready(client);
  const file = new File(['ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'], 'duplicate.txt', { lastModified: 250 });
  client.selectFiles([file]);
  await until(() => client.transfers()[0]?.offset >= 4 && client.server.active > 0, 'first duplicate has a committed chunk');
  const first = client.transfers()[0];
  uploadButton(first, 'pause').click();
  await until(() => !first.running, 'first duplicate is paused');
  const firstId = first.uploadId;
  const firstOffset = client.server.uploads.get(firstId).offset;

  client.selectFiles([file]);
  await until(() => client.transfers()[1]?.uploadId && client.server.active > 0, 'second duplicate has a live upload');
  const second = client.transfers()[1]; const secondId = second.uploadId;
  uploadButton(second, 'cancel').click();
  await until(() => second.phase === 'cancelled' && !second.running, 'second duplicate is cancelled');

  assert.ok(client.server.uploads.has(firstId), 'cancelling the second selection preserves the first partial');
  assert.equal(client.server.uploads.get(firstId).offset, firstOffset);
  assert.notEqual(secondId, firstId, 'each transfer has exclusive ownership of its upload ID');
  assert.equal(client.server.uploads.has(secondId), false);
  assert.ok(JSON.parse(client.storage.get('mckl_uploads_v1')).some(record => record.id === firstId));
  uploadButton(first, 'resume').click();
  await until(() => first.phase === 'done', 'first duplicate resumes to completion');
  assert.equal(client.server.createCalls, 2);
  assert.equal(client.server.completed.get(firstId).offset, file.size);
});

test('same-metadata files with different contents retain distinct resumable sessions', async t => {
  const server = fixtureServer(); const storage = new Map(); const first = createClient(server, storage);
  t.after(() => first.dispose()); await ready(first);
  const files = [new File(['A'.repeat(36)], 'same.txt', { lastModified: 275 }), new File(['B'.repeat(36)], 'same.txt', { lastModified: 275 })];
  const ids = [];
  for (const [index, file] of files.entries()) {
    first.selectFiles([file]);
    await until(() => first.transfers()[index]?.offset >= 4 && server.active > 0, 'same-metadata file has a committed chunk');
    const item = first.transfers()[index];
    uploadButton(item, 'pause').click();
    await until(() => !item.running, 'same-metadata file is paused');
    ids.push(item.uploadId);
  }
  assert.notEqual(ids[0], ids[1]);
  assert.equal(JSON.parse(storage.get('mckl_uploads_v1')).length, 2, 'metadata collisions retain both source hashes');
  first.dispose();

  const reloaded = createClient(server, storage); t.after(() => reloaded.dispose()); await ready(reloaded);
  reloaded.selectFiles(files);
  await until(() => reloaded.transfers().every(item => item.phase === 'done') && server.completed.size === 2, 'both distinct sources resume');
  assert.equal(server.createCalls, 2, 'both sources reuse their original upload sessions');
  for (const [index, id] of ids.entries()) assert.equal(Buffer.concat(server.completed.get(id).chunks).toString(), await files[index].text());
});

test('repeated cancellation waits for one server deletion before changing state', async t => {
  const client = createClient(); t.after(() => client.dispose()); await ready(client);
  client.selectFiles([new File(['ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'], 'cancel-twice.txt', { lastModified: 290 })]);
  await until(() => client.server.active > 0, 'request before repeated cancellation');
  const item = client.transfers()[0];
  uploadButton(item, 'pause').click();
  await until(() => !item.running, 'paused request before repeated cancellation');
  const deletions = [];
  client.server.deleteUpload = () => new Promise(resolve => deletions.push(resolve));
  uploadButton(item, 'cancel').click();
  uploadButton(item, 'cancel').click();
  try { assert.equal(client.server.deleteCalls, 1, 'only one deletion may own the cancellation result'); }
  finally { for (const resolve of deletions) resolve(null); }
  await until(() => item.phase === 'cancelled', 'confirmed single cancellation');
});

test('client reports logout only after server confirmation and clears resumable ownership', async t => {
  const client = createClient(); t.after(() => client.dispose()); await ready(client);
  client.selectFiles([new File(['abcdefghijklmnopqrstuvwxyz'], 'logout.txt', { lastModified: 300 })]);
  await until(() => client.server.active > 0, 'live upload before logout');
  client.server.failLogout = true;
  client.element('#disconnectButton').click();
  await until(() => client.server.logoutCalls === 1 && !client.element('#disconnectButton').disabled, 'failed logout response');
  assert.equal(client.evaluate('state.authenticated'), true);
  assert.match(client.element('#toast').textContent, /Chưa xác nhận đăng xuất/);
  client.server.failLogout = false;
  client.element('#disconnectButton').click();
  await until(() => client.server.logoutCalls === 2 && !client.evaluate('state.authenticated'), 'successful logout');
  assert.equal(client.evaluate('state.clientId'), null);
  assert.equal(JSON.parse(client.storage.get('mckl_uploads_v1')).length, 0);
  assert.equal(client.transfers()[0].uploadId, null);
});

test('client bounds live chat history received through the actual event handler', async t => {
  const client = createClient(); t.after(() => client.dispose()); await ready(client);
  await until(() => client.sources.length > 0, 'SSE connected');
  const source = client.sources.at(-1);
  for (let index = 0; index < 250; index++) source.emit('chat', { message: { id: String(index), text: `message ${index}`, senderId: 'other', sentAt: new Date().toISOString() } });
  assert.equal(client.evaluate('state.messages.size'), 200);
  assert.equal(client.evaluate('state.messages.has("0")'), false);
  assert.equal(client.evaluate('state.messages.has("249")'), true);
  assert.equal(client.element('#chatMessages').children.length, 200);
});

test('switching the actual language selector preserves a live upload, session, SSE and input state', async t => {
  const client = createClient(); t.after(() => client.dispose()); await ready(client);
  const file = new File(['ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'], 'changing-language.txt', { lastModified: 400 });
  client.selectFiles([file]);
  await until(() => client.transfers()[0]?.offset >= 4 && client.server.active > 0, 'committed upload before switching language');
  const item = client.transfers()[0];
  const uploadId = item.uploadId;
  const resumeRecord = client.storage.get('mckl_uploads_v1');
  const clientId = client.evaluate('state.clientId');
  const source = client.sources.at(-1);
  const chat = client.element('#chatInput');
  const deviceName = client.element('#deviceNameInput');
  const code = client.element('#codeInput');
  chat.value = 'Tin nhắn nháp / draft message'; chat.selectionStart = 4; chat.selectionEnd = 9; chat.focus();
  deviceName.value = 'Điện thoại QA / 私の端末'; code.value = '123456';
  client.element('#rememberDevice').checked = true;

  client.selectLanguage('en');

  assert.equal(client.document.documentElement.lang, 'en');
  assert.equal(client.element('#languageSelect').value, 'en');
  assert.equal(client.element('#connectionLabel').textContent, 'Connected');
  assert.equal(client.storage.get('mckl_language_v1'), 'en');
  assert.equal(client.transfers()[0], item);
  assert.equal(item.uploadId, uploadId);
  assert.equal(client.storage.get('mckl_uploads_v1'), resumeRecord);
  assert.equal(client.evaluate('state.authenticated'), true);
  assert.equal(client.evaluate('state.clientId'), clientId);
  assert.equal(client.evaluate('state.eventSource'), source);
  assert.equal(client.sources.length, 1);
  assert.equal(source.closed, false);
  assert.equal(client.document.activeElement, chat);
  assert.equal(chat.value, 'Tin nhắn nháp / draft message');
  assert.equal(chat.selectionStart, 4); assert.equal(chat.selectionEnd, 9);
  assert.equal(deviceName.value, 'Điện thoại QA / 私の端末');
  assert.equal(code.value, '123456');
  assert.equal(client.element('#rememberDevice').checked, true);
  assert.match(item.elements.meta.textContent, /^Sending /);
  assert.equal(item.elements.bar.getAttribute('aria-label'), 'Progress for changing-language.txt');

  source.emit('chat', { message: { id: 'after-language-switch', text: 'SSE still connected', senderId: 'other', sentAt: new Date().toISOString() } });
  assert.equal(client.evaluate('state.messages.get("after-language-switch").text'), 'SSE still connected');
  await until(() => item.phase === 'done' && !item.running, 'upload completes after language switch');
  assert.equal(client.server.createCalls, 1, 'changing language does not create a new upload');
  const completed = client.server.completed.get(uploadId);
  assert.equal(Buffer.concat(completed.chunks).toString(), await file.text());
  assert.equal(completed.sha256, crypto.createHash('sha256').update(Buffer.concat(completed.chunks)).digest('hex'));
});

test('invalid-code API errors re-render in the selected language while preserving status and retry inputs', async t => {
  const server = fixtureServer(); server.authenticated = false; server.failAuth = true;
  const client = createClient(server); t.after(() => client.dispose());
  await until(() => client.evaluate('state.config !== null') && !client.evaluate('state.authenticated'), 'pairing screen');
  client.element('#deviceNameInput').value = 'Máy thử nghiệm';
  client.element('#codeInput').value = '000000';
  client.element('#authForm').listeners.submit({ preventDefault() {} });
  await until(() => server.authCalls === 1 && !client.element('#connectButton').disabled, 'rejected access code');
  assert.equal(client.element('#authError').textContent, 'Mã truy cập không đúng.');
  assert.equal(client.evaluate('state.authError.code'), 'INVALID_CODE');
  assert.equal(client.evaluate('state.authError.status'), 401);
  assert.equal(client.evaluate('state.authenticated'), false);

  client.selectLanguage('en');
  assert.equal(client.element('#authError').textContent, 'That access code is not correct.');
  assert.equal(client.element('#deviceNameInput').value, 'Máy thử nghiệm');
  assert.equal(client.element('#codeInput').value, '000000');
  assert.equal(client.evaluate('state.authError.code'), 'INVALID_CODE');
  assert.equal(client.evaluate('state.authError.status'), 401);

  server.failAuth = false;
  client.element('#authForm').listeners.submit({ preventDefault() {} });
  await until(() => server.authCalls === 2 && client.evaluate('state.authenticated') && !client.element('#connectButton').disabled, 'pairing succeeds after retry');
  assert.equal(client.element('#authError').textContent, '');
  assert.equal(client.element('#codeInput').value, '');
  assert.equal(client.element('#connectionLabel').textContent, 'Connected');
});

test('XHR checksum errors re-render after language switching and retry the same upload after an offset conflict', async t => {
  const client = createClient(); t.after(() => client.dispose()); await ready(client);
  client.server.chunkFailures.push({ status: 409, error: 'OFFSET_MISMATCH', message: 'The offset changed.' });
  client.server.chunkFailure = { status: 422, error: 'CHECKSUM_MISMATCH', message: 'The chunk checksum does not match.' };
  const file = new File(['ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'], 'checksum-kiểm-tra.txt', { lastModified: 500 });
  client.selectFiles([file]);
  await until(() => client.transfers()[0]?.phase === 'error' && !client.transfers()[0].running, 'checksum rejection after automatic offset recovery');
  const item = client.transfers()[0];
  const uploadId = item.uploadId;
  await until(() => item.elements?.meta.textContent === 'Checksum không khớp. Hãy kiểm tra file và thử lại.', 'Vietnamese checksum message rendered');
  assert.equal(item.error.code, 'CHECKSUM_MISMATCH');
  assert.equal(item.error.status, 422);
  assert.equal(client.server.chunkFailures.length, 0);
  assert.ok(JSON.parse(client.storage.get('mckl_uploads_v1')).some(record => record.id === uploadId));

  client.selectLanguage('en');
  assert.equal(item.elements.meta.textContent, 'Checksum mismatch. Check the file and try again.');
  assert.equal(item.elements.toggle.textContent, 'Retry');
  assert.equal(item.error.code, 'CHECKSUM_MISMATCH');
  assert.equal(item.error.status, 422);
  assert.equal(item.uploadId, uploadId);

  client.server.chunkFailure = null;
  uploadButton(item, 'resume').click();
  await until(() => item.phase === 'done' && !item.running, 'retry completes in English');
  assert.equal(client.server.createCalls, 1, 'retry preserves the resumable upload session');
  const completed = client.server.completed.get(uploadId);
  assert.equal(Buffer.concat(completed.chunks).toString(), await file.text());
  assert.equal(completed.sha256, crypto.createHash('sha256').update(Buffer.concat(completed.chunks)).digest('hex'));
});
