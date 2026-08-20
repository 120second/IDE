# Batch 9 Performance Report

本报告基于 2026-08-20 在 Windows 开发机上的实际代码审计、自动化测试和手动性能场景。时间数据来自 Rust debug 测试程序；它适合发现退化和比较事件数量，不等同于所有机器上的 release UI 帧耗时。

## 结论

Batch 9 没有增加产品功能。主要热路径已经从“全量更新、逐事件渲染”收敛为“按需加载、增量更新、可视区渲染、跨 IPC 合批和有上限的缓冲区”。已有的 File Tree 懒加载、单一 CodeMirror `EditorView`、Runner 输出上限、Debug 变量分页和进程停止机制被保留并复用。

开发模式下可在 DevTools Console 执行：

```js
await window.__LIGHTCP_PERFORMANCE__()
```

返回前后端启动耗时、最近一次 Workspace 加载耗时、活动进程数、IPC 事件数和前端输出缓冲区估算字节数。该入口仅在 `import.meta.env.DEV` 下注册，不增加正式 UI 元素，也不轮询后端。

## 实测场景

| 场景 | 结果 |
| --- | --- |
| 5000 个 `.cpp`、50 个目录、40 层深目录 | 逐层读取 5000 文件及深目录耗时 311ms；File Tree 仍只渲染可视区行 |
| 8MiB UTF-8 源文件 | Rust 文件读取 2ms；编辑器进入大文件轻量扩展模式 |
| 10000 条 Template metadata、200 个分类 | SQLite metadata 查询 23ms；前端分类构建测试覆盖 10000 条，5000 层嵌套不会递归溢出 |
| 100000 行 stdout | 完整获得 100000 行，2080ms，Runner 输出 IPC batch 为 1 |
| 连续 Run 50 次 | 42490ms；每次结束后 `active_run_id` 均归零。主要耗时来自此机器对临时 exe 的 Windows 安全扫描/进程冷启动 |
| 重复 Debug 20 次 | 29570ms，150 个 Debug 事件；每次 Stop 后活动 GDB session 均归零 |
| 真实 Stress 100 次 | 38458ms，55 个合批进度事件，结束后活动 Stress session 归零 |
| Stress 10000 次编排/进度路径 | 10000 条通过记录完整交付为 313 个 batch，事件量降低约 96.9% |
| watcher 5000 条变化 | 自动化测试确认合并为一个 IPC payload |
| SQLite query plan | 四种 Template 常用排序均无 `TEMP B-TREE` |

10000 次真实双进程 Stress 没有在本机完整等待：按真实 100 次样本线性估算约 64 分钟，瓶颈是每轮必须启动两份一次性竞赛程序，而非生成器或 UI。代码仍支持真实 10000 次；自动化测试完整覆盖 10000 次统计、日志交付和 IPC batching。没有为了制造更好看的数字而把一次性竞赛程序改成不兼容的常驻协议。

## 问题、原因、修改和效果

