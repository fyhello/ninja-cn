import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadCore() {
  const source = await readFile(new URL('../lib/translation-core.js', import.meta.url), 'utf8');
  const context = vm.createContext({ globalThis: {} });
  vm.runInContext(source, context);
  return context.globalThis.PoeNinjaTranslationCore;
}

async function loadPoe2Terms(language = 'zh-CN') {
  const dictionary = JSON.parse(await readFile(new URL('../data/poe2.json', import.meta.url), 'utf8'));
  if (language === 'zh-CN') return dictionary.terms;
  return Object.fromEntries(Object.entries(dictionary.terms || {}).map(([english, entry]) => [
    english,
    { ...entry, translation: entry['zh-TW'] || entry.translation },
  ]));
}

async function loadPoe2Dictionary(language = 'zh-CN') {
  const base = JSON.parse(await readFile(new URL('../data/poe2.json', import.meta.url), 'utf8'));
  return { ...base, terms: await loadPoe2Terms(language) };
}

class TestTextNode {
  constructor(value, document) {
    this.nodeType = 3;
    this.nodeValue = value;
    this.ownerDocument = document;
    this.parentElement = null;
  }

  get textContent() {
    return this.nodeValue;
  }

  set textContent(value) {
    this.nodeValue = String(value);
  }
}

class TestElement {
  constructor(tagName, document, attributes = {}) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = document;
    this.attributes = new Map(Object.entries(attributes));
    this.childNodes = [];
    this.parentElement = null;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node.parentElement) {
        node.parentElement.childNodes = node.parentElement.childNodes.filter((child) => child !== node);
      }
      node.parentElement = this;
      this.childNodes.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.childNodes = [];
    this.append(...nodes);
  }

  cloneNode() {
    return new TestElement(this.tagName, this.ownerDocument, Object.fromEntries(this.attributes));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  get textContent() {
    return this.childNodes.map((node) => node.textContent).join('');
  }

  set textContent(value) {
    this.replaceChildren(this.ownerDocument.createTextNode(String(value)));
  }
}

class TestDocument {
  createTextNode(value) {
    return new TestTextNode(value, this);
  }

  createElement(tagName, attributes) {
    return new TestElement(tagName, this, attributes);
  }
}

function findElement(element, tagName) {
  if (element.tagName === tagName.toUpperCase()) return element;
  for (const child of element.childNodes) {
    if (child.nodeType === 1) {
      const match = findElement(child, tagName);
      if (match) return match;
    }
  }
  return null;
}

const dictionary = {
  items: {
    'Chaos Orb': { en: 'Chaos Orb', 'zh-CN': '混沌石', 'zh-TW': '混沌石' },
  },
  stats: {
    '+#% to Fire Resistance': {
      en: '+#% to Fire Resistance',
      'zh-CN': '+#% 火焰抗性',
      'zh-TW': '+#% 火焰抗性',
    },
  },
  tooltip: {
    'Supports any skill, making it cost less to use. Cannot support skills which reserve Spirit.': {
      en: 'Supports any skill, making it cost less to use. Cannot support skills which reserve Spirit.',
      'zh-CN': '辅助任意技能，使其消耗更低。无法辅助保留精魂的技能。',
      'zh-TW': '輔助任意技能，使其消耗更低。無法輔助保留精魂的技能。',
    },
    '+# to Intelligence': {
      en: '+# to Intelligence',
      'zh-CN': '+# 点智慧',
      'zh-TW': '+# 點智慧',
    },
    '#% increased Energy Shield': {
      en: '#% increased Energy Shield',
      'zh-CN': '能量护盾提高 #%',
      'zh-TW': '能量護盾提高 #%',
    },
    'Deals # to # Physical Damage': {
      en: 'Deals # to # Physical Damage',
      'zh-CN': '造成 # 至 # 点物理伤害',
      'zh-TW': '造成 # 至 # 點物理傷害',
    },
  },
  ui: {
    Economy: { en: 'Economy', 'zh-CN': '经济', 'zh-TW': '經濟' },
  },
};

test('translates preserved source text to simplified and traditional Chinese', async () => {
  const { translateText } = await loadCore();

  assert.equal(translateText('  Chaos Orb  ', dictionary, 'zh-CN'), '  混沌石  ');
  assert.equal(translateText('Chaos Orb', dictionary, 'zh-TW'), '混沌石');
  assert.equal(translateText('Chaos Orb', dictionary, 'en'), 'Chaos Orb');
});

test('substitutes statistic placeholders without changing numeric values or percent signs', async () => {
  const { translateText } = await loadCore();

  assert.equal(
    translateText('+15% to Fire Resistance', dictionary, 'zh-CN'),
    '+15% 火焰抗性',
  );
});

test('builds number-agnostic templates from concrete external stat terms', async () => {
  const { translateText } = await loadCore();
  const termsDictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms: {
      '10% increased Attack Speed': {
        translation: '攻击速度提高10%',
        type: 'explicit_stat',
      },
    },
  };

  assert.equal(
    translateText('30% increased Attack Speed', termsDictionary, 'zh-CN'),
    '攻击速度提高30%',
  );
});

test('preserves numeric values when the official translation moves them', async () => {
  const { translateText } = await loadCore();
  const termsDictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms: {
      '+18% to Cold Resistance': {
        translation: '冰霜抗性+18%',
        type: 'implicit_stat',
      },
    },
  };

  assert.equal(
    translateText('+25% to Cold Resistance', termsDictionary, 'zh-CN'),
    '冰霜抗性+25%',
  );
});

test('keeps unknown modifier lines intact instead of translating a keyword fragment', async () => {
  const { translateText } = await loadCore();
  const termsDictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms: {
      Attack: { translation: '攻击', type: 'keyword' },
      Speed: { translation: '速度', type: 'keyword' },
    },
  };

  assert.equal(
    translateText('Unknown Attack Speed Modifier', termsDictionary, 'zh-CN'),
    'Unknown Attack Speed Modifier',
  );
});

test('translates the screenshot equipment rows as complete lines using the POE2 term dictionary', async () => {
  const { translateWholeLine } = await loadCore();
  const terms = await loadPoe2Terms();
  const screenshotDictionary = {
    items: {},
    stats: {},
    tooltip: {
      'Adds # to # Lightning Damage': {
        en: 'Adds # to # Lightning Damage',
        'zh-CN': '附加 # - # 闪电伤害',
      },
      '+#% to Fire and Chaos Resistances': {
        en: '+#% to Fire and Chaos Resistances',
        'zh-CN': '+#% 火焰与混沌抗性',
      },
    },
    ui: {},
    terms,
  };

  assert.equal(
    translateWholeLine('10% increased Attack Speed', screenshotDictionary, 'zh-CN'),
    '10% increased Attack Speed',
  );
  assert.equal(
    translateWholeLine('Adds 1 to 107 Lightning Damage', screenshotDictionary, 'zh-CN'),
    '附加 1 - 107 闪电伤害',
  );
  assert.equal(
    translateWholeLine('+14% to Fire and Chaos Resistances', screenshotDictionary, 'zh-CN'),
    '+14% 火焰与混沌抗性',
  );
  assert.equal(
    translateWholeLine('Winged Spear', screenshotDictionary, 'zh-CN'),
    '飞翼长矛',
  );
  assert.equal(
    translateWholeLine('Evasion Rating', screenshotDictionary, 'zh-CN'),
    '闪避值',
  );
});

test('uses the canonical POE2 stat template embedded in the runtime dictionary', async () => {
  const { translateWholeLine } = await loadCore();
  const base = JSON.parse(await readFile(new URL('../data/poe2.json', import.meta.url), 'utf8'));

  assert.equal(base.tooltip['#% increased Attack Speed']['zh-CN'], '攻击速度提高 #%');

  assert.equal(
    translateWholeLine('10% increased Attack Speed', base, 'zh-CN'),
    '攻击速度提高 10%',
  );
});

test('does not use isolated modifier keywords during inline page translation', async () => {
  const { translateInlineText } = await loadCore();
  const terms = await loadPoe2Terms();
  const termsDictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms,
  };

  assert.equal(translateInlineText('Winged Spear', termsDictionary, 'zh-CN'), '飞翼长矛');
  assert.equal(translateInlineText('Attack', termsDictionary, 'zh-CN'), 'Attack');
  assert.equal(
    translateInlineText('Unknown Attack Speed Modifier', termsDictionary, 'zh-CN'),
    'Unknown Attack Speed Modifier',
  );
});

test('translates exact client item terms in ordinary page text', async () => {
  const { translateInlineText } = await loadCore();
  const termsDictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms: {
      'Runeforged Imperial Greathelm': {
        translation: '符文帝国巨盔',
        type: 'client_term',
      },
    },
  };

  assert.equal(
    translateInlineText('Runeforged Imperial Greathelm', termsDictionary, 'zh-CN'),
    '符文帝国巨盔',
  );
});

test('composes generated rare item names from translated title-case components', async () => {
  const { translateInlineText, translateWholeLine } = await loadCore();
  const terms = await loadPoe2Terms();
  const termsDictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms,
  };

  assert.equal(
    translateWholeLine('Corruption Visage', termsDictionary, 'zh-CN'),
    '腐化慧眼',
  );
  assert.equal(
    translateInlineText('Eagle Charm', termsDictionary, 'zh-CN'),
    '鹰翼咒符',
  );
  assert.equal(
    translateInlineText('Demon Nail', termsDictionary, 'zh-CN'),
    '恶魔宝戒',
  );
});

test('translates generated rare name and base item in a comma-separated equipment label', async () => {
  const { translateInlineText } = await loadCore();
  const terms = await loadPoe2Terms();
  const termsDictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms,
  };

  assert.equal(
    translateInlineText(
      'Dusk Twirl, Runeforged Massive Mitts',
      termsDictionary,
      'zh-CN',
    ),
    '暮色之轮, 符文巨型护手',
  );
});

