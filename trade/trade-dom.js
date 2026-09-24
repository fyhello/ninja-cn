(function attachTradeDom(root) {
  'use strict';

  let dictionary = null;
  let currentLanguage = 'zh-CN';
  const originalTextMap = new WeakMap();
  const lastAppliedMap = new WeakMap();

  function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function translateTradeDynamicLine(text, core) {
    if (!text) return null;
    const isTw = currentLanguage === 'zh-TW';

    // 1. 搜索结果匹配行: SHOWING 100 RESULTS (10000+ MATCHED) / Showing 100 results (10000+ matched)
    const showMatch = text.match(/SHOWING\s+(\d+)\s+RESULTS?\s*\(([^)]+)\s+MATCHED\)/i);
    if (showMatch) {
      const count = showMatch[1];
      const matched = showMatch[2];
      return isTw ? `顯示 ${count} 筆結果 (共匹配 ${matched})` : `显示 ${count} 条结果 (共匹配 ${matched})`;
    }

    // 2. 上架时间: listed 4 hours ago / listed a minute ago
    const listedMatch = text.match(/listed\s+(a|\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
    if (listedMatch) {
      let num = listedMatch[1].toLowerCase() === 'a' ? '1' : listedMatch[1];
      const unitMap = {
        second: '秒',
        minute: isTw ? '分鐘' : '分钟',
        hour: isTw ? '小時' : '小时',
        day: '天',
        week: '周',
        month: isTw ? '個月' : '个月',
        year: '年',
      };
      const unit = unitMap[listedMatch[2].toLowerCase()] || listedMatch[2];
      return `${num} ${unit}前上架`;
    }

    // 3. 一口价标价: -B/O 1 TRANSMUTE / ~b/o 1 chaos / ~price 50 divine
    const boMatch = text.match(/^[-~]?(b\/o|price)\s+(\d+(?:\.\d+)?)\s+(.+)$/i);
    if (boMatch) {
      const type = boMatch[1].toLowerCase() === 'price' ? (isTw ? '標價' : '标价') : (isTw ? '一口價' : '一口价');
      const amount = boMatch[2];
      const curr = boMatch[3].trim();
      const transCurr = (core && typeof core.translateWholeLine === 'function' ? core.translateWholeLine(curr, dictionary, currentLanguage) : null) ||
        (dictionary?.terms?.[curr]?.[isTw ? 'zh-TW' : 'zh-CN']) ||
        (dictionary?.items?.[curr]?.[isTw ? 'zh-TW' : 'zh-CN']) ||
        curr;
      return `${type} ${amount} ${transCurr}`;
    }

    return null;
  }

  function translateNode(node, core) {
    if (!node || node.nodeType !== 3 || !dictionary || currentLanguage === 'en') return;
    const parent = node.parentElement;
    if (!parent) return;

    // 跳过不需要处理的标签与属性
    const tag = parent.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA' || tag === 'INPUT') return;
    if (parent.closest?.('[translate="no"], .notranslate, input, textarea')) return;

    const raw = node.nodeValue;
    if (!raw || !raw.trim()) return;

    // 如果文本节点已包含中文且不含动态英文模板，直接 0ms 跳过
    if (/[\u4e00-\u9fa5]/.test(raw) && !/SHOWING|listed|-B\/O|~b\/o|~price|STAT/i.test(raw)) return;

    let source = originalTextMap.get(node);
    if (!source || lastAppliedMap.get(node) !== raw) {
      source = raw;
      originalTextMap.set(node, source);
    }

    const cleanSource = normalizeText(source);
    if (!cleanSource) return;

    let translated = translateTradeDynamicLine(cleanSource, core);
    if (!translated && core && typeof core.translateWholeLine === 'function') {
      translated = core.translateWholeLine(cleanSource, dictionary, currentLanguage);
    }

    if (!translated || translated === cleanSource) {
      if (core && typeof core.translateInlineText === 'function') {
        translated = core.translateInlineText(cleanSource, dictionary, currentLanguage);
      }
    }

    if (translated && translated !== cleanSource) {
      // 保留原有空格排版
      const leadingSpace = raw.match(/^\s*/)[0];
      const trailingSpace = raw.match(/\s*$/)[0];
      const finalVal = `${leadingSpace}${translated}${trailingSpace}`;
      if (node.nodeValue !== finalVal) {
        node.nodeValue = finalVal;
        lastAppliedMap.set(node, finalVal);
      }
    }
  }

  function translateDomTree(rootElement, core) {
    if (!rootElement) return;

    if (!dictionary || currentLanguage === 'en') return;
    if (rootElement.nodeType === 1 && (rootElement.tagName === 'INPUT' || rootElement.tagName === 'TEXTAREA')) return;

    const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      translateNode(node, core);
    }

    // 翻译 input / button 的 placeholder 和 title 属性
    const elementsWithAttr = rootElement.querySelectorAll?.('[placeholder], [title]');
    if (elementsWithAttr) {
      for (const el of elementsWithAttr) {
        if (el.closest?.('.multiselect')) continue;
        if (el.hasAttribute('placeholder')) {
          const ph = el.getAttribute('placeholder');
          if (ph && core) {
            const transPh = core.translateWholeLine(ph.trim(), dictionary, currentLanguage);
            if (transPh && transPh !== ph.trim()) el.setAttribute('placeholder', transPh);
          }
        }
      }
    }
  }

  let isTyping = false;
  let typingTimer = null;

  if (typeof window !== 'undefined') {
    window.addEventListener('input', () => {
      isTyping = true;
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => { isTyping = false; }, 300);
    }, { capture: true, passive: true });

    window.addEventListener('compositionstart', () => { isTyping = true; }, { capture: true, passive: true });
    window.addEventListener('compositionend', () => {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => { isTyping = false; }, 300);
    }, { capture: true, passive: true });
  }

  function initTradeDomScanner(loadedDictionary, language, core) {
    dictionary = loadedDictionary;
    currentLanguage = language || 'zh-CN';
    if (!core && window.PoeNinjaTranslationCore) core = window.PoeNinjaTranslationCore;

    // 1. 初次全量扫描与多阶段补偿扫描
    function scheduleFullScan() {
      if (document.body && dictionary && currentLanguage !== 'en') {
        translateDomTree(document.body, core);
      }
    }

    scheduleFullScan();
    if (typeof window !== 'undefined') {
      if (document.readyState !== 'complete') {
        window.addEventListener('DOMContentLoaded', scheduleFullScan, { once: true });
        window.addEventListener('load', scheduleFullScan, { once: true });
      }
      setTimeout(scheduleFullScan, 200);
      setTimeout(scheduleFullScan, 600);
      setTimeout(scheduleFullScan, 1500);
    }

    // 2. 启动 MutationObserver 监听动态插入的 DOM (增加 RAF 与批处理防抖)
    let pendingNodes = new Set();
    let rafScheduled = false;

    function flushMutations() {
      rafScheduled = false;
      if (isTyping || currentLanguage === 'en' || !dictionary) return;
      const nodes = Array.from(pendingNodes);
      pendingNodes.clear();
      for (const node of nodes) {
        if (!node.isConnected) continue;
        if (node.nodeType === 1) {
          translateDomTree(node, core);
        } else if (node.nodeType === 3) {
          translateNode(node, core);
        }
      }
    }

    const observer = new MutationObserver((mutations) => {
      if (isTyping || currentLanguage === 'en' || !dictionary) return;
      for (const mutation of mutations) {
        if (mutation.target?.closest?.('.multiselect, .multiselect__content, .multiselect__content-wrapper, input, textarea')) continue;
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.closest?.('.multiselect, .multiselect__content, .multiselect__content-wrapper, input, textarea')) continue;
            pendingNodes.add(node);
          }
        } else if (mutation.type === 'characterData') {
          pendingNodes.add(mutation.target);
        }
      }
      if (pendingNodes.size > 0 && !rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(flushMutations);
      }
    });

    if (document.documentElement) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    return observer;
  }

  function updateLanguage(newLang, core) {
    currentLanguage = newLang || 'zh-CN';
    if (document.body && dictionary) {
      translateDomTree(document.body, core || window.PoeNinjaTranslationCore);
    }
  }

  const TradeDom = Object.freeze({
    initTradeDomScanner,
    updateLanguage,
    translateDomTree,
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TradeDom;
  } else {
    root.PoeNinjaTradeDom = TradeDom;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
