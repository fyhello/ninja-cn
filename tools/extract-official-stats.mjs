import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const path = 'C:/Users/25147/AppData/Local/Microsoft/Edge/User Data/Default/Extensions/gdibdimemfkffpdpjdipepickopdknno/5.0.0_0/trade-localization-main-early.3d44d968.js';
const code = readFileSync(path, 'utf-8');

function extractModule(moduleId) {
  const marker = `"${moduleId}":`;
  const idx = code.indexOf(marker);
  if (idx === -1) {
    // 尝试 moduleId:[function
    const m2 = `${moduleId}:[function`;
    const i2 = code.indexOf(m2);
    if (i2 === -1) return null;
    const funcStart = code.indexOf('function(e,t,i){', i2);
    const funcEnd = code.indexOf('},{}', funcStart) + 1;
    const funcCode = code.slice(funcStart, funcEnd);
    const sandbox = { module: { exports: {} } };
    vm.createContext(sandbox);
    vm.runInContext('(' + funcCode + ')(null, module, module.exports)', sandbox);
    return sandbox.module.exports;
  }
  const realId = code.slice(idx + marker.length, code.indexOf('"', idx + marker.length + 1) + 1).replace(/"/g, '');
  return extractModule(realId);
}

// 1. 提取 stats zh
const statsZh = extractModule('gxkU2');
if (statsZh) {
  writeFileSync(resolve('./tools/upstream-builder/dictionary/lookup/poe2_stats_official.json'), JSON.stringify(statsZh, null, 2), 'utf-8');
  console.log('✔ 已提取 poe2_stats_official.json (条目组数: ' + statsZh.length + ')');
}

// 2. 提取 stats zh-tw
const statsTw = extractModule('ll9Lr') || extractModule('F') || extractModule('B');
console.log('Stats TW extracted:', !!statsTw);