| 问题 | 原因 | 修改 | 效果 |
| --- | --- | --- | --- |
| 启动时加载所有 Template metadata | App 创建 Store 后立即查询分类、Snippet 和 File Template | Template Store 改为首次进入模板区时加载；File Template 只在新建文件对话框打开时加载 | 正常启动减少 3 次数据库 IPC；模板代码正文继续按需读取 |
| 每次按键复制所有 Tab | CodeMirror update listener 每次 transaction 都执行 `tabs.map` 并保存完整 `EditorState` | 活动 `EditorView` 持有实时 state；只在首次变脏和 Tab 生命周期边界同步 | 连续输入不再随打开 Tab 数量线性放大 Svelte 更新 |
| 快速切 Tab 触发无效数据库请求 | 测试点和 Generator Profile 在每次 active path 改变时立即加载 | 当前文件同步增加 80ms debounce 和 stale request 校验 | 快速切换只加载最终稳定 Tab |
| 外观设置使所有后台 Tab 重配置 | 每个设置变化都更新所有 inactive `EditorState` | 只重配置活动 View；后台 Tab 在再次激活时应用最新外观 | 设置滑块更新不再复制全部 Tab state |
| 大文件启用完整 C++ 解析和折叠 | 5–10MiB 文件仍使用与普通竞赛文件相同的 CodeMirror 扩展 | 2MiB 以上保留编辑、历史、行号和搜索，暂停 C++ parser、折叠、括号/选区高亮和自动换行 | 8MiB 文件可打开，避免后台语法树和布局成为主要内存/CPU 消耗 |
| File Tree flatten 重复计算 | 多个消费者读取 getter 时重新遍历展开节点 | 按目录 revision 缓存扁平行；保留逐目录 lazy load 和已有 virtual DOM | 5000 节点下只有结构变化时重建行数组 |
| Windows 深目录被误判为越界 | 超过传统路径长度后 canonical path 带 `\\?\` 前缀，普通根路径没有 | 所有文件、编译、测试点、Generator 和 Archive 边界检查统一规范化 verbatim/普通路径后比较 | 40 层中文/长路径场景通过，且 sibling 前缀仍不能绕过边界 |
| Template Category O(n²) 且深树递归 | 每个节点重复 `filter`/`some` 全量分类；递归展开可能栈溢出 | 一次构建 parent index，迭代式 DFS，按 revision 缓存 | 10000 metadata 测试通过；5000 层树不溢出 |
| Template DOM 与 metadata 数量相同 | 模板列表和分类树使用直接 `{#each}` | 两处都按固定行高、viewport 和 overscan 虚拟渲染 | DOM 数量约等于可视行 + 16，而非全部 metadata |
| stdout 前端逐事件拼接大字符串 | 每个 batch 都触发 Svelte 更新，字符串反复复制 | Rust 继续 24ms batching；channel 改为容量 64 的有界队列；前端再按 32ms 合并并限制容量 | 100000 行场景仅 1 个 Runner IPC batch；生产者无法用无限 channel 撑爆内存 |
| 大输出 `<pre>` 布局成本高 | 软换行文本节点需要为大量行做 DOM 文本布局 | 输出和 Debug Console 使用原生只读 textarea；仍是一个原生文本控件 | 避免创建逐行 DOM，并利用 WebView 原生大文本滚动实现 |
| GDB target output 近似逐行 IPC | 每个 MI stream record 立即 emit | 相邻 stream 按 32ms 或 32KiB 合并，状态/result 前先 flush | 保持事件顺序，同时避免快速输出堆积 IPC |
| Stress 每个 case 发一次事件 | 10000 次会产生至少 10000 次 IPC 和 Svelte 日志更新 | 最多 32 条/100ms 一批；前端整批追加并只保留 500 条 | 10000 条合成进度变为 313 批，统计与最后 500 条日志完整 |
| watcher 大量事件逐条写库/跨 IPC | notify callback 直接同步 Archive 并 emit | 独立 worker 75ms 合批；created/deleted 共用事务；前端再合并 parent refresh | 5000 条变化成为一个 payload；watcher Drop 会停止并 join worker |
| 保存代码会触发 Archive 全量刷新 | 任意 `changed` watcher event 都刷新 facets、collections、tags 和 files | 普通内容变化只处理打开文件；仅创建/删除/重命名刷新 Archive | 编辑和保存不再产生一组无关 SQLite 查询 |
| 自己保存后又从磁盘读回 | watcher 无法区分最近一次 IDE 写入 | Editor 记录最近写入路径并忽略对应短时间 changed event | Ctrl+S 不再做一次多余的大文件 read IPC |
| Template 常用排序使用临时 B-tree | 原索引在 `kind` 和 `sort_order` 中间包含 `category_id` | schema v7 增加 manual/name/usage/created 及 Archive inbox 索引 | query-plan 测试确认常用排序不再使用临时排序表 |
| settings 重复/并发写 | 保存响应再次赋值触发外观刷新；相同设置仍写盘；慢写时可交错 | 400ms debounce 保留；增加 fingerprint、单飞写入和最后值重试；Rust 相同 bytes 不写盘并放入 blocking task | 降低磁盘写入与无效 Svelte effect，退出时尝试 flush pending value |
| listener 注册/卸载竞态 | `listen()` 可能在 Store dispose 后才 resolve | 四个事件 Store 在异步注册完成后检查 disposed；Timer、ResizeObserver、拖动 pointer listener 全部清理 | 快速打开/关闭和窗口退出不会留下前端 listener |
| child pipe/进程异常路径可能泄漏 | compiler/runner 在 pipe 缺失或 `try_wait` 出错时提前返回 | 所有异常分支 kill + wait；Runner/Stress/Debug/Watcher 均有 Drop/Stop cleanup | 重复 Run/Debug 测试后活动管理器归零 |

## 已确认无需重写的部分

- File Tree 已经逐目录读取并虚拟渲染，未引入第二套树组件。
- Editor 始终只有一个可见 `EditorView`，Tab 只保存 `EditorState`。
- Debug 大数组已按需展开，每页最多 100 项。
- Archive 列表已有 500 条上限，搜索已有 debounce 和 stale request 防护。
- Generator、Runner、Compiler、Debug 输出均已有硬容量限制；本批在它们之外增加了有界传输和 UI batching。
- SQLite 已使用 WAL、`synchronous=NORMAL`、busy timeout 和事务。

## 仍存在的限制

- 2MiB 以上源文件进入轻量编辑模式后暂不显示 C++ 语法高亮、折叠和括号匹配；保存、搜索、编辑、运行仍可用。
- Template 搜索使用前导 `%query%` 的模糊匹配，SQLite 普通索引不能加速；10000 条实测可接受。若未来达到数十万条，再考虑 FTS，而不是现在引入额外架构。
- 每个竞赛程序通常只处理一组 stdin 后退出，Stress 无法安全复用进程。大量迭代的下限受 Windows 进程创建和安全软件扫描影响。
- 输出控件有明确容量上限，不是无限终端历史；达到设置上限后会保留尾部并显示截断提示。
- Dev performance 统计是轻量计数器，不是 CPU sampling profiler；release build 不注册 Console 入口。

## 复现命令

```powershell
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --test performance_audit -- --ignored --nocapture
```

长时间真实 Stress 场景可指定次数后只运行对应测试：

```powershell
$env:LIGHTCP_STRESS_ITERATIONS=10000
cargo test --manifest-path src-tauri/Cargo.toml --test performance_audit stress_iterations_batch_progress -- --ignored --nocapture
```
