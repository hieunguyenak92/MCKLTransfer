import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const { version: currentVersion } = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
const origin = 'https://mckl.test';

class Element {
  constructor(tagName, attributes = {}) {
    this.tagName = tagName.toUpperCase(); this.attributes = { ...attributes };
    this.children = []; this.listeners = {}; this.style = {}; this._text = '';
    this.htmlWrites = 0;
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  get textContent() { return this._text + this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  set innerHTML(value) { this.htmlWrites++; throw new Error('Recovery must use safe DOM operations'); }
  append(...children) { for (const child of children) { if (typeof child !== 'string') child.parent = this; this.children.push(child); } }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { this._text = ''; this.children = []; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  click() { const event = { type: 'click', target: this, preventDefault() {} }; this.onclick?.(event); this.listeners.click?.(event); }
}

function createBootstrap(t, { version = currentVersion, languageSelector = true, dependency = true } = {}) {
  const elements = [];
  const createElement = tag => { const element = new Element(tag); elements.push(element); return element; };
  const documentElement = new Element('html', version === null ? {} : { 'data-app-version': version });
  const head = createElement('head');
  const body = createElement('body'); body.textContent = 'Cached application shell';
  const select = languageSelector ? createElement('select') : null;
  const scripts = [];
  const append = head.append.bind(head);
  head.append = (...children) => {
    append(...children);
    for (const child of children) if (child.tagName === 'SCRIPT') scripts.push(child);
  };
  const document = {
    documentElement, head, body, createElement,
    querySelector(selector) { return selector === '#languageSelect' ? select : null; },
  };
  let reloads = 0; let fetches = 0;
  const location = { origin, href: `${origin}/`, reload() { reloads++; } };
  const window = { location, ...(dependency ? { MCKLI18n: Object.freeze({}) } : {}) };
  const timers = new Set();
  const context = vm.createContext({
    window, document, location, console, URL,
    fetch() { fetches++; throw new Error('Bootstrap must not fetch app APIs'); },
    setTimeout(callback, delay) { const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay); timers.add(timer); return timer; },
    clearTimeout(timer) { clearTimeout(timer); timers.delete(timer); },
  });
  t.after(() => { for (const timer of timers) clearTimeout(timer); });
  assert.doesNotThrow(() => vm.runInContext(source, context, { filename: 'public/app.js' }));
  return {
    window, document, elements, scripts,
    get reloads() { return reloads; }, get fetches() { return fetches; },
    scriptPath(script) {
      const url = new URL(script.src || script.getAttribute('src'), location.href);
      assert.equal(url.origin, origin, 'Bootstrap dependencies must stay on the app origin');
      return url.pathname;
    },
  };
}

async function settle() { for (let turn = 0; turn < 6; turn++) await Promise.resolve(); }
function descendants(element) { return [element, ...element.children.filter(child => typeof child !== 'string').flatMap(descendants)]; }
function assertRecovery(client) {
  const text = client.document.body.textContent;
  assert.match(text, /reload|refresh|page|application|browser|load|open/i, 'Recovery explains the problem in English');
  assert.match(text, /[ăâđêôơưĂÂĐÊÔƠƯ]/u, 'Recovery also explains the problem in Vietnamese');
  assert.ok(descendants(client.document.body).some(element => element.tagName === 'BUTTON'), 'Recovery includes a manual reload button');
  assert.ok(client.elements.every(element => element.htmlWrites === 0));
  assert.equal(client.reloads, 0, 'Recovery must not reload automatically');
}

test('legacy, mismatched or incomplete cached shells show recovery without initializing the client', async t => {
  for (const options of [{ version: null }, { version: '0.0.0-legacy' }, { languageSelector: false }]) {
    const client = createBootstrap(t, options);
    await settle();
    assert.equal(client.scripts.length, 0, 'An incompatible shell must not load client code');
    assert.equal(client.fetches, 0);
    assertRecovery(client);
  }
});

test('a complete current shell loads the client exactly once when i18n is already present', async t => {
  const client = createBootstrap(t);
  await settle();
  assert.deepEqual(client.scripts.map(script => client.scriptPath(script)), ['/client.js']);
  client.scripts[0].onload();
  await settle();
  assert.equal(client.scripts.length, 1);
  assert.equal(client.document.body.textContent, 'Cached application shell');
  assert.equal(client.fetches, 0);
  assert.equal(client.reloads, 0);
});

test('a current shell missing i18n loads the dependency before the client', async t => {
  const client = createBootstrap(t, { dependency: false });
  await settle();
  assert.deepEqual(client.scripts.map(script => client.scriptPath(script)), ['/i18n.js']);
  client.window.MCKLI18n = Object.freeze({});
  client.scripts[0].onload();
  await settle();
  assert.deepEqual(client.scripts.map(script => client.scriptPath(script)), ['/i18n.js', '/client.js']);
  client.scripts[1].onload();
  await settle();
  assert.equal(client.scripts.length, 2);
  assert.equal(client.document.body.textContent, 'Cached application shell');
  assert.equal(client.reloads, 0);
});

test('dependency and client load failures produce safe readable recovery', async t => {
  for (const dependency of [false, true]) {
    const client = createBootstrap(t, { dependency });
    await settle();
    assert.equal(client.scripts.length, 1);
    assert.equal(client.scriptPath(client.scripts[0]), dependency ? '/client.js' : '/i18n.js');
    assert.doesNotThrow(() => client.scripts[0].onerror(new Error('Synthetic network failure')));
    await settle();
    assertRecovery(client);
    assert.equal(client.scripts.length, 1, 'A failed dependency must not initialize the client');
    assert.equal(client.fetches, 0);
  }
});

test('the recovery reload button reloads only after an explicit click', async t => {
  const client = createBootstrap(t, { version: null });
  await settle();
  assertRecovery(client);
  const button = descendants(client.document.body).find(element => element.tagName === 'BUTTON');
  button.click();
  assert.equal(client.reloads, 1);
});
