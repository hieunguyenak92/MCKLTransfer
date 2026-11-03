const $ = (selector) => document.querySelector(selector);
const i18n = window.MCKLI18n;
const t = (key, params) => i18n.t(key, params);
const MAX_MESSAGES = 200;
const MAX_TRANSFERS = 64;
const MAX_FINISHED = 20;
const RESUME_STORAGE = 'mckl_uploads_v1';
const state = {
  config: null, files: [], transfers: new Map(), messages: new Map(), devices: [],
  authenticated: false, clientId: null, eventSource: null, eventTimer: null,
  activeUploads: 0, renderFrame: null, sequence: 0, reconnectDelay: 1000,
  online: false, authError: null, toastMessage: null,
};

function localizedError(key, params = {}) {
  return Object.assign(new Error(t(key, params)), { i18nKey: key, i18nParams: params });
}
function errorText(error) {
  if (typeof error === 'string') return error;
  if (error?.i18nKey) {
    const params = { ...error.i18nParams };
    if (params.message instanceof Error) params.message = errorText(params.message);
    return t(error.i18nKey, params);
  }
  if (error?.code && Object.hasOwn(i18n.catalogs.en, `error.${error.code}`)) return t(`error.${error.code}`);
  if (error?.name === 'TypeError') return t('error.network');
  return error?.status ? t('error.http', { status: error.status }) : t('error.requestFailed');
}
function setAuthError(error) {
  state.authError = error;
  $('#authError').textContent = error ? errorText(error) : '';
}

