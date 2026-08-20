# LightCP 架构（Batch 6）

## 范围

当前架构已完成至 Batch 9：IDE Shell、编辑器、Workspace、Template Center、Compiler、Runner、Fixed Testcases、代码归档、结构化 Random Generator、GDB/MI Debugger、Stress Test 与性能专项优化。clangd 尚未加入。

## 进程与职责边界

```text
Svelte 5 / TypeScript
        │
        │ typed Tauri invoke
        ▼
Tauri command adapter
        │
        ▼
Rust Core modules
        │
        ├── application data directory
        ├── SQLite + migrations
        └── platform services (reserved)
```

- 前端负责界面和交互状态，不直接访问文件系统、SQLite 或进程。
- `commands` 是 IPC 适配层，只负责输入/输出转换并调用 Rust Core。
- Rust Core 负责操作系统资源、数据持久化和后续的长任务管理。
- 跨 IPC 的错误使用稳定、可序列化的 `CommandError`，不把 panic 或 Rust 内部错误直接呈现给用户。

## 前端

```text
src/
├── lib/
│   ├── api/          # Tauri command 调用
│   ├── components/   # Shell、Editor、Explorer、Templates、Settings 组件
│   ├── editor/       # CodeMirror EditorView / EditorState 管理
│   ├── stores/       # Shell、Settings、Workspace、Template、Execution、Archive 与 Generator 状态
│   └── types/        # IPC 数据契约
├── App.svelte        # 服务组合与启动入口
├── app.css           # 全局基础样式和 CSS variables
└── main.ts           # Svelte 挂载入口
```

前端通过 typed API 调用健康检查、设置、Workspace、文件、模板、编译、运行和样例命令。各 Store 保持分离，ExecutionStore 只编排保存、编译、运行和判题，不直接执行进程或 SQLite 操作。

### Editor 状态模型

```text
EditorWorkspace
├── 1 visible EditorView
└── N EditorTab
    ├── EditorState
    │   ├── document
    │   ├── selection / cursor
    │   └── undo history
    ├── scrollTop
    ├── canonical path（真实文件）
    └── dirty / deleted / externalModified
```

切换 Tab 前保存当前 `EditorView.state` 和 scroll offset，然后用 `EditorView.setState()` 装载目标 Tab。不会为每个 Tab 长期保留完整编辑器 DOM。

CodeMirror 扩展按需组合，只包含行号、C++ 高亮、括号匹配、缩进、搜索、历史、折叠、多 selection 和 active line 等本批需要的能力，没有引入全量 IDE completion/lint 功能。

编辑器模块使用动态 import，与 Shell 主包分离。CodeMirror/C++ 解析器在启动阶段异步加载。

真实文件通过 Rust 读取为 UTF-8 文本。`Ctrl+S` 将当前 EditorState 写回原路径；写入完成前后比较文档快照，避免异步保存期间的新输入被错误标记为已保存。文件被外部修改时，无本地编辑的 Tab 自动重载；有未保存编辑的 Tab 保留内存内容并显示冲突标记。外部删除与重命名会同步更新标签状态和路径。

### Workspace 与 Explorer

```text
WorkspaceStore
├── active WorkspaceInfo
├── recent workspaces
├── Map<directory path, DirectoryState>
│   ├── loaded / expanded / loading
│   └── one-level children
└── flattened visible rows → virtual viewport
```

打开目录时只读取根目录一层；只有用户展开某个子目录时才调用 `list_directory` 读取该层，不进行启动递归扫描。Explorer 将已展开节点扁平化，并按固定行高只渲染可视区与少量 overscan，因此单层 1000+ 节点不会创建 1000 个常驻 DOM 行。

新建、重命名、删除和拖放移动均调用异步 Rust command。右键菜单只负责收集用户意图，路径合法性、Workspace 边界和实际文件变更全部由 Rust 校验执行。

### Template Center

```text
TemplateStore
├── categories + flattened category rows
├── current metadata list（snippet 或 file）
├── separately cached file-template metadata
├── selected detail / editable draft
├── quick-search metadata
└── version metadata / one lazy preview body
```

列表、收藏、最近使用和搜索只传输 `TemplateMetadata`，不包含 `code`。打开详情、插入 Snippet、新建模板文件或预览某个历史版本时才读取对应正文。列表请求使用递增 request token 丢弃过时响应，普通搜索使用 180ms debounce，Quick Search 使用 100ms debounce。

