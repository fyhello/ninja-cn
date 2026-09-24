import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { displayGameText } from './game-text.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const normalize = text => displayGameText(String(text)).replace(/\^x[\da-fA-F]{6}|\^[\da-fA-F]/g, '').replace(/\r\n/g, '\n').trim();
const keyOf = row => JSON.stringify([row.table, row.id, row.field, row.element || 0]);
const comparable = text => normalize(text).replace(/\s+/g, ' ');
const placeholders = text => [...text.matchAll(/\{(\d+)(:[^}]+)?\}/g)];
const formatSignature = text => JSON.stringify(placeholders(text).map(match => `${match[1]}${match[2] || ''}`).sort());
const specialSignature = text => String(text || '').replace(/\bcanonical_line\b/g, '').trim().replace(/\s+/g, ' ');
const sections = ['items', 'stats', 'tooltip', 'ui', 'terms'];

export async function readSnapshot(path, expectedHash, projectRoot = root) {
  const bytes = await readFile(path);
  if (expectedHash && hash(bytes) !== expectedHash) throw new Error('原生词典快照 SHA-256 不符');
  const snapshot = JSON.parse(gunzipSync(bytes));
  const schemaBytes = await readFile(resolve(projectRoot, 'tools/native-translations/schemas/game-text-tables.json'));
  const schema = JSON.parse(schemaBytes);
  const tool = JSON.parse(await readFile(resolve(projectRoot, 'tools/native-translations/schemas/game-text-tools.json')));
  if (snapshot.schema_version !== 1 || !Array.isArray(snapshot.texts) || !Array.isArray(snapshot.stats) || !Array.isArray(snapshot.sources)) throw new Error('原生词典快照结构无效');
  if (snapshot.schema?.sha256 !== hash(schemaBytes)) throw new Error('原生词典 schema 与快照不一致');
  if (snapshot.tool?.release !== tool.release || Object.entries(tool.files).some(([name, digest]) => snapshot.tool.files?.[name] !== digest)) throw new Error('原生词典提取器来源不符');
  const sources = new Set();
  for (const source of snapshot.sources) {
    const key = `${source.client}/${source.path}`;
    if (sources.has(key) || !/^[a-f0-9]{64}$/.test(source.sha256) || !Number.isSafeInteger(source.size) || source.size <= 0) throw new Error(`原生资源清单无效：${key}`);
    sources.add(key);
  }
  for (const [client, language] of [['cn', 'simplified chinese'], ['intl', 'traditional chinese']]) {
    for (const table of schema.tables) {
      for (const folder of ['', `${language}/`]) if (!sources.has(`${client}/data/balance/${folder}${table.name.toLowerCase()}.datc64`)) throw new Error(`缺少 ${client} 原生资源：${folder}${table.name}`);
    }
    if (!snapshot.stats.some(row => row.client === client && row.english?.length)) throw new Error(`缺少 ${client} 原生词缀`);
  }
  for (const row of snapshot.texts) {
    if (!['zh-CN', 'zh-TW'].includes(row.locale) || typeof row.en !== 'string' || typeof row.translated !== 'string' || !row.table || typeof row.id !== 'string' || !row.field || !Number.isInteger(row.element)) throw new Error('原生文本记录缺少语言或资源身份');
  }
  return { snapshot, sha256: hash(bytes) };
}

export async function loadNativeSnapshot() {
  const lock = JSON.parse(await readFile(resolve(root, 'data/sources/native-translations/lock.json')));
  const loaded = await readSnapshot(resolve(root, lock.path), lock.sha256);
  return { ...loaded, lock };
}

function add(index, source, candidate) {
  const key = comparable(source);
  if (!key) return;
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(candidate);
}

function textKind(row) {
  if (row.table === 'BaseItemTypes' && row.field === 'Name') return 'base_item';
  if (row.table === 'PassiveSkills' && row.field === 'Name') return 'passive_skill';
  if (row.table === 'Words') return row.nameRole === 'unique' ? 'unique_item' : 'name_fragment';
  if (row.table === 'Mods' && row.field === 'Name') return 'name_fragment';
  if (row.table === 'ItemClasses' && /Name/.test(row.field)) return 'item_class';
  if (['ActiveSkills', 'GemEffects', 'SkillGemInfo'].includes(row.table) && /Name/.test(row.field)) return 'gem';
  if (row.table === 'KeywordPopups' && row.field === 'Term') return 'mechanic';
  return 'text';
}

function choose(candidates) {
  const values = new Map();
  for (const candidate of candidates) {
    const order = candidate.order?.length ? candidate.order : null;
    const signature = JSON.stringify([comparable(candidate.translated), order]);
    if (!values.has(signature)) values.set(signature, { translated: candidate.translated, order, evidence: [] });
    const evidence = values.get(signature).evidence;
    if (!evidence.some(source => JSON.stringify(source) === JSON.stringify(candidate.source))) evidence.push(candidate.source);
  }
  return { match: values.size === 1 ? [...values.values()][0] : null, conflict: values.size > 1, values: [...values.values()] };
}

