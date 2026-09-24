import assert from 'node:assert/strict';
import test from 'node:test';
import { makeBrowser, rawMessage, runScript, settle } from './helpers/trade-browser.mjs';
import { localizeModText, patchTradeLocalization } from '../tools/trade-localization-patches.mjs';
await import('../trade/trade-pob-converter.js');
const { itemToPobText, cleanRichText } = globalThis.PoeNinjaTradePobConverter;
const base = { id: 'A', name: '', typeLine: 'Dueling Wand', baseType: 'Dueling Wand', frameType: 2, ilvl: 80 };

test('转换器保留同文词缀的来源、数量、换行和对象标记', () => {
  const item = { ...base,
    implicitMods: ['+20 to maximum Mana'], runeMods: ['+20 to maximum Mana', '+20 to maximum Mana'],
    explicitMods: ['+20 to maximum Mana', { description: '+12 to maximum Life\n+5 to Strength', text: '旧显示文本', crafted: true, fractured: true, mutated: true }],
    desecratedMods: ['+17 to maximum Life'], mutatedMods: ['+13 to Strength'],
    fracturedMods: ['+11 to Dexterity'], craftedMods: ['+19 to maximum Mana'],
  };
  const original = JSON.stringify(item);
  const text = itemToPobText(item);
  assert.equal(text.split('+20 to maximum Mana').length - 1, 4);
  for (const line of ['+12 to maximum Life', '+5 to Strength']) assert.ok(text.includes(`${line} (crafted) (fractured) (mutated)`));
  assert.ok(text.includes('+17 to maximum Life (desecrated)'));
  assert.ok(text.includes('+13 to Strength (mutated)'));
  assert.ok(text.includes('+11 to Dexterity (fractured)'));
  assert.ok(text.includes('+19 to maximum Mana (crafted)'));
  assert.equal(JSON.stringify(item), original);
});

test('转换器按官方技能、插槽及状态字段输出', () => {
  const text = itemToPobText({ ...base, grantedSkills: [{ name: 'Grants Skill', values: [['Level 14 Spellslinger', 0]] }], sockets: [{ type: 'rune' }, { type: 'jewel' }], mirrored: true, sanctified: true, doubleCorrupted: true });
  for (const line of ['Grants Skill: Level 14 Spellslinger (implicit)', 'Sockets: S J', 'Mirrored', 'Sanctified', 'Twice Corrupted']) assert.ok(text.split('\n').includes(line));
  assert.ok(!text.includes('Level Level'));
  assert.equal(cleanRichText('<<set:MS>>[Life|maximum Life]\r\n{+12} to Strength'), 'maximum Life\n+12 to Strength');
});

test('转换器保留品质、小数及旧式插槽连接', () => {
  const text = itemToPobText({ ...base, properties: [{ name: 'Quality (Life Modifiers)', values: [['+20%', 1]] }, { name: 'Critical Hit Chance', values: [['8.70%', 1]] }], sockets: [{ type: 'gem', sColour: 'R', group: 0 }, { sColour: 'G', group: 0 }, { sColour: 'B', group: 1 }] });
  assert.ok(text.includes('Quality (Life Modifiers): +20%'));
  assert.ok(text.includes('Critical Hit Chance: 8.70%'));
  assert.ok(text.includes('Sockets: R-G B'));
});

test('无效或已翻译数据不能伪装为转换成功', () => {
  for (const item of [null, {}, [], { ...base, frameType: 100 }, { ...base, frameType: 'toString' }, { ...base, typeLine: '', baseType: '' }, { ...base, typeLine: '决斗法杖' }, { ...base, explicitMods: [{ hash: 'x' }] }, { ...base, explicitMods: ['+20 生命上限'] }, { ...base, explicitMods: {} }, { ...base, grantedSkills: [{ name: 'Grants Skill', values: [] }] }]) assert.throws(() => itemToPobText(item));
});

