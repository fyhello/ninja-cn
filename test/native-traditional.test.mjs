import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';
import { collectGameTranslations } from '../tools/native-translations/collect.mjs';
import { pairTableTexts, parseCsd, readDatStrings } from '../tools/native-translations/game-text.mjs';
import { alignStatForms, applyNativeTraditional, loadNativeSnapshot, readSnapshot, root } from '../tools/native-translations/dictionary.mjs';

const context = vm.createContext({ globalThis: {} });
vm.runInContext(await readFile(new URL('../lib/translation-core.js', import.meta.url), 'utf8'), context);
const core = context.globalThis.PoeNinjaTranslationCore;
const { snapshot, sha256 } = await loadNativeSnapshot();
const dictionary = JSON.parse(await readFile(new URL('../data/poe2.json', import.meta.url), 'utf8'));

test('三种专业名称使用稳定资源身份对应的独立繁中，简中保持原值', () => {
  const cases = [
    ['Efficiency II', '效能 II', '效率 II'],
    ['Dueling Wand', '决斗法杖', '單挑法杖'],
    ['Dominion', '主宰', '統御'],
  ];
  for (const [en, cn, tw] of cases) {
    const original = snapshot.texts.find(row => row.en === en && row.locale === 'zh-CN');
    const translated = snapshot.texts.find(row => row.locale === 'zh-TW' && row.table === original.table && row.id === original.id && row.field === original.field && row.element === original.element);
    assert.equal(original.translated, cn);
    assert.equal(translated.translated, tw);
    for (const method of ['translateWholeLine', 'translateInlineText', 'translateTooltipText']) {
      assert.equal(core[method](en, dictionary, 'zh-CN'), cn);
      assert.equal(core[method](en, dictionary, 'zh-TW'), tw);
      assert.equal(core[method](en, dictionary, 'en'), en);
    }
    assert.ok(core.searchBilingual(tw, dictionary, 'zh-TW').some(row => row.english === en && row.chinese === tw));
  }
});

test('独立繁中缺失时保留英文，不从对象、紧凑条目或多行拆分回退简中', () => {
  const data = { nativeTraditional: {}, items: { 'Missing Wand': { 'zh-CN': '错误法杖' } }, terms: {
    'Missing Gem': ['错误宝石', 'gem'],
    'First line\nSecond line': { translation: '第一行\n第二行', type: 'client_term' },
  } };
  for (const text of ['Missing Wand', 'Missing Gem', 'First line', 'Second line']) assert.equal(core.translateWholeLine(text, data, 'zh-TW'), text);
  assert.equal(core.searchBilingual('Missing Wand', data, 'zh-TW')[0].chinese, 'Missing Wand');
  assert.equal(core.translateWholeLine('Missing Wand', data, 'zh-CN'), '错误法杖');
});

test('多行条目拆分保留独立繁中行', () => {
  const data = { nativeTraditional: {}, terms: {
    'First line\nSecond line': { translation: '第一行\n第二行', 'zh-TW': '第一列\n第二列', type: 'client_term' },
  } };
  assert.equal(core.translateWholeLine('Second line', data, 'zh-TW'), '第二列');
});

test('同客户端配对拒绝 ID 错位、行数和数组长度不符', () => {
  const schema = { name: 'BaseItemTypes' };
  const en = { count: 1, columns: { Id: ['a'], Name: ['Wand'] } };
  assert.throws(() => pairTableTexts(en, { count: 1, columns: { Id: ['b'], Name: ['法杖'] } }, schema, 'zh-TW'), /ID 顺序/);
  assert.throws(() => pairTableTexts(en, { count: 2, columns: {} }, schema, 'zh-TW'), /行数/);
  assert.throws(() => pairTableTexts(en, { count: 1, columns: { Id: ['a'], Name: [['一', '二']] } }, schema, 'zh-TW'), /数组长度/);
  assert.throws(() => readDatStrings(Buffer.alloc(12), { name: 'BaseItemTypes', columns: [] }), /schema/);
});

function statBlock() {
  const parsed = parseCsd('description\n2 low high\n1\n# # "Adds {0} to {1} Damage"\nlang "Traditional Chinese"\n1\n# # "從{1}至{0}傷害"', 'test.csd');
  const block = parsed.blocks[0];
  return { stats: block.stats, english: block.sections.English, translated: block.sections['Traditional Chinese'], locale: 'zh-TW', path: 'test.csd', duplicates: [], includes: [] };
}