test('translates generated rare names followed by their base item', async () => {
  const { translateInlineText, translateTooltipText } = await loadCore();
  const terms = await loadPoe2Terms();
  const termsDictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms,
  };

  assert.equal(
    translateInlineText('Apocalypse Essence Emerald', termsDictionary, 'zh-CN'),
    '天启精华翡翠',
  );
  assert.equal(
    translateInlineText('Behemoth Bloom Emerald', termsDictionary, 'zh-CN'),
    '巨兽光晕效果翡翠',
  );
  assert.equal(
    translateTooltipText('Behemoth BloomEmerald', termsDictionary, 'zh-CN'),
    '巨兽光晕效果翡翠',
  );
});

test('translates a known base suffix when an unknown custom rare name is glued before it', async () => {
  const { translateInlineText, translateWholeLine } = await loadCore();
  const terms = await loadPoe2Terms();
  const termsDictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms,
  };

  assert.equal(
    translateInlineText('Eagle MarchRuneforged Tasalian Greaves', termsDictionary, 'zh-CN'),
    '鹰翼三月符文塔萨里奥胫甲',
  );
  assert.equal(
    translateWholeLine('Eagle MarchRuneforged Tasalian Greaves', termsDictionary, 'zh-CN'),
    '鹰翼三月符文塔萨里奥胫甲',
  );
  assert.equal(
    translateInlineText('Eagle MarchRuneforged\nTasalian Greaves', termsDictionary, 'zh-CN'),
    '鹰翼三月符文塔萨里奥胫甲',
  );

  assert.equal(
    translateInlineText('Custom XyzzyRuneforged Tasalian Greaves', termsDictionary, 'zh-CN'),
    'Custom Xyzzy符文塔萨里奥胫甲',
  );
});

test('composes multi-part generated item names with apostrophes, multi-word bases, and suffixes', async () => {
  const { translateInlineText } = await loadCore();
  const termsDictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms: {
      "Experimenter's": { translation: '实验家的', type: 'client_term' },
      'Grounding Charm': { translation: '根基咒符', type: 'base_item' },
      'of the Brewer': { translation: '烹煮之', type: 'client_term' },
    },
  };

  assert.equal(
    translateInlineText(
      "Experimenter's Grounding Charm of the Brewer",
      termsDictionary,
      'zh-CN',
    ),
    '实验家的根基咒符烹煮之',
  );
});

test('translates comma-separated support gem category labels as a complete tag list', async () => {
  const { translateInlineText } = await loadCore();
  const termsDictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms: {
      Support: { translation: '辅助', type: 'keyword' },
      Lineage: { translation: '血统', type: 'keyword' },
      Attack: { translation: '攻击', type: 'keyword' },
      Melee: { translation: '近战', type: 'keyword' },
    },
  };

  assert.equal(
    translateInlineText('Support, Lineage, Attack, Melee', termsDictionary, 'zh-CN'),
    '辅助, 血统, 攻击, 近战',
  );
});

test('matches arbitrary text in indexed client placeholders', async () => {
  const { translateWholeLine } = await loadCore();
  const termsDictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms: {
      'Notable Passive Skills in Radius also grant {0}': {
        translation: '范围内的核心天赋同时提供 {0}',
        type: 'client_term',
      },
    },
  };

  assert.equal(
    translateWholeLine(
      'Notable Passive Skills in Radius also grant 1% increased maximum Life',
      termsDictionary,
      'zh-CN',
    ),
    '范围内的核心天赋同时提供 1% increased maximum Life',
  );
});

test('translates screenshot stat labels through the controlled UI partition', async () => {
  const { translateInlineText } = await loadCore();
  const dictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {
      'Energy Shield': { en: 'Energy Shield', 'zh-CN': '能量护盾', 'zh-TW': '能量護盾' },
      'Runic Ward': { en: 'Runic Ward', 'zh-CN': '符文结界', 'zh-TW': '符文結界' },
      Mana: { en: 'Mana', 'zh-CN': '魔力', 'zh-TW': '魔力' },
      Spirit: { en: 'Spirit', 'zh-CN': '精魂', 'zh-TW': '精魂' },
      Armour: { en: 'Armour', 'zh-CN': '护甲', 'zh-TW': '護甲' },
      'Evasion Rating': { en: 'Evasion Rating', 'zh-CN': '闪避值', 'zh-TW': '閃避值' },
      'Deflection Rating': { en: 'Deflection Rating', 'zh-CN': '偏转值', 'zh-TW': '偏轉值' },
    },
  };

  assert.equal(translateInlineText('Energy shield', dictionary, 'zh-CN'), '能量护盾');
  assert.equal(translateInlineText('Evasion rating', dictionary, 'zh-CN'), '闪避值');
  assert.equal(translateInlineText('Runic Ward', dictionary, 'zh-CN'), '符文结界');
  assert.equal(translateInlineText('Attack', { ...dictionary, ui: { Attack: { en: 'Attack', 'zh-CN': '攻击' } } }, 'zh-CN'), '攻击');
});

test('translates controlled UI labels when poe.ninja appends a dynamic value', async () => {
  const { translateInlineText, translateWholeLine } = await loadCore();
  const dictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {
      Quality: { en: 'Quality', 'zh-CN': '品质', 'zh-TW': '品質' },
      'Rune Socket': { en: 'Rune Socket', 'zh-CN': '符文插槽', 'zh-TW': '符文插槽' },
      Requires: { en: 'Requires', 'zh-CN': '需求', 'zh-TW': '需求' },
      'Over cap': { en: 'Over cap', 'zh-CN': '超出上限', 'zh-TW': '超出上限' },
    },
  };

  assert.equal(translateWholeLine('Quality: +25%', dictionary, 'zh-CN'), '品质：+25%');
  assert.equal(translateWholeLine('Rune Socket: 390', dictionary, 'zh-CN'), '符文插槽：390');
  assert.equal(translateWholeLine('Requires: Level 80, 115 Strength', dictionary, 'zh-CN'), '需求：Level 80, 115 Strength');
  assert.equal(translateWholeLine('Over cap: +18%', dictionary, 'zh-CN'), '超出上限：+18%');
  assert.equal(translateWholeLine('Unknown Label: 12', dictionary, 'zh-CN'), 'Unknown Label: 12');
  assert.equal(translateInlineText('Quality: +25%', dictionary, 'zh-CN'), '品质：+25%');
  assert.equal(translateInlineText('Over cap: +18%', dictionary, 'zh-CN'), '超出上限：+18%');
  assert.equal(translateInlineText('Unknown Label: 12', dictionary, 'zh-CN'), 'Unknown Label: 12');
});

test('translates POE Ninja max-hit chart labels without translating isolated keywords', async () => {
  const { translateInlineText } = await loadCore();
  const dictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {
      'Physical Max Hit': { en: 'Physical Max Hit', 'zh-CN': '物理最大承受伤害' },
      'Fire Max Hit': { en: 'Fire Max Hit', 'zh-CN': '火焰最大承受伤害' },
      'Cold Max Hit': { en: 'Cold Max Hit', 'zh-CN': '寒冰最大承受伤害' },
      'Lightning Max Hit': { en: 'Lightning Max Hit', 'zh-CN': '闪电最大承受伤害' },
      'Chaos Max Hit': { en: 'Chaos Max Hit', 'zh-CN': '混沌最大承受伤害' },
    },
  };

  assert.equal(translateInlineText('Physical Max Hit', dictionary, 'zh-CN'), '物理最大承受伤害');
  assert.equal(translateInlineText('Fire Max Hit', dictionary, 'zh-CN'), '火焰最大承受伤害');
  assert.equal(translateInlineText('Cold Max Hit', dictionary, 'zh-CN'), '寒冰最大承受伤害');
  assert.equal(translateInlineText('Lightning Max Hit', dictionary, 'zh-CN'), '闪电最大承受伤害');
  assert.equal(translateInlineText('Chaos Max Hit', dictionary, 'zh-CN'), '混沌最大承受伤害');
  assert.equal(translateInlineText('Max Hit', { ...dictionary, ui: { 'Max Hit': { en: 'Max Hit', 'zh-CN': '最大承受伤害' } } }, 'zh-CN'), '最大承受伤害');
});

test('normalises whitespace around complete item names from split DOM text', async () => {
  const { translateWholeLine, translateInlineText } = await loadCore();
  const terms = await loadPoe2Terms();
  const dictionary = { items: {}, stats: {}, tooltip: {}, ui: {}, terms };

  assert.equal(translateWholeLine('Tawhoan  Tower Shield', dictionary, 'zh-CN'), '塔赫亚塔盾');
  assert.equal(translateInlineText('Tawhoan\nTower Shield', dictionary, 'zh-CN'), '塔赫亚塔盾');
});

