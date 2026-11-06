# 文件+

给 **Herdr App** 的文件面板加「在 VS Code 中打开」：

- 标题栏 **项目**：打开当前项目（git 根，否则当前终端目录）；
- 预览头部 **VS Code**：打开**当前预览的文件**；
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

当前 `zh.json` 会被直接改好，Herdr 热重载后立即生效。脚本是幂等的，重跑不会重复改布局，并会保留
`hosts.json`。

手动安装：复制本目录到 `~/.config/herdr-app/mods/files-plus/`（去掉 `gpui-kit.d.ts`、`jsconfig.json`、`test/`、脚本、`AGENTS.md` 和 README），然后把布局里的 `"mod": "files"` 改成 `"mod": "files-plus"`。

给 AI 读取的完整安装/验证步骤见仓库根目录的 [`AGENTS.md`](../AGENTS.md)。

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
- 点文件预览后，标题栏出现 **VS Code** 按钮；
- 文件行右侧的 `↗` 随时可以打开，不需要先预览；
- 右键文件行与 `↗` 等价；
- 想用快捷键，把下面几行合并进 `keys.json` 的 `global`：

```json
{
  "ctrl-shift-g": "files-plus.open-in-editor",
  "ctrl-shift-alt-g": "files-plus.open-project"
}
```

`nextCommand` 只在面板已经实例化时接收按键；如果面板被移出布局，快捷键不会生效。

## 远程文件

文件或项目在另一台 machine 上时，用 VS Code 的 **Remote - SSH** 打开：窗口在本机，内容留在远端，远端的 `~/.vscode-server` 首次会自动安装。项目按钮走 `--folder-uri`，文件按钮走 `--file-uri`。

Host 从 `hc machine ls --json` 的 `target` 读取。若机器是经中转连接的，或你希望用另一个 ssh Host，在 `~/.config/herdr-app/mods/files-plus/hosts.json` 里覆盖：

```json
{ "workbox": "workbox-lan" }
```

## 限制

- **没有行号**：`EditorState` 不暴露光标位置，只能打开到文件顶部。
- **依赖 `code` 命令**：Windows 通过 PowerShell 的 `Start-Process` 启动，避免 `exec` 等 GUI 进程；macOS/Linux 直接调用 `code`，失败时用 `open` / `xdg-open` 打开 `vscode://`。两者都没有时弹错误提示。
- **不跟上游自动更新**：文件树和预览逻辑来自 Herdr 0.1.13 的 `mods/files`。Herdr 升级后，若内置文件面板改了行为，需要对照上游 `defaults/mods/files/main.js` 同步本目录的 `main.js`。
- **重新安装 zh-cn 语言包会覆盖 `zh.json`**，把面板指回内置 `files`；重跑本目录的安装脚本（Windows `install.ps1`，macOS/Linux `install.sh`）即可。
- 右键是直接打开，不是菜单。需要「打开 / 复制路径 / 在文件管理器中显示」的完整右键菜单时再加。

## 文件

```
files-plus/
  main.js            文件面板（基于内置 files，增加打开动作）
  vscode.js          启动 VS Code、解析 Remote-SSH Host
  launch.js          纯函数：Windows 启动脚本（有测试）
  uri.js             纯函数：路径 -> VS Code URI（有测试）
  mod.json
  *.svg              文件树图标（来自 herdr-app）
  test/              uri.test.mjs、launch.test.mjs
  install.ps1 / uninstall.ps1  Windows 安装/卸载
  install.sh / uninstall.sh    macOS / Linux 安装/卸载
  AGENTS.md                    给 AI 的安装/验证入口（仓库根目录还有一份仓库级 AGENTS.md）
```

测试：

```powershell
node --test files-plus/test/uri.test.mjs files-plus/test/launch.test.mjs
```

## 许可

本目录中非第三方来源的部分按仓库根目录 [`LICENSE`](../LICENSE) 的 MIT 许可授权。

文件树图标与 `main.js` 的浏览/预览逻辑来自 [herdrdev/herdr-app](https://github.com/herdrdev/herdr-app) 的 `defaults/mods/files`（Apache License 2.0）。URI 逻辑取自 [CacaoRick/herdr-open-vscode](https://github.com/CacaoRick/herdr-open-vscode)（MIT）。第三方部分仍按各自许可证授权，详见仓库根目录的 `NOTICE`。
