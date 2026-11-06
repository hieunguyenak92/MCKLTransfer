(() => {
  const version = '0.5.0';

  function showRecovery() {
    const main = document.createElement('main');
    main.className = 'shell';
    const card = document.createElement('section');
    card.className = 'card access-card';
    card.setAttribute('role', 'alert');
    const title = document.createElement('h1');
    title.textContent = 'MCKL Transfer';
    const vi = document.createElement('p');
    vi.lang = 'vi';
    vi.textContent = 'Không thể tải phiên bản ứng dụng hiện tại. Hãy kết nối lại với máy chủ rồi tải lại trang.';
    const en = document.createElement('p');
    en.lang = 'en';
    en.textContent = 'The current application could not be loaded. Reconnect to the server, then reload this page.';
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'button primary';
    reload.textContent = 'Tải lại trang / Reload page';
    reload.onclick = () => window.location.reload();
    card.append(title, vi, en, reload);
    main.append(card);
    document.body.replaceChildren(main);
  }

  function loadScript(path) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = path;
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  }

  async function start() {
    // An older service worker can serve a cached shell during an upgrade.
    if (document.documentElement.getAttribute('data-app-version') !== version || !document.querySelector('#languageSelect')) {
      showRecovery();
      return;
    }
    try {
      if (!window.MCKLI18n) await loadScript('/i18n.js');
      if (!window.MCKLI18n) throw new Error('Translations unavailable');
      await loadScript('/client.js');
      await loadScript('/vendor/qrcodegen.js');
      await loadScript('/workspace.js');
    } catch { showRecovery(); }
  }

  start();
})();
