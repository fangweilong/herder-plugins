# Herdr 审批中继（Windows）

把 Herdr App 里 agent 的 `blocked` 变成 **Windows 置顶弹窗 + 托盘**，点一下就把你的选择送回终端。
只转发你明确点过的选项，不自动批准，不改 agent 配置。

## 效果

- 弹窗跟随 Herdr 当前主题（读 `settings.json` + `themes/<name>.json`）：圆角外框、扁平分区和分隔线，不再在卡片里套卡片；
- agent 进入 `blocked` 时，底部右侧弹出置顶窗口：项目 / 空间 / 标签 / agent、当前问题、屏幕原文、选项按钮；
- 托盘图标同步显示待审批数量；左键叫回弹窗，右键菜单可退出助手；
- 界面文案支持中文 / English：`language: "auto"` 时优先看当前布局是不是 `zh*`，否则看系统语言；弹窗右上角 `中 / EN` 可即时切换；
- 弹窗右上角「翻译」或按 `T`：把**问答问题/审批选项**译成当前界面语言；问答问题会从屏幕中单独提取，不再只译标题；
- 翻译按钮跟随内容：问题标题行和终端标题行右侧都叫「翻译」；第二块在译文显示后变成「收起译文」；
- 终端译文追加在原文下方（过滤边框和空行），不会覆盖原文；再点「收起译文」隐藏；
- 等待时长每个刷新周期自动更新；
- 点击选项后调用 `hc keys` 把按键送回 agent；自由文本用 `hc send --force`；
- 发送后自动检查 agent 是否离开 `blocked`；仍 blocked 会提示并计次；
- 多个 agent 同时等待时排队，一次只弹一个；
- 已切到该 agent 时默认不弹（可在配置里关掉）；
- 底部提示按类型变化：选项 `1–9 选择 · Enter 默认`，问答 `Enter 发送`，通用按键 `↑↓ 选择 · Enter 确认`；
- **没有右侧面板、没有悬浮把手**；审批只通过独立弹窗出现；
- 所有事件写到 `data/approval-relay/audit.jsonl`。

## 要求

- Windows 10/11；
- Herdr App（测试于 0.1.12）；
- `hc` 和 `herdr-app` 在 PATH 中，或安装在默认位置：
  `%LOCALAPPDATA%\Programs\herdr-core\hc.exe`、`%LOCALAPPDATA%\Programs\herdr-app\herdr-app.exe`；
- Windows PowerShell 5.1（系统自带）。

## 安装

```powershell
cd approval-relay
powershell -ExecutionPolicy Bypass -File install.ps1
```

脚本会：

1. 复制 `mods/approval-relay` 到 `~/.config/herdr-app/mods/`；
2. 运行 `herdr-app check` 检查 mod；
3. 移除旧版留下的 `approval-relay-panel` 侧边栏、`approval-relay-tab` 把手和对应快捷键；
4. 在布局里放一个 0 宽的 `approval-relay-host` 节点，让检测逻辑运行但不显示任何侧边 UI；
5. 切换一次当前布局，让 Herdr 重新加载。

