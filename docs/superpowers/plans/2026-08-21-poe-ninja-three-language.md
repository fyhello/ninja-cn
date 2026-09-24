# POE Ninja 三语切换扩展实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `test-driven-development`；当前工作区无 Git 根目录，因此不执行 commit。

**目标：** 创建一个可在 Edge 中加载的 POE Ninja 三语翻译扩展，并从 POEDB 官方 `us/cn/tw` 页面生成可更新的本地词典。

**架构：** 开发期用 Node 抓取器按 POE1/POE2 和语言路径抓取官方页面，运行期只读取 `data/*.json`。MV3 service worker 提供词典，content script 翻译 DOM 和动态 Tooltip，popup 负责语言切换。

**技术栈：** 原生 JavaScript、Manifest V3、Node.js 内置 `fetch`/`node:test`，无第三方依赖。

---

### 任务 1：官方 URL 与页面提取器

**文件：**
- 创建：`tools/official-dictionary.mjs`
- 创建：`test/official-dictionary.test.mjs`

- [ ] 编写测试：断言 POE1/POE2 的域名、`us/cn/tw` 路径和 slug 生成；断言 HTML 提取标题、`itemName` 文本和 `data-bs-title`。
- [ ] 运行 `node --test test/official-dictionary.test.mjs`，确认因模块不存在而失败。
- [ ] 实现纯函数 `buildOfficialUrl(game, language, slug)`、`extractPageEntries(html)` 和 `mergeEntry(target, entry)`，抓取器支持 `--manifest <file>` 和 `--out <dir>`，HTTP 失败继续并最终报告失败数。
- [ ] 重新运行测试，确认全部通过。

### 任务 2：核心本地词典与静态验证

**文件：**
- 创建：`data/poe1.json`
- 创建：`data/poe2.json`
- 创建：`test/extension-static.test.mjs`

- [ ] 编写测试：断言每个词典包含 `items`、`stats`、`ui` 和 `sources`，每条词条含 `en`、`zh-CN`、`zh-TW`；断言关键术语来自官方页面快照。
- [ ] 运行测试，确认空词典或文件缺失导致失败。
- [ ] 写入核心导航、经济分类、稀有度、物品属性和 POE2 常见术语的三语词典，并记录对应 POEDB 来源 URL；保留英文 key，避免运行时依赖中文反查。
- [ ] 重新运行测试，确认 JSON 与 Manifest 约束通过。

### 任务 3：Manifest、后台与弹窗

**文件：**
- 创建：`manifest.json`
- 创建：`background.js`
- 创建：`popup.html`
- 创建：`popup.js`
- 创建：`popup.css`

- [ ] 编写测试：检查 MV3、`https://poe.ninja/*` 匹配、`storage` 权限、三档按钮和背景脚本引用。
- [ ] 运行静态测试确认初始失败。
- [ ] 实现词典缓存、POE1/POE2 合并、浏览器语言默认值、`GET_DICTIONARY`/`SET_LANGUAGE` 消息和 popup 即时切换。
- [ ] 重新运行静态测试确认通过。

### 任务 4：内容脚本与动态翻译

**文件：**
- 创建：`content.js`
- 创建：`test/content-translation.test.mjs`

- [ ] 编写测试：断言文本节点保留原文、简中/繁中切换使用同一英文 key、数字和 `%` 占位符不变、未知文本回退英文。
- [ ] 运行测试确认初始失败。
- [ ] 实现节点原文缓存、属性翻译、Tooltip 扫描、POE1/POE2 词典选择、MutationObserver 防抖和语言切换恢复流程；忽略脚本、输入、SVG 与扩展节点。
- [ ] 重新运行测试确认通过。

### 任务 5：POEDB 查询链接、抓取示例与交付说明

**文件：**
- 修改：`content.js`
- 创建：`README.md`
- 创建：`tools/sample-manifest.json`
- 创建：`tools/validate-extension.mjs`

- [ ] 编写测试：断言当前语言生成 `/us/`、`/cn/`、`/tw/` 查询链接，且 POE1/POE2 使用正确域名。
- [ ] 运行测试确认初始失败。
- [ ] 实现物品行上的 POEDB 查询按钮和详情页按钮；提供小型抓取清单、扩展验证脚本、Edge 加载步骤和手工验收边界。
- [ ] 运行完整 `node --test test/*.test.mjs`、`node tools/validate-extension.mjs`，检查目录可加载。
