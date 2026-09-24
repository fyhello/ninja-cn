import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const path = 'C:/Users/25147/AppData/Local/Microsoft/Edge/User Data/Default/Extensions/gdibdimemfkffpdpjdipepickopdknno/5.0.0_0/trade-localization-main-early.3d44d968.js';
const code = readFileSync(path, 'utf-8');

function extractModule(moduleId) {
  const marker = `"${moduleId}":[function(e,t,i){`;
  const idx = code.indexOf(marker);
  if (idx === -1) return null;
  const funcStart = idx + `"${moduleId}":`.length + 1;
  const funcEnd = code.indexOf('},{}', funcStart) + 1;
  const funcCode = code.slice(funcStart, funcEnd);
  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext('(' + funcCode + ')(null, module, module.exports)', sandbox);
  return sandbox.module.exports;
}

const outDir = resolve('./tools/upstream-builder/dictionary/lookup/trade2_official');
mkdirSync(outDir, { recursive: true });

const stats = extractModule('gxkU2');
const typeMapCn = extractModule('7r5y2');
const typeMapEn = extractModule('429WJ');
const typeTransMap = extractModule('lJmnj');
const grantedSkills = extractModule('ipgXU');

console.log('Extracting POE2 Trade modules:');
console.log('  stats:', stats ? (Array.isArray(stats) ? stats.length : 'obj') : 'null');
console.log('  typeMapCn:', typeMapCn ? Object.keys(typeMapCn).length : 'null');
console.log('  typeMapEn:', typeMapEn ? Object.keys(typeMapEn).length : 'null');
console.log('  typeTransMap:', typeTransMap ? Object.keys(typeTransMap).length : 'null');
console.log('  grantedSkills:', grantedSkills ? Object.keys(grantedSkills).length : 'null');

if (stats) writeFileSync(resolve(outDir, 'stats.json'), JSON.stringify(stats, null, 2), 'utf-8');
if (typeMapCn) writeFileSync(resolve(outDir, 'typeMapCn.json'), JSON.stringify(typeMapCn, null, 2), 'utf-8');
if (typeMapEn) writeFileSync(resolve(outDir, 'typeMapEn.json'), JSON.stringify(typeMapEn, null, 2), 'utf-8');
if (typeTransMap) writeFileSync(resolve(outDir, 'typeTransMap.json'), JSON.stringify(typeTransMap, null, 2), 'utf-8');
if (grantedSkills) writeFileSync(resolve(outDir, 'grantedSkillNameMap.json'), JSON.stringify(grantedSkills, null, 2), 'utf-8');

console.log('✔ 全部 POE2 市集官方映射已提取完成！');
