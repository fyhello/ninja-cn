# POE Ninja 三语翻译扩展 (POE Ninja Three-Language Extension)

这是一个基于 Manifest V3 规范的高性能浏览器扩展（支持 Microsoft Edge 与 Google Chrome），专为 `poe.ninja`（流放之路 1 & 2）提供**英文（English）**、**简体中文（Simplified Chinese）**与**繁体中文（Traditional Chinese）**的三语实时互译、双语搜索联想、暗金装备词缀匹配与机制悬停说明。

本扩展采用 **100% 本地离线词典计算**，不向任何第三方翻译接口发送请求，具备零延迟、极低内存占用与高稳定性的特点。

---

## 🌟 核心特性

1. **官方正版数据解包对齐**：
   - 简中沿用现有客户端解包词库；繁中独立读取国际服客户端的 Traditional Chinese 数据表和 CSD 词缀语言段，按资源身份与参数语义对齐；
2. **独立简繁术语支持**：
   - POE2 专业术语优先采用原生繁中，例如“效能 II”/“效率 II”、“决斗法杖”/“單挑法杖”、“主宰”/“統御”；无原生对应时可使用显式人工繁中，缺译或有歧义时保留英文并生成报告；
3. **装备词缀与占位符智能匹配**：
   - 支持动态数值变量、多行词缀拼接、稀有（黄装）名字前缀+后缀智能组合；
4. **全站双语检索联想**：
   - 在任意搜索框内输入中文关键词，自动联想官方英文装备并带类别标签（装备、技能宝石、天赋、机制）；
5. **专有机制悬停说明卡片**：
   - 支持 415+ 条专属暗金词缀、神龛效果与游戏机制的虚线下划线悬停浮窗（Glossary Tooltip）；
6. **官方 POEDB 快捷直达**：
   - 自动生成对应中/英/繁语言版本的 `poedb.tw` / `poe2db.tw` 词条直达链接。

---

## 📂 项目工程架构

```text
ninja-poe2/
├── content.js                   # 核心 Content Script 运行时（DOM 扫描、渲染防护、搜索拦截）
├── background.js                # Service Worker 脚本
├── popup.html / popup.js / .css # 扩展弹出窗界面（语言切换控制）
├── manifest.json                # 扩展规范配置清单 (Manifest V3)
│
├── lib/
│   └── translation-core.js      # 纯粹的核心翻译与算法引擎（无硬编码，由数据驱动）
│
├── data/
│   ├── poe1.json                # POE1 运行时词典
│   ├── poe2.json                # POE2 运行时词典，繁中来源独立
│   ├── sources/native-translations/ # 锁定的原生快照与审核归档
│   ├── reports/native-traditional.json # 覆盖、来源、冲突及缺译报告
│   └── overrides/               # 人工修订；繁中作为原生词库的补充
│       ├── terms.json           # 人工优先词条覆盖表
│       └── glossary.json        # 机制悬停说明浮窗库 (415+ 条)
│
├── tools/
│   ├── build-all.mjs            # 核心自动化编译、简繁生成与发布流水线
│   ├── native-translations/     # 原生繁中采集、校验、审核与合并
│   ├── s2t.mjs                  # 字形转换，仅用于繁中界面标签
│   ├── validate-extension.mjs   # 扩展静态合规检查工具
│   └── upstream-builder/        # 自主研发的官方客户端解包与数据提取工具链 (Python)
│       ├── config.json          # 本地游戏客户端安装路径配置
│       ├── build.py             # 解包入口脚本
│       └── poe2dict/            # Dat64 解密、Bundle2 解包、CSD 词缀模板化引擎
│
├── test/
│   ├── content-translation.test.mjs # 翻译与集成测试
│   └── native-traditional*.test.mjs # 原生繁中对齐与审核测试
│
└── dist/
    └── POE-Ninja-three-language-v0.2.14/ # 本地扩展产物目录 (直接载入浏览器)
```

---

## 🛠️ 维护与构建命令

本项目已将全流程封装为简洁的 npm 脚本：

### 1. 从本地客户端解包数据 (自主更新)
当游戏发布新赛季或补丁后，运行此命令从本地客户端重新解包：
```powershell
npm run extract:upstream
```
> 默认从 `tools/upstream-builder/config.json` 指定的客户端路径解包，输出至 `tools/upstream-builder/dictionary/`。

### 2. 更新繁中与编译词典
繁中更新采用“采集候选 → 审核差异 → 按报告哈希接受 → 构建”的流程，完整维护说明位于项目源码的 `tools/native-translations/README.md`。日常构建读取锁定快照，不需要游戏客户端：
```powershell
npm run build:dictionary
```

报告位于 `data/reports/native-traditional.json`。名称和机制说明的缺译、冲突分别记录，条数含跨分区重复，不代表独立术语数。客户端如有价格标注等修改，应使用干净资源；已识别的价格污染会阻止候选被接受。

需要运行完整流程、同步 `dist/` 并生成本地 ZIP 时使用：
```powershell
npm run build:dict
```

### 3. 运行全量自动化测试
运行覆盖双语搜索、词缀模板、名称组合、DOM 保护和原生繁中更新的测试套件：
```powershell
npm test
```

### 4. 静态合规校验
```powershell
npm run validate
```

---

## 🚀 安装与使用指南 (Microsoft Edge / Chrome)

1. 打开浏览器扩展管理页面：
   - Edge: `edge://extensions/`
   - Chrome: `chrome://extensions/`
2. 打开右上角或左下角的 **「开发人员模式」**；
3. 点击 **「加载已解压的扩展程序」** (Load unpacked)；
4. 选择本项目中的发布目录：
   ```text
   <项目根目录>/dist/POE-Ninja-three-language-v0.2.14
   ```
5. 打开 [https://poe.ninja/](https://poe.ninja/)，点击浏览器右上角的扩展图标即可自由切换 **English / 简体中文 / 繁體中文**。