test('真实生成模块在简繁及关闭翻译时同时保留 fetch/XHR 原文', async () => {
  for (const mode of ['zh', 'zh-tw', 'off']) {
    const browser = makeBrowser({ mode, item: {
      ...base,
      explicitMods: [{ hash: 'explicit.stat_3299347043', description: '+23 to maximum Life', text: '+23 to maximum Life', fractured: true }],
      mutatedMods: [{ hash: 'explicit.stat_1050105434', description: '+17 to maximum Mana' }],
      grantedSkills: [{ name: 'Grants Skill', values: [['Level 14 Spellslinger', 0]] }],
    } });
    const c = browser.context;
    runScript(c, 'trade/trade-pob-hook.js'); runScript(c, 'trade/trade-standalone.js');
    for (const responseType of ['', 'json']) {
      const xhr = new c.XMLHttpRequest(); xhr.open('GET', '/api/trade2/fetch/listing-A'); xhr.responseType = responseType; xhr.send();
      const visible = responseType ? xhr.response : JSON.parse(xhr.responseText);
      const raw = c.__POE_NINJA_RAW_CACHE__.get('listing-A');
      assert.equal(raw.typeLine, 'Dueling Wand');
      assert.equal(raw.explicitMods[0].description, '+23 to maximum Life');
      assert.equal(raw.grantedSkills[0].values[0][0], 'Level 14 Spellslinger');
      if (mode !== 'off') {
        assert.match(visible.result[0].item.typeLine, /[\u3400-\u9fff]/);
        assert.equal(visible.result[0].item.explicitMods[0].text, visible.result[0].item.explicitMods[0].description);
        assert.match(visible.result[0].item.mutatedMods[0].description, /17/);
        assert.doesNotMatch(visible.result[0].item.mutatedMods[0].description, /maximum Mana/);
        assert.equal(visible.result[0].item.explicitMods[0].fractured, true);
      }
      xhr.open('GET', '/api/trade2/fetch/listing-B');
      xhr.complete({ result: [{ id: 'listing-B', item: { ...base, id: 'B', typeLine: 'Omen Sceptre' } }] });
      assert.equal(c.__POE_NINJA_RAW_CACHE__.get('listing-B').typeLine, 'Omen Sceptre');
      xhr.open('GET', '/unrelated'); xhr.complete({ result: [{ id: 'unrelated', item: base }] });
      assert.equal(c.__POE_NINJA_RAW_CACHE__.has('unrelated'), false);
    }
    const response = await c.fetch(new Request('https://www.pathofexile.com/api/trade2/fetch/listing-A'));
    await response.json(); await settle();
    assert.equal(c.__POE_NINJA_RAW_CACHE__.get('listing-A').typeLine, 'Dueling Wand');
    assert.equal(browser.warnings.length, 0, browser.warnings.join('\n'));
    assert.ok(browser.messages.filter((message) => message.body).every((message) => message.body.result.every((entry) => !/[\u3400-\u9fff]/.test(entry.item.typeLine))));
  }
});

test('原文快照不受 JSON 对象后续修改影响，HTTP 错误不入缓存', async () => {
  const browser = makeBrowser({ item: base }); runScript(browser.context, 'trade/trade-pob-hook.js');
  const xhr = new browser.context.XMLHttpRequest(); xhr.open('GET', '/api/trade2/fetch/A'); xhr.responseType = 'json'; xhr.send(); xhr.response.result[0].item.typeLine = '已修改';
  assert.equal(browser.context.__POE_NINJA_RAW_CACHE__.get('listing-A').typeLine, 'Dueling Wand');
  const failed = makeBrowser({ item: base, status: 429 }); runScript(failed.context, 'trade/trade-pob-hook.js');
  await failed.context.fetch('/api/trade2/fetch/A'); await settle();
  assert.equal(failed.context.__POE_NINJA_RAW_CACHE__.size, 0);
  assert.match(failed.warnings.join(''), /429/);
});

test('网络拒绝保持原始失败，并处理旁路读取的 Promise 拒绝', async () => {
  const error = new Error('模拟断网'); const browser = makeBrowser({ fetchError: error }); runScript(browser.context, 'trade/trade-pob-hook.js');
  await assert.rejects(browser.context.fetch('/api/trade2/fetch/A'), (value) => value === error);
  await settle(); assert.match(browser.warnings.join(''), /网络请求/);
});

test('翻译保留多行、数值、符号、百分号及富文本显示值', () => {
  assert.equal(localizeModText('+# 生命上限\n+# 力量', '+20 to maximum Life\n+7 to Strength', false), '+20 生命上限\n+7 力量');
  assert.equal(localizeModText('+#% 暴击几率', '+2.70% to [CriticalChance123|Critical Hit Chance]', false), '+2.70% 暴击几率');
  assert.equal(localizeModText('附加 # 至 # 火焰伤害', 'Adds 10-20 Fire Damage', false), '附加 10 至 20 火焰伤害');
  assert.equal(localizeModText('+# 火焰抗性', '-12 to Fire Resistance', false), '-12 火焰抗性');
  assert.equal(localizeModText('最多可以有 1 个额外工艺词缀', 'Can have 1 additional Crafted Modifier', false), '最多可以有 1 个额外工艺词缀');
  assert.equal(localizeModText('在 4 秒内获得 #% 额外伤害', 'Gain 15% Extra Damage for 4 seconds', false), '在 4 秒内获得 15% 额外伤害');
});