Snippet 交给 CodeMirror 的 snippet state 插入，支持重复编号字段、`Tab` / `Shift+Tab` 跳转以及 LightCP 输入格式 `$0`。编辑器维持 `allowMultipleSelections`，同编号占位符可以同步选择。Template Center 不可见编辑器时，插入仍更新当前 Tab 保存的 `EditorState`。

File Templates 与 Snippets 使用相同持久化模型但在 UI 中明确分区。Explorer 新建文件先选择模板，按需读取正文后再通过受 Workspace 边界校验的 Rust `create_file` 写入。

### Execution 与固定样例

```text
ExecutionStore
├── save active EditorState to source file
├── compile_current_file → CompileResult
├── run_program → buffered runner-output events + RunResult
├── compare_testcase_output
└── testcase metadata/results → Bottom Panel
```

F5/F6 等快捷键统一定义在 `keybindings.ts`，Workbench 是唯一的全局键盘分发点。固定样例按当前物理源文件加载；UI 支持编辑、复制、删除、启用和拖放排序。输出区使用单个原生只读文本控件并按 32ms 合批更新，Test Results 只为每个样例创建一个结果行。

编译和运行 command 均为异步 Tauri command，耗时工作通过 `spawn_blocking` 离开 UI 线程。Runner 读取 stdout/stderr 的线程只发送原始块到 Rust 聚合器，聚合器约每 24ms 发出一个 `runner-output` 事件，不按行发送 IPC。Rust 与前端分别限制输出容量。

### Archive 与虚拟分类

```text
ArchiveStore
├── current SQLite query → 最多 500 条 metadata
├── Inbox / Favorites / Recent / Status facets
├── Platform / Difficulty / Tag facets
├── multi-selection + bulk update
├── saved Smart Collections
└── Quick Archive draft
```

Explorer 的文件树和代码归档是同一 Activity 下的两个视图。文件树仍只做物理目录 Lazy Load；归档视图只查询 SQLite，不扫描目录或读取 C++ 正文。Explorer 发现、新建或打开 `.cpp` 时仅登记路径和默认标题，保持 `archived = 0` 并出现在 Inbox；用户快速归档或批量更新后才写入平台、题号、难度、状态、笔记和标签。

标签通过 `tags + file_tags` 建立多对多关系。固定虚拟集合、平台、难度和算法标签都转换为带索引的 SQLite 条件；智能集合保存平台、难度范围、状态和 OR 标签列表，不复制文件。

### Random Generator

```text
GeneratorStore
├── versioned Visual Rule Tree / strategy / tree shape / decimal uint64 seed
├── TypeScript scope validation → node + field diagnostic
├── generate_visual_cases → Rust revalidation → N deterministic cases
├── preview / copy / save as fixed testcase
└── ExecutionStore.runInput → compile + run generated stdin
```

Rule Tree 以 Line 为主要输出单位。Line 按顺序持有 Integer、Array、String 或 Permutation Field；Repeat 持有子 Node，并创建不向外泄漏的局部变量作用域。Tree、Graph 和 Matrix 是可输出多行的独立 Node。ValueExpression 只包含 int64 常量或已有整数变量加减常量偏移。

前端每次结构变更都同步重算作用域并阻止失效引用；Rule Tree DTO 经 Tauri 直接传给 Rust，再转换为生成计划执行，不经过 DSL 字符串。Rust 在生成前独立进行同样的版本、作用域、引用和规模校验。原 DSL AST/parser 仅保留为兼容和未来高级导入/导出入口。

规则树、全局策略、默认树形和种子以 `version: 1` JSON 按源文件自动保存到 SQLite；生成后的 Preview 不写入 profile。选择“保存为测试点”时，生成结果通过已有 Testcase command 持久化；选择“生成并运行”时，通过已有 Compiler/Runner 链路执行当前 C++ 文件。生成工作在 Rust `spawn_blocking` 任务中完成，不阻塞 Tauri UI 线程。

### 外观设置

`SettingsStore` 立即应用 CSS variables，并在最后一次变更 400ms 后调用 Rust command。主题变化同时通过 CodeMirror `Compartment` 重配置所有 Tab 的 EditorState。

Performance Mode 会禁用 blur、transition、animation 和非必要背景装饰。

## Rust Core

```text
src-tauri/src/
├── commands/         # Tauri command 适配层
├── database/         # SQLite 初始化与顺序 migration
├── error.rs          # AppError / CommandError
├── paths.rs          # 应用数据目录
├── state.rs          # 只读应用基础状态
├── filesystem/       # Workspace 文件 IO、模型与原生 watcher
├── compiler/         # g++ 配置、构建路径、输出与耗时捕获
├── runner/           # 子进程、stdin、缓冲输出、timeout 与 stop
├── testcase/         # SQLite CRUD、排序与输出比较器
├── generator/        # Visual DTO/校验/profile、兼容 DSL parser、SplitMix64 与生成策略
├── stress/           # 后续批次预留
├── debugger/         # 后续批次预留
├── templates/        # 分类、模板 metadata/body、排序与版本历史
├── archive/          # 归档 metadata、标签、虚拟查询、批量更新与智能集合
└── settings/         # settings.json 加载、校验与保存
```