// 参数格式和变换必须对称；仅搬运显示字符串，不在翻译层计算游戏数值。
export function alignStatForms(block) {
  const rejected = [];
  const pairs = [];
  if (block.duplicates?.length) return { pairs, rejected: [{ reason: '重复语言段', path: block.path, line: block.line }] };
  const canonical = text => {
    const value = normalize(text);
    if (/\{(:[^}]+)?\}/.test(value)) {
      if (block.stats.length !== 1 || [...value.matchAll(/\{(?:\d+)?(?::[^}]+)?\}/g)].length !== 1) return null;
      return value.replace(/\{(:[^}]+)?\}/g, (_, format = '') => `{0${format}}`);
    }
    return value;
  };
  for (const english of block.english || []) {
    const en = canonical(english.text);
    const candidates = (block.translated || []).filter(form => en !== null && canonical(form.text) !== null
      && JSON.stringify(form.limits) === JSON.stringify(english.limits)
      && JSON.stringify(form.flags) === JSON.stringify(english.flags)
      && specialSignature(form.special) === specialSignature(english.special)
      && formatSignature(canonical(form.text)) === formatSignature(en));
    const distinct = new Map(candidates.map(form => [canonical(form.text), form]));
    if (en === null || distinct.size !== 1) {
      rejected.push({ path: block.path, line: english.line, en: english.text, stats: block.stats, reason: en === null ? '匿名参数无法确定身份' : distinct.size ? '繁中语言形式冲突' : '缺少条件和格式一致的繁中形式' });
      continue;
    }
    const [translated, form] = [...distinct.entries()][0];
    pairs.push({ en, translated, source: { kind: '原生词缀', path: block.path, line: form.line, englishLine: english.line, stats: block.stats, limits: english.limits, flags: english.flags, special: english.special } });
  }
  return { pairs, rejected };
}

function parameterOrder(en, translated) {
  const source = placeholders(en), target = placeholders(translated), used = new Set();
  if (source.length !== target.length) return null;
  const order = [];
  for (const match of target) {
    const index = source.findIndex((part, i) => !used.has(i) && part[1] === match[1] && (part[2] || '') === (match[2] || ''));
    if (index < 0) return null;
    used.add(index); order.push(index);
  }
  return order;
}

function registerVariants(index, pair) {
  const register = (en, translated) => {
    const order = parameterOrder(en, translated);
    if (!order) return;
    add(index, en, { ...pair, translated });
    for (const signed of [false, true]) {
      const convert = value => value.replace(/\{\d+(:[^}]+)?\}/g, (_, format) => signed && format === ':+d' ? '+#' : '#');
      add(index, convert(en), { ...pair, translated: convert(translated), order });
    }
  };
  register(pair.en, pair.translated);
  const enLines = pair.en.split('\n'), twLines = pair.translated.split('\n');
  if (enLines.length > 1) {
    register(pair.en.replace(/\s+/g, ' '), pair.translated.replace(/\s+/g, ' '));
    if (enLines.length === twLines.length) enLines.forEach((en, i) => register(en, twLines[i]));
  }
}

export function createNativeIndexes(snapshot) {
  const texts = new Map(), stats = new Map(), descriptions = new Map(), rejected = [];
  const identities = new Map();
  for (const row of snapshot.texts) {
    const id = `${row.locale}:${keyOf(row)}`;
    if (!identities.has(id)) identities.set(id, []);
    identities.get(id).push(row);
  }
  for (const row of snapshot.texts.filter(row => row.locale === 'zh-TW')) {
    const id = keyOf(row);
    if (new Set(identities.get(`zh-TW:${id}`).map(value => JSON.stringify([value.en, value.translated]))).size !== 1) {
      rejected.push({ reason: '重复资源身份冲突', entity: id }); continue;
    }
    const chinese = identities.get(`zh-CN:${id}`)?.filter(cn => cn.en === row.en) || [];
    const candidate = { translated: normalize(row.translated), kind: textKind(row), source: { kind: '原生文本', entity: id, table: row.table, id: row.id, field: row.field, element: row.element, en: row.en }, cn: chinese.map(cn => comparable(cn.translated)) };
    if (candidate.kind !== 'name_fragment') add(texts, row.en, candidate);
    if (/Description|Text|Popup/i.test(row.field)) for (const cn of chinese) add(descriptions, cn.translated, candidate);
  }
  const blocks = snapshot.stats.filter(row => row.locale === 'zh-TW');
  const byFile = new Map();
  for (const block of blocks) {
    if (!byFile.has(block.path)) byFile.set(block.path, { includes: block.includes || [], blocks: [] });
    byFile.get(block.path).blocks.push(block);
  }
  const visited = new Set();
  function validateIncludes(path, stack = new Set()) {
    if (stack.has(path)) throw new Error(`词缀 include 循环：${path}`);
    if (visited.has(path)) return;
    const next = new Set([...stack, path]);
    for (const parent of byFile.get(path)?.includes || []) validateIncludes(parent.toLowerCase(), next);
    visited.add(path);
  }
  for (const path of byFile.keys()) validateIncludes(path);
  // 页面没有 stat ID 或 CSD 语境时，只有所有候选译文一致才能进入通用索引。
  for (const block of blocks) {
    const aligned = alignStatForms(block);
    rejected.push(...aligned.rejected);
    for (const pair of aligned.pairs) registerVariants(stats, pair);
  }
  return { texts, stats, descriptions, rejected };
}

