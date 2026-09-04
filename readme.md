# PlotBetter

> 个人 Windows 研究桌面助手，把 daily 笔记、任务、论文推送、测验和日常工具收进一个可停靠在屏幕边缘的浮窗。
> 当前版本：`v0.1.0`，技术预览版。

---

## 中文

### 这是什么

PlotBetter（PB）是一款 **Windows 桌面小助手**，适合个人研究、论文阅读和日常记录。它以 `data/daily.txt` 这个普通 Markdown 笔记为主入口，配合本机 SQLite 文件记录任务历史、收支、菜谱、论文和测验数据。

主要特点：

- 边缘浮窗：闲置时停在屏幕左/右边缘，鼠标靠近后展开，也可固定打开。
- 本地优先：笔记、任务和大部分数据保存在本机 `data/` 文件夹，不依赖云端账号。
- 无需每次输入命令：`PlotBetter.exe` 可以直接启动，也可使用桌面/开始菜单快捷方式。
- 面向研究：按主题推荐 arXiv 论文、做认知测验、关联 Zotero 文献库。

更详细的图文使用说明见 **[使用说明.md](./使用说明.md)**。

### 功能一览

| 模块 | 说明 |
|------|------|
| Daily Note | 在应用内直接编辑 `data/daily.txt`，自动保存约 1 秒，也可用记事本打开 |
| Tasks | 左栏 Today 来自 daily 笔记的任务；右栏 Backlog 为独立待办清单，可移到 Today |
| All Tasks | 已完成任务按日期归档，可删除历史记录 |
| Finance | 记录收入/支出，按月汇总结余 |
| Recipes | 4×2 菜谱卡片网格，悬停预览，点击编辑可自定义字段 |
| Topics | 管理 `@topic:` 研究主题，与 daily 笔记双向同步 |
| Today's Paper | 每个主题每天推荐一篇 arXiv 论文，可标记 Too hard / Just right / Too easy |
| Quiz | 按主题出选择题，答案会更新该主题认知等级（1 至 5） |
| Edge Widget | 吸附屏幕左/右边缘，悬停展开，可固定；关窗后继续在系统托盘运行 |
| Zotero | 可选的文献集成：跳过已有论文、在 Zotero 中打开 PDF、Just right 后自动入库 |
| Startup | Settings 中可开启 Windows 开机自启，启动后仅托盘运行 |

### 快速开始

普通用户：