弹窗助手由 mod 自动启动，不需要单独运行；也可以手动：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File mods/approval-relay/helper/approval-popup.ps1 -AppHome "$env:USERPROFILE\.config\herdr-app"
```

## 设置

Herdr 的「设置」里新增「审批」页，排在隐私之后、快捷键之前（`herdr-app` 启动时由 mod 注入，下一次启动会自动恢复/重注入）：

- **启用审批中继**：关闭后不再发现新的 `blocked`；已入队请求仍可在助手窗口回答。
- **翻译审批文本**：总开关；关闭后不联网。
- **翻译**：弹窗里按 `T` 会翻译问题**和每个审批选项**；选项显示中文主行、英文原文副行，点击仍按原按键发送。
- **问答型审批**：没有编号选项、只有提问和输入行的窗口也会识别，问题翻译、直接在输入框回答；选项里的「Other / 自己输入」也可以用输入框回答。
- **多审批窗**：同一时间只弹一个窗口，标题旁显示「还有 N 个请求」；回答/忽略/终端里处理后自动切到下一个，不会叠窗。
- **兼容的终端 UI**：Claude Code / Codex 的编号选项、Pi 的 `❯ 1  yes` 编号和二级深度列表、oh-my-pi 的无编号 Approve/Deny 高亮列表、opencode 的 Allow once / Always allow / Reject 列表，都按原终端按键发送。
- **翻译顺序**：按住条目左侧 `⠿` 拖动排序（单击不会改），第一个先试，失败按顺序换下一个。新增接口只要加进这个列表。
- 页面底部提示：快捷键不在这里单独管理。

配置直接写到 `data/approval-relay/config.json`，运行中的 mod 会在几秒内重读，不需要重启；助手在每次翻译时重读翻译配置。

## 使用

- 不占用侧边栏或快捷键；有审批时弹窗自动出现。
- 切换语言：弹窗右上角 `中 / EN`，或 `herdr-app do approval-relay.lang`；会写回 `config.json` 的 `language`。
- 翻译：问题标题行「翻译」或 `T` 翻译问题和选项；终端标题行「翻译」把屏幕译文追加在原文下方，再点「收起译文」隐藏。
- 设置：`设置 → 审批` 改启用、翻译开关和翻译服务顺序（拖动排序）。

- 弹窗出现在鼠标所在屏幕的右下角，置顶；`Enter` 选默认项，`1-9` 选对应编号，`Esc` 收起（不会拒绝），`稍后` 保持队列；
- 数字选项发送 `编号 + Enter`；`[y/N]` 发送 `y/n + Enter`；识别不出结构时显示通用键：`Enter` / `Esc` / `↑` / `↓` / `Tab` / `1` / `2` / `3` / `Y` / `N`；
- 自由文本框会发送到终端（`hc send --force`，因为 blocked 时 `hc send` 默认拒绝）；
- `在 Herdr 打开` 跳到对应 agent 的 pane；
- 托盘左键叫回当前弹窗；右键可退出助手。

## 安全边界

- **不自动批准**。只有你点了按钮/发了文本才会发按键。
- 解析器只认“活的”选择框：选项必须在屏幕底部，下面只能有按键提示或状态栏；普通输出里打印的 `Do you want to proceed?` 不会触发。
- 不读取 agent 的会话记录；不自动联网。只有你点「翻译」/按 `T`/「译原文」时，才把问题或当前屏幕文本发到 Google 或 Microsoft（可在配置里设 `off`）。
- `hc send --force` 只在用户主动发送文本时使用；`hc keys` 用于按键。
- 关闭 Herdr 窗口后 mod 不再检测新审批；已在队列里的请求仍可由助手回答（助手直接调用 `hc`）。

## 配置

`~/.config/herdr-app/data/approval-relay/config.json`（首次运行生成）：

```json
{
  "enabled": true,
  "skipFocused": true,
  "language": "auto",
  "translation": { "enabled": true, "order": ["google", "microsoft"] },
  "readCooldownMs": 7000,
  "maxAttempts": 3,
  "helperIdleSeconds": 120
}
```

- `language`：`auto` / `zh` / `en`；`auto` 先看布局名是否 `zh*`，否则跟随系统 UI 语言；
- `translation.enabled`：翻译总开关；`translation.order`：服务顺序数组，拖动设置页写入（旧版 `provider` 仍兼容）；新增服务时把 id 加进数组，并在 helper 里加对应翻译函数；
- `skipFocused`：正在看这个 agent 时不弹；
- `maxAttempts`：同一 agent 连续回答后仍 blocked 的最大重试次数；
- `readCooldownMs`：读取屏幕/重新建请求的最小间隔；
- `helperIdleSeconds`：弹窗助手空闲多久后退出，默认 120 秒；有请求时按需再启动。

## 文件

```
approval-relay/
  mods/approval-relay/
    main.js                 检测 blocked、读屏、排队、审计（面板渲染保留但布局不挂载）
    parse.js                对话框解析（编号选项 / y-n / 通用按键）
    i18n.js / i18n.json     中英文案与快捷键显示
    settings-methods.js     注入到 Herdr 设置页的「审批」页方法
    helper/approval-popup.ps1  主题化置顶窗口 + 托盘；调用 hc 回答，翻译按钮走 Google/Microsoft
  test/parse.test.mjs       解析器测试
  test/i18n.test.mjs        语言与快捷键格式测试
  install.ps1 / uninstall.ps1
```

数据目录：`~/.config/herdr-app/data/approval-relay/`（queue / answers / audit.jsonl / helper.log）。

## 卸载

```powershell
powershell -ExecutionPolicy Bypass -File uninstall.ps1
```

删除 mod 和快捷键绑定，向助手写 `stop.flag` 让它退出；加 `-Purge` 同时删除审计和队列数据。

## 限制

- 只支持 Windows；macOS/Linux 需要换 helper。
- 识别不了的自定义 TUI 对话框会退回通用按键，仍可在弹窗里看原文后手动按。
- 强依赖 `blocked` 状态：agent 不报 OSC 7501 就不会被检测到。
- 弹窗是普通 PowerShell WinForms 窗口，不是 Windows 通知中心卡片；这样做是为了按钮和回传可靠。
