# 文件+

给 **Herdr App** 的文件面板加「在编辑器中打开」。不需要配置文件：第一次使用时自动发现
环境变量和 `PATH` 里的编辑器，之后直接读缓存；点标题栏的 **项目** 用默认编辑器打开，
右侧 **▾** 只对这一次打开选择 app。

- 标题栏 **项目**：直接用默认编辑器打开当前项目（git 根，否则当前终端目录）；
- **项目** 右侧 **▾**：选择这次用哪个 app 打开项目，不改变默认；
- **设置 → 编辑器**：选择默认编辑器，点 **刷新** 重新扫描环境变量、开始菜单和卸载项；
- 预览头部 **编辑器名**：打开**当前预览的文件**，用默认编辑器；
- 文件行右侧 `↗`：打开该文件；
- 文件行右键：同样的快捷打开，不弹菜单；
- 可选快捷键：`files-plus.open-in-editor` 打开当前文件，`files-plus.open-project` 打开当前项目。

其余行为与内置 `files` 一致：跟随当前终端目录、展开文件夹、Git 状态标记、只读预览与语法高亮。

## 安装

mod 本身支持 Windows、macOS、Linux；区别只在安装器。

Windows（优先 PowerShell 7）：

```powershell
cd files-plus
pwsh -NoProfile -File install.ps1
```

没有 `pwsh` 时：

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

macOS / Linux：

```sh
cd files-plus
./install.sh
```

macOS / Linux 需要 `herdr-app` 在 `PATH` 中。

脚本会：

1. 复制 mod 到 `~/.config/herdr-app/mods/files-plus/`；
2. 运行 `herdr-app check`；
3. 把 `layouts/` 下**个人布局**里 `content.mod` 的 `"files"` 改成 `"files-plus"`（`main` / `terminals` / `win98` 是内置布局，保持不动）。

脚本是幂等的，重跑会保留用户的 `hosts.json`。

手动安装：复制本目录到 `~/.config/herdr-app/mods/files-plus/`（去掉 `gpui-kit.d.ts`、`jsconfig.json`、`test/`、脚本、`AGENTS.md` 和 README），然后把布局里的 `"mod": "files"` 改成 `"mod": "files-plus"`。

给 AI 读取的完整安装/验证步骤见仓库根目录的 [`AGENTS.md`](../AGENTS.md)。

## 编辑器从哪来

第一次使用时（或手动点 **刷新** 时）用一次本机命令同时读取环境变量、开始菜单和 `PATH`，
顺序如下：

1. `HERDR_EDITORS`：显式列表，逗号或分号分隔，每项是一个命令名或可执行文件的完整路径，例如
   `code,zed,idea`；
2. `VISUAL`：取命令行的第一个词，后面的参数忽略；
3. `EDITOR`：同上；
4. `PATH` 里能直接找到的已知命令：`code`、`code-insiders`、`cursor`、`zed`、`zed-preview`、
   `idea`、`idea64`、`openidea`、`subl`。

Windows 上还会做三件额外的事，用来发现「装完 Herdr 之后才装」的编辑器：

- 从注册表读取最新的用户/机器环境变量和 `PATH`，不只依赖 Herdr 启动时的快照；
- 扫描开始菜单快捷方式，解析 `.lnk` 的目标程序；
- 扫描卸载项里的 `DisplayIcon`，找到没写 PATH、也没有开始菜单项的应用（例如 OpenIDEA
  默认装在 `C:\apps\OpenIDEA\openidea.exe`）。

发现结果缓存在 Herdr 的共享存储（`files-plus.editors`）里，启动时直接读取，不会每次点击都
重新扫描。**发现和启动共用同一套 PATH 规则**：两边都会合并注册表里最新的机器/用户 PATH，
所以 Herdr 启动后才加入 PATH 的 `openidea` 既能被发现，也能被启动。Windows 上新装编辑器后，
点 **▾ → 刷新编辑器列表** 或 **设置 → 编辑器 → 刷新** 即可看到，不需要重启 Herdr。
macOS / Linux 的 `PATH` 是进程启动时的快照，装完新编辑器需要重启 Herdr，或用
`HERDR_EDITORS` 指向完整路径。

OpenIDEA 自己的 `openidea` 命令是可选的：应用内 `Tools → Install 'openidea' Command` 会创建
`openidea.cmd` 并加入用户 PATH；不安装也能用，插件会直接启动应用的可执行文件。

同名编辑器只保留第一次出现的项。一个都没发现时，面板保留 VS Code 作为兜底并显示原因；
真的没有 `code` 命令时，打开会给出明确错误。

默认编辑器按 id 记在 Herdr 的共享存储（`files-plus.editor`）里，重启后仍然有效。之后点
**项目**、文件行 `↗`、右键或快捷键，都用这个默认编辑器；标题栏 **▾** 里的选择只影响
当前这一次打开。

### 设置环境变量

Windows 上可以用：

```powershell
setx HERDR_EDITORS "code,zed,idea"
```

然后点 **▾ → 刷新编辑器列表**（或 **设置 → 编辑器 → 刷新**）即可，不需要重启 Herdr：
发现脚本会读取注册表里最新的用户/机器环境变量。macOS / Linux 上如果在 shell 配置里
`export`，从 Dock 启动的 Herdr 不会继承；可以从终端启动 Herdr，或用 `launchctl setenv`
等方式写入 GUI 会话，或重启 Herdr 后再刷新。不设置也能用：只要命令在 `PATH` 里就会被发现。

JetBrains IDE 需要先创建命令行启动器（Toolbox 或 `Tools → Create Command-line Launcher`）。
Linux 桌面启动的 Herdr 可能拿不到 shell 里的 `PATH`；这时用 `HERDR_EDITORS` 指向启动器的完整
路径最稳。

