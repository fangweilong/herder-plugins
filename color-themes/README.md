# Herdr 配色主题包

> 本目录是 [herdr-plugins](../README.md) 仓库中的一个插件。

给 Herdr 的两个深色主题，装进 `themes/` 后可在 **设置 → 主题** 里自由切换。只包含主题文件，
不含 mod，不影响快捷键与布局。

| 主题名（设置里显示） | 文件 | 说明 |
| --- | --- | --- |
| **idea new ui** | `themes/idea-new-ui.json` | IntelliJ IDEA 2026 默认 New UI（Dark） |
| **opencode black gold** | `themes/opencode-black-gold.json` | OpenCode 默认 `opencode` 主题的黑金配色 |

## 配色

### idea new ui

- 终端背景 `#1E1F22`、前景 `#BCBEC4`，选区 `#2E436E`，光标 `#CED0D6`
- 面板/侧边栏 `#2B2D30`，悬停与分隔线 `#393B40`，正文 `#DFE1E5`
- 主色（按钮、焦点、链接）`#3574F0`
- 16 色 ANSI 取自 IDEA 默认 Dark 方案的新终端调色板
- 状态色：进行中 `#D6AE58`、阻塞 `#DB5C5C`、完成 `#57965C`

### opencode black gold

- 近黑终端与编辑器背景 `#0A0A0A`，面板 `#141414`，浮层/选中项 `#1E1E1E`/`#323232`
- 正文 `#EEEEEE`，次要文字 `#808080`，分隔线 `#484848`
- 强调色（主按钮、焦点、光标）为暖金 `#FAB283`，深色文字 `#0A0A0A`
- 状态色：进行中 `#F5A742`、阻塞 `#E06C75`、完成 `#7FD88F`
- 16 色 ANSI 取自 OpenCode 的语法色与基础色；OpenCode 没有官方 ANSI 表，明亮色由同族颜色提亮

两个主题都是深色。Herdr 按背景亮度把它们分到「深色」列表；每个布局分别保存自己的
浅色/深色选择，所以在 `zh`、`main` 等布局里各切各的。

## 安装

Windows（优先 `pwsh` 7，Windows PowerShell 5.1 也可）：

```powershell
pwsh -NoProfile -File color-themes/install.ps1
```

macOS / Linux：

```sh
sh color-themes/install.sh
```

脚本只做两件事：

1. 把 `themes/*.json` 复制到 `<app home>/themes/`；
2. 打印切换方式。目标位置已有同名但内容不同的文件时，先备份为
   `<主题>.json.color-themes.bak`。

`app home` 的解析顺序：`HERDR_APP_HOME` → `$XDG_CONFIG_HOME/herdr-app` →
`~/.config/herdr-app`（Windows 下即 `%USERPROFILE%\.config\herdr-app`）。

## 切换

打开 **设置 → 主题 → 深色**，点击 **idea new ui** 或 **opencode black gold**。
Herdr 会立即应用，不需要重启。也可以用命令：

```powershell
herdr-app do app.theme --name idea-new-ui
herdr-app do app.theme --name opencode-black-gold
```

如果「外观模式」是「跟随系统」而系统当前为浅色，先点 **深色** 再选主题，否则界面上不会变化。

## 卸载

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File color-themes/uninstall.ps1
```

macOS / Linux：

```sh
sh color-themes/uninstall.sh
```

删除 `themes/idea-new-ui.json` 与 `themes/opencode-black-gold.json`。当前布局若正在使用它们，
会回退到 Herdr 的默认主题；布局里保存的主题名会保留，重新安装后又可以直接选中。

## 文件

```
color-themes/
  install.ps1, uninstall.ps1, install.sh, uninstall.sh
  themes/idea-new-ui.json          IDEA New UI（16 色 ANSI + 语义颜色）
  themes/opencode-black-gold.json  OpenCode 黑金（16 色 ANSI + 语义颜色）
  test/themes.test.mjs             结构、配色表与可读性测试（node --test）
  README.md
```

## 配色来源

- **idea new ui**：IntelliJ Community 的 `expUI_dark.theme.json`（UI 调色板与语义映射，
  如 Gray1–14、Blue6、Red7、Green6）、`expUI_darkScheme.xml`（`CARET_COLOR` 等），以及
  `DefaultColorSchemesManager.xml` 中 Darcula 方案的 `BLOCK_TERMINAL_*` 与
  `CONSOLE_NORMAL_OUTPUT` / `CONSOLE_BACKGROUND_KEY`。Apache License 2.0。
- **opencode black gold**：OpenCode v2.3.2 的
  `packages/tui/src/theme/assets/opencode.json`（`darkStep1`–`darkStep12`、`darkSecondary`、
  `darkAccent` 与语法色）。MIT License。

## 开发

```sh
node --test color-themes/test/themes.test.mjs
```

测试会遍历 `themes/*.json`，校验 16 色 ANSI、语义颜色白名单、深色分类与前景/背景对比度。
新增主题时同时更新测试里的 `expected` 表。