(function startContentTranslation() {
  'use strict';

  const core = globalThis.PoeNinjaTranslationCore;
  if (!core) {
    console.error('[POE Ninja translation] translation core did not load');
    return;
  }

  const originalText = new WeakMap();
  const lastAppliedText = new WeakMap();
  const attributeState = new WeakMap();
  const tooltipSourceStates = new WeakMap();
  const tooltipApplication = new WeakMap();
  const pageRowSourceStates = new WeakMap();
  const pageRowApplication = new WeakMap();
  const translatedAttributes = ['title', 'aria-label', 'data-bs-title'];
  const tooltipRootSelector = '[data-tooltip-content="true"], [data-tippy-root], .tippy-box, [role="tooltip"], .item-popup, .item-popup--poe2, .newItemPopup';
  const tooltipBlockTags = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET',
    'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER',
    'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'UL',
  ]);
  let currentGame = null;
  let dictionary = null;
  let language = 'en';
  let fullScanTimer = null;
  let translationFrame = null;
  let documentObserver = null;
  const pendingTranslationRoots = new Set();
  const lookupLinks = new WeakMap();
  const translationMetrics = window.__POE_NINJA_TRANSLATION_METRICS__ ?? {
    fullScans: 0,
    mutationBatches: 0,
    processedRoots: 0,
    deduplicatedRoots: 0,
    tooltipRows: 0,
    lastFullScanMs: 0,
    lastMutationBatchMs: 0,
  };
  if (!window.__POE_NINJA_TRANSLATION_METRICS__) {
    Object.defineProperty(window, '__POE_NINJA_TRANSLATION_METRICS__', {
      configurable: true,
      value: translationMetrics,
    });
  }
  const dictionaryLoader = core.createDictionaryLoader(async (game, requestedLanguage) => {
    const result = await request({ type: 'GET_DICTIONARY', game, language: requestedLanguage });
    if (!result?.ok) throw new Error(result?.error ?? 'Dictionary request failed');
    return result.dictionary;
  });

  function gameForLocation() {
    return 'poe2';
  }

  async function request(message) {
    return chrome.runtime.sendMessage(message);
  }

  async function loadDictionaryForCurrentRoute() {
    const wantedGame = gameForLocation();
    const loadedDictionary = await dictionaryLoader.get(wantedGame, language);
    if (wantedGame !== gameForLocation()) return loadDictionaryForCurrentRoute();
    currentGame = wantedGame;
    dictionary = loadedDictionary;
    return dictionary;
  }

  function sourceForTextNode(node) {
    const priorSource = originalText.get(node);
    if (priorSource === undefined || lastAppliedText.get(node) !== node.nodeValue) {
      originalText.set(node, node.nodeValue);
    }
    return originalText.get(node);
  }

  function isFavDrawerElement(element) {
    if (!element) return false;
    if (element.nodeType === Node.TEXT_NODE) element = element.parentElement;
    if (!element || !element.closest) return false;
    return Boolean(element.closest?.('[data-poe-ninja-translation-root], [translate="no"], .notranslate, .poe-ninja-fav-drawer, .poe-ninja-fav-trigger, .poe-ninja-fav-overlay, .poe-ninja-detail-fav-btn'));
  }

  function isInsideTranslatedRow(element) {
    if (isFavDrawerElement(element)) return true;
    if (element?.closest?.('select, option, [role="listbox"], [role="option"], [class*="menu" i], [class*="dropdown" i], [class*="popover" i], [class*="select" i]')) {
      return false;
    }
    for (let current = element; current; current = current.parentElement) {
      if (tooltipApplication.get(current)?.language === language && tooltipApplication.get(current)?.translated) return true;
      const pageApp = pageRowApplication.get(current);
      if (pageApp?.language === language && pageApp?.translated) return true;
    }
    return false;
  }

  function translateTextNode(node) {
    const parent = node.parentElement;
    if (!parent || core.shouldSkipElement(parent) || isFavDrawerElement(parent) || !node.nodeValue.trim()) return;
    if (parent.closest(tooltipRootSelector) || isInsideTranslatedRow(parent)) return;

    const source = sourceForTextNode(node);
    const wholeLineTranslation = core.translateWholeLine(source, dictionary, language);
    const translated = wholeLineTranslation !== source
      ? wholeLineTranslation
      : core.translateInlineText(source, dictionary, language);
    if (node.nodeValue !== translated) node.nodeValue = translated;
    lastAppliedText.set(node, translated);
  }

  function stateForAttribute(element) {
    let state = attributeState.get(element);
    if (!state) {
      state = { source: new Map(), lastApplied: new Map() };
      attributeState.set(element, state);
    }
    return state;
  }

  function translateAttribute(element, attribute) {
    if (!element.hasAttribute(attribute) || core.shouldSkipElement(element)) return;
    const state = stateForAttribute(element);
    const currentValue = element.getAttribute(attribute);
    if (!state.source.has(attribute) || state.lastApplied.get(attribute) !== currentValue) {
      state.source.set(attribute, currentValue);
    }

    const translated = core.translateInlineText(state.source.get(attribute), dictionary, language);
    if (currentValue !== translated) element.setAttribute(attribute, translated);
    state.lastApplied.set(attribute, translated);
  }

  function translateAttributes(root) {
    const selector = translatedAttributes.map((attribute) => `[${attribute}]`).join(',');
    const elements = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) elements.push(root);
    elements.push(...root.querySelectorAll(selector));
    for (const element of elements) {
      for (const attribute of translatedAttributes) translateAttribute(element, attribute);
    }
  }

  function sourceTextForElement(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const text = [];
    let node;
    while ((node = walker.nextNode())) {
      text.push(originalText.get(node) ?? node.nodeValue);
    }
    return text.join('').replace(/\s+/g, ' ').trim();
  }

  function captureElementSource(element) {
    const textNodes = [];
    const source = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const priorSource = originalText.get(node);
      const value = priorSource !== undefined && lastAppliedText.get(node) === node.nodeValue
        ? priorSource
        : node.nodeValue;
      originalText.set(node, value);
      textNodes.push({ node, value });
      source.push(value);
    }
    return { children: [...element.childNodes], textNodes, source: source.join('') };
  }

  function rememberRenderedElementSource(state) {
    for (const { node, value } of state.textNodes) {
      originalText.set(node, value);
      lastAppliedText.set(node, node.nodeValue);
    }
  }

  function looksTranslated(value) {
    return /[\u3400-\u9fff]/.test(value);
  }

  function tooltipRootsWithin(root) {
    const roots = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(tooltipRootSelector)) roots.push(root);
    roots.push(...root.querySelectorAll(tooltipRootSelector));
    return roots.filter((candidate, index) => !roots.some((other, otherIndex) => (
      index !== otherIndex && other.contains(candidate)
    )));
  }

  function captureTooltipSource(element) {
    return captureElementSource(element);
  }

  function sourceForTooltipRow(element) {
    let state = tooltipSourceStates.get(element);
    const application = tooltipApplication.get(element);
    if (!state) {
      state = captureTooltipSource(element);
      tooltipSourceStates.set(element, state);
      tooltipApplication.delete(element);
    } else if (application?.language !== language) {
      return state;
    } else if (application?.renderedText !== element.textContent) {
      const current = captureTooltipSource(element);
      state = looksTranslated(current.source) && state.source
        ? state
        : current;
      tooltipSourceStates.set(element, state);
      tooltipApplication.delete(element);
    }
    return state;
  }

  function restoreTooltipSource(element, state) {
    for (const { node, value } of state.textNodes) node.nodeValue = value;
    element.replaceChildren(...state.children);
  }

  function syncRenderedTextNodes(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      originalText.set(node, node.nodeValue);
      lastAppliedText.set(node, node.nodeValue);
    }
  }

  function isInteractiveOrModal(element) {
    if (!element || element.nodeType !== 1) return false;
    return Boolean(
      element.closest?.('dialog, [role="dialog"], [aria-modal="true"], form, button, [class*="modal" i], [class*="popup" i], [class*="drawer" i]')
    );
  }

  function applyTranslationInPlace(sourceState, translated) {
    const textNodes = sourceState?.textNodes;
    if (!textNodes || !textNodes.length) return false;
    if (textNodes.length === 1) {
      textNodes[0].node.nodeValue = translated;
      return true;
    }

    const lastNode = textNodes[textNodes.length - 1];
    const lastTrimmed = (lastNode.value || '').trim();
    const lastLower = lastTrimmed.toLowerCase();
    const isLastBadge = /^(?:local|pseudo|unmatched|\(local\)|\(pseudo\))$/.test(lastLower);
    const isLastPercentage = /^[\d.]+\s*%$/.test(lastTrimmed);

    if (isLastBadge && textNodes.length >= 2) {
      const badgeMap = {
        local: '本地',
        pseudo: '综合',
        unmatched: '未匹配',
        '(local)': '(本地)',
        '(pseudo)': '(综合)',
      };
      const badgeZh = badgeMap[lastLower] || lastTrimmed;
      const mainZh = translated.replace(/\s+(?:本地|综合|未匹配|\(本地\)|\(综合\))\s*$/, '').trim();
      textNodes[0].node.nodeValue = mainZh;
      for (let i = 1; i < textNodes.length - 1; i++) {
        textNodes[i].node.nodeValue = '';
      }
      lastNode.node.nodeValue = ` ${badgeZh}`;
      return true;
    }

    if (isLastPercentage && textNodes.length >= 2) {
      const mainZh = translated.replace(/\s*[\d.]+\s*%\s*$/, '').trim();
      textNodes[0].node.nodeValue = mainZh;
      for (let i = 1; i < textNodes.length - 1; i++) {
        textNodes[i].node.nodeValue = '';
      }
      lastNode.node.nodeValue = lastTrimmed;
      return true;
    }

    textNodes[0].node.nodeValue = translated;
    for (let i = 1; i < textNodes.length; i++) {
      textNodes[i].node.nodeValue = '';
    }
    return true;
  }

  function translateTooltipRow(element) {
    try {
      const application = tooltipApplication.get(element);
      if (application?.renderedText === element.textContent && application.language === language) return;

      const sourceState = sourceForTooltipRow(element);
      const source = sourceState.source;
      const translated = core.translateTooltipText(source, dictionary, language);
      let wasTranslated = false;
      if (translated !== source) {
        if (isInteractiveOrModal(element)) {
          wasTranslated = applyTranslationInPlace(sourceState, translated);
        } else {
          restoreTooltipSource(element, sourceState);
          wasTranslated = core.renderTooltipTranslation(element, source, translated, {
            preserveBlockChildren: /^H[1-6]$/.test(element.tagName),
            dictionary,
            language,
          });
        }
      }
      if (wasTranslated) {
        syncRenderedTextNodes(element);
      } else {
        rememberRenderedElementSource(sourceState);
      }
      tooltipApplication.set(element, { renderedText: element.textContent, language, translated: wasTranslated });
    } catch (e) {
      // 容错隔离：避免任何意外DOM操作干扰宿主React应用
    }
  }

  function translateTooltipRows(root) {
    injectTermStyles();
    for (const tooltipRoot of tooltipRootsWithin(root)) {
      const rows = core.selectTooltipRows(tooltipRoot, tooltipBlockTags);
      translationMetrics.tooltipRows += rows.length;
      for (const row of rows) {
        if (row.isConnected) translateTooltipRow(row);
      }
    }
  }

  function pageRowsWithin(root) {
    return core.selectPageRows(root, tooltipBlockTags).filter((candidate) => (
      !candidate.closest(tooltipRootSelector)
      && !candidate.closest('[data-poe-ninja-translation-root]')
      && candidate.textContent?.trim()
    ));
  }

  function capturePageRowSource(element) {
    return captureElementSource(element);
  }

  function sourceForPageRow(element) {
    let state = pageRowSourceStates.get(element);
    const application = pageRowApplication.get(element);
    if (!state) {
      state = capturePageRowSource(element);
      pageRowSourceStates.set(element, state);
      pageRowApplication.delete(element);
    } else if (application?.language !== language) {
      return state;
    } else if (application?.renderedText !== element.textContent) {
      const current = capturePageRowSource(element);
      state = looksTranslated(current.source) && state.source
        ? state
        : current;
      pageRowSourceStates.set(element, state);
      pageRowApplication.delete(element);
    }
    return state;
  }

  function translatePageRow(element) {
    try {
      const application = pageRowApplication.get(element);
      if (application?.renderedText === element.textContent && application.language === language) return;
      const sourceState = sourceForPageRow(element);
      const translated = core.translateTooltipText(sourceState.source, dictionary, language);
      let wasTranslated = false;
      if (translated !== sourceState.source) {
        wasTranslated = applyTranslationInPlace(sourceState, translated);
        if (!wasTranslated) {
          for (const { node, value } of sourceState.textNodes) node.nodeValue = value;
          element.replaceChildren(...sourceState.children);
          wasTranslated = core.renderTooltipTranslation(element, sourceState.source, translated, {
            preserveBlockChildren: /^H[1-6]$/.test(element.tagName),
            dictionary,
            language,
          });
        }
      }
      if (wasTranslated) {
        syncRenderedTextNodes(element);
      } else {
        rememberRenderedElementSource(sourceState);
      }
      pageRowApplication.set(element, { renderedText: element.textContent, language, translated: wasTranslated });
    } catch (e) {
      // 容错隔离：避免任何意外DOM操作干扰宿主React应用
    }
  }

  function translatePageRows(root) {
    if (isFavDrawerElement(root)) return;
    for (const pageRow of pageRowsWithin(root)) {
      if (pageRow.isConnected && !isFavDrawerElement(pageRow)) translatePageRow(pageRow);
    }
  }

  function ensureLookupStyle() {
    if (document.querySelector('[data-poe-ninja-translation-root="lookup-style"]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-poe-ninja-translation-root', 'lookup-style');
    style.textContent = [
      '.poe-ninja-translation-db-link {',
      ' margin-left: 4px; padding: 1px 4px; border: 1px solid #587c8d;',
      ' border-radius: 3px; color: inherit; font-size: 10px; line-height: 1.2;',
      ' text-decoration: none; opacity: .8;',
      '}',
      '.poe-ninja-translation-db-link:hover { opacity: 1; text-decoration: underline; }',
    ].join('');
    document.head?.append(style);
  }

  function addOfficialLookupLinks(root) {
    if (!dictionary?.items || isFavDrawerElement(root)) return;
    ensureLookupStyle();
    const anchors = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches('a')) anchors.push(root);
    anchors.push(...root.querySelectorAll('a'));

    for (const anchor of anchors) {
      if (core.shouldSkipElement(anchor) || isFavDrawerElement(anchor)) continue;
      if (anchor.closest?.('dialog, [role="dialog"], [aria-modal="true"], button, input, form, [class*="modal" i], [class*="dialog" i]')) continue;
      const english = sourceTextForElement(anchor);
      const lookup = core.resolveOfficialLookup(dictionary.items, currentGame, language, english);
      let link = lookupLinks.get(anchor);

      if (!lookup) {
        if (link) {
          link.remove();
          lookupLinks.delete(anchor);
        }
        continue;
      }

      if (!link || !link.isConnected) {
        link = document.createElement('a');
        link.className = 'poe-ninja-translation-db-link';
        link.setAttribute('data-poe-ninja-translation-root', 'official-link');
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = 'POEDB';
        link.textContent = 'DB';
        anchor.insertAdjacentElement('afterend', link);
        lookupLinks.set(anchor, link);
      }
      link.href = lookup.href;
    }
  }

  function translateSelectOptions(root) {
    if (!root || !dictionary) return;
    const selects = [];
    if (root.nodeType === Node.ELEMENT_NODE && root.matches?.('select')) selects.push(root);
    if (root.querySelectorAll) selects.push(...root.querySelectorAll('select'));
    for (const select of selects) {
      if (core.shouldSkipElement(select) || isFavDrawerElement(select)) continue;
      for (const opt of select.options || []) {
        if (!opt.text) continue;
        const whole = core.translateWholeLine(opt.text, dictionary, language);
        if (whole !== opt.text) opt.text = whole;
      }
    }
  }

  function translateTree(root) {
    if (!root || !dictionary || isFavDrawerElement(root)) return;
    translateTooltipRows(root);
    translatePageRows(root);
    translateSelectOptions(root);
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    for (const textNode of nodes) translateTextNode(textNode);
    translateAttributes(root);
    addOfficialLookupLinks(root);
  }

  function observerOptions() {
    return {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: translatedAttributes,
    };
  }

  function resumeDocumentObserver() {
    documentObserver?.observe(document.documentElement, observerOptions());
  }

  function translateWhileObserverPaused(roots) {
    if (documentObserver) documentObserver.disconnect();
    try {
      for (const root of roots) translateTree(root);
    } finally {
      resumeDocumentObserver();
    }
  }

  async function scanPage() {
    const startedAt = performance.now();
    try {
      await loadDictionaryForCurrentRoute();
      pendingTranslationRoots.clear();
      if (translationFrame !== null) {
        window.cancelAnimationFrame(translationFrame);
        translationFrame = null;
      }
      translateWhileObserverPaused([document.body]);
      translationMetrics.fullScans += 1;
    } catch (error) {
      console.error('[POE Ninja translation] could not apply dictionary', error);
    } finally {
      translationMetrics.lastFullScanMs = performance.now() - startedAt;
    }
  }

  function scheduleFullScan() {
    window.clearTimeout(fullScanTimer);
    fullScanTimer = window.setTimeout(scanPage, 40);
  }

  function translationRootFor(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!element || core.shouldSkipElement(element)) return null;
    if (element.closest('[data-poe-ninja-translation-root], .poe-ninja-stat-term, #poe-ninja-term-tooltip, #poe-ninja-bilingual-search-dropdown')) return null;
    return element.closest(tooltipRootSelector)
      ?? core.findPageRow(element, tooltipBlockTags)
      ?? element;
  }

  function queueTranslationRoot(node) {
    const root = translationRootFor(node);
    if (!root) return;

    for (const pending of pendingTranslationRoots) {
      if (pending.contains(root)) {
        translationMetrics.deduplicatedRoots += 1;
        return;
      }
      if (root.contains(pending)) {
        pendingTranslationRoots.delete(pending);
        translationMetrics.deduplicatedRoots += 1;
      }
    }
    pendingTranslationRoots.add(root);
    if (translationFrame === null) {
      translationFrame = window.requestAnimationFrame(flushPendingTranslations);
    }
  }

  function flushPendingTranslations() {
    const startedAt = performance.now();
    translationFrame = null;
    if (!dictionary || currentGame !== gameForLocation()) {
      scheduleFullScan();
      return;
    }

    const roots = [...pendingTranslationRoots]
      .filter((root) => root.isConnected && !root.closest('[data-poe-ninja-translation-root]'));
    pendingTranslationRoots.clear();
    if (roots.length) {
      translateWhileObserverPaused(roots);
      translationMetrics.processedRoots += roots.length;
    }
    translationMetrics.mutationBatches += 1;
    translationMetrics.lastMutationBatchMs = performance.now() - startedAt;
  }

  function processMutationRecords(records) {
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of record.addedNodes) queueTranslationRoot(node);
      } else {
        queueTranslationRoot(record.target);
      }
    }
  }

  function injectTermStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('poe-ninja-term-styles')) return;
    const target = document.head || document.documentElement;
    if (!target) return;
    const style = document.createElement('style');
    style.id = 'poe-ninja-term-styles';
    style.textContent = `
      .poe-ninja-stat-term {
        border-bottom: 1px dashed rgba(255, 255, 255, 0.7) !important;
        text-decoration: underline dotted rgba(255, 255, 255, 0.7) !important;
        text-underline-offset: 3px !important;
        cursor: help !important;
        display: inline !important;
      }
      .poe-ninja-stat-term:hover {
        border-bottom-color: #f59e0b !important;
        text-decoration-color: #f59e0b !important;
        color: #fbbf24 !important;
      }
    `;
    target.appendChild(style);
  }

  function setupTermTooltipHandler() {
    if (typeof document === 'undefined') return;
    let tooltipEl = null;

    function getOrCreateTooltip() {
      if (tooltipEl && tooltipEl.isConnected) return tooltipEl;
      tooltipEl = document.createElement('div');
      tooltipEl.id = 'poe-ninja-term-tooltip';
      tooltipEl.style.cssText = [
        'position: fixed',
        'z-index: 2147483647',
        'background: #0f141c',
        'border: 1px solid #9a7b38',
        'box-shadow: 0 6px 24px rgba(0, 0, 0, 0.95)',
        'color: #e5e7eb',
        'padding: 10px 14px',
        'border-radius: 6px',
        'font-size: 13px',
        'line-height: 1.5',
        'max-width: 340px',
        'pointer-events: none',
        'display: none',
        'transition: opacity 0.15s ease',
        'opacity: 0',
      ].join(';');
      (document.body || document.documentElement).appendChild(tooltipEl);
      return tooltipEl;
    }

    function showTooltip(target) {
      const name = target.getAttribute('data-term-name');
      const desc = target.getAttribute('data-term-desc');
      if (!desc) return;
      const el = getOrCreateTooltip();
      while (el.firstChild) el.removeChild(el.firstChild);
      if (name) {
        const titleEl = document.createElement('div');
        titleEl.style.cssText = 'color: #f59e0b; font-weight: bold; margin-bottom: 4px; font-size: 14px;';
        titleEl.textContent = name;
        el.appendChild(titleEl);
      }
      const descEl = document.createElement('div');
      descEl.style.cssText = 'color: #d1d5db;';
      descEl.textContent = desc;
      el.appendChild(descEl);

      el.style.display = 'block';
      el.style.opacity = '1';
      positionTooltip(el, target);
    }

    function hideTooltip() {
      if (tooltipEl) {
        tooltipEl.style.opacity = '0';
        tooltipEl.style.display = 'none';
      }
    }

    function positionTooltip(el, target) {
      const rect = target.getBoundingClientRect();
      let left = rect.left;
      let top = rect.bottom + 8;
      const tooltipRect = el.getBoundingClientRect();
      if (left + tooltipRect.width > window.innerWidth - 10) {
        left = window.innerWidth - tooltipRect.width - 10;
      }
      if (top + tooltipRect.height > window.innerHeight - 10) {
        top = rect.top - tooltipRect.height - 8;
      }
      if (left < 10) left = 10;
      if (top < 10) top = 10;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    }

    document.addEventListener('mouseover', (e) => {
      const termTarget = e.target?.closest?.('.poe-ninja-stat-term, [data-term-desc]');
      if (termTarget) {
        showTooltip(termTarget);
      }
    }, true);

    document.addEventListener('mouseout', (e) => {
      const termTarget = e.target?.closest?.('.poe-ninja-stat-term, [data-term-desc]');
      if (termTarget) {
        if (e.relatedTarget && termTarget.contains(e.relatedTarget)) return;
        hideTooltip();
      }
    }, true);
  }

  function setupBilingualSearchHandler() {
    if (typeof document === 'undefined') return;
    let dropdownEl = null;
    let currentInput = null;
    let searchResults = [];
    let activeIndex = -1;

    function getOrCreateDropdown() {
      if (dropdownEl && dropdownEl.isConnected) return dropdownEl;
      dropdownEl = document.createElement('div');
      dropdownEl.id = 'poe-ninja-bilingual-search-dropdown';
      dropdownEl.style.cssText = [
        'position: fixed',
        'z-index: 2147483646',
        'background: #0e141e',
        'border: 1px solid #7c6237',
        'box-shadow: 0 8px 30px rgba(0, 0, 0, 0.95)',
        'border-radius: 6px',
        'max-height: 320px',
        'overflow-y: auto',
        'display: none',
        'font-family: inherit',
        'font-size: 13px',
        'min-width: 240px',
        'max-width: 380px',
      ].join(';');
      (document.body || document.documentElement).appendChild(dropdownEl);
      return dropdownEl;
    }

    function positionDropdown(input) {
      const rect = input.getBoundingClientRect();
      const el = getOrCreateDropdown();
      let left = rect.left;
      let top = rect.bottom + 4;
      const width = Math.max(rect.width, 240);
      if (left + width > window.innerWidth - 10) {
        left = window.innerWidth - width - 10;
      }
      if (left < 10) left = 10;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.width = `${width}px`;
    }

    function hideDropdown() {
      if (dropdownEl) {
        dropdownEl.style.display = 'none';
      }
      searchResults = [];
      activeIndex = -1;
      currentInput = null;
    }

    let isApplyingSelection = false;

    function applySearchSelection(input, item) {
      if (!input || !item || isApplyingSelection) return;
      isApplyingSelection = true;
      try {
        const englishValue = item.english;
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(input, englishValue);
        } else {
          input.value = englishValue;
        }
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      } finally {
        hideDropdown();
        window.setTimeout(() => {
          isApplyingSelection = false;
        }, 50);
      }
    }

    function renderResults(input, results) {
      const el = getOrCreateDropdown();
      while (el.firstChild) el.removeChild(el.firstChild);
      searchResults = results;
      activeIndex = results.length > 0 ? 0 : -1;

      if (!results.length) {
        hideDropdown();
        return;
      }

      const categoryLabels = {
        item: { label: '装备/物品', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
        gem: { label: '技能/宝石', color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.15)' },
        passive: { label: '天赋', color: '#c084fc', bg: 'rgba(192, 132, 252, 0.15)' },
        term: { label: '机制/词缀', color: '#34d399', bg: 'rgba(52, 211, 153, 0.15)' },
      };

      results.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'poe-ninja-search-item';
        row.style.cssText = [
          'padding: 8px 12px',
          'cursor: pointer',
          'display: flex',
          'align-items: center',
          'justify-content: space-between',
          'border-bottom: 1px solid rgba(255, 255, 255, 0.06)',
          'color: #e5e7eb',
          index === activeIndex ? 'background: #1e293b; color: #f59e0b;' : '',
        ].filter(Boolean).join(';');

        const nameWrapper = document.createElement('div');
        nameWrapper.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; margin-right: 8px;';

        const mainName = document.createElement('span');
        mainName.style.cssText = 'font-weight: 500; color: #f3f4f6; margin-right: 6px;';
        mainName.textContent = item.chinese;

        const subName = document.createElement('span');
        subName.style.cssText = 'font-size: 11px; color: #9ca3af;';
        subName.textContent = `(${item.english})`;

        nameWrapper.appendChild(mainName);
        nameWrapper.appendChild(subName);

        const badge = document.createElement('span');
        const cat = categoryLabels[item.category] || categoryLabels.term;
        badge.style.cssText = [
          'font-size: 10px',
          'padding: 2px 6px',
          'border-radius: 4px',
          `color: ${cat.color}`,
          `background: ${cat.bg}`,
          'white-space: nowrap',
          'flex-shrink: 0',
        ].join(';');
        badge.textContent = cat.label;

        row.appendChild(nameWrapper);
        row.appendChild(badge);

        row.addEventListener('mouseenter', () => {
          activeIndex = index;
          updateHighlight();
        });

        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          applySearchSelection(input, item);
        });

        el.appendChild(row);
      });

      positionDropdown(input);
      el.style.display = 'block';
    }

    function updateHighlight() {
      if (!dropdownEl) return;
      const rows = dropdownEl.querySelectorAll('.poe-ninja-search-item');
      rows.forEach((row, index) => {
        if (index === activeIndex) {
          row.style.background = '#1e293b';
          row.style.color = '#f59e0b';
        } else {
          row.style.background = 'transparent';
          row.style.color = '#e5e7eb';
        }
      });
    }

    document.addEventListener('input', (e) => {
      if (isApplyingSelection) return;
      const target = e.target;
      if (!target || target.tagName !== 'INPUT' || target.type === 'checkbox' || target.type === 'radio' || target.type === 'number') {
        return;
      }
      const val = target.value?.trim();
      // 只有输入包含中文字符时才触发中文联想下拉框，避免纯英文或初始化时误触发
      if (!val || !/[㐀-鿿]/.test(val)) {
        hideDropdown();
        return;
      }
      currentInput = target;
      const results = core.searchBilingual(val, dictionary, language, 8);
      if (results.length > 0) {
        renderResults(target, results);
      } else {
        hideDropdown();
      }
    }, true);

    document.addEventListener('keydown', (e) => {
      if (!dropdownEl || dropdownEl.style.display === 'none' || !searchResults.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % searchResults.length;
        updateHighlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = (activeIndex - 1 + searchResults.length) % searchResults.length;
        updateHighlight();
      } else if (e.key === 'Enter') {
        if (activeIndex >= 0 && activeIndex < searchResults.length && currentInput) {
          e.preventDefault();
          e.stopPropagation();
          applySearchSelection(currentInput, searchResults[activeIndex]);
        }
      } else if (e.key === 'Escape') {
        hideDropdown();
      }
    }, true);

    document.addEventListener('mousedown', (e) => {
      if (dropdownEl && !dropdownEl.contains(e.target) && e.target !== currentInput) {
        hideDropdown();
      }
    }, true);
  }

  /* ==========================================================================
     角色增强收藏系统 (Favorite Character Drawer System)
     ========================================================================== */

  const favManager = globalThis.PoeNinjaFavoriteManager;
  let favTriggerEl = null;
  let favOverlayEl = null;
  let favDrawerEl = null;
  let favSearchQuery = '';
  let favSortBy = 'time_desc';
  let isDrawerOpen = false;

  function injectFavoriteStyles() {
    if (document.getElementById('poe-ninja-fav-styles')) return;
    const style = document.createElement('style');
    style.id = 'poe-ninja-fav-styles';
    style.textContent = `
      .poe-ninja-fav-trigger {
        position: fixed;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        z-index: 99998;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px 8px 10px;
        background: rgba(18, 22, 31, 0.92);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(218, 165, 32, 0.45);
        border-right: none;
        border-radius: 20px 0 0 20px;
        box-shadow: -3px 4px 18px rgba(0, 0, 0, 0.6), 0 0 12px rgba(218, 165, 32, 0.25);
        color: #ffd700;
        cursor: grab;
        user-select: none;
        transition: background 0.2s, box-shadow 0.2s, border-color 0.2s;
      }
      .poe-ninja-fav-trigger:hover {
        background: rgba(26, 32, 46, 0.98);
        border-color: rgba(255, 215, 0, 0.85);
        box-shadow: -4px 6px 22px rgba(0, 0, 0, 0.75), 0 0 16px rgba(255, 215, 0, 0.4);
      }
      .poe-ninja-fav-trigger.dragging {
        cursor: grabbing;
      }
      .poe-ninja-fav-icon {
        font-size: 16px;
        line-height: 1;
      }
      .poe-ninja-fav-badge {
        background: #c79532;
        color: #11141c;
        font-weight: 800;
        font-size: 11px;
        padding: 1px 6px;
        border-radius: 10px;
        line-height: 14px;
      }
      .poe-ninja-fav-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        z-index: 99999;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.25s ease-out;
      }
      .poe-ninja-fav-overlay.open {
        opacity: 1;
        pointer-events: auto;
      }
      .poe-ninja-fav-drawer {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: 530px;
        max-width: 92vw;
        background: #131722;
        border-left: 1px solid rgba(218, 165, 32, 0.35);
        box-shadow: -12px 0 40px rgba(0, 0, 0, 0.85);
        z-index: 100000;
        transform: translateX(105%);
        transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        display: flex;
        flex-direction: column;
        color: #e0e0e0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      }
      .poe-ninja-fav-drawer.open {
        transform: translateX(0);
      }
      .poe-ninja-fav-header {
        padding: 16px 20px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: rgba(9, 12, 18, 0.8);
      }
      .poe-ninja-fav-title {
        font-size: 16px;
        font-weight: 700;
        color: #ffd700;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .poe-ninja-fav-close {
        background: transparent;
        border: none;
        color: #888;
        font-size: 20px;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        line-height: 1;
        transition: color 0.15s, background 0.15s;
      }
      .poe-ninja-fav-close:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.1);
      }
      .poe-ninja-fav-tools {
        padding: 12px 20px;
        background: rgba(18, 22, 31, 0.7);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        display: flex;
        gap: 10px;
      }
      .poe-ninja-fav-search {
        flex: 1;
        background: #0c0f16;
        border: 1px solid #273043;
        border-radius: 6px;
        padding: 7px 12px;
        color: #fff;
        font-size: 13px;
        outline: none;
      }
      .poe-ninja-fav-search:focus {
        border-color: #c79532;
        box-shadow: 0 0 6px rgba(199, 149, 50, 0.3);
      }
      .poe-ninja-fav-sort {
        background: #0c0f16;
        border: 1px solid #273043;
        border-radius: 6px;
        padding: 6px 10px;
        color: #ccc;
        font-size: 12px;
        cursor: pointer;
        outline: none;
      }
      .poe-ninja-fav-list {
        flex: 1;
        overflow-y: auto;
        padding: 16px 20px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .poe-ninja-fav-card {
        background: #181d2a;
        border: 1px solid #252e40;
        border-radius: 8px;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        transition: border-color 0.2s, background 0.2s, transform 0.15s;
      }
      .poe-ninja-fav-card:hover {
        background: #1e2434;
        border-color: rgba(218, 165, 32, 0.55);
        transform: translateY(-1px);
      }
      .poe-ninja-fav-card-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
      }
      .poe-ninja-fav-char-link {
        color: #4da6ff;
        font-weight: 700;
        font-size: 15px;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        min-width: 0;
      }
      .poe-ninja-fav-char-link:hover {
        color: #80c1ff;
      }
      .poe-ninja-fav-avatar {
        width: 28px;
        height: 28px;
        border-radius: 4px;
        object-fit: cover;
        background: #0b0e14;
        border: 1px solid #2a3449;
        flex-shrink: 0;
      }
      .poe-ninja-fav-name {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .poe-ninja-fav-account {
        font-size: 12px;
        color: #73809c;
        font-weight: normal;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .poe-ninja-fav-level {
        color: #ffd700;
        font-size: 12px;
        font-weight: 700;
        background: rgba(255, 215, 0, 0.12);
        padding: 3px 8px;
        border-radius: 4px;
        border: 1px solid rgba(255, 215, 0, 0.25);
        white-space: nowrap;
        flex-shrink: 0;
      }
      .poe-ninja-fav-stats {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
        background: rgba(0, 0, 0, 0.3);
        padding: 8px 10px;
        border-radius: 6px;
        text-align: center;
      }
      .poe-ninja-fav-stat-item {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .poe-ninja-fav-stat-label {
        font-size: 10px;
        color: #8892b0;
        font-weight: 600;
        letter-spacing: 0.5px;
      }
      .poe-ninja-fav-stat-val {
        font-size: 13px;
        font-weight: 700;
      }
      .poe-ninja-fav-val-life { color: #ff5252; }
      .poe-ninja-fav-val-es { color: #40c4ff; }
      .poe-ninja-fav-val-ehp { color: #69f0ae; }
      .poe-ninja-fav-val-dps { color: #ffd740; }
      .poe-ninja-fav-card-bottom {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
        color: #8892b0;
      }
      .poe-ninja-fav-skill {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .poe-ninja-fav-skill-img {
        width: 22px;
        height: 22px;
        border-radius: 4px;
        background: #000;
        border: 1px solid #333;
      }
      .poe-ninja-fav-card-actions {
        display: flex;
        gap: 6px;
      }
      .poe-ninja-fav-btn-icon {
        background: transparent;
        border: 1px solid #303a4e;
        color: #9aa5be;
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.15s;
      }
      .poe-ninja-fav-btn-icon:hover {
        border-color: #ff5252;
        color: #ff5252;
        background: rgba(255, 82, 82, 0.1);
      }
      .poe-ninja-fav-btn-copy:hover {
        border-color: #40c4ff;
        color: #40c4ff;
        background: rgba(64, 196, 255, 0.1);
      }
      .poe-ninja-fav-empty {
        text-align: center;
        padding: 60px 20px;
        color: #6a7791;
        font-size: 14px;
        line-height: 1.6;
      }
      .poe-ninja-row-fav-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        margin-right: 6px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #7a869e;
        cursor: pointer;
        font-size: 13px;
        line-height: 1;
        transition: all 0.15s;
        vertical-align: middle;
      }
      .poe-ninja-row-fav-btn:hover {
        color: #ffd700;
        border-color: #ffd700;
        background: rgba(255, 215, 0, 0.15);
        transform: scale(1.15);
      }
      .poe-ninja-row-fav-btn.active {
        color: #ffd700;
        border-color: rgba(218, 165, 32, 0.85);
        background: rgba(218, 165, 32, 0.25);
        box-shadow: 0 0 8px rgba(255, 215, 0, 0.45);
      }
      .poe-ninja-detail-fav-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 14px;
        margin-left: 12px;
        border-radius: 6px;
        background: rgba(18, 22, 31, 0.9);
        border: 1px solid rgba(218, 165, 32, 0.5);
        color: #ffd700;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: all 0.2s;
        vertical-align: middle;
      }
      .poe-ninja-detail-fav-btn:hover {
        background: rgba(28, 34, 48, 0.98);
        border-color: #ffd700;
        box-shadow: 0 0 10px rgba(255, 215, 0, 0.3);
      }
      .poe-ninja-detail-fav-btn.active {
        background: rgba(218, 165, 32, 0.25);
        border-color: #ffd700;
        box-shadow: 0 0 12px rgba(255, 215, 0, 0.4);
      }
    `;
    document.head.appendChild(style);
  }

  async function updateFavoriteDrawerList() {
    if (!favDrawerEl || !favManager) return;
    const listEl = favDrawerEl.querySelector('.poe-ninja-fav-list');
    const badgeEl = favTriggerEl?.querySelector('.poe-ninja-fav-badge');
    const countTitleEl = favDrawerEl.querySelector('.poe-ninja-fav-count');
    if (!listEl) return;

    const allFavorites = await favManager.getFavorites();
    if (badgeEl) badgeEl.textContent = allFavorites.length;
    if (countTitleEl) countTitleEl.textContent = `(${allFavorites.length})`;

    const filtered = favManager.filterAndSortFavorites(allFavorites, favSearchQuery, favSortBy);

    if (!filtered.length) {
      listEl.innerHTML = `
        <div class="poe-ninja-fav-empty">
          <div style="font-size: 32px; margin-bottom: 8px;">⭐</div>
          <div>${favSearchQuery ? '未找到匹配的收藏角色' : '暂无收藏角色'}</div>
          <div style="font-size: 12px; color: #505c75; margin-top: 4px;">在天梯列表或角色详情页点击 ★ 即可一键收藏</div>
        </div>
      `;
      return;
    }

    const normLang = normalizeLanguageKey(language);
    const isZhTw = normLang === 'zh-TW';
    const isEn = normLang === 'en';

    const lblLife = isEn ? 'Life' : '生命';
    const lblEs = isEn ? 'ES' : (isZhTw ? '護盾' : '护盾');
    const lblEhp = isEn ? 'EHP' : '有效血量';
    const lblDps = 'DPS';
    const lblCopy = isEn ? 'Copy Link' : (isZhTw ? '複製連結' : '复制链接');
    const lblDelete = isEn ? 'Remove' : (isZhTw ? '移除' : '移除');

    listEl.innerHTML = filtered.map((item) => {
      const fullUrl = new URL(item.url, window.location.origin).href;
      const cleanName = sanitizeCharacterName(item.name, item.url);
      const displayClass = getLocalizedClassName(item.classTitle, language);
      const displaySkill = (item.mainSkillName && core.translateInlineText)
        ? (core.translateInlineText(item.mainSkillName, dictionary, normLang) || item.mainSkillName)
        : (item.mainSkillName || '');

      return `
      <div class="poe-ninja-fav-card" data-url="${item.url}" data-full-url="${fullUrl}" style="cursor: pointer;">
        <div class="poe-ninja-fav-card-top">
          <a class="poe-ninja-fav-char-link" href="${fullUrl}" target="_blank" rel="noopener noreferrer" data-full-url="${fullUrl}">
            ${item.classAvatar ? `<img class="poe-ninja-fav-avatar" src="${item.classAvatar}" alt="">` : ''}
            <span class="poe-ninja-fav-name">${cleanName}</span>
            ${item.account ? `<span class="poe-ninja-fav-account">(${item.account})</span>` : ''}
          </a>
          ${(item.level || displayClass) ? `<span class="poe-ninja-fav-level">${item.level ? `Lv.${item.level}` : ''} ${displayClass}</span>` : ''}
        </div>
        <div class="poe-ninja-fav-stats">
          <div class="poe-ninja-fav-stat-item">
            <span class="poe-ninja-fav-stat-label">${lblLife}</span>
            <span class="poe-ninja-fav-stat-val poe-ninja-fav-val-life">${item.life || '-'}</span>
          </div>
          <div class="poe-ninja-fav-stat-item">
            <span class="poe-ninja-fav-stat-label">${lblEs}</span>
            <span class="poe-ninja-fav-stat-val poe-ninja-fav-val-es">${item.es || '-'}</span>
          </div>
          <div class="poe-ninja-fav-stat-item">
            <span class="poe-ninja-fav-stat-label">${lblEhp}</span>
            <span class="poe-ninja-fav-stat-val poe-ninja-fav-val-ehp">${item.ehp || '-'}</span>
          </div>
          <div class="poe-ninja-fav-stat-item">
            <span class="poe-ninja-fav-stat-label">${lblDps}</span>
            <span class="poe-ninja-fav-stat-val poe-ninja-fav-val-dps">${item.dps || '-'}</span>
          </div>
        </div>
        <div class="poe-ninja-fav-card-bottom">
          <div class="poe-ninja-fav-skill">
            ${item.mainSkillIcon ? `<img class="poe-ninja-fav-skill-img" src="${item.mainSkillIcon}" alt="">` : ''}
            <span>${displaySkill}</span>
          </div>
          <div class="poe-ninja-fav-card-actions">
            <button class="poe-ninja-fav-btn-icon poe-ninja-fav-btn-copy" data-action="copy" data-url="${item.url}">${lblCopy}</button>
            <button class="poe-ninja-fav-btn-icon poe-ninja-fav-btn-del" data-action="delete" data-id="${item.id}">${lblDelete}</button>
          </div>
        </div>
      </div>
    `;
    }).join('');

    // 绑定卡片与链接整体直达点击（原生在新标签页打开）
    listEl.querySelectorAll('.poe-ninja-fav-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        e.preventDefault();
        e.stopPropagation();
        const fullUrl = card.getAttribute('data-full-url') || card.querySelector('a')?.href;
        if (fullUrl) {
          window.open(fullUrl, '_blank', 'noopener,noreferrer');
        }
      });
    });

    // 绑定删除与复制事件
    listEl.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (id) {
          await favManager.removeFavorite(id);
          updateFavoriteDrawerList();
          syncAllRowFavoriteButtons();
        }
      });
    });

    listEl.querySelectorAll('[data-action="copy"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const relUrl = btn.getAttribute('data-url');
        const fullUrl = new URL(relUrl, window.location.origin).href;
        navigator.clipboard.writeText(fullUrl).then(() => {
          const orig = btn.textContent;
          btn.textContent = '已复制!';
          setTimeout(() => { btn.textContent = orig; }, 1500);
        });
      });
    });
  }

  function toggleFavoriteDrawer(open) {
    if (typeof open === 'boolean') {
      isDrawerOpen = open;
    } else {
      isDrawerOpen = !isDrawerOpen;
    }
    if (favOverlayEl && favDrawerEl) {
      if (isDrawerOpen) {
        favOverlayEl.classList.add('open');
        favDrawerEl.classList.add('open');
        updateFavoriteDrawerList();
      } else {
        favOverlayEl.classList.remove('open');
        favDrawerEl.classList.remove('open');
      }
    }
  }

  function setupFavoriteTriggerAndDrawer() {
    if (document.getElementById('poe-ninja-fav-trigger-btn')) return;
    injectFavoriteStyles();

    // 1. 创建右侧可拖拽悬浮球
    favTriggerEl = document.createElement('div');
    favTriggerEl.id = 'poe-ninja-fav-trigger-btn';
    favTriggerEl.className = 'poe-ninja-fav-trigger notranslate';
    favTriggerEl.setAttribute('translate', 'no');
    favTriggerEl.setAttribute('data-poe-ninja-translation-root', 'drawer');
    favTriggerEl.title = '打开已收藏角色抽屉 (可上下拖拽)';
    favTriggerEl.innerHTML = `
      <span class="poe-ninja-fav-icon">⭐</span>
      <span class="poe-ninja-fav-badge">0</span>
    `;

    // 恢复历史拖拽位置
    const savedTop = localStorage.getItem('poe_ninja_fav_btn_top');
    if (savedTop) favTriggerEl.style.top = savedTop;

    // 纵向自由拖拽手柄
    let isDragging = false;
    let dragStartY = 0;
    let initialTopPx = 0;
    let hasMoved = false;

    favTriggerEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isDragging = true;
      hasMoved = false;
      dragStartY = e.clientY;
      const rect = favTriggerEl.getBoundingClientRect();
      initialTopPx = rect.top + rect.height / 2;
      favTriggerEl.classList.add('dragging');
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const deltaY = e.clientY - dragStartY;
      if (Math.abs(deltaY) > 3) hasMoved = true;
      let newTop = initialTopPx + deltaY;
      const minTop = 40;
      const maxTop = window.innerHeight - 40;
      newTop = Math.max(minTop, Math.min(maxTop, newTop));
      favTriggerEl.style.top = `${newTop}px`;
    });

    window.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      favTriggerEl.classList.remove('dragging');
      if (hasMoved) {
        const topRatio = (parseFloat(favTriggerEl.style.top) / window.innerHeight) * 100;
        localStorage.setItem('poe_ninja_fav_btn_top', `${topRatio.toFixed(2)}%`);
      }
    });

    favTriggerEl.addEventListener('click', () => {
      if (!hasMoved) toggleFavoriteDrawer(true);
    });

    // 2. 创建遮罩与抽屉主体
    favOverlayEl = document.createElement('div');
    favOverlayEl.className = 'poe-ninja-fav-overlay notranslate';
    favOverlayEl.setAttribute('translate', 'no');
    favOverlayEl.setAttribute('data-poe-ninja-translation-root', 'drawer');
    favOverlayEl.addEventListener('click', () => toggleFavoriteDrawer(false));

    favDrawerEl = document.createElement('div');
    favDrawerEl.className = 'poe-ninja-fav-drawer notranslate';
    favDrawerEl.setAttribute('translate', 'no');
    favDrawerEl.setAttribute('data-poe-ninja-translation-root', 'drawer');
    favDrawerEl.innerHTML = `
      <div class="poe-ninja-fav-header">
        <div class="poe-ninja-fav-title">
          <span>⭐ 角色收藏夹</span>
          <span class="poe-ninja-fav-count" style="font-size: 13px; color: #8892b0; font-weight: normal;">(0)</span>
        </div>
        <button class="poe-ninja-fav-close">✕</button>
      </div>
      <div class="poe-ninja-fav-tools">
        <input type="text" class="poe-ninja-fav-search" placeholder="🔍 搜索角色 / 账号 / 职业 / 技能...">
        <select class="poe-ninja-fav-sort">
          <option value="time_desc">最新收藏</option>
          <option value="dps_desc">DPS 从高到低</option>
          <option value="ehp_desc">有效血量 从高到低</option>
          <option value="life_desc">生命 从高到低</option>
          <option value="es_desc">护盾 从高到低</option>
          <option value="level_desc">等级 从高到低</option>
        </select>
      </div>
      <div class="poe-ninja-fav-list"></div>
    `;

    favDrawerEl.querySelector('.poe-ninja-fav-close').addEventListener('click', () => toggleFavoriteDrawer(false));

    const searchInput = favDrawerEl.querySelector('.poe-ninja-fav-search');
    searchInput.addEventListener('input', (e) => {
      favSearchQuery = e.target.value;
      updateFavoriteDrawerList();
    });

    const sortSelect = favDrawerEl.querySelector('.poe-ninja-fav-sort');
    sortSelect.addEventListener('change', (e) => {
      favSortBy = e.target.value;
      updateFavoriteDrawerList();
    });

    document.body.appendChild(favTriggerEl);
    document.body.appendChild(favOverlayEl);
    document.body.appendChild(favDrawerEl);

    // ESC 键关闭
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isDrawerOpen) toggleFavoriteDrawer(false);
    });

    updateFavoriteDrawerList();
  }

  function sanitizeCharacterName(name, url) {
    if (url) {
      const parts = url.split('?')[0].split('#')[0].split('/').filter(Boolean);
      const charIdx = parts.findIndex((p) => p === 'character' || p === 'char');
      if (charIdx >= 0 && parts.length > charIdx + 2) {
        return decodeURIComponent(parts[charIdx + 2]);
      }
      if (parts.length >= 3 && parts[parts.length - 2] !== 'builds') {
        return decodeURIComponent(parts[parts.length - 1]);
      }
    }
    if (!name) return 'Character';
    return name.replace(/\([^)]+\)/g, '').replace(/(?:Lv\.?|Level)?\s*\d{1,3}.*$/i, '').trim() || 'Character';
  }

  function parseRowCharacterData(row) {
    const linkEl = row.querySelector('a[href*="/builds/char/"], a[href*="/character/"], a[href*="/build/"]');
    if (!linkEl) return null;
    const url = linkEl.getAttribute('href');
    
    // 优先从 URL 提取绝对纯净的角色名与账号名 (杜绝页面翻译后将等级和职业拼入 name)
    let account = '';
    let name = '';
    if (url) {
      const parts = url.split('?')[0].split('#')[0].split('/').filter(Boolean);
      const charIdx = parts.findIndex((p) => p === 'character' || p === 'char');
      if (charIdx >= 0 && parts.length > charIdx + 2) {
        account = decodeURIComponent(parts[charIdx + 1]);
        name = decodeURIComponent(parts[charIdx + 2]);
      } else if (parts.length >= 3 && parts[parts.length - 2] !== 'builds') {
        account = decodeURIComponent(parts[parts.length - 2]);
        name = decodeURIComponent(parts[parts.length - 1]);
      }
    }
    if (!name) {
      name = sanitizeCharacterName(linkEl.textContent.trim(), url);
    }

    // 头像与职业
    const avatarImg = row.querySelector('img[src*="avatar" i], img[src*="class" i], img[src*="classes" i]');
    const classAvatar = avatarImg ? avatarImg.src : '';
    let classTitle = avatarImg?.title || avatarImg?.alt || '';

    // 主技能图标与名称
    const skillImg = row.querySelector('img[src*="skill" i], img[src*="gem" i], img[src*="skills" i], img[src*="items" i]');
    let mainSkillIcon = skillImg ? skillImg.src : '';
    let mainSkillName = skillImg?.title || skillImg?.alt || '';

    let level = '';
    let life = '-';
    let es = '-';
    let ehp = '-';
    let dps = '-';

    // 1. 尝试按标准列顺序提取 (Name -> Level+Class -> Life -> ES -> EHP -> DPS)
    let colElements = Array.from(row.children);
    if (colElements.length === 1 && colElements[0].children.length >= 4) {
      colElements = Array.from(colElements[0].children);
    }

    const nameColIdx = colElements.findIndex((el) => el.contains(linkEl));
    if (nameColIdx >= 0 && colElements.length > nameColIdx + 1) {
      const remainingCols = colElements.slice(nameColIdx + 1);
      // col 0: Level & Avatar
      if (remainingCols[0]) {
        const lMatch = remainingCols[0].textContent.match(/\b(100|\d{1,2})\b/);
        if (lMatch) level = lMatch[1];
        if (!classTitle) {
          const t = remainingCols[0].textContent.replace(/\b\d+\b/g, '').trim();
          if (t) classTitle = t;
        }
      }
      // col 1: Life
      if (remainingCols[1]) {
        const raw = remainingCols[1].textContent.trim();
        const clean = raw.replace(/[^\d.kKmMbB]/g, '');
        if (clean) life = clean;
      }
      // col 2: ES
      if (remainingCols[2]) {
        const raw = remainingCols[2].textContent.trim();
        const clean = raw.replace(/[^\d.kKmMbB]/g, '');
        if (clean !== '') es = clean;
      }
      // col 3: EHP
      if (remainingCols[3]) {
        const raw = remainingCols[3].textContent.trim();
        const clean = raw.replace(/[^\d.kKmMbB]/g, '');
        if (clean) ehp = clean;
      }
      // col 4: DPS
      if (remainingCols[4]) {
        const raw = remainingCols[4].textContent.trim();
        const clean = raw.replace(/[^\d.kKmMbB]/g, '');
        if (clean) dps = clean;
        if (!mainSkillIcon) {
          const img = remainingCols[4].querySelector('img');
          if (img) {
            mainSkillIcon = img.src;
            mainSkillName = img.title || img.alt || '';
          }
        }
      }
    }

    // 2. 容错提取 (如果未通过列定位到)
    if (life === '-' || es === '-') {
      const lifeEl = row.querySelector('[class*="life" i], [data-field="life"]');
      const esEl = row.querySelector('[class*="energy-shield" i], [class*="shield" i], [class*="es" i], [data-field="es"]');
      const ehpEl = row.querySelector('[class*="ehp" i], [data-field="ehp"]');
      const dpsEl = row.querySelector('[class*="dps" i], [data-field="dps"]');
      const levelEl = row.querySelector('[class*="level" i], [data-field="level"]');

      if (lifeEl) life = lifeEl.textContent.trim().replace(/[^\d.]/g, '') || life;
      if (esEl) es = esEl.textContent.trim().replace(/[^\d.]/g, '') || es;
      if (ehpEl) ehp = ehpEl.textContent.trim() || ehp;
      if (dpsEl) dps = dpsEl.textContent.trim() || dps;
      if (levelEl && !level) level = levelEl.textContent.trim().replace(/\D/g, '') || '';
    }

    return {
      url,
      name,
      account,
      level,
      classTitle,
      classAvatar,
      life,
      es,
      ehp,
      dps,
      mainSkillIcon,
      mainSkillName,
    };
  }

  async function syncAllRowFavoriteButtons() {
    if (!favManager) return;
    const buttons = document.querySelectorAll('.poe-ninja-row-fav-btn');
    for (const btn of buttons) {
      const url = btn.getAttribute('data-url');
      if (url) {
        const favorited = await favManager.isFavorited(url);
        btn.classList.toggle('active', favorited);
        btn.title = favorited ? '已收藏 (点击取消)' : '点击收藏此角色';
      }
    }
  }

  function injectRowFavoriteButtons() {
    if (!favManager) return;
    const rows = document.querySelectorAll('tr, [role="row"], div.row');
    rows.forEach((row) => {
      const charLink = row.querySelector('a[href*="/builds/char/"], a[href*="/character/"]');
      if (!charLink || row.querySelector('.poe-ninja-row-fav-btn')) return;

      const url = charLink.getAttribute('href');
      if (!url) return;

      const btn = document.createElement('button');
      btn.className = 'poe-ninja-row-fav-btn';
      btn.setAttribute('data-url', url);
      btn.innerHTML = '★';
      btn.title = '点击收藏此角色';

      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const data = parseRowCharacterData(row);
        if (data) {
          const res = await favManager.toggleFavorite(data);
          btn.classList.toggle('active', res.favorited);
          btn.title = res.favorited ? '已收藏 (点击取消)' : '点击收藏此角色';
          updateFavoriteDrawerList();
        }
      });

      favManager.isFavorited(url).then((favorited) => {
        btn.classList.toggle('active', favorited);
        btn.title = favorited ? '已收藏 (点击取消)' : '点击收藏此角色';
      });

      charLink.parentElement.insertBefore(btn, charLink);
    });
  }

  function normalizeLanguageKey(lang) {
    if (!lang) return 'zh-CN';
    const l = String(lang).toLowerCase();
    if (l.includes('tw') || l.includes('hant') || l.includes('traditional')) return 'zh-TW';
    if (l.includes('en') || l.includes('english')) return 'en';
    return 'zh-CN';
  }

  const POE_CLASS_BILINGUAL_MAP = {
    // === POE2 基础职业 ===
    warrior: { en: 'Warrior', 'zh-CN': '战士', 'zh-TW': '戰士', aliases: ['战士', '戰士'] },
    monk: { en: 'Monk', 'zh-CN': '武僧', 'zh-TW': '武僧', aliases: ['武僧'] },
    sorceress: { en: 'Sorceress', 'zh-CN': '女术士', 'zh-TW': '女術士', aliases: ['女术士', '女術士'] },
    witch: { en: 'Witch', 'zh-CN': '女巫', 'zh-TW': '女巫', aliases: ['女巫'] },
    ranger: { en: 'Ranger', 'zh-CN': '游侠', 'zh-TW': '遊俠', aliases: ['游侠', '遊俠'] },
    mercenary: { en: 'Mercenary', 'zh-CN': '雇佣兵', 'zh-TW': '傭兵', aliases: ['雇佣兵', '傭兵'] },
    huntress: { en: 'Huntress', 'zh-CN': '女猎手', 'zh-TW': '女獵手', aliases: ['女猎手', '女獵手'] },
    shadow: { en: 'Shadow', 'zh-CN': '暗影', 'zh-TW': '暗影', aliases: ['暗影'] },
    druid: { en: 'Druid', 'zh-CN': '德鲁伊', 'zh-TW': '德魯伊', aliases: ['德鲁伊', '德魯伊'] },

    // === POE2 升华职业 ===
    ritualist: { en: 'Ritualist', 'zh-CN': '仪式师', 'zh-TW': '儀祭師', aliases: ['仪式师', '儀祭師', '仪祭师'] },
    titan: { en: 'Titan', 'zh-CN': '泰坦', 'zh-TW': '泰坦', aliases: ['泰坦'] },
    warbringer: { en: 'Warbringer', 'zh-CN': '战吼使', 'zh-TW': '戰禍召喚者', aliases: ['战吼使', '戰禍召喚者', '战祸召唤者'] },
    stormweaver: { en: 'Stormweaver', 'zh-CN': '风暴编织者', 'zh-TW': '風暴編織者', aliases: ['风暴编织者', '風暴編織者', '风暴使'] },
    chronomancer: { en: 'Chronomancer', 'zh-CN': '时空术士', 'zh-TW': '時空法師', aliases: ['时空术士', '時空法師', '时空法师'] },
    bloodmage: { en: 'Bloodmage', 'zh-CN': '血魔法师', 'zh-TW': '血魔法師', aliases: ['血魔法师', '血魔法師'] },
    infernalist: { en: 'Infernalist', 'zh-CN': '炼狱使者', 'zh-TW': '獄火使者', aliases: ['炼狱使者', '獄火使者', '地狱使者'] },
    invoker: { en: 'Invoker', 'zh-CN': '武圣', 'zh-TW': '武聖', aliases: ['武圣', '武聖', '唤灵者', '祈求者'] },
    'acolyte of chayula': { en: 'Acolyte of Chayula', 'zh-CN': '夏乌拉侍祭', 'zh-TW': '夏烏拉侍祭', aliases: ['夏乌拉侍祭', '夏烏拉侍祭'] },
    deadeye: { en: 'Deadeye', 'zh-CN': '神射手', 'zh-TW': '神射手', aliases: ['神射手', '锐眼', '銳眼'] },
    pathfinder: { en: 'Pathfinder', 'zh-CN': '追猎者', 'zh-TW': '追獵者', aliases: ['追猎者', '追獵者'] },
    soulwalker: { en: 'Soulwalker', 'zh-CN': '灵魂行者', 'zh-TW': '靈魂行者', aliases: ['灵魂行者', '靈魂行者'] },
    gemling: { en: 'Gemling Legionnaire', 'zh-CN': '宝石军团', 'zh-TW': '寶石軍團', aliases: ['宝石军团', '寶石軍團'] },
    'smith of kitava': { en: 'Smith of Kitava', 'zh-CN': '奇塔弗匠师', 'zh-TW': '奇塔弗匠師', aliases: ['奇塔弗匠师', '奇塔弗匠師', '奇塔弗工匠'] },
    witchdoctor: { en: 'Witch Doctor', 'zh-CN': '巫医', 'zh-TW': '巫醫', aliases: ['巫医', '巫醫'] },
    lich: { en: 'Lich', 'zh-CN': '巫妖', 'zh-TW': '巫妖', aliases: ['巫妖'] },
    amazon: { en: 'Amazon', 'zh-CN': '亚马逊', 'zh-TW': '亞馬遜', aliases: ['亚马逊', '亞馬遜'] },

    // === POE1 基础与升华 ===
    duelist: { en: 'Duelist', 'zh-CN': '决斗者', 'zh-TW': '決鬥者', aliases: ['决斗者', '決鬥者'] },
    marauder: { en: 'Marauder', 'zh-CN': '野蛮人', 'zh-TW': '野蠻人', aliases: ['野蛮人', '野蠻人'] },
    templar: { en: 'Templar', 'zh-CN': '圣堂武僧', 'zh-TW': '聖堂武僧', aliases: ['圣堂武僧', '聖堂武僧'] },
    scion: { en: 'Scion', 'zh-CN': '贵族', 'zh-TW': '貴族', aliases: ['贵族', '貴族'] },
    slayer: { en: 'Slayer', 'zh-CN': '处刑者', 'zh-TW': '處刑者', aliases: ['处刑者', '處刑者'] },
    gladiator: { en: 'Gladiator', 'zh-CN': '卫士', 'zh-TW': '衛士', aliases: ['卫士', '衛士'] },
    champion: { en: 'Champion', 'zh-CN': '冠军', 'zh-TW': '冠軍', aliases: ['冠军', '冠軍'] },
    assassin: { en: 'Assassin', 'zh-CN': '刺客', 'zh-TW': '刺客', aliases: ['刺客'] },
    saboteur: { en: 'Saboteur', 'zh-CN': '破坏者', 'zh-TW': '破壞者', aliases: ['破坏者', '破壞者'] },
    trickster: { en: 'Trickster', 'zh-CN': '欺诈者', 'zh-TW': '詐欺師', aliases: ['欺诈者', '詐欺師'] },
    juggernaut: { en: 'Juggernaut', 'zh-CN': '勇士', 'zh-TW': '勇士', aliases: ['勇士'] },
    berserker: { en: 'Berserker', 'zh-CN': '暴徒', 'zh-TW': '暴徒', aliases: ['暴徒'] },
    chieftain: { en: 'Chieftain', 'zh-CN': '酋长', 'zh-TW': '酋長', aliases: ['酋长', '酋長'] },
    necromancer: { en: 'Necromancer', 'zh-CN': '死灵法师', 'zh-TW': '死靈法師', aliases: ['死灵法师', '死靈法師'] },
    occultist: { en: 'Occultist', 'zh-CN': '秘术家', 'zh-TW': '秘術家', aliases: ['秘术家', '秘術家'] },
    elementalist: { en: 'Elementalist', 'zh-CN': '元素使', 'zh-TW': '元素使', aliases: ['元素使'] },
    raider: { en: 'Raider', 'zh-CN': '侠客', 'zh-TW': '俠客', aliases: ['侠客', '俠客'] },
    inquisitor: { en: 'Inquisitor', 'zh-CN': '圣宗', 'zh-TW': '聖宗', aliases: ['圣宗', '聖宗'] },
    hierophant: { en: 'Hierophant', 'zh-CN': '判官', 'zh-TW': '聖堂判官', aliases: ['判官', '聖堂判官'] },
    guardian: { en: 'Guardian', 'zh-CN': '守护者', 'zh-TW': '守護者', aliases: ['守护者', '守護者'] },
    ascendant: { en: 'Ascendant', 'zh-CN': '贵族', 'zh-TW': '昇華使徒', aliases: ['贵族', '昇華使徒'] },
  };

  function getLocalizedClassName(rawClass, targetLang) {
    if (!rawClass) return '';
    const clean = String(rawClass).trim().toLowerCase();
    const langKey = normalizeLanguageKey(targetLang);
    
    for (const [key, obj] of Object.entries(POE_CLASS_BILINGUAL_MAP)) {
      if (
        key === clean ||
        obj.en.toLowerCase() === clean ||
        obj['zh-CN']?.toLowerCase() === clean ||
        obj['zh-TW']?.toLowerCase() === clean ||
        (obj.aliases && obj.aliases.some((a) => a.toLowerCase() === clean))
      ) {
        return obj[langKey] || obj['zh-CN'] || obj.en;
      }
    }
    if (langKey !== 'en' && typeof core?.translateInlineText === 'function' && dictionary) {
      const tr = core.translateInlineText(rawClass, dictionary, langKey);
      if (tr && tr !== rawClass) return tr;
    }
    return rawClass;
  }

  function parseCharacterDetailPageData() {
    const rawUrl = window.location.pathname;
    const cleanUrl = rawUrl.split('?')[0].split('#')[0];
    
    let account = '';
    let name = '';
    let level = '';
    let classTitle = '';
    let classAvatar = '';

    // 1. 从 URL 路径精准提取账号名与角色名 (支持 /character/ 与 /char/ 两种路径)
    const parts = cleanUrl.split('/').filter(Boolean);
    const charIdx = parts.findIndex((p) => p === 'character' || p === 'char');
    if (charIdx >= 0 && parts.length > charIdx + 2) {
      account = decodeURIComponent(parts[charIdx + 1]);
      name = decodeURIComponent(parts[charIdx + 2]);
    } else if (charIdx >= 0 && parts.length > charIdx + 1) {
      name = decodeURIComponent(parts[charIdx + 1]);
    } else if (parts.length >= 3 && parts[parts.length - 2] !== 'builds') {
      account = decodeURIComponent(parts[parts.length - 2]);
      name = decodeURIComponent(parts[parts.length - 1]);
    }

    // 2. 从官方 meta[name="description"] 提取纯净数据 (如 "oopssist, level 100 Ritualist in the...")
    const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content');
    if (metaDesc) {
      const metaMatch = metaDesc.match(/^([^,]+),\s*(?:level|lv\.?)\s*(\d+)\s+([^,]+?)\s+in the/i);
      if (metaMatch) {
        if (!name || name === 'builds') name = metaMatch[1].trim();
        if (!level) level = metaMatch[2].trim();
        if (!classTitle) {
          classTitle = metaMatch[3].trim();
        }
      }
    }

    // 3. 从 og:image 提取官方职业头像
    const ogImg = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
    if (ogImg && ogImg.includes('/classes/')) {
      classAvatar = ogImg;
    }

    // 4. 从页面主标题/等级兜底
    if (!level || !classTitle || !name) {
      const h1 = document.querySelector('main h1, h1:not(.poe-ninja-fav-drawer *), h2:not(.poe-ninja-fav-drawer *)');
      if (h1) {
        const clone = h1.cloneNode(true);
        clone.querySelectorAll('button, #poe-ninja-detail-fav-btn, .poe-ninja-detail-fav-btn, script, style').forEach((el) => el.remove());
        let rawText = clone.textContent.trim();

        const accMatch = rawText.match(/\(([^)]+)\)/);
        if (accMatch) {
          if (!account) account = accMatch[1].trim();
          rawText = rawText.replace(/\([^)]+\)/, '').trim();
        }

        const lvlMatch = rawText.match(/(?:Lv\.?|Level)?\s*(\d{1,3})/i);
        if (lvlMatch) {
          if (!level) level = lvlMatch[1];
          rawText = rawText.replace(/(?:Lv\.?|Level)?\s*\d{1,3}/i, '').trim();
        }

        const tokens = rawText.split(/\s+/).filter(Boolean);
        if (tokens.length >= 2) {
          if (!name || name === 'builds') name = tokens[0];
          if (!classTitle) classTitle = tokens.slice(1).join(' ');
        } else if (tokens.length === 1) {
          if (!name || name === 'builds') name = tokens[0];
        }
      }
    }

    if (!name || name === 'builds') name = 'Character';

    // 5. 职业头像兜底
    if (!classAvatar) {
      const avatarEl = document.querySelector('main img[src*="avatar" i], main img[src*="class" i], main img[src*="classes" i], img[src*="avatar" i]:not(.poe-ninja-fav-drawer *)');
      if (avatarEl) classAvatar = avatarEl.src;
    }

    // 6. 全量技能估算卡片扫描 (智能挑选真实主力输出技能及对应 DPS)
    let mainSkillIcon = '';
    let mainSkillName = '';
    let dps = '-';

    function parseNumericDps(str) {
      if (!str || str === '-') return 0;
      const clean = String(str).trim().toLowerCase().replace(/,/g, '');
      const num = parseFloat(clean);
      if (isNaN(num)) return 0;
      if (clean.endsWith('k')) return num * 1000;
      if (clean.endsWith('m')) return num * 1000000;
      if (clean.endsWith('b')) return num * 1000000000;
      return num;
    }

    function cleanSkillAttributesText(text) {
      if (!text) return '';
      return text
        .replace(/[\d.,]+\s*m\s+(?:radius|半径)/gi, ' ')
        .replace(/[\d.,]+\s*s\s+(?:duration|持续时间|持續時間)/gi, ' ')
        .replace(/[\d.,]+\s*\/s/gi, ' ')
        .replace(/[\d.,]+%\s*(?:crit|hit|暴击|命中)/gi, ' ')
        .replace(/\d+\s*(?:proj|投射物|f)\b/gi, ' ');
    }

    const skillCandidates = [];
    const skillCards = document.querySelectorAll('main div, [class*="skill" i], [class*="damage" i], [class*="stats" i]');
    for (const card of skillCards) {
      if (card.closest('.poe-ninja-fav-drawer') || card.closest('.poe-ninja-fav-trigger')) continue;
      if (card.children.length > 12) continue;

      const img = card.querySelector('img[src*="gem" i], img[src*="skill" i], img[src*="poe2" i]');
      const rawText = (card.innerText || card.textContent || '').replace(/\r?\n/g, ' ');
      const t = cleanSkillAttributesText(rawText);

      const badgeMatch = t.match(/\b(?:DOT|Hit|Full\s*DPS|Combined\s*DPS|DPS)?\s*([\d.]+\s*[kKmMbB])\s*(?:>|$|·|\n)/i)
        || t.match(/([\d.]+\s*[kKmMbB])/);

      if (badgeMatch) {
        const valStr = badgeMatch[1].replace(/\s/g, '');
        const parsedNum = parseNumericDps(valStr);
        const nameCandidate = img?.title || img?.alt || card.querySelector('span, h3, h4, strong, p')?.textContent?.trim() || '';
        if (parsedNum >= 100 || /[kKmMbB]/i.test(valStr)) {
          skillCandidates.push({
            icon: img ? img.src : '',
            name: nameCandidate,
            dps: valStr,
            numericDps: parsedNum,
          });
        }
      }
    }

    // 挑选 DPS 最高的技能作为核心主技能
    if (skillCandidates.length > 0) {
      skillCandidates.sort((a, b) => b.numericDps - a.numericDps);
      const best = skillCandidates[0];
      if (best.icon) mainSkillIcon = best.icon;
      if (best.name) mainSkillName = best.name;
      dps = best.dps;
    }

    // 主技能图标兜底
    if (!mainSkillIcon) {
      const skillImg = document.querySelector('main img[src*="gem" i], main img[src*="skill" i], img[src*="gem" i]:not(.poe-ninja-fav-drawer *)');
      if (skillImg) {
        mainSkillIcon = skillImg.src;
        mainSkillName = skillImg.title || skillImg.alt || '';
      }
    }

    // 7. 生命、护盾、有效血量面板提取
    let life = '-';
    let es = '-';
    let ehp = '-';

    const statsContainer = document.querySelector('[class*="stats" i], [class*="overview" i], [class*="sidebar" i], main, article') || document.body;
    const statsText = cleanSkillAttributesText((statsContainer.innerText || statsContainer.textContent || '').replace(/\r?\n/g, ' '));

    // 1. 生命
    const lifeMatch = statsText.match(/(?:生命|Total Life|Life)[\s:]*([\d,]+)/i);
    if (lifeMatch) life = lifeMatch[1].replace(/,/g, '');

    // 2. 能量护盾 (简繁体 + 英文)
    const esMatch = statsText.match(/(?:能量[護护]盾|[護护]盾|Energy\s*Shield|ES)[\s:]*([\d,]+)/i);
    if (esMatch) es = esMatch[1].replace(/,/g, '');

    // 3. 有效生命池 (简繁体 + 英文)
    const ehpMatch = statsText.match(/(?:有效生命池|有效生命|有效血量|Effective\s*Hit\s*Pool|Effective\s*Health|EHP)[\s:]*([\d.,]+[kKmMbB]?)/i);
    if (ehpMatch) ehp = ehpMatch[1];

    // 4. DPS 全局兜底
    if (dps === '-') {
      const badgeMatch = statsText.match(/\b(?:DOT|Hit|Full\s*DPS|Combined\s*DPS|Combined)?\s*([\d.]+\s*[kKmMbB])\s*(?:>|$|\n)/i);
      if (badgeMatch) {
        const val = badgeMatch[1].replace(/\s/g, '');
        if (/[kKmMbB]/i.test(val) || parseFloat(val) >= 100) dps = val;
      }
    }
    if (dps === '-') {
      const skillSec = statsText.match(/(?:技能\s*DPS\s*估算|Skill\s*DPS)[\s\S]{0,150}?([\d.]+\s*[kKmMbB])/i);
      if (skillSec) dps = skillSec[1].replace(/\s/g, '');
    }

    // 5. 元素遍历深度兜底
    if (life === '-' || es === '-' || ehp === '-') {
      const allElements = statsContainer.querySelectorAll('div, section, p, span, td, tr, li, dl, dt, dd');
      for (const el of allElements) {
        if (el.closest('.poe-ninja-fav-drawer') || el.closest('.poe-ninja-fav-trigger') || el.closest('.poe-ninja-detail-fav-btn')) continue;
        if (el.children.length > 5) continue;
        const t = el.textContent.trim();
        if (!t || t.length > 100) continue;

        if (life === '-' && /(?:生命|Total Life|Life)/i.test(t)) {
          const m = t.match(/(?:生命|Total Life|Life)[\s:]*([\d,]+)/i) || t.match(/([\d,]+)[\s:]*(?:生命|Life)/i);
          if (m) life = m[1].replace(/,/g, '');
        }
        if (es === '-' && /(?:能量[護护]盾|[護护]盾|Energy\s*Shield|ES)/i.test(t)) {
          const m = t.match(/(?:能量[護护]盾|[護护]盾|Energy\s*Shield|ES)[\s:]*([\d,]+)/i) || t.match(/([\d,]+)[\s:]*(?:能量[護护]盾|[護护]盾|Energy\s*Shield|ES)/i);
          if (m) es = m[1].replace(/,/g, '');
        }
        if (ehp === '-' && /(?:有效生命池|有效生命|有效血量|Effective\s*Hit\s*Pool|Effective\s*Health|EHP)/i.test(t)) {
          const m = t.match(/(?:有效生命池|有效生命|有效血量|Effective\s*Hit\s*Pool|Effective\s*Health|EHP)[\s:]*([\d.,]+[kKmMbB]?)/i) || t.match(/([\d.,]+[kKmMbB]?)[\s:]*(?:有效生命池|有效生命|有效血量|EHP)/i);
          if (m) ehp = m[1].replace(/,/g, '');
        }
      }
    }

    // 6. 文本节点深度兜底
    if (life === '-' || es === '-' || ehp === '-') {
      const walker = document.createTreeWalker(statsContainer, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const val = n.nodeValue.trim();
        const p = n.parentElement;
        if (!p || p.tagName === 'SCRIPT' || p.tagName === 'STYLE' || p.closest('.poe-ninja-fav-drawer')) continue;
        
        if (life === '-' && /^(?:生命|Life)$/i.test(val)) {
          const num = p.nextElementSibling?.textContent?.match(/[\d,]+/) || p.parentElement?.textContent?.match(/[\d,]+/);
          if (num) life = num[0].replace(/,/g, '');
        }
        if (es === '-' && /^(?:能量[護护]盾|[護护]盾|Energy\s*Shield|ES)$/i.test(val)) {
          const num = p.nextElementSibling?.textContent?.match(/[\d,]+/) || p.parentElement?.textContent?.match(/[\d,]+/);
          if (num) es = num[0].replace(/,/g, '');
        }
        if (ehp === '-' && /^(?:有效生命池|有效生命|有效血量|EHP)$/i.test(val)) {
          const num = p.nextElementSibling?.textContent?.match(/[\d.,]+[kKmMbB]?/) || p.parentElement?.textContent?.match(/[\d.,]+[kKmMbB]?/);
          if (num) ehp = num[0];
        }
      }
    }

    return {
      url: cleanUrl,
      name,
      account,
      level,
      classTitle,
      classAvatar,
      life,
      es,
      ehp,
      dps,
      mainSkillIcon,
      mainSkillName,
    };
  }

  function injectCharacterDetailFavoriteButton() {
    if (!favManager) return;
    if (!window.location.pathname.includes('/builds/char/') && !window.location.pathname.includes('/character/')) return;
    if (document.getElementById('poe-ninja-detail-fav-btn')) return;

    // 寻找角色详情页主标题容器
    const headerTitle = document.querySelector('h1, h2, [class*="character-name" i], [class*="char-name" i]');
    if (!headerTitle) return;

    const charUrl = window.location.pathname;
    const btn = document.createElement('button');
    btn.id = 'poe-ninja-detail-fav-btn';
    btn.className = 'poe-ninja-detail-fav-btn';
    btn.innerHTML = '<span>★</span><span>收藏角色</span>';

    favManager.isFavorited(charUrl).then((favorited) => {
      btn.classList.toggle('active', favorited);
      btn.innerHTML = favorited ? '<span>★</span><span>已收藏</span>' : '<span>★</span><span>收藏角色</span>';
    });

    btn.addEventListener('click', async () => {
      const data = parseCharacterDetailPageData();
      const res = await favManager.toggleFavorite(data);
      btn.classList.toggle('active', res.favorited);
      btn.innerHTML = res.favorited ? '<span>★</span><span>已收藏</span>' : '<span>★</span><span>收藏角色</span>';
      updateFavoriteDrawerList();
      syncAllRowFavoriteButtons();
    });

    headerTitle.appendChild(btn);
  }

  function observeDocument() {
    documentObserver = new MutationObserver((mutations) => {
      processMutationRecords(mutations);
      injectRowFavoriteButtons();
      injectCharacterDetailFavoriteButton();
    });
    resumeDocumentObserver();
  }

  function observeRouteChanges() {
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function patchedHistoryMethod(...args) {
        const result = original.apply(this, args);
        scheduleFullScan();
        setTimeout(() => {
          injectRowFavoriteButtons();
          injectCharacterDetailFavoriteButton();
        }, 300);
        return result;
      };
    }
  }

  async function initialise() {
    const languageResult = await request({ type: 'GET_LANGUAGE' });
    if (languageResult?.ok) language = languageResult.language;
    injectTermStyles();
    setupTermTooltipHandler();
    setupBilingualSearchHandler();
    setupFavoriteTriggerAndDrawer();
    observeDocument();
    observeRouteChanges();
    await scanPage();
    injectRowFavoriteButtons();
    injectCharacterDetailFavoriteButton();
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.language?.newValue) {
      language = changes.language.newValue;
      scheduleFullScan();
      updateFavoriteDrawerList();
      syncAllRowFavoriteButtons();
    }
    if (changes.poe_ninja_favorite_characters) {
      updateFavoriteDrawerList();
      syncAllRowFavoriteButtons();
    }
  });
  window.addEventListener('popstate', scheduleFullScan);
  window.addEventListener('hashchange', scheduleFullScan);

  initialise().catch((error) => {
    console.error('[POE Ninja translation] could not initialise', error);
  });
}());