`lib.rs` 只组合插件、初始化基础服务、注册 command；具体逻辑保留在相应模块中。`main.rs` 只调用库入口，以兼容 Tauri 的桌面/移动项目结构。

## 应用数据与 SQLite

Tauri 根据 bundle identifier `com.lightcp.ide` 解析操作系统应用数据目录。Windows 当前位于用户的 Roaming AppData 下，包含 `lightcp.db` 和 `settings.json`。路径由运行时 API 解析，不拼接硬编码用户目录。

启动流程：

1. 创建应用数据目录。
2. 打开 SQLite 数据库。
3. 开启 foreign keys、WAL、NORMAL synchronous，并设置 busy timeout。
4. 创建 `schema_migrations`。
5. 在事务中顺序执行尚未应用的 migration。
6. 将 schema 版本放入 Tauri managed state。

schema v2 新增 `recent_workspaces`。schema v3 新增模板表和索引。schema v4 新增按 `source_path, sort_order, id` 索引的 `testcases`。schema v5 新增 `workspace_files`、`tags`、`file_tags`、`collections` 及归档索引。schema v6 新增按 canonical `source_path` 保存版本化 JSON 的 `generator_profiles`。schema v7 为 Template 常用排序与 Archive Inbox 排序补充覆盖索引。

`workspace_files` 同时记录 Inbox 和已归档文件。`available` 允许外部删除先隐藏记录、随后在配对 rename 事件到达时恢复并更新路径，因此 Windows 的 From/To 两段式事件不会丢失归档 metadata。

模板保存会在同一事务中写入快照，按 `version_number` 保留最近 20 版。历史列表不含正文，选择版本后才读取 `code`；恢复会再生成一个当前状态快照。若历史分类后来被删除，恢复时安全回退到未分类。

新增 migration 时，在 `database/migrations/` 添加只追加、不修改历史的 SQL 文件，并在 `migrations.rs` 的 `MIGRATIONS` 中注册更大的版本号。

## 错误契约

Rust 内部错误分类：

- `FileSystem`
- `Database`
- `Process`
- `Configuration`
- `Internal`

IPC 返回 camelCase 的 `CommandError`：

```text
category
code
userMessage
technicalMessage
```

`userMessage` 可以安全显示；`technicalMessage` 用于日志和诊断。后续模块应返回 `AppResult<T>`，command 边界再转换为 `CommandError`。

## 日志

`tauri-plugin-log` 在 Rust builder 中初始化，默认输出到终端和 Tauri 应用日志目录，使用本地时区。业务模块使用 `log` facade，不自行管理日志文件。

## 文件系统与监听安全边界

- 打开 Workspace 时通过 `dunce::canonicalize` 统一 Windows 路径，支持中文和空格。
- 所有读写、创建、重命名、删除和移动命令都验证 canonical path 位于当前 Workspace 根目录内。
- 新文件名只允许一个普通 path component，拒绝 `..` 和带分隔符的路径穿越。
- 禁止修改 Workspace 根目录和通过 LightCP 修改符号链接。
- 文本读取限制为 16 MiB 且要求 UTF-8，防止误把大型二进制文件装入编辑器。
- 使用 `notify::RecommendedWatcher` 的 Windows `ReadDirectoryChangesW` 后端递归监听，不使用轮询。
- Windows 将 rename 拆成 From/To 两个事件，Rust 层配对后向前端发出稳定的 `renamed [old, new]` 契约；只有 From 时仍按删除处理。

文件事件在前端进行 90ms 合并，只刷新事件涉及且已经加载的父目录；未展开目录不会因 watcher 事件被扫描。

## 本地背景图片安全边界

背景图片通过 Tauri asset protocol 加载，静态 scope 限制在 `$HOME/**/*`，并通过 CSP 只允许 `self`、`asset:`、`http://asset.localhost`、data 和 HTTPS 图片来源。Workspace 文本文件则只通过受根目录边界校验的 Rust command 读取，不通过 asset protocol 暴露。

## 后续批次边界

- Batch 7：GDB 图形化调试。
- Stress 和其他高级能力继续保留到对应批次。
