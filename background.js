'use strict';

const LANGUAGE_VALUES = new Set(['en', 'zh-CN', 'zh-TW']);
const dictionaryCache = new Map();

function detectDefaultLanguage() {
  const language = chrome.i18n.getUILanguage();
  if (language.startsWith('zh-TW') || language.startsWith('zh-Hant')) return 'zh-TW';
  if (language.startsWith('zh')) return 'zh-CN';
  return 'en';
}

async function getLanguage() {
  const { language } = await chrome.storage.local.get('language');
  return LANGUAGE_VALUES.has(language) ? language : detectDefaultLanguage();
}

async function loadDictionary(_game, language = 'en') {
  const validGame = 'poe2';
  const validLanguage = LANGUAGE_VALUES.has(language) ? language : 'en';
  const cacheKey = `${validGame}:${validLanguage}`;
  if (!dictionaryCache.has(cacheKey)) {
    const load = (async () => {
      try {
        if (typeof DecompressionStream !== 'undefined') {
          const gzResponse = await fetch(chrome.runtime.getURL(`data/${validGame}.json.gz`));
          if (gzResponse.ok) {
            const ds = new DecompressionStream('gzip');
            const decompressedStream = gzResponse.body.pipeThrough(ds);
            const text = await new Response(decompressedStream).text();
            console.log(`[POE-Ninja] 🚀 成功通过浏览器硬件加速原生流式解压 data/${validGame}.json.gz 词典包 (2.43 MB)`);
            return JSON.parse(text);
          }
        }
      } catch (err) {
        console.warn(`[POE-Ninja] .json.gz stream decompression fallback: ${err.message}`);
      }
      const response = await fetch(chrome.runtime.getURL(`data/${validGame}.json`));
      if (!response.ok) throw new Error(`Could not load ${validGame} dictionary`);
      return response.json();
    })();
    dictionaryCache.set(cacheKey, load);
  }
  return dictionaryCache.get(cacheKey);
}

chrome.runtime.onInstalled.addListener(async () => {
  const { language } = await chrome.storage.local.get('language');
  if (!LANGUAGE_VALUES.has(language)) {
    await chrome.storage.local.set({ language: detectDefaultLanguage() });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'INSTALL_TRADE_FETCH_LOCALIZATION') {
    const tabId = _sender.tab?.id;
    if (tabId && chrome.scripting) {
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['trade/trade-standalone.js'],
        world: 'MAIN',
      }, () => {
        if (chrome.runtime.lastError) {
          sendResponse({ status: 'error', message: chrome.runtime.lastError.message });
        } else {
          sendResponse({ status: 'success' });
        }
      });
      return true;
    }
  }

  if (message?.type === 'GET_DICTIONARY') {
    Promise.resolve(message.language ? message.language : getLanguage())
      .then((requestedLanguage) => loadDictionary(message.game, requestedLanguage))
      .then((dictionary) => sendResponse({ ok: true, dictionary }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'GET_LANGUAGE') {
    getLanguage()
      .then((language) => sendResponse({ ok: true, language }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'SET_LANGUAGE') {
    if (!LANGUAGE_VALUES.has(message.language)) {
      sendResponse({ ok: false, error: 'Unsupported language' });
      return false;
    }
    chrome.storage.local.set({ language: message.language })
      .then(() => {
        chrome.tabs.query({}, (tabs) => {
          for (const tab of tabs || []) {
            if (tab.id && tab.url && (tab.url.includes('pathofexile.com') || tab.url.includes('poe.ninja'))) {
              try {
                chrome.tabs.sendMessage(tab.id, { type: 'LANGUAGE_CHANGED', language: message.language }, () => {
                  if (chrome.runtime.lastError) {
                    // 抑制未就绪标签页的连接通知
                  }
                });
              } catch (e) {}
            }
          }
        });
        sendResponse({ ok: true, language: message.language });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
