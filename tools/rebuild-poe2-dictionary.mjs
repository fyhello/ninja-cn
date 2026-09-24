import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_SOURCE_DIR = resolve(ROOT, 'data', 'sources', 'poe2-en-cn-dict', 'dictionary');
const DEFAULT_OUTPUT_DIR = resolve(ROOT, 'data');
const CANONICAL_SIMPLIFIED_SOURCE = 'poe2-en-cn-dict';
const SIMPLIFIED_AFFIX_TYPES = new Set([
  'enchant_stat',
  'explicit_stat',
  'implicit_stat',
  'modifier_stat',
  'passive_skill_stat',
  'stat',
]);
const MAX_CANONICAL_TERM_LENGTH = 80;
const MAX_CANONICAL_TERM_WORDS = 6;
// Only remove concrete modifier lines. Bare game terms such as "Energy Shield"
// and "Attack Speed" remain useful in item/UI text and must stay searchable.
const CANONICAL_AFFIX_MARKER = /(?:^|[\s(])[+#]?\s*(?:\d+(?:\.\d+)?%?|#)/i;
const CANONICAL_AFFIX_KEYWORD = /\b(?:increased|reduced|more|less|chance|damage|resistance|armour|evasion|energy shield|life|mana|spirit|attributes|attack speed|cast speed|movement speed)\b/i;
const UI_TYPES = new Set(['site_ui', 'ui_label', 'site_ui_placeholder']);
const COSMETIC_TERM_TRANSLATION = /(?:身体外观|脚部外观|手部外观|头部外观|武器外观|外观[:：]|武器特效|传送特效|时空之门[:：]|背饰[:：]|宠物[:：]|藏身处[:：]|头像框[:：]|足迹[:：]|披风[:：]|装饰等级|公会标签|角色特效|微交易)/;
const COSMETIC_TERM_KEY = /(?:Weapon Effect|Portal Effect|Wings|Pet|Portrait Frame|Hideout|Footprint|Character Effect|Microtransaction)$/i;
const REQUIRED_UI = new Set([
  'Equipment', 'Stats', 'Character', 'Defensive', 'Offensive', 'Simulated',
  'Charges', 'Resistances', 'Energy Shield', 'Mana', 'Spirit', 'Armour',
  'Evasion', 'Evasion Rating', 'Deflection', 'Deflection Rating',
  'Runic Ward', 'Item Level', 'Stack Size', 'Quality', 'Level', 'Class',
  'Attributes', 'Strength', 'Dexterity', 'Intelligence', 'Movement Speed',
  'Item Rarity', 'Rarity', 'Power Charges', 'Frenzy Charges', 'Endurance Charges',
  'Life', 'Fire Resistance', 'Cold Resistance', 'Lightning Resistance',
  'Chaos Resistance', 'Block', 'Block Chance', 'Physical Damage Reduction',
  'Effective Health Pool', 'Max Hit', 'Skills', 'Passives', 'Passive Skills',
  'Jewels', 'Notable', 'Keystone', 'Main Skill', 'Weapon Set', 'General',
  'Currency', 'Fragments', 'Uncut Gems', 'Runes', 'Omens', 'Expedition',
  'Maps', 'Search', 'Clear', 'Settings', 'History', 'About', 'Requirements',
  'Type Filters', 'Equipment Filters', 'Endgame Filters', 'Stat Filters',
  'Pseudo', 'Area Level', 'Identified', 'Fractured', 'Sanctified',
  'Seller Account', 'Listed', 'Sale Type', 'Buyout Price', 'Any', 'No',
  'Any Time', 'Activate Live Search', 'Hide Filters', 'Damage per Second',
  'Attacks per Second', 'Physical DPS', 'Elemental DPS', 'Gem Level',
  'Gem Sockets', 'Requires', 'Damage Reduction', 'Evade Chance',
  'Deflect Chance', 'Physical taken as', 'Item Level:', 'Stack Size:',
  'Radius', 'Support Gem Requirements', 'Item Requirements', 'Gem Requirements',
]);
const POE_NINJA_UI_LABELS = Object.freeze({
  Radius: { 'zh-CN': '范围', 'zh-TW': '範圍' },
  'Support Gem Requirements': { 'zh-CN': '辅助宝石需求', 'zh-TW': '輔助寶石需求' },
  'Item Requirements': { 'zh-CN': '物品需求', 'zh-TW': '物品需求' },
  'Gem Requirements': { 'zh-CN': '宝石需求', 'zh-TW': '寶石需求' },
  Str: { 'zh-CN': '力量', 'zh-TW': '力量' },
  Dex: { 'zh-CN': '敏捷', 'zh-TW': '敏捷' },
  Int: { 'zh-CN': '智慧', 'zh-TW': '智慧' },
  Base: { 'zh-CN': '基础', 'zh-TW': '基礎' },
  Increased: { 'zh-CN': '提高', 'zh-TW': '提高' },
  'Over cap': { 'zh-CN': '超出上限', 'zh-TW': '超出上限' },
  'Rune Socket': { 'zh-CN': '符文插槽', 'zh-TW': '符文插槽' },
  League: { 'zh-CN': '赛季', 'zh-TW': '聯盟' },
  'Physical Max Hit': { 'zh-CN': '物理最大承受伤害', 'zh-TW': '物理最大承受傷害' },
  'Fire Max Hit': { 'zh-CN': '火焰最大承受伤害', 'zh-TW': '火焰最大承受傷害' },
  'Cold Max Hit': { 'zh-CN': '寒冰最大承受伤害', 'zh-TW': '寒冰最大承受傷害' },
  'Lightning Max Hit': { 'zh-CN': '闪电最大承受伤害', 'zh-TW': '閃電最大承受傷害' },
  'Chaos Max Hit': { 'zh-CN': '混沌最大承受伤害', 'zh-TW': '混沌最大承受傷害' },
  'Back to search': { 'zh-CN': '返回搜索', 'zh-TW': '返回搜尋' },
  Previous: { 'zh-CN': '上一个', 'zh-TW': '上一個' },
  Next: { 'zh-CN': '下一个', 'zh-TW': '下一個' },
  Favorite: { 'zh-CN': '收藏', 'zh-TW': '收藏' },
  'Time Machine': { 'zh-CN': '时光机', 'zh-TW': '時光機' },
  'Time machine': { 'zh-CN': '时光机', 'zh-TW': '時光機' },
  'Latest snapshot': { 'zh-CN': '最新快照', 'zh-TW': '最新快照' },
  Profile: { 'zh-CN': '个人档案', 'zh-TW': '個人檔案' },
  PROFILE: { 'zh-CN': '个人档案', 'zh-TW': '個人檔案' },
  'View Profile': { 'zh-CN': '查看档案', 'zh-TW': '查看檔案' },
  'View profile': { 'zh-CN': '查看档案', 'zh-TW': '查看檔案' },
  Account: { 'zh-CN': '账号', 'zh-TW': '帳號' },
  ACCOUNT: { 'zh-CN': '账号', 'zh-TW': '帳號' },
  'Last fetched': { 'zh-CN': '最后获取', 'zh-TW': '最後獲取' },
  'LAST FETCHED': { 'zh-CN': '最后获取', 'zh-TW': '最後獲取' },
  'Import code for Path of Building': {
    'zh-CN': '导入 POB 代码',
    'zh-TW': '匯入 POB 代碼',
  },
  'IMPORT CODE FOR PATH OF BUILDING': {
    'zh-CN': '导入 POB 代码',
    'zh-TW': '匯入 POB 代碼',
  },
  'Build Planner': { 'zh-CN': '天赋规划器', 'zh-TW': '天賦規劃器' },
  'Build planner': { 'zh-CN': '天赋规划器', 'zh-TW': '天賦規劃器' },
  Trade: { 'zh-CN': '交易', 'zh-TW': '交易' },
  Copy: { 'zh-CN': '复制', 'zh-TW': '複製' },
  'Skill DPS Estimation': { 'zh-CN': '技能 DPS 估算', 'zh-TW': '技能 DPS 估算' },
  'Passive tree': { 'zh-CN': '天赋树', 'zh-TW': '天賦樹' },
  'Ascendancy & Keystones': { 'zh-CN': '升华与基石', 'zh-TW': '昇華與基石' },
  Ascendancy_class: { 'zh-CN': '升华职业', 'zh-TW': '昇華職業' },
  Open: { 'zh-CN': '打开', 'zh-TW': '開啟' },
  Enlarge: { 'zh-CN': '放大', 'zh-TW': '放大' },
  'Support the site': { 'zh-CN': '支持网站', 'zh-TW': '支持網站' },
  'Docs & FAQ': { 'zh-CN': '文档与常见问题', 'zh-TW': '文件與常見問題' },
  'Data dumps': { 'zh-CN': '数据转储', 'zh-TW': '資料轉儲' },
  'Advertise on this site': { 'zh-CN': '在此网站投放广告', 'zh-TW': '在此網站刊登廣告' },
  More: { 'zh-CN': '更多', 'zh-TW': '更多' },
  'Add your character': { 'zh-CN': '添加你的角色', 'zh-TW': '新增你的角色' },
  'Show passive heatmap': { 'zh-CN': '显示天赋热力图', 'zh-TW': '顯示天賦熱力圖' },
  'Hide passive heatmap': { 'zh-CN': '隐藏天赋热力图', 'zh-TW': '隱藏天賦熱力圖' },
  'Reset all filters': { 'zh-CN': '重置所有筛选', 'zh-TW': '重設所有篩選' },
  'Reset filters': { 'zh-CN': '重置筛选', 'zh-TW': '重設篩選' },
  Columns: { 'zh-CN': '列设置', 'zh-TW': '欄位設定' },
  'Search filters...': { 'zh-CN': '搜索筛选...', 'zh-TW': '搜尋篩選...' },
  'Rare Boots': { 'zh-CN': '稀有靴子', 'zh-TW': '稀有靴子' },
  'Rare Amulet': { 'zh-CN': '稀有项链', 'zh-TW': '稀有項鍊' },
  'Rare Helmet': { 'zh-CN': '稀有头盔', 'zh-TW': '稀有頭盔' },
  'Damage Reduction': { 'zh-CN': '伤害减免', 'zh-TW': '傷害減免' },
  'Damage reduction': { 'zh-CN': '伤害减免', 'zh-TW': '傷害減免' },
  'Physical Damage Reduction': { 'zh-CN': '物理伤害减免', 'zh-TW': '物理傷害減免' },
  'Elemental Damage Reduction': { 'zh-CN': '元素伤害减免', 'zh-TW': '元素傷害減免' },
  'Chaos Damage Reduction': { 'zh-CN': '混沌伤害减免', 'zh-TW': '混沌傷害減免' },
  'Evade Chance': { 'zh-CN': '闪避几率', 'zh-TW': '閃避機率' },
  'Deflect Chance': { 'zh-CN': '偏斜几率', 'zh-TW': '偏斜機率' },
  'Block Chance': { 'zh-CN': '格挡几率', 'zh-TW': '格擋機率' },
  'Spell Block Chance': { 'zh-CN': '法术格挡几率', 'zh-TW': '法術格擋機率' },
  'Suppression Chance': { 'zh-CN': '压制几率', 'zh-TW': '壓制機率' },
  'Spell Suppression Chance': { 'zh-CN': '法术压制几率', 'zh-TW': '法術壓制機率' },
  Choices: { 'zh-CN': '选择', 'zh-TW': '選擇' },
  All: { 'zh-CN': '全部', 'zh-TW': '全部' },
  Contribute: { 'zh-CN': '贡献', 'zh-TW': '貢獻' },
  Statistics: { 'zh-CN': '统计', 'zh-TW': '統計' },
  Resources: { 'zh-CN': '资源', 'zh-TW': '資源' },
  Interludes: { 'zh-CN': '间幕', 'zh-TW': '間幕' },
  trigger: { 'zh-CN': '触发', 'zh-TW': '觸發' },
  '(trigger)': { 'zh-CN': '(触发)', 'zh-TW': '(觸發)' },
});

function parseArgs(args) {
  const options = { sourceDir: DEFAULT_SOURCE_DIR, outputDir: DEFAULT_OUTPUT_DIR };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--source-dir') options.sourceDir = resolve(args[++index]);
    else if (args[index] === '--out') options.outputDir = resolve(args[++index]);
    else if (args[index] === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  return options;
}

function entry(en, zh, type, source, extra = {}) {
  return { en, 'zh-CN': zh, type, source, ...extra };
}

function cleanPair(en, zh) {
  return typeof en === 'string' && typeof zh === 'string'
    && en.trim() && zh.trim() && en.trim() !== zh.trim();
}

export function buildTermEntries(pairs) {
  const result = {};
  for (const [english, chinese] of Object.entries(pairs || {})) {
    if (!cleanPair(english, chinese)) continue;
    result[english] = {
      translation: chinese,
      type: 'client_term',
      source: 'poe2-en-cn-dict',
    };
  }
  return result;
}

export function isUsefulSimplifiedTerm(english) {
  const value = String(english ?? '').trim();
  if (!value || value.length > MAX_CANONICAL_TERM_LENGTH) return false;
  const isIndexedTemplate = /\{\d+(?::[^}]*)?\}/.test(value);
  if (!isIndexedTemplate && value.split(/\s+/).length > MAX_CANONICAL_TERM_WORDS) return false;
  if (/[\r\n"“”‘’]/.test(value)) return false;
  if (!isIndexedTemplate && CANONICAL_AFFIX_MARKER.test(value) && CANONICAL_AFFIX_KEYWORD.test(value)) return false;
  if (/[.!?;:]\s|[.!?;:]$/.test(value) && !/[<{\[]/.test(value)) return false;
  return /[A-Za-z]/.test(value);
}

export function isCosmeticClientTerm(english, translation = '') {
  const key = String(english ?? '');
  const chinese = String(translation ?? '');
  return COSMETIC_TERM_TRANSLATION.test(chinese)
    || (COSMETIC_TERM_KEY.test(key) && !key.includes('<'));
}

export function buildUsefulTermEntries(pairs) {
  return buildTermEntries(Object.fromEntries(
    Object.entries(pairs || {}).filter(([english, chinese]) => (
      isUsefulSimplifiedTerm(english) && !isCosmeticClientTerm(english, chinese)
    )),
  ));
}

const DYNAMIC_JEWEL_TEMPLATES = Object.freeze({
  'Passives in Radius of {0} can be Allocated': {
    translation: '{0}范围内的天赋可以在',
    'zh-TW': '{0}範圍內的天賦可以在',
    type: 'client_term',
    source: 'poe2-en-cn-dict',
  },
  'Passives in Radius of {0} can be Allocated without being connected to your tree': {
    translation: '{0}范围内的天赋可以在 未连结至天赋树的情况下配置',
    'zh-TW': '{0}範圍內的天賦可以在 未連結至天賦樹的情況下配置',
    type: 'client_term',
    source: 'poe2-en-cn-dict',
  },
  '+{0} to Level of all {1} Skills': {
    translation: '所有{1}技能等级 +{0}',
    'zh-TW': '全部{1}技能等級 +{0}',
    type: 'client_term',
    source: 'poe2-en-cn-dict',
  },
  '{0} to Level of all {1} Skills': {
    translation: '所有{1}技能等级 {0}',
    'zh-TW': '全部{1}技能等級 {0}',
    type: 'client_term',
    source: 'poe2-en-cn-dict',
  },
  '+{0} to Level of all {1} Skill Gems': {
    translation: '所有{1}技能宝石等级提高 +{0}',
    'zh-TW': '全部{1}技能寶石等級提高 +{0}',
    type: 'client_term',
    source: 'poe2-en-cn-dict',
  },
  '+{0} to Level of all {1} Gems': {
    translation: '所有{1}技能宝石等级提高 +{0}',
    'zh-TW': '全部{1}技能寶石等級提高 +{0}',
    type: 'client_term',
    source: 'poe2-en-cn-dict',
  },
});

export const GAME_TERM_DESCRIPTIONS = Object.freeze({
  'Dreaming Gloom Shrine': {
    'zh-CN': { name: '梦想隐忍神龛', desc: '被击败的敌人会爆炸，造成其生命上限四分之一的混沌伤害。' },
    'zh-TW': { name: '夢境漆黑神殿', desc: '被擊敗的敵人會爆炸，造成其生命上限四分之一的混沌傷害。' },
  },
  Presence: {
    'zh-CN': { name: '在场', desc: '在场表示处于你或友军光环及角色周围直接影响的有效范围内。' },
    'zh-TW': { name: '在場', desc: '在場表示處於你或友軍光環及角色周圍直接影響的有效範圍內。' },
  },
  Chaos: {
    'zh-CN': { name: '混沌', desc: '混沌伤害是五种伤害类型之一，受到混沌伤害时扣除双倍的能量护盾，可被混沌抗性减免。' },
    'zh-TW': { name: '混沌', desc: '混沌傷害是五種傷害類型之一，受到混沌傷害時扣除雙倍的能量護盾，可被混沌抗性減免。' },
  },
  'Attack Chaos': {
    'zh-CN': { name: '攻击混沌', desc: '附加在攻击类技能上的混沌属性伤害。' },
    'zh-TW': { name: '攻擊混沌', desc: '附加在攻擊類技能上的混沌屬性傷害。' },
  },
  Ignite: {
    'zh-CN': { name: '点燃', desc: '点燃是一种火焰异常状态，在 4 秒内造成持续火焰伤害。' },
    'zh-TW': { name: '點燃', desc: '點燃是一種火焰異常狀態，在 4 秒內造成持續火焰傷害。' },
  },
  Shock: {
    'zh-CN': { name: '感电', desc: '感电是一种闪电异常状态，使目标受到的伤害提高最高可达 50%。' },
    'zh-TW': { name: '感電', desc: '感電是一種閃電異常狀態，使目標受到的傷害提高最高可達 50%。' },
  },
  Freeze: {
    'zh-CN': { name: '冻结', desc: '冻结是一种冰霜异常状态，使目标在持续时间内完全无法移动或行动。' },
    'zh-TW': { name: '凍結', desc: '凍結是一種冰霜異常狀態，使目標在持續時間內完全無法移動或行動。' },
  },
  Bleeding: {
    'zh-CN': { name: '流血', desc: '流血是一种物理异常状态，持续 5 秒，移动时受到的伤害提高 100%。' },
    'zh-TW': { name: '流血', desc: '流血是一種物理異常狀態，持續 5 秒，移動時受到的傷害提高 100%。' },
  },
  Poison: {
    'zh-CN': { name: '中毒', desc: '中毒是一种混沌异常状态，在 2 秒内造成持续伤害并穿透能量护盾。' },
    'zh-TW': { name: '中毒', desc: '中毒是一種混沌異常狀態，在 2 秒內造成持續傷害並穿透能量護盾。' },
  },
  Electrocution: {
    'zh-CN': { name: '触电', desc: '触电是一种闪电异常状态，打断目标行动并在 5 秒内阻止其施法或攻击。' },
    'zh-TW': { name: '觸電', desc: '觸電是一種閃電異常狀態，打斷目標行動並在 5 秒內阻止其施法或攻擊。' },
  },
  'Energy Shield': {
    'zh-CN': { name: '能量护盾', desc: '代替生命优先承受伤害，脱离伤害后能够迅速自动充能回复。' },
    'zh-TW': { name: '能量護盾', desc: '代替生命優先承受傷害，脫離傷害後能夠迅速自動充能回復。' },
  },
  Armour: {
    'zh-CN': { name: '护甲', desc: '按比例减轻受到的物理击中伤害，对低数值击中伤害减免效果更显著。' },
    'zh-TW': { name: '護甲', desc: '按比例減輕受到的物理擊中傷害，對低數值擊中傷害減免效果更顯著。' },
  },
  Evasion: {
    'zh-CN': { name: '闪避', desc: '提供完全闪避敌人攻击击中的几率，完全避免承受该次伤害。' },
    'zh-TW': { name: '閃避', desc: '提供完全閃避敵人攻擊擊中的幾率，完全避免承受該次傷害。' },
  },
  Ward: {
    'zh-CN': { name: '结界', desc: '完全吸收一次受到的伤害，随后破裂并在短时间内自动恢复。' },
    'zh-TW': { name: '結界', desc: '完全吸收一次受到的傷害，隨後破裂並在短時間內自動恢復。' },
  },
  'Spell Suppression': {
    'zh-CN': { name: '法术压抑', desc: '受到法术击中伤害时，减免 50% 伤害。' },
    'zh-TW': { name: '法術壓抑', desc: '受到法術擊中傷害時，減免 50% 傷害。' },
  },
  Withered: {
    'zh-CN': { name: '死亡凋零', desc: '受到混沌伤害提高，最多可叠加 15 层。' },
    'zh-TW': { name: '凋零', desc: '受到混沌傷害提高，最多可疊加 15 層。' },
  },
  Spirit: {
    'zh-CN': { name: '精魂', desc: '用于开启光环或永久召唤生物的专属资源上限。' },
    'zh-TW': { name: '精魂', desc: '用於開啟光環或永久召喚生物的專屬資源上限。' },
  },
  Rage: {
    'zh-CN': { name: '怒火', desc: '攻击产生怒火，每点怒火提供攻击伤害与攻击速度加成。' },
    'zh-TW': { name: '怒火', desc: '攻擊產生怒火，每點怒火提供攻擊傷害與攻擊速度加成。' },
  },
});

export function buildCanonicalSimplifiedTerms(pairs, existingTerms = {}) {
  const generated = buildUsefulTermEntries(pairs);
  const existing = expandMultilineTermEntries(normaliseTermEntries(existingTerms));
  const retained = Object.fromEntries(Object.entries(existing).filter(([english, value]) => {
    if (value?.type === 'client_term' && isCosmeticClientTerm(english, value.translation)) return false;
    if (value?.source === CANONICAL_SIMPLIFIED_SOURCE) return isUsefulSimplifiedTerm(english);
    return !SIMPLIFIED_AFFIX_TYPES.has(value?.type);
  }));
  return { ...generated, ...retained, ...DYNAMIC_JEWEL_TEMPLATES };
}

export function summariseSimplifiedTermCoverage(rawTerms, canonicalTerms) {
  const sourceCounts = {};
  const excludedSamples = [];
  let excludedCount = 0;
  let excludedUnmatchedCount = 0;
  for (const [english, value] of Object.entries(rawTerms || {})) {
    const source = value?.source || '(none)';
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    if (source === CANONICAL_SIMPLIFIED_SOURCE && isUsefulSimplifiedTerm(english)) continue;
    if (source !== CANONICAL_SIMPLIFIED_SOURCE && !SIMPLIFIED_AFFIX_TYPES.has(value?.type)) continue;
    excludedCount += 1;
    if (!Object.hasOwn(canonicalTerms || {}, english)) excludedUnmatchedCount += 1;
    if (excludedSamples.length < 100) {
      excludedSamples.push({ english, type: value?.type || '(none)', source });
    }
  }
  return { sourceCounts, excludedCount, excludedUnmatchedCount, excludedSamples };
}

export function buildPoeNinjaUiEntries() {
  return Object.fromEntries(Object.entries(POE_NINJA_UI_LABELS).map(([english, translations]) => [
    english,
    {
      en: english,
      ...translations,
      type: 'poe_ninja_ui_label',
      source: 'poe.ninja-ui',
    },
  ]));
}

export function normaliseTermEntries(entries) {
  const result = {};
  for (const [english, value] of Object.entries(entries || {})) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const translation = typeof value.translation === 'string' && value.translation.trim()
      ? value.translation
      : value['zh-CN'];
    if (typeof translation !== 'string' || !translation.trim()) continue;
    const { en: _english, 'zh-CN': _simplified, 'zh-TW': _traditional, ...metadata } = value;
    result[english] = {
      translation,
      ...metadata,
    };
  }
  return result;
}

export function expandMultilineTermEntries(entries) {
  const result = { ...(entries || {}) };
  for (const [english, value] of Object.entries(entries || {})) {
    const sourceLines = String(english).replace(/\r\n/g, '\n').split('\n');
    const translatedLines = String(value?.translation || '').replace(/\r\n/g, '\n').split('\n');
    if (sourceLines.length <= 1 || sourceLines.length !== translatedLines.length) continue;
    sourceLines.forEach((line, index) => {
      const translated = translatedLines[index]?.trim();
      const source = line.trim();
      if (!source || !translated || result[source]) return;
      result[source] = { ...value, translation: translated };
    });
  }
  return result;
}

function templateFor(value, indices) {
  const placeholders = [];
  const template = String(value).replace(/\{(\d+)(?::[^}]*)?\}/g, (_match, index) => {
    const numericIndex = Number(index);
    placeholders.push(numericIndex);
    return indices?.signs?.[numericIndex] ? '+#' : '#';
  });
  return { template, placeholders };
}

function placeholderOrder(source, translated) {
  if (source.length !== translated.length) return null;
  const used = new Set();
  const order = [];
  for (const index of translated) {
    const sourceIndex = source.findIndex((candidate, position) => (
      candidate === index && !used.has(position)
    ));
    if (sourceIndex < 0) return null;
    used.add(sourceIndex);
    order.push(sourceIndex);
  }
  return order;
}

function normaliseStatKey(value) {
  return String(value)
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

export function buildStatEntries(rows) {
  const result = {};
  for (const row of rows || []) {
    for (const form of row?.forms || []) {
      if (!cleanPair(form?.en, form?.zh)) continue;

      const addEntry = (english, chinese) => {
        if (!cleanPair(english, chinese)) return;
        const source = templateFor(english);
        const translated = templateFor(chinese);
        const order = placeholderOrder(source.placeholders, translated.placeholders);
        if (!order) return;
        const signs = {};
        [...String(english).matchAll(/\{(\d+):\+[^}]*\}/g)].forEach((match) => { signs[Number(match[1])] = true; });
        const sourceWithSigns = templateFor(english, { signs });
        const translatedWithSigns = templateFor(chinese, { signs });
        const key = normaliseStatKey(sourceWithSigns.template);
        if (!key || result[key]) return;
        result[key] = entry(
          key,
          normaliseStatKey(translatedWithSigns.template),
          'official_stat_template',
          'poe2-en-cn-dict/stat_lines',
          { placeholderOrder: { 'zh-CN': order } },
        );
      };

      addEntry(form.en, form.zh);

      const englishLines = String(form.en).replace(/\r\n/g, '\n').split('\n');
      const chineseLines = String(form.zh).replace(/\r\n/g, '\n').split('\n');
      if (englishLines.length === chineseLines.length) {
        englishLines.forEach((english, index) => addEntry(english, chineseLines[index]));
      }
    }
  }
  return result;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const RUNTIME_DICTIONARY_SECTIONS = ['items', 'stats', 'tooltip', 'ui', 'terms', 'descriptions'];

function compactRuntimeEntry(section, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (section === 'descriptions') return value;

  const simplified = section === 'terms'
    ? value.translation ?? value['zh-CN']
    : value['zh-CN'] ?? value.translation;
  const traditional = value['zh-TW'];
  const result = {};

  if (section === 'terms') {
    if (simplified !== undefined) result.translation = simplified;
    if (value.type !== undefined) result.type = value.type;
  } else if (simplified !== undefined) {
    result['zh-CN'] = simplified;
  }

  if (traditional !== undefined && traditional !== simplified) {
    result['zh-TW'] = traditional;
  }
  if (section === 'items' && value.slug) result.slug = value.slug;
  if (value.placeholderOrder !== undefined) result.placeholderOrder = clone(value.placeholderOrder);
  return result;
}

export function compactRuntimeDictionary(dictionary = {}) {
  return Object.fromEntries(RUNTIME_DICTIONARY_SECTIONS.map((section) => [
    section,
    Object.fromEntries(Object.entries(dictionary[section] || {})
      .map(([english, value]) => [english, compactRuntimeEntry(section, value)])
      .filter(([, value]) => value !== null)),
  ]));
}

export function mergeLayeredDictionary(existing, generated) {
  const result = clone(existing || {});
  for (const section of ['items', 'stats', 'tooltip', 'ui', 'terms', 'descriptions']) {
    result[section] = { ...(generated?.[section] || {}), ...(result[section] || {}) };
  }
  return result;
}

export function completeDictionaryLanguages(dictionary, traditionalTerms = {}) {
  const result = clone(dictionary || {});
  for (const section of ['items', 'stats', 'tooltip', 'ui']) {
    for (const [english, value] of Object.entries(result[section] || {})) {
      if (!value || typeof value !== 'object' || value['zh-TW']) continue;
      value['zh-TW'] = traditionalTerms[english]?.translation
        || value['zh-CN']
        || value.en
        || '';
    }
  }
  return result;
}

function loadJson(path) {
  return readFile(path, 'utf8').then((text) => JSON.parse(text));
}

async function build({ sourceDir, outputDir }) {
  const [pairs, statRows, base] = await Promise.all([
    loadJson(resolve(sourceDir, 'lookup', 'en_to_cn.json')),
    loadJson(resolve(sourceDir, 'lookup', 'stat_lines.json')),
    loadJson(resolve(outputDir, 'poe2.json')),
  ]);
  const existingTerms = base.terms || {};
  const normalisedTermsCn = expandMultilineTermEntries(normaliseTermEntries(existingTerms));
  const termsTw = expandMultilineTermEntries(Object.fromEntries(
    Object.entries(existingTerms).map(([english, value]) => [english, {
      ...value,
      translation: value?.['zh-TW'] || value?.translation || '',
    }]),
  ));

  const generatedTerms = buildTermEntries(pairs);
  const termsCn = buildCanonicalSimplifiedTerms(pairs, existingTerms);
  const generatedStats = buildStatEntries(statRows);
  const generatedUiKeys = new Set([
    ...Object.entries(normalisedTermsCn).filter(([, value]) => UI_TYPES.has(value?.type)).map(([key]) => key),
    ...REQUIRED_UI,
  ]);
  const generatedUi = {};
  for (const english of generatedUiKeys) {
    const chinese = pairs[english] ?? termsCn[english]?.translation;
    if (cleanPair(english, chinese)) {
      generatedUi[english] = entry(english, chinese, 'ui_label', 'poe2-en-cn-dict');
    }
  }
  const generatedPoeNinjaUi = buildPoeNinjaUiEntries();

  const embeddedTerms = Object.fromEntries(Object.entries(termsCn).map(([english, value]) => {
    const traditional = termsTw[english]?.translation;
    return [english, traditional ? { ...value, 'zh-TW': traditional } : value];
  }));
  const mergedBase = completeDictionaryLanguages(mergeLayeredDictionary(base, {
    tooltip: generatedStats,
    ui: { ...generatedUi, ...generatedPoeNinjaUi },
    terms: embeddedTerms,
  }), termsTw);
  // Canonical stat-line templates are the sole simplified affix authority.
  mergedBase.tooltip = completeDictionaryLanguages({
    items: {}, stats: {}, tooltip: { ...(mergedBase.tooltip || {}), ...generatedStats }, ui: {},
  }, termsTw).tooltip;
  mergedBase.terms = embeddedTerms;
  mergedBase.descriptions = clone(GAME_TERM_DESCRIPTIONS);
  mergedBase.schemaVersion = mergedBase.schemaVersion || 1;
  mergedBase.generated = {
    source: 'addohm/poe2-en-cn-dict',
    sourceFiles: ['lookup/en_to_cn.json', 'lookup/stat_lines.json'],
    terms: Object.keys(embeddedTerms).length,
    statTemplates: Object.keys(generatedStats).length,
    ui: Object.keys(generatedUi).length + Object.keys(generatedPoeNinjaUi).length,
    descriptions: Object.keys(GAME_TERM_DESCRIPTIONS).length,
  };

  const mergedCn = { ...generatedTerms, ...termsCn };
  const simplifiedTermCoverage = summariseSimplifiedTermCoverage(normalisedTermsCn, mergedCn);
  const report = {
    source: 'addohm/poe2-en-cn-dict',
    sourcePairs: Object.keys(pairs).length,
    generatedTerms: Object.keys(generatedTerms).length,
    generatedStatTemplates: Object.keys(generatedStats).length,
    generatedUi: Object.keys(generatedUi).length + Object.keys(generatedPoeNinjaUi).length,
    simplifiedTermCoverage,
    output: {
      items: Object.keys(mergedBase.items || {}).length,
      stats: Object.keys(mergedBase.stats || {}).length,
      tooltip: Object.keys(mergedBase.tooltip || {}).length,
      ui: Object.keys(mergedBase.ui || {}).length,
    termsZhCN: Object.keys(embeddedTerms).length,
    termsZhTW: Object.keys(embeddedTerms).filter((english) => embeddedTerms[english]['zh-TW']).length,
    },
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, 'poe2.json'), `${JSON.stringify(compactRuntimeDictionary(mergedBase), null, 2)}\n`);
  await writeFile(resolve(outputDir, 'poe2-dictionary-coverage.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export async function rebuildPoe2Dictionary(options) {
  return build({
    sourceDir: resolve(options?.sourceDir || DEFAULT_SOURCE_DIR),
    outputDir: resolve(options?.outputDir || DEFAULT_OUTPUT_DIR),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log('Usage: node tools/rebuild-poe2-dictionary.mjs --source-dir <dictionary> --out <data>');
    } else {
      console.log(JSON.stringify(await rebuildPoe2Dictionary(options), null, 2));
    }
  } catch (error) {
    console.error(`[rebuild-poe2-dictionary] ${error.message}`);
    process.exitCode = 1;
  }
}
