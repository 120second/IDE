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

LightCP 把竞赛中常用的编辑、编译运行、样例管理、代码模板、调试、数据生成和对拍流程集中在一个桌面应用中。界面由 Svelte 5 和 CodeMirror 6 构建，系统能力由 Tauri 2、Rust 与 SQLite 提供。

> 项目仍在持续开发，目前优先支持 Windows 10/11 和 C++ 工作流。

## 功能概览

| 模块 | 主要能力 |
| --- | --- |
| 编辑器 | 多标签、欢迎页、命令面板、会话恢复、安全批量保存/关闭、代码折叠、超大文件降级 |
| clangd | C++ 诊断、补全、悬停信息、签名帮助、跳转定义和查找引用 |
| 模板中心 | 代码片段与文件模板、嵌套分类、拖放整理、收藏、搜索、版本历史、恢复与删除历史版本 |
| 模板补全 | 在编辑器中按名称、触发词或别名查找模板；模板候选优先显示在 clangd 候选上方 |
| 工作区 | 最近目录恢复、懒加载文件树、模糊快速打开、有界跨文件搜索、安全切换目录、文件监听 |
| 编译运行 | 可配置 g++、C++17/20/23、Release/Debug 参数、stdin、超时和输出容量 |
| 测试点 | Sample、Custom、Hack 测试点，支持复制、排序、启停、单项运行和批量运行 |
| 调试器 | 基于 GDB/MI 的断点、条件断点、调用栈、局部变量、监视表达式和单步调试 |
| 随机数据 | 可视化规则树、确定性种子、数组/排列/矩阵/树/图/DAG 等生成器 |
| 对拍 | 随机生成输入并比较待测程序与暴力程序，保存首个反例，并可直接转为 Hack 或进入调试 |
| 代码归档 | 平台、题号、难度、标签、状态、收藏、智能集合和批量整理 |
| 外观 | 深浅主题、背景图片、透明度、窗口底色、侧栏/编辑区透明度及毛玻璃模糊 |

## 技术栈

- Tauri 2 + Rust：桌面窗口、文件系统、进程、SQLite、调试器与后台任务
- Svelte 5 + TypeScript + Vite：界面与状态管理
- CodeMirror 6：代码编辑器、片段占位符与补全界面
- clangd：C++ Language Server Protocol 服务
- SQLite：模板、测试点、归档、生成规则和最近工作区等持久化数据

## 环境要求

- Windows 10/11
- Node.js 20.19 或更高版本
- Rust stable（MSVC toolchain）
- Microsoft Visual Studio C++ Build Tools
- Microsoft Edge WebView2 Runtime
- g++：编译和运行 C++ 程序
- GDB：使用图形化调试功能时需要
- clangd：使用诊断、补全和代码导航时需要

g++ 和 GDB 默认从 `PATH` 查找；clangd 还会检查 LLVM 和 Visual Studio 的常见安装目录。三者都可在 LightCP 设置中填写完整路径，并直接查看实时可用性诊断。Tauri 的 Windows 环境配置可参考 [官方 prerequisites](https://v2.tauri.app/start/prerequisites/)。

## 快速开始

```powershell
git clone https://github.com/120second/IDE.git
cd IDE
npm ci
npm run tauri dev
```

只运行 `npm run dev` 会启动 Vite 网页服务，但浏览器环境不能使用 Tauri 的 Rust 后端能力；日常开发应使用 `npm run tauri dev`。

## 构建 Windows Release

```powershell
npm run tauri build
```

构建完成后，可执行文件位于：

```text
src-tauri\target\release\lightcp.exe
```

必须通过 Tauri CLI 构建可分发版本。不要直接使用 `cargo build --release` 作为桌面发行构建，否则应用可能仍尝试连接开发地址 `localhost:1420`。

当前 `tauri.conf.json` 关闭了安装包打包，因此命令只生成独立 EXE；如需 MSI/NSIS，可在发布流程中启用 Tauri bundle。

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

编辑器标签支持鼠标中键关闭和右键菜单；右键菜单可保存、保存全部、关闭当前、关闭其他或关闭全部编辑器。批量关闭时，未保存文件会集中提供“保存并关闭 / 不保存 / 取消”选择。

## 模板与编辑器补全

代码片段支持 `${1:name}`、`${2:value}` 和 `$0` 等占位符。插入后使用 `Tab` / `Shift+Tab` 在占位符之间移动。

保存模板后，可以直接在 C++ 编辑器中输入模板名称、触发词或别名：

1. LightCP 查询代码片段模板，不加载文件模板。
2. 精确触发词、精确名称和前缀匹配优先。
3. 模板结果固定显示在 clangd 候选之前。
4. 选中候选后插入完整片段并进入占位符编辑。

模板分类支持多层嵌套。分类和模板都可通过拖放调整位置或移动到其他分类；模板每次保存都会产生历史版本，默认最多保留最近 20 个版本。

## 工作区与文件安全

- 应用首次打开时不自动创建示例文件；用户选择工作区后会在下次启动时恢复该目录。
- 文件树仅先读取根目录一层，展开子目录时再按需加载。
- 文件和文件夹可以在资源管理器中拖放移动，Rust 后端会校验目标仍位于当前工作区。
- 外部修改会通过 Windows 原生 `ReadDirectoryChangesW` watcher 同步到编辑器。
- 存在未保存编辑时，外部变化会标记冲突，不会静默覆盖编辑内容。

## 本地数据

LightCP 的数据库与设置保存在 Tauri 为 `com.lightcp.ide` 解析的应用数据目录中，主要文件包括：

```text
lightcp.db
settings.json
```

工作区源文件仍保存在用户选择的目录中。数据库采用只追加 migration；模板、测试点、归档 metadata、随机生成规则等数据不会提交到本仓库。

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

进一步阅读：

- [架构说明](docs/ARCHITECTURE.md)
- [Batch 9 性能审计](docs/PERFORMANCE_REPORT_BATCH9.md)

## 设计要点

- 编辑器始终只维护一个可见 `EditorView`，每个标签保存独立 `EditorState` 和滚动位置。
- 大文件会关闭自动补全、Hover 和高成本语法装饰，但保留基础编辑及文档同步。
- 后台进程输出在 Rust 和前端两侧均设置容量上限，避免大输出无限占用内存。
- clangd、GDB、Runner 和对拍任务均由 Rust 统一管理生命周期，窗口退出时回收子进程。
- 模板列表通常只读取 metadata；编辑、插入或补全时再读取必要的代码正文。

## 参与开发

提交改动前请至少运行：

```powershell
npm run check
npm test
cargo test --manifest-path src-tauri/Cargo.toml -j 1
```

如果改动会影响桌面启动或前端资源加载，还应执行一次 `npm run tauri build` 并启动生成的 EXE 验证。
