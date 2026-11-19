# AGENTS.md

本仓库是 **Herdr 桌面版 app** 的 mod 集合。AI 在安装、验证或卸载前先读本文件，并按这里给出
的命令直接执行；不要凭记忆猜路径或手写布局补丁。

## 通用规则

- 只修改 `~/.config/herdr-app/` 下的个人布局。`layouts/main.json`、`terminals.json`、
  `win98.json` 是内置布局，Herdr 启动时会还原，不要改。
- 不要编辑 `~/.config/herdr-app/AGENTS.md`（Herdr 生成）、`frame/` 或内置 `mods/files`。
- 不自动改 `keys.json`。需要快捷键时先问用户；改之前备份，并检查文件大小不是 0。
- 安装/卸载脚本是幂等的；重跑不会重复改布局。
- 验证用 `herdr-app check <mod 目录>`；`herdr-app status` 的 `errors` 必须为空。
  失败时报告原始输出，不要静默降级或绕过。
- 安装会删除并重建 `mods/files-plus/`，卸载会删除它；安装时会保留用户的 `hosts.json`。

## files-plus（在编辑器中打开文件/项目）

编辑器自动发现，不需要配置文件：`HERDR_EDITORS`、`VISUAL`、`EDITOR` 环境变量，加上 `PATH`
里的 `code` / `zed` / `idea` / `openidea` 等启动器；Windows 还会读取注册表里最新的用户/机器
环境变量和 PATH、扫描开始菜单快捷方式，并看卸载项的 `DisplayIcon` 找没写 PATH 的应用。
发现和启动共用同一套 PATH 合并逻辑，所以 Herdr 启动后才装进 PATH 的命令也能打开。
发现结果缓存在共享存储里，启动只读缓存；点 **项目** 直接用默认编辑器打开，右侧 **▾** 单次
选择 app。默认编辑器在 **设置 → 编辑器** 里选，那里的 **刷新** 才重新扫描。mod 运行时支持
Windows、macOS、Linux；区别只在安装器。用户要求安装时直接执行对应平台的脚本，不需要再手写
安装步骤。

### Windows

优先：

```powershell
pwsh -NoProfile -File files-plus/install.ps1
```

没有 `pwsh` 时：

```powershell
powershell -ExecutionPolicy Bypass -File files-plus/install.ps1
```

### macOS / Linux

```sh
sh files-plus/install.sh
```

脚本要求 `herdr-app` 在 `PATH` 中；找不到时报告实际路径问题，不要改成手工复制绕过。

### 安装脚本做什么

1. 把 `files-plus/` 复制到 `<app home>/mods/files-plus/`；
2. 保留已有的 `hosts.json`，删除测试、`.d.ts`、安装脚本等开发文件；
3. 运行 `herdr-app check`；
4. 把**个人布局**里 `content.mod` 的 `"files"` 改成 `"files-plus"`，原文件备份为
   `*.files-plus.bak`；
5. 打印可选的 `keys.json` 快捷键，但不写入。

`app home` 的解析顺序：`HERDR_APP_HOME` → `$XDG_CONFIG_HOME/herdr-app` →
`~/.config/herdr-app`（Windows 下即 `%USERPROFILE%\.config\herdr-app`）。

### 验证

Windows：

```powershell
$app = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME }
       elseif ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "herdr-app" }
       else { Join-Path $env:USERPROFILE ".config\herdr-app" }
$herdr = (Get-Command herdr-app -ErrorAction SilentlyContinue).Source
if (-not $herdr) { $herdr = Join-Path $env:LOCALAPPDATA "Programs\herdr-app\herdr-app.exe" }
& $herdr check (Join-Path $app "mods\files-plus")
& $herdr status
node --test files-plus/test/uri.test.mjs files-plus/test/launch.test.mjs files-plus/test/editors.test.mjs files-plus/test/settings.test.mjs
```

macOS / Linux：

```sh
app_home=${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}
herdr-app check "$app_home/mods/files-plus"
herdr-app status
node --test files-plus/test/uri.test.mjs files-plus/test/launch.test.mjs files-plus/test/editors.test.mjs files-plus/test/settings.test.mjs
```

