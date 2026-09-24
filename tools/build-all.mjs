import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { syncManifestFiles } from './extension-files.mjs';
import { gzipSync } from 'node:zlib';
import { toTraditional } from './s2t.mjs';
import { applyNativeTraditional, loadNativeSnapshot } from './native-translations/dictionary.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

async function main() {
  const native = await loadNativeSnapshot();
  console.log('====================================================');
  console.log('🚀 开始执行 POE-Ninja 简繁双语词典编译与一键发布流水线...');
  console.log('====================================================\n');

  // 1. 确定数据源路径（直接读取本地官方客户端解包产物）
  const enToCnPath = resolve(ROOT, 'tools', 'upstream-builder', 'dictionary', 'lookup', 'en_to_cn.json');
  const statLinesPath = resolve(ROOT, 'tools', 'upstream-builder', 'dictionary', 'lookup', 'stat_lines.json');

  if (!existsSync(enToCnPath) || !existsSync(statLinesPath)) {
    console.error('❌ 错误: 未检测到官方解包数据，请先运行: npm run extract:upstream');
    process.exit(1);
  }

  console.log(`📖 正在加载官方解包数据源:\n  - ${enToCnPath}\n  - ${statLinesPath}`);
  const enToCn = JSON.parse(await readFile(enToCnPath, 'utf8'));
  const statLines = JSON.parse(await readFile(statLinesPath, 'utf8'));
  console.log(`  ✔ 已载入 ${Object.keys(enToCn).length.toLocaleString()} 条官方词条, ${Object.keys(statLines).length.toLocaleString()} 条词缀模板\n`);

  // 2. 加载人工精修与覆盖层 (data/overrides/)
  const overridesTermsPath = resolve(ROOT, 'data', 'overrides', 'terms.json');
  const overridesGlossaryPath = resolve(ROOT, 'data', 'overrides', 'glossary.json');

  let overridesTerms = {};
  let overridesGlossary = {};

  if (existsSync(overridesTermsPath)) {
    overridesTerms = JSON.parse(await readFile(overridesTermsPath, 'utf8'));
    console.log(`🛡️ 已加载人工精修词条: ${Object.keys(overridesTerms).length} 条 (最高优先级)`);
  }
  if (existsSync(overridesGlossaryPath)) {
    overridesGlossary = JSON.parse(await readFile(overridesGlossaryPath, 'utf8'));
    console.log(`🛡️ 已加载人工精修机制浮窗: ${Object.keys(overridesGlossary).length} 条 (最高优先级)`);
  }

  // 3. 初始化纯净的目标词典结构
  const basePoe2Path = resolve(ROOT, 'data', 'poe2.json');
  const newPoe2 = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms: {},
  };

  // 4. 从官方解包的 tables 目录按表类型精准构建 terms, items
  console.log('\n⚙️ 正在执行官方精炼词库与结构化类型对齐合并...');
  const tablesDir = resolve(ROOT, 'tools', 'upstream-builder', 'dictionary', 'tables');
  const tableFiles = existsSync(tablesDir) ? await (await import('node:fs/promises')).readdir(tablesDir) : [];

  const TABLE_TYPE_MAP = {
    BaseItemTypes: 'base_item',
    Words: 'unique_item',
    PassiveSkills: 'passive_skill',
    AtlasPassives: 'passive_skill',
    AtlasClassPassives: 'passive_skill',
    ActiveSkills: 'gem',
    SkillGems: 'gem',
    SkillGemsForUniqueStat: 'gem',
    GrantedEffects: 'gem',
    GrantedEffectsPerLevel: 'gem',
    GemEffects: 'gem',
    ItemClasses: 'item_class',
    KeywordPopups: 'mechanic',
    ClientStrings: 'client_term',
    ClientStrings2: 'client_term',
    CharacterPanelStats: 'stat',
    CurrencyItems: 'base_item',
  };

  const TYPE_PRIORITY = {
    gem: 10,
    passive_skill: 9,
    base_item: 8,
    unique_item: 7,
    item_class: 6,
    mechanic: 5,
    stat: 4,
    client_term: 1,
  };

  // 3. 过滤故事小品文与长段落小说 (既不是UI词条又不是占位符的长句子)
  function isClientFlavourOrNovel(en, zh) {
    if (!en || !zh) return true;
    if (/\{|\#/.test(en)) return false;
    if (en.length <= 45 && !en.includes('\n')) return false;
    if (en.length > 45 && /[.!?]/.test(en)) return true;
    if (en.length > 80) return true;
    return false;
  }

  // 4. 从 tables/ 中提取具备官方原生类型的纯正游戏实体
  for (const file of tableFiles) {
    if (!file.endsWith('.json')) continue;
    const tableName = file.replace('.json', '');
    const tableData = JSON.parse(await readFile(resolve(tablesDir, file), 'utf8'));
    const termType = TABLE_TYPE_MAP[tableName] || 'client_term';

    for (const entry of tableData.entries || []) {
      for (const [colName, cellList] of Object.entries(entry.columns || {})) {
        if (!Array.isArray(cellList)) continue;
        for (const cell of cellList) {
          const en = cell.en?.trim();
          const zh = cell.zh?.trim();
          if (!en || !zh || en === zh) continue;

          const curPriority = TYPE_PRIORITY[newPoe2.terms[en]?.type] || 0;
          const newPriority = TYPE_PRIORITY[termType] || 0;

          if (!newPoe2.terms[en] || newPriority > curPriority) {
            newPoe2.terms[en] = {
              translation: zh,
              type: termType,
            };
          }

          if (tableName === 'ActiveSkills' || tableName === 'GemEffects' || tableName === 'SkillGemInfo') {
            newPoe2.tooltip[en] = { 'zh-CN': zh };
          }

          if (termType === 'base_item' || termType === 'unique_item' || termType === 'gem' || termType === 'passive_skill') {
            if (!newPoe2.items[en] || newPriority >= curPriority) {
              newPoe2.items[en] = { 'zh-CN': zh };
            }
          }
        }
      }
    }
  }

  // 补充 en_to_cn 剩余的精炼词条 (过滤掉无用的故事文案)
  for (const [english, zhCN] of Object.entries(enToCn)) {
    if (!english || !zhCN || typeof english !== 'string' || typeof zhCN !== 'string') continue;
    const cleanEn = english.trim();
    const cleanZh = zhCN.trim();
    if (!cleanEn || !cleanZh || isClientFlavourOrNovel(cleanEn, cleanZh)) continue;

    if (!newPoe2.terms[cleanEn]) {
      newPoe2.terms[cleanEn] = {
        translation: cleanZh,
        type: 'client_term',
      };
    }
  }

  // 5. 注入官方词缀模板库 (Stat Descriptions) - 精准 hash 键模式
  console.log('🛡️ 正在注入官方词缀模板库（精准 hash 键模式）...');
  function registerStatTemplate(cleanEn, cleanZh) {
    if (!cleanEn || !cleanZh) return;

    // 1. 固定词缀纯文本
    if (!cleanEn.includes('{')) {
      newPoe2.stats[cleanEn] = { 'zh-CN': cleanZh };
      if (cleanEn.includes('\n')) {
        const enFlat = cleanEn.replace(/\r?\n\s*/g, ' ').trim();
        const zhFlat = cleanZh.replace(/\r?\n\s*/g, ' ').trim();
        if (enFlat !== cleanEn) {
          newPoe2.stats[enFlat] = { 'zh-CN': zhFlat };
        }
      }
      return;
    }

    // 2. 带符号的 hash 形式 (例如 {0:+d} -> +#)
    const enPlusHash = cleanEn.replace(/\{\d+:\+d\}/g, '+#').replace(/\{\d+[^}]*\}/g, '#');
    const zhPlusHash = cleanZh.replace(/\{\d+:\+d\}/g, '+#').replace(/\{\d+[^}]*\}/g, '#');
    newPoe2.stats[enPlusHash] = { 'zh-CN': zhPlusHash };

    // 3. 纯 hash 形式
    const enHash = cleanEn.replace(/\{\d+[^}]*\}/g, '#');
    const zhHash = cleanZh.replace(/\{\d+[^}]*\}/g, '#');
    newPoe2.stats[enHash] = { 'zh-CN': zhHash };

    // 4. 如果包含换行符 \n，注册单行空格紧凑版本并拆分单行独立注册
    if (cleanEn.includes('\n')) {
      const enFlat = cleanEn.replace(/\r?\n\s*/g, ' ').trim();
      const zhFlat = cleanZh.replace(/\r?\n\s*/g, ' ').trim();
      if (enFlat !== cleanEn) {
        registerStatTemplate(enFlat, zhFlat);
      }

      const enLines = cleanEn.split(/\r?\n/);
      const zhLines = cleanZh.split(/\r?\n/);
      if (enLines.length === zhLines.length) {
        for (let i = 0; i < enLines.length; i++) {
          const el = enLines[i].trim();
          const zl = zhLines[i].trim();
          if (el && zl && el !== cleanEn) {
            registerStatTemplate(el, zl);
          }
        }
      }
    }
  }

  if (Array.isArray(statLines)) {
    for (const statItem of statLines) {
      for (const form of statItem.forms || []) {
        const en = form.en?.trim();
        const zh = form.zh?.trim();
        if (en && zh) {
          registerStatTemplate(en, zh);
        }
      }
    }
  } else {
    for (const [english, zhCN] of Object.entries(statLines)) {
      if (!english || !zhCN) continue;
      registerStatTemplate(english, zhCN);
    }
  }

  // 注入核心 UI 标签与特殊通配符模板
  const CORE_UI = {
    Waystone: '引路石',
    Economy: '经济',
    Builds: '流派',
    Currency: '通货',
    Maps: '地图',
    'Unique Items': '传奇物品',
    Skills: '技能',
    Classes: '职业',
    Overview: '概览',
    Name: '名称',
    Price: '价格',
    Count: '数量',
    Change: '变化',
    Usage: '使用率',
    'Support Gem Requirements': '辅助宝石需求',
    'Item Requirements': '物品需求',
    Requirements: '需求',
    Requires: '需求',
    '需求': '需求',
    '需求：': '需求：',
    '需求:': '需求：',
    'Support Gem Requirements: {0}': '辅助宝石需求：{0}',
    'Item Requirements: {0}': '物品需求：{0}',
    'Requirements: {0}': '需求：{0}',
    'Requires: {0}': '需求：{0}',
    'Radius: {0}': '范围：{0}',
    'Quality: {0}': '品质：{0}',
    'Physical Damage': '物理伤害',
    'Lightning Damage': '闪电伤害',
    'Fire Damage': '火焰伤害',
    'Cold Damage': '冰霜伤害',
    'Chaos Damage': '混沌伤害',
    'Critical Hit Chance': '暴击几率',
    'Attacks per Second': '每秒攻击次数',
    'Item Level': '物品等级',
    'Grants Skill': '获得技能',
    'Grants skill': '获得技能',
    'Grants Skill: {0}': '获得技能：{0}',
    'Grants skill: {0}': '获得技能：{0}',
    'Physical Damage: {0}': '物理伤害：{0}',
    'Lightning Damage: {0}': '闪电伤害：{0}',
    'Fire Damage: {0}': '火焰伤害：{0}',
    'Cold Damage: {0}': '冰霜伤害：{0}',
    'Chaos Damage: {0}': '混沌伤害：{0}',
    'Critical Hit Chance: {0}': '暴击几率：{0}',
    'Attacks per Second: {0}': '每秒攻击次数：{0}',
    'Item Level: {0}': '物品等级：{0}',
    'Runic Ward': '符文结界',
    'Runic Ward: {0}': '符文结界：{0}',
    'Evade chance': '闪避几率',
    'Evade chance: {0}': '闪避几率：{0}',
    'Deflect chance': '偏转几率',
    'Deflect chance: {0}': '偏转几率：{0}',
    'Physical taken as': '物理伤害承受为',
    'Physical taken as: {0}': '物理伤害承受为：{0}',
    'Effective Health Pool': '有效生命池',
    'Max Hit': '最大单次承受',
    'SKILL DPS ESTIMATION': '技能 DPS 估算',
    Category: '类别',
    'Category: {0}': '类别：{0}',
    Missing: '未获取',
    'Missing {0}': '未获取：{0}',
    Reservation: '保留',
    'Reservation: {0}': '保留：{0}',
    'Attack Damage': '攻击伤害',
    'Attack Damage: {0}': '攻击伤害：{0}',
    'Cooldown Time': '冷却时间',
    'Cooldown Time: {0}': '冷却时间：{0}',
    'Use Time': '使用时间',
    'Use Time: {0}': '使用时间：{0}',
    'Cast Time': '施法时间',
    'Cast Time: {0}': '施法时间：{0}',
    'Any Martial Weapon': '任意战斗武器',
    'Martial Weapon': '战斗武器',
    'Currently has {0} Charges': '当前拥有 {0} 次充能',
    'Currently has {0} Charge': '当前拥有 {0} 次充能',
    'Lasts {0} Seconds': '持续 {0} 秒',
    'Lasts {0} seconds': '持续 {0} 秒',
    Level: '等级',
    Str: '力量',
    Dex: '敏捷',
    Int: '智慧',
    Strength: '力量',
    Dexterity: '敏捷',
    Intelligence: '智慧',
    Quality: '品质',
    Trade: '交易',
    Modifiers: '词缀',
    'Rare Ring': '稀有戒指',
    'Rare Jewel': '稀有珠宝',
    'Rare Boots': '稀有鞋子',
    'Rare Amulet': '稀有护身符',
    'Magic Flask': '魔法药剂',
    'Rare Flask': '稀有药剂',
    'Normal Flask': '普通药剂',
    'Rare Gloves': '稀有手套',
    'Rare Helmet': '稀有头盔',
    'Rare Body Armour': '稀有胸甲',
    'Rare Shield': '稀有盾牌',
    'Rare Focus': '稀有法器',
    'Rare Quiver': '稀有箭袋',
    'Rare Belt': '稀有腰带',
    'Rare Weapon': '稀有武器',
    'Rare Bow': '稀有弓',
    'Rare Crossbow': '稀有弩',
    'Rare Wand': '稀有法杖',
    'Rare Sceptre': '稀有权杖',
    'Rare Staff': '稀有长杖',
    'Rare Staves': '稀有长杖',
    'Rare Mace': '稀有单手锤',
    'Rare Two Hand Mace': '稀有双手锤',
    'Rare Sword': '稀有单手剑',
    'Rare Two Hand Sword': '稀有双手剑',
    'Rare Axe': '稀有单手斧',
    'Rare Two Hand Axe': '稀有双手斧',
    'Damage Reduction': '伤害减免',
    'Damage reduction': '伤害减免',
    'Physical Damage Reduction': '物理伤害减免',
    'Elemental Damage Reduction': '元素伤害减免',
    'Chaos Damage Reduction': '混沌伤害减免',
    'Evade Chance': '闪避几率',
    'Deflect Chance': '偏斜几率',
    'Block Chance': '格挡几率',
    'Spell Block Chance': '法术格挡几率',
    'Suppression Chance': '压制几率',
    'Spell Suppression Chance': '法术压制几率',
    'Back to search': '返回搜索',
    Previous: '上一个',
    '< Previous': '< 上一个',
    Next: '下一个',
    'Next >': '下一个 >',
    Favorite: '收藏',
    Favorited: '已收藏',
    'Time Machine': '时光机',
    'Time machine': '时光机',
    'Latest snapshot': '最新快照',
    Profile: '个人档案',
    PROFILE: '个人档案',
    'View Profile': '查看档案',
    'View profile': '查看档案',
    Account: '账号',
    ACCOUNT: '账号',
    'Last fetched': '最后获取',
    'LAST FETCHED': '最后获取',
    'Import code for Path of Building': '导入 POB 代码',
    'IMPORT CODE FOR PATH OF BUILDING': '导入 POB 代码',
    'Build Planner': '天赋规划器',
    'Build planner': '天赋规划器',
    'Add your character': '添加你的角色',
    'Show passive heatmap': '显示天赋热力图',
    'Hide passive heatmap': '隐藏天赋热力图',
    'Reset all filters': '重置所有筛选',
    'Reset filters': '重置筛选',
    Columns: '列设置',
    // === 官方市集 (Trade) 静态 UI 词条 ===
    'SEARCH LISTED ITEMS': '搜索上架物品',
    'Search Listed Items': '搜索上架物品',
    'BULK ITEM EXCHANGE': '大宗通货交易',
    'Bulk Item Exchange': '大宗通货交易',
    'ABOUT': '关于',
    'About': '关于',
    'SETTINGS': '设置',
    'Settings': '设置',
    'HISTORY': '历史记录',
    'History': '历史记录',
    'SEARCH ITEMS...': '搜索物品...',
    'Search Items...': '搜索物品...',
    'Search items...': '搜索物品...',
    'LOG IN': '登录',
    'Log In': '登录',
    'LOG OUT': '登出',
    'Log Out': '登出',
    'MESSAGES': '消息',
    'Messages': '消息',
    'CONTACT SUPPORT': '联系客服',
    'Contact Support': '联系客服',
    'BACK TO MAIN SITE': '返回官网',
    'Back to Main Site': '返回官网',
    'TYPE FILTERS': '类别筛选',
    'Type Filters': '类别筛选',
    'ITEM CATEGORY': '物品类别',
    'Item Category': '物品类别',
    'ITEM RARITY': '物品稀有度',
    'Item Rarity': '物品稀有度',
    'ITEM LEVEL': '物品等级',
    'Item Level': '物品等级',
    'ITEM QUALITY': '物品品质',
    'Item Quality': '物品品质',
    'EQUIPMENT FILTERS': '装备筛选',
    'Equipment Filters': '装备筛选',
    'REQUIREMENTS': '需求',
    'Requirements': '需求',
    'MAP FILTERS': '地图筛选',
    'Map Filters': '地图筛选',
    'GEM FILTERS': '宝石筛选',
    'Gem Filters': '宝石筛选',
    'ENDGAME FILTERS': '终局/异界筛选',
    'Endgame Filters': '终局/异界筛选',
    'WAYSTONE FILTERS': '引路石筛选',
    'Waystone Filters': '引路石筛选',
    'SANCTUM FILTERS': '圣所筛选',
    'Sanctum Filters': '圣所筛选',
    'MISCELLANEOUS': '杂项筛选',
    'Miscellaneous': '杂项筛选',
    'TRADE FILTERS': '交易筛选',
    'Trade Filters': '交易筛选',
    'STAT FILTERS': '词缀筛选',
    'Stat Filters': '词缀筛选',
    '+ ADD STAT FILTER': '+ 添加词缀筛选',
    '+ Add Stat Filter': '+ 添加词缀筛选',
    '+ ADD STAT GROUP': '+ 添加词缀组',
    '+ Add Stat Group': '+ 添加词缀组',
    'Add Stat Filter': '添加词缀筛选',
    'Add Stat Group': '添加词缀组',
    'SEARCH': '搜索',
    'Search': '搜索',
    'CLEAR': '清空',
    'Clear': '清空',
    'SHOW FILTERS': '显示筛选',
    'Show Filters': '显示筛选',
    'HIDE FILTERS': '隐藏筛选',
    'Hide Filters': '隐藏筛选',
    'COMPACT': '紧凑模式',
    'Compact': '紧凑模式',
    'ONLINE ONLY': '仅限在线',
    'Online Only': '仅限在线',
    'ANY': '任意',
    'Any': '任意',
    'MIN': '最小',
    'Min': '最小',
    'MAX': '最大',
    'Max': '最大',
    'BUYOUT OR FIXED PRICE': '一口价或固定价格',
    'Buyout or Fixed Price': '一口价或固定价格',
    'EXACT CURRENCY': '指定通货',
    'Exact Currency': '指定通货',
    'SELLER ACCOUNT': '卖家账号',
    'Seller Account': '卖家账号',
    'DIRECT WHISPER': '游戏内私聊',
    'Direct Whisper': '游戏内私聊',
    'COPY WHISPER': '复制私聊密语',
    'Copy Whisper': '复制私聊密语',
    'WHISPER': '私聊',
    'Whisper': '私聊',
    // === 截图1市集筛选面板全量补充词条 ===
    'PHYSICAL DPS': '物理伤害/秒 (DPS)',
    'Physical DPS': '物理伤害/秒 (DPS)',
    'ELEMENTAL DPS': '元素伤害/秒 (DPS)',
    'Elemental DPS': '元素伤害/秒 (DPS)',
    'RELOAD TIME': '装填时间',
    'Reload Time': '装填时间',
    'AUGMENTABLE SOCKETS': '可附魔插槽',
    'Augmentable Sockets': '可附魔插槽',
    'WAYSTONE TIER': '引路石阶级',
    'Waystone Tier': '引路石阶级',
    'WAYSTONE PACKSIZE': '引路石怪物群大小',
    'Waystone Packsize': '引路石怪物群大小',
    'WAYSTONE IIR (?)': '引路石物品稀有度 (?)',
    'Waystone IIR (?)': '引路石物品稀有度 (?)',
    'WAYSTONE REVIVES': '引路石复活次数',
    'Waystone Revives': '引路石复活次数',
    'WAYSTONE EXPERIENCE': '引路石经验值',
    'Waystone Experience': '引路石经验值',
    'ULTIMATUM TRIAL HINT': '最后通牒试炼提示',
    'Ultimatum Trial Hint': '最后通牒试炼提示',
    'GEM SOCKETS': '技能石插槽',
    'Gem Sockets': '技能石插槽',
    'AREA LEVEL': '区域等级',
    'Area Level': '区域等级',
    'STACK SIZE': '堆叠数量',
    'Stack Size': '堆叠数量',
    'IDENTIFIED': '已鉴定',
    'Identified': '已鉴定',
    'UNIDENTIFIED TIER': '未鉴定阶级',
    'Unidentified Tier': '未鉴定阶级',
    'TWICE-CORRUPTED': '双重腐化',
    'Twice-Corrupted': '双重腐化',
    'TWICE CORRUPTED': '双重腐化',
    'Twice Corrupted': '双重腐化',
    'Twice腐化': '双重腐化',
    'CULTIVATED VAAL UNIQUE': '培育瓦尔传奇',
    'Cultivated Vaal Unique': '培育瓦尔传奇',
    'UNREVEALED': '未揭晓',
    'Unrevealed': '未揭晓',
    'CRAFTED': '已工艺',
    'Crafted': '已工艺',
    'FORESEEING': '预见',
    'Foreseeing': '预见',
    'BARYA SACRED WATER': '巴瑞亚圣水',
    'Barya Sacred Water': '巴瑞亚圣水',
    'Rare Flail': '稀有连枷',
    'Rare Spear': '稀有长矛',
    'Rare Quarterstaff': '稀有武僧杖',
    'Rare Charm': '稀有咒符',
    'Magic Charm': '魔法咒符',
    'Magic Jewel': '魔法珠宝',
    'Magic Ring': '魔法戒指',
    'Magic Amulet': '魔法护身符',
    'Magic Boots': '魔法鞋子',
    'Magic Gloves': '魔法手套',
    'Magic Helmet': '魔法头盔',
    'Magic Body Armour': '魔法胸甲',
    'Magic Shield': '魔法盾牌',
    'Magic Belt': '魔法腰带',
    'WEAPON CONFIGURATION': '武器配置',
    'Weapon Configuration': '武器配置',
    'MAIN HAND': '主手',
    'Main Hand': '主手',
    'OFF HAND': '副手',
    'Off Hand': '副手',
    Unknown: '未知',
    'Dual Unknown': '双持未知',
    'Bow / Quiver': '弓 / 箭袋',
    'Wand / Focus': '法杖 / 法器',
    'Wand / Sceptre': '法杖 / 权杖',
    'Wand / Buckler': '法杖 / 圆盾',
    'Wand / Unknown': '法杖 / 未知',
    'Sceptre / Focus': '权杖 / 法器',
    'Sceptre / Buckler': '权杖 / 圆盾',
    'Sceptre / Unknown': '权杖 / 未知',
    'Spear / Sceptre': '长矛 / 权杖',
    'Spear / Buckler': '长矛 / 圆盾',
    'Spear / Unknown': '长矛 / 未知',
    'Staff / Focus': '长杖 / 法器',
    'Talisman / Sceptre': '魔符 / 权杖',
    'Two Handed Mace / Sceptre': '双手锤 / 权杖',
    'Two Handed Mace / Shield': '双手锤 / 盾牌',
    'Two Handed Mace / Buckler': '双手锤 / 圆盾',
    'Dual Mace': '双持单手锤',
    'Mace / Unknown': '单手锤 / 未知',
    'Bow / Unknown': '弓 / 未知',
    'Unknown / Sceptre': '未知 / 权杖',
    'Unknown / Focus': '未知 / 法器',
    'Unknown / Buckler': '未知 / 圆盾',
    'Unknown / Shield': '未知 / 盾牌',
  };
  for (const [en, zh] of Object.entries(CORE_UI)) {
    newPoe2.ui[en] = { 'zh-CN': zh, 'zh-TW': toTraditional(zh) };
  }

  const SPECIAL_TEMPLATES = {
    'Passives in Radius of {0} can be Allocated': '{0}范围内的天赋可以在',
    '+# to Level of all {0} Skills': '所有{0}技能等级 +#',
    '+3 to Level of all {0} Skills': '所有{0}技能等级 +3',
    '#% increased Attack Speed': '攻击速度提高 #%',
  };
  for (const [en, zh] of Object.entries(SPECIAL_TEMPLATES)) {
    newPoe2.tooltip[en] = { 'zh-CN': zh, 'zh-TW': toTraditional(zh) };
    newPoe2.stats[en] = { 'zh-CN': zh, 'zh-TW': toTraditional(zh) };
  }

  // 6. 注入机制描述与说明 (Glossary)
  for (const [english, entry] of Object.entries(overridesGlossary)) {
    const zh = entry['zh-CN']?.name || english;
    const desc = entry['zh-CN']?.desc || '';
    if (desc) {
      newPoe2.terms[english] = {
        translation: zh,
        desc: desc,
        'zh-CN': zh,
        type: 'mechanic',
      };
    }
  }

  // 7. 叠加人工词条覆盖 (Overrides Terms)
  const toHashForm = (s) => (s || '').replace(/\{\d+[^}]*\}/g, '#');
  for (const [english, entry] of Object.entries(overridesTerms)) {
    const zhCN = typeof entry === 'string' ? entry : entry['zh-CN'];
    const zhTW = typeof entry === 'object' ? entry['zh-TW'] : undefined;
    const termType = entry?.type || 'unique_item';

    if (zhCN) {
      newPoe2.items[english] = { 'zh-CN': zhCN, 'zh-TW': zhTW };
      newPoe2.stats[english] = { 'zh-CN': zhCN, 'zh-TW': zhTW };
      newPoe2.ui[english] = { 'zh-CN': zhCN, 'zh-TW': zhTW };

      const enHash = toHashForm(english);
      const zhHash = toHashForm(zhCN);
      if (enHash !== english) {
        newPoe2.stats[enHash] = { 'zh-CN': zhHash };
      }

      newPoe2.terms[english] = {
        translation: zhCN,
        'zh-CN': zhCN,
        'zh-TW': zhTW,
        type: termType,
      };
    }
  }

  for (const [english, entry] of Object.entries(newPoe2.terms || {})) {
    if (entry && typeof entry === 'object') {
      // 移除重复的 zh-CN 字段，直接由 translation 承担
      if (entry['zh-CN'] === entry.translation) {
        delete entry['zh-CN'];
      }
      if (!entry.type) {
        entry.type = 'client_term';
      }
    }
  }

  // 专业内容使用独立客户端繁中；字形转换仅用于项目界面标签。
  const nativeReport = applyNativeTraditional(newPoe2, native.snapshot, {
    revision: native.sha256,
    ui: Object.fromEntries(Object.entries(CORE_UI).map(([en, cn]) => [en, toTraditional(cn)])),
    overrides: overridesTerms,
    glossary: overridesGlossary,
  });
  await mkdir(resolve(ROOT, 'data/reports'), { recursive: true });
  await writeFile(resolve(ROOT, 'data/reports/native-traditional.json'), JSON.stringify(nativeReport, null, 2) + '\n');
  console.log('原生繁中覆盖：', nativeReport.summary);
  console.log(`未匹配或有歧义的 ${nativeReport.missing.length} 条分区记录保留英文，详情见 data/reports/native-traditional.json`);

  // 9. 输出标准精炼运行时字典 data/poe2.json 与原生 Gzip 超轻量压缩包 data/poe2.json.gz
  console.log(`💾 正在写入运行时字典: ${basePoe2Path}`);
  const jsonStr = JSON.stringify(newPoe2);
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  await writeFile(basePoe2Path, jsonBuf);
  console.log(`  ✔ data/poe2.json 写入完成 (${(jsonBuf.length / 1024 / 1024).toFixed(2)} MB, 总词条: ${Object.keys(newPoe2.terms).length.toLocaleString()} 条)`);

  const basePoe2GzPath = resolve(ROOT, 'data', 'poe2.json.gz');
  console.log(`🗜️ 正在生成原生 Gzip 超紧凑字典包: ${basePoe2GzPath}`);
  const gzippedBuf = gzipSync(jsonBuf, { level: 9 });
  await writeFile(basePoe2GzPath, gzippedBuf);
  console.log(`  ✔ data/poe2.json.gz 压缩完成 (${(gzippedBuf.length / 1024 / 1024).toFixed(2)} MB, 压缩率: ${((1 - gzippedBuf.length / jsonBuf.length) * 100).toFixed(1)}%)`);
  if (process.argv.includes('--dictionary-only')) return;

  // 9.2 生成全量自包含极速市集引擎 trade/trade-standalone.js
  execSync('node tools/build-official-trade-engine.mjs', { stdio: 'inherit' });

  // 10. 执行规范校验
  console.log('\n🔍 正在执行扩展静态合规校验...');
  execSync('node tools/validate-extension.mjs', { stdio: 'inherit' });

  // 11. 同步发布包至 dist/POE-Ninja-three-language-v0.2.14
  const distDir = resolve(ROOT, 'dist', 'POE-Ninja-three-language-v0.2.14');
  console.log(`\n📦 正在同步编译产物至发布目录: ${distDir}`);
  await mkdir(resolve(distDir, 'data'), { recursive: true });
  await mkdir(resolve(distDir, 'lib'), { recursive: true });
  await mkdir(resolve(distDir, 'common'), { recursive: true });
  await mkdir(resolve(distDir, 'trade'), { recursive: true });

  await copyFile(basePoe2GzPath, resolve(distDir, 'data', 'poe2.json.gz'));
  await copyFile(resolve(ROOT, 'lib', 'translation-core.js'), resolve(distDir, 'lib', 'translation-core.js'));
  await copyFile(resolve(ROOT, 'lib', 'favorite-manager.js'), resolve(distDir, 'lib', 'favorite-manager.js'));
  await copyFile(resolve(ROOT, 'common', 'language-utils.js'), resolve(distDir, 'common', 'language-utils.js'));
  await copyFile(resolve(ROOT, 'common', 'dictionary-loader.js'), resolve(distDir, 'common', 'dictionary-loader.js'));
  await copyFile(resolve(ROOT, 'trade', 'trade-loader.js'), resolve(distDir, 'trade', 'trade-loader.js'));
  await copyFile(resolve(ROOT, 'trade', 'trade-standalone.js'), resolve(distDir, 'trade', 'trade-standalone.js'));
  await copyFile(resolve(ROOT, 'trade', 'trade-standalone.js.gz'), resolve(distDir, 'trade', 'trade-standalone.js.gz'));
  await copyFile(resolve(ROOT, 'trade', 'trade-fetch-engine.js'), resolve(distDir, 'trade', 'trade-fetch-engine.js'));
  await copyFile(resolve(ROOT, 'trade', 'trade-search-helper.js'), resolve(distDir, 'trade', 'trade-search-helper.js'));
  await copyFile(resolve(ROOT, 'trade', 'trade-hook-main.js'), resolve(distDir, 'trade', 'trade-hook-main.js'));
  await copyFile(resolve(ROOT, 'trade', 'trade-dom.js'), resolve(distDir, 'trade', 'trade-dom.js'));
  await copyFile(resolve(ROOT, 'trade', 'trade-content.js'), resolve(distDir, 'trade', 'trade-content.js'));
  await copyFile(resolve(ROOT, 'content.js'), resolve(distDir, 'content.js'));
  await copyFile(resolve(ROOT, 'background.js'), resolve(distDir, 'background.js'));
  await copyFile(resolve(ROOT, 'manifest.json'), resolve(distDir, 'manifest.json'));
  await copyFile(resolve(ROOT, 'popup.html'), resolve(distDir, 'popup.html'));
  await copyFile(resolve(ROOT, 'popup.js'), resolve(distDir, 'popup.js'));
  await copyFile(resolve(ROOT, 'popup.css'), resolve(distDir, 'popup.css'));
  if (existsSync(resolve(ROOT, 'README.md'))) {
    await copyFile(resolve(ROOT, 'README.md'), resolve(distDir, 'README.md'));
  }

  await syncManifestFiles(ROOT, distDir);
  execSync(`node tools/validate-extension.mjs "${distDir}"`, { stdio: 'inherit' });

  // 12. 自动生成生产发布 Zip 压缩包
  execSync('python -B tools/package-release.py', { stdio: 'inherit' });

  console.log('\n====================================================');
  console.log('🎉 流水线执行成功！最终生产包已同步至 dist/POE-Ninja-three-language-v0.2.14 目录！');
  console.log('====================================================\n');
}

main().catch((err) => {
  console.error('❌ 构建流水线执行失败:', err);
  process.exit(1);
});