test('translates the remaining stable POE Ninja page labels', async () => {
  const { translateInlineText } = await loadCore();
  const dictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {
      'Back to search': { en: 'Back to search', 'zh-CN': '返回搜索' },
      Previous: { en: 'Previous', 'zh-CN': '上一个' },
      Next: { en: 'Next', 'zh-CN': '下一个' },
      Favorite: { en: 'Favorite', 'zh-CN': '收藏' },
      'Time Machine': { en: 'Time Machine', 'zh-CN': '时间机器' },
      'Latest snapshot': { en: 'Latest snapshot', 'zh-CN': '最新快照' },
      Profile: { en: 'Profile', 'zh-CN': '个人资料' },
      Account: { en: 'Account', 'zh-CN': '账号' },
      'Last fetched': { en: 'Last fetched', 'zh-CN': '最后获取' },
      'Import code for Path of Building': { en: 'Import code for Path of Building', 'zh-CN': 'Path of Building 导入代码' },
      Trade: { en: 'Trade', 'zh-CN': '交易' },
      Copy: { en: 'Copy', 'zh-CN': '复制' },
    },
  };

  assert.equal(translateInlineText('Back to search', dictionary, 'zh-CN'), '返回搜索');
  assert.equal(translateInlineText('Previous', dictionary, 'zh-CN'), '上一个');
  assert.equal(translateInlineText('Next', dictionary, 'zh-CN'), '下一个');
  assert.equal(translateInlineText('Favorite', dictionary, 'zh-CN'), '收藏');
  assert.equal(translateInlineText('Time Machine', dictionary, 'zh-CN'), '时间机器');
  assert.equal(translateInlineText('Latest snapshot', dictionary, 'zh-CN'), '最新快照');
  assert.equal(translateInlineText('Profile', dictionary, 'zh-CN'), '个人资料');
  assert.equal(translateInlineText('Account', dictionary, 'zh-CN'), '账号');
  assert.equal(translateInlineText('Last fetched', dictionary, 'zh-CN'), '最后获取');
  assert.equal(translateInlineText('Import code for Path of Building', dictionary, 'zh-CN'), 'Path of Building 导入代码');
  assert.equal(translateInlineText('Trade', dictionary, 'zh-CN'), '交易');
  assert.equal(translateInlineText('Copy', dictionary, 'zh-CN'), '复制');
});

test('translates the remaining POE Ninja filter controls and character count', async () => {
  const { translateInlineText } = await loadCore();
  const dictionary = { items: {}, stats: {}, tooltip: {}, terms: {}, ui: {
    'Add your character': { en: 'Add your character', 'zh-CN': '添加你的角色' },
    'Show passive heatmap': { en: 'Show passive heatmap', 'zh-CN': '显示天赋热力图' },
    'Search filters...': { en: 'Search filters...', 'zh-CN': '搜索筛选...' },
    'Rare Boots': { en: 'Rare Boots', 'zh-CN': '稀有靴子' },
    'Rare Amulet': { en: 'Rare Amulet', 'zh-CN': '稀有项链' },
    'Rare Helmet': { en: 'Rare Helmet', 'zh-CN': '稀有头盔' },
  } };

  assert.equal(translateInlineText('Add your character', dictionary, 'zh-CN'), '添加你的角色');
  assert.equal(translateInlineText('Show passive heatmap', dictionary, 'zh-CN'), '显示天赋热力图');
  assert.equal(translateInlineText('Search filters...', dictionary, 'zh-CN'), '搜索筛选...');
  assert.equal(translateInlineText('Rare Boots', dictionary, 'zh-CN'), '稀有靴子');
  assert.equal(translateInlineText('Rare Amulet', dictionary, 'zh-CN'), '稀有项链');
  assert.equal(translateInlineText('Rare Helmet', dictionary, 'zh-CN'), '稀有头盔');
  assert.equal(translateInlineText('Found 124226 characters.', dictionary, 'zh-CN'), '找到 124226 个角色。');
});

test('translates poe.ninja allocation rows only when the target is an official passive skill', async () => {
  const { translateInlineText, translateWholeLine } = await loadCore();
  const dictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms: {
      "Zarokh's Gift": {
        translation: '扎洛卡之赠',
        type: 'passive_skill',
      },
      'Unknown Node': {
        translation: '未知节点',
        type: 'client_term',
      },
    },
  };

  assert.equal(translateWholeLine("Allocates Zarokh's Gift", dictionary, 'zh-CN'), '分配 扎洛卡之赠');
  assert.equal(translateInlineText("Allocates Zarokh's Gift", dictionary, 'zh-CN'), '分配 扎洛卡之赠');
  assert.equal(translateWholeLine('Allocates Unknown Node', dictionary, 'zh-CN'), 'Allocates Unknown Node');
});

test('normalises tooltip slash spacing and singular/plural seconds', async () => {
  const { translateWholeLine } = await loadCore();
  const dictionary = {
    items: {},
    stats: {},
    tooltip: {
      'Recovers # Life over # Second': {
        en: 'Recovers # Life over # Second',
        'zh-CN': '# 秒内回复 # 生命',
        'zh-TW': '# 秒內恢復 # 生命',
      },
      'Stack Size: # / #': {
        en: 'Stack Size: # / #',
        'zh-CN': '堆叠数量: # / #',
        'zh-TW': '堆疊數量: # / #',
      },
    },
    ui: {},
  };

  assert.equal(
    translateWholeLine('Recovers 460 Life over 3 Seconds', dictionary, 'zh-CN'),
    '3 秒内回复 460 生命',
  );
  assert.equal(
    translateWholeLine('Stack Size: 1/10', dictionary, 'zh-CN'),
    '堆叠数量: 1 / 10',
  );
});

test('matches dynamic stat values while preserving fixed numbers in the template', async () => {
  const { translateWholeLine } = await loadCore();
  const dictionary = {
    items: {},
    stats: {},
    tooltip: {
      'Gain Guard equal to #% of maximum Life for 4 seconds on taking Savage Hit': {
        en: 'Gain Guard equal to #% of maximum Life for 4 seconds on taking Savage Hit',
        'zh-CN': '受到凶蛮击中时，获得等同于生命上限 #% 的防卫，持续 4 秒',
        'zh-TW': '承受殘暴打擊時，獲得等同於 #% 最大生命的守護，持續 4 秒',
        placeholderOrder: { 'zh-CN': [0], 'zh-TW': [0] },
      },
    },
    ui: {},
  };

  assert.equal(
    translateWholeLine(
      'Gain Guard equal to 10% of maximum Life for 4 seconds on taking Savage Hit',
      dictionary,
      'zh-CN',
    ),
    '受到凶蛮击中时，获得等同于生命上限 10% 的防卫，持续 4 秒',
  );
});

test('matches indexed client terms when several slash-separated values are compacted', async () => {
  const { translateWholeLine } = await loadCore();
  const termsDictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms: {
      '1v1 W/L/D: {0}/{1}/{2}': {
        translation: '1v1 胜 / 败 / 和： {0} / {1} / {2}',
        type: 'client_term',
      },
      '({1}/{2} from {0})': {
        translation: '({1} / {2} 来自 {0})',
        type: 'client_term',
      },
    },
  };

  assert.equal(
    translateWholeLine('1v1 W/L/D: 10/17/24', termsDictionary, 'zh-CN'),
    '1v1 胜 / 败 / 和： 10 / 17 / 24',
  );
  assert.equal(
    translateWholeLine('(17/24 from 10)', termsDictionary, 'zh-CN'),
    '(17 / 24 来自 10)',
  );
});

test('translates the official potion and rune tooltip rows', async () => {
  const { translateWholeLine } = await loadCore();
  const dictionary = {
    items: {},
    stats: {},
    tooltip: {
      'Consumes # of # Charges on use': {
        en: 'Consumes # of # Charges on use',
        'zh-CN': '每次使用会从 # 充能次数中消耗 # 次',
        'zh-TW': '每次使用會從 # 充能次數中消耗 # 次',
        placeholderOrder: { 'zh-CN': [1, 0], 'zh-TW': [1, 0] },
      },
      'Martial Weapon: Adds # to # Fire Damage': {
        en: 'Martial Weapon: Adds # to # Fire Damage',
        'zh-CN': '战斗武器: 附加 # - # 火焰伤害',
        'zh-TW': '軍用武器: 附加 # 至 # 火焰傷害',
      },
    },
    ui: {},
  };

  assert.equal(
    translateWholeLine('Consumes 7 of 75 Charges on use', dictionary, 'zh-CN'),
    '每次使用会从 75 充能次数中消耗 7 次',
  );
  assert.equal(
    translateWholeLine('Martial Weapon: Adds 13 to 16 Fire Damage', dictionary, 'zh-CN'),
    '战斗武器: 附加 13 - 16 火焰伤害',
  );
});

test('translates dynamic stat values after a translated controlled-ui label', async () => {
  const { translateWholeLine } = await loadCore();
  const dictionary = await loadPoe2Dictionary();

  assert.equal(
    translateWholeLine('Martial Weapon: Adds 13 to 16 Fire Damage', dictionary, 'zh-CN'),
    '战斗武器：附加 13 - 16 基础火焰伤害',
  );
});

test('falls back to inline composition for single-line and multiline tooltip text', async () => {
  const { translateTooltipText } = await loadCore();
  const termsDictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms: {
      "Experimenter's": { translation: '实验家的', type: 'client_term' },
      'Grounding Charm': { translation: '根基咒符', type: 'base_item' },
      'of the Brewer': { translation: '烹煮之', type: 'client_term' },
      'Recovers {0} Life over {1} Seconds': {
        translation: '{1} 秒内回复 {0} 生命',
        type: 'client_term',
      },
    },
  };

  assert.equal(
    translateTooltipText(
      "Experimenter's Grounding Charm of the Brewer",
      termsDictionary,
      'zh-CN',
    ),
    '实验家的根基咒符烹煮之',
  );
  assert.equal(
    translateTooltipText(
      "Experimenter's Grounding Charm of the Brewer\nRecovers 20 Life over 3 Seconds",
      termsDictionary,
      'zh-CN',
    ),
    '实验家的根基咒符烹煮之\n3 秒内回复 20 生命',
  );
});

test('translates client-indexed dynamic placeholders from the full POE2 term dictionary', async () => {
  const { translateWholeLine } = await loadCore();
  const terms = await loadPoe2Terms();
  const termsDictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms,
  };

  assert.equal(
    translateWholeLine('Recovers 460 Life over 3 Seconds', termsDictionary, 'zh-CN'),
    '3 秒内回复 460 生命',
  );
  assert.equal(
    translateWholeLine('Consumes 7 of 75 Charges on use', termsDictionary, 'zh-CN'),
    '每次使用会从 75 充能次数中消耗 7 次',
  );
});

