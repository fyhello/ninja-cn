import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, mkdir, readdir, writeFile, stat } from 'node:fs/promises';
import { resolve, relative, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { parseCsd, readDatStrings, pairTableTexts } from './game-text.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const digest = value => createHash('sha256').update(value).digest('hex');
const locales = { cn: ['zh-CN', 'simplified chinese', 'Simplified Chinese'], intl: ['zh-TW', 'traditional chinese', 'Traditional Chinese'] };

async function listFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`采集目录不能包含符号链接：${entry.name}`);
    if (entry.isDirectory()) result.push(...await listFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}

function runExtractor(extractor, args, filter) {
  return new Promise((accept, reject) => {
    const process = spawn(extractor, args, { windowsHide: true });
    const selected = [], tail = [];
    let errorText = '';
    createInterface({ input: process.stdout, crlfDelay: Infinity }).on('line', line => {
      if (filter?.test(line.trim())) selected.push(line.trim());
      tail.push(line); if (tail.length > 12) tail.shift();
    });
    process.stderr.on('data', data => { errorText = (errorText + data).slice(-8192); });
    process.on('error', reject);
    process.on('close', code => code === 0 ? accept(selected) : reject(new Error(`游戏资源导出失败：${errorText || tail.join('\n')}`)));
  });
}

export async function collectGameTranslations({ cn, intl, extractor, output, extracted = false, provenance }) {
  if (!cn || !intl || !output || (!extracted && !extractor)) throw new Error('必须提供 --cn、--intl、--output；客户端模式还需要 --extractor');
  const destination = resolve(output);
  try { await stat(destination); throw new Error('候选输出目录已存在，请使用新的目录'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const schemaBytes = await readFile(resolve(root, 'tools/native-translations/schemas/game-text-tables.json'));
  const schema = JSON.parse(schemaBytes);
  const sourceFiles = [], texts = [], stats = [];
  const toolLock = JSON.parse(await readFile(resolve(root, 'tools/native-translations/schemas/game-text-tools.json')));
  // 复用离线原始资源必须逐文件匹配先前提取清单，不能把未核验目录冒充锁定工具的产出。
  if (extracted && !provenance) throw new Error('复用原始资源必须提供 --provenance 指向已采集的游戏快照');
  const previous = extracted ? JSON.parse(gunzipSync(await readFile(resolve(provenance)))) : null;
  if (previous && (previous.tool?.release !== toolLock.release || JSON.stringify(previous.tool.files) !== JSON.stringify(toolLock.files))) throw new Error('复用资源的提取工具来源与锁定记录不符');
  const tool = extracted ? { ...previous.tool, mode: 'verified-extracted-directory' } : { mode: 'bun_extract_file', release: toolLock.release, files: {} };
  if (!extracted) for (const [name, expected] of Object.entries(toolLock.files)) {
    const actual = digest(await readFile(name.endsWith('.exe') ? resolve(extractor) : join(dirname(resolve(extractor)), name)));
    if (actual !== expected) throw new Error(`提取工具哈希与锁定版本不符：${name}`);
    tool.files[name] = actual;
  }
  await mkdir(destination, { recursive: true });
  for (const [client, input] of Object.entries({ cn, intl })) {
    const [locale, folder, language] = locales[client];
    let directory = resolve(input);
    if (!extracted) {
      directory = join(destination, 'raw', client);
      await mkdir(directory, { recursive: true });
      const expression = `^data/(statdescriptions/.*[.]csd|balance/(?:${folder}/)?(?:${schema.tables.map(table => table.name.toLowerCase()).join('|')})[.]datc64)$`;
      const inputPath = resolve(input);
      let clientPath = inputPath;
      if ((await stat(inputPath)).isDirectory()) {
        try { await stat(join(inputPath, 'Content.ggpk')); clientPath = join(inputPath, 'Content.ggpk'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const expected = await runExtractor(resolve(extractor), ['list-files', clientPath], new RegExp(expression, 'i'));
      if (!expected.some(path => /[.]csd$/i.test(path)) || expected.filter(path => /[.]datc64$/i.test(path)).length !== schema.tables.length * 2) throw new Error(`${client} 客户端资源清单不完整`);
      await runExtractor(resolve(extractor), ['extract-files', '--regex', clientPath, directory, expression]);
      const actual = new Set((await listFiles(directory)).map(path => relative(directory, path).replaceAll('\\', '/').toLowerCase()));
      for (const path of expected) if (!actual.has(path.toLowerCase())) throw new Error(`导出工具遗漏资源：${client}/${path}`);
    }
    const paths = await listFiles(directory);
    const byName = new Map(paths.map(path => [relative(directory, path).replaceAll('\\', '/').toLowerCase(), path]));
    if (previous) for (const source of previous.sources.filter(source => source.client === client)) {
      if (!byName.has(source.path)) throw new Error(`复用资源遗漏提取清单中的文件：${client}/${source.path}`);
    }
    const readSource = async path => {
      if (!byName.has(path)) throw new Error(`缺少原始资源：${client}/${path}`);
      const bytes = await readFile(byName.get(path));
      if (previous && previous.sources.find(source => source.client === client && source.path === path)?.sha256 !== digest(bytes)) throw new Error(`复用原始资源与提取清单不符：${client}/${path}`);
      sourceFiles.push({ client, path, sha256: digest(bytes), size: bytes.length });
      return bytes;
    };
    for (const table of schema.tables) {
      const clientTable = { ...table, ...table.clients?.[client] };
      const base = `data/balance/${table.name.toLowerCase()}.datc64`;
      const overlay = `data/balance/${folder}/${table.name.toLowerCase()}.datc64`;
      texts.push(...pairTableTexts(readDatStrings(await readSource(base), clientTable), readDatStrings(await readSource(overlay), clientTable), clientTable, locale));
    }
    for (const path of [...byName.keys()].filter(path => /^data\/statdescriptions\/.*[.]csd$/.test(path)).sort()) {
      const bytes = await readSource(path);
      const decoded = new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
      const parsed = parseCsd(decoded, path);
      for (const block of parsed.blocks) {
        if (!block.sections.English) throw new Error(`${path} 缺少英文描述`);
        stats.push({ client, path, line: block.line, stats: block.stats, declaration: block.declaration, english: block.sections.English, translated: block.sections[language] || [], duplicates: block.duplicates.filter(value => value.language === language || value.language === 'English'), locale, includes: parsed.includes });
      }
    }
  }
  const collectors = [];
  for (const path of ['tools/native-translations/collect.mjs', 'tools/native-translations/game-text.mjs']) collectors.push({ path, sha256: digest(await readFile(resolve(root, path))) });
  const payload = { schema_version: 1, schema: { path: 'tools/native-translations/schemas/game-text-tables.json', sha256: digest(schemaBytes), original: schema.source }, tool, sources: sourceFiles, collectors, texts, stats };
  const bytes = Buffer.from(`${JSON.stringify(payload)}\n`);
  const gzip = gzipSync(bytes, { level: 9 });
  await writeFile(join(destination, 'game-text.json.gz'), gzip);
  const summary = { schema_version: 1, sha256: digest(gzip), payload_sha256: digest(bytes), sources: sourceFiles.length, texts: texts.length, stat_groups: stats.length, schema_sha256: digest(schemaBytes) };
  await writeFile(join(destination, 'candidate.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { cn: { type: 'string' }, intl: { type: 'string' }, extractor: { type: 'string' }, output: { type: 'string' }, extracted: { type: 'boolean', default: false }, provenance: { type: 'string' } } });
  collectGameTranslations(values).then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
}
