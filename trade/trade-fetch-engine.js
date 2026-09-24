(function attachTradeFetchEngine(root) {
  'use strict';

  function normalizeText(str) {
    return String(str || '').replace(/\s+/g, ' ').trim();
  }

  function createTradeFetchEngine(dictionary, defaultLanguage = 'zh-CN') {
    const statsMap = new Map();
    const statsTemplateMap = new Map();
    const itemsMap = new Map();
    const uiMap = new Map();
    const reverseMap = new Map(); // 中文/别名 -> 英文原词

    function setReverse(zh, en) {
      if (!zh || !en) return;
      const key = normalizeText(zh);
      if (!reverseMap.has(key)) {
        reverseMap.set(key, en);
      } else {
        const existing = reverseMap.get(key);
        if (existing.endsWith('s') && !en.endsWith('s')) {
          reverseMap.set(key, en);
        } else if (en.length < existing.length && !en.endsWith('s')) {
          reverseMap.set(key, en);
        }
      }
    }

    // 预热并索引字典
    function warmIndexes() {
      if (!dictionary) return;

      // 1. 词缀模板索引
      for (const [english, entry] of Object.entries(dictionary.stats || {})) {
        const clean = normalizeText(english);
        statsMap.set(clean, entry);
        if (clean.includes('#')) {
          statsTemplateMap.set(clean, entry);
        }
        const zh = typeof entry === 'string' ? entry : (entry['zh-CN'] || entry.translation);
        if (zh) setReverse(zh, english);
      }

      for (const [english, entry] of Object.entries(dictionary.tooltip || {})) {
        const clean = normalizeText(english);
        if (!statsMap.has(clean)) statsMap.set(clean, entry);
        if (clean.includes('#') && !statsTemplateMap.has(clean)) {
          statsTemplateMap.set(clean, entry);
        }
      }

      // 2. 物品与基底索引
      for (const [english, entry] of Object.entries(dictionary.items || {})) {
        const clean = normalizeText(english);
        itemsMap.set(clean, entry);
        itemsMap.set(clean.toLowerCase(), entry);

        const zh = typeof entry === 'string' ? entry : (entry['zh-CN'] || entry.translation);
        const tw = typeof entry === 'string' ? entry : (entry['zh-TW'] || zh);
        if (zh) {
          setReverse(zh, english);
          setReverse(zh.toLowerCase(), english);
        }
        if (tw) {
          setReverse(tw, english);
          setReverse(tw.toLowerCase(), english);
        }
      }

      for (const [english, entry] of Object.entries(dictionary.terms || {})) {
        const clean = normalizeText(english);
        const zh = typeof entry === 'string' ? entry : (Array.isArray(entry) ? entry[0] : (entry.translation || entry['zh-CN']));
        const tw = typeof entry === 'string' ? entry : (Array.isArray(entry) ? (entry[1] || entry[0]) : (entry['zh-TW'] || zh));
        if (!itemsMap.has(clean)) {
          itemsMap.set(clean, { 'zh-CN': zh, 'zh-TW': tw, en: english });
          itemsMap.set(clean.toLowerCase(), { 'zh-CN': zh, 'zh-TW': tw, en: english });
        }
        if (zh) {
          setReverse(zh, english);
          setReverse(zh.toLowerCase(), english);
        }
        if (tw) {
          setReverse(tw, english);
          setReverse(tw.toLowerCase(), english);
        }
      }

      // 3. UI 标签索引
      for (const [english, entry] of Object.entries(dictionary.ui || {})) {
        const clean = normalizeText(english);
        uiMap.set(clean, entry);
        uiMap.set(clean.toLowerCase(), entry);
        const zh = typeof entry === 'string' ? entry : (entry['zh-CN'] || entry.translation);
        if (zh) setReverse(zh, english);
      }
    }

    warmIndexes();

    function getEntryTranslation(entry, language) {
      if (!entry) return null;
      if (typeof entry === 'string') return entry;
      if (Array.isArray(entry)) return language === 'zh-TW' ? (entry[1] || entry[0]) : entry[0];
      if (language === 'zh-TW') return entry['zh-TW'] || entry['zh-CN'] || entry.translation || entry.en;
      return entry['zh-CN'] || entry.translation || entry.en;
    }

    function translateItemName(name, language) {
      if (!name || language === 'en') return name;
      const clean = normalizeText(name);
      const entry = itemsMap.get(clean) || itemsMap.get(clean.toLowerCase());
      return getEntryTranslation(entry, language) || name;
    }

    function translateModLine(modLine, language) {
      if (!modLine || language === 'en') return modLine;
      const raw = String(modLine).trim();
      const clean = normalizeText(raw);

      // 1. 精确完全匹配
      const directEntry = statsMap.get(clean);
      if (directEntry) {
        return getEntryTranslation(directEntry, language) || raw;
      }

      // 2. 数值通配符 hash 匹配
      // 提取数值
      const numbers = [];
      const hashPattern = clean.replace(/([+-]?\d+(?:\.\d+)?%?)/g, (match) => {
        numbers.push(match);
        const sign = match.startsWith('+') || match.startsWith('-') ? match[0] : '';
        const pct = match.endsWith('%') ? '%' : '';
        return `${sign}#${pct}`;
      });

      const templateEntry = statsMap.get(hashPattern) || statsTemplateMap.get(hashPattern);
      if (templateEntry) {
        const transTemplate = getEntryTranslation(templateEntry, language);
        if (transTemplate && transTemplate.includes('#')) {
          let numIdx = 0;
          return transTemplate.replace(/([+-]?)#(%?)/g, (match, sign, pct) => {
            let val = String(numbers[numIdx++] ?? '#');
            if (sign && !val.startsWith('+') && !val.startsWith('-')) {
              val = `${sign}${val}`;
            }
            if (pct && !val.endsWith('%')) {
              val = `${val}%`;
            }
            return val;
          });
        }
      }

      // 3. 纯 hash 备用匹配 (无符号)
      const pureHash = clean.replace(/[+-]?\d+(?:\.\d+)?%?/g, '#');
      const pureEntry = statsMap.get(pureHash) || statsTemplateMap.get(pureHash);
      if (pureEntry) {
        const transTemplate = getEntryTranslation(pureEntry, language);
        if (transTemplate && transTemplate.includes('#')) {
          let numIdx = 0;
          return transTemplate.replace(/([+-]?)#(%?)/g, (match, sign, pct) => {
            let val = String(numbers[numIdx++] ?? '#');
            if (sign && !val.startsWith('+') && !val.startsWith('-')) {
              val = `${sign}${val}`;
            }
            if (pct && !val.endsWith('%')) {
              val = `${val}%`;
            }
            return val;
          });
        }
      }

      // 4. 单项词条名词 fallback
      const nounEntry = itemsMap.get(clean) || itemsMap.get(clean.toLowerCase());
      if (nounEntry) {
        return getEntryTranslation(nounEntry, language) || raw;
      }

      return raw;
    }

    function translatePropertyList(props, language) {
      if (!Array.isArray(props) || language === 'en') return props;
      return props.map((prop) => {
        if (!prop || !prop.name) return prop;
        const cleanName = normalizeText(prop.name);
        const entry = uiMap.get(cleanName) || uiMap.get(cleanName.toLowerCase()) || itemsMap.get(cleanName);
        const transName = getEntryTranslation(entry, language);
        return transName ? { ...prop, name: transName } : prop;
      });
    }

    function translateModItem(mod, language) {
      if (!mod || language === 'en') return mod;
      const isObj = typeof mod === 'object';
      const rawText = isObj ? (mod.description || mod.text || '') : String(mod || '');
      if (!rawText || !rawText.trim()) return mod;

      const transText = translateModLine(rawText, language);
      if (!transText || transText === rawText) return mod;

      if (isObj) {
        return {
          ...mod,
          description: transText,
          text: transText,
        };
      }
      return transText;
    }

    function translateModList(list, language) {
      if (!Array.isArray(list) || language === 'en') return list;
      return list.map((m) => translateModItem(m, language));
    }

    function transformItem(item, language = 'zh-CN') {
      if (!item || typeof item !== 'object' || language === 'en') return item;

      // 保留原始英文数据以便安全回溯
      if (!item._rawEnglish) {
        item._rawEnglish = {
          name: item.name,
          typeLine: item.typeLine,
          baseType: item.baseType,
          explicitMods: item.explicitMods ? JSON.parse(JSON.stringify(item.explicitMods)) : undefined,
          implicitMods: item.implicitMods ? JSON.parse(JSON.stringify(item.implicitMods)) : undefined,
          enchantMods: item.enchantMods ? JSON.parse(JSON.stringify(item.enchantMods)) : undefined,
          craftedMods: item.craftedMods ? JSON.parse(JSON.stringify(item.craftedMods)) : undefined,
          fracturedMods: item.fracturedMods ? JSON.parse(JSON.stringify(item.fracturedMods)) : undefined,
          runeMods: item.runeMods ? JSON.parse(JSON.stringify(item.runeMods)) : undefined,
        };
      }

      // 翻译物品名与基底
      if (item.name) item.name = translateItemName(item.name, language);
      if (item.typeLine) item.typeLine = translateItemName(item.typeLine, language);
      if (item.baseType) item.baseType = translateItemName(item.baseType, language);

      // 翻译各类词缀数组（深度兼容对象与字符串）
      const modKeys = [
        'explicitMods', 'implicitMods', 'enchantMods', 'runeMods',
        'craftedMods', 'fracturedMods', 'utilityMods', 'desecratedMods', 'corruptedMods'
      ];
      for (const key of modKeys) {
        if (Array.isArray(item[key])) {
          item[key] = translateModList(item[key], language);
        }
      }

      // 翻译技能赋予
      if (Array.isArray(item.grantedSkills)) {
        item.grantedSkills = item.grantedSkills.map((skill) => {
          if (!skill) return skill;
          let transSkillName = skill.name;
          if (skill.name && typeof skill.name === 'string') {
            transSkillName = translateItemName(skill.name, language);
          }
          return {
            ...skill,
            name: transSkillName || skill.name,
          };
        });
      }

      // 翻译属性与需求
      if (Array.isArray(item.properties)) {
        item.properties = translatePropertyList(item.properties, language);
      }
      if (Array.isArray(item.requirements)) {
        item.requirements = translatePropertyList(item.requirements, language);
      }
      if (Array.isArray(item.additionalProperties)) {
        item.additionalProperties = translatePropertyList(item.additionalProperties, language);
      }

      return item;
    }

    function transformFetchResponse(json, language = 'zh-CN') {
      if (!json || !Array.isArray(json.result) || language === 'en') return json;
      for (const entry of json.result) {
        if (entry && entry.item) {
          transformItem(entry.item, language);
        }
      }
      return json;
    }

    function restoreEnglishText(text) {
      if (!text || typeof text !== 'string') return text;
      const clean = normalizeText(text);

      // 1. 如果包含括号 "(English)" 或 "（English）"
      const bracketMatch = clean.match(/[\(（]([^\)）]+)[\)）]$/);
      if (bracketMatch && bracketMatch[1]) {
        return bracketMatch[1].trim();
      }

      // 2. 通过 reverseMap 反查
      const direct = reverseMap.get(clean) || reverseMap.get(clean.toLowerCase());
      if (direct) return direct;

      // 3. 尝试匹配部分中文前缀
      for (const [zh, en] of reverseMap.entries()) {
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

    return Object.freeze({
      translateItemName,
      translateModLine,
      transformItem,
      transformFetchResponse,
      restoreEnglishText,
      restoreSearchQueryJson,
    });
  }

  const TradeFetchEngine = Object.freeze({
    createTradeFetchEngine,
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TradeFetchEngine;
  } else {
    root.PoeNinjaTradeFetchEngine = TradeFetchEngine;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