test('prefers an indexed client template over a concrete-number duplicate', async () => {
  const { translateWholeLine } = await loadCore();
  const termsDictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms: {
      'Recovers 50 Life over 3 Second': {
        translation: '3秒内回复50生命',
        type: 'client_term',
      },
      'Recovers {0} Life over {1} Seconds': {
        translation: '{1} 秒内回复 {0} 生命',
        type: 'client_term',
      },
    },
  };

  assert.equal(
    translateWholeLine('Recovers 460 Life over 3 Seconds', termsDictionary, 'zh-CN'),
    '3 秒内回复 460 生命',
  );
});

test('keeps signed values as fixed template prefixes for client terms', async () => {
  const { translateWholeLine } = await loadCore();
  const termsDictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms: {
      '+{0} Level from Corruption': {
        translation: '+{0} 来自腐化的等级',
        type: 'client_term',
      },
      '-{0} Level from Item': {
        translation: '-{0} 来自物品的等级',
        type: 'client_term',
      },
    },
  };

  assert.equal(
    translateWholeLine('+100 Level from Corruption', termsDictionary, 'zh-CN'),
    '+100 来自腐化的等级',
  );
  assert.equal(
    translateWholeLine('-2 Level from Item', termsDictionary, 'zh-CN'),
    '-2 来自物品的等级',
  );
});

test('treats numbers inside client rich-text braces as values, not placeholder indexes', async () => {
  const { translateWholeLine } = await loadCore();
  const termsDictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms: {
      '<N>{{<normal>{{{0}}}}} to attack.': {
        translation: '<N>{{<normal>{{{0}}}}} 攻击。',
        type: 'client_term',
      },
    },
  };

  assert.equal(
    translateWholeLine('<N>{{<normal>{{10}}}} to attack.', termsDictionary, 'zh-CN'),
    '<N>{{<normal>{{10}}}} 攻击。',
  );
});

test('selects only the outermost tooltip row when inline spans also look like rows', async () => {
  const { selectTooltipRows } = await loadCore();
  const root = {
    nodeType: 1,
    querySelectorAll: () => [outer, inner],
  };
  const outer = {
    nodeType: 1,
    tagName: 'DIV',
    textContent: '10% increased Attack Speed',
    children: [],
    parentElement: root,
    closest: () => null,
  };
  const inner = {
    nodeType: 1,
    tagName: 'SPAN',
    textContent: 'Attack Speed',
    children: [],
    parentElement: outer,
    closest: () => null,
  };
  outer.children = [inner];

  const rows = selectTooltipRows(root, new Set());
  assert.equal(rows.length, 1);
  assert.equal(rows[0], outer);
});

test('selects a tooltip root when its visible text is held directly on the root', async () => {
  const { selectTooltipRows } = await loadCore();
  const document = new TestDocument();
  const root = document.createElement('div');
  root.append(document.createTextNode('Runeforged Quickslip Shoes'));
  root.querySelectorAll = () => [];

  const rows = selectTooltipRows(root, new Set());
  assert.equal(rows.length, 1);
  assert.equal(rows[0], root);
});

test('selects ordinary split-span page rows as complete lines', async () => {
  const { selectPageRows } = await loadCore();
  const root = {
    nodeType: 1,
    querySelectorAll: () => [html, body, row, prefix, keyword, suffix],
  };
  const html = {
    nodeType: 1,
    tagName: 'HTML',
    textContent: '30% increased Charm Charges gained',
    children: [],
    parentElement: root,
    closest: () => null,
  };
  const body = {
    nodeType: 1,
    tagName: 'BODY',
    textContent: '30% increased Charm Charges gained',
    children: [],
    parentElement: html,
    closest: () => null,
  };
  const row = {
    nodeType: 1,
    tagName: 'DIV',
    textContent: '30% increased Charm Charges gained',
    children: [],
    parentElement: body,
    closest: () => null,
  };
  const prefix = {
    nodeType: 1,
    tagName: 'SPAN',
    textContent: '30% increased ',
    children: [],
    parentElement: row,
    closest: () => null,
  };
  const keyword = {
    nodeType: 1,
    tagName: 'SPAN',
    textContent: 'Charm',
    children: [],
    parentElement: row,
    closest: () => null,
  };
  const suffix = {
    nodeType: 1,
    tagName: 'SPAN',
    textContent: ' Charges gained',
    children: [],
    parentElement: row,
    closest: () => null,
  };
  row.children = [prefix, keyword, suffix];
  body.children = [row];
  html.children = [body];

  const rows = selectPageRows(root, new Set(['DIV', 'P', 'LI']));
  assert.equal(rows.length, 1);
  assert.equal(rows[0], row);
});

test('promotes an inline mutation root to its containing page row', async () => {
  const { selectPageRows } = await loadCore();
  const document = new TestDocument();
  const card = document.createElement('article');
  const row = document.createElement('div');
  const fragment = document.createElement('span');
  row.append(document.createTextNode('Can tattoo Runes onto your body, gaining additional Rune'));
  fragment.append(document.createTextNode('-only sockets:\n• 1 Helmet socket'));
  row.append(fragment);
  row.children = [fragment];
  fragment.children = [];
  card.append(row);
  card.children = [row];
  row.querySelectorAll = () => [fragment];
  fragment.querySelectorAll = () => [];

  const rows = selectPageRows(fragment, new Set(['ARTICLE', 'DIV', 'P', 'LI']));
  assert.equal(rows.length, 1);
  assert.equal(rows[0], row);
});

test('does not treat containers with form controls as page rows', async () => {
  const { selectPageRows } = await loadCore();
  const root = {
    nodeType: 1,
    tagName: 'BODY',
    textContent: 'LeagueRunes of Aldur',
    children: [],
    parentElement: null,
    closest: () => null,
    querySelectorAll: () => [row, label, select],
  };
  const row = {
    nodeType: 1,
    tagName: 'DIV',
    textContent: root.textContent,
    children: [],
    parentElement: root,
    closest: () => null,
  };
  const label = {
    nodeType: 1,
    tagName: 'LABEL',
    textContent: root.textContent,
    children: [],
    parentElement: row,
    closest: () => null,
  };
  const select = {
    nodeType: 1,
    tagName: 'SELECT',
    textContent: 'Runes of Aldur',
    children: [],
    parentElement: label,
    closest: () => null,
  };
  row.children = [label];
  label.children = [select];

  const rows = selectPageRows(root, new Set(['DIV', 'P', 'LI']));
  assert.equal(rows.length, 0);
});

test('does not let a custom-element page shell swallow split-span rows', async () => {
  const { selectPageRows } = await loadCore();
  const body = {
    nodeType: 1,
    tagName: 'BODY',
    textContent: '30% increased Charm Charges gained',
    children: [],
    parentElement: null,
    closest: () => null,
  };
  const shell = {
    nodeType: 1,
    tagName: 'DIV',
    textContent: body.textContent,
    children: [],
    parentElement: body,
    closest: () => null,
  };
  const island = {
    nodeType: 1,
    tagName: 'ASTRO-ISLAND',
    textContent: body.textContent,
    children: [],
    parentElement: shell,
    closest: () => null,
  };
  const row = {
    nodeType: 1,
    tagName: 'DIV',
    textContent: body.textContent,
    children: [],
    parentElement: island,
    closest: () => null,
  };
  const prefix = {
    nodeType: 1,
    tagName: 'SPAN',
    textContent: '30% increased ',
    children: [],
    parentElement: row,
    closest: () => null,
  };
  const keyword = {
    nodeType: 1,
    tagName: 'SPAN',
    textContent: 'Charm',
    children: [],
    parentElement: row,
    closest: () => null,
  };
  const suffix = {
    nodeType: 1,
    tagName: 'SPAN',
    textContent: ' Charges gained',
    children: [],
    parentElement: row,
    closest: () => null,
  };
  row.children = [prefix, keyword, suffix];
  island.children = [row];
  shell.children = [island];
  body.children = [shell];
  body.querySelectorAll = () => [shell, island, row, prefix, keyword, suffix];

  const rows = selectPageRows(body, new Set(['DIV', 'P', 'LI']));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tagName, 'DIV');
  assert.equal(rows[0].textContent, '30% increased Charm Charges gained');
});

test('finds the complete page row when a nested span is the mutation target', async () => {
  const { findPageRow } = await loadCore();
  const root = {
    nodeType: 1,
    tagName: 'BODY',
    children: [],
    parentElement: null,
    textContent: '30% increased Charm Charges gained',
    closest: () => null,
  };
  const card = {
    nodeType: 1,
    tagName: 'DIV',
    children: [],
    parentElement: root,
    textContent: root.textContent,
    closest: () => null,
  };
  const row = {
    nodeType: 1,
    tagName: 'DIV',
    children: [],
    parentElement: card,
    textContent: root.textContent,
    closest: () => null,
  };
  const keyword = {
    nodeType: 1,
    tagName: 'SPAN',
    children: [],
    parentElement: row,
    textContent: 'Charm',
    closest: () => null,
  };
  row.children = [keyword];
  card.children = [row];
  root.children = [card];

  assert.equal(findPageRow(keyword, new Set(['DIV', 'P', 'LI'])), row);
});

test('uses O(1) tooltip templates for complete modifier and effect lines', async () => {
  const { translateText } = await loadCore();

  assert.equal(
    translateText('+33 to Intelligence', dictionary, 'zh-TW'),
    '+33 點智慧',
  );
  assert.equal(
    translateText('98% increased Energy Shield', dictionary, 'zh-CN'),
    '能量护盾提高 98%',
  );
  assert.equal(
    translateText('Deals (16 — 553) to (24 — 829) Physical Damage', dictionary, 'zh-CN'),
    '造成 (16 — 553) 至 (24 — 829) 点物理伤害',
  );
});

