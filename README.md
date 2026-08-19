# LightCP

LightCP 是一个 Windows 优先的轻量算法竞赛 IDE。本仓库目前完成 **Batch 6：Random Test Generator**，包含 Tauri 2、Svelte 5、TypeScript、Vite、Rust、SQLite migration、CodeMirror 6、统一错误类型、日志和设置持久化。

已实现 IDE Shell、多 Tab 编辑器、真实工作区、文件管理、原生 watcher、完整模板中心、Compiler、Runner、固定样例、代码归档和确定性随机数据生成器。Batch 6 使用结构化 Rule Tree 搭建输入格式，并提供 11 种数据策略、6 种树形，以及排列、树和无重边图生成。GDB、clangd 与 Stress 尚未实现。

## 环境要求

- Windows 10/11
- Node.js 20.19+（推荐当前 LTS）
- Rust stable MSVC 1.77.2+
- Microsoft Visual Studio C++ Build Tools
- Microsoft Edge WebView2
- g++（默认从 `PATH` 查找，也可在 Settings 中指定完整路径）

Tauri 的 Windows 前置环境参考：[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)。

## 安装

```powershell
npm install
```

如果尚未安装 Rust：

```powershell
winget install --id Rustlang.Rustup -e
```

安装后重新打开终端，确认 `cargo --version` 可用。

## 开发运行

启动完整桌面应用：

```powershell
npm run tauri dev
```

应用启动后应显示：

```text
Rust backend ready
```

常用快捷键：

- `Ctrl+B`：显示/隐藏 Sidebar
- `Ctrl+J`：显示/隐藏 Bottom Panel
- `Ctrl+K` 后按 `Z`：进入/退出 Zen Mode
- `Escape`：退出 Zen Mode
- `Ctrl+F`：编辑器搜索
- `Ctrl+S`：保存当前真实文件
- `Ctrl+Alt+T`：打开 Snippet Quick Search，按 Enter 插入当前编辑器
- `Ctrl+Shift+A`：快速归档当前工作区 C++ 文件
- `F5`：编译并运行当前 C++ 文件
- `F6`：编译并运行当前文件的所有已启用固定样例
- `Ctrl+Z` / `Ctrl+Y`：Undo / Redo

只启动 Vite 浏览器预览时无法连接 Rust backend，这是预期行为：

```powershell
npm run dev
```

## 检查与构建

```powershell
npm run check
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npx tauri build --no-bundle
```

最后一条生成 Windows 可执行文件但不创建安装包。安装包配置留到发布批次。

## 数据与日志

运行时数据库与设置位于 Tauri 为 `com.lightcp.ide` 解析的本机应用数据目录：

```text
lightcp.db
settings.json
```

设置在 UI 中实时预览，并在最后一次变化 400ms 后写盘。Rust 日志默认写入终端和 Tauri 应用日志目录。

SQLite migration 为只追加机制；详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

最近打开的工作区保存在 `recent_workspaces`。模板数据保存在 schema v3 的模板表中，固定样例保存在 schema v4 的 `testcases` 表中，归档 metadata、标签和智能集合保存在 schema v5，版本化随机生成规则保存在 schema v6 的 `generator_profiles`。所有 Workspace 文件操作均通过 Rust command 执行并校验当前根目录边界；Windows watcher 使用原生 `ReadDirectoryChangesW`，不轮询磁盘。

## 当前目录

- `src/`：Svelte/TypeScript 前端
- `src-tauri/`：Rust Core 与 Tauri 配置
- `docs/`：架构文档

## 编辑器状态模型

应用始终只维护一个可见的 CodeMirror `EditorView`。每个 Tab 保存独立的 `EditorState` 和 scroll offset，因此 cursor、selection、undo history 与滚动位置可以在切换时恢复。

CodeMirror/C++ 解析器独立为异步 chunk，避免把完整编辑器核心塞入启动主包。

## Workspace 行为

- “Open Folder” 使用系统目录选择器，支持中文和空格路径。
- 初次只读取根目录一层，展开子目录时才读取该层。
- 文件树只渲染可视行，可承载单层 1000+ 节点。
- 双击文件在现有单个 `EditorView` 中打开；同一路径不会重复开 Tab。
- 外部修改在无本地编辑时自动重载；存在未保存编辑时显示冲突标记。
- 外部删除和重命名会更新已打开 Tab 的状态和路径。