function selectText(candidates, type, cn) {
  const kinds = { base_item: ['base_item'], passive_skill: ['passive_skill'], gem: ['gem', 'base_item'], unique_item: ['unique_item'], item_class: ['item_class'], mechanic: ['mechanic'] };
  const preferred = candidates.filter(row => kinds[type]?.includes(row.kind));
  const priorities = { gem: 10, passive_skill: 9, base_item: 8, unique_item: 7, item_class: 6, mechanic: 5, text: 1 };
  const highest = Math.max(0, ...candidates.map(row => priorities[row.kind] || 0));
  const eligible = preferred.length ? preferred : candidates.filter(row => priorities[row.kind] === highest);
  const exactChinese = eligible.filter(row => row.cn.includes(comparable(cn)));
  return choose(exactChinese.length ? exactChinese : eligible);
}

export function applyNativeTraditional(dictionary, snapshot, { revision = '', ui = {}, overrides = {}, glossary = {} } = {}) {
  const indexes = createNativeIndexes(snapshot);
  const report = { schema_version: 1, snapshot: revision, summary: {}, missing: [], conflicts: [], rejectedTemplates: indexes.rejected, provenance: {} };
  report.descriptions = { summary: { total: 0, native: 0, explicit: 0, missing: 0, conflicts: 0 }, missing: [], conflicts: [], provenance: {} };
  for (const section of sections) {
    const counts = { total: 0, native: 0, explicit: 0, ui: 0, missing: 0, conflicts: 0 };
    for (const [english, entry] of Object.entries(dictionary[section] || {})) {
      counts.total++;
      const cn = entry.translation || entry['zh-CN'] || '';
      const type = dictionary.terms?.[english]?.type;
      const text = selectText(indexes.texts.get(comparable(english)) || [], type, cn);
      const stat = choose(indexes.stats.get(comparable(english)) || []);
      const selected = section === 'stats' || (section === 'tooltip' && stat.values.length) ? stat.values.length ? stat : text : text.values.length ? text : stat;
      delete entry['zh-TW'];
      if (entry.placeholderOrder) { delete entry.placeholderOrder['zh-TW']; if (!Object.keys(entry.placeholderOrder).length) delete entry.placeholderOrder; }
      let provenance;
      if (selected.match) {
        entry['zh-TW'] = selected.match.translated;
        if (selected.match.order?.length) entry.placeholderOrder = { ...entry.placeholderOrder, 'zh-TW': selected.match.order };
        provenance = { kind: 'native', evidence: selected.match.evidence };
        counts.native++;
      } else if (selected.conflict) {
        report.conflicts.push({ section, en: english, candidates: selected.values });
        counts.conflicts++;
      } else if (typeof overrides[english]?.['zh-TW'] === 'string' && overrides[english]['zh-TW']) {
        entry['zh-TW'] = overrides[english]['zh-TW'];
        provenance = { kind: 'explicit-override', path: 'data/overrides/terms.json', key: english };
        counts.explicit++;
      } else if (typeof ui[english] === 'string') {
        entry['zh-TW'] = ui[english]; provenance = { kind: 'project-ui', key: english }; counts.ui++;
      }
      if (!entry['zh-TW']) {
        entry['zh-TW'] = english;
        counts.missing++;
        report.missing.push({ section, en: english, type, reason: selected.conflict ? '原生译文有歧义' : '没有独立繁中来源' });
      } else report.provenance[`${section}:${english}`] = provenance;
      if (section === 'terms' && entry.desc) {
        delete entry.descTW;
        const desc = choose(indexes.descriptions.get(comparable(entry.desc)) || []);
        const descriptions = report.descriptions;
        descriptions.summary.total++;
        if (desc.match) {
          entry.descTW = desc.match.translated;
          descriptions.summary.native++;
          descriptions.provenance[english] = { kind: 'native', evidence: desc.match.evidence };
        } else if (desc.conflict) {
          descriptions.summary.conflicts++;
          descriptions.conflicts.push({ en: english, candidates: desc.values });
        } else if (glossary[english]?.['zh-TW']?.desc) {
          entry.descTW = glossary[english]['zh-TW'].desc;
          descriptions.summary.explicit++;
          descriptions.provenance[english] = { kind: 'explicit-override', path: 'data/overrides/glossary.json', key: english };
        }
        if (!entry.descTW) {
          descriptions.summary.missing++;
          descriptions.missing.push({ en: english, reason: desc.conflict ? '原生说明有歧义' : '没有独立繁中说明' });
        }
      }
    }
    report.summary[section] = counts;
  }
  dictionary.nativeTraditional = { snapshot: revision, missing: report.missing.length };
  return report;
}