test('normalises incidental spaces before punctuation before performing an O(1) tooltip lookup', async () => {
  const { translateText } = await loadCore();

  assert.equal(
    translateText(
      'Supports any skill, making it cost less to use. Cannot support skills which reserve Spirit .',
      dictionary,
      'zh-CN',
    ),
    '辅助任意技能，使其消耗更低。无法辅助保留精魂的技能。',
  );
});

test('translates POE Ninja time-machine labels with dynamic values', async () => {
  const { translateInlineText } = await loadCore();
  const dictionary = { items: {}, stats: {}, tooltip: {}, ui: {} };

  assert.equal(translateInlineText('Week 12', dictionary, 'zh-CN'), '第12周');
  assert.equal(translateInlineText('Day 6', dictionary, 'zh-CN'), '第6天');
  assert.equal(translateInlineText('Hour 18', dictionary, 'zh-CN'), '第18小时');
  assert.equal(translateInlineText('4 days ago', dictionary, 'zh-CN'), '4天前');
  assert.equal(translateInlineText('Act 3', dictionary, 'zh-CN'), '第3幕');
});

test('matches rendered client text when dictionary keys contain rich-text display tags', async () => {
  const { translateWholeLine } = await loadCore();
  const dictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms: {
      '100% more Maximum [Rage]': {
        translation: '[Rage|怒火]上限提高 100%',
        type: 'client_term',
      },
      'Regenerate 1 [Rage]Rage per second per 4 [Rage]Rage spent [Recently]Recently': {
        translation: '[Recently|近期]每消耗 4 点[Rage|怒火]，则每秒回复 1 点[Rage|怒火]',
        type: 'client_term',
      },
      'No [Rage]Rage effect': {
        translation: '[Rage|怒火]效果失效',
        type: 'client_term',
      },
      'Skill Mana Costs [StatConversion|Converted] to Life Costs': {
        translation: '技能的魔力消耗[StatConversion|转化]为生命消耗',
        type: 'client_term',
      },
      'You have no Mana': {
        translation: '你不具有魔力',
        type: 'client_term',
      },
    },
  };

  assert.equal(
    translateWholeLine('100% more Maximum Rage', dictionary, 'zh-CN'),
    '怒火上限提高 100%',
  );
  assert.equal(
    translateWholeLine('Regenerate 1 Rage per second per 4 Rage spent Recently', dictionary, 'zh-CN'),
    '近期每消耗 4 点怒火，则每秒回复 1 点怒火',
  );
  assert.equal(
    translateWholeLine('No Rage effect', dictionary, 'zh-CN'),
    '怒火效果失效',
  );
  assert.equal(
    translateWholeLine('Skill Mana Costs Converted to Life Costs', dictionary, 'zh-CN'),
    '技能的魔力消耗转化为生命消耗',
  );
  assert.equal(
    translateWholeLine('You have no Mana', dictionary, 'zh-CN'),
    '你不具有魔力',
  );
});

test('translates individual rows extracted from a multiline client term', async () => {
  const { translateWholeLine } = await loadCore();
  const dictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms: {
      '100% more Maximum [Rage]\nRegenerate 1 [Rage] per second per 4 [Rage] spent [Recently]': {
        translation: '[Rage|怒火]上限提高 100%\n[Recently|近期]每消耗 4 点[Rage|怒火]，则每秒回复 1 点[Rage|怒火]',
        type: 'client_term',
      },
    },
  };

  assert.equal(
    translateWholeLine('100% more Maximum Rage', dictionary, 'zh-CN'),
    '怒火上限提高 100%',
  );
  assert.equal(
    translateWholeLine('Regenerate 1 Rage per second per 4 Rage spent Recently', dictionary, 'zh-CN'),
    '近期每消耗 4 点怒火，则每秒回复 1 点怒火',
  );
});

test('translates each row when a multiline passive stat is split by the page DOM', async () => {
  const { translateTooltipText } = await loadCore();
  const dictionary = await loadPoe2Dictionary();
  const sourceRows = [
    'Can tattoo Runes onto your body, gaining',
    'additional Rune-only sockets:',
    '• 1 Helmet socket',
    '• 2 Body Armour sockets',
    '• 1 Gloves socket',
    '• 1 Boots socket',
  ];
  const expectedRows = [
    '可将符文文身于身体上，获得额外的',
    '仅限符文的插槽：',
    '• 1 个头盔插槽',
    '• 2 个胸甲插槽',
    '• 1 个手套插槽',
    '• 1 个鞋子插槽',
  ];

  assert.deepEqual(
    sourceRows.map((row) => translateTooltipText(row, dictionary, 'zh-CN')),
    expectedRows,
  );
});

test('translates dynamic values when their label comes from the client term dictionary', async () => {
  const { translateWholeLine } = await loadCore();
  const dictionary = {
    items: {},
    stats: {},
    tooltip: {},
    ui: {},
    terms: {
      'Quality (Attack Modifiers)': {
        translation: '品质（攻击词缀）',
        type: 'client_term',
      },
    },
  };

  assert.equal(
    translateWholeLine('Quality (Attack Modifiers): +20%', dictionary, 'zh-CN'),
    '品质（攻击词缀）：+20%',
  );
});

test('normalises markup-induced spaces after hyphens before an O(1) tooltip lookup', async () => {
  const { translateText } = await loadCore();
  const hyphenatedDictionary = {
    items: {},
    stats: {},
    ui: {},
    tooltip: {
      'Non-Channelling Spells deal #% increased Damage per # maximum Life': {
        en: 'Non-Channelling Spells deal #% increased Damage per # maximum Life',
        'zh-CN': '每 # 生命上限使非吟唱法术的伤害提高 #%',
        'zh-TW': '每#最大生命，增加 #%非引導法術的傷害',
        placeholderOrder: {
          'zh-CN': [1, 0],
          'zh-TW': [1, 0],
        },
      },
    },
  };

  assert.equal(
    translateText(
      'Non- Channelling Spells deal 6% increased Damage per 100 maximum Life',
      hyphenatedDictionary,
      'zh-CN',
    ),
    '每 100 生命上限使非吟唱法术的伤害提高 6%',
  );
});

test('does not enumerate every tooltip template for text that has no translation', async () => {
  const { translateText } = await loadCore();
  const dictionaryWithLargeTooltipPartition = {
    items: {},
    stats: {},
    ui: {},
    tooltip: new Proxy({}, {
      ownKeys() {
        throw new Error('unmatched text must not enumerate tooltip templates');
      },
    }),
  };

  assert.equal(
    translateText('Unlisted dynamic page text', dictionaryWithLargeTooltipPartition, 'zh-CN'),
    'Unlisted dynamic page text',
  );
});

test('renders translated tooltip modifiers without discarding inline highlights or links', async () => {
  const { renderTooltipTranslation } = await loadCore();
  const document = new TestDocument();
  const row = document.createElement('div');
  const value = document.createElement('span', { class: 'value-highlight' });
  const link = document.createElement('a', { href: '/poe2/Intelligence' });
  value.append(document.createTextNode('+33'));
  link.append(document.createTextNode('Intelligence'));
  row.append(value, document.createTextNode(' to '), link);

  const rendered = renderTooltipTranslation(row, '+33 to Intelligence', '+33 智慧');

  assert.equal(rendered, true);
  assert.equal(row.textContent, '+33 智慧');
  assert.equal(findElement(row, 'span')?.getAttribute('class'), 'value-highlight');
  assert.equal(findElement(row, 'span')?.textContent, '+33');
  assert.equal(findElement(row, 'a')?.getAttribute('href'), '/poe2/Intelligence');
  assert.equal(findElement(row, 'a')?.textContent, '智慧');
  assert.equal(row.childNodes.includes(value), true);
  assert.equal(row.childNodes.includes(link), true);
});

test('preserves block-separated rare and base item title parts in tooltip headings', async () => {
  const { renderTooltipTranslation } = await loadCore();
  const terms = await loadPoe2Terms();
  const termsDictionary = { items: {}, stats: {}, tooltip: {}, ui: {}, terms };
  const document = new TestDocument();
  const row = document.createElement('h1');
  const rareName = document.createElement('div');
  rareName.append(document.createTextNode('Behemoth Bloom'));
  row.append(rareName, document.createTextNode('Emerald'));

  const rendered = renderTooltipTranslation(
    row,
    'Behemoth BloomEmerald',
    '巨兽光晕效果翡翠',
    { preserveBlockChildren: true, dictionary: termsDictionary, language: 'zh-CN' },
  );

  assert.equal(rendered, true);
  assert.equal(row.childNodes.includes(rareName), true);
  assert.equal(rareName.textContent, '巨兽光晕效果');
  assert.equal(row.childNodes[1].textContent, '翡翠');
});

test('translates rows whose linked stat terms are split across several inline spans', async () => {
  const { renderTooltipTranslation } = await loadCore();
  const document = new TestDocument();
  const row = document.createElement('div');
  const value = document.createElement('span', { class: 'value-highlight' });
  const armour = document.createElement('span', { 'data-tooltip-trigger': 'true' });
  const evasion = document.createElement('span', { 'data-tooltip-trigger': 'true' });
  const energyShield = document.createElement('span', { 'data-tooltip-trigger': 'true' });
  value.append(document.createTextNode('36% increased '));
  armour.append(document.createTextNode('Armour'));
  evasion.append(document.createTextNode('Evasion'));
  energyShield.append(document.createTextNode('Energy Shield'));
  row.append(
    value,
    armour,
    document.createTextNode(', '),
    evasion,
    document.createTextNode(' and '),
    energyShield,
  );

  const rendered = renderTooltipTranslation(
    row,
    '36% increased Armour, Evasion and Energy Shield',
    '护甲 、 闪避和能量护盾提高 36%',
  );

  assert.equal(rendered, true);
  assert.equal(row.textContent, '护甲 、 闪避和能量护盾提高 36%');
  assert.equal(findElement(row, 'span')?.textContent, '36%');
});

