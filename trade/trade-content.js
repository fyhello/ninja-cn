(function attachTradeContent() {
  'use strict';

  if (!window.location.pathname.includes('/trade')) return;

  let domScanner = null;

  function getTradeMode(lang) {
    if (lang === 'zh-TW') return 'zh-tw';
    if (lang === 'en') return 'off';
    return 'zh';
  }

  function purgeTradeCache() {
    try {
      const keys = [
        'lscache-trade2data',
        'lscache-trade2filters',
        'lscache-trade2items',
        'lscache-trade2stats',
        'lscache-tradedata',
        'lscache-tradefilters',
        'lscache-tradeitems',
        'lscache-tradestats',
      ];
      for (const k of keys) {
        window.localStorage.removeItem(k);
        window.localStorage.removeItem(k + '-cacheexpiration');
      }
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith('lscache-')) {
          window.localStorage.removeItem(k);
        }
      }
    } catch (e) {}
  }

  async function getStoredLanguage() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get(['language', 'preferredLanguage', 'selectedLanguage'], (res) => {
          const lang = res?.language || res?.preferredLanguage || res?.selectedLanguage || 'zh-CN';
          resolve(lang);
        });
      } else {
        resolve('zh-CN');
      }
    });
  }

  // 主世界市集引擎已通过 manifest.json 的 content_scripts 在 MAIN 世界以原生方式加载，0 违背 CSP

  async function initTradeBridge() {
    try {
      const language = await getStoredLanguage();
      const targetMode = getTradeMode(language);
      const currentMode = window.localStorage.getItem('poe-market-tool-trade-localization-mode');

      if (currentMode !== targetMode) {
        window.localStorage.setItem('poe-market-tool-trade-localization-mode', targetMode);
        purgeTradeCache();
      }

      const dictUrl = chrome.runtime.getURL('data/poe2.json');

      if (document.documentElement) {
        document.documentElement.dataset.poeNinjaDictUrl = dictUrl;
        document.documentElement.dataset.poeNinjaLanguage = language;
      }

      let dictionary = null;
      try {
        if (typeof DecompressionStream !== 'undefined' && chrome.runtime?.getURL) {
          const gzRes = await fetch(chrome.runtime.getURL('data/poe2.json.gz'));
          if (gzRes.ok) {
            const ds = new DecompressionStream('gzip');
            const stream = gzRes.body.pipeThrough(ds);
            const text = await new Response(stream).text();
            dictionary = JSON.parse(text);
          }
        }
      } catch (e) {}

      if (!dictionary && chrome.runtime?.getURL) {
        try {
          const res = await fetch(dictUrl);
          if (res.ok) dictionary = await res.json();
        } catch (e) {}
      }

      if (!dictionary && chrome.runtime?.sendMessage) {
        try {
          const res = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'GET_DICTIONARY', language }, (r) => resolve(r));
          });
          if (res?.ok) dictionary = res.dictionary;
        } catch (e) {}
      }

      if (!dictionary) return;

      // 1. 将词典与当前语言传递给 MAIN 世界的拦截器
      window.postMessage({
        type: 'POE_NINJA_INIT_TRADE_ENGINE',
        payload: {
          dictionary,
          language,
        },
      }, '*');

      // 2. 启动市集静态页面 DOM 扫描翻译器
      if (window.PoeNinjaTradeDom && window.PoeNinjaTranslationCore) {
        domScanner = window.PoeNinjaTradeDom.initTradeDomScanner(dictionary, language, window.PoeNinjaTranslationCore);
      }
    } catch (err) {
      // 优雅处理未刷新页面的生命周期更新
    }
  }

  // 监听存储中的语言变更
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes.language || changes.preferredLanguage || changes.selectedLanguage)) {
        const newLang = (changes.language || changes.preferredLanguage || changes.selectedLanguage).newValue || 'zh-CN';
        const targetMode = getTradeMode(newLang);
        window.localStorage.setItem('poe-market-tool-trade-localization-mode', targetMode);
        purgeTradeCache();
        window.location.reload();
      }
    });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'LANGUAGE_CHANGED' && msg.language) {
        const targetMode = getTradeMode(msg.language);
        window.localStorage.setItem('poe-market-tool-trade-localization-mode', targetMode);
        purgeTradeCache();
        window.location.reload();
      }
    });
  }

  initTradeBridge();
})();