function readStored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage is optional. */ }
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  for (const unit of units) {
    value /= 1024;
    if (value < 1024 || unit === 'TiB') return `${new Intl.NumberFormat(i18n.language, { minimumFractionDigits: value >= 10 ? 0 : 1, maximumFractionDigits: value >= 10 ? 0 : 1 }).format(value)} ${unit}`;
  }
}
function formatDate(value) {
  try { return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); } catch { return ''; }
}
function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return t('duration.seconds', { count: Math.ceil(seconds) });
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return t('duration.minutes', { count: minutes });
  return t('duration.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}
function iconFor(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'svg'].includes(ext) ? '▧' : ['mp4', 'mov', 'mkv', 'avi', 'webm'].includes(ext) ? '▶' : ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext) ? '⌁' : '≡';
}
function toast(message) {
  const el = $('#toast');
  state.toastMessage = message;
  el.textContent = errorText(message);
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3500);
}
async function copyText(value, options = {}) {
  try {
    if (!navigator.clipboard) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(value);
    toast(options.successMessage || t('common.copied'));
  } catch { window.prompt(options.promptMessage || t('common.copyPrompt'), value); }
}
function setOnline(online) {
  state.online = online;
  $('#connectionState').classList.toggle('online', online);
  $('#connectionState').classList.toggle('offline', !online);
  $('#connectionLabel').textContent = t(online ? 'connection.online' : 'connection.offline');
}
function abortError() { return new DOMException('Transfer stopped', 'AbortError'); }
function isAbort(error) { return error?.name === 'AbortError'; }
function stopEvents() {
  clearTimeout(state.eventTimer);
  state.eventTimer = null;
  state.eventSource?.close();
  state.eventSource = null;
}
function showAuth() {
  state.authenticated = false;
  stopEvents();
  for (const item of state.transfers.values()) if (!['done', 'cancelled', 'error', 'paused'].includes(item.phase)) pauseTransfer(item);
  $('#accessPanel').classList.remove('hidden');
  $('#appPanel').classList.add('hidden');
  setOnline(false);
}
function showApp() {
  state.authenticated = true;
  $('#accessPanel').classList.add('hidden');
  $('#appPanel').classList.remove('hidden');
  setOnline(true);
}
async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  if (!response.ok) {
    let body = {};
    try { body = await response.json(); } catch { /* No JSON body, e.g. HEAD. */ }
    const error = new Error(body.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = body.error;
    if (response.status === 401 && state.authenticated) showAuth();
    throw error;
  }
  return response;
}
async function api(path, options = {}) {
  const response = await request(path, options);
  return response.status === 204 ? null : response.json();
}
function jsonOptions(method, body, signal) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal };
}
function renderConfig() {
  const config = state.config;
  if (!config) return;
  $('#maxSize').textContent = formatBytes(config.maxFileSize);
  $('#deviceLabel').textContent = state.authenticated && config.deviceName ? t('common.host', { name: config.deviceName }) : '';
  const encrypted = location.protocol === 'https:';
  $('#transportNotice').classList.toggle('encrypted', encrypted);
  $('#transportNotice').textContent = t(encrypted ? 'transport.https' : 'transport.http');
  $('#roleLabel').textContent = t(config.role === 'admin' ? 'role.admin' : 'role.peer');
  $('#devicePanel').classList.toggle('hidden', !config.permissions?.manageDevices);
  const list = $('#addressList');
  list.replaceChildren();
  const addresses = config.addresses?.length ? config.addresses : [{ url: location.origin }];
  for (const item of addresses) {
    const row = document.createElement('div');
    row.className = 'address';
    const text = document.createElement('span');
    text.textContent = item.url;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = t('common.copy');
    button.onclick = () => copyText(item.url, { successMessage: t('common.addressCopied') });
    row.append(text, button);
    list.append(row);
  }
}
async function loadConfig() {
  state.config = await api('/api/config');
  state.clientId = state.config.clientId || state.clientId;
  renderConfig();
}
function renderFiles() {
  const list = $('#fileList');
  list.replaceChildren();
  if (!state.files.length) {
    list.className = 'file-list empty-state';
    list.textContent = t('files.empty');
    return;
  }
  list.className = 'file-list';
  for (const file of state.files) {
    const row = document.createElement('div'); row.className = 'file-item';
    const icon = document.createElement('div'); icon.className = 'file-icon'; icon.textContent = iconFor(file);
    const main = document.createElement('div'); main.className = 'item-main';
    const name = document.createElement('div'); name.className = 'item-name'; name.title = file.name; name.textContent = file.name;
    const meta = document.createElement('div'); meta.className = 'item-meta'; meta.textContent = `${formatBytes(file.size)} · ${formatDate(file.uploadedAt)}`;
    main.append(name, meta);
    const actions = document.createElement('div'); actions.className = 'item-actions';
    const download = document.createElement('button');
    download.type = 'button'; download.className = 'icon-button'; download.title = t('files.download'); download.setAttribute('aria-label', t('files.downloadName', { name: file.name })); download.textContent = '↓';
    download.onclick = () => {
      const link = document.createElement('a');
      link.href = `/api/files/${file.id}/download`; link.download = file.name;
      document.body.append(link); link.click(); link.remove();
    };
    actions.append(download);
    if (file.canDelete === true || state.config?.permissions?.deleteAll || (state.config?.permissions?.deleteOwn && file.ownerId === state.clientId)) {
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'icon-button danger'; remove.title = t('common.delete'); remove.setAttribute('aria-label', t('files.deleteName', { name: file.name })); remove.textContent = '×';
      remove.onclick = async () => {
        if (!confirm(t('files.confirmDelete', { name: file.name }))) return;
        try { await api(`/api/files/${file.id}`, { method: 'DELETE' }); await loadFiles(); toast(t('files.deleted')); } catch (error) { toast(error); }
      };
      actions.append(remove);
    }
    row.append(icon, main, actions); list.append(row);
  }
}
async function loadFiles() {
  const result = await api('/api/files');
  state.files = result.files || [];
  renderFiles();
}
function formatMessageTime(value) {
  try { return new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch { return ''; }
}
function trimMessages() {
  while (state.messages.size > MAX_MESSAGES) state.messages.delete(state.messages.keys().next().value);
}
function renderMessages() {
  const list = $('#chatMessages');
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  list.replaceChildren();
  if (!state.messages.size) {
    list.className = 'chat-messages empty-state'; list.textContent = t('chat.empty'); return;
  }
  list.className = 'chat-messages';
  for (const message of state.messages.values()) {
    const row = document.createElement('div'); row.className = `chat-row ${message.senderId === state.clientId ? 'mine' : 'theirs'}`;
    const bubble = document.createElement('div'); bubble.className = 'chat-bubble';
    const text = document.createElement('div'); text.className = 'chat-text'; text.textContent = message.text;
    const time = document.createElement('time'); time.className = 'chat-time'; time.dateTime = message.sentAt; time.textContent = formatMessageTime(message.sentAt);
    bubble.append(text, time);
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'chat-copy'; copy.textContent = t('common.copy'); copy.title = t('chat.copy');
    copy.onclick = () => copyText(message.text, { successMessage: t('chat.copied') });
    bubble.append(copy); row.append(bubble); list.append(row);
  }
  if (nearBottom) list.scrollTop = list.scrollHeight;
}
function addMessage(message) {
  if (!message?.id || typeof message.text !== 'string') return;
  state.messages.set(message.id, message); trimMessages(); renderMessages();
}
async function loadMessages() {
  const result = await api('/api/messages');
  state.clientId = result.clientId || state.clientId;
  state.messages = new Map((result.messages || []).slice(-MAX_MESSAGES).map(message => [message.id, message]));
  renderMessages();
}
async function sendMessage() {
  const input = $('#chatInput'); const text = input.value.trim();
  if (!text) return;
  const button = $('#chatSendButton'); button.disabled = true;
  try {
    const message = await api('/api/messages', jsonOptions('POST', { text }));
    addMessage(message); input.value = ''; input.style.height = '';
  } catch (error) { toast(error); }
  finally { button.disabled = false; input.focus(); }
}

class FileHasher {
  constructor(signal) {
    this.worker = new Worker('/hash-worker.js', { type: 'module' });
    this.pending = new Map(); this.sequence = 0; this.closed = false;
    this.signal = signal;
    this.abort = () => this.close(abortError());
    this.worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      if (data.progress !== undefined) { pending.onProgress?.(data.progress, data.total); return; }
      this.pending.delete(data.id);
      if (data.error) pending.reject(localizedError('error.checksumWorker')); else pending.resolve(data.digest);
    };
    this.worker.onerror = () => this.close(localizedError('error.checksumWorker'));
    signal.addEventListener('abort', this.abort, { once: true });
    if (signal.aborted) this.abort();
  }
  digest(blob, onProgress) {
    if (this.closed) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ id, blob });
    });
  }
  close(error = abortError()) {
    if (this.closed) return;
    this.closed = true; this.worker.terminate();
    this.signal.removeEventListener('abort', this.abort);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
function fileKey(file) { return JSON.stringify([file.name, file.size, file.lastModified]); }
function resumeRecords() {
  const records = readStored(RESUME_STORAGE, []);
  return Array.isArray(records) ? records.filter(record => record && typeof record.id === 'string' && typeof record.key === 'string').slice(-32) : [];
}
function findResume(item) {
  return resumeRecords().find(record => record.key === fileKey(item.file) && record.sha256 === item.sha256
    && ![...state.transfers.values()].some(other => other !== item && other.uploadId === record.id));
}
function rememberUpload(item) {
  if (!item.uploadId || !item.sha256) return;
  const records = resumeRecords().filter(record => record.id !== item.uploadId);
  records.push({ id: item.uploadId, key: fileKey(item.file), sha256: item.sha256, createdAt: Date.now() });
  writeStored(RESUME_STORAGE, records.slice(-32));
}
function forgetUpload(item) { writeStored(RESUME_STORAGE, resumeRecords().filter(record => record.id !== item.uploadId)); }
function scheduleTransfers() {
  if (state.renderFrame !== null) return;
  state.renderFrame = requestAnimationFrame(() => { state.renderFrame = null; renderTransfers(); });
}
function transferLabel(item) {
  if (item.phase === 'error') return item.error ? errorText(item.error) : t('error.uploadFailed');
  if (item.phase === 'hashing') return t('transfer.hashing', { progress: Math.round(item.hashProgress * 100) });
  if (item.phase !== 'uploading') return t(['queued', 'paused', 'verifying', 'cancelling', 'cancelled', 'done'].includes(item.phase) ? `transfer.${item.phase}` : 'transfer.preparing');
  const progress = item.file.size ? Math.min(100, Math.floor(item.loaded / item.file.size * 100)) : 100;
  const speed = item.speed > 0 ? ` · ${formatBytes(item.speed)}/s` : '';
  const eta = item.speed > 0 ? t('transfer.remaining', { duration: formatDuration((item.file.size - item.loaded) / item.speed) }) : '';
  return t('transfer.uploading', { progress, loaded: formatBytes(item.loaded), total: formatBytes(item.file.size) }) + speed + eta;
}
function makeTransferRow(item) {
  const row = document.createElement('div'); row.className = 'transfer-item';
  const icon = document.createElement('div'); icon.className = 'file-icon';
  const main = document.createElement('div'); main.className = 'item-main';
  const name = document.createElement('div'); name.className = 'item-name'; name.textContent = item.file.name; name.title = item.file.name;
  const meta = document.createElement('div'); meta.className = 'item-meta'; meta.setAttribute('role', 'status');
  const verified = document.createElement('div'); verified.className = 'item-meta transfer-confirmed';
  const bar = document.createElement('div'); bar.className = 'progress'; bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', t('transfer.progress', { name: item.file.name })); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100');
  const fill = document.createElement('span'); bar.append(fill);
  const actions = document.createElement('div'); actions.className = 'item-actions transfer-actions';
  const toggle = document.createElement('button'); toggle.className = 'transfer-button'; toggle.type = 'button';
  toggle.onclick = () => ['paused', 'error'].includes(item.phase) ? resumeTransfer(item) : pauseTransfer(item);
  const cancel = document.createElement('button'); cancel.className = 'transfer-button danger'; cancel.type = 'button';
  cancel.onclick = () => {
    if (['done', 'cancelled'].includes(item.phase)) { state.transfers.delete(item.id); row.remove(); scheduleTransfers(); }
    else cancelTransfer(item);
  };
  actions.append(toggle, cancel); main.append(name, meta, verified, bar); row.append(icon, main, actions);
  item.elements = { row, icon, meta, verified, bar, fill, toggle, cancel };
  return row;
}
function renderTransfers() {
  const list = $('#transferList');
  $('#transferCount').textContent = [...state.transfers.values()].filter(item => !['done', 'cancelled'].includes(item.phase)).length;
  if (!state.transfers.size) {
    list.className = 'transfer-list empty-state'; list.textContent = t('queue.empty'); return;
  }
  if (list.classList.contains('empty-state')) { list.replaceChildren(); list.className = 'transfer-list'; }
  for (const item of state.transfers.values()) {
    if (!item.elements) list.append(makeTransferRow(item));
    const elements = item.elements;
    elements.icon.textContent = item.phase === 'error' ? '!' : item.phase === 'done' ? '✓' : iconFor(item.file);
    elements.meta.textContent = transferLabel(item);
    elements.meta.classList.toggle('transfer-error', item.phase === 'error');
    elements.verified.textContent = item.phase === 'uploading' ? t('transfer.confirmed', { size: formatBytes(item.offset) }) : '';
    elements.bar.setAttribute('aria-label', t('transfer.progress', { name: item.file.name }));
    const progress = item.phase === 'hashing' ? item.hashProgress : item.phase === 'done' ? 1 : item.file.size ? item.loaded / item.file.size : 0;
    const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
    elements.fill.style.width = `${percent}%`; elements.bar.setAttribute('aria-valuenow', String(percent));
    elements.bar.classList.toggle('hidden', ['done', 'cancelled', 'error'].includes(item.phase));
    elements.toggle.classList.toggle('hidden', ['done', 'cancelled'].includes(item.phase));
    elements.toggle.textContent = t(item.phase === 'error' ? 'transfer.retry' : item.phase === 'paused' ? 'transfer.resume' : 'transfer.pause');
    elements.toggle.disabled = ['verifying', 'cancelling'].includes(item.phase) || (item.running && ['paused', 'error'].includes(item.phase));
    elements.cancel.textContent = t(['done', 'cancelled'].includes(item.phase) ? 'transfer.hide' : 'transfer.cancel');
    elements.cancel.disabled = ['verifying', 'cancelling'].includes(item.phase);
  }
}
function trimTransfers() {
  const finished = [...state.transfers.values()].filter(item => ['done', 'cancelled'].includes(item.phase));
  for (const item of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED))) {
    item.elements?.row.remove(); state.transfers.delete(item.id);
  }
}
function pauseTransfer(item) {
  if (['done', 'cancelled', 'error', 'verifying', 'cancelling'].includes(item.phase)) return;
  item.intent = 'pause'; item.phase = 'paused'; item.loaded = item.offset;
  item.controller?.abort(); scheduleTransfers();
}
function resumeTransfer(item) {
  if (item.running || !['paused', 'error'].includes(item.phase)) return;
  if (!state.authenticated) { toast(t('error.reconnect')); return; }
  item.intent = null; item.error = null; item.phase = 'queued'; item.speed = 0;
  scheduleTransfers(); pumpUploads();
}
async function removeUpload(item) {
  if (!item.uploadId) return;
  try { await api(`/api/uploads/${item.uploadId}`, { method: 'DELETE' }); }
  catch (error) {
    if (![401, 404, 410].includes(error.status)) { item.error = localizedError('error.cancelUnconfirmed'); throw error; }
  }
  forgetUpload(item); item.uploadId = null; item.offset = 0;
}
async function finishCancel(item) {
  try { await removeUpload(item); item.phase = 'cancelled'; item.error = null; }
  catch { item.phase = 'error'; }
  finally { trimTransfers(); scheduleTransfers(); }
}
function cancelTransfer(item) {
  if (['verifying', 'done', 'cancelling'].includes(item.phase)) return;
  item.intent = 'cancel'; item.phase = 'cancelling'; item.controller?.abort();
  if (!item.running) void finishCancel(item);
  scheduleTransfers();
}
function enqueueFiles(files) {
  if (!state.authenticated) { toast(t('error.connectFirst')); return; }
  if (typeof Worker === 'undefined') { toast(t('error.noWorker')); return; }
  trimTransfers();
  for (const file of files) {
    if (state.transfers.size >= MAX_TRANSFERS) { toast(t('error.queueFull')); break; }
    if (file.size > state.config.maxFileSize) { toast(t('error.fileTooLarge', { name: file.name, size: formatBytes(state.config.maxFileSize) })); continue; }
    const id = `transfer-${++state.sequence}`;
    state.transfers.set(id, { id, file, phase: 'queued', intent: null, error: null, offset: 0, loaded: 0, speed: 0, hashProgress: 0, running: false, uploadId: null, sha256: null, elements: null });
  }
  scheduleTransfers(); pumpUploads();
}
function pumpUploads() {
  const limit = Math.max(1, Math.min(2, Number(state.config?.maxConcurrentUploads) || 2));
  while (state.authenticated && state.activeUploads < limit) {
    const item = [...state.transfers.values()].find(transfer => transfer.phase === 'queued' && !transfer.running);
    if (!item) break;
    item.running = true; state.activeUploads++;
    void runUpload(item).finally(() => {
      item.running = false; item.controller = null; state.activeUploads--;
      trimTransfers(); scheduleTransfers(); pumpUploads();
    });
  }
}
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const abort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
async function serverOffset(item, signal) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await request(`/api/uploads/${item.uploadId}`, { method: 'HEAD', signal });
      const value = response.headers.get('Upload-Offset');
      const offset = Number(value);
      if (value === null || !Number.isSafeInteger(offset) || offset < 0 || offset > item.file.size) throw localizedError('error.invalidOffset');
      return offset;
    } catch (error) {
      if (error.status !== 409 || attempt >= 7) throw error;
      await delay(Math.min(1000, 100 * (attempt + 1)), signal);
    }
  }
}
function sendChunk(item, blob, offset, checksum, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const started = performance.now();
    const abort = () => xhr.abort();
    const finish = (error, value) => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    xhr.open('PATCH', `/api/uploads/${item.uploadId}`);
    xhr.withCredentials = true;
    xhr.timeout = 180000;
    xhr.setRequestHeader('Content-Type', 'application/offset+octet-stream');
    xhr.setRequestHeader('Upload-Offset', String(offset));
    xhr.setRequestHeader('x-chunk-sha256', checksum);
    xhr.upload.onprogress = (event) => {
      item.loaded = offset + event.loaded;
      const elapsed = (performance.now() - started) / 1000;
      if (elapsed > 0.2) {
        const observed = event.loaded / elapsed;
        item.speed = item.speed ? item.speed * 0.7 + observed * 0.3 : observed;
      }
      scheduleTransfers();
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const value = xhr.getResponseHeader('Upload-Offset'); const next = Number(value);
        if (value === null || next !== offset + blob.size) return finish(localizedError('error.chunkUnconfirmed'));
        return finish(null, next);
      }
      let body = {}; try { body = JSON.parse(xhr.responseText); } catch { /* No JSON body. */ }
      const error = new Error(body.message || `HTTP ${xhr.status}`); error.status = xhr.status; error.code = body.error;
      if (xhr.status === 401) showAuth();
      finish(error);
    };
    xhr.onerror = () => finish(localizedError('error.network'));
    xhr.ontimeout = () => finish(localizedError('error.timeout'));
    xhr.onabort = () => finish(abortError());
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) return finish(abortError());
    xhr.send(blob);
  });
}
async function runUpload(item) {
  const controller = new AbortController(); item.controller = controller;
  const { signal } = controller;
  let hasher;
  try {
    hasher = new FileHasher(signal);
    item.phase = 'hashing'; scheduleTransfers();
    if (!item.sha256) item.sha256 = await hasher.digest(item.file, (loaded, total) => {
      item.hashProgress = total ? loaded / total : 1; scheduleTransfers();
    });
    if (signal.aborted) throw abortError();
    if (!item.uploadId) item.uploadId = findResume(item)?.id || null;
    if (item.uploadId) {
      try { item.offset = await serverOffset(item, signal); }
      catch (error) {
        if (![404, 410].includes(error.status)) throw error;
        forgetUpload(item); item.uploadId = null; item.offset = 0;
      }
    }
    let chunkSize = state.config.chunkSize || 4 * 1024 * 1024;
    if (!item.uploadId) {
      const upload = await api('/api/uploads', jsonOptions('POST', { name: item.file.name, size: item.file.size, mime: item.file.type || 'application/octet-stream', sha256: item.sha256 }, signal));
      item.uploadId = upload.id; item.offset = upload.offset || 0;
      chunkSize = upload.chunkSize || chunkSize;
      rememberUpload(item);
    }
    chunkSize = Math.max(1, Math.min(8 * 1024 * 1024, chunkSize));
    item.phase = 'uploading'; item.loaded = item.offset; scheduleTransfers();
    let conflicts = 0;
    while (item.offset < item.file.size) {
      if (signal.aborted) throw abortError();
      const offset = item.offset;
      const blob = item.file.slice(offset, Math.min(item.file.size, offset + chunkSize));
      const checksum = await hasher.digest(blob);
      try { item.offset = await sendChunk(item, blob, offset, checksum, signal); conflicts = 0; }
      catch (error) {
        if (error.status !== 409 || conflicts++ >= 5) throw error;
        item.offset = await serverOffset(item, signal);
      }
      item.loaded = item.offset; scheduleTransfers();
    }
    if (signal.aborted) throw abortError();
    item.phase = 'verifying'; scheduleTransfers();
    const file = await api(`/api/uploads/${item.uploadId}/complete`, jsonOptions('POST', {}, signal));
    if (file.hash !== item.sha256 || file.size !== item.file.size) throw localizedError('error.checksumMismatch');
    forgetUpload(item); item.uploadId = null;
    item.phase = 'done'; item.loaded = item.file.size;
    toast(t('transfer.received', { name: item.file.name }));
    // A failed list refresh must never hold a worker slot or mark the upload as failed.
    void loadFiles().catch(() => { if (state.authenticated) toast(t('transfer.refreshHint')); });
  } catch (error) {
    item.loaded = item.offset;
    if (item.intent === 'cancel') await finishCancel(item);
    else if (isAbort(error) || item.intent === 'pause') item.phase = 'paused';
    else { item.phase = 'error'; item.error = error; }
  } finally { hasher?.close(); scheduleTransfers(); }
}
async function loadDevices() {
  if (!state.config?.permissions?.manageDevices) return;
  const result = await api('/api/devices'); state.devices = result.devices || []; renderDevices();
}
function renderDevices() {
  const list = $('#deviceList'); list.replaceChildren();
  if (!state.devices.length) { list.className = 'file-list empty-state'; list.textContent = t('devices.empty'); return; }
  list.className = 'file-list';
  for (const device of state.devices) {
    const row = document.createElement('div'); row.className = 'file-item';
    const main = document.createElement('div'); main.className = 'item-main';
    const name = document.createElement('div'); name.className = 'item-name'; name.textContent = (device.name || device.deviceName || t('common.browser')) + (device.id === state.clientId ? t('devices.this') : '');
    const meta = document.createElement('div'); meta.className = 'item-meta'; meta.textContent = t('devices.lastSeen', { role: t(device.role === 'admin' ? 'role.admin' : 'role.member'), date: formatDate(device.lastSeenAt || device.createdAt) });
    main.append(name, meta);
    const revoke = document.createElement('button'); revoke.type = 'button'; revoke.className = 'transfer-button danger'; revoke.textContent = t('devices.revoke');
    revoke.onclick = async () => {
      if (!confirm(t('devices.confirmRevoke', { name: device.name || t('common.device') }))) return;
      revoke.disabled = true;
      try {
        await api(`/api/devices/${device.id}`, { method: 'DELETE' });
        if (device.id === state.clientId) { showAuth(); state.clientId = null; }
        else await loadDevices();
        toast(t('devices.revoked'));
      } catch (error) { toast(error); } finally { revoke.disabled = false; }
    };
    row.append(main, revoke); list.append(row);
  }
}
function connectEvents() {
  stopEvents();
  if (!state.authenticated) return;
  const source = new EventSource('/api/events'); state.eventSource = source;
  source.addEventListener('ready', () => { state.reconnectDelay = 1000; setOnline(true); });
  source.addEventListener('files', () => { void loadFiles().catch(() => {}); });
  source.addEventListener('chat', event => { try { addMessage(JSON.parse(event.data).message); } catch { /* Ignore a malformed event. */ } });
  source.addEventListener('revoked', () => { showAuth(); toast(t('session.ended')); });
  source.onerror = () => {
    source.close(); setOnline(false);
    if (!state.authenticated) return;
    state.eventTimer = setTimeout(async () => {
      try { await loadMessages(); await loadConfig(); if (state.authenticated) connectEvents(); }
      catch (error) { if (error.status !== 401 && state.authenticated) connectEvents(); }
    }, state.reconnectDelay);
    state.reconnectDelay = Math.min(30000, state.reconnectDelay * 2);
  };
}
async function authenticate(code) {
  setAuthError(null); $('#connectButton').disabled = true;
  try {
    const deviceName = $('#deviceNameInput').value.trim() || t('common.browser');
    const result = await api('/api/auth', jsonOptions('POST', { code, deviceName, rememberDevice: $('#rememberDevice').checked }));
    if (state.clientId && state.clientId !== result.clientId) resetUploadOwnership();
    state.clientId = result.clientId; writeStored('mckl_device_name', deviceName);
    state.authenticated = true;
    await loadConfig(); await Promise.all([loadFiles(), loadMessages()]);
    showApp(); connectEvents();
    $('#codeInput').value = '';
    if (state.config.permissions?.manageDevices) void loadDevices().catch(error => toast(error));
  } catch (error) { setAuthError(error); showAuth(); }
  finally { $('#connectButton').disabled = false; }
}
function resetUploadOwnership() {
  writeStored(RESUME_STORAGE, []);
  for (const item of state.transfers.values()) {
    if (['done', 'cancelled'].includes(item.phase)) continue;
    item.uploadId = null; item.offset = 0; item.loaded = 0;
  }
}
async function disconnect() {
  const button = $('#disconnectButton'); button.disabled = true;
  for (const item of state.transfers.values()) pauseTransfer(item);
  try {
    await api('/api/logout', jsonOptions('POST', {}));
    showAuth(); state.clientId = null; state.messages.clear(); state.files = []; state.devices = [];
    resetUploadOwnership();
    await loadConfig(); renderFiles(); renderMessages(); renderDevices();
    toast(t('session.loggedOut'));
  } catch (error) { toast(localizedError('session.logoutFailed', { message: error })); }
  finally { button.disabled = false; }
}

