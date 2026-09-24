# POE Ninja 三语切换扩展设计

## 目标

为 `poe.ninja` 提供一个独立的 Microsoft Edge Manifest V3 扩展，支持英文、简体中文和繁体中文切换，覆盖 POE1 与 POE2 的经济、Build、物品详情和动态 Tooltip 页面。

## 官方词典来源

- POE1：`https://poedb.tw/us/`、`https://poedb.tw/cn/`、`https://poedb.tw/tw/`
- POE2：`https://poe2db.tw/us/`、`https://poe2db.tw/cn/`、`https://poe2db.tw/tw/`

同一资源的英文 slug 作为稳定键。构建脚本抓取三种语言的页面标题、物品名和可见文本，生成扩展内的本地 JSON。扩展运行时不依赖在线词典；POEDB 查询按钮则根据当前语言生成对应 `/us/`、`/cn/` 或 `/tw/` 链接。

### POE2 Tooltip 词典

POE2 宝石目录中的每个同 slug 资源都带有独立的官方三语 `Poe_Data_GemEffects_hover` URL。生成器按 slug 关联 `us`、`cn`、`tw` 的 URL，抽取标签、属性、需求、说明和效果等可见行，并以 DOM 类名和序号对齐三种语言。英文本身作为检索键，数值、正负号和数值区间归一化为 `#` 模板，使 poe.ninja 在不同等级、品质或装备数值下仍能使用官方译文。

装备与被动词缀从 POE2DB 的官方三语 `Modifiers` 页面提取。只接纳三种语言中具有相同稳定顺序和有效文本的行；任一页缺失、数量不一致或无法对齐的记录不会进入词典。生成结果放入独立的 `tooltip` 分区，避免与物品名称、导航 UI 和普通属性混淆。

## 运行时架构

`background.js` 加载 POE1/POE2 的合并词典并响应内容脚本；`content.js` 保存原始文本、翻译文本节点和属性，使用 `MutationObserver` 处理 poe.ninja 的 SPA 路由与异步节点；`popup.html/js/css` 提供三档语言切换并持久化 `language`。动态 Tooltip 另按完整叶子行取原始文本进行翻译，避免词缀数值和说明被多个 `span` 拆分后失去匹配机会；语言切换或 Tooltip 内容复用时恢复该行保存的原始 HTML。

语言切换流程为：断开观察器、恢复所有已处理节点的原文、切换当前语言、重新扫描页面。英文模式只恢复原文，不修改站点结构。翻译范围排除 `SCRIPT`、`STYLE`、输入控件、SVG 和扩展自身节点。

## 错误处理

词典加载失败时内容脚本保持页面原文并在控制台记录一次错误；单个未知词回退英文，不阻塞其余节点。抓取脚本对单页 HTTP 错误记录并继续处理其他页面，最终以非零退出码报告失败数量。

## 验证

- Node 内置测试覆盖语言路由、官方 URL 生成、区间数值模板、官方 Tooltip 三语行对齐、页面文本提取和三语词典结构。
- 静态验证检查 Manifest V3、目标匹配范围、脚本引用和 JSON 可解析性。
- 使用 Edge 加载解压目录，手工验证 `poe.ninja/poe2/economy`、`poe.ninja/poe2/builds` 和 POE1 页面中的三档切换与动态节点。
