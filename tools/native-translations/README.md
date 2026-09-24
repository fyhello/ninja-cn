# 原生繁中词典维护

专业内容来自国际服客户端的 Traditional Chinese 表及 CSD 语言段。简中继续使用现有上游词库。生成时以表名、资源 ID、字段和元素编号关联来源，同名冲突按实体类别筛选；缺少可靠繁中或仍有歧义时保留英文。

采集器和 DAT/CSD 解析器改编自 `pob-cn-clean-20260903` 的 `cn/pipeline/collect-game-translations.mjs`、`cn/pipeline/lib/game-text.mjs`。原许可保存在本目录的 `LICENSE`，schema 及其许可位于 `schemas/`。提取器为 `schemas/game-text-tools.json` 锁定的 zao/ooz v0.2.4；从其中的上游发布地址获取 `bun_extract_file.exe`、`libbun.dll`、`libooz.dll`，放在同一目录，采集前自动核对三个文件的 SHA-256。

## 日常构建

```powershell
npm run build:dictionary
npm test
npm run validate
```

日常构建只读 `data/sources/native-translations/lock.json` 指向的快照，不需要安装游戏。生成普通及压缩词库，并生成 `data/reports/native-traditional.json`。报告按分区列出原生覆盖、已有人工译文、界面标签、缺译、冲突、拒绝模板和逐条来源；分区记录有重复，不能将条数当作独立术语数。

`npm run build:dict` 沿用完整构建流程，还会重新生成市集引擎、同步本地发布目录并打包。仅更新词典或排查翻译时使用 `build:dictionary`。

## 更新客户端数据

以下变量填写实际绝对路径；国际服可以传入 `Content.ggpk` 文件或游戏目录。候选目录必须不存在。采集只读取游戏，不修改游戏文件。

```powershell
npm run extract:native -- --cn "$cnClient" --intl "$intlClient" --extractor "$extractorPath" --output "$candidateDir"
npm run translations:review -- --candidate "$candidateDir" --output "$reviewPath"
```

检查审核报告中的 `sourceChanges`、`changes`、`descriptionChanges`、`regressions`、`suspiciousNames` 及完整覆盖报告。`coverage.descriptions` 单独记录机制说明的来源、缺译和冲突。客户端可能被价格标注等工具修改；提取器哈希正确只证明工具版本正确，不能证明游戏资源没有被改动。已识别的价格标注和已有原生译文丢失会阻止接受；其他不可信变化也应人工拒绝，不应通过删除标注来冒充干净来源。

审核没有问题后，使用审核命令打印的完整报告哈希：

```powershell
npm run translations:accept -- --candidate "$candidateDir" --review "$reviewPath" --ack-sha256 "$reviewSha256"
npm run build:dictionary
npm test
npm run validate
```

接受阶段重新计算报告，检查候选、现有词库、来源锁、采集器、解析器、schema、人工覆盖和生成器是否变化。任何变化都必须重新审核。成功后保存不可变快照和压缩审核报告，最后替换来源锁；不直接修改运行词库。采集失败或接受失败不会更新正式来源锁。修订审核报告时使用新文件路径。

## 复用已提取资源

原始资源目录可以来自先前成功的采集；必须提供对应快照，每个文件都要匹配其中记录的 SHA-256。修改解析代码或 schema 后应重新解析并重新审核，不能继续接受旧采集器的候选。

```powershell
npm run extract:native -- --extracted --cn "$cnRaw" --intl "$intlRaw" --provenance "$previousSnapshot" --output "$candidateDir"
```

首批数据使用参考项目已锁定的干净资源，并已通过本项目采集器重新解析。当前来源锁与审核归档保留此链路。本机国际服曾检测到价格标注，该次直接提取的候选未被接受。

## 人工维护与边界

- `data/overrides/terms.json` 中显式繁中作为人工补充，原生译文优先；原生冲突不能被旧覆盖静默掩盖。报告将人工来源单独标记，不声称它们全部是客户端原文。
- 只按具体英文资源键修订人工条目，记录核验依据；不要把“主宰”这样的中文片段做全局替换。
- 词缀对齐检查条件、参数编号与格式、数值变换。页面没有属性 ID 或 CSD 语境时，只接纳候选译文一致的通用模板；局部、全局或技能语境冲突保留英文并记录。
- 繁中名称和机制说明分别取值；缺少繁中说明时不展示简中说明。简中说明继续保留。
- 新发现的专业名称差异应加入 `test/native-traditional.test.mjs`，同时验证简中、繁中、英文和搜索结果。
- 测试通过表示已覆盖的行为符合预期，不代表所有历史条目、怪物名称或 PoB 文案都具有繁中译文。完整未解决项以生成报告为准。