function renderLanguage() {
  $('#languageSelect').value = i18n.language;
  setOnline(state.online);
  renderConfig(); renderFiles(); renderMessages(); renderDevices(); renderTransfers();
  setAuthError(state.authError);
  if (state.toastMessage && typeof state.toastMessage !== 'string') $('#toast').textContent = errorText(state.toastMessage);
  else { clearTimeout(toast.timer); $('#toast').classList.remove('show'); }
}
function changeLanguage(language) {
  i18n.setLanguage(language);
  renderLanguage();
}
i18n.apply();
renderLanguage();
$('#languageSelect').onchange = event => changeLanguage(event.target.value);
$('#authForm').addEventListener('submit', event => { event.preventDefault(); void authenticate($('#codeInput').value.trim()); });
$('#deviceNameInput').value = readStored('mckl_device_name', t('common.browser'));
$('#chatForm').addEventListener('submit', event => { event.preventDefault(); void sendMessage(); });
$('#chatInput').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } });
$('#chatInput').addEventListener('input', event => { event.target.style.height = ''; event.target.style.height = `${Math.min(event.target.scrollHeight, 140)}px`; });
$('#pickButton').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = event => { enqueueFiles(event.target.files); event.target.value = ''; };
const dropzone = $('#dropzone');
dropzone.onclick = event => { if (!event.target.closest('button')) $('#fileInput').click(); };
dropzone.onkeydown = event => { if (event.target === dropzone && ['Enter', ' '].includes(event.key)) { event.preventDefault(); $('#fileInput').click(); } };
for (const type of ['dragenter', 'dragover']) dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.add('dragging'); });
for (const type of ['dragleave', 'drop']) dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.remove('dragging'); });
dropzone.addEventListener('drop', event => enqueueFiles(event.dataTransfer.files));
$('#refreshButton').onclick = () => { void loadFiles().catch(error => toast(error)); };
$('#refreshDevicesButton').onclick = () => { void loadDevices().catch(error => toast(error)); };
$('#disconnectButton').onclick = () => { void disconnect(); };
$('#pauseAllButton').onclick = () => { for (const item of state.transfers.values()) pauseTransfer(item); };
$('#shareButton').onclick = async () => {
  const url = state.config?.addresses?.[0]?.url || location.origin;
  try {
    if (navigator.share) await navigator.share({ title: 'MCKL Transfer', text: t('share.message'), url });
    else await copyText(url, { successMessage: t('common.addressCopied') });
  } catch { /* User dismissed the share sheet. */ }
};
window.addEventListener('beforeunload', event => {
  if ([...state.transfers.values()].some(item => !['done', 'cancelled'].includes(item.phase))) {
    event.preventDefault(); event.returnValue = '';
  }
});
(async () => {
  try {
    await loadConfig();
    try {
      await Promise.all([loadFiles(), loadMessages()]);
      state.authenticated = true; await loadConfig(); showApp(); connectEvents();
      if (state.config.permissions?.manageDevices) void loadDevices().catch(() => {});
    } catch { showAuth(); }
  } catch (error) { setAuthError(error); showAuth(); }
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