test('翻译模板形状变化使构建明确失败', () => {
  assert.throws(() => patchTradeLocalization('上游结构已经变化'), /修补位置/);
});

test('复制在两种剪贴板写入均失败时显示失败且清理临时元素', async () => {
  for (const copyResult of [false, new Error('复制异常')]) {
    const browser = makeBrowser({ withUI: true, clipboardError: true, copyResult }); const row = browser.addRow('A'); browser.scan(); browser.dispatch(rawMessage([base]));
    await browser.click(row);
    const button = row.children[0];
    assert.equal(button.textContent, '复制失败'); assert.equal(button.classList.contains('success'), false); assert.ok(button.title);
    assert.equal(browser.context.document.body.children.length, 0); assert.equal(button.disabled, false);
  }
});

test('行复用和 data-item-id 按当前物品复制', async () => {
  const browser = makeBrowser({ withUI: true }); const row = browser.addRow('A', 'data-item-id'); browser.scan(); browser.dispatch(rawMessage([base, { ...base, id: 'B', typeLine: 'Omen Sceptre' }]));
  row.attrs['data-item-id'] = 'B'; browser.scan(); await browser.click(row);
  assert.equal(row.children.length, 1); assert.ok(browser.copied[0].includes('Omen Sceptre'));
});

test('剪贴板回退成功才显示成功，等待权限期间换行不会复制旧物品', async () => {
  const success = makeBrowser({ withUI: true, clipboardError: true, copyResult: true });
  const first = success.addRow('A'); success.scan(); success.dispatch(rawMessage([base])); await success.click(first);
  assert.equal(first.children[0].classList.contains('success'), true);
  const delayed = makeBrowser({ withUI: true }); const row = delayed.addRow('A'); delayed.scan(); delayed.dispatch(rawMessage([base]));
  let rejectClipboard;
  delayed.context.navigator.clipboard.writeText = () => new Promise((resolve, reject) => { rejectClipboard = reject; });
  const pending = delayed.click(row); await settle(); row.attrs['data-id'] = 'B'; rejectClipboard(new Error('权限被拒绝')); await pending;
  assert.equal(row.children[0].classList.contains('success'), false);
  assert.match(row.children[0].title, /已更新/);
  assert.equal(delayed.context.document.body.children.length, 0);
});

test('读取途中物品变更、数据无效或响应超时均不复制', async () => {
  const browser = makeBrowser({ withUI: true }); const row = browser.addRow('A'); browser.scan();
  const click = browser.click(row); const request = browser.messages.at(-1); row.attrs['data-id'] = 'B';
  browser.dispatch({ ...request, type: 'POE_NINJA_RESPONSE_RAW_ITEM', item: base }); await click;
  assert.equal(browser.copied.length, 0); assert.match(row.children[0].title, /已更新/);
  browser.dispatch(rawMessage([{ id: 'B' }])); await browser.click(row); assert.equal(browser.copied.length, 0);
  const timeout = makeBrowser({ withUI: true }); const other = timeout.addRow('missing'); timeout.scan(); const waiting = timeout.click(other);
  for (const callback of [...timeout.timers.values()]) callback(); await waiting;
  assert.match(other.children[0].title, /超时/); assert.equal(timeout.copied.length, 0);
});

test('缓存缺失时按 ID 获取原文，消费者修改不会污染缓存', async () => {
  const browser = makeBrowser({ item: base }); runScript(browser.context, 'trade/trade-pob-hook.js');
  const xhr = new browser.context.XMLHttpRequest(); xhr.open('GET', '/api/trade2/fetch/A'); xhr.send(); await settle();
  browser.startUI(); const row = browser.addRow('listing-A'); browser.scan(); await browser.click(row);
  assert.ok(browser.copied[0].includes('Dueling Wand'));
  const item = browser.context.PoeNinjaRawDataManager.getRawItem('listing-A'); item.typeLine = '改写';
  assert.equal(browser.context.PoeNinjaRawDataManager.getRawItem('listing-A').typeLine, 'Dueling Wand');
});
