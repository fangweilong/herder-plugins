# Herdr 插件集

给 **Herdr 桌面版 app**（`herdrdev/herdr-app`，不是旧的独立终端）用的 mod。每个插件互相独立，
按需安装；插件之间只有一处已知的覆盖关系，见下文。

| 插件 | 作用 | 文档 |
| --- | --- | --- |
| **zh-cn** | 简体中文界面，附带「快捷键」设置页与 solarized 主题 | [zh-cn/README.md](zh-cn/README.md) |
| **files-plus** | 文件面板增加「在 VS Code 中打开」（项目、当前文件、文件行） | [files-plus/README.md](files-plus/README.md) |
| **git-workbench** | 提交历史、变更、分支、对比与 blame，取代原生「更改」面板 | [git-workbench/README.md](git-workbench/README.md) |
| **quick-commands** | `Ctrl+Shift+R` 命令模板面板，把命令发送到当前终端 | [quick-commands/README.md](quick-commands/README.md) |

## 环境要求

- Herdr 桌面版已安装并至少启动过一次（会生成 `~/.config/herdr-app`）；
- `herdr-app` 在 `PATH` 中；Windows 默认位于
  `%LOCALAPPDATA%\Programs\herdr-app\herdr-app.exe`；
- Windows 用 PowerShell（优先 `pwsh` 7，Windows PowerShell 5.1 也可）；
  macOS / Linux 用 `sh`。`git-workbench` 与 `quick-commands` 的安装脚本需要 `python3`。

## 安装

在仓库根目录执行。脚本按自身位置定位文件，与当前目录无关，可以重复运行。

Windows：

```powershell
pwsh -NoProfile -File zh-cn/install.ps1
pwsh -NoProfile -File files-plus/install.ps1
pwsh -NoProfile -File git-workbench/install.ps1
pwsh -NoProfile -File quick-commands/install.ps1
```

没有 `pwsh` 时，把 `pwsh -NoProfile -File` 换成 `powershell -ExecutionPolicy Bypass -File`。

macOS / Linux：

```sh
sh zh-cn/install.sh
sh files-plus/install.sh
sh git-workbench/install.sh
sh quick-commands/install.sh
```

安装完成后 Herdr 会热重载布局，一般不需要重启。每个脚本具体改了什么，见对应插件的 README。

## 插件之间

- 先装 **files-plus**、再重装 **zh-cn** 时，`zh.json` 会被覆盖，文件面板指回内置 `files`；
  重跑一次 `files-plus/install.ps1` 即可恢复。
- 各安装脚本只改个人布局；`layouts/main.json`、`terminals.json`、`win98.json` 是内置布局，
  不会被修改。

## 卸载

把安装命令里的 `install` 换成 `uninstall`：

```powershell
pwsh -NoProfile -File files-plus/uninstall.ps1
```

```sh
sh files-plus/uninstall.sh
```

`quick-commands` 卸载时加 `--purge`（Windows 为 `-Purge`）会连命令模板一起删除。

## 开发

- 安装、验证、卸载的完整步骤，以及 `herdr-app check` / `herdr-app status` 的用法，见
  [AGENTS.md](AGENTS.md)；
- 各插件的测试：`node --test <插件>/test/*.mjs`。

## 许可

本仓库中非第三方来源的部分按 MIT License 授权，见 [LICENSE](LICENSE)。第三方文件的出处与
许可证见 [NOTICE](NOTICE)。
