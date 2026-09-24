import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { hash, root, readSnapshot, applyNativeTraditional } from './dictionary.mjs';

const lockPath = 'data/sources/native-translations/lock.json';
const inputPaths = [lockPath, 'data/poe2.json', 'data/reports/native-traditional.json',
  'data/overrides/terms.json', 'data/overrides/glossary.json',
  'tools/native-translations/dictionary.mjs', 'tools/native-translations/update.mjs',
  'tools/native-translations/collect.mjs', 'tools/native-translations/game-text.mjs',
  'tools/native-translations/schemas/game-text-tables.json', 'tools/native-translations/schemas/game-text-tools.json'];

async function candidatePath(input) {
  return resolve(input.endsWith('.gz') ? input : resolve(input, 'game-text.json.gz'));
}

export async function createReview(candidate, projectRoot = root) {
  const inputs = {};
  const contents = {};
  for (const path of inputPaths) {
    const bytes = await readFile(resolve(projectRoot, path));
    inputs[path] = hash(bytes);
    if (path.endsWith('.json')) contents[path] = JSON.parse(bytes);
  }
  const loaded = await readSnapshot(await candidatePath(candidate), undefined, projectRoot);
  const collectors = loaded.snapshot.collectors || [];
  const suspiciousNames = loaded.snapshot.texts.filter(row => row.table === 'BaseItemTypes' && row.field === 'Name' && /\[\d+(?:\.\d+)?\s*[edc]\]/i.test(row.translated))
    .map(row => ({ locale: row.locale, id: row.id, en: row.en, translated: row.translated, reason: '名称含价格标注，客户端可能被修改' }));
  for (const path of ['tools/native-translations/collect.mjs', 'tools/native-translations/game-text.mjs']) {
    if (!collectors.some(row => row.path === path && row.sha256 === inputs[path])) throw new Error(`候选不是当前采集器的输出，请重新采集或核验复用原始资源：${path}`);
  }
  const oldDictionary = contents['data/poe2.json'];
  const oldReport = contents['data/reports/native-traditional.json'];
  const ui = {};
  for (const [key, source] of Object.entries(oldReport.provenance || {})) {
    if (source.kind !== 'project-ui') continue;
    const colon = key.indexOf(':');
    ui[key.slice(colon + 1)] = oldDictionary[key.slice(0, colon)]?.[key.slice(colon + 1)]?.['zh-TW'];
  }
  const dictionary = structuredClone(oldDictionary);
  const coverage = applyNativeTraditional(dictionary, loaded.snapshot, { revision: loaded.sha256, ui,
    overrides: contents['data/overrides/terms.json'], glossary: contents['data/overrides/glossary.json'] });
  const changes = [], regressions = [];
  for (const section of ['items', 'stats', 'tooltip', 'ui', 'terms']) {
    for (const [en, entry] of Object.entries(dictionary[section] || {})) {
      const old = oldDictionary[section]?.[en]?.['zh-TW'] || en;
      if (old === entry['zh-TW']) continue;
      const change = { section, en, before: old, after: entry['zh-TW'] };
      changes.push(change);
      if (oldReport.provenance?.[`${section}:${en}`]?.kind === 'native' && entry['zh-TW'] === en) regressions.push(change);
    }
  }
  const descriptionChanges = [];
  for (const [en, entry] of Object.entries(dictionary.terms || {})) {
    const before = oldDictionary.terms?.[en]?.descTW || '';
    const after = entry.descTW || '';
    if (before === after) continue;
    const change = { section: 'terms', en, field: 'descTW', before, after };
    descriptionChanges.push(change);
    if (oldReport.descriptions?.provenance?.[en]?.kind === 'native' && !after) regressions.push(change);
  }
  const previous = contents[lockPath];
  const old = await readSnapshot(resolve(projectRoot, previous.path), previous.sha256, projectRoot);
  const identity = row => JSON.stringify([row.locale, row.table, row.id, row.field, row.element]);
  const before = new Map(old.snapshot.texts.map(row => [identity(row), [row.en, row.translated]]));
  const after = new Map(loaded.snapshot.texts.map(row => [identity(row), [row.en, row.translated]]));
  const sourceChanges = [];
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    if (JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key))) sourceChanges.push({ entity: key, before: before.get(key), after: after.get(key) });
  }
  return { schema_version: 1, candidate: loaded.sha256, inputs, sourceChanges, changes, descriptionChanges, regressions, suspiciousNames, coverage };
}

