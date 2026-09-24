# POE2 Tooltip 官方三语词典实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `test-driven-development` 逐任务实现此计划。当前工作区无 Git 根目录，不创建工作树或提交。

**目标：** 让 POE2 poe.ninja Tooltip 的装备词缀、技能标签、属性、说明和效果在简体中文与繁体中文模式使用本地官方 POE2DB 译文显示。

**架构：** `tools/official-dictionary.mjs` 从同 slug 的 `Gem` 三语页面发现各自官方 hover URL，按稳定行位置提取并对齐可见 Tooltip 文本；三语 `Modifiers` 页生成通用属性模板。运行时将普通节点、属性和 Tooltip 完整行统一查询 `items`、`stats`、`tooltip` 分区，数值和数值区间归一化为 `#` 模板。Tooltip 行单独保存原始 HTML，使 MutationObserver 重扫和语言切换不产生重复或丢失原文。

**技术栈：** Manifest V3、原生 JavaScript、Node.js 内置 `fetch`/`node:test`，无第三方依赖。

---

### 任务 1：官方 Tooltip 提取与三语对齐

**文件：**
- 修改：`test/official-dictionary.test.mjs`
- 修改：`tools/official-dictionary.mjs`

- [ ] **步骤 1：编写失败的提取和对齐测试**

```js
assert.deepEqual(extractTooltipLines(englishHover), [
  { kind: 'content', text: 'Spell, Minion' },
  { kind: 'explicitMod', text: '+33 to Intelligence' },
]);
assert.deepEqual(buildTooltipEntries({ en, 'zh-CN': cn, 'zh-TW': tw }), {
  '+# to Intelligence': {
    en: '+# to Intelligence',
    'zh-CN': '+# 点智慧',
    'zh-TW': '+# 點智慧',
  },
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/official-dictionary.test.mjs`

预期：FAIL，报错 `extractTooltipLines is not a function`。

- [ ] **步骤 3：实现稳定的 HTML 行提取和数值模板归一化**

```js
export function normaliseTooltipTemplate(text) {
  return cleanTooltipText(text)
    .replace(/([+-]?)\(\s*[+-]?\d+(?:\.\d+)?\s*(?:[-—]\s*[+-]?\d+(?:\.\d+)?\s*)+\)/g, '$1#')
    .replace(/[+-]?\d+(?:\.\d+)?/g, '#');
}

export function buildTooltipEntries(catalogs) {
  // Only use matching kind/index rows from all three official languages.
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/official-dictionary.test.mjs`

预期：PASS，所有现有抓取器测试与新增 Tooltip 测试通过。

### 任务 2：生成 POE2 Tooltip 与词缀词典

**文件：**
- 修改：`test/official-dictionary.test.mjs`
- 修改：`tools/official-dictionary.mjs`
- 修改：`data/poe2.json`

- [ ] **步骤 1：编写失败的生成测试**

```js
const dictionary = await generatePoe2TooltipDictionary({ fetchImpl });
assert.equal(dictionary.tooltip['+# to Intelligence']['zh-CN'], '+# 点智慧');
assert.equal(dictionary.tooltip['Spell, Minion']['zh-TW'], '法術, 召喚物');
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/official-dictionary.test.mjs`

预期：FAIL，报错 `generatePoe2TooltipDictionary is not a function`。

- [ ] **步骤 3：实现有界并发的官方页面生成器，并合并 `tooltip` 分区**

```js
const generated = await generatePoe2TooltipDictionary({ fetchImpl, concurrency: 8 });
dictionary.tooltip = { ...(existing.tooltip ?? {}), ...generated.tooltip };
```

生成器必须：只使用 `https://poe2db.tw/{us,cn,tw}/` 和从对应目录取得的 hover URL；跳过三语无法完整对齐的资源；保留现有 `items`、`stats`、`ui`；将 `Modifiers` 的区间数值变为可匹配的 `#` 模板。

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/official-dictionary.test.mjs`

预期：PASS，Mock 官方页面断言三语模板和词典合并均通过。

### 任务 3：运行时模板与 Tooltip 行翻译

**文件：**
- 修改：`test/content-translation.test.mjs`
- 修改：`lib/translation-core.js`
- 修改：`content.js`

- [ ] **步骤 1：编写失败的运行时测试**

```js
assert.equal(
  translateText('98% increased Energy Shield', tooltipDictionary, 'zh-CN'),
  '能量护盾提高 98%',
);
assert.equal(
  translateText('+33 to Intelligence', tooltipDictionary, 'zh-TW'),
  '+33 點智慧',
);
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/content-translation.test.mjs`

预期：FAIL，原实现只接受逐个 `#` 的严格数值格式，无法匹配数值区间归一化模板。

- [ ] **步骤 3：实现 O(1) 数值模板查找和 Tooltip 完整行处理**

```js
const template = normaliseNumericTemplate(source);
const entry = dictionary.tooltip?.[template] ?? dictionary.stats?.[template];
```

`content.js` 仅在动态 Tooltip 内选择无块级子元素的行；第一次替换前保存原始 `innerHTML`，同一 Tooltip 被复用或切换语言时先恢复原文，随后按当前语言重新翻译。普通页面节点继续走现有原文缓存，未知行保持英文。

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/content-translation.test.mjs`

预期：PASS，数值、正负号、百分号保持原数值，未知文本不翻译。

### 任务 4：词典再生、静态验证与交付包

**文件：**
- 修改：`test/extension-static.test.mjs`
- 修改：`tools/validate-extension.mjs`
- 修改：`README.md`
- 修改：`data/poe2.json`
- 创建：`dist/POE-Ninja-three-language-v0.2.0.zip`

- [ ] **步骤 1：编写失败的静态覆盖测试**

```js
assert.ok(Object.keys(dictionary.tooltip).length > 100);
assert.equal(dictionary.tooltip['+# to Intelligence']['zh-CN'], '+# 点智慧');
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node --test test/extension-static.test.mjs`

预期：FAIL，当前字典没有 `tooltip` 分区。

- [ ] **步骤 3：再生词典、更新验证器与交付说明**

```powershell
node tools/official-dictionary.mjs --catalog-out data
Compress-Archive -Path background.js,content.js,data,lib,manifest.json,popup.css,popup.html,popup.js,README.md -DestinationPath dist/POE-Ninja-three-language-v0.2.0.zip
Get-FileHash dist/POE-Ninja-three-language-v0.2.0.zip -Algorithm SHA256
```

README 明确说明：词典更新期间需要联网；安装和浏览时不发送 POE2DB 翻译请求；官方未能验证对齐的 Tooltip 行保留英文。

- [ ] **步骤 4：运行完整验证**

运行：

```powershell
node --test test/*.test.mjs
node tools/validate-extension.mjs
```

预期：两个命令均以退出码 0 完成；压缩包包含 Manifest、内容脚本、核心库和两份 JSON 词典。
