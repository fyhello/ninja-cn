(function attachDictionaryLoader(root) {
  'use strict';

  let cachedDictionary = null;
  let loadingPromise = null;

  async function loadPoe2Dictionary() {
    if (cachedDictionary) return cachedDictionary;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
          const url = chrome.runtime.getURL('data/poe2.json');
          const res = await fetch(url);
          cachedDictionary = await res.json();
          return cachedDictionary;
        }
      } catch (err) {
        console.warn('[DictionaryLoader] load failed:', err);
      }
      return null;
    })().finally(() => {
      loadingPromise = null;
    });

    return loadingPromise;
  }

  function getCachedDictionary() {
    return cachedDictionary;
  }

  const DictionaryLoader = Object.freeze({
    loadPoe2Dictionary,
    getCachedDictionary,
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DictionaryLoader;
  } else {
    root.PoeNinjaDictionaryLoader = DictionaryLoader;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