export async function acceptReview(candidate, reportPath, acknowledgement, projectRoot = root) {
  const bytes = await readFile(reportPath);
  if (hash(bytes) !== acknowledgement) throw new Error('审核报告 SHA-256 与确认值不符');
  const accepted = JSON.parse(bytes);
  const current = await createReview(candidate, projectRoot);
  if (JSON.stringify(accepted) !== JSON.stringify(current)) throw new Error('审核之后输入或候选发生变化，请重新审核');
  if (current.regressions.length) throw new Error(`候选会使 ${current.regressions.length} 条已有原生译文退回英文，拒绝接受`);
  if (current.suspiciousNames.length) throw new Error(`候选有 ${current.suspiciousNames.length} 条名称包含价格标注，拒绝接受`);
  const path = `data/sources/native-translations/game-${current.candidate}.json.gz`;
  const destination = resolve(projectRoot, path);
  await mkdir(dirname(destination), { recursive: true });
  const sourceBytes = await readFile(await candidatePath(candidate));
  if (hash(sourceBytes) !== current.candidate) throw new Error('候选在接受前发生变化');
  try { await writeFile(destination, sourceBytes, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST' || hash(await readFile(destination)) !== current.candidate) throw error;
  }
  const reviewArchive = `data/sources/native-translations/review-${acknowledgement}.json.gz`;
  await writeFile(resolve(projectRoot, reviewArchive), gzipSync(bytes, { level: 9 }));
  for (const [path, digest] of Object.entries(current.inputs)) {
    if (hash(await readFile(resolve(projectRoot, path))) !== digest) throw new Error('接受期间输入发生变化，正式来源锁未更新');
  }
  // 快照不可变，最后替换单一来源锁；失败时正式构建仍指向旧快照。
  const target = resolve(projectRoot, lockPath);
  const temporary = `${target}.${randomUUID()}.pending`;
  let created = false;
  try {
    await writeFile(temporary, JSON.stringify({ schema_version: 1, path, sha256: current.candidate,
      origin: { collector: 'tools/native-translations/collect.mjs', review_sha256: acknowledgement, review_path: reviewArchive } }, null, 2) + '\n', { flag: 'wx' });
    created = true;
    await rename(temporary, target);
  } finally {
    if (created) try { await unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { snapshot: current.candidate, changes: current.changes.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    candidate: { type: 'string' }, output: { type: 'string' }, review: { type: 'string' }, 'ack-sha256': { type: 'string' },
  } });
  try {
    if (!values.candidate) throw new Error('必须提供 --candidate');
    if (positionals[0] === 'review') {
      if (!values.output) throw new Error('审核必须提供 --output，写入新的报告文件');
      const report = await createReview(values.candidate);
      const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
      await writeFile(resolve(values.output), bytes, { flag: 'wx' });
      console.log(`审核报告：${resolve(values.output)}\nSHA-256：${hash(bytes)}\n译文变化：${report.changes.length}，阻断回退：${report.regressions.length}，可疑名称：${report.suspiciousNames.length}`);
    } else if (positionals[0] === 'accept') {
      if (!values.review || !values['ack-sha256']) throw new Error('接受必须提供 --review 和 --ack-sha256');
      console.log('已更新来源锁，请运行 npm run build:dictionary：', await acceptReview(values.candidate, resolve(values.review), values['ack-sha256']));
    } else throw new Error('子命令必须是 review 或 accept');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
