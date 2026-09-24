(function attachTranslationCore(root) {
  'use strict';

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'META', 'LINK', 'SVG',
  ]);
  const NON_ROW_CONTAINER_TAGS = new Set(['HTML', 'HEAD', 'BODY']);
  const FORM_CONTROL_TAGS = new Set(['SELECT', 'OPTION', 'INPUT', 'TEXTAREA', 'BUTTON']);

  function isPageShellElement(element) {
    return Boolean(element?.tagName?.includes('-'));
  }

  function containsFormControl(element) {
    if (!element) return false;
    if (FORM_CONTROL_TAGS.has(element.tagName)) return true;

    const descendant = element.querySelector?.('select, option, input, textarea, button');
    if (descendant) return true;
    if (typeof element.querySelector === 'function') return false;

    const descendants = element.querySelectorAll?.('*');
    if (descendants) {
      return [...descendants].some((descendant) => FORM_CONTROL_TAGS.has(descendant.tagName));
    }

    return [...(element.children || [])].some(containsFormControl);
  }
  const OFFICIAL_HOSTS = Object.freeze({
    poe1: 'https://poedb.tw',
    poe2: 'https://poe2db.tw',
  });
  const LANGUAGE_PATHS = Object.freeze({
    en: 'us',
    'zh-CN': 'cn',
    'zh-TW': 'tw',
  });
  const INLINE_TERM_TYPES = new Set([
    'base_item', 'gem', 'item_class', 'league', 'passive_skill', 'site_ui',
    'skill_gem', 'support_gem', 'ui_label', 'unique_item',
  ]);

  function normaliseNumericTemplate(value) {
    return String(value)
      .trim()
      .replace(/([+-]?)\(\s*[+-]?\d+(?:\.\d+)?\s*(?:[-—]\s*[+-]?\d+(?:\.\d+)?\s*)+\)/g, '$1#')
      .replace(/[+-]?\d+(?:\.\d+)?/g, (number) => (number.startsWith('+') || number.startsWith('-') ? `${number[0]}#` : '#'));
  }

  function normaliseLookupText(value) {
    return String(value)
      .replace(/\s+/g, ' ')
      .replace(/([A-Za-z])-\s+([A-Za-z])/g, '$1-$2')
      .replace(/\bSeconds\b/g, 'Second')
      .replace(/\s*\/\s*/g, ' / ')
      .replace(/\s+([,.;:!?])/g, '$1');
  }

  function stripClientMarkup(value, translated = false) {
    return String(value)
      // Rich-text terms use [Tag|Displayed text]. A bare [Tag] is the
      // displayed keyword, except when the source repeats it as [Tag]Tag.
      .replace(/\[([^\]|]+)\|([^\]]+)\]/g, (_match, _tag, display) => display)
      .replace(/\[([^\]]+)\](?=\1\b)/g, '')
      .replace(/\[([^\]]+)\]/g, '$1');
  }

  function preserveWhitespace(value, translated) {
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
    return `${match[1]}${translated}${match[3]}`;
  }

  const DEFAULT_TYPES = [
    'client_term', 'base_item', 'unique_item', 'passive_skill', 'gem',
    'buff', 'word', 'skill_name', 'skill_desc', 'ui_label', 'item_class', 'league',
    'site_ui', 'skill_gem', 'support_gem'
  ];

  function getEntryType(entry, dictionary) {
    if (!entry) return 'client_term';
    if (typeof entry === 'object' && !Array.isArray(entry) && entry.type) return entry.type;
    if (Array.isArray(entry)) {
      const typeVal = entry[1];
      if (typeof typeVal === 'string') return typeVal;
      if (typeof typeVal === 'number') {
        const types = dictionary?.types || DEFAULT_TYPES;
        return types[typeVal] || 'client_term';
      }
    }
    return 'client_term';
  }

  function translatedValue(entry, language, dictionary, source = entry?.en || '') {
    if (!entry) return '';
    if (language === 'zh-TW' && dictionary?.nativeTraditional) {
      const traditional = Array.isArray(entry) ? entry[2] : typeof entry === 'object' ? entry['zh-TW'] : null;
      return stripClientMarkup(traditional || source, true);
    }
    if (typeof entry === 'string') {
      return stripClientMarkup(entry, true);
    }
    if (Array.isArray(entry)) {
      const cn = entry[0] || '';
      if (language === 'zh-TW') {
        return stripClientMarkup(entry[2] || cn, true);
      }
      return stripClientMarkup(cn, true);
    }
    const simplified = entry?.['zh-CN'] || entry?.translation || entry?.en;
    if (language === 'en') return stripClientMarkup(entry?.en || entry?.translation || simplified);
    if (language === 'zh-TW') {
      return stripClientMarkup(entry?.['zh-TW'] || simplified, true);
    }
    return stripClientMarkup(simplified, true);
  }

  // Keep a leading sign in the template. POE2 client terms use keys such as
  // `+{0} Level...`; consuming `+100` as one numeric token would normalize the
  // live text to `# Level...` and make that indexed term unreachable.
  const TERM_NUMBER_RE = /\{\d+(?::[^}]*)?\}|\(\s*[+-]?\d+(?:\.\d+)?\s*[—–-]\s*[+-]?\d+(?:\.\d+)?\s*\)|\d+(?:\.\d+)?|[+-]?#/g;
  const TERM_VALUE_RE = /\(\s*[+-]?\d+(?:\.\d+)?\s*[—–-]\s*[+-]?\d+(?:\.\d+)?\s*\)|\d+(?:\.\d+)?|[+-]?#/g;

  function termTemplate(value, indexedPlaceholders = true) {
    const values = [];
    const pattern = indexedPlaceholders ? TERM_NUMBER_RE : TERM_VALUE_RE;
    const template = String(value).replace(pattern, (match) => {
      values.push(match);
      return '#';
    });
    return { template, values };
  }

  function numericTokenKey(value) {
    return String(value).replace(/\s+/g, '').replace(/[—–]/g, '-');
  }

  function indexedPlaceholder(value) {
    const match = /^\{(\d+)(?::[^}]*)?\}$/.exec(String(value));
    return match ? Number(match[1]) : null;
  }

  function placeholderOrder(sourceValues, translatedValues) {
    if (sourceValues.length !== translatedValues.length) return null;
    const used = new Set();
    const order = [];
    for (const translated of translatedValues) {
      const translatedIndex = indexedPlaceholder(translated);
      if (translatedIndex !== null) {
        const sourceIndex = sourceValues.findIndex((source, candidate) => (
          !used.has(candidate) && indexedPlaceholder(source) === translatedIndex
        ));
        if (sourceIndex < 0) return null;
        used.add(sourceIndex);
        order.push(sourceIndex);
        continue;
      }
      const key = numericTokenKey(translated);
      const index = sourceValues.findIndex((source, candidate) => (
        !used.has(candidate)
          && indexedPlaceholder(source) === null
          && numericTokenKey(source) === key
      ));
      if (index < 0) return null;
      used.add(index);
      order.push(index);
    }
    return order;
  }

  const termIndexCache = new WeakMap();
  const generatedNameComponentCache = new WeakMap();
  const MIXED_TOOLTIP_STOP_WORDS = new Set([
    'after', 'against', 'also', 'and', 'are', 'from', 'have', 'into', 'more', 'onto',
    'that', 'their', 'then', 'this', 'when', 'with', 'your',
  ]);
  const GENERATED_NAME_COMPONENT_TYPES = new Set([
    'base_item', 'client_term', 'keyword', 'passive_skill', 'property', 'unique_item',
  ]);

  function termIndexes(dictionary) {
    if (!dictionary || typeof dictionary !== 'object') {
      return {
        exact: new Map(),
        exactLower: new Map(),
        inlineExact: new Map(),
        inlineExactLower: new Map(),
        templates: new Map(),
        wildcards: [],
        mixedTooltip: [],
      };
    }
    const cached = termIndexCache.get(dictionary);
    if (cached) return cached;

    const exact = new Map();
    const exactLower = new Map();
    const inlineExact = new Map();
    const inlineExactLower = new Map();
    const templates = new Map();
    const wildcards = [];
    const wildcardSeen = new Set();
    const mixedTooltip = [];

    function escapeRegExp(value) {
      return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function wildcardPattern(source) {
      const pattern = [];
      let offset = 0;
      for (const match of String(source).matchAll(/\{(\d+)(?::[^}]*)?\}/g)) {
        pattern.push(escapeRegExp(source.slice(offset, match.index)));
        pattern.push('([\\s\\S]+?)');
        offset = match.index + match[0].length;
      }
      if (!pattern.length) return null;
      pattern.push(escapeRegExp(source.slice(offset)));
      return new RegExp(`^${pattern.join('')}$`, 'i');
    }

    function addMixedTooltipCandidate(english, entry) {
      const source = normaliseLookupText(stripClientMarkup(english));
      const cn = typeof entry === 'string' ? entry : (Array.isArray(entry) ? entry[0] : entry?.['zh-CN']);
      if (source.length < 40 || !cn) return;
      const words = [...new Set((source.match(/[A-Za-z][A-Za-z'’-]*/g) || [])
        .map((word) => word.toLowerCase())
        .filter((word) => word.length >= 4 && !MIXED_TOOLTIP_STOP_WORDS.has(word)))];
      if (words.length >= 4) {
        const normalized = typeof entry === 'object' && !Array.isArray(entry)
          ? { ...entry, en: entry.en || source }
          : { translation: cn, en: source };
        mixedTooltip.push({ source, words, entry: normalized });
      }
    }

    function indexEntry(english, entry, allowInline) {
      if (!entry) return;
      const source = normaliseLookupText(stripClientMarkup(english));
      if (!source) return;
      const normalizedEntry = typeof entry === 'string'
        ? { translation: entry, en: source }
        : (Array.isArray(entry)
          ? { translation: entry[0], 'zh-TW': entry[2] || (dictionary.nativeTraditional ? source : entry[0]), type: getEntryType(entry, dictionary), en: source }
          : { ...entry, en: entry.en || source });
      if (!exact.has(source)) exact.set(source, normalizedEntry);
      if (!exactLower.has(source.toLowerCase())) exactLower.set(source.toLowerCase(), normalizedEntry);
      if (allowInline) {
        if (!inlineExact.has(source)) inlineExact.set(source, normalizedEntry);
        if (!inlineExactLower.has(source.toLowerCase())) inlineExactLower.set(source.toLowerCase(), normalizedEntry);
      }
      const sourcePart = termTemplate(source);
      if (!sourcePart.values.length) return;
      const byLanguage = {};
      for (const language of ['zh-CN', 'zh-TW']) {
        const translated = translatedValue(normalizedEntry, language, dictionary);
        if (!translated) continue;
        const translatedPart = termTemplate(translated);
        const order = placeholderOrder(sourcePart.values, translatedPart.values);
        if (order) byLanguage[language] = { template: translatedPart.template, order };
      }
      if (Object.keys(byLanguage).length) {
        const existing = templates.get(sourcePart.template);
        const indexed = sourcePart.values.some((value) => indexedPlaceholder(value) !== null);
        const existingIndexed = existing
          ? termTemplate(existing.source, true).values.some((value) => indexedPlaceholder(value) !== null)
          : false;
        if (!existing || (indexed && !existingIndexed)) {
          templates.set(sourcePart.template, { source, entry: normalizedEntry, byLanguage });
        }
      }

      if (sourcePart.values.some((value) => indexedPlaceholder(value) !== null)) {
        // Generic client templates such as `{0}` or `{0} {1}` are not
        // translatable phrases. If indexed as wildcard terms they steal
        // complete item names and reorder their words before name parsing.
        const literalSource = source.replace(/\{\d+(?::[^}]*)?\}/g, '').trim();
        const literalLetters = literalSource.replace(/[^A-Za-z]+/g, '');
        if (!literalSource || literalLetters.length < 3) return;
        const regex = wildcardPattern(source);
        const key = `${source}\u0000${sourcePart.values.join(',')}`;
        if (regex && !wildcardSeen.has(key)) {
          wildcardSeen.add(key);
          wildcards.push({ source, entry: normalizedEntry, regex, byLanguage });
        }
      }
    }
    for (const [english, entry] of Object.entries(dictionary.terms || {})) {
      const type = getEntryType(entry, dictionary);
      const allowInline = INLINE_TERM_TYPES.has(type)
        || (type === 'client_term' && /\s/.test(String(english).trim()));
      indexEntry(english, entry, allowInline);
      const sourceLines = String(english).replace(/\r\n/g, '\n').split('\n');
      const cnTrans = typeof entry === 'string' ? entry : (Array.isArray(entry) ? entry[0] : entry?.translation);
      const translatedLines = String(cnTrans || '').replace(/\r\n/g, '\n').split('\n');
      const twTrans = Array.isArray(entry) ? entry[2] : entry?.['zh-TW'];
      const traditionalLines = typeof twTrans === 'string' ? twTrans.replace(/\r\n/g, '\n').split('\n') : [];
      if (sourceLines.length <= 1 || sourceLines.length !== translatedLines.length) continue;
      sourceLines.forEach((line, index) => {
        if (!line.trim() || !translatedLines[index]?.trim()) return;
        const tw = traditionalLines.length === sourceLines.length ? traditionalLines[index] : undefined;
        indexEntry(line, [translatedLines[index], type, tw || (dictionary.nativeTraditional ? line : undefined)], allowInline);
      });
    }
    for (const [english, entry] of Object.entries(dictionary.ui || {})) {
      indexEntry(english, entry, true);
    }
    let tooltipEntries = [];
    try {
      tooltipEntries = Object.entries(dictionary.tooltip || {});
    } catch {
      // Some callers intentionally provide a non-enumerable tooltip map for
      // unmatched text; the normal exact/template paths remain sufficient.
    }
    for (const [english, entry] of tooltipEntries) addMixedTooltipCandidate(english, entry);
    wildcards.sort((left, right) => right.source.length - left.source.length);
    const indexes = {
      exact,
      exactLower,
      inlineExact,
      inlineExactLower,
      templates,
      wildcards,
      mixedTooltip,
    };
    termIndexCache.set(dictionary, indexes);
    return indexes;
  }

  function translateMixedTooltipLine(value, dictionary, language, indexes) {
    if (language === 'en' || !/[㐀-鿿]/.test(value)) return null;
    const lookup = normaliseLookupText(stripClientMarkup(value)).toLowerCase();
    let best = null;
    for (const candidate of indexes.mixedTooltip || []) {
      const matched = candidate.words.filter((word) => lookup.includes(word));
      const required = Math.max(4, Math.ceil(candidate.words.length * 0.45));
      if (matched.length < required) continue;
      const translated = translatedValue(candidate.entry, language, dictionary);
      if (!translated || !/[㐀-鿿]/.test(translated)) continue;
      const score = matched.length / candidate.words.length;
      if (!best || score > best.score || (score === best.score && String(candidate.source || '').length > String(best.source || '').length)) {
        best = { score, translated, source: candidate.source };
      }
    }
    return best?.translated || null;
  }

  function generatedNameComponents(dictionary, language) {
    if (!dictionary || typeof dictionary !== 'object') return new Map();
    let cached = generatedNameComponentCache.get(dictionary);
    if (!cached) {
      cached = new Map();
      const add = (english, entry, section) => {
        const source = normaliseLookupText(stripClientMarkup(english)).trim();
        if (!source || /[.!?;,:]$/.test(source)) return;
        const type = section === 'items' ? 'base_item' : getEntryType(entry, dictionary);
        if (section !== 'items' && !GENERATED_NAME_COMPONENT_TYPES.has(type)) return;
        const words = source.split(/\s+/);
        if (words.length > 6 || words.some((word) => (
          !/^[A-Za-z\u00c0-\u024f][A-Za-z\u00c0-\u024f'’\-]*$/.test(word)
          && !/^(of|the|and|or|in|on|to)$/i.test(word)
        ))) return;
        const key = source.toLowerCase();
        if (!cached.has(key) || type === 'base_item' || section === 'items') {
          cached.set(key, { ...(typeof entry === 'object' && !Array.isArray(entry) ? entry : { raw: entry }), type, en: source, nameSource: source });
        }
      };
      for (const [english, entry] of Object.entries(dictionary.terms || {})) add(english, entry, 'terms');
      for (const [english, entry] of Object.entries(dictionary.items || {})) add(english, entry, 'items');
      generatedNameComponentCache.set(dictionary, cached);
    }
    return cached;
  }

  function generatedNameSegments(source, dictionary) {
    const words = String(source).trim().split(/\s+/);
    if (words.length < 2 || words.length > 12) return null;
    const components = generatedNameComponents(dictionary);
    const memo = new Map();

    function solve(index) {
      if (index === words.length) return [];
      if (memo.has(index)) return memo.get(index);
      let best = null;
      for (let end = words.length; end > index; end -= 1) {
        const key = words.slice(index, end).join(' ').toLowerCase();
        const entry = components.get(key);
        if (!entry) continue;
        const tail = solve(end);
        if (!tail) continue;
        const candidate = [{ source: words.slice(index, end).join(' '), entry }, ...tail];
        if (!best || candidate.length < best.length) best = candidate;
      }
      memo.set(index, best);
      return best;
    }

    const segments = solve(0);
    if (!segments || segments.length < 2) return null;
    const hasBase = segments.some(({ entry }) => getEntryType(entry, dictionary) === 'base_item');
    if (!hasBase && segments.length > 2) return null;
    return segments;
  }

  function composeGeneratedName(source, dictionary, language) {
    const segments = generatedNameSegments(source, dictionary);
    if (!segments) return null;
    if (language === 'zh-TW' && dictionary.nativeTraditional && segments.some(({ entry, source: part }) => !entry['zh-TW'] || entry['zh-TW'] === part)) return null;
    const translated = segments.map(({ source: segmentSource, entry }) => translatedValue(
      { ...entry, en: segmentSource },
      language,
      dictionary,
    ));
    return translated.every(Boolean) ? translated.join('') : null;
  }

  function composeGeneratedRareName(source, dictionary, language) {
    const segments = generatedNameSegments(source, dictionary);
    if (!segments || segments.length !== 2 || segments.some(({ entry }) => getEntryType(entry, dictionary) === 'base_item')) return null;
    if (language === 'zh-TW' && dictionary.nativeTraditional && segments.some(({ entry, source: part }) => !entry['zh-TW'] || entry['zh-TW'] === part)) return null;
    return segments.map(({ source: segmentSource, entry }) => translatedValue(
      { ...entry, en: segmentSource },
      language,
      dictionary,
    )).join('');
  }

  function composeGeneratedNameWithBase(source, dictionary, language) {
    const segments = generatedNameSegments(source, dictionary);
    if (!segments || !segments.some(({ entry }) => getEntryType(entry, dictionary) === 'base_item')) return null;
    if (language === 'zh-TW' && dictionary.nativeTraditional && segments.some(({ entry, source: part }) => !entry['zh-TW'] || entry['zh-TW'] === part)) return null;
    return segments.map(({ source: segmentSource, entry }) => translatedValue(
      { ...entry, en: segmentSource },
      language,
      dictionary,
    )).join('');
  }

  function translateKnownNamePrefix(source, dictionary, language) {
    const value = normaliseLookupText(source).trim();
    if (!value) return '';
    const words = value.split(/\s+/);
    const components = generatedNameComponents(dictionary);
    const segments = [];

    for (let index = 0; index < words.length;) {
      let matched = null;
      for (let end = words.length; end > index; end -= 1) {
        const candidate = words.slice(index, end).join(' ');
        const entry = components.get(candidate.toLowerCase());
        if (entry) {
          matched = { source: candidate, entry };
          index = end;
          break;
        }
      }
      if (matched) {
        segments.push({
          text: translatedValue({ ...matched.entry, en: matched.source }, language, dictionary) || matched.source,
          known: true,
        });
      } else {
        segments.push({ text: words[index], known: false });
        index += 1;
      }
    }

    return segments.reduce((result, segment, index) => {
      if (index === 0) return segment.text;
      const previous = segments[index - 1];
      return `${result}${previous.known && segment.known ? '' : ' '}${segment.text}`;
    }, '');
  }

  function composeKnownBaseSuffix(source, dictionary, language) {
    const value = String(source).trim();
    if (value.length < 3) return null;
    const components = generatedNameComponents(dictionary);

    for (let index = 1; index < value.length; index += 1) {
      const first = value[index];
      const previous = value[index - 1];
      if (!/[A-Z]/.test(first) || (!/\s/.test(previous) && !/[a-z]/.test(previous))) continue;

      const suffix = value.slice(index);
      const normalisedSuffix = normaliseLookupText(suffix);
      const words = normalisedSuffix.split(/\s+/);
      // A generated title may end in a single-word base item such as
      // `Emerald`; the original multi-word guard missed those names when the
      // rare name and base were concatenated by the heading DOM.
      if (words.length < 1) continue;
      if (/[,;\r\n]/.test(value.slice(0, index))) continue;
      const entry = components.get(normalisedSuffix.toLowerCase());
      if (!entry) continue;

      const isBaseItem = getEntryType(entry, dictionary) === 'base_item';
      const isRuneforgedBase = /^Runeforged\s+/i.test(normalisedSuffix)
        && getEntryType(components.get(normalisedSuffix.replace(/^Runeforged\s+/i, '').toLowerCase()), dictionary) === 'base_item';
      if (!isBaseItem && !isRuneforgedBase) continue;

      const translated = translatedValue({ ...entry, en: normalisedSuffix }, language, dictionary);
      if (translated) {
        const prefix = translateKnownNamePrefix(value.slice(0, index), dictionary, language);
        return `${prefix}${translated}`;
      }
    }
    return null;
  }

  function applyTemplate(template, captures) {
    let index = 0;
    return template.replace(/#/g, () => captures[index++] ?? '#');
  }

  function capturesForLanguage(entry, language, captures) {
    const order = entry?.placeholderOrder?.[language];
    if (!Array.isArray(order) || order.length !== captures.length) return captures;
    return order.map((sourceIndex) => captures[sourceIndex] ?? '#');
  }

  function inferredPlaceholderOrder(sourceTemplate, translatedTemplate, count) {
    if (count !== 2) return null;
    const source = String(sourceTemplate);
    const translated = String(translatedTemplate);
    // Older hand-authored entries may lack placeholderOrder. Handle the common
    // recovery-duration wording without overriding official metadata.
    if (/Life over # Second\b/i.test(source) && /秒内回复[\s\S]*生命/.test(translated)) {
      return [1, 0];
    }
    return null;
  }

  function numericCaptures(source, template) {
    const values = [...String(source).matchAll(/[+-]?\d+(?:\.\d+)?|[+-]?\(\s*[+-]?\d+(?:\.\d+)?\s*(?:[-—]\s*[+-]?\d+(?:\.\d+)?\s*)+\)/g)]
      .map((match) => match[0]);
    const placeholders = [...String(template).matchAll(/#/g)];
    return values.map((value, index) => {
      const prefix = template[placeholders[index]?.index - 1];
      return (prefix === '+' || prefix === '-') && value.startsWith(prefix)
        ? value.slice(1)
        : value;
    });
  }

  function numericTemplateCandidates(source) {
    const normalised = normaliseNumericTemplate(source);
    const captures = numericCaptures(source, normalised);
    const placeholders = [...normalised.matchAll(/#/g)];
    if (!captures.length || captures.length !== placeholders.length || captures.length > 12) {
      return [normalised];
    }

    const candidates = [];
    const total = 2 ** captures.length;
    for (let mask = 0; mask < total; mask += 1) {
      let offset = 0;
      let result = '';
      for (let index = 0; index < placeholders.length; index += 1) {
        const placeholder = placeholders[index];
        result += normalised.slice(offset, placeholder.index);
        result += (mask & (1 << index)) ? captures[index] : '#';
        offset = placeholder.index + 1;
      }
      candidates.push(result + normalised.slice(offset));
    }
    return candidates;
  }

  function translateRequirementAttributes(text, dictionary, language, indexes) {
    const trimmed = text.trim();
    const exact = dictionary?.ui?.[trimmed]
      ?? indexes?.inlineExact?.get(trimmed)
      ?? indexes?.inlineExactLower?.get(trimmed.toLowerCase())
      ?? dictionary?.terms?.[trimmed];
    if (exact) {
      const trans = translatedValue(exact, language, dictionary, trimmed);
      if (trans) return trans;
    }
    return text.replace(/\b(Str|Dex|Int|Strength|Dexterity|Intelligence|Level)\b/g, (match) => {
      const entry = dictionary?.ui?.[match]
        ?? indexes?.inlineExact?.get(match)
        ?? indexes?.inlineExactLower?.get(match.toLowerCase())
        ?? dictionary?.terms?.[match];
      if (!entry) return match;
      return translatedValue(entry, language, dictionary, match) || match;
    });
  }

  function translateControlledUiValue(source, dictionary, language, indexes, translateTail) {
    const match = /^(.+?)[：:]\s*(\S[\s\S]*?)$/.exec(source);
    if (!match) return null;
    const label = normaliseLookupText(match[1]);
    const entry = dictionary?.ui?.[label]
      ?? dictionary?.ui?.[`${label}:`]
      ?? dictionary?.ui?.[`${label}：`]
      ?? indexes?.inlineExact?.get(label)
      ?? indexes?.inlineExactLower?.get(label.toLowerCase());
    if (!entry) return null;
    const translated = translatedValue(entry, language, dictionary);
    if (!translated) return null;
    const rawTail = match[2];
    let tail = typeof translateTail === 'function'
      ? translateTail(rawTail)
      : rawTail;
    tail = translateRequirementAttributes(tail, dictionary, language, indexes);
    return `${String(translated).replace(/[：:]\s*$/, '')}：${tail}`;
  }

  function translatePoeNinjaDynamic(source, language) {
    const value = normaliseLookupText(source);
    let match = /^(Week|Day|Hour)\s+(\d+)$/.exec(value);
    if (match) {
      const units = language === 'zh-TW'
        ? { Week: '週', Day: '天', Hour: '小時' }
        : { Week: '周', Day: '天', Hour: '小时' };
      return `第${match[2]}${units[match[1]]}`;
    }
    match = /^(\d+)\s+days?\s+ago$/i.exec(value);
    if (match) return `${match[1]}${language === 'zh-TW' ? '天前' : '天前'}`;
    match = /^Act\s+(\d+)$/i.exec(value);
    if (match) return `第${match[1]}幕`;
    match = /^Found\s+([\d,]+)\s+characters?\.?$/i.exec(value);
    if (match) {
      const suffix = language === 'zh-TW' ? '個角色' : '个角色';
      return `找到 ${match[1]} ${suffix}。`;
    }
    return null;
  }

  function translateAllocatedPassiveSkill(source, dictionary, language, indexes) {
    const match = /^Allocates\s+(.+)$/.exec(source);
    if (!match) return null;
    const target = normaliseLookupText(match[1]);
    const entry = indexes.inlineExact.get(target)
      ?? indexes.inlineExactLower.get(target.toLowerCase());
    if (getEntryType(entry, dictionary) !== 'passive_skill') return null;
    const translated = translatedValue(entry, language, dictionary);
    if (!translated) return null;
    return `${language === 'zh-TW' ? '配置' : '分配'} ${translated}`;
  }

  const TAG_ENTRY_TYPES = new Set([
    'gem', 'skill_gem', 'support_gem', 'item_class', 'keyword', 'property', 'passive_skill',
  ]);

  const RARITY_PREFIX_MAP = {
    Normal: { 'zh-CN': '普通', 'zh-TW': '普通' },
    Magic: { 'zh-CN': '魔法', 'zh-TW': '魔法' },
    Rare: { 'zh-CN': '稀有', 'zh-TW': '稀有' },
    Unique: { 'zh-CN': '传奇', 'zh-TW': '傳奇' },
  };

  const ITEM_CATEGORY_MAP = {
    Ring: { 'zh-CN': '戒指', 'zh-TW': '戒指' },
    Amulet: { 'zh-CN': '护身符', 'zh-TW': '護身符' },
    Jewel: { 'zh-CN': '珠宝', 'zh-TW': '珠寶' },
    Flask: { 'zh-CN': '药剂', 'zh-TW': '藥劑' },
    Charm: { 'zh-CN': '咒符', 'zh-TW': '咒符' },
    Boots: { 'zh-CN': '鞋子', 'zh-TW': '鞋子' },
    Gloves: { 'zh-CN': '手套', 'zh-TW': '手套' },
    Helmet: { 'zh-CN': '头盔', 'zh-TW': '頭盔' },
    'Body Armour': { 'zh-CN': '胸甲', 'zh-TW': '胸甲' },
    Shield: { 'zh-CN': '盾牌', 'zh-TW': '盾牌' },
    Buckler: { 'zh-CN': '圆盾', 'zh-TW': '圓盾' },
    Focus: { 'zh-CN': '法器', 'zh-TW': '法器' },
    Quiver: { 'zh-CN': '箭袋', 'zh-TW': '箭袋' },
    Talisman: { 'zh-CN': '魔符', 'zh-TW': '魔符' },
    Belt: { 'zh-CN': '腰带', 'zh-TW': '腰帶' },
    Weapon: { 'zh-CN': '武器', 'zh-TW': '武器' },
    'One Hand Weapon': { 'zh-CN': '单手武器', 'zh-TW': '單手武器' },
    'Two Hand Weapon': { 'zh-CN': '双手武器', 'zh-TW': '雙手武器' },
    Bow: { 'zh-CN': '弓', 'zh-TW': '弓' },
    Crossbow: { 'zh-CN': '弩', 'zh-TW': '弩' },
    Wand: { 'zh-CN': '法杖', 'zh-TW': '法杖' },
    Sceptre: { 'zh-CN': '权杖', 'zh-TW': '權杖' },
    Staff: { 'zh-CN': '长杖', 'zh-TW': '長杖' },
    Staves: { 'zh-CN': '长杖', 'zh-TW': '長杖' },
    Mace: { 'zh-CN': '单手锤', 'zh-TW': '單手槌' },
    'Two Handed Mace': { 'zh-CN': '双手锤', 'zh-TW': '雙手槌' },
    'Two Hand Mace': { 'zh-CN': '双手锤', 'zh-TW': '雙手槌' },
    'One Handed Mace': { 'zh-CN': '单手锤', 'zh-TW': '單手槌' },
    'One Hand Mace': { 'zh-CN': '单手锤', 'zh-TW': '單手槌' },
    Sword: { 'zh-CN': '单手剑', 'zh-TW': '單手劍' },
    'Two Handed Sword': { 'zh-CN': '双手剑', 'zh-TW': '雙手劍' },
    'Two Hand Sword': { 'zh-CN': '双手剑', 'zh-TW': '雙手劍' },
    'One Handed Sword': { 'zh-CN': '单手剑', 'zh-TW': '單手劍' },
    'One Hand Sword': { 'zh-CN': '单手剑', 'zh-TW': '單手劍' },
    Axe: { 'zh-CN': '单手斧', 'zh-TW': '單手斧' },
    'Two Handed Axe': { 'zh-CN': '双手斧', 'zh-TW': '雙手斧' },
    'Two Hand Axe': { 'zh-CN': '双手斧', 'zh-TW': '雙手斧' },
    'One Handed Axe': { 'zh-CN': '单手斧', 'zh-TW': '單手斧' },
    'One Hand Axe': { 'zh-CN': '单手斧', 'zh-TW': '單手斧' },
    Flail: { 'zh-CN': '连枷', 'zh-TW': '連枷' },
    Spear: { 'zh-CN': '长矛', 'zh-TW': '長矛' },
    Quarterstaff: { 'zh-CN': '武僧杖', 'zh-TW': '武僧杖' },
    Claw: { 'zh-CN': '爪', 'zh-TW': '爪' },
    Dagger: { 'zh-CN': '匕首', 'zh-TW': '匕首' },
    Unarmed: { 'zh-CN': '徒手', 'zh-TW': '徒手' },
    Unknown: { 'zh-CN': '未知', 'zh-TW': '未知' },
    Relic: { 'zh-CN': '圣物', 'zh-TW': '聖物' },
    Waystone: { 'zh-CN': '路标石', 'zh-TW': '路標石' },
    Map: { 'zh-CN': '地图', 'zh-TW': '地圖' },
    Barya: { 'zh-CN': '巴亚', 'zh-TW': '巴亞' },
  };

  function translateSingleWeaponComponent(part, dictionary, language) {
    const trimmed = String(part).trim();
    if (!trimmed) return '';
    if (language === 'zh-TW' && dictionary.nativeTraditional) {
      const native = dictionary.items?.[trimmed] || dictionary.terms?.[trimmed] || dictionary.ui?.[trimmed];
      if (native) return translatedValue(native, language, dictionary, trimmed);
    }
    const exact = ITEM_CATEGORY_MAP[trimmed];
    if (exact) return exact[language] || exact['zh-CN'];

    const dualMatch = /^Dual\s+(.+)$/i.exec(trimmed);
    if (dualMatch) {
      const sub = translateSingleWeaponComponent(dualMatch[1], dictionary, language);
      const prefix = language === 'zh-TW' ? '雙持' : '双持';
      return `${prefix}${sub}`;
    }

    const dictEntry = dictionary?.ui?.[trimmed]
      ?? dictionary?.terms?.[trimmed]
      ?? dictionary?.items?.[trimmed];
    if (dictEntry) {
      return translatedValue(dictEntry, language, dictionary, trimmed);
    }
    return trimmed;
  }

  function translateWeaponConfiguration(source, dictionary, language) {
    const text = String(source).trim();
    if (!text) return null;

    if (/^Dual\s+/i.test(text)) {
      return translateSingleWeaponComponent(text, dictionary, language);
    }

    if (text.includes('/')) {
      const parts = text.split(/\s*\/\s*/);
      if (parts.length >= 2) {
        let changed = false;
        const translatedParts = parts.map((part) => {
          const trans = translateSingleWeaponComponent(part, dictionary, language);
          if (trans && trans !== part) changed = true;
          return trans || part;
        });
        if (changed) {
          return translatedParts.join(' / ');
        }
      }
    }
    return null;
  }

  function translateRarityCategory(source, dictionary, language) {
    const match = /^(Normal|Magic|Rare|Unique)\s+(.+)$/i.exec(String(source).trim());
    if (!match) return null;
    const rarityPrefix = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    const rarity = RARITY_PREFIX_MAP[rarityPrefix]?.[language] || rarityPrefix;
    const categoryKey = match[2].trim();
    const nativeCategory = language === 'zh-TW' && dictionary.nativeTraditional
      ? dictionary.items?.[categoryKey] || dictionary.terms?.[categoryKey] || dictionary.ui?.[categoryKey] : null;
    const categoryEntry = nativeCategory ?? ITEM_CATEGORY_MAP[categoryKey]
      ?? dictionary?.ui?.[categoryKey]
      ?? dictionary?.terms?.[categoryKey];
    let category = '';
    if (categoryEntry) {
      category = typeof categoryEntry === 'object' && !Array.isArray(categoryEntry) && (categoryEntry['zh-CN'] || categoryEntry['zh-TW'])
        ? (language === 'zh-TW' ? categoryEntry['zh-TW'] || (dictionary.nativeTraditional ? categoryKey : categoryEntry['zh-CN']) : categoryEntry['zh-CN'])
        : translatedValue(categoryEntry, language, dictionary);
    }
    if (category) {
      return `${rarity}${category}`;
    }
    return null;
  }

  function translateDelimitedTagList(source, dictionary, language, indexes) {
    const parts = String(source).split(/([,;])/);
    const values = parts.filter((part) => !/^[,;]$/.test(part) && part.trim());
    if (values.length < 2) return null;

    let changed = false;
    let complete = true;
    const translated = parts.map((part) => {
      if (/^[,;]$/.test(part) || !part.trim()) return part;
      const key = normaliseLookupText(part.trim());
      const entry = indexes.exact.get(key) ?? indexes.exactLower.get(key.toLowerCase());
      const looksLikeTag = entry && (
        TAG_ENTRY_TYPES.has(getEntryType(entry, dictionary))
        || (/^[A-Z][A-Za-z'’ -]*$/.test(key) && !/\s{2,}/.test(part))
      );
      if (!looksLikeTag) {
        complete = false;
        return part;
      }
      const value = translatedValue(entry, language, dictionary);
      if (!value) {
        complete = false;
        return part;
      }
      const result = preserveWhitespace(part, value);
      changed ||= result !== part;
      return result;
    });
    return complete && changed
      ? translated.join('')
      : null;
  }

  function translateWildcardTerm(source, dictionary, language, indexes) {
    for (const candidate of indexes.wildcards || []) {
      const match = candidate.regex.exec(source);
      if (!match) continue;
      const translated = candidate.byLanguage?.[language];
      if (!translated) continue;
      const captures = match.slice(1).map((capture) => {
        const direct = translateWholeLine(capture, dictionary, language);
        if (direct !== capture) return direct;
        const punctuationNormalised = capture.replace(/\.\s+(?=[A-Z])/g, ' ');
        if (punctuationNormalised !== capture) {
          const recovered = translateWholeLine(punctuationNormalised, dictionary, language);
          if (recovered !== punctuationNormalised) return recovered;
        }
        return capture;
      });
      const orderedCaptures = translated.order.map((index) => captures[index] ?? '');
      return applyTemplate(translated.template, orderedCaptures);
    }
    return null;
  }

  function translateWholeLine(value, dictionary, language) {
    if (typeof value !== 'string' || language === 'en') return value;
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
    const source = match[2];
    if (!source) return value;

    const lookupSource = normaliseLookupText(stripClientMarkup(source));
    const termIndexesForDictionary = termIndexes(dictionary);
    const exactEntry = dictionary?.items?.[lookupSource]
      ?? dictionary?.stats?.[lookupSource]
      ?? dictionary?.tooltip?.[lookupSource]
      ?? dictionary?.ui?.[lookupSource]
      ?? termIndexesForDictionary.exact.get(lookupSource)
      ?? termIndexesForDictionary.exactLower.get(lookupSource.toLowerCase());
    if (exactEntry) {
      return preserveWhitespace(value, translatedValue(exactEntry, language, dictionary, lookupSource));
    }

    // 相对时间匹配 (如 42 hours ago / 2 days ago / 5 minutes ago)
    const timeAgoMatch = /^(\d+)\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago$/i.exec(source);
    if (timeAgoMatch) {
      const num = timeAgoMatch[1];
      const unit = timeAgoMatch[2].toLowerCase();
      const isZhTw = language === 'zh-TW';
      let unitZh = '秒';
      if (unit.startsWith('min')) unitZh = isZhTw ? '分鐘' : '分钟';
      else if (unit.startsWith('hour')) unitZh = isZhTw ? '小時' : '小时';
      else if (unit.startsWith('day')) unitZh = '天';
      else if (unit.startsWith('week')) unitZh = '周';
      else if (unit.startsWith('month')) unitZh = isZhTw ? '個月' : '个月';
      else if (unit.startsWith('year')) unitZh = '年';
      return preserveWhitespace(value, `${num} ${unitZh}前`);
    }

    // 带尖括号的前后导航匹配 (如 "< Previous" 或 "Next >")
    const navMatch = /^([<«‹]?)\s*(Previous|Next|Back)\s*([>»›]?)$/i.exec(source);
    if (navMatch) {
      const leftArrow = navMatch[1] ? `${navMatch[1]} ` : '';
      const rightArrow = navMatch[3] ? ` ${navMatch[3]}` : '';
      const word = navMatch[2].toLowerCase();
      const isZhTw = language === 'zh-TW';
      let label = word;
      if (word === 'previous') label = isZhTw ? '上一個' : '上一个';
      else if (word === 'next') label = isZhTw ? '下一個' : '下一个';
      else if (word === 'back') label = isZhTw ? '返回' : '返回';
      return preserveWhitespace(value, `${leftArrow}${label}${rightArrow}`);
    }

    // 时光机周期快照匹配 (如 Week 12 / Day 6 / Hour 18 / Snapshot 1)
    const timeMachineMatch = /^(Week|Day|Hour|Minute|Snapshot)\s+(\d+)$/i.exec(source);
    if (timeMachineMatch) {
      const type = timeMachineMatch[1].toLowerCase();
      const num = timeMachineMatch[2];
      const isZhTw = language === 'zh-TW';
      if (type === 'week') return preserveWhitespace(value, `第 ${num} ${isZhTw ? '週' : '周'}`);
      if (type === 'day') return preserveWhitespace(value, `第 ${num} 天`);
      if (type === 'hour') return preserveWhitespace(value, `第 ${num} ${isZhTw ? '小時' : '小时'}`);
      if (type === 'minute') return preserveWhitespace(value, `第 ${num} ${isZhTw ? '分鐘' : '分钟'}`);
      if (type === 'snapshot') return preserveWhitespace(value, `快照 ${num}`);
    }

    const badgeMatch = /^([\s\S]+?)(?:\s+|\s*\()(local|pseudo|unmatched)\)?\s*$/i.exec(source)
      || /^([\s\S]+?)(local|pseudo|unmatched)$/i.exec(source);
    if (badgeMatch) {
      const mainText = badgeMatch[1].trim();
      const badgeType = badgeMatch[2].toLowerCase();
      const translatedMain = translateWholeLine(mainText, dictionary, language);
      if (translatedMain !== mainText) {
        const badgeLabel = {
          local: '本地',
          pseudo: '综合',
          unmatched: '未匹配',
        }[badgeType] || badgeType;
        return preserveWhitespace(value, `${translatedMain} ${badgeLabel}`);
      }
    }

    const percentageMatch = !/[：:]/.test(source) && /^([\s\S]+?)(\s*[\d.]+\s*%\s*)$/i.exec(source);
    if (percentageMatch) {
      const mainText = percentageMatch[1].trim();
      const pctText = percentageMatch[2];
      const translatedMain = translateWholeLine(mainText, dictionary, language);
      if (translatedMain !== mainText) {
        return preserveWhitespace(value, `${translatedMain} ${pctText.trim()}`);
      }
    }

    const pseudoTotalMatch = /^([+-]?\d+(?:\.\d+)?%?)\s+total\s+(.+)$/i.exec(source);
    if (pseudoTotalMatch) {
      const valStr = pseudoTotalMatch[1];
      const statName = pseudoTotalMatch[2].trim();
      const translatedStat = translateInlineText(statName, dictionary, language);
      if (translatedStat !== statName) {
        return preserveWhitespace(value, `${translatedStat}总和 ${valStr}`);
      }
    }

    const pseudoIncMatch = /^([+-]?\d+(?:\.\d+)?%?)\s+total\s+increased\s+(.+)$/i.exec(source);
    if (pseudoIncMatch) {
      const valStr = pseudoIncMatch[1];
      const statName = pseudoIncMatch[2].trim();
      const translatedStat = translateInlineText(statName, dictionary, language);
      return preserveWhitespace(value, `${translatedStat}提高 ${valStr} (综合)`);
    }

    const mixedTooltipTranslation = translateMixedTooltipLine(
      source,
      dictionary,
      language,
      termIndexesForDictionary,
    );
    if (mixedTooltipTranslation) {
      return preserveWhitespace(value, mixedTooltipTranslation);
    }

    const normalisedCandidates = numericTemplateCandidates(lookupSource);
    let normalised = normalisedCandidates[0];
    let templateEntry;
    for (const candidate of normalisedCandidates) {
      templateEntry = dictionary?.tooltip?.[candidate]
        ?? dictionary?.stats?.[candidate];
      if (templateEntry) {
        normalised = candidate;
        break;
      }
    }
    if (!templateEntry) {
      normalised = normaliseNumericTemplate(lookupSource);
      templateEntry = termIndexesForDictionary.templates.get(termTemplate(lookupSource, false).template);
    }
    if (templateEntry) {
      if (templateEntry.byLanguage) {
        const sourcePart = termTemplate(lookupSource, false);
        const translatedPart = templateEntry.byLanguage[language];
        if (!translatedPart) return value;
        const captures = sourcePart.values;
        const orderedCaptures = translatedPart.order.map((index) => captures[index] ?? '#');
        return preserveWhitespace(
          value,
          applyTemplate(translatedPart.template, orderedCaptures),
        );
      }
      const translated = translatedValue(templateEntry, language, dictionary, normalised);
      const fallbackOrder = inferredPlaceholderOrder(
        templateEntry.en || normalised,
        translated,
        numericCaptures(source, normalised).length,
      );
      return preserveWhitespace(value, applyTemplate(
        translated,
        fallbackOrder
          ? fallbackOrder.map((index) => numericCaptures(source, normalised)[index] ?? '#')
          : capturesForLanguage(templateEntry, language, numericCaptures(source, normalised)),
      ));
    }

    const rarityCategory = translateRarityCategory(lookupSource, dictionary, language);
    if (rarityCategory) return preserveWhitespace(value, rarityCategory);

    const weaponConfig = translateWeaponConfiguration(lookupSource, dictionary, language);
    if (weaponConfig) return preserveWhitespace(value, weaponConfig);

    const translatedUiValue = translateControlledUiValue(
      lookupSource,
      dictionary,
      language,
      termIndexesForDictionary,
      (tail) => {
        return translateWholeLine(tail, dictionary, language);
      },
    );
    if (translatedUiValue) return preserveWhitespace(value, translatedUiValue);

    const colonMatch = /^([A-Za-z]+):\s*(.+)$/i.exec(source);
    if (colonMatch && !dictionary?.items?.[lookupSource]) {
      const prefix = colonMatch[1].trim();
      const body = colonMatch[2].trim();
      const translatedPrefix = translateInlineText(prefix, dictionary, language);
      const translatedBody = translateWholeLine(body, dictionary, language);
      if (translatedBody !== body || translatedPrefix !== prefix) {
        return preserveWhitespace(value, `${translatedPrefix}: ${translatedBody}`);
      }
    }

    const translatedDynamic = translatePoeNinjaDynamic(lookupSource, language);
    if (translatedDynamic) return preserveWhitespace(value, translatedDynamic);

    const allocatedPassiveSkill = translateAllocatedPassiveSkill(
      lookupSource,
      dictionary,
      language,
      termIndexesForDictionary,
    );
    if (allocatedPassiveSkill) return preserveWhitespace(value, allocatedPassiveSkill);

    const translatedTagList = translateDelimitedTagList(
      lookupSource,
      dictionary,
      language,
      termIndexesForDictionary,
    );
    if (translatedTagList) return preserveWhitespace(value, translatedTagList);

    const translatedWildcard = translateWildcardTerm(
      lookupSource,
      dictionary,
      language,
      termIndexesForDictionary,
    );
    if (translatedWildcard) return preserveWhitespace(value, translatedWildcard);

    const generatedName = composeGeneratedRareName(source, dictionary, language);
    if (generatedName) return preserveWhitespace(value, generatedName);

    const knownBaseSuffix = composeKnownBaseSuffix(source, dictionary, language);
    if (knownBaseSuffix) return preserveWhitespace(value, knownBaseSuffix);

    return value;
  }

  function translateInlineSegment(value, dictionary, language, indexes) {
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
    if (!match || !match[2]) return value;
    const source = match[2];
    const lookupSource = normaliseLookupText(stripClientMarkup(source));
    const exactEntry = dictionary?.items?.[lookupSource]
      ?? dictionary?.stats?.[lookupSource]
      ?? dictionary?.ui?.[lookupSource]
      ?? indexes.inlineExact.get(lookupSource)
      ?? indexes.inlineExactLower.get(lookupSource.toLowerCase());
    if (exactEntry) return preserveWhitespace(value, translatedValue(exactEntry, language, dictionary, lookupSource));
    const rarityCategory = translateRarityCategory(lookupSource, dictionary, language);
    if (rarityCategory) return preserveWhitespace(value, rarityCategory);
    const weaponConfig = translateWeaponConfiguration(lookupSource, dictionary, language);
    if (weaponConfig) return preserveWhitespace(value, weaponConfig);
    const generatedName = composeGeneratedRareName(source, dictionary, language);
    const generatedNameWithBase = composeGeneratedNameWithBase(source, dictionary, language);
    return preserveWhitespace(value, generatedNameWithBase || generatedName || value);
  }

  function translateInlineText(value, dictionary, language) {
    if (typeof value !== 'string' || language === 'en') return value;
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
    const source = match[2];
    if (!source) return value;

    const lookupSource = normaliseLookupText(stripClientMarkup(source));
    const indexes = termIndexes(dictionary);
    const exactEntry = dictionary?.items?.[lookupSource]
      ?? dictionary?.stats?.[lookupSource]
      ?? dictionary?.ui?.[lookupSource]
      ?? indexes.inlineExact.get(lookupSource)
      ?? indexes.inlineExactLower.get(lookupSource.toLowerCase());
    if (exactEntry) return preserveWhitespace(value, translatedValue(exactEntry, language, dictionary, lookupSource));

    const rarityCategory = translateRarityCategory(lookupSource, dictionary, language);
    if (rarityCategory) return preserveWhitespace(value, rarityCategory);

    const weaponConfig = translateWeaponConfiguration(lookupSource, dictionary, language);
    if (weaponConfig) return preserveWhitespace(value, weaponConfig);

    const translatedUiValue = translateControlledUiValue(
      lookupSource,
      dictionary,
      language,
      indexes,
      (tail) => translateWholeLine(tail, dictionary, language),
    );
    if (translatedUiValue) return preserveWhitespace(value, translatedUiValue);

    const translatedDynamic = translatePoeNinjaDynamic(lookupSource, language);
    if (translatedDynamic) return preserveWhitespace(value, translatedDynamic);

    const allocatedPassiveSkill = translateAllocatedPassiveSkill(
      lookupSource,
      dictionary,
      language,
      indexes,
    );
    if (allocatedPassiveSkill) return preserveWhitespace(value, allocatedPassiveSkill);

    const translatedTagList = translateDelimitedTagList(
      lookupSource,
      dictionary,
      language,
      indexes,
    );
    if (translatedTagList) return preserveWhitespace(value, translatedTagList);

    const translatedWildcard = translateWildcardTerm(lookupSource, dictionary, language, indexes);
    if (translatedWildcard) return preserveWhitespace(value, translatedWildcard);

    const generatedName = composeGeneratedRareName(source, dictionary, language);
    const generatedNameWithBase = composeGeneratedNameWithBase(source, dictionary, language);
    const knownBaseSuffix = composeKnownBaseSuffix(source, dictionary, language);
    if (generatedNameWithBase || generatedName || knownBaseSuffix) {
      return preserveWhitespace(value, generatedNameWithBase || generatedName || knownBaseSuffix);
    }

    const parts = source.split(/([,;\r\n])/);
    if (parts.length > 1) {
      let changed = false;
      const translated = parts.map((part) => {
        if (/^[,;\r\n]$/.test(part)) return part;
        const result = translateInlineSegment(part, dictionary, language, indexes);
        changed ||= result !== part;
        return result;
      }).join('');
      if (changed) return preserveWhitespace(value, translated);
    }

    return value;
  }

  function translateTooltipText(value, dictionary, language) {
    if (typeof value !== 'string' || language === 'en') return value;

    const wholeLineTranslation = translateWholeLine(value, dictionary, language);
    if (wholeLineTranslation !== value) return wholeLineTranslation;

    const parts = value.split(/(\r?\n)/);
    let changed = false;
    const translated = parts.map((part) => {
      if (/\r?\n/.test(part)) return part;
      const lineTranslation = translateWholeLine(part, dictionary, language);
      const fallback = lineTranslation !== part
        ? lineTranslation
        : translateInlineText(part, dictionary, language);
      changed ||= fallback !== part;
      return fallback;
    }).join('');

    return changed ? translated : value;
  }

  function selectOutermostRows(root, blockTags = new Set(), includeRoot = false) {
    const candidates = [
      ...(includeRoot && root?.nodeType === 1 ? [root] : []),
      ...(root?.querySelectorAll?.('*') || []),
    ].filter((element) => {
      if (!element.textContent?.trim() || shouldSkipElement(element)) return false;
      if (NON_ROW_CONTAINER_TAGS.has(element.tagName)) return false;
      if (containsFormControl(element)) return false;
      if (isPageShellElement(element)) return false;
      if ([...(element.children || [])].some(isPageShellElement)) return false;
      const isHeadingWithDirectText = /^H[1-6]$/.test(element.tagName)
        && [...(element.childNodes || [])].some((child) => (
          child.nodeType === 3 && /\S/.test(child.nodeValue || '')
        ));
      return isHeadingWithDirectText
        || [...(element.children || [])].every((child) => !blockTags.has(child.tagName));
    });
    const candidateSet = new Set(candidates);
    return candidates.filter((candidate) => {
      for (let parent = candidate.parentElement; parent; parent = parent.parentElement) {
        if (candidateSet.has(parent)) return false;
        if (parent === root) break;
      }
      return true;
    });
  }

  function selectTooltipRows(root, blockTags = new Set()) {
    const rows = selectOutermostRows(root, blockTags);
    if (root?.nodeType !== 1) return rows;

    const hasDirectVisibleText = [...(root.childNodes || [])].some((child) => (
      child.nodeType === 3 && /\S/.test(child.nodeValue || '')
    ));
    if (!hasDirectVisibleText) return rows;

    // Tooltip libraries sometimes put the complete line directly on the
    // popup root while wrapping only selected terms in inline spans. Translate
    // the root as one row so those unwrapped text nodes are not skipped by the
    // content-script's normal page-text walker.
    const hasBlockDescendant = [...(root.querySelectorAll?.('*') || [])]
      .some((element) => blockTags.has(element.tagName));
    if (!hasBlockDescendant || !rows.length) return [root];
    return rows;
  }

  function selectPageRows(root, blockTags = new Set()) {
    const rows = selectOutermostRows(root, blockTags, true);
    if (root?.nodeType !== 1 || rows.length !== 1 || rows[0] !== root) return rows;

    // Incremental DOM scans can start at an inline child that is only a
    // fragment of a larger page row. Promote that root so the complete line
    // is translated as one unit instead of leaving the surrounding text and
    // nested fragment in different languages.
    const containingRow = findPageRow(root, blockTags);
    if (
      containingRow
      && containingRow !== root
      && !NON_ROW_CONTAINER_TAGS.has(containingRow.tagName)
    ) {
      return [containingRow];
    }
    return rows;
  }

  function findPageRow(node, blockTags = new Set()) {
    let element = node?.nodeType === 1 ? node : node?.parentElement;
    if (!element || shouldSkipElement(element)) return null;
    if (containsFormControl(element)) return null;

    let candidate = element;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (NON_ROW_CONTAINER_TAGS.has(parent.tagName) || isPageShellElement(parent)) break;
      if (containsFormControl(parent)) break;
      if ([...(parent.children || [])].some((child) => blockTags.has(child.tagName))) break;
      candidate = parent;
    }
    return candidate;
  }

  // Retain the original public API for callers that translate a complete row.
  const translateText = translateWholeLine;

  function textLeavesWithin(element) {
    const leaves = [];
    let offset = 0;

    function visit(node) {
      if (node.nodeType === 3) {
        const value = node.nodeValue || '';
        leaves.push({ node, start: offset, end: offset + value.length });
        offset += value.length;
        return;
      }
      for (const child of node.childNodes || []) visit(child);
    }

    visit(element);
    return leaves;
  }

  function elementAncestors(node, root) {
    const ancestors = [];
    for (let current = node.parentElement; current && current !== root; current = current.parentElement) {
      ancestors.push(current);
    }
    return ancestors;
  }

  function ownerForRange(leaves, start, end, root, preferTail) {
    const involved = leaves.filter((leaf) => leaf.end > start && leaf.start < end);
    if (!involved.length) return null;

    const sharedAncestors = elementAncestors(involved[0].node, root)
      .filter((candidate) => involved.every((leaf) => elementAncestors(leaf.node, root).includes(candidate)));
    if (sharedAncestors.length) return sharedAncestors[0];

    const styledLeaves = involved.filter((leaf) => elementAncestors(leaf.node, root).length);
    if (!styledLeaves.length) return null;
    const selectedLeaf = preferTail ? styledLeaves.at(-1) : styledLeaves[0];
    return elementAncestors(selectedLeaf.node, root)[0] || null;
  }

  function directChildOwner(root, owner) {
    let direct = owner;
    while (direct?.parentElement && direct.parentElement !== root) direct = direct.parentElement;
    return direct?.parentElement === root ? direct : null;
  }

  function setOwnerText(owner, value) {
    const leaves = textLeavesWithin(owner);
    if (!leaves.length) {
      owner.append(owner.ownerDocument.createTextNode(value));
      return;
    }
    leaves[0].node.nodeValue = value;
    for (const leaf of leaves.slice(1)) leaf.node.nodeValue = '';
  }

  function renderedNodeForOwner(root, owner, value, usedOwners) {
    const direct = directChildOwner(root, owner);
    if (!direct || usedOwners.has(direct)) return root.ownerDocument.createTextNode(value);
    setOwnerText(direct, value);
    usedOwners.add(direct);
    return direct;
  }

  function numericAnchors(source, translated) {
    const pattern = /[+-]?\d+(?:\.\d+)?%?/g;
    const sourceValues = [...source.matchAll(pattern)];
    const translatedValues = [...translated.matchAll(pattern)];
    if (!sourceValues.length) return [];
    if (sourceValues.length !== translatedValues.length) return null;
    const used = new Set();
    const anchors = [];
    for (const match of sourceValues) {
      const translatedIndex = translatedValues.findIndex((candidate, index) => (
        !used.has(index) && candidate[0] === match[0]
      ));
      if (translatedIndex < 0) return null;
      used.add(translatedIndex);
      const translatedMatch = translatedValues[translatedIndex];
      anchors.push({
        sourceStart: match.index,
        sourceEnd: match.index + match[0].length,
        translatedStart: translatedMatch.index,
        translatedEnd: translatedMatch.index + translatedMatch[0].length,
      });
    }
    return anchors;
  }

  function appendTranslatedText(nodes, root, owner, translatedSegment, usedOwners) {
    if (!translatedSegment) return;
    const whitespace = /^(\s*)([\s\S]*?)(\s*)$/.exec(translatedSegment);
    if (whitespace[1]) nodes.push(root.ownerDocument.createTextNode(whitespace[1]));
    if (whitespace[2]) {
      nodes.push(renderedNodeForOwner(root, owner, whitespace[2], usedOwners));
    }
    if (whitespace[3]) nodes.push(root.ownerDocument.createTextNode(whitespace[3]));
  }

  function rangeHasNonWhitespace(leaf, ranges) {
    for (const range of ranges) {
      const start = Math.max(leaf.start, range.start);
      const end = Math.min(leaf.end, range.end);
      if (end > start && /\S/.test((leaf.node.nodeValue || '').slice(start - leaf.start, end - leaf.start))) {
        return true;
      }
    }
    return false;
  }

  function ownerForNonNumericContent(leaves, anchors, root) {
    const ranges = [];
    let offset = 0;
    for (const anchor of [...anchors, { sourceStart: Number.POSITIVE_INFINITY }]) {
      if (anchor.sourceStart > offset) ranges.push({ start: offset, end: anchor.sourceStart });
      offset = anchor.sourceEnd;
    }

    const owners = new Set();
    for (const leaf of leaves) {
      if (!rangeHasNonWhitespace(leaf, ranges)) continue;
      const owner = elementAncestors(leaf.node, root)[0];
      if (owner) owners.add(owner);
    }
    return owners.size === 1 ? [...owners][0] : null;
  }

  function renderStructuredTooltipChildren(element, dictionary, language) {
    const children = [...(element.childNodes || [])];
    if (!children.some((node) => node.nodeType === 1)) return null;

    let changed = false;
    for (const node of children) {
      if (node.nodeType === 3) {
        const source = node.nodeValue || '';
        const translated = translateTooltipText(source, dictionary, language);
        if (translated !== source) {
          node.nodeValue = translated;
          changed = true;
        }
        continue;
      }
      if (node.nodeType !== 1) continue;

      const source = textLeavesWithin(node).map((leaf) => leaf.node.nodeValue || '').join('');
      const translated = translateTooltipText(source, dictionary, language);
      if (translated === source) continue;
      if (!renderTooltipTranslation(node, source, translated, {
        preserveBlockChildren: true,
        dictionary,
        language,
      })) return null;
      changed = true;
    }
    return changed;
  }

  function escapeRegExpString(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

function termDescriptionMatcher(dictionary, language = 'zh-CN') {
    if (!dictionary) return null;
    const map = new Map();

    // 1. 从 dictionary.descriptions 读取
    if (dictionary.descriptions) {
      for (const [english, entry] of Object.entries(dictionary.descriptions)) {
        const langEntry = entry[language] || (language === 'zh-TW' && dictionary.nativeTraditional ? null : entry['zh-CN']);
        if (langEntry?.name && langEntry?.desc) {
          map.set(langEntry.name, { name: langEntry.name, desc: langEntry.desc, english });
        }
      }
    }

    // 2. 从 dictionary.terms 读取
    if (dictionary.terms) {
      for (const [english, entry] of Object.entries(dictionary.terms)) {
        const zh = language === 'zh-TW' && dictionary.nativeTraditional ? entry['zh-TW'] : entry.translation || (typeof entry['zh-CN'] === 'string' ? entry['zh-CN'] : entry['zh-CN']?.name);
        const desc = language === 'zh-TW' && dictionary.nativeTraditional ? entry.descTW : entry.desc || (typeof entry['zh-CN'] === 'object' ? entry['zh-CN']?.desc : null);
        if (zh && desc) {
          map.set(zh, { name: zh, desc, english });
        }
      }
    }

    const names = Array.from(map.keys()).sort((a, b) => b.length - a.length);
    if (!names.length) return null;
    const escaped = names.map((n) => escapeRegExpString(n)).join('|');
    const regex = new RegExp('(' + escaped + ')', 'g');
    return { map, regex };
  }

  function appendNodeTo(parent, child) {
    if (!parent || !child) return;
    if (typeof parent.append === 'function') {
      parent.append(child);
    } else if (typeof parent.appendChild === 'function') {
      parent.appendChild(child);
    }
  }

  function attachTermHighlights(nodes, dictionary, language, rootDoc, options = {}) {
    if (options.highlightTerms === false) return nodes;
    const matcher = termDescriptionMatcher(dictionary, language);
    if (!matcher || !rootDoc) return nodes;

    function processTextNode(textNode) {
      const text = textNode.nodeValue || '';
      if (!text || text.length < 2) return [textNode];
      const parts = text.split(matcher.regex);
      if (parts.length <= 1) return [textNode];

      const out = [];
      for (const part of parts) {
        if (!part) continue;
        if (matcher.map.has(part)) {
          const termInfo = matcher.map.get(part);
          const span = rootDoc.createElement('span');
          span.setAttribute('class', 'poe-ninja-stat-term');
          span.setAttribute('data-term-name', termInfo.name);
          span.setAttribute('data-term-desc', termInfo.desc);
          appendNodeTo(span, rootDoc.createTextNode(part));
          out.push(span);
        } else {
          out.push(rootDoc.createTextNode(part));
        }
      }
      return out;
    }

    const result = [];
    for (const node of nodes) {
      if (!node) continue;
      if (node.nodeType === 3) {
        result.push(...processTextNode(node));
      } else if (node.nodeType === 1) {
        const text = node.textContent || '';
        if (matcher.map.has(text)) {
          const termInfo = matcher.map.get(text);
          const existingClass = node.getAttribute?.('class') || '';
          const newClass = existingClass ? `${existingClass} poe-ninja-stat-term` : 'poe-ninja-stat-term';
          node.setAttribute?.('class', newClass);
          node.setAttribute?.('data-term-name', termInfo.name);
          node.setAttribute?.('data-term-desc', termInfo.desc);
          result.push(node);
        } else {
          const processed = processTextNode(rootDoc.createTextNode(text));
          if (processed.length > 1) {
            result.push(...processed);
          } else {
            result.push(node);
          }
        }
      } else {
        result.push(node);
      }
    }
    return result;
  }

  function renderTooltipTranslation(element, source, translated, options = {}) {
    if (source === translated) return false;
    const leaves = textLeavesWithin(element);
    if (leaves.map((leaf) => leaf.node.nodeValue || '').join('') !== source) return false;

    // A previous pass can leave a row half translated while preserving an
    // inline English span. Once the complete dictionary match is recovered,
    // the mixed tree no longer has reliable numeric anchors; replace it as a
    // single row so stale English fragments cannot survive another scan.
    if (/[㐀-鿿]/.test(source) && /[㐀-鿿]/.test(translated)) {
      const highlighted = attachTermHighlights(
        [element.ownerDocument.createTextNode(translated)],
        options.dictionary,
        options.language,
        element.ownerDocument,
      );
      element.replaceChildren(...highlighted);
      return true;
    }

    if (options.preserveBlockChildren) {
      const structured = renderStructuredTooltipChildren(element, options.dictionary, options.language);
      if (structured !== null) return structured;
    }

    const hasInlineElements = leaves.some((leaf) => leaf.node.parentElement !== element);
    if (!hasInlineElements) {
      const highlighted = attachTermHighlights(
        [element.ownerDocument.createTextNode(translated)],
        options.dictionary,
        options.language,
        element.ownerDocument,
      );
      element.replaceChildren(...highlighted);
      return true;
    }

    const anchors = numericAnchors(source, translated);
    if (anchors === null) {
      const highlighted = attachTermHighlights(
        [element.ownerDocument.createTextNode(translated)],
        options.dictionary,
        options.language,
        element.ownerDocument,
      );
      element.replaceChildren(...highlighted);
      return true;
    }
    const translatedAnchors = [...anchors].sort((left, right) => left.translatedStart - right.translatedStart);
    const nonNumericOwner = ownerForNonNumericContent(leaves, anchors, element);
    const hasNonNumericTranslation = translated.replace(/[+-]?\d+(?:\.\d+)?%?/g, '').trim().length > 0;
    if (hasNonNumericTranslation && !nonNumericOwner) {
      // Actual POE2 rows split every linked stat term into its own span. There
      // is no single owner for the translated prose, so keep numeric highlights
      // and render the remaining translated text as plain nodes.
      const fallbackNodes = [];
      const usedFallbackOwners = new Set();
      let fallbackOffset = 0;
      for (const anchor of translatedAnchors) {
        appendTranslatedText(
          fallbackNodes,
          element,
          null,
          translated.slice(fallbackOffset, anchor.translatedStart),
          usedFallbackOwners,
        );
        const numericOwner = ownerForRange(leaves, anchor.sourceStart, anchor.sourceEnd, element, false);
        fallbackNodes.push(renderedNodeForOwner(
          element,
          numericOwner,
          translated.slice(anchor.translatedStart, anchor.translatedEnd),
          usedFallbackOwners,
        ));
        fallbackOffset = anchor.translatedEnd;
      }
      appendTranslatedText(
        fallbackNodes,
        element,
        null,
        translated.slice(fallbackOffset),
        usedFallbackOwners,
      );
      if (!fallbackNodes.length) return false;
      const highlighted = attachTermHighlights(
        fallbackNodes,
        options.dictionary,
        options.language,
        element.ownerDocument,
      );
      element.replaceChildren(...highlighted);
      return true;
    }

    const renderedNodes = [];
    const usedOwners = new Set();
    let translatedOffset = 0;
    for (const anchor of translatedAnchors) {
      appendTranslatedText(
        renderedNodes,
        element,
        nonNumericOwner,
        translated.slice(translatedOffset, anchor.translatedStart),
        usedOwners,
      );
      const numericOwner = ownerForRange(leaves, anchor.sourceStart, anchor.sourceEnd, element, false);
      renderedNodes.push(renderedNodeForOwner(
        element,
        numericOwner,
        translated.slice(anchor.translatedStart, anchor.translatedEnd),
        usedOwners,
      ));
      translatedOffset = anchor.translatedEnd;
    }
    appendTranslatedText(
      renderedNodes,
      element,
      nonNumericOwner,
      translated.slice(translatedOffset),
      usedOwners,
    );

    if (!renderedNodes.length) return false;
    const highlighted = attachTermHighlights(
      renderedNodes,
      options.dictionary,
      options.language,
      element.ownerDocument,
    );
    element.replaceChildren(...highlighted);
    return true;
  }

  function shouldSkipElement(element) {
    if (!element || SKIP_TAGS.has(element.tagName)) return true;
    if (element.getAttribute?.('translate') === 'no' || element.classList?.contains('notranslate')) return true;
    return Boolean(element.closest?.('[data-poe-ninja-translation-root], [translate="no"], .notranslate, .poe-ninja-fav-drawer, .poe-ninja-fav-trigger, .poe-ninja-fav-overlay, .poe-ninja-detail-fav-btn'));
  }

  function buildOfficialLookupUrl(game, language, slugOrName) {
    const host = OFFICIAL_HOSTS[game];
    const languagePath = LANGUAGE_PATHS[language];
    if (!host || !languagePath) return '';

    const slug = String(slugOrName ?? '')
      .trim()
      .replace(/^\/+/, '')
      .replace(/[?#].*$/, '')
      .replace(/\s+/g, '_');
    if (!slug) return '';

    const encodedPath = slug.split('/').map((segment) => {
      try {
        return encodeURIComponent(decodeURIComponent(segment));
      } catch {
        return encodeURIComponent(segment);
      }
    }).join('/');
    return `${host}/${languagePath}/${encodedPath}`;
  }

  function createDictionaryLoader(loadDictionary) {
    const cached = new Map();
    const pending = new Map();

    async function get(game, language = 'en') {
      const key = `${game}:${language}`;
      if (cached.has(key)) return cached.get(key);
      if (!pending.has(key)) {
        const request = Promise.resolve()
          .then(() => loadDictionary(game, language))
          .then((dictionary) => {
            cached.set(key, dictionary);
            return dictionary;
          })
          .finally(() => pending.delete(key));
        pending.set(key, request);
      }
      return pending.get(key);
    }

    return Object.freeze({ get });
  }

  function resolveOfficialLookup(items, game, language, sourceText) {
    const entry = items?.[sourceText];
    if (!entry) return null;
    const href = entry.sources?.[language]
      || buildOfficialLookupUrl(game, language, entry.slug || entry.en || sourceText);
    return href ? { english: entry.en || sourceText, href } : null;
  }

  const SEARCH_INDEX_CACHE = new WeakMap();

  function buildBilingualSearchIndex(dictionary) {
    if (!dictionary) return [];
    if (SEARCH_INDEX_CACHE.has(dictionary)) {
      return SEARCH_INDEX_CACHE.get(dictionary);
    }
    const index = [];
    const seen = new Set();

    function addEntry(english, zhCN, zhTW, category) {
      if (!english || typeof english !== 'string') return;
      const key = `${category}:${english}`;
      if (seen.has(key)) return;
      seen.add(key);
      const cn = zhCN || english;
      const tw = zhTW || (dictionary.nativeTraditional ? english : cn);
      index.push({
        english,
        zhCN: cn,
        zhTW: tw,
        category,
      });
    }

    for (const [english, entry] of Object.entries(dictionary.items || {})) {
      const cn = typeof entry === 'string' ? entry : (Array.isArray(entry) ? entry[0] : (entry.translation || entry['zh-CN'] || english));
      const tw = dictionary.nativeTraditional ? (Array.isArray(entry) ? entry[2] : entry?.['zh-TW']) || english : typeof entry === 'string' ? entry : (Array.isArray(entry) ? (entry[1] || entry[0]) : (entry['zh-TW'] || cn));
      addEntry(english, cn, tw, 'item');
    }

    for (const [english, entry] of Object.entries(dictionary.gems || {})) {
      const cn = typeof entry === 'string' ? entry : (Array.isArray(entry) ? entry[0] : (entry.translation || entry['zh-CN'] || english));
      const tw = dictionary.nativeTraditional ? (Array.isArray(entry) ? entry[2] : entry?.['zh-TW']) || english : typeof entry === 'string' ? entry : (Array.isArray(entry) ? (entry[1] || entry[0]) : (entry['zh-TW'] || cn));
      addEntry(english, cn, tw, 'gem');
    }

    for (const [english, entry] of Object.entries(dictionary.passives || {})) {
      const cn = typeof entry === 'string' ? entry : (Array.isArray(entry) ? entry[0] : (entry.translation || entry['zh-CN'] || english));
      const tw = dictionary.nativeTraditional ? (Array.isArray(entry) ? entry[2] : entry?.['zh-TW']) || english : typeof entry === 'string' ? entry : (Array.isArray(entry) ? (entry[1] || entry[0]) : (entry['zh-TW'] || cn));
      addEntry(english, cn, tw, 'passive');
    }

    for (const [english, entry] of Object.entries(dictionary.terms || {})) {
      const cn = typeof entry === 'string' ? entry : (Array.isArray(entry) ? entry[0] : (entry.translation || entry['zh-CN'] || english));
      const tw = dictionary.nativeTraditional ? (Array.isArray(entry) ? entry[2] : entry?.['zh-TW']) || english : typeof entry === 'string' ? entry : (Array.isArray(entry) ? (entry[2] || entry[0]) : (entry['zh-TW'] || cn));
      addEntry(english, cn, tw, 'term');
    }

    const dictDescriptions = dictionary.descriptions || {};
    for (const [english, entry] of Object.entries(dictDescriptions || {})) {
      const cn = entry['zh-CN']?.name || english;
      const tw = entry['zh-TW']?.name || (dictionary.nativeTraditional ? english : cn);
      addEntry(english, cn, tw, 'term');
    }

    SEARCH_INDEX_CACHE.set(dictionary, index);
    return index;
  }

  function searchBilingual(query, dictionary, language = 'zh-CN', limit = 8) {
    if (!query || typeof query !== 'string' || !dictionary) return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const index = buildBilingualSearchIndex(dictionary);
    const exactMatches = [];
    const prefixMatches = [];
    const containsMatches = [];

    for (const entry of index) {
      const targetZh = (language === 'zh-TW' ? entry.zhTW : entry.zhCN) || entry.zhCN;
      const targetZhLower = targetZh.toLowerCase();
      const englishLower = entry.english.toLowerCase();

      const item = {
        english: entry.english,
        chinese: targetZh,
        category: entry.category,
      };

      if (targetZhLower === q || englishLower === q) {
        exactMatches.push(item);
      } else if (targetZhLower.startsWith(q) || englishLower.startsWith(q)) {
        prefixMatches.push(item);
      } else if (targetZhLower.includes(q) || englishLower.includes(q)) {
        containsMatches.push(item);
      }
    }

    const combined = [...exactMatches, ...prefixMatches, ...containsMatches];
    const unique = [];
    const seenNames = new Set();
    for (const item of combined) {
      const key = `${item.chinese}:${item.english}`;
      if (!seenNames.has(key)) {
        seenNames.add(key);
        unique.push(item);
        if (unique.length >= limit) break;
      }
    }
    return unique;
  }

  root.PoeNinjaTranslationCore = Object.freeze({
    buildBilingualSearchIndex,
    buildOfficialLookupUrl,
    createDictionaryLoader,
    findPageRow,
    normaliseNumericTemplate,
    renderTooltipTranslation,
    resolveOfficialLookup,
    searchBilingual,
    selectPageRows,
    selectTooltipRows,
    translateInlineText,
    translateTooltipText,
    translateText,
    translateWholeLine,
    shouldSkipElement,
  });
}(globalThis));