1. 确认已安装 [Node.js](https://nodejs.org/)（首次安装依赖时需要）。
2. 双击 **`PlotBetter.exe`**，或双击桌面/开始菜单里的 **PlotBetter** 快捷方式。
3. 若 `node_modules` 尚未安装，启动器会询问是否自动安装依赖。
4. 托盘区出现 PB 图标后，双击图标可重新打开窗口。
5. 完全退出：右键托盘图标 → **Quit**。

`run.bat` 保留为备用启动方式。需要重建快捷方式时运行：

```powershell
D:\PlotBetter\PlotBetter.exe --install-shortcut
```

删除快捷方式：

```powershell
D:\PlotBetter\PlotBetter.exe --remove-shortcut
```

> 说明：当前 `PlotBetter.exe` 是启动器形态，它调用项目 `node_modules` 中的 Electron，因此请保持 exe 位于项目根目录。

### 写 daily 笔记

默认文件：`data/daily.txt`

```text
@topic: machine learning
@topic: attention mechanism

- [ ] Read today's paper
- [ ] Take the quiz
```

语法约定：

- `@topic: 主题名`：论文推荐和 Quiz 使用的主题。
- `- [ ]`：未完成任务。
- `- [x]`：已完成任务，勾选后同步写回文件并进入历史。
- 在应用内编辑或在记事本中修改均可，文件变化会自动同步。

### Settings 要点

- **Startup**：开启 *Launch PlotBetter when Windows starts* 后，登录 Windows 时自动进入托盘。
- **Floating widget**：选择停靠 **Left** 或 **Right**；固定/展开状态会自动保存。
- **Quiz language**：`auto` 会在低等级时显示中英双语，等级提高后逐步切换为英文。
- **Zotero**：填写 User ID 与 API Key，测试通过后保存。
  - 建议在 Zotero → 设置 → 高级中勾选 *Allow other applications on this computer to communicate with Zotero*。

### 数据位置

| 文件/文件夹 | 内容 | 建议 |
|------|------|------|
| `data/daily.txt` | daily 笔记、任务、主题 | 定期备份 |
| `data/config.json` | 配置、Zotero API Key、自启动设置 | 含敏感 Key，勿公开分享 |
| `data/plotbetter.db` | 任务历史、收支、菜谱、论文、测验记录 | 应用退出后备份更安全 |
| `data/daily_paper/` | 论文 PDF 缓存 | 磁盘空间不足时可清理 |
| `data/VLA_learning/` 等 | 主题资料 PDF | 由用户自己维护 |

最简单的备份方式：先完全退出 PB（托盘 → Quit），再复制整个 `data/` 目录。

### 项目结构

| 路径 | 作用 |
|------|------|
| `main.js` | Electron 主进程：窗口、托盘、文件监听、IPC、业务编排 |
| `preload.js` | 通过 `contextBridge` 暴露给渲染进程的安全 API |
| `renderer.js` | 渲染进程交互逻辑 |
| `index.html` / `styles.css` | 界面结构、样式和浮窗动画 |
| `src/config.js` | 路径、配置读写 |
| `src/database.js` | SQLite/sql.js 数据层：历史、收支、菜谱、论文、测验 |
| `src/parser.js` | daily 文件解析与任务/主题同步 |
| `src/papers.js` | arXiv Atom 抓取、推荐与评分 |
| `src/quiz.js` | 题目生成与语言策略 |
| `src/zotero.js` | Zotero API、本地库去重、PDF 打开 |
| `src/widgetWindow.js` | 浮窗尺寸、停靠和动画 |
| `src/autoLaunch.js` | Windows 自启动管理 |
| `scripts/` | 打包图标、编译启动器、创建快捷方式等辅助脚本 |
| `launcher/PlotBetter.cs` | `PlotBetter.exe` 启动器源码 |

### 开发与构建

```powershell
npm install
npm start
```

重新生成图标和启动器：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-icon.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-launcher.ps1
```

重新安装桌面/开始菜单快捷方式：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-shortcuts.ps1
```

### 常见问题

**改了 daily.txt 但界面没有更新？**

点击左下角 **Refresh**，或等 1 至 2 秒让文件监听生效。

**论文搜不到？**

把主题改为更常见的英文学术词，例如 `deep learning`，避免过窄的中文译名。

**没有网络可以用吗？**

可以。Tasks、Daily Note、Finance、Recipes 等均离线可用；论文推荐和 Zotero 需要网络。

**如何退出？**

关闭窗口只是回到托盘。右键托盘图标 → **Quit** 才会真正退出。

---

## Roadmap / 更新计划

下面的计划按短期、中期和远期划分。属于开发方向，不代表固定交付承诺，实际顺序会按需求调整。

| 版本/阶段 | 内容 | 状态 |
|------|------|------|
| v0.1 当前版 | Daily Note、Tasks、Finance、Recipes、Topics、Today's Paper、Quiz、Edge Widget、Zotero、自启动、exe 启动器与快捷方式 | 已完成 |
| v0.2 短期 | Electron Builder 独立安装包/便携版，不再要求项目内 Node 依赖 | 计划中 |
| v0.2 短期 | 多 daily 文件支持与快速切换 | 计划中 |
| v0.2 短期 | 按 `pushHour` 定时推送论文并使用 Windows 桌面通知 | 计划中 |
| v0.2 短期 | 数据导入/导出、一键备份与恢复 | 计划中 |
| v0.3 中期 | AI 论文摘要、中文导读与个性化解释 | 探索中 |
| v0.3 中期 | Obsidian 等 Markdown 知识库联动 | 探索中 |
| v0.3 中期 | 阅读统计、习惯追踪和更多统计图表 | 探索中 |
| 远期 | 多设备同步、Web/移动端 companion | 暂未排期 |

建议优先参与/验证的功能：

- 独立安装包：解决当前 exe 依赖项目目录的问题。
- 定时论文提醒：让 PB 真正成为每天自动出现的阅读入口。
- 数据导出/恢复：为后续多设备同步打基础。
- Obsidian 联动：把 daily 笔记和论文卡片变成可复用的个人知识库。

---

## English

### Overview

PlotBetter (PB) is a Windows desktop companion for personal research and daily planning. It combines a plain-text daily note, tasks, finance tracking, recipes, arXiv paper recommendations, quizzes, and an optional Zotero workflow inside a screen-edge widget.

All application data stays under the local `data/` folder. Paper search and Zotero features need network access; local notes and records do not.

### Quick start

1. Install [Node.js](https://nodejs.org/) (required only for the first dependency install).
2. Double-click **`PlotBetter.exe`**, or the **PlotBetter** desktop/Start Menu shortcut.
3. On first run, the launcher offers to run `npm install` when dependencies are missing.
4. The PB tray icon appears after launch. Double-click it to reopen the window.
5. To quit completely, use the tray menu → **Quit**.

Fallback launch commands:

```bat
cd D:\PlotBetter
npm install
npm start
```

### Daily note format

File: `data/daily.txt`

```text
@topic: machine learning
@topic: attention mechanism

- [ ] Read today's paper
- [ ] Take the quiz
```

- `@topic: name` defines research topics used for papers and quizzes.
- `- [ ]` marks a pending task; `- [x]` marks it done and archives it.

### Key files

| Path | Purpose |
|------|---------|
| `data/daily.txt` | Daily note, tasks, topics |
| `data/config.json` | App and Zotero settings, API key |
| `data/plotbetter.db` | Task history, finance, recipes, papers, quiz records |
| `data/daily_paper/` | Cached paper PDFs |

### Roadmap

- v0.1 (current): daily note, tasks/backlog, finance, recipes, topics, paper push, quiz, edge widget, Zotero, auto-start, exe launcher and shortcuts.
- v0.2 (near term): Electron Builder installer/portable build, multiple daily files, scheduled paper notifications using `pushHour`, data export/backup.
- v0.3 (mid term): AI paper summaries and Chinese guides, Obsidian/Markdown integration, reading statistics and habit tracking.
- Long term: cross-device sync and a web/mobile companion.

For the full Chinese guide, see **[使用说明.md](./使用说明.md)**.