test('keeps inline links when a translated modifier moves its numeric value', async () => {
  const { renderTooltipTranslation } = await loadCore();
  const document = new TestDocument();
  const row = document.createElement('div');
  const value = document.createElement('span', { class: 'value-highlight' });
  const link = document.createElement('a', { href: '/poe2/Energy_Shield' });
  value.append(document.createTextNode('98%'));
  link.append(document.createTextNode('Energy Shield'));
  row.append(value, document.createTextNode(' increased '), link);

  const rendered = renderTooltipTranslation(row, '98% increased Energy Shield', '能量护盾提高 98%');

  assert.equal(rendered, true);
  assert.equal(row.textContent, '能量护盾提高 98%');
  assert.equal(findElement(row, 'a')?.getAttribute('href'), '/poe2/Energy_Shield');
  assert.equal(findElement(row, 'a')?.textContent, '能量护盾提高');
  assert.equal(findElement(row, 'span')?.textContent, '98%');
  assert.equal(row.childNodes.includes(value), true);
  assert.equal(row.childNodes.includes(link), true);
});

test('replaces split passive-card text without retaining English span content', async () => {
  const { translateTooltipText, renderTooltipTranslation } = await loadCore();
  const base = await loadPoe2Dictionary();
  const document = new TestDocument();
  const row = document.createElement('div');
  const englishSpan = document.createElement('span');
  row.append(
    document.createTextNode('Can tattoo Runes onto your body, gaining additional Rune'),
    englishSpan,
  );
  englishSpan.append(document.createTextNode(
    '-only sockets:\n• 1 Helmet socket\n• 2 Body Armour sockets\n• 1 Gloves socket\n• 1 Boots socket',
  ));

  const source = row.textContent;
  const translated = translateTooltipText(source, base, 'zh-CN');
  assert.notEqual(translated, source);

  const rendered = renderTooltipTranslation(row, source, translated, {
    dictionary: base,
    language: 'zh-CN',
  });

  assert.equal(rendered, true);
  assert.equal(row.textContent, '可将符文文身于身体上，获得额外的 仅限符文的插槽： • 1 个头盔插槽 • 2 个胸甲插槽 • 1 个手套插槽 • 1 个鞋子插槽');
  assert.equal(row.textContent.includes('-only sockets:'), false);
  assert.equal(row.textContent.includes('Helmet socket'), false);
  assert.equal(row.textContent.includes('Body Armour sockets'), false);
  assert.equal((row.textContent.match(/个头盔插槽/g) || []).length, 1);
  assert.equal((row.textContent.match(/个胸甲插槽/g) || []).length, 1);
  assert.equal((row.textContent.match(/个手套插槽/g) || []).length, 1);
  assert.equal((row.textContent.match(/个鞋子插槽/g) || []).length, 1);
});

test('replaces the real poe.ninja passive row split across linked term spans', async () => {
  const { translateTooltipText, renderTooltipTranslation } = await loadCore();
  const base = await loadPoe2Dictionary();
  const document = new TestDocument();
  const row = document.createElement('div');
  const tattooPrefix = document.createElement('span');
  const runes = document.createElement('span');
  const tattooMiddle = document.createElement('span');
  const rune = document.createElement('span');
  const sockets = document.createElement('span');
  tattooPrefix.append(document.createTextNode('Can tattoo '));
  runes.append(document.createTextNode('Runes'));
  tattooMiddle.append(document.createTextNode(' onto your body, gaining\nadditional '));
  rune.append(document.createTextNode('Rune'));
  sockets.append(document.createTextNode(
    '-only sockets:\n• 1 Helmet socket\n• 2 Body Armour sockets\n• 1 Gloves socket\n• 1 Boots socket',
  ));
  row.append(tattooPrefix, runes, tattooMiddle, rune, sockets);

  const source = row.textContent;
  const translated = translateTooltipText(source, base, 'zh-CN');
  assert.notEqual(translated, source);

  const rendered = renderTooltipTranslation(row, source, translated, {
    dictionary: base,
    language: 'zh-CN',
  });

  assert.equal(rendered, true);
  assert.equal(row.textContent.includes('-only sockets:'), false);
  assert.equal(row.textContent.includes('Helmet socket'), false);
  assert.equal(row.textContent.includes('Body Armour sockets'), false);
  assert.equal(row.textContent, '可将符文文身于身体上，获得额外的 仅限符文的插槽： • 1 个头盔插槽 • 2 个胸甲插槽 • 1 个手套插槽 • 1 个鞋子插槽');
});

test('repairs a passive row that was already partially translated before rescanning', async () => {
  const { translateTooltipText, renderTooltipTranslation } = await loadCore();
  const base = await loadPoe2Dictionary();
  const document = new TestDocument();
  const row = document.createElement('div');
  const englishFragment = document.createElement('span');
  row.append(
    document.createTextNode('可将符文文身于身体上，获得额外的 仅限符文的插槽： • '),
    englishFragment,
    document.createTextNode(' 个头盔插槽 • 2 个胸甲插槽 • 1 个手套插槽 • 1 个鞋子插槽'),
  );
  englishFragment.append(document.createTextNode(
    '-only sockets:\n• 1 Helmet socket\n• 2 Body Armour sockets\n• 1 Gloves socket\n• 1 Boots socket',
  ));

  const source = row.textContent;
  const translated = translateTooltipText(source, base, 'zh-CN');
  assert.equal(
    translated,
    '可将符文文身于身体上，获得额外的 仅限符文的插槽： • 1 个头盔插槽 • 2 个胸甲插槽 • 1 个手套插槽 • 1 个鞋子插槽',
  );

  const rendered = renderTooltipTranslation(row, source, translated, {
    dictionary: base,
    language: 'zh-CN',
  });
  assert.equal(rendered, true);
  assert.equal(row.textContent, translated);
  assert.equal(row.textContent.includes('-only sockets:'), false);
  assert.equal(row.textContent.includes('Helmet socket'), false);
});

test('renders inline tooltip values when translated numbers change order', async () => {
  const { renderTooltipTranslation } = await loadCore();
  const document = new TestDocument();
  const row = document.createElement('div');
  const percent = document.createElement('span', { class: 'value-highlight' });
  const metres = document.createElement('span', { class: 'value-highlight' });
  percent.append(document.createTextNode('16%'));
  metres.append(document.createTextNode('2'));
  row.append(
    document.createTextNode('Deal '),
    percent,
    document.createTextNode(' of Overkill damage to enemies within '),
    metres,
    document.createTextNode(' metres of the enemy killed'),
  );

  const rendered = renderTooltipTranslation(
    row,
    'Deal 16% of Overkill damage to enemies within 2 metres of the enemy killed',
    '对被击败的敌人 2 米内的敌人造成相当于溢出伤害 16% 的伤害',
  );

  assert.equal(rendered, true);
  assert.equal(row.textContent, '对被击败的敌人 2 米内的敌人造成相当于溢出伤害 16% 的伤害');
  assert.equal(percent.textContent, '16%');
  assert.equal(metres.textContent, '2');
});

test('selects a heading row that mixes a block child with direct text', async () => {
  const { selectTooltipRows } = await loadCore();
  const root = {
    nodeType: 1,
    tagName: 'DIV',
    querySelectorAll: () => [heading, nestedBase],
    children: [],
    closest: () => null,
  };
  const directText = new TestTextNode('Runeforged Tasalian Greaves', null);
  const nestedBase = {
    nodeType: 1,
    tagName: 'DIV',
    textContent: '鹰翼三月',
    children: [],
    parentElement: null,
    closest: () => null,
  };
  const heading = {
    nodeType: 1,
    tagName: 'H1',
    textContent: '鹰翼三月Runeforged Tasalian Greaves',
    childNodes: [nestedBase, directText],
    children: [nestedBase],
    parentElement: root,
    closest: () => null,
  };
  nestedBase.parentElement = heading;
  directText.parentElement = heading;
  root.children = [heading];

  const rows = selectTooltipRows(root, new Set(['DIV', 'H1']));
  assert.equal(rows.length, 1);
  assert.equal(rows[0], heading);
});

test('leaves unknown text in its original English form', async () => {
  const { translateText } = await loadCore();

  assert.equal(translateText('Unlisted Mystery Item', dictionary, 'zh-TW'), 'Unlisted Mystery Item');
});

test('identifies elements that must not be translated', async () => {
  const { shouldSkipElement } = await loadCore();

  assert.equal(shouldSkipElement({ tagName: 'SCRIPT', closest: () => null }), true);
  assert.equal(shouldSkipElement({ tagName: 'INPUT', closest: () => null }), true);
  assert.equal(shouldSkipElement({ tagName: 'DIV', closest: () => ({}) }), true);
  assert.equal(shouldSkipElement({ tagName: 'DIV', closest: () => null }), false);
});

test('builds official POEDB lookup links for the current game and language', async () => {
  const { buildOfficialLookupUrl } = await loadCore();

  assert.equal(
    buildOfficialLookupUrl('poe1', 'zh-CN', 'Chaos_Orb'),
    'https://poedb.tw/cn/Chaos_Orb',
  );
  assert.equal(
    buildOfficialLookupUrl('poe2', 'zh-TW', 'Chaos_Orb'),
    'https://poe2db.tw/tw/Chaos_Orb',
  );
  assert.equal(
    buildOfficialLookupUrl('poe2', 'en', 'Chaos Orb'),
    'https://poe2db.tw/us/Chaos_Orb',
  );
});

test('uses the official catalog slug when building a lookup URL', async () => {
  const { resolveOfficialLookup } = await loadCore();
  const lookup = resolveOfficialLookup({
    'Leap Slam': {
      en: 'Leap Slam',
      'zh-CN': '跃击',
      'zh-TW': '躍擊',
      slug: 'Leap_Slam',
    },
  }, 'poe2', 'zh-CN', 'Leap Slam');

  assert.equal(lookup.english, 'Leap Slam');
  assert.equal(lookup.href, 'https://poe2db.tw/cn/Leap_Slam');
});