`check` 应输出 `check passed`；`status` 的 `errors` 应为空。布局热重载后，文件面板标题栏应出现
**项目** 和右侧 **▾**；点 **项目** 应直接用默认编辑器打开，点 **▾** 应列出发现的编辑器，
选择后只用它打开这一次。预览文件后出现默认编辑器名称的按钮。打开 **设置** 应看到「编辑器」
页，可点选默认编辑器并刷新。Herdr 启动时会还原 `frame/`，设置页由文件面板初始化时重新注入；
若锚点缺失，应弹出「编辑器设置页加载失败」，且 `status` 的 `errors` 仍为空。

### 卸载

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File files-plus/uninstall.ps1
```

macOS / Linux：

```sh
sh files-plus/uninstall.sh
```

脚本把个人布局里的 `"files-plus"` 改回 `"files"`（备份为 `*.files-plus-uninstall.bak`），
然后删除 `mods/files-plus/`。

### 常见问题

- **没有个人布局引用 `files`**：脚本会提示。不要改内置布局；让用户在自定义布局或 `zh.json`
  里把 `content.mod` 改成 `"files-plus"`，或先切换到个人布局。
- **按钮打不开编辑器**：列表里是已缓存或刚发现的编辑器。Windows 上点 **▾ → 刷新编辑器列表**
  或 **设置 → 编辑器 → 刷新**，会重新读取注册表里最新的环境变量/PATH、开始菜单和卸载项；
  macOS / Linux 在 Herdr 启动后新增的 PATH 需要重启 Herdr 才能看到，或用 `HERDR_EDITORS`
  指向启动器的完整路径。Zed / IDEA / OpenIDEA 需要各自的命令行启动器或应用可执行文件。
  命令不存在时面板会弹出带原始信息的错误通知，不要改成静默回退。
- **设置里没有「编辑器」页**：Herdr 启动时会还原 `frame/`，设置页由文件面板初始化时注入。
  确认 `zh.json` 等个人布局确实引用 `files-plus`，并看有没有「编辑器设置页加载失败」通知；
  失败时报告 `frame/settings/main.js` 的实际结构，不要手写补丁绕过。
- **重装 zh-cn 后按钮消失**：zh-cn 会覆盖 `zh.json`，把面板指回 `files`。重跑 files-plus 的
  安装脚本即可。
- **`herdr-app` 不在 PATH**：Windows 默认在
  `%LOCALAPPDATA%\Programs\herdr-app\herdr-app.exe`；macOS 可能在
  `/Applications/Herdr.app/Contents/MacOS/herdr-app`；也可以直接用绝对路径。
- **远程机器**：Host 来自 `hc machine ls --json` 的 `target`；经中转或需要换 Host 时，在
  `mods/files-plus/hosts.json` 写 `{"<machine>": "<ssh Host>"}`。不要删除这个文件。

## 其他插件

`git-workbench`、`quick-commands` 都有 Windows PowerShell 和 POSIX shell
安装器。Windows 没有 `pwsh` 时，把 `pwsh -NoProfile -File` 换成
`powershell -ExecutionPolicy Bypass -File`。POSIX 脚本需要 `python3`（或可用的 `python`）来安全
改写 `keys.json` / 布局；`herdr-app` 优先从 `PATH` 或 `HERDR_APP_BIN` 查找，macOS 还会尝试
`/Applications/Herdr.app/Contents/MacOS/herdr-app`。

### git-workbench

Windows：

```powershell
pwsh -NoProfile -File git-workbench/install.ps1
```

macOS / Linux：

```sh
sh git-workbench/install.sh
```

会把 `shared.json` 指定活动布局里 `id` 为 `changes` 的 `content` 改成
`{"mod":"git-workbench","props":{"view":"changes"}}`，原布局备份为
`<layout>.json.git-workbench.bak`。卸载：

```powershell
powershell -ExecutionPolicy Bypass -File git-workbench/uninstall.ps1
```

```sh
sh git-workbench/uninstall.sh
```

### quick-commands

Windows：

```powershell
pwsh -NoProfile -File quick-commands/install.ps1
```

macOS / Linux：

```sh
sh quick-commands/install.sh
```

在 `keys.json` 的 `global` 中加 `ctrl-shift-r` → `mod.open:quick-commands`；已被占用时不覆盖。
卸载：

```powershell
powershell -ExecutionPolicy Bypass -File quick-commands/uninstall.ps1
```

```sh
sh quick-commands/uninstall.sh          # 加 --purge 删除命令模板
```

`zh-cn/` 已有 `install.ps1` / `install.sh` / `uninstall.ps1` / `uninstall.sh`，见其 README。

各插件的完整说明以对应目录的 `README.md` 为准。