## 远程文件

远程位置目前只内建 **VS Code Remote-SSH**：窗口在本机，内容留在远端，远端的 `~/.vscode-server`
首次会自动安装。项目按钮走 `--folder-uri`，文件按钮走 `--file-uri`。Host 从
`hc machine ls --json` 的 `target` 读取。

若机器是经中转连接的，或你希望用另一个 ssh Host，在 `~/.config/herdr-app/mods/files-plus/hosts.json` 里覆盖：

```json
{ "workbox": "workbox-lan" }
```

远程项目下，**项目** 和 **▾** 里只有 VS Code 可以点；Zed、IDEA 等会标为「不支持远程」，并说明
原因，不会把远端路径当成本机路径打开。

## 卸载

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File uninstall.ps1
```

macOS / Linux：

```sh
./uninstall.sh
```

个人布局会改回内置 `files`，并删除 `mods/files-plus/`。

## 使用

- 标题栏的 **项目** 按钮始终可用：优先打开 `git rev-parse --show-toplevel`，不是仓库时打开当前终端目录；
- **项目** 直接用默认编辑器打开；右侧 **▾** 展开编辑器列表，点某一项只用它打开这一次，
  不改变默认；
- **设置 → 编辑器**：点一行设为默认；**刷新** 重新扫描环境变量、开始菜单和卸载项；
- 点文件预览后，标题栏出现当前默认编辑器名称的按钮，点击打开当前文件；
- 文件行右侧的 `↗` 随时可以打开，不需要先预览；
- 右键文件行与 `↗` 等价；
- 想用快捷键，把下面几行合并进 `keys.json` 的 `global`：

```json
{
  "ctrl-shift-g": "files-plus.open-in-editor",
  "ctrl-shift-alt-g": "files-plus.open-project"
}
```

`open-project` 直接用默认编辑器打开。`nextCommand` 只在面板已经实例化时接收按键；
如果面板被移出布局，快捷键不会生效。

## 限制

- **没有行号**：`EditorState` 不暴露光标位置，只能打开到文件顶部。
- **依赖编辑器的命令行启动器**：Zed 需要安装 `zed` CLI；IntelliJ IDEA 需要创建命令行启动器。
  不在 `PATH` 时用 `HERDR_EDITORS` 写完整路径。命令不存在且没有协议链接兜底时，会弹错误提示。
- **Windows 启动方式**：通过 PowerShell 的 `Start-Process` 启动，避免 `exec` 等 GUI 进程；
  `.cmd` / `.bat` 启动器的控制台窗口以隐藏方式启动，直接启动 `.exe` 时不改窗口样式，
  避免把编辑器主窗口一起隐藏。
- **远程只内建支持 VS Code**：其他编辑器在远程项目下不可选。
- **不跟上游自动更新**：文件树和预览逻辑来自 Herdr 0.1.13 的 `mods/files`。Herdr 升级后，若内置文件面板改了行为，需要对照上游 `defaults/mods/files/main.js` 同步本目录的 `main.js`。
- **设置页是注入的**：Herdr 启动时会还原 `frame/`，插件在文件面板初始化时把「编辑器」页写入
  `frame/settings/`。Herdr 改版导致锚点缺失时会弹出「编辑器设置页加载失败」，不会写坏设置界面；
  此时仍可用 **▾ → 刷新编辑器列表**。
- **重新安装 zh-cn 语言包会覆盖 `zh.json`**，把面板指回内置 `files`；重跑本目录的安装脚本（Windows `install.ps1`，macOS/Linux `install.sh`）即可。
- 右键是直接打开，不是菜单。需要「打开 / 复制路径 / 在文件管理器中显示」的完整右键菜单时再加。

## 文件

```
files-plus/
  main.js            文件面板（基于内置 files，增加打开动作、默认编辑器和下拉选择）
  editor.js          发现编辑器、解析 Remote-SSH Host、启动编辑器
  editors.js         纯函数：命令归一化、发现结果合并、缓存解析、参数模板（有测试）
  windows-env.js     纯函数：发现和启动共用的注册表环境变量/PATH 合并（有测试）
  settings.js        设置 → 编辑器页：默认编辑器与刷新
  settings-install.js 启动时把设置页注入 frame/settings/
  settings-patch.js  纯函数：设置界面注入补丁（有测试）
  launch.js          纯函数：Windows 启动脚本（有测试）
  uri.js             纯函数：路径 -> VS Code URI（有测试）
  mod.json
  *.svg              文件树图标（来自 herdr-app）
  test/              editors.test.mjs、uri.test.mjs、launch.test.mjs、settings.test.mjs
  install.ps1 / uninstall.ps1  Windows 安装/卸载
  install.sh / uninstall.sh    macOS / Linux 安装/卸载
  AGENTS.md                    给 AI 的安装/验证入口（仓库根目录还有一份仓库级 AGENTS.md）
```

测试：

```powershell
node --test files-plus/test/editors.test.mjs files-plus/test/uri.test.mjs files-plus/test/launch.test.mjs files-plus/test/settings.test.mjs
```

## 许可

本目录中非第三方来源的部分按仓库根目录 [`LICENSE`](../LICENSE) 的 MIT 许可授权。

文件树图标与 `main.js` 的浏览/预览逻辑来自 [herdrdev/herdr-app](https://github.com/herdrdev/herdr-app) 的 `defaults/mods/files`（Apache License 2.0）。URI 逻辑取自 [CacaoRick/herdr-open-vscode](https://github.com/CacaoRick/herdr-open-vscode)（MIT）。第三方部分仍按各自许可证授权，详见仓库根目录的 `NOTICE`。