test('loads POE1 and POE2 dictionaries independently when both requests are in flight', async () => {
  const { createDictionaryLoader } = await loadCore();
  const pending = new Map();
  const load = (game) => new Promise((resolve) => pending.set(game, resolve));
  const loader = createDictionaryLoader(load);

  const poe1 = loader.get('poe1');
  const poe2 = loader.get('poe2');
  await Promise.resolve();
  assert.equal(pending.size, 2);

  pending.get('poe2')({ game: 'poe2' });
  assert.equal((await poe2).game, 'poe2');
  pending.get('poe1')({ game: 'poe1' });
  assert.equal((await poe1).game, 'poe1');
  assert.equal((await loader.get('poe2')).game, 'poe2');
});

test('keeps language-specific dictionaries separate in the loader cache', async () => {
  const { createDictionaryLoader } = await loadCore();
  const calls = [];
  const loader = createDictionaryLoader(async (game, language) => {
    calls.push([game, language]);
    return { game, language };
  });

  assert.deepEqual(await loader.get('poe2', 'zh-CN'), { game: 'poe2', language: 'zh-CN' });
  assert.deepEqual(await loader.get('poe2', 'zh-TW'), { game: 'poe2', language: 'zh-TW' });
  assert.deepEqual(await loader.get('poe2', 'zh-CN'), { game: 'poe2', language: 'zh-CN' });
  assert.deepEqual(calls, [
    ['poe2', 'zh-CN'],
    ['poe2', 'zh-TW'],
  ]);
});

test('resolves a fresh official lookup URL when a virtualized row changes item names', async () => {
  const { resolveOfficialLookup } = await loadCore();
  const items = {
    'Chaos Orb': {
      en: 'Chaos Orb',
      'zh-CN': '混沌石',
      'zh-TW': '混沌石',
      sources: { 'zh-CN': 'https://poe2db.tw/cn/Chaos_Orb' },
    },
    'Divine Orb': {
      en: 'Divine Orb',
      'zh-CN': '神圣石',
      'zh-TW': '神聖石',
      sources: { 'zh-CN': 'https://poe2db.tw/cn/Divine_Orb' },
    },
  };

  const chaos = resolveOfficialLookup(items, 'poe2', 'zh-CN', 'Chaos Orb');
  assert.equal(chaos.english, 'Chaos Orb');
  assert.equal(chaos.href, 'https://poe2db.tw/cn/Chaos_Orb');
  const divine = resolveOfficialLookup(items, 'poe2', 'zh-CN', 'Divine Orb');
  assert.equal(divine.english, 'Divine Orb');
  assert.equal(divine.href, 'https://poe2db.tw/cn/Divine_Orb');
});

test('page row translation protects rendered nodes from text node rescanning', async () => {
  const core = await loadCore();
  const base = await loadPoe2Dictionary();
  const document = new TestDocument();

  const originalText = new WeakMap();
  const lastAppliedText = new WeakMap();
  const pageRowSourceStates = new WeakMap();
  const pageRowApplication = new WeakMap();
  const tooltipApplication = new WeakMap();
  const language = 'zh-CN';

  function captureElementSource(element) {
    const textNodes = [];
    const source = [];
    function walk(node) {
      if (node.nodeType === 3) {
        const priorSource = originalText.get(node);
        const value = priorSource !== undefined && lastAppliedText.get(node) === node.nodeValue
          ? priorSource
          : node.nodeValue;
        originalText.set(node, value);
        textNodes.push({ node, value });
        source.push(value);
        return;
      }
      for (const child of node.childNodes || []) walk(child);
    }
    walk(element);
    return { children: [...element.childNodes], textNodes, source: source.join('') };
  }

  function syncRenderedTextNodes(element) {
    function walk(node) {
      if (node.nodeType === 3) {
        originalText.set(node, node.nodeValue);
        lastAppliedText.set(node, node.nodeValue);
        return;
      }
      for (const child of node.childNodes || []) walk(child);
    }
    walk(element);
  }

  function isInsideTranslatedRow(element) {
    for (let current = element; current; current = current.parentElement) {
      if (tooltipApplication.get(current)?.language === language && tooltipApplication.get(current)?.translated) return true;
      const pageApp = pageRowApplication.get(current);
      if (pageApp?.language === language && pageApp?.translated) return true;
    }
    return false;
  }

  function translatePageRow(element) {
    const application = pageRowApplication.get(element);
    if (application?.renderedText === element.textContent && application.language === language) return;
    const sourceState = captureElementSource(element);
    for (const { node, value } of sourceState.textNodes) node.nodeValue = value;
    element.replaceChildren(...sourceState.children);
    const translated = core.translateTooltipText(sourceState.source, base, language);
    let wasTranslated = false;
    if (translated !== sourceState.source) {
      wasTranslated = core.renderTooltipTranslation(element, sourceState.source, translated, {
        preserveBlockChildren: false,
        dictionary: base,
        language,
      });
    }
    if (wasTranslated) {
      syncRenderedTextNodes(element);
    }
    pageRowApplication.set(element, { renderedText: element.textContent, language, translated: wasTranslated });
  }

  function translateTextNode(node) {
    const parent = node.parentElement;
    if (!parent || !node.nodeValue.trim()) return;
    if (isInsideTranslatedRow(parent)) return;

    const priorSource = originalText.get(node);
    const source = (priorSource !== undefined && lastAppliedText.get(node) === node.nodeValue)
      ? priorSource
      : node.nodeValue;
    const wholeLineTranslation = core.translateWholeLine(source, base, language);
    const translated = wholeLineTranslation !== source
      ? wholeLineTranslation
      : core.translateInlineText(source, base, language);
    if (node.nodeValue !== translated) node.nodeValue = translated;
    lastAppliedText.set(node, translated);
  }

  function walkAndTranslateTextNodes(root) {
    function walk(node) {
      if (node.nodeType === 3) {
        translateTextNode(node);
        return;
      }
      for (const child of [...node.childNodes]) walk(child);
    }
    walk(root);
  }

  // 1. 测试“符文经脉”复合行结构
  const row1 = document.createElement('div');
  const prefix = document.createTextNode('Can tattoo Runes onto your body, gaining additional Rune');
  const span = document.createElement('span');
  span.append(document.createTextNode('-only sockets:\n• 1 Helmet socket\n• 2 Body Armour sockets\n• 1 Gloves socket\n• 1 Boots socket'));
  row1.append(prefix, span);

  translatePageRow(row1);
  walkAndTranslateTextNodes(row1);

  assert.equal(
    row1.textContent,
    '可将符文文身于身体上，获得额外的 仅限符文的插槽： • 1 个头盔插槽 • 2 个胸甲插槽 • 1 个手套插槽 • 1 个鞋子插槽',
  );
  assert.equal(row1.textContent.includes('-only sockets:'), false);
  assert.equal(row1.textContent.includes('Helmet socket'), false);

  // 2. 测试带有 30% increased 的复合行结构
  const row2 = document.createElement('div');
  const valSpan = document.createElement('span');
  valSpan.append(document.createTextNode('30% increased '));
  const charmSpan = document.createElement('span');
  charmSpan.append(document.createTextNode('Charm Charges'));
  row2.append(valSpan, charmSpan, document.createTextNode(' gained'));

  translatePageRow(row2);
  walkAndTranslateTextNodes(row2);

  assert.equal(row2.textContent, '获得的咒符充能提高 30%');
  assert.equal(row2.textContent.includes('increased'), false);
});

test('translates jewel radius template affixes and radius UI label', async () => {
  const { translateWholeLine } = await loadCore();
  const base = await loadPoe2Dictionary();

  assert.equal(
    translateWholeLine(
      'Notable Passive Skills in Radius also grant 9% increased Critical Damage Bonus for Attack Damage',
      base,
      'zh-CN',
    ),
    '范围内的核心天赋同时提供 攻击伤害的暴击伤害加成 9%',
  );

  assert.equal(
    translateWholeLine(
      'Notable Passive Skills in Radius also grant 8% increased Critical Hit Chance for Attacks',
      base,
      'zh-CN',
    ),
    '范围内的核心天赋同时提供 攻击暴击率提高 8%',
  );

  assert.equal(
    translateWholeLine(
      'Notable Passive Skills in Radius also grant 8% increased Critical Damage Bonus with Spears',
      base,
      'zh-CN',
    ),
    '范围内的核心天赋同时提供 战矛的暴击伤害加成提高 8%',
  );

  assert.equal(
    translateWholeLine(
      'Small Passive Skills in Radius also grant 2% increased Attack Damage',
      base,
      'zh-CN',
    ),
    '范围内的小型天赋同时提供 攻击伤害提高 2%',
  );

  assert.equal(
    translateWholeLine('Radius: Very Large', base, 'zh-CN'),
    '范围：极大',
  );
});

test('renders tooltip translation with textContent fallback when numeric counts differ between source and translation', async () => {
  const { renderTooltipTranslation, translateTooltipText } = await loadCore();
  const base = await loadPoe2Dictionary();

  const source = 'Consume all Rage when Shapeshifting to Human form to recover 1% of maximum life per Rage Consumed';
  const translated = translateTooltipText(source, base, 'zh-CN');

  assert.equal(translated, '变形为人类时消耗所有怒火，每消耗 1 点怒火恢复生命上限的 1%');

  const document = new TestDocument();
  const row = document.createElement('div');
  const rageSpan = document.createElement('span');
  rageSpan.append(document.createTextNode('Rage'));

  row.append(
    document.createTextNode('Consume all '),
    rageSpan,
    document.createTextNode(' when Shapeshifting to Human form to recover 1% of maximum life per Rage Consumed'),
  );

  const rendered = renderTooltipTranslation(row, source, translated);
  assert.equal(rendered, true);
  assert.equal(row.textContent, '变形为人类时消耗所有怒火，每消耗 1 点怒火恢复生命上限的 1%');
});

