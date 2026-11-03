import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../public/i18n.js', import.meta.url), 'utf8');
const STORAGE_KEY = 'mckl_language_v1';
const placeholders = value => [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(match => match[1]).sort();

class Element {
  constructor(attributes = {}) {
    this.attributes = { ...attributes };
    this.textContent = '';
    this.htmlWrites = 0;
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  get lang() { return this.getAttribute('lang') || ''; }
  set lang(value) { this.setAttribute('lang', value); }
  set innerHTML(value) { this.htmlWrites++; throw new Error('Translations must not use innerHTML'); }
}

function createEngine({ stored, languages, language, denyStorage = false, nodes = [] } = {}) {
  const storage = new Map(stored === undefined ? [] : [[STORAGE_KEY, stored]]);
  const document = {
    documentElement: new Element({ lang: 'vi' }),
    querySelectorAll(selector) {
      const attributes = selector.split(',').map(part => /^\[([^\]]+)\]$/.exec(part.trim())?.[1]);
      return nodes.filter(node => attributes.some(attribute => attribute && node.getAttribute(attribute) !== null));
    },
    querySelector() { return null; },
  };
  const navigator = {};
  if (languages !== undefined) navigator.languages = languages;
  if (language !== undefined) navigator.language = language;
  const localStorage = {
    getItem(key) { if (denyStorage) throw new Error('Storage denied'); return storage.get(key) ?? null; },
    setItem(key, value) { if (denyStorage) throw new Error('Storage denied'); storage.set(key, String(value)); },
  };
  const window = { document, navigator, localStorage };
  const context = vm.createContext({ window, document, navigator, localStorage, console });
  vm.runInContext(source, context, { filename: 'public/i18n.js' });
  return { api: window.MCKLI18n, document, storage };
}

test('language selection honors a valid stored preference before regional browser preferences', () => {
  const storedEnglish = createEngine({ stored: 'en', languages: ['vi-VN'] });
  assert.equal(storedEnglish.api.language, 'en');
  assert.equal(storedEnglish.api.t('connection.online'), 'Connected');

  const storedVietnamese = createEngine({ stored: 'vi', languages: ['en-GB'] });
  assert.equal(storedVietnamese.api.language, 'vi');
  assert.equal(storedVietnamese.api.t('connection.online'), 'Đã kết nối');

  assert.equal(createEngine({ languages: ['fr-FR', 'vi-VN', 'en-GB'] }).api.language, 'vi');
  assert.equal(createEngine({ languages: ['en-GB', 'vi-VN'] }).api.language, 'en');
  assert.equal(createEngine({ language: 'vi-VN' }).api.language, 'vi');
});

test('invalid or corrupt preferences fall back through browser languages and then English', () => {
  for (const stored of ['', 'not-a-language', '{"language":"vi"}', 'null']) {
    assert.equal(createEngine({ stored, languages: ['ja-JP', 'vi-VN'] }).api.language, 'vi');
  }
  assert.equal(createEngine({ stored: 'ja', languages: ['ja-JP', 'th-TH'] }).api.language, 'en');
  assert.equal(createEngine().api.language, 'en');
});

test('denied storage does not prevent negotiation or an in-memory language switch', () => {
  const engine = createEngine({ languages: ['vi-VN'], denyStorage: true });
  assert.equal(engine.api.language, 'vi');
  assert.doesNotThrow(() => engine.api.setLanguage('en-GB'));
  assert.equal(engine.api.language, 'en');
  assert.equal(engine.api.t('connection.online'), 'Connected');
  assert.equal(engine.document.documentElement.lang, 'en');
});

test('switching languages updates document language, text and accessible attributes safely', () => {
  const text = new Element({ 'data-i18n': 'connection.online' });
  const placeholder = new Element({ 'data-i18n-placeholder': 'connection.online' });
  const label = new Element({ 'data-i18n-label': 'connection.online' });
  const metadata = new Element({ 'data-i18n-content': 'connection.online' });
  const nodes = [text, placeholder, label, metadata];
  const engine = createEngine({ languages: ['vi-VN'], nodes });

  assert.equal(engine.api.setLanguage('en-GB'), 'en');
  assert.equal(engine.document.documentElement.lang, 'en');
  assert.equal(text.textContent, 'Connected');
  assert.equal(placeholder.getAttribute('placeholder'), 'Connected');
  assert.equal(label.getAttribute('aria-label'), 'Connected');
  assert.equal(metadata.getAttribute('content'), 'Connected');
  assert.equal(engine.storage.get(STORAGE_KEY), 'en');

  assert.equal(engine.api.setLanguage('vi-VN'), 'vi');
  assert.equal(engine.document.documentElement.lang, 'vi');
  assert.equal(text.textContent, 'Đã kết nối');
  assert.equal(label.getAttribute('aria-label'), 'Đã kết nối');
  assert.equal(engine.storage.get(STORAGE_KEY), 'vi');
  assert.ok(nodes.every(node => node.htmlWrites === 0));

  text.textContent = 'stale text';
  engine.api.apply();
  assert.equal(text.textContent, 'Đã kết nối');
});

test('English and Vietnamese catalogs have complete matching keys and interpolation parameters', () => {
  const { api } = createEngine();
  assert.ok(Object.isFrozen(api.catalogs));
  assert.ok(Object.isFrozen(api.catalogs.en));
  assert.ok(Object.isFrozen(api.catalogs.vi));
  const keys = Object.keys(api.catalogs.en).sort();
  assert.ok(keys.length > 0);
  assert.deepEqual(Object.keys(api.catalogs.vi).sort(), keys);
  for (const key of keys) {
    assert.equal(typeof api.catalogs.en[key], 'string', `English ${key}`);
    assert.equal(typeof api.catalogs.vi[key], 'string', `Vietnamese ${key}`);
    assert.ok(api.catalogs.en[key].trim(), `Empty English ${key}`);
    assert.ok(api.catalogs.vi[key].trim(), `Empty Vietnamese ${key}`);
    assert.deepEqual(placeholders(api.catalogs.vi[key]), placeholders(api.catalogs.en[key]), key);
  }
  assert.ok(Object.isFrozen(api.supportedLanguages));
  assert.deepEqual(Array.from(api.supportedLanguages, item => item.code).sort(), ['en', 'vi']);
});

test('keys referenced by the shipped HTML and client exist in both catalogs', async () => {
  const { api } = createEngine();
  const [html, client] = await Promise.all([
    fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    fs.readFile(new URL('../public/client.js', import.meta.url), 'utf8'),
  ]);
  const keys = new Set([
    ...[...html.matchAll(/data-i18n(?:-placeholder|-label|-content)?=["']([^"']+)["']/g)].map(match => match[1]),
    ...[...client.matchAll(/\bt\(\s*["']([^"']+)["']/g)].map(match => match[1]),
  ]);
  assert.ok(keys.size > 0, 'The shipped app must use the actual catalogs');
  for (const key of keys) {
    assert.ok(Object.hasOwn(api.catalogs.en, key), `Missing English key ${key}`);
    assert.ok(Object.hasOwn(api.catalogs.vi, key), `Missing Vietnamese key ${key}`);
  }
});

test('interpolation preserves hostile user data literally and does not process replacement text as a template', () => {
  const { api } = createEngine({ stored: 'en' });
  const entry = Object.entries(api.catalogs.en).find(([, template]) => placeholders(template).length);
  assert.ok(entry, 'A real parameterized app message must be covered');
  const [key, template] = entry;
  const payload = '<img src=x onerror=alert(1)> {unrelated} & "quoted"';
  const params = Object.fromEntries(placeholders(template).map(name => [name, payload]));
  assert.equal(api.t(key, params), template.replace(/\{([A-Za-z0-9_]+)\}/g, () => payload));
});

test('public API error codes have readable messages in both app languages', async () => {
  const { api } = createEngine();
  const sources = await Promise.all(['../server.mjs', '../lib/file-store.mjs', '../lib/sessions.mjs'].map(file => fs.readFile(new URL(file, import.meta.url), 'utf8')));
  const source = sources.join('\n');
  const codes = new Set([
    ...[...source.matchAll(/(?:error|failure)\(\d+, '([A-Z_]+)'/g)].map(match => match[1]),
    ...[...source.matchAll(/error: '([A-Z_]+)'/g)].map(match => match[1]),
    'REQUEST_FAILED', 'INTERNAL_ERROR',
  ]);
  for (const code of codes) {
    for (const language of ['en', 'vi']) assert.ok(api.catalogs[language][`error.${code}`], `${language}: ${code}`);
  }
});
