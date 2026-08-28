<div align="center">
  <img src="assets/lightcp-icon.svg" width="88" alt="LightCP logo" />
  <h1>LightCP</h1>
  <p>面向算法竞赛的 Windows 轻量级 C++ IDE</p>
  <p>
    <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-0078D4?logo=windows" />
    <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri" />
    <img alt="Svelte 5" src="https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white" />
    <img alt="Rust" src="https://img.shields.io/badge/backend-Rust-000000?logo=rust" />
  </p>
</div>

LightCP 是一款面向算法竞赛的桌面 IDE。写代码、编译运行、管理样例、调试、生成数据和对拍都可以在同一个应用里完成，不必在几套工具之间反复切换。界面使用 Svelte 5 和 CodeMirror 6，文件、进程和本地数据则由 Tauri 2、Rust 与 SQLite 处理。

> 项目还在开发中。目前主要打磨 Windows 10/11 下的 C++ 竞赛工作流，其他平台暂不在优先范围内。

## 功能概览

| 模块 | 目前支持 |
| --- | --- |
| 编辑器 | 多标签、欢迎页、命令面板、会话恢复、安全批量保存/关闭、代码折叠、超大文件降级 |
| clangd | C++ 诊断、补全、悬停信息、签名帮助、跳转定义和查找引用 |
| 模板中心 | 代码片段与文件模板、嵌套分类、拖放整理、收藏、搜索、版本历史、恢复与删除历史版本 |
| 模板补全 | 在编辑器中按名称、触发词或别名查找模板；模板候选优先显示在 clangd 候选上方 |
| 工作区 | 最近目录恢复、懒加载与自动显露文件树、面包屑导航、模糊快速打开、安全切换目录、文件监听 |
| 编译运行 | 可配置 g++、C++17/20/23、Release/Debug 参数、stdin、超时和输出容量 |
| 测试点 | Sample、Custom、Hack 测试点，支持复制、排序、启停、单项运行和批量运行 |
| 调试器 | 基于 GDB/MI 的断点、条件断点、调用栈、局部变量、监视表达式和单步调试 |
| 随机数据 | 可视化规则树、确定性种子、数组/排列/矩阵/树/图/DAG 等生成器 |
| 对拍 | 随机生成输入并比较待测程序与暴力程序，保存首个反例，并可直接转为 Hack 或进入调试 |
| 代码归档 | 平台、题号、难度、标签、状态、收藏、智能集合和批量整理 |
| 外观 | 系统/深浅模式、三套内置配色、自定义主题工作室、语义色与代码高亮、界面密度和编辑器字体 |

## 技术组成

- Tauri 2 + Rust 负责桌面窗口、文件系统、进程、SQLite、调试器和后台任务。
- Svelte 5、TypeScript 与 Vite 负责界面和状态管理。
- CodeMirror 6 提供代码编辑、片段占位符和补全界面。
- clangd 提供 C++ 诊断、补全与代码导航。
- SQLite 保存模板、测试点、归档、生成规则和最近工作区等本地数据。

## 环境要求

- Windows 10/11
- Node.js 20.19 或更高版本
- Rust stable（MSVC toolchain）
- Microsoft Visual Studio C++ Build Tools
- Microsoft Edge WebView2 Runtime
- g++：编译和运行 C++ 程序
- GDB：使用图形化调试功能时需要
- clangd：使用诊断、补全和代码导航时需要

LightCP 默认从 `PATH` 查找 g++ 和 GDB。clangd 除了 `PATH`，还会检查 LLVM 与 Visual Studio 的常见安装目录。如果自动查找失败，可以在设置中填写三个工具的完整路径，并在那里查看可用性诊断。Windows 环境的准备方法见 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)。

## 快速开始

```powershell
git clone https://github.com/120second/IDE.git
cd IDE
npm ci
npm run tauri dev
```

开发桌面端时请使用 `npm run tauri dev`。`npm run dev` 只会启动 Vite 网页服务，浏览器里无法调用 Tauri 提供的 Rust 后端。

## 构建 Windows Release

```powershell
npm run tauri build
```

构建完成后，可执行文件位于：

```text
src-tauri\target\release\lightcp.exe
```

发布版本需要通过 Tauri CLI 构建。不要用 `cargo build --release` 代替上面的命令，否则生成的程序可能仍会尝试连接开发地址 `localhost:1420`。

当前 `tauri.conf.json` 没有启用安装包，所以构建结果是一个独立 EXE。需要 MSI 或 NSIS 时，再在发布配置中开启 Tauri bundle。

## 检查与测试

```powershell
# Svelte 与 TypeScript 静态检查
npm run check

# 前端单元测试
npm test

# 前端生产构建
npm run build

# Rust 测试
cargo test --manifest-path src-tauri/Cargo.toml -j 1

# Rust 格式检查
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check

# Rust 静态质量检查
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

# 手动性能/压力审计
cargo test --manifest-path src-tauri/Cargo.toml --test performance_audit -- --ignored --test-threads=1

# 完整桌面 Release
npm run tauri build
```