## Template Center 行为

- Templates Activity 提供 Snippets 与 File Templates 两类独立视图，以及 Search、Favorites、Recent 和六种排序。
- 分类支持多层嵌套、增删改、拖放移动和手动排序；模板支持分类移动、收藏与拖放排序。
- 启动和列表查询只读取 metadata；代码正文仅在打开、插入或创建文件时按需读取。
- Snippet 支持 `${1:name}`、`${2:value}`、`$0`，插入后用 `Tab` / `Shift+Tab` 在占位符之间移动。
- 编辑器选区右键可执行 “Save as Snippet”；每次保存会生成快照并保留最近 20 个版本。
- 新建文件可选择 Empty C++、Contest C++ 或 Multi Test C++，内容通过 Rust 文件命令写入。

## Compiler、Runner 与固定样例

- Settings 可设置 compiler path、C++17/20/23、Release 参数、Debug 参数、运行超时和最大输出容量。
- Build 会先保存当前文件，再由 Rust 直接启动 g++；结果包含 stdout、stderr、exit code 和耗时，可执行文件写入应用数据目录的 `build/`。
- Runner 在后台线程执行，支持 stdin、stdout、stderr、exit code、超时和 Stop。输出在 Rust 侧每约 24ms 合并后发送，且前后端均有容量上限。
- Testcases Activity 按当前 C++ 文件管理 Sample、Custom、Hack，支持新增、编辑、启用、复制、删除、拖动排序、Run One 和 Run All。
- 比较器仅忽略行末空格与最终多余换行，不忽略内部空格差异。
- Output 使用单一 `<pre>` 文本节点，避免大量 stdout 创建成千上万个 DOM 节点。

## 竞赛代码归档

- Explorer 提供“文件 / 代码归档”双视图；虚拟分类全部由 SQLite 查询，不复制或移动代码文件。
- Explorer 已发现、新建或打开的 `.cpp` 文件会登记到 Inbox；不会递归扫描 Workspace，也不会读取文件正文来建立索引。
- `Ctrl+Shift+A` 可填写平台、题号、标题、难度、标签、状态、笔记和收藏；历史标签提供自动完成。
- 内置收藏、最近编辑、已完成、待复习、平台、难度和算法标签分类；同一个文件可以同时出现在多个虚拟分类中。
- 归档结果支持多选，并可批量添加标签、修改平台、难度与状态。
- 智能集合支持平台、难度范围、状态和一组 OR 算法标签，并保存为 Workspace 专属查询。
- LightCP 内部及外部发生文件重命名、移动或删除时，原生 watcher 会同步 metadata 路径或可用状态。

## 随机数据生成器

- Testcases Activity 的“随机生成”页以 Line、Field、Repeat、Tree、Graph 和 Matrix 组成结构化规则树；同一行可以包含多个整数，数组默认独占一行。
- 范围和长度使用结构化的常量/变量/变量偏移表达式。下拉框只列出当前位置可见的整数；删除被引用变量后，依赖规则立即标红并禁止生成。
- 相同 Rule Tree、种子和设置产生完全相同的数据；种子使用十进制字符串跨 IPC 传递，避免 JavaScript 大整数精度损失。
- 支持整数、数组、二进制/小写字符串、排列、矩阵、嵌套重复块、树、带权树、简单无向图、连通无向图和 DAG。
- 生成结果可以复制、直接编译运行当前 C++ 文件，或保存为普通固定测试点；不依赖 AI、网络或额外的 `generator.cpp`。
- 规则树、全局策略、默认树形和种子会按当前 C++ 文件自动保存。内置 n、n+数组、n m、边表、查询、多测、树、带权树、图、排列和字符串模板。

界面可搭建的典型输入结构：

```text
第 1 行  [n: 1~100] [q: 1~100]
第 2 行  [a: 长度 n，元素 1~1000]
重复 q 次
  第 1 行  [l: 1~n] [r: l~n]
```

原有 DSL parser 仍保留在 Rust Core，用于兼容和未来的高级导入/导出，但默认界面和结构化生成路径不再拼接或解析 DSL 字符串。

## 下一批

Batch 7 将实现 GDB 图形化调试；Stress 与其他高级能力仍保持后续边界。
