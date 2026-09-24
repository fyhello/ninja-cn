(function attachTradeHookMain() {
  'use strict';

  if (window.__POE_NINJA_TRADE_HOOK_INSTALLED__) return;
  window.__POE_NINJA_TRADE_HOOK_INSTALLED__ = true;

  let currentLanguage = 'zh-CN';
  try {
    const saved = window.localStorage.getItem('preferredLanguage') || window.localStorage.getItem('selectedLanguage');
    if (saved) currentLanguage = saved;
  } catch {}

  let currentDictionary = null;
  let tradeFetchEngine = null;
  let tradeSearchHelper = null;
  let engineReadyResolve = null;
  const engineReadyPromise = new Promise((resolve) => {
    engineReadyResolve = resolve;
  });

  function initEngineWithDict(dict, lang) {
    if (!dict || !window.PoeNinjaTradeFetchEngine || !window.PoeNinjaTradeSearchHelper) return;
    currentDictionary = dict;
    if (lang) currentLanguage = lang;
    tradeFetchEngine = window.PoeNinjaTradeFetchEngine.createTradeFetchEngine(dict, currentLanguage);
    tradeSearchHelper = window.PoeNinjaTradeSearchHelper.createTradeSearchHelper(tradeFetchEngine, dict);
    if (engineReadyResolve) engineReadyResolve();
  }

  // 尝试直接从页面 dataset 中的 dictUrl 自加载（超轻量，15ms 内自闭环完成）
  async function trySelfLoadDictionary() {
    try {
      const dictUrl = document.documentElement?.dataset?.poeNinjaDictUrl;
      const lang = document.documentElement?.dataset?.poeNinjaLanguage || currentLanguage;
      if (dictUrl) {
        const res = await rawFetch(dictUrl);
        if (res.ok) {
          const dict = await res.json();
          initEngineWithDict(dict, lang);
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  trySelfLoadDictionary();

  async function ensureEngineReady(timeoutMs = 15000) {
    if (tradeFetchEngine && tradeSearchHelper) return true;
    trySelfLoadDictionary();
    const timer = new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs));
    return Promise.race([engineReadyPromise.then(() => true), timer]);
  }

  // 1. 监听来自 Isolated Content Script 的词典与配置初始化（支持热重载与语言切换）
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'POE_NINJA_INIT_TRADE_ENGINE') {
      const { dictionary, language } = event.data.payload || {};
      initEngineWithDict(dictionary, language);
    } else if (event.data.type === 'POE_NINJA_CHANGE_LANGUAGE') {
      currentLanguage = event.data.language || 'zh-CN';
      try {
        window.localStorage.setItem('preferredLanguage', currentLanguage);
      } catch {}
      if (currentDictionary) {
        initEngineWithDict(currentDictionary, currentLanguage);
      }
    }
  });

  function classifyTradeUrl(rawUrl) {
    const url = String(rawUrl || '');
    if (/\/trade(?:2)?\/fetch\//.test(url)) return 'fetch';
    if (/\/trade(?:2)?\/data\/stats/.test(url)) return 'stats';
    if (/\/trade(?:2)?\/data\/items/.test(url)) return 'items';
    if (/\/trade(?:2)?\/data\/static/.test(url)) return 'static';
    if (/\/trade(?:2)?\/search\//.test(url)) return 'search';
    return null;
  }

  // 2. 劫持 window.fetch
  const rawFetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    let url = typeof input === 'string' ? input : (input?.url || '');
    const reqType = classifyTradeUrl(url);

    // 2.1 处理搜索提交请求：将 body 内的中文名称还原为英文再发送
    let customInit = init;
    let customInput = input;

    if (reqType === 'search' && tradeFetchEngine) {
      try {
        if (init && typeof init.body === 'string') {
          const restoredBody = tradeFetchEngine.restoreSearchQueryJson(init.body);
          if (restoredBody !== init.body) {
            customInit = { ...init, body: restoredBody };
          }
        } else if (input instanceof Request && typeof input.clone === 'function') {
          const rawText = await input.clone().text();
          const restoredBody = tradeFetchEngine.restoreSearchQueryJson(rawText);
          if (restoredBody !== rawText) {
            customInput = new Request(input, { body: restoredBody });
          }
        }
      } catch (e) {}
    }

    const response = await rawFetch(customInput, customInit);
    if (!response || !response.ok || currentLanguage === 'en') {
      return response;
    }

    if (!reqType || reqType === 'search') {
      return response;
    }

    try {
      // 确保词典已就绪（首屏请求安全等待）
      await ensureEngineReady();
      if (!tradeFetchEngine) return response;

      // 克隆并转换 JSON 数据
      const cloneRes = response.clone();
      const rawJson = await cloneRes.json();
      let transformedJson = rawJson;

      if (reqType === 'fetch') {
        transformedJson = tradeFetchEngine.transformFetchResponse(rawJson, currentLanguage);
      } else if (reqType === 'stats' && tradeSearchHelper) {
        transformedJson = tradeSearchHelper.transformStatsMetadata(rawJson, currentLanguage);
      } else if (reqType === 'items' && tradeSearchHelper) {
        transformedJson = tradeSearchHelper.transformItemsMetadata(rawJson, currentLanguage);
      } else if (reqType === 'static' && tradeSearchHelper) {
        transformedJson = tradeSearchHelper.transformStaticMetadata(rawJson, currentLanguage);
      }

      return new Response(JSON.stringify(transformedJson), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (err) {
      console.warn('[TradeHook] fetch intercept fallback:', err);
      return response;
    }
  };

  // 3. 劫持 window.XMLHttpRequest
  if (window.XMLHttpRequest) {
    const rawOpen = XMLHttpRequest.prototype.open;
    const rawSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._tradeUrl = String(url || '');
      this._tradeReqType = classifyTradeUrl(this._tradeUrl);
      return rawOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (body, ...args) {
      let sendBody = body;
      const reqType = this._tradeReqType;

      // 搜索请求：反向还原为英文
      if (reqType === 'search' && typeof body === 'string' && tradeFetchEngine) {
        try {
          sendBody = tradeFetchEngine.restoreSearchQueryJson(body);
        } catch (e) {}
      }

      if (reqType && reqType !== 'search' && currentLanguage !== 'en') {
        const onReadyStateChange = this.onreadystatechange;
        this.onreadystatechange = function (...evArgs) {
          if (this.readyState === 4 && this.status === 200 && tradeFetchEngine) {
            try {
              let rawJson = null;
              if (this.responseType === 'json' && typeof this.response === 'object' && this.response !== null) {
                rawJson = this.response;
              } else if (!this.responseType || this.responseType === 'text') {
                if (this.responseText) rawJson = JSON.parse(this.responseText);
              }
              if (!rawJson) {
                if (typeof onReadyStateChange === 'function') return onReadyStateChange.apply(this, evArgs);
                return;
              }

              let transformedJson = rawJson;
              if (reqType === 'fetch') {
                transformedJson = tradeFetchEngine.transformFetchResponse(rawJson, currentLanguage);
              } else if (reqType === 'stats' && tradeSearchHelper) {
                transformedJson = tradeSearchHelper.transformStatsMetadata(rawJson, currentLanguage);
              } else if (reqType === 'items' && tradeSearchHelper) {
                transformedJson = tradeSearchHelper.transformItemsMetadata(rawJson, currentLanguage);
              } else if (reqType === 'static' && tradeSearchHelper) {
                transformedJson = tradeSearchHelper.transformStaticMetadata(rawJson, currentLanguage);
              }

              if (this.responseType === 'json') {
                Object.defineProperty(this, 'response', {
                  get: () => transformedJson,
                  configurable: true,
                });
              } else {
                const transformedStr = JSON.stringify(transformedJson);
                Object.defineProperty(this, 'responseText', {
                  get: () => transformedStr,
                  configurable: true,
                });
                Object.defineProperty(this, 'response', {
                  get: () => transformedStr,
                  configurable: true,
                });
              }
            } catch (e) {}
          }
          if (typeof onReadyStateChange === 'function') {
            return onReadyStateChange.apply(this, evArgs);
          }
        };
      }
      return rawSend.call(this, sendBody, ...args);
    };
  }
})();
