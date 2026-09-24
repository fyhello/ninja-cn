(function attachTradeSearchHelper(root) {
  'use strict';

  const STAT_CATEGORY_MAP = {
    explicit: { 'zh-CN': '显式词缀', 'zh-TW': '前綴/後綴' },
    implicit: { 'zh-CN': '隐式词缀', 'zh-TW': '固定詞綴' },
    enchant: { 'zh-CN': '附魔词缀', 'zh-TW': '附魔詞綴' },
    crafted: { 'zh-CN': '工艺词缀', 'zh-TW': '大師工藝' },
    fractured: { 'zh-CN': '分裂词缀', 'zh-TW': '分裂詞綴' },
    sanctified: { 'zh-CN': '圣化词缀', 'zh-TW': '聖化詞綴' },
    rune: { 'zh-CN': '符文词缀', 'zh-TW': '符文詞綴' },
    pseudo: { 'zh-CN': '综合统计', 'zh-TW': '綜合統計' },
    monster: { 'zh-CN': '怪物词缀', 'zh-TW': '怪物詞綴' },
  };

  const ITEM_CATEGORY_MAP = {
    accessory: { 'zh-CN': '饰品', 'zh-TW': '飾品' },
    armour: { 'zh-CN': '防具', 'zh-TW': '防具' },
    flask: { 'zh-CN': '药剂', 'zh-TW': '藥劑' },
    gem: { 'zh-CN': '技能宝石', 'zh-TW': '技能寶石' },
    jewel: { 'zh-CN': '珠宝', 'zh-TW': '珠寶' },
    map: { 'zh-CN': '地图', 'zh-TW': '地圖' },
    weapon: { 'zh-CN': '武器', 'zh-TW': '武器' },
    leaguestone: { 'zh-CN': '联盟石', 'zh-TW': '聯盟石' },
    currency: { 'zh-CN': '通货', 'zh-TW': '通貨' },
  };

  function createTradeSearchHelper(fetchEngine, dictionary) {
    function transformStatsMetadata(json, language = 'zh-CN') {
      if (!json || !Array.isArray(json.result) || language === 'en') return json;

      for (const group of json.result) {
        if (!group) continue;
        // 1. 分组标签中文化
        if (group.id && STAT_CATEGORY_MAP[group.id]) {
          const groupZh = STAT_CATEGORY_MAP[group.id][language] || STAT_CATEGORY_MAP[group.id]['zh-CN'];
          if (groupZh) group.label = groupZh;
        }

        // 2. 词缀列表双语注入
        if (Array.isArray(group.entries)) {
          for (const stat of group.entries) {
            if (!stat || !stat.text) continue;
            const originalText = stat.text;
            const trans = fetchEngine.translateModLine(originalText, language);
            if (trans && trans !== originalText) {
              stat._rawText = originalText;
              stat.text = trans; // 直接赋予纯中文，确保官方前端下拉框输入中文时100%精准过滤
            }

            // 支持词缀下拉选项 options 中文化
            if (stat.option && Array.isArray(stat.option.options)) {
              for (const opt of stat.option.options) {
                if (opt && opt.text) {
                  const optOrig = opt.text;
                  const optTrans = fetchEngine.translateItemName(optOrig, language) || fetchEngine.translateModLine(optOrig, language);
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

    function transformItemsMetadata(json, language = 'zh-CN') {
      if (!json || !Array.isArray(json.result) || language === 'en') return json;

      for (const group of json.result) {
        if (!group) continue;
        if (group.id && ITEM_CATEGORY_MAP[group.id]) {
          const groupZh = ITEM_CATEGORY_MAP[group.id][language] || ITEM_CATEGORY_MAP[group.id]['zh-CN'];
          if (groupZh) group.label = groupZh;
        }

        if (Array.isArray(group.entries)) {
          for (const item of group.entries) {
            if (!item) continue;
            const origName = item.name;
            const origType = item.type;
            const origText = item.text;

            const transName = origName ? fetchEngine.translateItemName(origName, language) : '';
            const transType = origType ? fetchEngine.translateItemName(origType, language) : '';

            item._rawEnglish = { name: origName, type: origType, text: origText };

            if (transName && transName !== origName) {
              item.name = transName;
            }
            if (transType && transType !== origType) {
              item.type = transType;
            }
            if (transName || transType) {
              const zhPart = [transName, transType].filter(Boolean).join(' ');
              item.text = `${zhPart} ${origText || ''}`.trim();
            }
          }
        }
      }
      return json;
    }

    function transformStaticMetadata(json, language = 'zh-CN') {
      if (!json || !Array.isArray(json.result) || language === 'en') return json;

      for (const group of json.result) {
        if (!group || !Array.isArray(group.entries)) continue;
        for (const item of group.entries) {
          if (!item || !item.text) continue;
          const origText = item.text;
          const trans = fetchEngine.translateItemName(origText, language);
          if (trans && trans !== origText) {
            item._rawText = origText;
            item.text = `${trans} (${origText})`;
          }
        }
      }
      return json;
    }

    return Object.freeze({
      transformStatsMetadata,
      transformItemsMetadata,
      transformStaticMetadata,
    });
  }

  const TradeSearchHelper = Object.freeze({
    createTradeSearchHelper,
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TradeSearchHelper;
  } else {
    root.PoeNinjaTradeSearchHelper = TradeSearchHelper;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
