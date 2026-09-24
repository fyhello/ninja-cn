import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchTradeLocalization } from './trade-localization-patches.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePath = 'C:/Users/25147/AppData/Local/Microsoft/Edge/User Data/Default/Extensions/gdibdimemfkffpdpjdipepickopdknno/5.0.0_0/content.7ca3a3fd.js';
const code = readFileSync(sourcePath, 'utf-8');

const allIds = [
  '8HOgZ', 'kpODA', 'xxWhX', 'g0nNn', '7WnNY', 'jc1Wq', 'jNLJZ', 'jffuz', '93aQs', 'k5Swp', 'j5l8v', 'cFyOv', 'cHUbl',
  'kRWsJ', 'fCxnq', '7maFw', 'h0FOR', '9mCYs'
];

function getModuleStartIndex(code, modId) {
  let idx = code.indexOf(`"${modId}":[function`);
  if (idx === -1) idx = code.indexOf(`${modId}:[function`);
  if (idx === -1) idx = code.indexOf(`"${modId}": [function`);
  if (idx === -1) idx = code.indexOf(`${modId}: [function`);
  if (idx === -1) throw new Error(`Not found ${modId}`);
  return idx;
}

function extractParcelModule(code, modId) {
  const start = getModuleStartIndex(code, modId);
  const re = /(?:\"[a-zA-Z0-9_-]+\"|[a-zA-Z0-9_-]+):\s*\[\s*function/g;
  re.lastIndex = start + 10;
  const nextMatch = re.exec(code);
  const searchEnd = nextMatch ? nextMatch.index : code.length;
  
  const endIdx = code.lastIndexOf('}]', searchEnd);
  const raw = code.slice(start, endIdx + 2);
  return raw.startsWith(`"${modId}"`) ? raw : `"${modId}"` + raw.slice(modId.length);
}

const moduleSnippets = allIds.map((id) => extractParcelModule(code, id));

const runtime = `(function(globalRoot) {
  'use strict';
  var parcelRequire = (function (modules, entry) {
    var globalObject = typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : {};
    var cache = {};

    function newRequire(name) {
      if (!cache[name]) {
        if (!modules[name]) {
          var err = new Error("Cannot find module '" + name + "'");
          err.code = 'MODULE_NOT_FOUND';
          throw err;
        }

        var module = (cache[name] = { exports: {} });

        try {
          modules[name][0].call(
            module.exports,
            function(x) {
              var id = modules[name][1] ? modules[name][1][x] : null;
              return newRequire(id != null ? id : x);
            },
            module,
            module.exports,
            globalObject
          );
        } catch (err) {
          console.error("Module " + name + " failed during execution:", err);
          throw err;
        }
      }

      return cache[name].exports;
    }

    var entryExports = newRequire(entry);
    var baseSectionMod = newRequire("kRWsJ");
    var decodeMod = newRequire("fCxnq");
    var pobModsMod = newRequire("7maFw");

    var combined = Object.assign({}, entryExports, baseSectionMod, decodeMod, pobModsMod);
    return combined;
  })({
    ${moduleSnippets.join(',\n    ')}
  }, "8HOgZ");

  globalRoot.Poe2PobConverter = parcelRequire;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = parcelRequire;
  }
})(typeof window !== 'undefined' ? window : globalThis);
`;

const outputPath = resolve(ROOT, 'lib', 'poe2-pob-converter.js');
if (!process.argv.includes('--trade-only')) writeFileSync(outputPath, runtime, 'utf-8');
import { gzipSync } from 'node:zlib';

export async function buildOfficialTradeEngine() {
  const sourcePath = 'C:/Users/25147/AppData/Local/Microsoft/Edge/User Data/Default/Extensions/gdibdimemfkffpdpjdipepickopdknno/5.0.0_0/trade-localization-main-early.3d44d968.js';
  let rawCode = readFileSync(sourcePath, 'utf-8');
  rawCode = patchTradeLocalization(rawCode);

  const zhTranslatePath = 'C:/Users/25147/AppData/Local/Microsoft/Edge/User Data/Default/Extensions/gdibdimemfkffpdpjdipepickopdknno/5.0.0_0/utils/transform/poe2/zh/translate.js';
  const zhtwTranslatePath = 'C:/Users/25147/AppData/Local/Microsoft/Edge/User Data/Default/Extensions/gdibdimemfkffpdpjdipepickopdknno/5.0.0_0/utils/transform/poe2/zh-tw/translate.js';
  const zhTranslateCode = readFileSync(zhTranslatePath, 'utf-8');
  const zhtwTranslateCode = readFileSync(zhtwTranslatePath, 'utf-8');

  const dictBootstrap = `
(function initTradeTransformDict() {
  var mode = 'zh';
  try {
    var m = window.localStorage.getItem('poe-market-tool-trade-localization-mode') || window.localStorage.getItem('language');
    if (m === 'zh-tw' || m === 'zh-TW') mode = 'zh-tw';
    else if (m === 'off' || m === 'en') mode = 'off';
  } catch (e) {}

  if (mode === 'zh-tw') {
    ${zhtwTranslateCode}
  } else if (mode === 'zh') {
    ${zhTranslateCode}
  }
})();
`;

  // 1. 彻底将默认未设置模式改为 'zh' (简体中文)，杜绝因无 key 而被关闭汉化引擎
  rawCode = rawCode.replaceAll('return"off"', 'return (function(){try{var m=window.localStorage.getItem("poe-market-tool-trade-localization-mode")||window.localStorage.getItem("language");if(m==="zh-tw"||m==="zh-TW")return"zh-tw";if(m==="off"||m==="en")return"off";}catch(e){}return"zh";})()');

  // 2. 构建主世界独立引擎完整代码（内置全量translate字典 + 自动清理英文旧缓存）
  const prefix = `(function attachPoeTradeOfficialEngine(globalRoot) {
  'use strict';

  try {
    var mode = globalRoot.localStorage.getItem('poe-market-tool-trade-localization-mode') || globalRoot.localStorage.getItem('language');
    if (mode === 'zh-TW' || mode === 'zh-tw') {
      globalRoot.localStorage.setItem('poe-market-tool-trade-localization-mode', 'zh-tw');
    } else if (mode === 'off' || mode === 'en') {
      globalRoot.localStorage.setItem('poe-market-tool-trade-localization-mode', 'off');
    } else {
      globalRoot.localStorage.setItem('poe-market-tool-trade-localization-mode', 'zh');
    }

    // 检查并清除未汉化的旧 lscache 缓存（彻底杜绝搜索框英文与无结果）
    var statsCache = globalRoot.localStorage.getItem('lscache-trade2stats');
    if (statsCache && !/[\\u4e00-\\u9fa5]/.test(statsCache)) {
      var keys = [
        'lscache-trade2data', 'lscache-trade2filters', 'lscache-trade2items', 'lscache-trade2stats',
        'lscache-tradedata', 'lscache-tradefilters', 'lscache-tradeitems', 'lscache-tradestats'
      ];
      for (var k = 0; k < keys.length; k++) {
        globalRoot.localStorage.removeItem(keys[k]);
        globalRoot.localStorage.removeItem(keys[k] + '-cacheexpiration');
      }
    }
  } catch (e) {}
})(typeof window !== 'undefined' ? window : globalThis);
`;

  const finalCode = `${dictBootstrap}\n${prefix}\n${rawCode}`;

  // 4. 生成 Gzip 硬件流式超压缩包 trade/trade-standalone.js.gz
  const gzBuffer = gzipSync(Buffer.from(finalCode, 'utf8'), { level: 9 });
  const gzPath = resolve(ROOT, 'trade', 'trade-standalone.js.gz');
  writeFileSync(gzPath, gzBuffer);

  // 同时保留一个轻量 trade-standalone.js 兼容直接调试（也可用于 fallback）
  const jsPath = resolve(ROOT, 'trade', 'trade-standalone.js');
  writeFileSync(jsPath, Buffer.from(finalCode, 'utf8'));

  console.log(`✔ 已生成工业级官方市集核心引擎:`);
  console.log(`  - 原始脚本: trade/trade-standalone.js (${(Buffer.byteLength(finalCode) / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`  - 🗜️ 原生流式超紧凑包: trade/trade-standalone.js.gz (${(gzBuffer.length / 1024 / 1024).toFixed(2)} MB, 压缩率: ${(100 - (gzBuffer.length / Buffer.byteLength(finalCode)) * 100).toFixed(1)}%)`);

  // 5. 生成轻量引导器 trade/trade-loader.js (仅 ~1KB)
  const loaderCode = `(async function attachTradeEngineBootstrap() {
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
`;
  const loaderPath = resolve(ROOT, 'trade', 'trade-loader.js');
  writeFileSync(loaderPath, loaderCode, 'utf-8');
}

if (process.argv[1] && process.argv[1].endsWith('build-official-trade-engine.mjs')) {
  buildOfficialTradeEngine();
}
