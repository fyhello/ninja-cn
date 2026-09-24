(function attachLanguageUtils(root) {
  'use strict';

  function normalizeLanguageKey(lang) {
    if (!lang) return 'zh-CN';
    const l = String(lang).toLowerCase();
    if (l.includes('tw') || l.includes('hant') || l.includes('traditional')) return 'zh-TW';
    if (l.includes('en') || l.includes('english')) return 'en';
    return 'zh-CN';
  }

  const POE2_TW_SPECIAL_TERMS = {
    '法师之血': '魔血',
    '电球': '電球',
    '珠宝': '珠寶',
    '项链': '項鍊',
    '靴子': '鞋子',
    '单手锤': '單手槌',
    '双手锤': '雙手槌',
    '升华': '昇華',
    '天赋': '天賦',
    '辅助': '輔助',
    '通货': '通貨',
    '崇高石': '崇高石',
    '混沌石': '混沌石',
    '神圣石': '神聖石',
    '卡兰德的魔镜': '卡蘭德的魔鏡',
  };

  function toTraditional(text) {
    if (!text || typeof text !== 'string') return text;
    let result = text;
    for (const [cn, tw] of Object.entries(POE2_TW_SPECIAL_TERMS)) {
      if (result.includes(cn)) {
        result = result.replaceAll(cn, tw);
      }
    }
    return result;
  }

  const LanguageUtils = Object.freeze({
    normalizeLanguageKey,
    toTraditional,
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = LanguageUtils;
  } else {
    root.PoeNinjaLanguageUtils = LanguageUtils;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
