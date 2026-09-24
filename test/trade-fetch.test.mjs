import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('TradeFetchEngine transforms PoE2 trade card JSON accurately and fast', async () => {
  await import('../trade/trade-fetch-engine.js');
  const TradeFetchEngine = globalThis.PoeNinjaTradeFetchEngine;
  assert.ok(TradeFetchEngine, 'TradeFetchEngine should be globally available');

  const dictText = await readFile(resolve(ROOT, 'data', 'poe2.json'), 'utf8');
  const dict = JSON.parse(dictText);
  const engine = TradeFetchEngine.createTradeFetchEngine(dict);

  const mockResponse = {
    result: [
      {
        id: "item_001",
        item: {
          name: "Headhunter",
          typeLine: "Heavy Belt",
          baseType: "Heavy Belt",
          properties: [
            { name: "Quality", values: [["+20%", 1]], displayMode: 0 },
            { name: "Armour", values: [["150", 0]], displayMode: 0 }
          ],
          requirements: [
            { name: "Level", values: [["60", 0]], displayMode: 0 },
            { name: "Strength", values: [["120", 0]], displayMode: 0 }
          ],
          explicitMods: [
            "+40 to Strength",
            "+50 to Dexterity",
            "+60 to maximum Life"
          ],
          implicitMods: [
            "+25 to Strength"
          ]
        }
      }
    ]
  };

  const start = performance.now();
  const transformedCn = engine.transformFetchResponse(JSON.parse(JSON.stringify(mockResponse)), 'zh-CN');
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 10, `Transformation took ${elapsed.toFixed(2)}ms, which should be < 10ms`);

  const itemCn = transformedCn.result[0].item;
  assert.equal(itemCn.name, '猎首');
  assert.equal(itemCn.typeLine, '重革腰带');
  assert.deepEqual(itemCn.explicitMods, ['+40 力量', '+50 敏捷', '+60 生命上限']);
  assert.deepEqual(itemCn.implicitMods, ['+25 力量']);
  assert.equal(itemCn.requirements[0].name, '等级');
  assert.equal(itemCn.requirements[1].name, '力量');
  assert.ok(itemCn._rawEnglish, 'Raw English should be preserved for whisper safety');
  assert.equal(itemCn._rawEnglish.name, 'Headhunter');
});

test('TradeSearchHelper injects bilingual labels for stats and items', async () => {
  await import('../trade/trade-fetch-engine.js');
  await import('../trade/trade-search-helper.js');
  const TradeFetchEngine = globalThis.PoeNinjaTradeFetchEngine;
  const TradeSearchHelper = globalThis.PoeNinjaTradeSearchHelper;

  const dictText = await readFile(resolve(ROOT, 'data', 'poe2.json'), 'utf8');
  const dict = JSON.parse(dictText);
  const fetchEngine = TradeFetchEngine.createTradeFetchEngine(dict);
  const searchHelper = TradeSearchHelper.createTradeSearchHelper(fetchEngine, dict);

  const mockStats = {
    result: [
      {
        id: "explicit",
        label: "Explicit",
        entries: [
          { id: "explicit.stat_1", text: "+# to maximum Life", type: "explicit" }
        ]
      }
    ]
  };

  const transformedStats = searchHelper.transformStatsMetadata(JSON.parse(JSON.stringify(mockStats)), 'zh-CN');
  assert.equal(transformedStats.result[0].label, '显式词缀');
  assert.equal(transformedStats.result[0].entries[0].text, '+# 生命上限');

  const mockItems = {
    result: [
      {
        id: "accessory",
        label: "Accessories",
        entries: [
          { name: "Headhunter", type: "Heavy Belt", text: "Headhunter Heavy Belt" }
        ]
      }
    ]
  };

  const transformedItems = searchHelper.transformItemsMetadata(JSON.parse(JSON.stringify(mockItems)), 'zh-CN');
  assert.equal(transformedItems.result[0].label, '饰品');
  assert.equal(transformedItems.result[0].entries[0].name, '猎首');
  assert.ok(transformedItems.result[0].entries[0].text.includes('猎首'));
  assert.ok(transformedItems.result[0].entries[0].text.includes('Headhunter'));
});

test('TradeFetchEngine supports object-structured mod items and grantedSkills without returning [object Object]', async () => {
  await import('../trade/trade-fetch-engine.js');
  const TradeFetchEngine = globalThis.PoeNinjaTradeFetchEngine;

  const dictText = await readFile(resolve(ROOT, 'data', 'poe2.json'), 'utf8');
  const dict = JSON.parse(dictText);
  const engine = TradeFetchEngine.createTradeFetchEngine(dict);

  const mockResponse = {
    result: [
      {
        id: "item_002",
        item: {
          name: "Sceptre",
          typeLine: "Omen Sceptre",
          baseType: "Omen Sceptre",
          explicitMods: [
            { hash: "explicit.stat_1", description: "+12 to maximum Energy Shield", text: "+12 to maximum Energy Shield" },
            { hash: "explicit.stat_2", description: "+15% to Fire Resistance", text: "+15% to Fire Resistance" }
          ],
          grantedSkills: [
            { name: "Level 5 Enfeeble", values: [["Level 5 Enfeeble", 0]] }
          ]
        }
      }
    ]
  };

  const transformed = engine.transformFetchResponse(JSON.parse(JSON.stringify(mockResponse)), 'zh-CN');
  const item = transformed.result[0].item;

  assert.ok(typeof item.explicitMods[0] === 'object', 'Object mod structure should be preserved');
  assert.equal(item.explicitMods[0].description, '+12 能量护盾上限');
  assert.equal(item.explicitMods[1].description, '火焰抗性 +15%');
  assert.notEqual(item.explicitMods[0].description, '[object Object]');
  assert.notEqual(item.explicitMods[0].description, 'OBJECT OBJECT');
});

test('TradeFetchEngine restores Chinese item names and types back to official English before sending search requests', async () => {
  await import('../trade/trade-fetch-engine.js');
  const TradeFetchEngine = globalThis.PoeNinjaTradeFetchEngine;

  const dictText = await readFile(resolve(ROOT, 'data', 'poe2.json'), 'utf8');
  const dict = JSON.parse(dictText);
  const engine = TradeFetchEngine.createTradeFetchEngine(dict);

  const mockQueryPayload = {
    query: {
      status: { option: "online" },
      name: "猎首 (Headhunter)",
      type: "重革腰带 (Heavy Belt)"
    }
  };

  const restored = engine.restoreSearchQueryJson(JSON.stringify(mockQueryPayload));
  const parsed = JSON.parse(restored);

  assert.equal(parsed.query.name, 'Headhunter');
  assert.equal(parsed.query.type, 'Heavy Belt');

  // 测试纯中文反查还原
  const mockCustomQuery = {
    query: {
      name: "猎首",
      type: "重革腰带"
    }
  };
  const restoredCustom = engine.restoreSearchQueryJson(JSON.stringify(mockCustomQuery));
  const parsedCustom = JSON.parse(restoredCustom);
  assert.equal(parsedCustom.query.name, 'Headhunter');
  assert.equal(parsedCustom.query.type, 'Heavy Belt');
});


