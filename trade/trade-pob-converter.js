/** 将未经翻译的 Trade API 物品快照转换为 PoB 物品文本。 */
(function attachTradePobConverter(root) {
  'use strict';

  const SEPARATOR = '--------';
  const FRAME_TYPE_TO_RARITY = {
    0: 'Normal', 1: 'Magic', 2: 'Rare', 3: 'Unique', 4: 'Gem',
    5: 'Currency', 6: 'Divination Card', 8: 'Prophecy', 9: 'Relic',
  };
  const PROPERTY_NAME_MAP = {
    'Runic Ward': 'Ward', RunicWard: 'Ward', EnergyShield: 'Energy Shield',
  };
  const MOD_FLAGS = ['crafted', 'fractured', 'desecrated', 'mutated'];

  function cleanRichText(value) {
    if (value == null) return '';
    return String(value)
      .replace(/<<[^>]+>>/g, '')
      .replace(/\[([^|\]]+)\|([^\]]+)\]/g, '$2')
      .replace(/\[([^\]]+)\]/g, '$1')
      .replace(/\{([^}]+)\}/g, '$1')
      .replace(/\r\n?/g, '\n')
      .split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).join('\n')
      .trim();
  }

  function englishText(value, field, singleLine = false) {
    if (typeof value !== 'string') throw new Error(`物品数据无效：${field}`);
    const text = cleanRichText(value);
    if (/[\u3400-\u9fff\uf900-\ufaff]/.test(text)) throw new Error(`缺少英文原文：${field}`);
    if (singleLine && text.includes('\n')) throw new Error(`物品数据包含无效换行：${field}`);
    return text;
  }

  function arrayField(item, field) {
    if (item[field] == null) return [];
    if (!Array.isArray(item[field])) throw new Error(`物品数据无效：${field}`);
    return item[field];
  }

  function propertyValue(value, field) {
    return englishText(Array.isArray(value) ? value[0] : value, field, true);
  }

  function formatPropertyLine(prop) {
    if (!prop || typeof prop !== 'object') throw new Error('物品属性数据无效');
    const name = englishText(prop.name, 'properties.name', true);
    const values = arrayField(prop, 'values').map((value) => propertyValue(value, 'properties.values'));
    if (!values.length) return '';
    if (values.some((value) => !value)) throw new Error('物品属性缺少数值');
    const normalizedName = PROPERTY_NAME_MAP[name] || name;
    if (/%\d+/.test(normalizedName)) {
      return normalizedName.replace(/%(\d+)/g, (_, index) => {
        if (values[index] == null) throw new Error('物品属性占位符缺少数值');
        return values[index];
      });
    }
    return `${normalizedName}: ${values.join(', ')}`;
  }

  function itemToPobText(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('物品数据无效');
    if (!Number.isInteger(item.frameType) || !Object.hasOwn(FRAME_TYPE_TO_RARITY, item.frameType)) throw new Error('物品缺少有效稀有度');
    const rarity = FRAME_TYPE_TO_RARITY[item.frameType];
    const type = englishText(item.typeLine || item.baseType || '', 'typeLine', true);
    if (!type) throw new Error('物品缺少英文类型');
    const name = englishText(item.name ?? '', 'name', true);
    const lines = [`Rarity: ${rarity}`];
    if (name) lines.push(name);
    lines.push(type);

    function addSection(section) {
      if (section.length) lines.push(SEPARATOR, ...section);
    }

    addSection(arrayField(item, 'properties').map(formatPropertyLine).filter(Boolean));
    const requirements = [];
    for (const req of arrayField(item, 'requirements')) {
      const reqName = englishText(req?.name, 'requirements.name', true);
      const outputName = { Level: 'Level', 'Class:': 'Requires Class', 'Charm Slots:': 'Charm Slots' }[reqName];
      if (!outputName) continue;
      const value = propertyValue(arrayField(req, 'values')[0], 'requirements.values');
      if (!value) throw new Error('物品需求缺少数值');
      requirements.push(`${outputName}: ${value}`);
    }
    if (requirements.length) addSection(['Requirements:', ...requirements]);

    const sockets = arrayField(item, 'sockets');
    if (sockets.length) {
      let socketText = '';
      let previousGroup;
      for (const socket of sockets) {
        if (!socket || typeof socket !== 'object') throw new Error('物品插槽数据无效');
        const code = socket.type === 'jewel' ? 'J' : socket.type === 'rune' ? 'S' : socket.sColour || ({ S: 'R', D: 'G', I: 'B' }[socket.attr]) || 'S';
        if (!/^[RGBWADSJ]$/.test(code)) throw new Error('物品插槽类型无效');
        const linked = /^[RGBW]$/.test(code) && socket.group != null && socket.group === previousGroup;
        socketText += (socketText ? linked ? '-' : ' ' : '') + code;
        previousGroup = socket.group;
      }
      addSection([`Sockets: ${socketText}`]);
    }
    if (item.ilvl != null) {
      if (!Number.isInteger(item.ilvl) || item.ilvl < 0) throw new Error('物品等级无效');
      addSection([`Item Level: ${item.ilvl}`]);
    }

    function modLines(field, sectionFlag = '') {
      const output = [];
      for (const mod of arrayField(item, field)) {
        const objectMod = mod && typeof mod === 'object' && !Array.isArray(mod);
        const text = englishText(objectMod ? mod.description || mod.text : mod, field);
        if (!text) throw new Error(`物品词缀为空：${field}`);
        const flags = [sectionFlag, ...MOD_FLAGS.filter((flag) => objectMod && mod[flag])].filter(Boolean);
        // 同文词缀可能来自不同来源或多枚符文；每条输入、每个物理行都保留。
        for (const line of text.split('\n').filter(Boolean)) {
          let tagged = line;
          for (const flag of new Set(flags)) {
            if (!tagged.includes(`(${flag})`)) tagged += ` (${flag})`;
          }
          output.push(tagged);
        }
      }
      return output;
    }

    addSection(modLines('enchantMods', 'enchant'));
    addSection(modLines('runeMods', 'rune'));
    addSection(modLines('implicitMods', 'implicit'));
    const skillLines = [];
    for (const skill of arrayField(item, 'grantedSkills')) {
      if (!skill || typeof skill !== 'object') throw new Error('赋予技能数据无效');
      const label = englishText(skill.name, 'grantedSkills.name', true);
      const value = propertyValue(arrayField(skill, 'values')[0], 'grantedSkills.values');
      if (label !== 'Grants Skill' || !value) throw new Error('赋予技能缺少有效英文描述');
      skillLines.push(`${label}: ${value} (implicit)`);
    }
    addSection(skillLines);
    addSection(modLines('fracturedMods', 'fractured'));
    addSection(modLines('explicitMods'));
    addSection(modLines('desecratedMods', 'desecrated'));
    addSection(modLines('mutatedMods', 'mutated'));
    addSection(modLines('craftedMods', 'crafted'));

    const states = [];
    if (item.mirrored || item.duplicated) states.push('Mirrored');
    if (item.sanctified) states.push('Sanctified');
    if (item.doubleCorrupted) states.push('Twice Corrupted');
    else if (item.corrupted) states.push('Corrupted');
    addSection(states);
    return lines.join('\n');
  }

  const TradePobConverter = Object.freeze({ cleanRichText, itemToPobText });
  if (typeof module !== 'undefined' && module.exports) module.exports = TradePobConverter;
  if (root) root.PoeNinjaTradePobConverter = TradePobConverter;
})(typeof globalThis !== 'undefined' ? globalThis : this);
