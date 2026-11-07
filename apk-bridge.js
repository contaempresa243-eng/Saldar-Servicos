/* Saldar Serviços · ponte para o APK (só é usada dentro da app Android) */
(function () {
  var C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  window.IS_APK = true;
  function P(n) { try { return (C.Plugins && C.Plugins[n]) || C.registerPlugin(n); } catch (e) { return null; } }
  var Share = P('Share'), FS = P('Filesystem'), App = P('App'), JN = P('SaldarNative');

  function b64(blob) {
    return new Promise(function (ok, no) {
      var r = new FileReader();
      r.onload = function () { ok(String(r.result).split(',')[1] || ''); };
      r.onerror = no; r.readAsDataURL(blob);
    });
  }

  /* 1. Service worker não é preciso: os ficheiros já vão dentro do APK */
  try {
    if (navigator.serviceWorker) navigator.serviceWorker.register = function () { return Promise.resolve(); };
  } catch (e) {}

  /* 2. Partilhar com o menu do Android */
  navigator.canShare = function (d) { return !!(d && (d.files || d.text || d.url)); };
  navigator.share = async function (d) {
    d = d || {};
    try {
      if (d.files && d.files.length) {
        var f = d.files[0];
        var w = await FS.writeFile({ path: f.name, data: await b64(f), directory: 'CACHE' });
        await Share.share({ title: d.title || f.name, files: [w.uri], dialogTitle: d.title || 'Partilhar' });
      } else {
        await Share.share({ title: d.title, text: d.text, url: d.url, dialogTitle: 'Partilhar' });
      }
    } catch (e) {
      if (/cancel/i.test(String((e && e.message) || e))) { var er = new Error('cancelado'); er.name = 'AbortError'; throw er; }
      throw e;
    }
  };

  /* 3. Guardar ficheiros (CSV, backup, PDF) nas Transferências */
  function guardar(a) {
    var name = a.download || 'ficheiro';
    fetch(a.href).then(function (r) { return r.blob(); }).then(async function (blob) {
      var data = await b64(blob);
      try {
        await JN.saveDownload({ name: name, mime: blob.type || 'application/octet-stream', data: data });
        try { window.dispatchEvent(new CustomEvent('apk-guardado', { detail: name })); } catch (e) {}
        aviso('Ficheiro guardado nas Transferências: ' + name);
      } catch (e) {
        var w = await FS.writeFile({ path: name, data: data, directory: 'CACHE' });
        await Share.share({ title: name, files: [w.uri], dialogTitle: 'Guardar ficheiro' });
      }
    }).catch(function () {});
  }
  function aviso(t) {
    try {
      var d = document.createElement('div');
      d.textContent = t;
      d.style.cssText = 'position:fixed;left:50%;bottom:80px;transform:translateX(-50%);max-width:85%;background:#0f172a;color:#fff;padding:10px 16px;border-radius:20px;font:14px sans-serif;z-index:99999;text-align:center;box-shadow:0 6px 16px rgba(0,0,0,.3)';
      document.body.appendChild(d);
      setTimeout(function () { d.remove(); }, 3500);
    } catch (e) {}
  }
  var origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && /^blob:/.test(this.href)) { guardar(this); return; }
    return origClick.apply(this, arguments);
  };
  var origDispatch = HTMLAnchorElement.prototype.dispatchEvent;
  HTMLAnchorElement.prototype.dispatchEvent = function (ev) {
    if (ev && ev.type === 'click' && this.download && /^blob:/.test(this.href)) { guardar(this); return true; }
    return origDispatch.apply(this, arguments);
  };

  /* 4. Imprimir (recibo 80 mm): abre o diálogo de impressão do Android (também guarda em PDF) */
  window.print = function () { try { JN.printPage(); } catch (e) {} };

  /* 5. Botão «voltar» do Android */
  if (App && App.addListener) {
    App.addListener('backButton', function () {
      try {
        var q = function (s) { return document.querySelector(s); };
        var m = q('.modal:not(.hidden)');
        if (m) {
          var b = m.querySelector('.close-modal') || m.querySelector('.ghost') || m.querySelector('button');
          if (b) b.click(); else m.classList.add('hidden');
          return;
        }
        if (q('#drawerMenu.open')) { var o = q('#drawerOverlay'); if (o) o.click(); return; }
        var ativo = q('.tab.active');
        if (ativo && ativo.getAttribute('data-tab') !== 'dashboard') {
          var d = q('.tab[data-tab="dashboard"]');
          if (d) { d.click(); return; }
        }
        App.exitApp();
      } catch (e) { try { App.exitApp(); } catch (x) {} }
    });
  }
})();