test('CSD 原生参数换序通过实际运行时输出，数字和范围保持正确', () => {
  const data = { stats: { 'Adds # to # Damage': { 'zh-CN': '附加 # 至 # 伤害' } } };
  const report = applyNativeTraditional(data, { texts: [], stats: [statBlock()] });
  assert.equal(report.summary.stats.native, 1);
  assert.equal(core.translateWholeLine('Adds 12 to 24 Damage', data, 'zh-TW'), '從24至12傷害');
});

test('CSD 不匹配的参数格式、条件和数值变换均被拒绝', () => {
  for (const change of [form => { form.text = form.text.replace('{0}', '{0:+d}'); }, form => { form.limits = ['1', '#']; }, form => { form.special = 'negate 1'; }]) {
    const block = statBlock(); change(block.translated[0]);
    const result = alignStatForms(block);
    assert.equal(result.pairs.length, 0);
    assert.equal(result.rejected.length, 1);
  }
});

test('生成器保留真正的原生冲突，不能让旧人工译文掩盖冲突', () => {
  const row = (id, text) => ({ table: 'BaseItemTypes', id, field: 'Name', element: 0, locale: 'zh-TW', en: 'Example Wand', translated: text });
  const data = { items: { 'Example Wand': { 'zh-CN': '示例法杖', 'zh-TW': '舊的錯譯' } } };
  const report = applyNativeTraditional(data, { texts: [row('a', '甲法杖'), row('b', '乙法杖')], stats: [] }, { overrides: { 'Example Wand': { 'zh-TW': '人工猜測' } } });
  assert.equal(data.items['Example Wand']['zh-TW'], 'Example Wand');
  assert.equal(report.conflicts.length, 1);
});

test('相同字形的繁中仍保留明确字段和原生来源', () => {
  const data = { items: { Ring: { 'zh-CN': '戒指' } } };
  const report = applyNativeTraditional(data, { texts: [{ table: 'ItemClasses', id: 'Ring', field: 'Name', element: 0, locale: 'zh-TW', en: 'Ring', translated: '戒指' }], stats: [] });
  assert.equal(data.items.Ring['zh-TW'], '戒指');
  assert.equal(report.provenance['items:Ring'].kind, 'native');
});

test('机制说明独立选择繁中并记录缺译，原生冲突不能被人工说明掩盖', () => {
  const row = (locale, id, translated) => ({ table: 'KeywordPopups', id, field: 'Description', element: 0, locale, en: 'Example description', translated });
  const data = { terms: { Example: { translation: '示例', desc: '示例说明' }, Missing: { translation: '缺失', desc: '没有来源的说明' } } };
  const texts = [row('zh-CN', 'a', '示例说明'), row('zh-TW', 'a', '範例說明')];
  const report = applyNativeTraditional(data, { texts, stats: [] });
  assert.equal(data.terms.Example.descTW, '範例說明');
  assert.equal(data.terms.Example.desc, '示例说明');
  assert.equal(data.terms.Missing.descTW, undefined);
  assert.equal(report.descriptions.provenance.Example.kind, 'native');
  assert.equal(report.descriptions.missing[0].en, 'Missing');
  texts.push(row('zh-CN', 'b', '示例说明'), row('zh-TW', 'b', '另一種說明'));
  const conflict = applyNativeTraditional(data, { texts, stats: [] }, { glossary: { Example: { 'zh-TW': { desc: '人工說明' } } } });
  assert.equal(data.terms.Example.descTW, undefined);
  assert.equal(conflict.descriptions.conflicts[0].en, 'Example');
});

test('原生快照损坏或哈希不符时构建输入被拒绝', async () => {
  const lock = JSON.parse(await readFile(join(root, 'data/sources/native-translations/lock.json')));
  await assert.rejects(readSnapshot(join(root, lock.path), '0'.repeat(64)), /SHA-256/);
  const temporary = await mkdtemp(join(tmpdir(), 'ninja-native-test-'));
  await writeFile(join(temporary, 'broken.gz'), Buffer.from('broken'));
  await assert.rejects(readSnapshot(join(temporary, 'broken.gz')));
  assert.match(sha256, /^[a-f0-9]{64}$/);
});

test('离线复用遗漏历史清单中的词缀文件时采集明确失败', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'ninja-native-missing-'));
  const raw = join(temporary, 'raw');
  await mkdir(raw);
  const provenance = join(temporary, 'previous.gz');
  await writeFile(provenance, gzipSync(JSON.stringify({ tool: snapshot.tool, sources: [
    { client: 'cn', path: 'data/statdescriptions/missing.csd', sha256: '0'.repeat(64) },
  ] })));
  await assert.rejects(collectGameTranslations({ extracted: true, cn: raw, intl: raw, provenance, output: join(temporary, 'candidate') }), /复用资源遗漏提取清单中的文件：cn\/data\/statdescriptions\/missing.csd/);
});
