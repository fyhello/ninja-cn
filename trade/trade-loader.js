(async function attachTradeEngineBootstrap() {
  'use strict';
  if (!window.location.pathname.includes('/trade')) return;

  try {
    let mode = window.localStorage.getItem('poe-market-tool-trade-localization-mode') || window.localStorage.getItem('language');
    if (mode === 'zh-TW' || mode === 'zh-tw') {
      window.localStorage.setItem('poe-market-tool-trade-localization-mode', 'zh-tw');
    } else if (mode === 'en') {
      window.localStorage.setItem('poe-market-tool-trade-localization-mode', 'off');
    } else if (!mode) {
      window.localStorage.setItem('poe-market-tool-trade-localization-mode', 'zh');
    }
  } catch (e) {}

  try {
    if (typeof DecompressionStream !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      const gzUrl = chrome.runtime.getURL('trade/trade-standalone.js.gz');
      const res = await fetch(gzUrl);
      if (res.ok) {
        const ds = new DecompressionStream('gzip');
        const stream = res.body.pipeThrough(ds);
        const code = await new Response(stream).text();
        const script = document.createElement('script');
        script.textContent = code;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
        return;
      }
    }
  } catch (err) {}

  // 回退：直接注入未压缩版脚本
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('trade/trade-standalone.js');
    s.async = false;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  }
})();