## 常用快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+S` | 保存当前文件 |
| `Ctrl+N` | 在工作区中新建 C++ 文件 |
| `Ctrl+P` | 按文件名快速打开 |
| `Ctrl+Shift+P` | 打开命令面板 |
| `Ctrl+W` | 关闭当前编辑器（未保存时询问） |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 切换下一个 / 上一个编辑器 |
| `Ctrl+K`，然后 `S` | 保存全部已修改文件 |
| `Ctrl+B` | 显示或隐藏侧栏 |
| `Ctrl+J` | 显示或隐藏底部面板 |
| `Ctrl+K`，然后 `Z` | 进入或退出 Zen Mode |
| `Escape` | 退出 Zen Mode |
| `Ctrl+F` | 在编辑器中搜索 |
| `Ctrl+Alt+T` | 打开代码片段快速搜索 |
| `Ctrl+Shift+A` | 归档当前 C++ 文件 |
| `F5` | 编译并运行当前文件 |
| `F6` | 运行当前文件的全部已启用测试点 |
| `F12` | 跳转到定义 |
| `Shift+F12` | 查找引用 |
| `Ctrl+Shift+Space` | 显示函数签名帮助 |
| `Ctrl+Z` / `Ctrl+Y` | 撤销 / 重做 |
| `F2` / `Delete`（文件树聚焦时） | 重命名 / 删除所选文件或文件夹 |

编辑器标签可以用鼠标中键关闭，也有右键菜单。菜单里可以保存文件，或关闭当前、其他、全部编辑器。一次关闭多个标签时，未保存的文件会集中询问，不会逐个弹窗打断操作。

## 模板与编辑器补全

代码片段支持 `${1:name}`、`${2:value}` 和 `$0` 等占位符。插入后使用 `Tab` / `Shift+Tab` 在占位符之间移动。

保存模板后，在 C++ 编辑器里输入模板名称、触发词或别名即可调用补全。匹配顺序如下：

1. LightCP 查询代码片段模板，不加载文件模板。
2. 精确触发词、精确名称和前缀匹配优先。
3. 模板结果固定显示在 clangd 候选之前。
4. 选中候选后插入完整片段并进入占位符编辑。

模板分类可以多层嵌套，分类和模板都能通过拖放调整顺序或移动位置。每次保存模板都会留下一个历史版本，默认保留最近 20 个。

## 工作区与文件安全

- 第一次打开应用时不会自动创建示例文件。选好工作区后，下次启动会恢复该目录。
- 文件树启动时只读取根目录一层，展开目录后才继续加载。切换编辑器时，文件树会自动展开到当前文件。
- 面包屑会显示当前文件在工作区中的位置；点击其中的目录，可以在资源管理器里定位到对应节点。
- 文件和文件夹支持拖放移动。Rust 后端会检查目标路径，确保操作没有越出当前工作区。
- Windows 原生 `ReadDirectoryChangesW` watcher 会把磁盘上的改动同步给编辑器。
- 如果文件还有未保存的编辑，外部改动只会标记为冲突，不会直接覆盖当前内容。

## 本地数据

LightCP 把数据库和设置保存在 `com.lightcp.ide` 对应的 Tauri 应用数据目录中，主要有两个文件：

```text
lightcp.db
settings.json
```

工作区源文件始终留在用户选择的目录中。数据库 migration 只追加、不回写历史；模板、测试点、归档元数据和随机生成规则也都属于本地数据，不会提交到仓库。

## 项目结构

```text
LightCP/
├─ src/                 # Svelte / TypeScript 前端
├─ src-tauri/           # Rust Core、Tauri commands 与配置
├─ docs/                # 架构及性能审计文档
├─ assets/              # 项目资源
├─ package.json
└─ README.md
```

更多文档：

- [架构说明](docs/ARCHITECTURE.md)
- [Batch 9 性能审计](docs/PERFORMANCE_REPORT_BATCH9.md)

## 实现上的取舍

- 编辑器始终只维护一个可见 `EditorView`，每个标签保存独立 `EditorState` 和滚动位置。
- 打开大文件时会停用自动补全、悬停信息和开销较高的语法装饰，但基础编辑和文档同步仍可使用。
- 后台进程输出在 Rust 和前端两侧均设置容量上限，避免大输出无限占用内存。
- clangd、GDB、Runner 和对拍任务均由 Rust 统一管理生命周期，窗口退出时回收子进程。
- 模板列表平时只读取元数据；真正编辑、插入或补全时，才加载所需的代码正文。

## 参与开发

提交代码前，至少跑完下面三项：

```powershell
npm run check
npm test
cargo test --manifest-path src-tauri/Cargo.toml -j 1
```

如果改动涉及桌面启动或前端资源加载，还要执行一次 `npm run tauri build`，并实际启动生成的 EXE。
