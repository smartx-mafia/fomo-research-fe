# Golang 敏感词过滤方案调研（中 / 英 / 日 / 韩）

> 调研日期：2026-09-29
> 调研目标：为 Go 服务选一个敏感词检测 / 替换方案，覆盖中文、英文、日文、韩文及其混排，比较算法、功能、抗绕过能力、并发安全、维护状态和性能。
> 结论先行：**推荐 [kirklin/go-swd](https://github.com/kirklin/go-swd)（Apache-2.0）做匹配核心。**在所有被测库里，它是唯一同时满足以下四点的：扁平数组 Aho-Corasick 实现、查询无锁且可原子热更新（`-race` 实测干净）、单线程性能处于第一梯队、带分类 / 风险等级 / 白名单。它的缺口是**繁简、拼音、leet、形近字、日文假名、韩文字母**都不处理，需要在它前面自己加一层归一化流水线（第 10 节给出了顺序和已跑通的原型）。英文如果要做 leet 识别，可以旁挂 [TwiN/go-away](https://github.com/TwiN/go-away)（MIT，维护活跃）当补充检测器，但它不支持 UTF-8，而且它的包级默认实例有数据竞争。用户点名的另外两个库目前**不建议上生产**：LuYongwang/go-sensitive-word 的 DFA 模式有数据竞争，并且仓库没有 LICENSE；kaidong77/sensitive-lite 对无汉字文本（英文、韩文）的耗时是 O(n²)，替换位置也会错位。两者都有实测复现。
> Go 生态里**没有找到专门做日文或韩文敏感词的库**，只能用「通用 AC + `golang.org/x/text` 的 NFKC + 自写假名 / 字母规则」拼装。

---

## 0. 关键结论速查

| 问题 | 结论 |
|---|---|
| 首选 | **go-swd**：AC 自动机、`atomic.Pointer` 整体替换实现热更新、10 个一级分类 + 28 个二级标签 + 风险等级、白名单、可选的「容忍分隔符」和「折叠重复字」匹配 |
| 纯英文 leet 识别 | go-away（2026-08 仍有提交，但近几个月的提交主要是依赖升级）。moderation 的抗绕过更强，但作者已声明不再维护，且存在字节截断 bug（实测把中文「学孵季孫」判成不当内容） |
| 只要一个 Go 版 AC 算法库 | BobuSumisu/aho-corasick（2025-06 仍有合并，可序列化）或 petar-dambovaliev/aho-corasick（可选 DFA 模式和整词匹配）。**cloudflare/ahocorasick 用于中文词库时内存很大**：5000 个中文词约 329MB，下文有实测 |
| 用户点名的 LuYongwang | 功能表很全，但 ① DFA 模式有读写竞争（`-race` 报 DATA RACE）；② `Replace` 同一个词只替换第一次出现；③ AC 模式删除词后仍有残留命中；④ README 里宣传的繁简 / 零宽 / 同形字归一化，公开 API 用不到；⑤ **仓库没有 LICENSE** |
| 用户点名的 sensitive-lite | 反清洗规则最多（繁体 30 字、同音 40+ 组、西里尔字母、数学字母），但 ① 对无汉字文本耗时 O(n²)：8000 字的韩文要 0.5s；② 日文假名夹在汉字之间会被剥掉，造成漏检；③ 启用重复字压缩后替换位置错位；④ 没有热更新 API；⑤ README 写「AC 失效链接」，但公开 API 实际走的是 O(N×L) 的暴力滑窗 |
| 拼音 / 同音字 / 韩文初声缩写（ㅅㅂ）/ 日文读音 | **所有被测库都不支持**（sensitive-lite 只有 40 多组同音映射）。只能靠在词库里穷举变体，或者上语义模型 |
| 英文 Scunthorpe 问题（class⊃ass） | 纯子串匹配的库**全部误杀**。只有 go-away 的内置误报表和 moderation 的负权词库能挡住，petar 的 `MatchOnlyWholeWords` 能挡住但同时丢掉词形变化 |
| 日 / 韩 | 所有库都能按 rune（或按 UTF-8 字节）正确匹配多字节字符，但**都不处理**半角片假名、平假名与片假名互转、韩文字母组合或分解。`x/text` 的 NFKC 能处理半角片假名和兼容字母，平假名与片假名互转要自己写 |
| 开源词库 | 中文：go-swd 自带 15,959 行（Apache-2.0，来源说明不完整）。英 / 日 / 韩：LDNOOBW（CC-BY-4.0，需要署名），分别是 403 / 180 / 72 行 |

---

## 1. 调研范围与方法

- **只用一手来源**：仓库源码、README、go.mod、tag、commit 历史、LICENSE。星数来自 GitHub 页面（2026-09-29 抓取；API 限流，所以没拿到 issue 明细）。
- 所有仓库都用 `git clone --depth 50` 拉到 scratchpad，并**固定到下表的 commit**。文中链接都是 `blob/<commit>/path#Lxx` 形式的永久链接。
- 行为结论分两类：「源码」表示读代码得出；「实测」表示在 scratchpad 写了 Go 测试并实际跑过（第 12 节附命令）。README 里的说法如果没有核实，会标注「仅 README 声称，未核实」。

| 仓库 | 固定 commit | 最近提交 | Stars | License | Go 要求 | 依赖 |
|---|---|---|---|---|---|---|
| [kirklin/go-swd](https://github.com/kirklin/go-swd) | `480ac61` | 2026-09-05（tag v0.3.0） | 105 | Apache-2.0 | 1.23 | 无 |
| [LuYongwang/go-sensitive-word](https://github.com/LuYongwang/go-sensitive-word) | `0337d64` | 2025-11-01（共 5 个提交，tag v1.1.0） | 19 | **无 LICENSE 文件** | 1.20 | 无 |
| [kaidong77/sensitive-lite](https://github.com/kaidong77/sensitive-lite) | `4a9c005` | 2026-08-12（共 5 个提交，**没有 git tag**） | 2 | MIT | 1.21 | 无 |
| [importcjj/sensitive](https://github.com/importcjj/sensitive) | `42d1c50` | 2020-01-06 | 700 | MIT | 无 go.mod | 无 |
| [cloudflare/ahocorasick](https://github.com/cloudflare/ahocorasick) | `054963e` | 2024-09（最后一次代码变更 2021-04） | 728 | BSD-3-Clause | 无 go.mod | 无 |
| [petar-dambovaliev/aho-corasick](https://github.com/petar-dambovaliev/aho-corasick) | `463d218` | 2025-04（最后一次代码变更 2024-04） | 94 | MIT | 1.15 | 无 |
| [BobuSumisu/aho-corasick](https://github.com/BobuSumisu/aho-corasick) | `b4b5728` | 2025-06-11（tag v1.0.3） | 74 | MIT | 1.23 | 无 |
| [TwiN/go-away](https://github.com/TwiN/go-away)（英文） | `da82b89` | 2026-08-14（tag v1.8.1） | 296 | MIT | 1.25 | golang.org/x/text |
| [finnbear/moderation](https://github.com/finnbear/moderation)（英文） | `663b12f` | 2022-02-02（README 声明不再维护） | 14 | Unlicense（公有领域） | 1.15 | x/text、x/exp |
| [LDNOOBW 词表](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words) | `5faf2ba` | 2020-07-13 | 3,454 | CC-BY-4.0 | — | — |

没有纳入详细对比的：[anknown/ahocorasick](https://github.com/anknown/ahocorasick)（双数组 Trie，292 星）最后提交在 2019-09，没有 go.mod，还依赖作者自己的 `anknown/darts`，属于停更的老库，性能结论可以参考 petar README 里的对比（仅 README 声称，未核实）。[pcpratheesh/go-censorword](https://github.com/pcpratheesh/go-censorword) 只有 2 个提交、最后提交在 2023-03。[simonklee/profanity](https://github.com/simonklee/profanity) 最后提交在 2015 年且没有 LICENSE。这两个英文库活跃度都太低。

---

## 2. 对比总表

| | go-swd | LuYongwang | sensitive-lite | importcjj | 通用 AC（cloudflare / petar / Bobu） | go-away | moderation |
|---|---|---|---|---|---|---|---|
| 核心结构 | 扁平数组 AC（BFS 编号，高扇出节点用稠密行，其余用有序边表）+ 2-gram 位图预过滤 | 可选 DFA（map Trie 暴力回溯）或 AC（map Trie + fail 指针） | 节点内联 4 个子节点的 Trie + ASCII 直索引数组；公开 API 走暴力滑窗 | `map[rune]*Node` Trie，暴力回溯 | cloudflare：每节点两张 `[256]*node` 表；petar：移植自 Rust `aho-corasick`，可选 NFA 或 DFA；Bobu：`[][256]uint32` 转移表 | 词表循环调用 `strings.Contains` | 基数树 + 多状态并行推进 |
| 匹配复杂度 | O(n + 命中数) | DFA：O(n×L)；AC：O(n + 命中数) | O(n×L)，归一化阶段对无汉字文本是 O(n²) | O(n×L) | O(n + 命中数)，按字节 | O(词数×n) | O(n×活跃状态数) |
| 检测 / 全部查找 / 替换 / 删除 | ✅ / ✅（带位置、标签、风险）/ ✅（可按策略替换）/ — | ✅ / ✅（按词去重）/ ⚠️ 只替换首次出现 / ✅ | ✅ / ✅ / ⚠️ 位置有 bug / — | ✅ / ✅ / ✅ / ✅ | 只提供命中结果（cloudflare 不返回位置） | ✅ / 只返回第一个 / ✅ / — | ✅ / 只返回分类 / 实验性 / — |
| 内置词库 | 15,959 行中文，28 个标签，**0 个纯英文词** | 8 个文件共 2,915 行 | 不内置 | 13,993 行 | 无 | 83 个脏词 + 70 个误报词 + 3 个强制命中词 | 11,145 条，其中 10,962 条是负权误报词 |
| 词库加载方式 | 内嵌文件、map、运行时增删 | 内嵌、文件路径、回调（DB 或 Redis）、导出 | 仅 `New(words)` | 文件、**URL**、增删 | 构建时一次性传入（Bobu 还能从文件加载并序列化） | 自定义词表 | 编译进二进制 |
| 分类 / 等级 | ✅ 位掩码分类 + 4 档风险 + 置信度 | 只有「来源」标签 | ❌ | ❌ | 模式序号 | ❌ | ✅ 4 类 × 3 档 |
| 白名单 | ✅（命中落在允许短语内就抑制） | ❌ | ❌ | ❌ | ❌ | ✅ 误报表 | ✅ 负权词 |
| 并发与热更新 | 查询无锁；更新时重建新自动机，用 `atomic.Pointer` 整体替换；**`-race` 实测干净** | DFA **有竞争**；AC 用复制后替换（每次写都深拷贝整棵树），更新**异步生效** | 构建完成后只读，**没有更新 API** | **有竞争**（无锁） | 构建后只读（cloudflare 的 `Match` 不是线程安全的） | 自定义实例只读；**包级默认实例有竞争** | 全局只读树 |

---

## 3. 各方案详解

### 3.1 kirklin/go-swd（推荐）

- **算法**（源码）：[internal/automaton/automaton.go#L1-L16] 的包注释写明了实现方式，本文核实了对应代码：BFS 编号的扁平节点数组，root 和扇出不少于 16 的节点用稠密行（[#L39]），其余节点用有序边表；每个节点带 fail 链和 out 链；字符先经过一张 64K 的 BMP 表完成归一化和编码，所以扫描时不需要额外做归一化，返回的位置也直接对应原文。2-gram 位图预过滤能用一次位运算跳过不可能开头的位置（[#L533-L546]）。
- **API**：`Detect / Match / MatchAll / Matches(iter.Seq) / Check / Replace / ReplaceWithStrategy`，每种都有带分类过滤的 `*In` 版本（[engine.go#L339-L440]）。`Match` 结构同时给出 rune 下标和字节偏移（[engine.go#L29-L39]）。
- **词库**：`//go:embed dict/*.txt`（[dict.go#L13]），**文件名就是二级标签**。实际统计 15,959 行，去重后 15,949 条。README 开头说「约四万词」（[README#L11]），后文又说 15,932 词（[README#L169]），**前后不一致，以文件实际行数为准**。其中纯英文词为 0 条（实测统计）。README 给出的 COLD 数据集精确率和召回率（[README#L180-L186]）属于仅 README 声称，未核实。
- **热更新**（源码 + 实测）：`Engine` 内部持有 `atomic.Pointer[compiled]`（[engine.go#L66-L82]），每次写操作都在锁内全量 `rebuild` 后再 `Store`（[engine.go#L209-L235]、[#L456-L509]），查询时只 `Load`。批量写应该用 `AddWords`，否则每加一个词都重建一次。`-race` 压测（4 个读 goroutine 加 200 次写）通过。
- **白名单**：允许短语单独建一个自动机，命中区间落在允许短语内部就抑制（[engine.go#L263-L301]）。实测：允许「傻逼兽」后，`Detect("傻逼兽")=false`，`Detect("傻逼")=true`。
- **抗干扰**（源码）：1:1 的字符折叠 `Fold`（[normalize.go#L44-L80]）处理大小写、全角 `FF01–FF5E`、各种数字写法（含「一 壹 贰」）、带圈和数学字母、带变音符的拉丁字母。零宽、Cf 类格式字符和组合附加符号**始终忽略**（[normalize.go#L205-L228]）。空格、标点、符号和 Emoji 属于「分隔符」，**只有**开启 `WithMaxGap(n)` 后才会被跳过（[options.go#L58-L72]、[automaton.go#L603-L605]）；`WithCollapseRepeats` 会折叠重复字（[automaton.go#L600-L602]）。**不支持**繁简、拼音、leet、西里尔字母同形字、半角片假名、假名互转和韩文字母。
- **风险**：`foldCJK` 会把「一…九」这类中文数字折成阿拉伯数字（[normalize.go#L82-L106]）。词库和文本两侧的处理一致，所以不会因此漏检，但含中文数字的词会命中对应的阿拉伯数字写法。Gap 模式会关掉预过滤，速度约慢 1.5 倍（实测），并且会跨标点误拼接（第 4 节 ZF 行）。

### 3.2 LuYongwang/go-sensitive-word（用户指定；不建议上生产）

- **算法**（源码）：`FilterDfa` 是普通的 `map[rune]*dfaNode` Trie 加回溯扫描（[dfa.go#L5-L43]、[#L100-L136]），不是真正的 DFA；`FilterAC` 是 map Trie 加 fail 指针（[ac.go#L11-L15]、[#L126-L149]）。
- **写路径是异步的**（源码 + 实测）：`AddWords` 先写入 store，再把词投到容量 8192 的 channel（[memory.go#L28-L43]、[#L182-L205]），由后台 goroutine 应用。所以 README 的示例里需要 `time.Sleep(100ms)`（[README#L105]）。实测：`AddWords` 刚返回就调用 `IsSensitive`，结果是 `false`。
- **并发安全与 README 不符**：README 写「全链路并发安全」（[README#L13]），但 DFA 模式的 `Listen` 直接在后台 goroutine 里改 map（[dfa.go#L87-L98]），读路径也不加锁。**`-race` 实测报 4 处 DATA RACE**，写在 [dfa.go#L38]，读在 [dfa.go#L176]；在 Go 里这种情况可能直接触发 `fatal error: concurrent map read and map write`。AC 模式用的是复制后替换（[ac.go#L39-L66]），`-race` 实测干净，但**每次写都深拷贝整棵 Trie**（[ac.go#L68-L79]），而且只能靠 100ms 窗口批量合并（[ac.go#L151-L193]）。
- **已验证的正确性缺陷**（实测）：
  1. `Replace("傻逼和傻逼", '*')` 的结果是 `"**和傻逼"`，DFA 和 AC 两种模式都一样。原因是 `FindAllRanges` 按词文本去重（[dfa.go#L202-L217]、[ac.go#L364-L392]），第二次出现的同一个词没被替换。
  2. AC 模式删除 `傻逼` 后，`FindAll("大傻逼")` 仍然返回 `[大傻逼 傻逼]`。原因是 fail 链继承过来的 output 被复制进了新树，而删除操作只清理词本身所在节点（[ac.go#L145]、[#L212-L228]）。
- **归一化是摆设**：`NormalizerConfig` 定义了繁简、零宽、同形字、数字等选项（[normalize.go#L8-L58]），但 `NewFilter` 把 `DefaultNormalizer()`（只有小写和全角）写死了（[manager.go#L49-L51]），`Manager.normalizer` 又是未导出字段，**公开 API 没法启用 `StrictNormalizer`**。另外，`LoadDictEmbed/LoadDictPath` 直接调用 store，只做 `ToLower`（[memory.go#L94]），不经过 Manager 的归一化。
- 额外能力：邮箱、URL、数字的正则检测（[tool.go#L5-L40]），每次调用都会重新 `regexp.MustCompile`。
- **License**：`main` 分支没有 LICENSE 文件（raw 路径返回 404）。README 自述参考了 [zmexing/go-sensitive-word](https://github.com/zmexing/go-sensitive-word)（GitHub 页面同样没有识别出 License）和 [konsheng/Sensitive-lexicon](https://github.com/konsheng/Sensitive-lexicon)（MIT）（[README#L258-L265]）。**没有许可证就等于默认保留所有权利，不能合规引入**。

### 3.3 kaidong77/sensitive-lite（用户指定；不建议上生产）

- **算法**（源码）：Trie 节点内联 4 个子节点，另有一个懒分配的 `[128]*dfaNode` ASCII 直索引数组（[dfa.go#L39-L70]）。公开的 `Contains/FindAll` 走 `MatchFirst/MatchAll`，也就是**逐个起点暴力滑窗，复杂度 O(N×L)**（[dfa.go#L308-L330]、[#L356-L391]）。`BuildFailureLinks/MatchAC` 只在 `internal/core` 里定义（[dfa_opt.go#L73]、[#L152]），生产代码里没有任何调用（grep 结果只出现在 `benchmark_test.go`）。所以 README 写的「启用反清洗 + AC 失效链接」（[README#L196]）不代表用户能调用到的路径。
- **不内置词库，也没有增删 API**：只能 `New(words)` 一次性构建（[sensitive.go#L70-L165]），想热更新就得自己新建一个 `Filter` 再原子替换。
- **反清洗流水线**（源码）：剥离组合附加符号 → 零宽和 Cf 字符 → 空白 → Emoji → leet（默认关闭）→ 标点 → 「汉字间夹杂字符」剥离 → 形近、同音、繁体、数学字母映射 → 半角 → 小写 → 汉字连续重复压缩（[normalizer.go#L134-L230]）。映射表里有 30 个繁体到简体的字（[confusable.go#L501-L532]），这个量远不够做繁简转换；同音映射 40 多组（[#L599-L660]）；西里尔和希腊字母映射（[#L319-L396]）。leet 规则里 `'1'→'l'`（[leet.go#L41]），所以 `sh1t` 开了 leet 也识别不出来（实测）。
- **已验证的缺陷**（实测）：
  1. **对无汉字文本耗时 O(n²)**：`IsInCJKInterstitialRun` 会对每个非汉字字符向前、向后扫描，直到找到最近的汉字（[normalizer.go#L564-L620]），而 `IsCJK` 只认 `U+4E00–9FFF / U+3400–4DBF`（[#L516-L525]）。实测 `Contains` 在 1000、2000、4000、8000 字的英文上分别耗时 5.4 / 21.2 / 84.7 / **338.8ms**，韩文分别是 8.0 / 31.9 / 158.0 / **499.1ms**，中文则保持线性（0.1–0.8ms）。**可以被当成 DoS 向量**。
  2. **日文假名被当成「夹杂字符」剥掉**：`死ねと言われた` 中的「ねと」夹在「死」和「言」之间，被剥成「死言…」，于是漏检 `死ね`（第 4 节 J5b 行）。
  3. **重复字压缩后位置错位**：`posMap` 只做截断，没有同步压缩（[normalizer.go#L216-L223]，代码注释自己也承认「位置映射可能不精确」）。实测 `Replace("好好好的傻逼")` 得到 `"好好**傻逼"`，打码打在了错误的位置。
  4. `WithFuzzy(false)` 模式下 `exactFindAll` 按词去重（[sensitive.go#L306-L312]），所以 `Replace("傻逼和傻逼")` 的结果是 `"**和傻逼"`。
- 可观测性做得不少：降级 / 恢复、按内存阈值降级、trace 与告警回调、命中计数（[sensitive.go#L478-L588]）。README 里的性能表（例如并发 `Contains` 434ns）属于仅 README 声称，未核实，而且它的测试文本长度没有公开。

### 3.4 importcjj/sensitive

- 最经典的 Go 中文敏感词库（700 星），但已**停更 6 年多**。实现是 `map[rune]*Node` Trie 加回溯（[trie_tree.go#L24-L46]），**没有任何锁**，`-race` 实测报 DATA RACE。另有一个 `Aho-Corasick` 分支，最后提交在 2019-06-11，没有合入主干。
- 「噪音」正则默认是 `[\|\s&%$@*]+`（[filter.go#L19-L24]），**只在 `FindIn/Validate` 里生效**（[#L93-L112]）。实测：`FindIn("傻*逼")=true`，但同一段文本的 `Replace` 保持原样，`FindAll` 返回空，**检测和替换的结果不一致**。
- 支持 `LoadNetWordDict(url)`（[filter.go#L42-L54]）。自带 13,993 行 `dict/dict.txt`，来源没有说明。

### 3.5 通用 Aho-Corasick 库（只提供算法，不含任何归一化）

- **cloudflare/ahocorasick**：每个节点有 `child [256]*node` 和 `fails [256]*node` 两张表（[ahocorasick.go#L19-L50]），查询很快，但**内存和节点数成正比，每个节点约 4KB**。中文每个字占 3 字节，节点数暴增，5000 个中文词实测保留堆 **329MB**。`Match` 返回的是词典下标而不是位置，而且注释写明它不是线程安全的（[#L220-L235]），并发场景必须用 `MatchThreadSafe`（[#L280]）。
- **petar-dambovaliev/aho-corasick**：移植自 Rust 的 BurntSushi/aho-corasick，支持 `AsciiCaseInsensitive`、`LeftMostLongest/First` 和 `DFA`（[ahocorasick.go#L275-L281]），带 Replacer。`MatchOnlyWholeWords`（[#L37-L44]）对单个字节做 `unicode.IsLetter(rune(b))` 判断，**只对 ASCII 可靠**。README 的「比 cloudflare 快 20 倍」（[README#L4]）属于仅 README 声称；本文实测在英文上反而比 cloudflare 慢（第 8 节），但它的内存只有 cloudflare 的 1/5。
- **BobuSumisu/aho-corasick**：`failTrans [][256]uint32` 预计算转移表（[trie.go#L13-L21]），支持从文件加载，并能用 gzip 序列化和反序列化（[stream.go#L11-L24]）。2025 年还有 trufflesecurity 等下游提交修复。实测综合速度最好，内存是 cloudflare 的 1/6。
- 三者共同点：按字节匹配，UTF-8 多字节字符能正确匹配（UTF-8 自同步），但**没有任何抗绕过能力**，cloudflare 和 Bobu 甚至区分大小写。

### 3.6 英文专用：TwiN/go-away 与 finnbear/moderation

- **go-away**（源码）：先 `sanitize`：小写 → 按字符表把 leet 映射成字母、把特殊符号映射成空格 → 在需要时去掉变音符 → 去掉所有空格（[goaway.go#L236-L273]）；然后先查 3 个强制命中词，再删除 70 个误报词，最后对 83 个脏词逐个 `strings.Contains`（[#L130-L162]）。`WithExactWord` 按空格切词做整词匹配（[#L114-L122]）。README 明确写了「does not support UTF-8」（[README#L94]）。
  - 缺陷（实测）：① 包级 `IsProfane` 懒初始化 `defaultProfanityDetector` 时没有同步（[goaway.go#L338-L343]），**8 个 goroutine 首次并发调用，`-race` 报 5 处竞争**，应该自己 `NewProfanityDetector()` 并在初始化阶段建好；② 去变音符用的是 NFD 加删除 Mn（[#L275-L287]），会把日文浊点当成变音符删掉（バ→ハ），日文词因此全部漏检（J1 行）；③ `WithExactWord` 下 `"you ASS!"` 不命中，因为 `!` 先被当 leet 映射成了 `i`，变成 `assi`（实测）；④ 删除空格后会跨词拼接，用自定义词表时 `push it` 会误报成 `shit`；内置误报表里正好有 `pushit`（[falsepositives.go#L58]）。
- **moderation**（源码）：基数树加多状态推进，同时处理 leet（[replacements.go#L5-L23]）、分隔符（`* ~ - _ . ,` 和空白）、重复字母（[moderation.go#L153]），短词（不超过 3–4 个字母）必须出现在词首（[#L180]），另有一万多条负权误报词做白名单。**README 已声明不再维护**（[README#L7]），作者转去维护 Rust 版 rustrict。
  - **字节截断 bug**（源码 + 实测）：`textByte := byte(textRune)`（[moderation.go#L97]）把任意 rune 截成低 8 位，再按 ASCII 字母处理。全角 `ｆ`（U+FF46）因为低字节恰好是 `F` 而被「意外」识别；但中文「学孵季孫」（U+5B66/5B75/5B63/5B6B，低字节依次是 f/u/c/k）也会被判为 `Inappropriate`（CF 行）。西里尔字母 `с`（U+0441）的低字节是 `A`，大写分支先于 confusables 映射执行，于是被当成 `a`（E9 行漏检）。**中日韩混排场景不能用**。

---

## 4. 抗干扰能力专项对比

### 4.1 按源码逐项核对

| 能力 | go-swd | LuYongwang | sensitive-lite | importcjj | 通用 AC | go-away | moderation |
|---|---|---|---|---|---|---|---|
| 英文大小写 | ✅ Fold | ✅ 默认 | ✅ | ❌ | petar 可选（仅 ASCII） | ✅ | ✅ |
| 全角转半角 | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ⚠️ 由截断 bug 意外实现 |
| 繁转简 | ❌ | ⚠️ 有代码但公开 API 用不到 | ⚠️ 只有 30 字 | ❌ | ❌ | ❌ | ❌ |
| 拼音 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 插入符号或空格（傻*逼、f.u.c.k） | ✅ 需开 `WithMaxGap` | ❌ | ✅ 始终剥离 | ⚠️ 仅检测接口剥离 | ❌ | ✅ | ✅ |
| 零宽字符 | ✅ 始终忽略 | ⚠️ 有代码但用不到 | ✅ | ❌ | ❌ | ❌ | ⚠️ 丢弃后清空状态 |
| Emoji 插入 | ✅ 需开 Gap | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| 同音 / 形近字 | ❌ | ⚠️ 同形字表用不到 | ⚠️ 40 多组同音、200 多形近 | ❌ | ❌ | ❌ | ❌ |
| 重复字（国国家家、fuuuck） | ✅ 需开 Collapse | ❌ | ⚠️ 只压缩汉字，且位置有 bug | ❌ | ❌ | ❌ | ✅ |
| leet（sh1t、$hit、@ss） | ❌ | ❌ | ⚠️ 默认关闭，且 `1→l` | ❌ | ❌ | ✅ | ✅ |
| 西里尔字母同形字 | ❌ | ⚠️ 用不到 | ✅ | ❌ | ❌ | ❌ | ⚠️ 表里有，被截断 bug 抵消 |
| 数学字母（𝐟𝐮𝐜𝐤） | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| NFKC | ❌（自有 1:1 折叠） | ❌ | ❌（自有映射） | ❌ | ❌ | ⚠️ 仅 NFD 去变音 | ⚠️ 仅 NFD 去变音 |
| 英文整词边界 | ❌ | ❌ | ❌ | ❌ | petar 可选（仅 ASCII） | ✅ `WithExactWord` | ⚠️ 短词须在词首 |
| 半角片假名 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 平假名与片假名互转 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 韩文字母组合 / 初声 | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ NFD 后再 NFC 可复原组合形 | ❌ |

### 4.2 实测矩阵

所有支持自定义词库的库使用同一份词表：`傻逼 国家机密 fuck shit asshole ass cunt バカ 死ね 馬鹿 시발 병신`。「go-away 内置」和「moderation 内置」两列用的是它们自带的英文词库，**只有 E 开头的行有意义**，其余行的 ✅ 只是因为词库里没有这些词。✅ 表示结果正确，· 表示漏检，❌ 表示误杀。

| 用例 | 输入 | 期望 | go-swd 默认 | go-swd Gap+Collapse | LuYongwang（DFA 与 AC 结果相同） | lite 默认 | lite +leet | lite exact | importcjj | petar | cloudflare / Bobu | go-away 自定义词 | go-away 内置 | moderation 内置 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Z1 中文原词 | `你是傻逼吗` | 应命中 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| Z2 符号插入 | `傻*逼` | 应命中 | · | ✅ | · | ✅ | ✅ | · | ✅ | · | · | ✅ | · | · |
| Z3 空格插入 | `傻 逼` | 应命中 | · | ✅ | · | ✅ | ✅ | · | ✅ | · | · | ✅ | · | · |
| Z4 Emoji 插入 | `傻😊逼` | 应命中 | · | ✅ | · | ✅ | ✅ | · | · | · | · | · | · | · |
| Z5 零宽字符 | `傻​逼` | 应命中 | ✅ | ✅ | · | ✅ | ✅ | · | · | · | · | · | · | · |
| Z6 重复字 | `国国家家机机密密` | 应命中 | · | ✅ | · | ✅ | ✅ | · | · | · | · | · | · | · |
| Z7 繁体 | `國家機密` | 应命中 | · | · | · | ✅ | ✅ | · | · | · | · | · | · | · |
| Z8 拼音 | `shabi` | 应命中 | · | · | · | · | · | · | · | · | · | · | · | · |
| Z9 同音字 | `傻比` | 应命中 | · | · | · | · | · | · | · | · | · | · | · | · |
| ZF 跨标点拼接 | `他很傻，逼得我没办法` | 不应命中 | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| E1 大小写 | `FuCk you` | 应命中 | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | ✅ | · | ✅ | ✅ | ✅ |
| E2 全角英文 | `ｆｕｃｋ` | 应命中 | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · | · | · | · | ✅ |
| E3 点号插入 | `f.u.c.k` | 应命中 | · | ✅ | · | ✅ | ✅ | · | · | · | · | ✅ | ✅ | ✅ |
| E4 空格插入 | `f u c k` | 应命中 | · | ✅ | · | ✅ | ✅ | · | ✅ | · | · | ✅ | ✅ | ✅ |
| E5 重复字母 | `fuuuck` | 应命中 | · | ✅ | · | · | · | · | · | · | · | · | · | ✅ |
| E6 leet 1→i | `sh1t` | 应命中 | · | · | · | · | · | · | · | · | · | ✅ | ✅ | ✅ |
| E7 leet $→s | `$hit` | 应命中 | · | · | · | · | ✅ | · | · | · | · | ✅ | ✅ | ✅ |
| E8 leet @→a | `@sshole` | 应命中 | · | · | · | · | ✅ | · | · | · | · | ✅ | ✅ | ✅ |
| E9 西里尔 с | `fuсk` | 应命中 | · | · | · | ✅ | ✅ | · | · | · | · | · | · | · |
| EA 数学粗体 | `𝐟𝐮𝐜𝐤` | 应命中 | ✅ | ✅ | · | ✅ | ✅ | · | · | · | · | · | · | · |
| EB 词形变化 | `fucking shits` | 应命中 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| EF1 class/glass⊃ass | `a class of glass` | 不应命中 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| EF2 Scunthorpe⊃cunt | `Scunthorpe United` | 不应命中 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| EF3 跨词 push it | `push it now` | 不应命中 | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ |
| EF4 assassin⊃ass | `the assassin` | 不应命中 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| J1 日文原词 | `お前はバカだ` | 应命中 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · | · |
| J2 半角片假名 | `ﾊﾞｶ` | 应命中 | · | · | · | · | · | · | · | · | · | · | · | · |
| J3 平假名 | `ばか` | 应命中 | · | · | · | · | · | · | · | · | · | · | · | · |
| J4 空格插入 | `バ カ` | 应命中 | · | ✅ | · | ✅ | ✅ | · | ✅ | · | · | · | · | · |
| J5b 假名夹在汉字间 | `死ねと言われた` | 应命中 | ✅ | ✅ | ✅ | · | · | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| J6 读音 | `しね` | 应命中 | · | · | · | · | · | · | · | · | · | · | · | · |
| JF バカンス⊃バカ | `夏のバカンス` | 不应命中 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅（因浊点被删而误打误撞） | ✅ | ✅ |
| K1 韩文原词 | `이 시발 뭐야` | 应命中 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| K2 空格插入 | `시 발` | 应命中 | · | ✅ | · | ✅ | ✅ | · | ✅ | · | · | ✅ | · | · |
| K3 符号插入 | `시*발` | 应命中 | · | ✅ | · | ✅ | ✅ | · | ✅ | · | · | ✅ | · | · |
| K4 初声缩写 | `ㅅㅂ` | 应命中 | · | · | · | · | · | · | · | · | · | · | · | · |
| K5 拼写变体 | `씨발` | 应命中 | · | · | · | · | · | · | · | · | · | · | · | · |
| K6 NFD 分解形 | `시발` | 应命中 | · | · | · | · | · | · | · | · | · | ✅ | · | · |
| KF 시발점（始发点） | `시발점에서 출발` | 不应命中 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| CF 中文码点截断 | `学孵季孫` | 不应命中 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |

从矩阵能读出三点：① **抗绕过和误杀互为代价**：Gap 模式和 sensitive-lite 的剥离能抓到 `傻*逼`，但同时会误报 `他很傻，逼得…` 和 `push it`；② 没有任何库能处理拼音、同音、日文读音和韩文初声缩写；③ 子串类的误杀（class、バカンス、시발점）只能靠白名单或误报词表解决，**go-swd 的 `WithAllowWords` 是被测库里唯一可配置的白名单**（go-away 和 moderation 的白名单是英文专用的）。

---

## 5. 英文敏感词

- **没有库自带「英文词库 + 可配置白名单 + UTF-8」三者兼备**。go-swd 内置词库里纯英文词为 0；LuYongwang 的内置词库只有 86 个英文或拼音缩写，importcjj 有 456 个，都偏向中文语境（如 `Falun`、`QQ`）。
- **大小写**：go-swd、LuYongwang、sensitive-lite、go-away、moderation 都能处理，petar 需要打开 `AsciiCaseInsensitive`，cloudflare、Bobu 和 importcjj 不支持。
- **单词边界与 Scunthorpe 问题**：子串匹配的库在 `class`、`assassin`、`Scunthorpe` 上全部误杀。用 LDNOOBW 词表跑 benchmark 时，**连「干净」的英文段落也被命中了**：`documented` 里包含 `cum`（实测）。可用的办法有三种：
  1. 整词匹配：go-away 的 `WithExactWord`、petar 的 `MatchOnlyWholeWords`。代价是丢失词形变化和插空绕过的识别：实测 `fucking`、`asses`、`f u c k` 在整词模式下都不命中。
  2. 误报词白名单：go-away 自带 70 条，moderation 自带 10,962 条负权词（由 dwyl/english-words 等词典生成，见 [generator/Makefile#L6-L9]），go-swd 可以通过 `WithAllowWords` 自配。
  3. 两者组合：短词（不超过 4 个字母）要求整词，长词允许子串。这是 moderation 的做法（[moderation.go#L180]），可以在 go-swd 外层按 `Match.ByteStart/ByteEnd` 检查前后字符自己实现。
- **leet**：只有 go-away、moderation 和 sensitive-lite（需开 `WithLeetSpeak`，且 `1→l`）支持。leet 映射本身就会引入歧义（`1` 可以是 i 也可以是 l，`3` 可以是 e 也可以是 g），moderation 为此允许一个字符对应多个候选（[replacements.go#L5-L23]），go-away 和 sensitive-lite 都是单射。
- **插入符号、空格与重复字母**：go-swd 开 Gap+Collapse 可以识别 `f.u.c.k`、`f u c k`、`fuuuck`；go-away 删除所有空格，结果是 `push it` 被误报成 `shit`（用自定义词表时实测复现）。
- **词形变化**：子串匹配天然能覆盖 `fucking`、`shits` 这类形式；如果用整词匹配，就要在词库里展开复数和时态。moderation 的生成器用 go-pluralize 做了单复数展开（[generator/generate.go#L228]）。
- **Unicode 同形字**：全角和数学字母交给 go-swd 的 Fold 或 NFKC 处理即可；西里尔字母和希腊字母不在 NFKC 的范围内，需要按 Unicode confusables.txt 建一张映射表（moderation 的 [replacements.go#L123] 注释引用了这份数据，sensitive-lite 的 [confusable.go#L319-L396] 手工收录了一部分）。
- **英文词库来源**：[LDNOOBW/en](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/blob/5faf2ba42d7b1c0977169ec3611df25a3c08eb13/en)（403 行，CC-BY-4.0，Shutterstock 维护，**需要署名**）；go-away 的 [profanities.go](https://github.com/TwiN/go-away/blob/da82b895986b32bad1c7668242ca066f9e7dd464/profanities.go)（MIT）；moderation 的 [wordlists.csv](https://github.com/finnbear/moderation/blob/663b12f8baff0d8bc35efd0881a3055f6b2a40cc/wordlists.csv)（Unlicense，带 profane / offensive / sexual / mean 四个维度的分值）。

**中英混合场景**：用 go-swd 的一棵树同时装中文词和英文词，打开 `WithMaxGap(1)`。英文短词用「整词边界后置校验」和白名单来压误杀。如果要识别 leet，可以再旁挂一个 go-away 实例（用 `NewProfanityDetector()`，在初始化阶段建好），只对含 ASCII 字母的片段调用。

---

## 6. 日文敏感词

- **多字节处理**：所有 rune 级的库（go-swd、LuYongwang、sensitive-lite、importcjj）和按字节匹配的 AC 库都能正确匹配假名和汉字（J1 行全部 ✅）。例外是 go-away：NFD 去变音符会删掉浊点和半浊点（U+3099/309A 属于 Mn 类），バ 变成 ハ，因此漏检（J1 行）。
- **半角片假名 `ﾊﾞｶ`**：所有库都漏检。go-swd 和 LuYongwang 的全角转半角只覆盖 `FF01–FF5E`（[go-swd normalize.go#L54]、[LuYongwang normalize.go#L111-L123]）；sensitive-lite 的代码注释甚至写着「FF61–FF9F 本身已是半角形式，无需转换」（[normalizer.go#L350-L365]），这个理解是错的，这一段恰好需要转成全角。**NFKC 或 `width.Fold` 能把它还原成 `バカ`**（实测，第 12 节）。注意 `ﾊﾞ` 这 2 个 rune 会合成 1 个，**不再是 1:1 映射**，想还原原文位置就必须自己维护偏移映射。
- **平假名与片假名互转**：Go 标准扩展库里没有，NFKC 也不做。可以自己写一行规则：把 `U+3041–3096` 加 `0x60` 映射到片假名（实测可行）；也可以用 [ktnyt/go-moji](https://github.com/ktnyt/go-moji)（MIT，提供 `HG→KK` 字典，2019 年起停更）。
- **读音匹配（`死ね` 对应 `しね`）**：需要形态素分析。[ikawaha/kagome](https://github.com/ikawaha/kagome)（MIT，纯 Go，内嵌 IPADIC 和 UniDic，2026-09 仍在更新）可以取读音，但它是整句分析，开销远高于 AC，**只适合异步审核**。[gojp/kana](https://github.com/gojp/kana)（2020 年起停更）只做假名和罗马字互转，可以用来识别 `baka` 这类罗马字写法。
- **汉字与中文简繁的冲突**（实测 LuYongwang 内置的 `jianfan.T2S`）：`機密` 会变成 `机密`，`芸術` 变成 `芸术`（和中文的「艺术」仍然对不上），`後` 变成 `后`（在日文里「後」是「之后」，「后」是「皇后」）。**如果不区分语言就把繁转简套到整段文本上，日文会被改写**，造成误杀和漏检。
- **日文误杀**：`バカンス` 包含 `バカ`，所有子串库都会误杀，需要加进白名单。
- **日文词库来源**：[LDNOOBW/ja](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/blob/5faf2ba42d7b1c0977169ec3611df25a3c08eb13/ja)（180 行，CC-BY-4.0，偏成人向，含 `g スポット`、`s ＆ m` 这类带全角符号和空格的条目，入库前必须经过同一套归一化）。**没有找到其他 License 清晰、质量可用的开源日文 NG 词库**。GitHub 上搜「NGワード language:Go」「japanese profanity language:Go」都没有结果。

---

## 7. 韩文敏感词

- **多字节处理**：所有库都能匹配完整的韩文音节（K1 行 ✅）。韩文正文不含汉字，所以 **sensitive-lite 在韩文上会一直走 O(n²) 路径**（8000 字要 499ms）。
- **插入空格或符号**：go-swd Gap 模式、sensitive-lite、importcjj 和 go-away 能识别；其中 sensitive-lite 和 go-away 是因为无条件删除空格，所以也会带来跨词误报。
- **组合与分解（NFD 形）**：只有 go-away 能识别，因为它的 NFD→NFC 流水线顺带把字母重新合成了音节。其余库都要先对输入做 NFC 或 NFKC（`x/text/unicode/norm`，实测能把 `시발` 合成 `시발`）。
- **初声缩写（`ㅅㅂ`、`ㅈㄹ`、`ㅂㅅ`）**：没有任何库支持。**不能**把正文投影成初声串再去匹配：`사범`（师范）的初声也是 `ㅅㅂ`（实测），误杀会失控。正确的做法是**把缩写本身作为词条收进词库**（比如 `ㅅㅂ`），用原始的兼容字母匹配。另外要注意，NFKC 会把兼容字母 `ㅅ`（U+3145）改成连写字母 `ᄉ`（U+1109）（实测），所以**词库和文本必须走同一套归一化**，否则会因为这一步而漏检。
- **拼写变体（`씨발`、`시bal`、`c발`）**：只能在词库里穷举，或者再加一层「韩文音节转成罗马字或音素」的模糊匹配。Go 生态里没有现成的实现。
- **韩文误杀**：`시발점`（始发点）包含 `시발`，这是韩文过滤里最典型的误杀，必须加进白名单。
- **辅助库**：[suapapa/go_hangul](https://github.com/suapapa/go_hangul)（BSD 风格 License，61 星，2026-09 仍在更新）提供 `Split/Join/SplitCompat/CompatJamo/Lead`（[hangul.go#L28-L72]），但**最新 tag v1.2.2 要求 Go 1.27**。初声其实只需要一行算术 `leadCompat[(r-0xAC00)/588]`（实测），可以不引入这个依赖。GitHub 上搜「korean profanity / 욕설 language:Go」都没有结果，**Go 生态里没有专门的韩文脏话过滤库**。
- **韩文词库来源**：[LDNOOBW/ko](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/blob/5faf2ba42d7b1c0977169ec3611df25a3c08eb13/ko)（72 行，CC-BY-4.0）。数量太少，至少要补充常见的初声缩写和变体。

---

## 8. Benchmark（实际运行）

**环境**：Apple M1 Pro，8 核，macOS，`go1.26.5 darwin/arm64`，单 goroutine，`-benchtime=500ms`（日文和韩文组是 300ms），`-count=1`。各库都固定在第 1 节列出的 commit，通过 `replace` 指向本地 clone。
**词库**：中文取 go-swd 内置词库每 3 条抽 1 条，共 5,000 词；英文、日文、韩文分别使用 LDNOOBW 的 en（403）、ja（180）、ko（72）。
**文本**：中文 2,880B（960 字），英文 1,264B，日文 1,242B（414 字），韩文 1,200B（492 字），均为自己编写的正常段落重复拼接；「含命中」版本是在末尾插入 3–5 个词库词。注意：英文「净文本」里的 `documented` 命中了 LDNOOBW 的 `cum`，所以英文的 `Contains` 会提前返回，**英文组只看 FindAll 列**。
**说明**：go-away 和 moderation 在英文组里用的是自带词库。LuYongwang 的构建时间包含等待异步生效的轮询时间。importcjj 的 `Contains` 调用的是 `FindIn`，其中包含一次正则去噪。

### 8.1 单次调用耗时（越小越好）

| 库 | ZH Contains 净文本 | ZH FindAll 含命中 | EN FindAll 含命中 | JA Contains 净文本 | KO Contains 净文本 |
|---|---|---|---|---|---|
| go-swd | 7.1 µs | 7.7 µs（512B，1 次分配） | 13.1 µs | 2.7 µs | 2.4 µs |
| go-swd（MaxGap=1，Collapse） | 10.5 µs | 11.2 µs | 15.9 µs | 3.7 µs | 3.6 µs |
| LuYongwang-DFA | 47.2 µs | 56.9 µs | 44.6 µs | 18.6 µs | 23.8 µs |
| LuYongwang-AC | 45.0 µs | 61.7 µs | 45.5 µs | 18.0 µs | 18.3 µs |
| sensitive-lite（默认，fuzzy） | 103.6 µs | 97.7 µs | **8,820 µs** | 91.5 µs | **1,613 µs** |
| sensitive-lite（exact） | 17.4 µs | 21.3 µs | 12.1 µs | 6.5 µs | 6.7 µs |
| importcjj/sensitive | 32.5 µs | 16.9 µs | 21.5 µs | 19.5 µs | 23.1 µs |
| cloudflare/ahocorasick | 8.9 µs | 8.2 µs | 4.1 µs | 2.7 µs | 2.2 µs |
| petar/aho-corasick（DFA） | 11.4 µs | 12.5 µs | 6.0 µs | 5.1 µs | 4.8 µs |
| BobuSumisu/aho-corasick | 8.7 µs | 9.6 µs | 3.7 µs | 3.2 µs | 2.9 µs |
| go-away（自定义 403 词） | — | — | 42.2 µs | — | — |
| go-away（内置） | — | — | 83.4 µs | — | — |
| moderation（内置） | — | — | 27.4 µs（0 次分配） | — | — |

### 8.2 构建耗时与常驻堆（中文 5,000 词）

```
lib                                   build     heap(MB)
go-swd                                  9ms          4.9
go-swd(MaxGap=1,Collapse)               6ms          4.9
LuYongwang-DFA                        324ms          4.2   (含异步生效轮询)
LuYongwang-AC                         324ms          5.0   (含异步生效轮询)
sensitive-lite(fuzzy默认)                5ms          4.1
sensitive-lite(exact)                   3ms          4.5
importcjj/sensitive                     2ms          3.6
cloudflare/ahocorasick                218ms        329.2
petar/aho-corasick(DFA)               347ms         61.9
BobuSumisu/aho-corasick               445ms         56.4
```

### 8.3 sensitive-lite 的 O(n²) 复现

```
[lite fuzzy] runes≈ 1000  EN     5.38ms  KO    7.973ms  ZH      108µs
[lite fuzzy] runes≈ 2000  EN   21.225ms  KO   31.856ms  ZH      221µs
[lite fuzzy] runes≈ 4000  EN    84.71ms  KO  158.037ms  ZH      426µs
[lite fuzzy] runes≈ 8000  EN  338.846ms  KO  499.096ms  ZH      827µs
```

**解读**：
- go-swd 在所有带归一化能力的库里最快，比 LuYongwang 快 6–7 倍，而且 FindAll 只有 1 次分配。它和「什么归一化都不做」的纯字节 AC 库处于同一量级，内存却只有这些库的 1/10 到 1/60。
- 按字节匹配的 AC 库在英文上最快（cloudflare 的 FindAll 只要 4.1µs），但中文词库会把它们的内存撑到 56–329MB。
- sensitive-lite 默认模式在英文和韩文上慢了 2–3 个数量级，属于算法缺陷，不是常数项的差距。

---

## 9. 并发安全与已验证缺陷汇总（实测）

| 检查 | 结果 |
|---|---|
| go-swd：4 个读 goroutine 加 200 次 `AddWord`，开 `-race` | `ok`，无竞争 |
| LuYongwang DFA：同上 | **FAIL，4 处 DATA RACE**（写在 dfa.go:38，读在 dfa.go:176） |
| LuYongwang AC：同上 | `ok`，但每次写都深拷贝整棵树，且异步生效 |
| importcjj：同上 | **FAIL，4 处 DATA RACE** |
| go-away：8 个 goroutine 首次调用包级 `IsProfane` | **FAIL，5 处 DATA RACE**（goaway.go:339 附近的懒初始化） |
| LuYongwang `Replace("傻逼和傻逼")` | `"**和傻逼"`（DFA 和 AC 相同） |
| LuYongwang AC 删除 `傻逼` 后 `FindAll("大傻逼")` | `[大傻逼 傻逼]`（删除有残留） |
| sensitive-lite exact `Replace("傻逼和傻逼")` | `"**和傻逼"` |
| sensitive-lite 默认 `Replace("好好好的傻逼")` | `"好好**傻逼"`（位置错位） |
| importcjj `傻*逼` | `FindIn=true`，但 `Replace` 保持原样，`FindAll=[]` |
| moderation `IsInappropriate("学孵季孫")` | `true`（误杀） |

---

## 10. 选型建议

| 场景 | 建议 |
|---|---|
| **轻量检测**（写入前同步拦截，词库几千条） | go-swd 默认配置加 `WithAllowWords` 白名单。批量加词用 `AddWords`，别循环调用 `AddWord`（每次都会重建自动机） |
| **高并发服务** | go-swd：查询无锁、0 分配（`Detect`），热更新走原子替换。如果只需要英文或 ASCII 规则，也可以用 BobuSumisu，但必须自己加一层 `atomic.Pointer` 替换，并且不要用它装中文大词库（内存问题） |
| **强抗绕过** | go-swd 打开 `WithMaxGap(1~2)` 和 `WithCollapseRepeats(true)`，前面再挂一段自定义归一化（见下文的流水线），代价是误杀增加，所以**要配白名单并按风险分级处置**：高风险直接拦截，中风险转人工复审。拼音、同音、韩文初声、日文读音这类只能靠扩展词库或语义模型，关键词方法做不到。go-swd README 自己也用 COLD 数据集说明了召回的上限（[README#L190]，仅 README 声称，未核实） |
| **热更新词库** | go-swd 的 `AddWords/RemoveWords/AddAllowWords` 调用返回后立刻可见。词库放在 DB 或配置中心，由后台定时拉取全量或增量，再批量调用。**不要用** LuYongwang（异步生效、DFA 有竞争）和 sensitive-lite（没有更新 API） |
| **中英混合** | 见第 5 节：一棵 go-swd 树装两种语言；英文短词做边界校验；leet 旁挂 go-away |
| **中英日韩多语言** | 见下文 |

### 10.1 多语言：用一棵树还是按语言拆分

建议**匹配层共用一棵 go-swd 树，归一化和词库按语言打标签**：

1. **词库**：每个词带上语言和分类（可以用 go-swd 的 `UserCategory(0..20)` 当语言位）。所有语言的词共用一个 AC，因为 AC 的扫描成本与词库大小无关，和文本长度线性相关。
2. **会跨语言串味的变换，按字符所属的书写系统分段执行**：繁转简只作用于汉字，并且只在「确定是中文」时才做，否则日文里的 `後` 和 `機` 会被改写（第 6 节实测）；平假名转片假名只作用于假名；leet 只作用于 ASCII 片段。
3. **推荐的归一化顺序**（词条入库和文本扫描必须走同一套，同时维护「归一化后位置 → 原文位置」的映射）：
   1. NFKC（`golang.org/x/text/unicode/norm`）：处理全角、半角片假名、带圈字符、数学字母、兼容字母和韩文组合。这一步会改变 rune 数，所以**必须在这里建立偏移映射**。
   2. 删除零宽和 Cf 字符（go-swd 自己也会忽略，但在这里做完可以减少歧义）。
   3. 小写（Unicode）。
   4. 按书写系统做专属变换：平假名→片假名；西里尔和希腊同形字→拉丁字母（自建 confusables 子集）；可选的中文繁转简（仅中文语境）。
   5. leet（仅 ASCII 片段，可选，误杀高）。
   6. 交给 go-swd（Gap 和 Collapse 负责分隔符和重复字）。
   7. 命中后再做后置校验：英文短词的整词边界、白名单、按风险等级处置。
4. 已验证的原型（`cjk_norm_test.go`）：NFKC + 小写 + 平假名转片假名，再接 go-swd（MaxGap=2，Collapse），实测能命中 `ﾊﾞｶ`、`ばか`、`バ カ`、韩文 NFD 分解形、`시*발`、`ｆ.ｕ.ｃ.ｋ`，同时 `夏のバカンス` 和 `시발점` 依然误杀，**这正说明白名单是必需品**。韩文初声缩写 `ㅅㅂ` 需要以原始兼容字母形式单独入库并直接匹配。

---

## 11. 风险与注意事项

1. **License**：
   - LuYongwang 没有 LICENSE，**不能引入**，包括它的 `wordlists/`。
   - LDNOOBW 是 CC-BY-4.0，商用可以，但必须署名并注明修改。
   - go-swd 是 Apache-2.0，需要保留 NOTICE 和 License 声明；它的词库来源（commit 记录里有「filtering with Huawei Cloud」这类信息）没有完整说明，**词条本身的版权和出处建议法务确认**。
   - importcjj 的 `dict.txt` 同样没有来源说明。
   - moderation 是 Unlicense，最宽松。
2. **词库质量决定上限**：开源中文词库政治类占比高、时效性差，而且词表本身就是敏感内容。建议自建词库，按业务域（币圈营销话术、引流、诈骗等）持续运营，开源词库只作为冷启动。
3. **误杀**：子串匹配天然会误杀（class、バカンス、시발점、`documented`⊃`cum`），Gap 和剥离模式还会误报 `他很傻，逼得…`、`push it`。上线前应该用一份真实的正常语料回放，统计误杀率，再调整白名单和风险阈值；「拦截」和「打码」要分开策略。
4. **性能陷阱**：sensitive-lite 的 O(n²) 可以被长文本触发成 DoS；go-away 是 O(词数×n)，词库变大后会线性变慢；cloudflare 用于中文会占用数百 MB 内存。
5. **并发**：go-away 包级函数、importcjj、LuYongwang DFA 都不能在并发下使用，至少要自己加锁或确保只在初始化阶段构建。
6. **边界**：关键词方法对语境型违规（隐喻、反讽、歧视句）召回很低。go-swd README 用 COLD 数据集给出的召回率只有 7–12%（仅 README 声称，未核实），高风险场景需要叠加语义模型或人工复审。
7. **版本**：go-swd 的 `v0.3.0` 是 major-zero 版本，最近一次重写（`refactor!: rewrite the engine around a flat-array Aho-Corasick automaton`，2026-09-04）改了 API，而且当时刚发布 3 周，建议锁定版本，并用第 12 节的测试回归。sensitive-lite 没有 git tag，`go get` 只能拿到伪版本。

---

## 12. 复现命令（本次调研实际执行）

所有代码都在 scratchpad 的 `bench/` 目录，没有写入本仓库。

```bash
# 1. 拉源码（固定 commit 见第 1 节）
cd $SCRATCH/repos
for r in kirklin/go-swd LuYongwang/go-sensitive-word kaidong77/sensitive-lite importcjj/sensitive \
         cloudflare/ahocorasick petar-dambovaliev/aho-corasick BobuSumisu/aho-corasick \
         TwiN/go-away finnbear/moderation \
         LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words \
         suapapa/go_hangul gojp/kana ktnyt/go-moji ikawaha/kagome; do
  git clone -q --depth 50 https://github.com/$r.git $(echo $r | tr / _)
done
# 没有 go.mod 的库补一个，方便用 replace 引用
echo 'module github.com/importcjj/sensitive'     > importcjj_sensitive/go.mod
echo 'module github.com/cloudflare/ahocorasick'  > cloudflare_ahocorasick/go.mod

# 2. bench/go.mod 用 replace 指向上面的本地目录，然后：
cd $SCRATCH/bench
go test -run TestBuildAndMem -v .                                    # 8.2 构建与内存
go test -run '^$' -bench . -benchmem -benchtime=500ms -count=1 .     # 8.1 中英
go test -run '^$' -bench 'JA|KO' -benchmem -benchtime=300ms .        # 8.1 日韩
go test -run TestMatrix -v .                                         # 4.2 抗干扰矩阵
go test -run 'TestBehaviour|TestLiteScaling' -v .                    # 9 行为缺陷、8.3 O(n²)
for t in TestRaceSwd TestRaceLuyDFA TestRaceLuyAC TestRaceCjj TestRaceGoAwayDefault; do
  go test -race -run "^$t\$" -count=1 .                              # 9 并发
done
go test -run TestCJKNorm -v .                                        # 6/7/10 NFKC、假名、初声原型
go test -run TestWholeWord -v .                                      # 5 整词匹配
```

`-race` 的输出摘要：

```
===== TestRaceSwd            ok  swbench 2.710s
===== TestRaceLuyDFA         4 WARNING: DATA RACE / FAIL
===== TestRaceLuyAC          ok  swbench 1.583s
===== TestRaceCjj            4 WARNING: DATA RACE / FAIL
===== TestRaceGoAwayDefault  5 WARNING: DATA RACE / FAIL
```

NFKC 与 `width.Fold` 的实测输出（节选）：

```
"ﾊﾞｶ"   NFKC="バカ"   width.Fold="バカ"
"ばか"   NFKC="ばか"   (NFKC 不做平假名到片假名；自写规则后 "バカ")
"𝐟𝐮𝐜𝐤"  NFKC="fuck"  width.Fold 不变
"fuсk"  NFKC 不变（西里尔 с 不在 NFKC 的范围内）
"ㅅㅂ"   NFKC="ᄉᄇ"（兼容字母 → 连写字母）
choseong("시발")="ㅅㅂ"  choseong("사범")="ㅅㅂ"   ← 初声投影会误杀
```

---

## 13. 参考来源

**go-swd**（`480ac616afb753582b9ef72cee38932aa63d8c17`）
- [README#L11]：「约四万词」；[README#L169]：15,932 词；[README#L163]：并发说明；[README#L180-L186]、[README#L190]：COLD 评测
- [engine.go#L29-L39]、[engine.go#L66-L82]、[engine.go#L209-L235]、[engine.go#L263-L301]、[engine.go#L339-L440]、[engine.go#L456-L509]
- [internal/automaton/automaton.go#L1-L16]、[#L39]、[#L533-L546]、[#L600-L602]、[#L603-L605]
- [internal/normalize/normalize.go#L44-L80]、[#L54]、[#L82-L106]、[#L205-L228]
- [options.go#L51-L79]、[dict.go#L13]、[go.mod](https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/go.mod)、[LICENSE](https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/LICENSE)

**LuYongwang/go-sensitive-word**（`0337d64da81e1c336924984311a1b746f7906660`）
- [README#L13]、[README#L105]、[README#L258-L265]
- [manager.go#L49-L51]、[normalize.go#L8-L58]、[wrapper.go](https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/wrapper.go#L172-L219)
- [internal/filter/dfa/dfa.go#L5-L43]、[#L38]、[#L87-L98]、[#L100-L136]、[#L176]、[#L202-L217]
- [internal/filter/ac/ac.go#L11-L15]、[#L39-L66]、[#L68-L79]、[#L126-L149]、[#L145]、[#L151-L193]、[#L212-L228]、[#L364-L392]
- [internal/store/memory.go#L28-L43]、[#L94]、[#L182-L205]；[internal/normalize/normalize.go#L111-L123]；[tool.go#L5-L40]

**kaidong77/sensitive-lite**（`4a9c0051b08a95101c469d7eee2d23a9973c8772`）
- [README#L196]；[options.go#L39-L45](https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/options.go#L39-L45)
- [sensitive.go#L70-L165]、[#L306-L312]、[#L478-L588]
- [internal/core/dfa.go#L39-L70]、[#L308-L330]、[#L356-L391]；[internal/core/dfa_opt.go#L73]、[#L152]
- [internal/core/normalizer.go#L134-L230]、[#L216-L223]、[#L350-L365]、[#L516-L525]、[#L564-L620]
- [internal/core/confusable.go#L319-L396]、[#L501-L532]、[#L599-L660]；[internal/core/leet.go#L41]

**importcjj/sensitive**（`42d1c505be7b2d2a3f7fe106e3b02499975b2f24`）：[filter.go#L19-L24]、[filter.go#L42-L54]、[filter.go#L93-L112]、[trie_tree.go#L24-L46]；[Aho-Corasick 分支](https://github.com/importcjj/sensitive/tree/Aho-Corasick)

**通用 AC**
- cloudflare（`054963e…`）：[ahocorasick.go#L19-L50]、[#L220-L235]、[#L280]；[LICENSE](https://github.com/cloudflare/ahocorasick/blob/054963ec939627782012c7c34eefd2942488d4e1/LICENSE)
- petar（`463d218…`）：[README#L4]、[ahocorasick.go#L37-L44]、[ahocorasick.go#L275-L281]
- BobuSumisu（`b4b5728…`）：[trie.go#L13-L21]、[stream.go#L11-L24]
- anknown：[ahocorasick.go](https://github.com/anknown/ahocorasick/blob/d75dbd5169c01a25cc83bf040d6e056aa69aec18/ahocorasick.go#L8-L15)

**英文**
- go-away（`da82b89…`）：[README#L94]、[goaway.go#L114-L122]、[#L130-L162]、[#L236-L273]、[#L275-L287]、[#L338-L343]、[falsepositives.go#L58]
- moderation（`663b12f…`）：[README#L7]、[moderation.go#L97]、[#L153]、[#L180]、[replacements.go#L5-L23]、[#L123]、[generator/Makefile#L6-L9]、[generator/generate.go#L228]、[LICENSE](https://github.com/finnbear/moderation/blob/663b12f8baff0d8bc35efd0881a3055f6b2a40cc/LICENSE)

**词库**：LDNOOBW（`5faf2ba…`）[README](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/blob/5faf2ba42d7b1c0977169ec3611df25a3c08eb13/README.md)、[LICENSE（CC-BY-4.0）](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/blob/5faf2ba42d7b1c0977169ec3611df25a3c08eb13/LICENSE)；[konsheng/Sensitive-lexicon LICENSE（MIT）](https://github.com/konsheng/Sensitive-lexicon/blob/main/LICENSE)

**日 / 韩辅助**
- [golang.org/x/text/unicode/norm](https://pkg.go.dev/golang.org/x/text/unicode/norm)、[golang.org/x/text/width](https://pkg.go.dev/golang.org/x/text/width)（实测版本 v0.41.0）
- suapapa/go_hangul（`6a5f658…`）：[hangul.go#L28-L72]、[go.mod](https://github.com/suapapa/go_hangul/blob/6a5f658981f41ed80549b6c98e24c86fcd316e0b/go.mod)（go 1.27.0）
- [ktnyt/go-moji default_sets.go](https://github.com/ktnyt/go-moji/blob/7a72f5ccf13660b1aab14b6e7127efe92ef66f2f/default_sets.go#L4-L16)
- [gojp/kana kana.go](https://github.com/gojp/kana/blob/5456a3aa55f14cc22401d5eb0ac5250898e9772a/kana.go#L56-L160)
- [ikawaha/kagome README](https://github.com/ikawaha/kagome/blob/74394f35f36d09c3db153ce36a9167b8293a6baa/README.md)

[README#L11]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/README.md#L11
[README#L163]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/README.md#L163
[README#L169]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/README.md#L169
[README#L180-L186]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/README.md#L180-L186
[README#L190]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/README.md#L190
[engine.go#L29-L39]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/engine.go#L29-L39
[engine.go#L66-L82]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/engine.go#L66-L82
[engine.go#L209-L235]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/engine.go#L209-L235
[engine.go#L263-L301]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/engine.go#L263-L301
[engine.go#L339-L440]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/engine.go#L339-L440
[engine.go#L456-L509]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/engine.go#L456-L509
[#L456-L509]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/engine.go#L456-L509
[internal/automaton/automaton.go#L1-L16]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/internal/automaton/automaton.go#L1-L16
[#L39]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/internal/automaton/automaton.go#L39
[#L533-L546]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/internal/automaton/automaton.go#L533-L546
[#L600-L602]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/internal/automaton/automaton.go#L600-L602
[#L603-L605]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/internal/automaton/automaton.go#L603-L605
[automaton.go#L600-L602]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/internal/automaton/automaton.go#L600-L602
[automaton.go#L603-L605]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/internal/automaton/automaton.go#L603-L605
[internal/normalize/normalize.go#L44-L80]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/internal/normalize/normalize.go#L44-L80
[normalize.go#L44-L80]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/internal/normalize/normalize.go#L44-L80
[#L54]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/internal/normalize/normalize.go#L54
[go-swd normalize.go#L54]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/internal/normalize/normalize.go#L54
[#L82-L106]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/internal/normalize/normalize.go#L82-L106
[normalize.go#L82-L106]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/internal/normalize/normalize.go#L82-L106
[#L205-L228]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/internal/normalize/normalize.go#L205-L228
[normalize.go#L205-L228]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/internal/normalize/normalize.go#L205-L228
[options.go#L51-L79]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/options.go#L51-L79
[options.go#L58-L72]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/options.go#L58-L72
[dict.go#L13]: https://github.com/kirklin/go-swd/blob/480ac616afb753582b9ef72cee38932aa63d8c17/dict.go#L13

[README#L13]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/README.md#L13
[README#L105]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/README.md#L105
[README#L258-L265]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/README.md#L258-L265
[manager.go#L49-L51]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/manager.go#L49-L51
[normalize.go#L8-L58]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/normalize.go#L8-L58
[dfa.go#L5-L43]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/dfa/dfa.go#L5-L43
[internal/filter/dfa/dfa.go#L5-L43]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/dfa/dfa.go#L5-L43
[dfa.go#L38]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/dfa/dfa.go#L38
[#L38]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/dfa/dfa.go#L38
[dfa.go#L87-L98]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/dfa/dfa.go#L87-L98
[#L87-L98]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/dfa/dfa.go#L87-L98
[#L100-L136]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/dfa/dfa.go#L100-L136
[dfa.go#L176]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/dfa/dfa.go#L176
[#L176]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/dfa/dfa.go#L176
[dfa.go#L202-L217]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/dfa/dfa.go#L202-L217
[#L202-L217]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/dfa/dfa.go#L202-L217
[ac.go#L11-L15]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/ac/ac.go#L11-L15
[internal/filter/ac/ac.go#L11-L15]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/ac/ac.go#L11-L15
[ac.go#L39-L66]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/ac/ac.go#L39-L66
[#L39-L66]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/ac/ac.go#L39-L66
[ac.go#L68-L79]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/ac/ac.go#L68-L79
[#L68-L79]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/ac/ac.go#L68-L79
[#L126-L149]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/ac/ac.go#L126-L149
[ac.go#L145]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/ac/ac.go#L145
[#L145]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/ac/ac.go#L145
[ac.go#L151-L193]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/ac/ac.go#L151-L193
[#L151-L193]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/ac/ac.go#L151-L193
[#L212-L228]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/ac/ac.go#L212-L228
[ac.go#L364-L392]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/ac/ac.go#L364-L392
[#L364-L392]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/filter/ac/ac.go#L364-L392
[memory.go#L28-L43]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/store/memory.go#L28-L43
[internal/store/memory.go#L28-L43]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/store/memory.go#L28-L43
[memory.go#L94]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/store/memory.go#L94
[#L94]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/store/memory.go#L94
[#L182-L205]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/store/memory.go#L182-L205
[LuYongwang normalize.go#L111-L123]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/normalize/normalize.go#L111-L123
[internal/normalize/normalize.go#L111-L123]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/internal/normalize/normalize.go#L111-L123
[tool.go#L5-L40]: https://github.com/LuYongwang/go-sensitive-word/blob/0337d64da81e1c336924984311a1b746f7906660/tool.go#L5-L40

[README#L196]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/README.md#L196
[sensitive.go#L70-L165]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/sensitive.go#L70-L165
[sensitive.go#L306-L312]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/sensitive.go#L306-L312
[#L306-L312]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/sensitive.go#L306-L312
[sensitive.go#L478-L588]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/sensitive.go#L478-L588
[#L478-L588]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/sensitive.go#L478-L588
[dfa.go#L39-L70]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/dfa.go#L39-L70
[internal/core/dfa.go#L39-L70]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/dfa.go#L39-L70
[dfa.go#L308-L330]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/dfa.go#L308-L330
[#L308-L330]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/dfa.go#L308-L330
[#L356-L391]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/dfa.go#L356-L391
[dfa_opt.go#L73]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/dfa_opt.go#L73
[internal/core/dfa_opt.go#L73]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/dfa_opt.go#L73
[#L152]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/dfa_opt.go#L152
[normalizer.go#L134-L230]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/normalizer.go#L134-L230
[internal/core/normalizer.go#L134-L230]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/normalizer.go#L134-L230
[normalizer.go#L216-L223]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/normalizer.go#L216-L223
[#L216-L223]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/normalizer.go#L216-L223
[normalizer.go#L350-L365]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/normalizer.go#L350-L365
[#L350-L365]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/normalizer.go#L350-L365
[#L516-L525]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/normalizer.go#L516-L525
[normalizer.go#L564-L620]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/normalizer.go#L564-L620
[#L564-L620]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/normalizer.go#L564-L620
[confusable.go#L319-L396]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/confusable.go#L319-L396
[internal/core/confusable.go#L319-L396]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/confusable.go#L319-L396
[#L319-L396]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/confusable.go#L319-L396
[confusable.go#L501-L532]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/confusable.go#L501-L532
[#L501-L532]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/confusable.go#L501-L532
[#L599-L660]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/confusable.go#L599-L660
[leet.go#L41]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/leet.go#L41
[internal/core/leet.go#L41]: https://github.com/kaidong77/sensitive-lite/blob/4a9c0051b08a95101c469d7eee2d23a9973c8772/internal/core/leet.go#L41

[filter.go#L19-L24]: https://github.com/importcjj/sensitive/blob/42d1c505be7b2d2a3f7fe106e3b02499975b2f24/filter.go#L19-L24
[filter.go#L42-L54]: https://github.com/importcjj/sensitive/blob/42d1c505be7b2d2a3f7fe106e3b02499975b2f24/filter.go#L42-L54
[filter.go#L93-L112]: https://github.com/importcjj/sensitive/blob/42d1c505be7b2d2a3f7fe106e3b02499975b2f24/filter.go#L93-L112
[#L93-L112]: https://github.com/importcjj/sensitive/blob/42d1c505be7b2d2a3f7fe106e3b02499975b2f24/filter.go#L93-L112
[trie_tree.go#L24-L46]: https://github.com/importcjj/sensitive/blob/42d1c505be7b2d2a3f7fe106e3b02499975b2f24/trie_tree.go#L24-L46

[ahocorasick.go#L19-L50]: https://github.com/cloudflare/ahocorasick/blob/054963ec939627782012c7c34eefd2942488d4e1/ahocorasick.go#L19-L50
[#L220-L235]: https://github.com/cloudflare/ahocorasick/blob/054963ec939627782012c7c34eefd2942488d4e1/ahocorasick.go#L220-L235
[#L280]: https://github.com/cloudflare/ahocorasick/blob/054963ec939627782012c7c34eefd2942488d4e1/ahocorasick.go#L280
[README#L4]: https://github.com/petar-dambovaliev/aho-corasick/blob/463d218d4745bf13c5de1c65ba10e07139955652/README.md#L4
[ahocorasick.go#L37-L44]: https://github.com/petar-dambovaliev/aho-corasick/blob/463d218d4745bf13c5de1c65ba10e07139955652/ahocorasick.go#L37-L44
[#L37-L44]: https://github.com/petar-dambovaliev/aho-corasick/blob/463d218d4745bf13c5de1c65ba10e07139955652/ahocorasick.go#L37-L44
[ahocorasick.go#L275-L281]: https://github.com/petar-dambovaliev/aho-corasick/blob/463d218d4745bf13c5de1c65ba10e07139955652/ahocorasick.go#L275-L281
[trie.go#L13-L21]: https://github.com/BobuSumisu/aho-corasick/blob/b4b5728e36fcc048a77abcea3eb2fcb28c021e2d/trie.go#L13-L21
[stream.go#L11-L24]: https://github.com/BobuSumisu/aho-corasick/blob/b4b5728e36fcc048a77abcea3eb2fcb28c021e2d/stream.go#L11-L24

[README#L94]: https://github.com/TwiN/go-away/blob/da82b895986b32bad1c7668242ca066f9e7dd464/README.md#L94
[goaway.go#L114-L122]: https://github.com/TwiN/go-away/blob/da82b895986b32bad1c7668242ca066f9e7dd464/goaway.go#L114-L122
[#L114-L122]: https://github.com/TwiN/go-away/blob/da82b895986b32bad1c7668242ca066f9e7dd464/goaway.go#L114-L122
[#L130-L162]: https://github.com/TwiN/go-away/blob/da82b895986b32bad1c7668242ca066f9e7dd464/goaway.go#L130-L162
[goaway.go#L236-L273]: https://github.com/TwiN/go-away/blob/da82b895986b32bad1c7668242ca066f9e7dd464/goaway.go#L236-L273
[#L236-L273]: https://github.com/TwiN/go-away/blob/da82b895986b32bad1c7668242ca066f9e7dd464/goaway.go#L236-L273
[#L275-L287]: https://github.com/TwiN/go-away/blob/da82b895986b32bad1c7668242ca066f9e7dd464/goaway.go#L275-L287
[goaway.go#L338-L343]: https://github.com/TwiN/go-away/blob/da82b895986b32bad1c7668242ca066f9e7dd464/goaway.go#L338-L343
[#L338-L343]: https://github.com/TwiN/go-away/blob/da82b895986b32bad1c7668242ca066f9e7dd464/goaway.go#L338-L343
[falsepositives.go#L58]: https://github.com/TwiN/go-away/blob/da82b895986b32bad1c7668242ca066f9e7dd464/falsepositives.go#L58

[README#L7]: https://github.com/finnbear/moderation/blob/663b12f8baff0d8bc35efd0881a3055f6b2a40cc/README.md#L7
[moderation.go#L97]: https://github.com/finnbear/moderation/blob/663b12f8baff0d8bc35efd0881a3055f6b2a40cc/moderation.go#L97
[moderation.go#L153]: https://github.com/finnbear/moderation/blob/663b12f8baff0d8bc35efd0881a3055f6b2a40cc/moderation.go#L153
[#L153]: https://github.com/finnbear/moderation/blob/663b12f8baff0d8bc35efd0881a3055f6b2a40cc/moderation.go#L153
[moderation.go#L180]: https://github.com/finnbear/moderation/blob/663b12f8baff0d8bc35efd0881a3055f6b2a40cc/moderation.go#L180
[#L180]: https://github.com/finnbear/moderation/blob/663b12f8baff0d8bc35efd0881a3055f6b2a40cc/moderation.go#L180
[replacements.go#L5-L23]: https://github.com/finnbear/moderation/blob/663b12f8baff0d8bc35efd0881a3055f6b2a40cc/replacements.go#L5-L23
[replacements.go#L123]: https://github.com/finnbear/moderation/blob/663b12f8baff0d8bc35efd0881a3055f6b2a40cc/replacements.go#L123
[#L123]: https://github.com/finnbear/moderation/blob/663b12f8baff0d8bc35efd0881a3055f6b2a40cc/replacements.go#L123
[generator/Makefile#L6-L9]: https://github.com/finnbear/moderation/blob/663b12f8baff0d8bc35efd0881a3055f6b2a40cc/generator/Makefile#L6-L9
[generator/generate.go#L228]: https://github.com/finnbear/moderation/blob/663b12f8baff0d8bc35efd0881a3055f6b2a40cc/generator/generate.go#L228

[hangul.go#L28-L72]: https://github.com/suapapa/go_hangul/blob/6a5f658981f41ed80549b6c98e24c86fcd316e0b/hangul.go#L28-L72