test('translates support gem requirements and attribute abbreviations', async () => {
  const { translateWholeLine } = await loadCore();
  const base = await loadPoe2Dictionary();

  assert.equal(
    translateWholeLine('Support Gem Requirements: +5 Str (5)', base, 'zh-CN'),
    '辅助宝石需求：+5 力量 (5)',
  );
  assert.equal(
    translateWholeLine('Support Gem Requirements: +12 Dex (12)', base, 'zh-CN'),
    '辅助宝石需求：+12 敏捷 (12)',
  );
  assert.equal(
    translateWholeLine('Support Gem Requirements: +8 Int (8)', base, 'zh-CN'),
    '辅助宝石需求：+8 智慧 (8)',
  );
  assert.equal(
    translateWholeLine('Item Requirements: Level 20, 150 Str', base, 'zh-CN'),
    '物品需求：等级 20, 150力量',
  );
  assert.equal(
    translateWholeLine('Requirements: Level 68, 155 Str, 70 Int', base, 'zh-CN'),
    '需求：等级 68, 155 力量, 70 智慧',
  );
});

test('translates dynamic passive names within unique jewel radius template affixes', async () => {
  const { translateWholeLine } = await loadCore();
  const base = await loadPoe2Dictionary();

  assert.equal(
    translateWholeLine('Passives in Radius of Wildsurge Incantation can be Allocated', base, 'zh-CN'),
    '狂野涌动咒语范围内的天赋可以在',
  );

  assert.equal(
    translateWholeLine('Passives in Radius of Wildsurge Incantation can be Allocated', base, 'zh-TW'),
    '荒野湧浪咒範圍內的天賦可以在',
  );

  assert.equal(
    translateWholeLine('Passives in Radius of Invigorating Hate can be Allocated', base, 'zh-CN'),
    '激生恨意范围内的天赋可以在',
  );

  assert.equal(
    translateWholeLine('Passives in Radius of Wildsurge Incantation can be Allocated without being connected to your tree', base, 'zh-CN'),
    '狂野涌动咒语范围内的天赋可以在 未连结至天赋树的情况下配置',
  );
});

test('translates dynamic skill names within unique jewel skill level template affixes', async () => {
  const { translateWholeLine } = await loadCore();
  const base = await loadPoe2Dictionary();

  assert.equal(
    translateWholeLine('+3 to Level of all Summon Spectre Skills', base, 'zh-CN'),
    '所有召唤灵体技能等级 +3',
  );

  assert.equal(
    translateWholeLine('+3 to Level of all Spark Skills', base, 'zh-CN'),
    '所有电球技能等级 +3',
  );

  assert.equal(
    translateWholeLine('+3 to Level of all Spark Skills', base, 'zh-TW'),
    '全部電球技能+3等級',
  );

  assert.equal(
    translateWholeLine('+3 to Level of all Rolling Magma Skills', base, 'zh-CN'),
    '所有熔岩奔涌技能等级 +3',
  );
});

test('attaches term highlight spans and official description data attributes', async () => {
  const { renderTooltipTranslation } = await loadCore();
  const base = await loadPoe2Dictionary();

  const document = new TestDocument();
  const row = document.createElement('div');
  const span = document.createElement('span', { class: 'stat-link' });
  span.append(document.createTextNode('Dreaming Gloom Shrine'));
  row.append(document.createTextNode('Grants effect of '), span);

  const source = 'Grants effect of Dreaming Gloom Shrine';
  const translated = '获得梦想隐忍神龛的效果';

  const rendered = renderTooltipTranslation(row, source, translated, {
    dictionary: base,
    language: 'zh-CN',
  });

  assert.equal(rendered, true);
  assert.equal(row.textContent, '获得梦想隐忍神龛的效果');
  const termSpan = findElement(row, 'span');
  assert.equal(termSpan?.textContent, '梦想隐忍神龛');
  assert.equal(termSpan?.getAttribute('class'), 'poe-ninja-stat-term');
  assert.equal(termSpan?.getAttribute('data-term-name'), '梦想隐忍神龛');
  assert.equal(termSpan?.getAttribute('data-term-desc'), '被击败的敌人会爆炸，造成其生命上限四分之一的混沌伤害。');
});

test('searches terms and items bilingually for both English and Chinese queries', async () => {
  const { searchBilingual } = await loadCore();
  const dict = await loadPoe2Dictionary();

  const wandResults = searchBilingual('法杖', dict, 'zh-CN', 5);
  assert.ok(wandResults.length > 0);
  assert.equal(wandResults[0].chinese, '法杖');
  assert.equal(wandResults[0].english, 'Wand');

  const magebloodResults = searchBilingual('法师之血', dict, 'zh-CN', 5);
  assert.ok(magebloodResults.length > 0);
  assert.equal(magebloodResults[0].chinese, '法师之血');
  assert.equal(magebloodResults[0].english, 'Mageblood');

  const sparkResults = searchBilingual('Spark', dict, 'zh-CN', 5);
  assert.ok(sparkResults.length > 0);
  assert.equal(sparkResults[0].chinese, '电球');
  assert.equal(sparkResults[0].english, 'Spark');

  const twMageblood = searchBilingual('魔血', dict, 'zh-TW', 5);
  assert.ok(twMageblood.length > 0);
  assert.equal(twMageblood[0].english, 'Mageblood');
});

test('translates item rarity and category filter labels bilingually', async () => {
  const { translateWholeLine, translateInlineText } = await loadCore();
  const dict = await loadPoe2Dictionary();

  assert.equal(translateWholeLine('Rare Ring', dict, 'zh-CN'), '稀有戒指');
  assert.equal(translateWholeLine('Rare Jewel', dict, 'zh-CN'), '稀有珠宝');
  assert.equal(translateWholeLine('Rare Boots', dict, 'zh-CN'), '稀有鞋子');
  assert.equal(translateWholeLine('Rare Amulet', dict, 'zh-CN'), '稀有护身符');
  assert.equal(translateWholeLine('Magic Flask', dict, 'zh-CN'), '魔法药剂');
  assert.equal(translateWholeLine('Rare Gloves', dict, 'zh-CN'), '稀有手套');
  assert.equal(translateWholeLine('Rare Helmet', dict, 'zh-CN'), '稀有头盔');
  assert.equal(translateWholeLine('Rare Body Armour', dict, 'zh-CN'), '稀有胸甲');
  assert.equal(translateWholeLine('Rare Shield', dict, 'zh-CN'), '稀有盾牌');

  assert.equal(translateWholeLine('Rare Jewel', dict, 'zh-TW'), '稀有珠寶');
  assert.equal(translateWholeLine('Rare Amulet', dict, 'zh-TW'), '稀有護身符');
  assert.equal(translateWholeLine('Magic Flask', dict, 'zh-TW'), '魔法藥劑');
  assert.equal(translateWholeLine('Rare Helmet', dict, 'zh-TW'), '稀有頭盔');
});

test('translates weapon configuration and slash combinations bilingually', async () => {
  const { translateWholeLine } = await loadCore();
  const dict = await loadPoe2Dictionary();

  assert.equal(translateWholeLine('WEAPON CONFIGURATION', dict, 'zh-CN'), '武器配置');
  assert.equal(translateWholeLine('Bow / Quiver', dict, 'zh-CN'), '弓 / 箭袋');
  assert.equal(translateWholeLine('Unknown / Sceptre', dict, 'zh-CN'), '未知 / 权杖');
  assert.equal(translateWholeLine('Wand / Focus', dict, 'zh-CN'), '法杖 / 法器');
  assert.equal(translateWholeLine('Dual Unknown', dict, 'zh-CN'), '双持未知');
  assert.equal(translateWholeLine('Sceptre / Focus', dict, 'zh-CN'), '权杖 / 法器');
  assert.equal(translateWholeLine('Spear / Sceptre', dict, 'zh-CN'), '长矛 / 权杖');
  assert.equal(translateWholeLine('Two Handed Mace / Sceptre', dict, 'zh-CN'), '双手锤 / 权杖');
  assert.equal(translateWholeLine('Two Handed Mace / Shield', dict, 'zh-CN'), '双手锤 / 盾牌');
  assert.equal(translateWholeLine('Staff / Focus', dict, 'zh-CN'), '长杖 / 法器');
  assert.equal(translateWholeLine('Talisman / Sceptre', dict, 'zh-CN'), '魔符 / 权杖');
  assert.equal(translateWholeLine('Dual Mace', dict, 'zh-CN'), '双持单手锤');
  assert.equal(translateWholeLine('Wand / Buckler', dict, 'zh-CN'), '法杖 / 圆盾');
  assert.equal(translateWholeLine('Unknown / Buckler', dict, 'zh-CN'), '未知 / 圆盾');
  assert.equal(translateWholeLine('Unknown / Shield', dict, 'zh-CN'), '未知 / 盾牌');
  assert.equal(translateWholeLine('Spear / Buckler', dict, 'zh-CN'), '长矛 / 圆盾');

  assert.equal(translateWholeLine('Bow / Quiver', dict, 'zh-TW'), '弓 / 箭袋');
  assert.equal(translateWholeLine('Unknown / Sceptre', dict, 'zh-TW'), '未知 / 權杖');
  assert.equal(translateWholeLine('Wand / Focus', dict, 'zh-TW'), '法杖 / 法器');
  assert.equal(translateWholeLine('Dual Unknown', dict, 'zh-TW'), '雙持未知');
  assert.equal(translateWholeLine('Two Handed Mace / Sceptre', dict, 'zh-TW'), '雙手槌 / 權杖');
  assert.equal(translateWholeLine('Two Handed Mace / Shield', dict, 'zh-TW'), '雙手槌 / 盾牌');
});
