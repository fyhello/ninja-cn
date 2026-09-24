import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

export async function buildTradeStandalone(poe2Dict) {
  console.log('⚡ 正在编译全量自包含市集引擎: trade/trade-standalone.js...');

  // 1. 提取官方精准 stat_id 映射
  const officialStatsJson = JSON.parse(await readFile(resolve(ROOT, 'tools/upstream-builder/dictionary/lookup/poe2_stats_official.json'), 'utf-8'));
  const statIdMap = {};
  for (const group of officialStatsJson) {
    for (const entry of group.entries || []) {
      if (entry.id && entry.text) {
        statIdMap[entry.id] = entry.text;
      }
    }
  }
  console.log('  ✔ 已加载官方 POE2 词缀 ID 映射:', Object.keys(statIdMap).length, '条');

  // 2. 提取精炼 stats (英文文本映射备用)
  const statsMap = {};
  for (const [en, entry] of Object.entries(poe2Dict.stats || {})) {
    const zh = typeof entry === 'string' ? entry : (entry['zh-CN'] || entry.translation);
    if (zh) statsMap[en] = zh;
  }
  for (const [en, entry] of Object.entries(poe2Dict.tooltip || {})) {
    const zh = typeof entry === 'string' ? entry : (entry['zh-CN'] || entry.translation);
    if (zh && !statsMap[en]) statsMap[en] = zh;
  }

  // 3. 提取精炼 items
  const itemsMap = {};
  for (const [en, entry] of Object.entries(poe2Dict.items || {})) {
    const zh = typeof entry === 'string' ? entry : (entry['zh-CN'] || entry.translation);
    if (zh) itemsMap[en] = zh;
  }
  for (const [en, entry] of Object.entries(poe2Dict.terms || {})) {
    const zh = typeof entry === 'string' ? entry : (Array.isArray(entry) ? entry[0] : (entry.translation || entry['zh-CN']));
    if (zh && !itemsMap[en]) itemsMap[en] = zh;
  }

  // 4. 提取精炼 ui
  const uiMap = {};
  for (const [en, entry] of Object.entries(poe2Dict.ui || {})) {
    const zh = typeof entry === 'string' ? entry : (entry['zh-CN'] || entry.translation);
    if (zh) uiMap[en] = zh;
  }

  // 5. 提取反向 reverseMap
  const reverseMap = {};
  for (const [en, zh] of Object.entries(itemsMap)) {
    if (typeof zh === 'string' && zh.trim()) {
      const cleanZh = zh.trim();
      if (!reverseMap[cleanZh]) {
        reverseMap[cleanZh] = en;
      } else {
        const existing = reverseMap[cleanZh];
        if (existing.endsWith('s') && !en.endsWith('s')) {
          reverseMap[cleanZh] = en;
        } else if (en.length < existing.length && !en.endsWith('s')) {
          reverseMap[cleanZh] = en;
        }
      }
    }
  }

  const standaloneTemplate = `(function attachTradeStandalone(root) {
  'use strict';

  if (root.__POE_TRADE_STANDALONE_INSTALLED__) return;
  root.__POE_TRADE_STANDALONE_INSTALLED__ = true;

  // 0. 清除官方市集 lscache 英文持久化旧缓存，强制官方前端重新发起网络请求并走拦截
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
        root.localStorage.removeItem(k);
        root.localStorage.removeItem(k + '-cacheexpiration');
      }
      for (let i = root.localStorage.length - 1; i >= 0; i--) {
        const k = root.localStorage.key(i);
        if (k && k.startsWith('lscache-')) {
          root.localStorage.removeItem(k);
        }
      }
    } catch (e) {}
  }
  purgeTradeCache();

  const STAT_ID_DICT = ${JSON.stringify(statIdMap)};
  const STATS_DICT = ${JSON.stringify(statsMap)};
  const ITEMS_DICT = ${JSON.stringify(itemsMap)};
  const UI_DICT = ${JSON.stringify(uiMap)};
  const REVERSE_DICT = ${JSON.stringify(reverseMap)};

  let currentLanguage = 'zh-CN';
  try {
    const saved = root.localStorage.getItem('preferredLanguage') || root.localStorage.getItem('selectedLanguage');
    if (saved) currentLanguage = saved;
  } catch {}

  function normalizeText(str) {
    return String(str || '').replace(/\\s+/g, ' ').trim();
  }

  // 1. 词缀与物品翻译核心
  function translateModLine(text) {
    if (!text || typeof text !== 'string') return text;
    const clean = normalizeText(text);

    // 精确匹配
    if (STATS_DICT[clean]) return STATS_DICT[clean];

    // 模板提取匹配
    const numbers = [];
    const template = clean.replace(/([+-]?\\d+(?:\\.\\d+)?%?)/g, (match) => {
      numbers.push(match);
      return match.endsWith('%') ? '#%' : '#';
    });

    const templateTrans = STATS_DICT[template];
    if (templateTrans && typeof templateTrans === 'string') {
      let idx = 0;
      return templateTrans.replace(/#%?/g, () => numbers[idx++] || '#');
    }

    return text;
  }

  function translateItemName(name) {
    if (!name || typeof name !== 'string') return name;
    const clean = normalizeText(name);
    return ITEMS_DICT[clean] || ITEMS_DICT[clean.toLowerCase()] || UI_DICT[clean] || name;
  }

  function restoreEnglishText(text) {
    if (!text || typeof text !== 'string') return text;
    const clean = normalizeText(text);

    const bracketMatch = clean.match(/[\\(（]([^\\)）]+)[\\)）]$/);
    if (bracketMatch && bracketMatch[1]) {
      return bracketMatch[1].trim();
    }

    if (REVERSE_DICT[clean]) return REVERSE_DICT[clean];
    if (REVERSE_DICT[clean.toLowerCase()]) return REVERSE_DICT[clean.toLowerCase()];

    for (const [zh, en] of Object.entries(REVERSE_DICT)) {
      if (clean === zh || clean.startsWith(zh)) {
        return en;
      }
    }
    return text;
  }

  function restoreSearchQueryJson(jsonStr) {
    if (!jsonStr || typeof jsonStr !== 'string') return jsonStr;
    try {
      const parsed = JSON.parse(jsonStr);
      if (!parsed || typeof parsed !== 'object') return jsonStr;

      let modified = false;
      function normalizeQueryObject(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (typeof obj.name === 'string') {
          const restored = restoreEnglishText(obj.name);
          if (restored !== obj.name) {
            obj.name = restored;
            modified = true;
          }
        }
        if (typeof obj.type === 'string') {
          const restored = restoreEnglishText(obj.type);
          if (restored !== obj.type) {
            obj.type = restored;
            modified = true;
          }
        }
      }

      normalizeQueryObject(parsed);
      if (parsed.query) normalizeQueryObject(parsed.query);
      if (parsed.persistent) normalizeQueryObject(parsed.persistent);

      return modified ? JSON.stringify(parsed) : jsonStr;
    } catch {
      return jsonStr;
    }
  }

  // 2. 数据流转换器
  function transformStats(json) {
    if (!json || !Array.isArray(json.result)) return json;
    const categoryMap = {
      explicit: '显式词缀',
      implicit: '隐式词缀',
      enchant: '附魔词缀',
      crafted: '工艺词缀',
      fractured: '分裂词缀',
      sanctified: '圣化词缀',
      rune: '符文词缀',
      pseudo: '综合统计',
      monster: '怪物词缀',
    };

    for (const group of json.result) {
      if (!group) continue;
      if (group.id && categoryMap[group.id]) group.label = categoryMap[group.id];
      if (Array.isArray(group.entries)) {
        for (const stat of group.entries) {
          if (!stat || !stat.text) continue;
          const orig = stat.text;
          const trans = (stat.id && STAT_ID_DICT[stat.id]) ? STAT_ID_DICT[stat.id] : translateModLine(orig);
          if (trans && trans !== orig) {
            stat._rawText = orig;
            stat.text = trans;
          }
          if (stat.option && Array.isArray(stat.option.options)) {
            for (const opt of stat.option.options) {
              if (opt && opt.text) {
                const optOrig = opt.text;
                const optTrans = translateItemName(optOrig) || translateModLine(optOrig);
                if (optTrans && optTrans !== optOrig) {
                  opt._rawText = optOrig;
                  opt.text = optTrans;
                }
              }
            }
          }
        }
      }
    }
    return json;
  }

  function transformItems(json) {
    if (!json || !Array.isArray(json.result)) return json;
    const categoryMap = {
      accessory: '饰品',
      armour: '防具',
      flask: '药剂',
      gem: '技能宝石',
      jewel: '珠宝',
      map: '地图',
      weapon: '武器',
      leaguestone: '联盟石',
      currency: '通货',
    };

    for (const group of json.result) {
      if (!group) continue;
      if (group.id && categoryMap[group.id]) group.label = categoryMap[group.id];
      if (Array.isArray(group.entries)) {
        for (const item of group.entries) {
          if (!item) continue;
          const origName = item.name;
          const origType = item.type;
          const origText = item.text;

          const transName = origName ? translateItemName(origName) : '';
          const transType = origType ? translateItemName(origType) : '';

          item._rawEnglish = { name: origName, type: origType, text: origText };

          if (transName && transName !== origName) item.name = transName;
          if (transType && transType !== origType) item.type = transType;
          if (transName || transType) {
            const zhPart = [transName, transType].filter(Boolean).join(' ');
            item.text = \`\${zhPart} \${origText || ''}\`.trim();
          }
        }
      }
    }
    return json;
  }

  function transformStatic(json) {
    if (!json || !Array.isArray(json.result)) return json;
    for (const group of json.result) {
      if (!group || !Array.isArray(group.entries)) continue;
      if (group.label) {
        const transGroup = UI_DICT[group.label] || translateItemName(group.label);
        if (transGroup) group.label = transGroup;
      }
      for (const item of group.entries) {
        if (!item || !item.text) continue;
        const origText = item.text;
        const transText = translateItemName(origText);
        if (transText && transText !== origText) {
          item._rawText = origText;
          item.text = transText;
        }
      }
    }
    return json;
  }

  function transformFetch(json) {
    if (!json || !Array.isArray(json.result)) return json;
    for (const entry of json.result) {
      const item = entry?.item;
      if (!item) continue;

      if (item.name) {
        const transName = translateItemName(item.name);
        if (transName) item.name = transName;
      }
      if (item.typeLine) {
        const transType = translateItemName(item.typeLine);
        if (transType) item.typeLine = transType;
      }
      if (item.baseType) {
        const transBase = translateItemName(item.baseType);
        if (transBase) item.baseType = transBase;
      }

      const modKeys = ['explicitMods', 'implicitMods', 'enchantMods', 'craftedMods', 'fracturedMods', 'runeMods', 'scourgeMods', 'pseudoMods'];
      for (const key of modKeys) {
        if (Array.isArray(item[key])) {
          item[key] = item[key].map((mod) => {
            if (typeof mod === 'string') {
              return translateModLine(mod);
            }
            if (mod && typeof mod === 'object') {
              const clone = { ...mod };
              if (clone.description) clone.description = translateModLine(clone.description);
              if (clone.text) clone.text = translateModLine(clone.text);
              return clone;
            }
            return mod;
          });
        }
      }
    }
    return json;
  }

  function classifyTradeUrl(rawUrl) {
    const url = String(rawUrl || '');
    if (url.includes('/fetch/')) return 'fetch';
    if (url.includes('/data/stats')) return 'stats';
    if (url.includes('/data/items')) return 'items';
    if (url.includes('/data/static')) return 'static';
    if (url.includes('/search/')) return 'search';
    return null;
  }

  // 3. 劫持 window.fetch
  const rawFetch = root.fetch.bind(root);

  root.fetch = async function (input, init) {
    let url = typeof input === 'string' ? input : (input?.url || '');
    const reqType = classifyTradeUrl(url);

    let customInit = init;
    let customInput = input;

    if (reqType === 'search') {
      try {
        if (init && typeof init.body === 'string') {
          const restored = restoreSearchQueryJson(init.body);
          if (restored !== init.body) customInit = { ...init, body: restored };
        } else if (input instanceof Request && typeof input.clone === 'function') {
          const rawText = await input.clone().text();
          const restored = restoreSearchQueryJson(rawText);
          if (restored !== rawText) customInput = new Request(input, { body: restored });
        }
      } catch (e) {}
    }

    const response = await rawFetch(customInput, customInit);
    if (!response || !response.ok || !reqType || reqType === 'search') {
      return response;
    }

    try {
      const cloneRes = response.clone();
      const rawJson = await cloneRes.json();
      let transformedJson = rawJson;

      if (reqType === 'fetch') transformedJson = transformFetch(rawJson);
      else if (reqType === 'stats') transformedJson = transformStats(rawJson);
      else if (reqType === 'items') transformedJson = transformItems(rawJson);
      else if (reqType === 'static') transformedJson = transformStatic(rawJson);

      return new Response(JSON.stringify(transformedJson), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (err) {
      return response;
    }
  };

  // 4. 劫持 XMLHttpRequest
  if (root.XMLHttpRequest) {
    const rawOpen = root.XMLHttpRequest.prototype.open;
    const rawSend = root.XMLHttpRequest.prototype.send;

    root.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._tradeUrl = String(url || '');
      this._tradeReqType = classifyTradeUrl(this._tradeUrl);
      return rawOpen.call(this, method, url, ...rest);
    };

    root.XMLHttpRequest.prototype.send = function (body, ...args) {
      let sendBody = body;
      const reqType = this._tradeReqType;

      if (reqType === 'search' && typeof body === 'string') {
        try {
          sendBody = restoreSearchQueryJson(body);
        } catch (e) {}
      }

      if (reqType && reqType !== 'search') {
        const onReadyStateChange = this.onreadystatechange;
        this.onreadystatechange = function (...evArgs) {
          if (this.readyState === 4 && this.status === 200 && this.responseText) {
            try {
              const rawJson = JSON.parse(this.responseText);
              let transformedJson = rawJson;

              if (reqType === 'fetch') transformedJson = transformFetch(rawJson);
              else if (reqType === 'stats') transformedJson = transformStats(rawJson);
              else if (reqType === 'items') transformedJson = transformItems(rawJson);
              else if (reqType === 'static') transformedJson = transformStatic(rawJson);

              const transformedStr = JSON.stringify(transformedJson);
              Object.defineProperty(this, 'responseText', { get: () => transformedStr, configurable: true });
              Object.defineProperty(this, 'response', { get: () => transformedStr, configurable: true });
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

  // 5. 静态 DOM 扫描器
  function scanAndTranslateTextNodes(rootNode = document.body) {
    if (!rootNode) return;
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const raw = node.textContent;
      if (!raw || !raw.trim() || raw.length < 2) continue;
      const clean = normalizeText(raw);
      const trans = UI_DICT[clean] || ITEMS_DICT[clean] || ITEMS_DICT[clean.toLowerCase()];
      if (trans && trans !== clean) {
        node.textContent = raw.replace(clean, trans);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scanAndTranslateTextNodes(), { once: true });
  } else {
    scanAndTranslateTextNodes();
  }

  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) scanAndTranslateTextNodes(n);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  console.log('[POE Ninja Trade Standalone] 官方市集全量自包含引擎已成功就绪！');
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;

  const targetPath = resolve(ROOT, 'trade', 'trade-standalone.js');
  await writeFile(targetPath, Buffer.from(standaloneTemplate, 'utf8'));
  console.log(`  ✔ trade/trade-standalone.js 编译完成 (${(Buffer.byteLength(standaloneTemplate) / 1024 / 1024).toFixed(2)} MB)`);
}
