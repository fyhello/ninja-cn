import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadFavoriteManager() {
  const source = await readFile(new URL('../lib/favorite-manager.js', import.meta.url), 'utf8');
  const context = vm.createContext({ globalThis: {} });
  vm.runInContext(source, context);
  return context.globalThis.PoeNinjaFavoriteManager;
}

test('PoeNinjaFavoriteManager basic operations and sorting', async () => {
  const favoriteManager = await loadFavoriteManager();
  const {
    filterAndSortFavorites,
    parseMetricNumber,
    normalizeUrl,
  } = favoriteManager;

  // 1. URL 归一化测试
  assert.equal(normalizeUrl('/poe2/builds/char/acc/hero?page=1#tree'), '/poe2/builds/char/acc/hero');
  assert.equal(normalizeUrl('https://poe.ninja/builds/char/acc/hero'), '/builds/char/acc/hero');

  // 2. 数值解析测试
  assert.equal(parseMetricNumber('1497'), 1497);
  assert.equal(parseMetricNumber('71k'), 71000);
  assert.equal(parseMetricNumber('2.7M'), 2700000);
  assert.equal(parseMetricNumber('1.4B'), 1400000000);
  assert.equal(parseMetricNumber('-'), 0);

  // 3. 筛选与排序测试
  const sampleList = [
    {
      id: '1',
      name: 'ResurrectGodAura',
      account: 'GodPlayer',
      classTitle: 'Monk',
      level: '100',
      life: '1497',
      es: '3297',
      ehp: '71k',
      dps: '205k',
      mainSkillName: 'Spark',
      addedAt: 1000,
    },
    {
      id: '2',
      name: 'goodnerfing',
      account: 'NerfMan',
      classTitle: 'Warrior',
      level: '98',
      life: '6118',
      es: '0',
      ehp: '48k',
      dps: '46M',
      mainSkillName: 'Sunder',
      addedAt: 2000,
    },
    {
      id: '3',
      name: 'stillAengus',
      account: 'AengusAcc',
      classTitle: 'Sorceress',
      level: '100',
      life: '1516',
      es: '4427',
      ehp: '26k',
      dps: '46M',
      mainSkillName: 'Ice Nova',
      addedAt: 3000,
    }
  ];

  // 模糊搜索
  const sparkRes = filterAndSortFavorites(sampleList, 'Spark');
  assert.equal(sparkRes.length, 1);
  assert.equal(sparkRes[0].name, 'ResurrectGodAura');

  const monkRes = filterAndSortFavorites(sampleList, 'Monk');
  assert.equal(monkRes.length, 1);
  assert.equal(monkRes[0].classTitle, 'Monk');

  const nerfRes = filterAndSortFavorites(sampleList, 'NerfMan');
  assert.equal(nerfRes.length, 1);
  assert.equal(nerfRes[0].name, 'goodnerfing');

  // 按 DPS 降序排序
  const dpsSorted = filterAndSortFavorites(sampleList, '', 'dps_desc');
  assert.equal(dpsSorted[0].dps, '46M');
  assert.equal(dpsSorted[2].dps, '205k');

  // 按 生命 降序排序
  const lifeSorted = filterAndSortFavorites(sampleList, '', 'life_desc');
  assert.equal(lifeSorted[0].name, 'goodnerfing');
  assert.equal(lifeSorted[0].life, '6118');

  // 按 EHP 降序排序
  const ehpSorted = filterAndSortFavorites(sampleList, '', 'ehp_desc');
  assert.equal(ehpSorted[0].name, 'ResurrectGodAura');
  assert.equal(ehpSorted[0].ehp, '71k');

  // 按 护盾 降序排序
  const esSorted = filterAndSortFavorites(sampleList, '', 'es_desc');
  assert.equal(esSorted[0].name, 'stillAengus');
  assert.equal(esSorted[0].es, '4427');
});
