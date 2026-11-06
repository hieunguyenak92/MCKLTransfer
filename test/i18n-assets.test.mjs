import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';

test('the public app can load both locale manifests and its translation dependency under the existing CSP', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mckl-locale-assets-'));
  const app = createApp({ host: '127.0.0.1', port: 0, shareDir: dir, logger: { log() {}, warn() {} } });
  t.after(async () => { await app.stop(); await fs.rm(dir, { recursive: true, force: true }); });
  const { port } = await app.start();
  const base = `http://127.0.0.1:${port}`;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  const html = await page.text();
  const translationIndex = html.indexOf('src="/i18n.js"');
  const bootstrapIndex = html.indexOf('src="/app.js"');
  assert.ok(translationIndex >= 0 && bootstrapIndex >= 0 && translationIndex < bootstrapIndex);
  assert.match(html, /data-app-version="0\.5\.0"/);
  for (const route of ['/i18n.js', '/app.js', '/client.js']) {
    const script = await fetch(base + route);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
    assert.equal(await script.text(), await fs.readFile(new URL(`../public${route}`, import.meta.url), 'utf8'));
  }
  const manifests = await Promise.all(['/manifest.json', '/manifest.en.json'].map(async route => {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    return response.json();
  }));
  assert.deepEqual(manifests.map(manifest => manifest.lang), ['vi', 'en']);
  assert.equal(manifests[0].id, manifests[1].id, 'language choice does not create a different installed app');
  assert.equal(manifests[0].start_url, manifests[1].start_url);

  const handlers = {};
  let cachedAssets;
  const source = await fs.readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const context = vm.createContext({
    self: { addEventListener(name, handler) { handlers[name] = handler; }, skipWaiting() {} },
    caches: { async open() { return { async addAll(assets) { cachedAssets = Array.from(assets); } }; } },
  });
  vm.runInContext(source, context);
  let installing;
  handlers.install({ waitUntil(promise) { installing = promise; } });
  await installing;
  for (const asset of ['/i18n.js', '/app.js', '/client.js', '/manifest.json', '/manifest.en.json']) assert.ok(cachedAssets.includes(asset), `offline shell includes ${asset}`);
  for (const asset of cachedAssets) assert.equal((await fetch(base + asset)).status, 200, `offline install can cache ${asset}`);
  assert.equal(vm.runInContext('CACHE', context), 'mckl-transfer-0.5.0');
});
