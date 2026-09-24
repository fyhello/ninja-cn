/** 在翻译脚本之前安装，保存 Trade API 响应的独立快照。 */
(() => {
  'use strict';

  if (window.__POE_NINJA_POB_HOOK_INSTALLED__) return;
  window.__POE_NINJA_POB_HOOK_INSTALLED__ = true;

  const MESSAGE_SOURCE = 'poe-ninja-trade-pob-raw';
  const MAX_CACHE_SIZE = 500;
  const rawCache = new Map();
  window.__POE_NINJA_RAW_CACHE__ = rawCache;

  function setCacheItem(id, item) {
    if (!id || !item) return;
    const key = String(id);
    if (rawCache.has(key)) {
      rawCache.delete(key);
    } else if (rawCache.size >= MAX_CACHE_SIZE) {
      const firstKey = rawCache.keys().next().value;
      if (firstKey) rawCache.delete(firstKey);
    }
    rawCache.set(key, item);
  }

  function isTradeFetchUrl(value) {
    try {
      const url = new URL(String(value || ''), window.location.origin);
      return url.origin === window.location.origin && /^\/api\/trade(?:2)?\/fetch\//.test(url.pathname);
    } catch {
      return false;
    }
  }

  function reportCaptureError(reason) {
    console.warn(`[复制 PoB] 原始物品响应读取失败：${reason}`);
  }

  function saveAndEmitRawJson(url, body) {
    let json;
    try {
      // JSON 响应也必须复制，页面后续对对象的修改不能污染原文。
      json = JSON.parse(typeof body === 'string' ? body : JSON.stringify(body));
    } catch {
      reportCaptureError('响应不是有效 JSON');
      return;
    }
    if (!json || !Array.isArray(json.result)) {
      reportCaptureError('响应缺少物品列表');
      return;
    }
    const entries = json.result.filter((entry) => entry?.item && typeof entry.item === 'object' && !Array.isArray(entry.item));
    for (const entry of entries) {
      for (const id of [entry.id, entry.itemId, entry.item.id]) {
        if (id) setCacheItem(id, entry.item);
      }
    }
    window.postMessage({
      source: MESSAGE_SOURCE,
      type: 'POE_NINJA_TRADE_FETCH_RAW',
      url,
      body: { result: entries },
    }, window.location.origin);
  }

  const originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function (...args) {
      const target = typeof Request !== 'undefined' && args[0] instanceof Request ? args[0].url : args[0];
      const requestUrl = String(target || '');
      const responsePromise = originalFetch.apply(this, args);
      if (isTradeFetchUrl(requestUrl)) {
        responsePromise.then(async (response) => {
          if (!response.ok) {
            reportCaptureError(`HTTP ${response.status}`);
            return;
          }
          const body = await response.clone().text();
          saveAndEmitRawJson(requestUrl, body);
        }).catch(() => reportCaptureError('网络请求或响应流读取失败'));
      }
      return responsePromise;
    };
  }

  if (window.XMLHttpRequest) {
    const prototype = window.XMLHttpRequest.prototype;
    const originalOpen = prototype.open;
    // 翻译模块会覆盖实例属性；直接调用初始化时的原生 getter 才能读到网络原文。
    const readText = Object.getOwnPropertyDescriptor(prototype, 'responseText')?.get;
    const readResponse = Object.getOwnPropertyDescriptor(prototype, 'response')?.get;
    const requests = new WeakMap();

    prototype.open = function (method, url, ...rest) {
      if (!requests.has(this)) {
        this.addEventListener('load', () => {
          const requestUrl = requests.get(this);
          if (!requestUrl) return;
          if (this.status < 200 || this.status >= 300) {
            reportCaptureError(`HTTP ${this.status}`);
            return;
          }
          try {
            let body;
            if (this.responseType === '' || this.responseType === 'text') {
              if (!readText) throw new Error();
              body = readText.call(this);
            } else if (this.responseType === 'json') {
              if (!readResponse) throw new Error();
              body = readResponse.call(this);
            } else {
              reportCaptureError('不支持的响应类型');
              return;
            }
            saveAndEmitRawJson(requestUrl, body);
          } catch {
            reportCaptureError('无法读取原生响应');
          }
        });
      }
      // 同一 XHR 可用于后续非市集请求，必须覆盖上一次地址。
      requests.set(this, isTradeFetchUrl(url) ? String(url) : null);
      return originalOpen.call(this, method, url, ...rest);
    };
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== window || event.origin !== window.location.origin || data?.source !== MESSAGE_SOURCE) return;
    if (data.type !== 'POE_NINJA_REQUEST_RAW_ITEM' || typeof data.requestId !== 'string' || typeof data.dataId !== 'string') return;
    const item = rawCache.get(data.dataId.trim());
    window.postMessage({
      source: MESSAGE_SOURCE,
      type: 'POE_NINJA_RESPONSE_RAW_ITEM',
      requestId: data.requestId,
      dataId: data.dataId,
      item: item ? JSON.parse(JSON.stringify(item)) : null,
    }, window.location.origin);
  });
})();
