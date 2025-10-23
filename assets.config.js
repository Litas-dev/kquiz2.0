// Global helpers for resolving static asset paths inside KQuiz.
(function registerKQuizAssets() {
  try {
    const script = document.currentScript || Array.from(document.getElementsByTagName('script')).find(s => /assets\.config\.js/i.test(s?.src || ''));
    const url = script?.src ? new URL(script.src, window.location.href) : new URL('./', window.location.href);
    const basePath = (() => {
      const path = url.pathname.replace(/[^/]+$/, '');
      return path.endsWith('/') ? path : `${path}/`;
    })();
    const assetsBase = `${basePath}assets/`;

    const join = (kind, name) => {
      name = String(name || '').replace(/^[\\/]+/, '');
      return `${assetsBase}${kind}/${name}`;
    };

    window.KQ_ASSETS = Object.assign(window.KQ_ASSETS || {}, {
      base: assetsBase,
      audio: (name) => join('audio', name),
      image: (name) => join('images', name),
    });
  } catch (err) {
    console.error('[KQuiz] failed to bootstrap asset helpers', err);
  }
})();
