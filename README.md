# Herdr 中文语言包

针对 **Herdr 桌面版 app**（`herdrdev/herdr-app`，不是旧的独立终端）的简体中文界面包。
基准版本：**0.1.12**（规则按英文原文匹配，Herdr 升级后无需重装）。

界面不是二进制的资源文件：Herdr 的侧边栏、标签栏、菜单、对话框、设置、命令面板、欢迎页和 Herdr 98
都由 `~/.config/herdr-app` 下的 JavaScript 绘制。语言包就是这些文件的中文版本，加一个负责在启动后
把它们放回去的小 mod。

## 效果

- 主窗口：空间/智能体侧边栏、标签页、窗格、状态栏、文件与更改面板
- 菜单与对话框：右键菜单、+ 菜单、跳转器、重命名/确认、机器管理、工作树、通知
- 应用界面：设置、命令面板、快捷键、欢迎页、更新说明、Herdr 98（含扫雷/纸牌外壳）
- 设置新增「快捷键」页：按动作合并列出 `keys.json` 的全部绑定，点击按键即可改绑、删除或
  给同一动作追加一个键（由独立的 `shortcuts` mod 提供；保存后 Herdr 实时重载，无需重启）
- 中文布局：`zh`（主界面）、`zh-terminals`、`zh-win98`
- 配色：附带 `solarized` 深色主题，由 `zh` 布局固定使用（不跟随系统明暗）

未覆盖（这些文字由 Rust 直接绘制，mod 无法改写）：部分错误提示与更新横幅、macOS 原生菜单、
命令面板里未单独命名的冷门命令、更新日志正文。

## 安装

Windows（PowerShell）：

```powershell
cd zh-cn
powershell -ExecutionPolicy Bypass -File install.ps1
```

macOS / Linux：

```sh
cd zh-cn
./install.sh
```

安装脚本会：

1. 把 `mods/zh-cn` 与 `mods/shortcuts` 复制到 `~/.config/herdr-app/mods/`；
2. 复制三个中文布局到 `~/.config/herdr-app/layouts/`；
3. 把 `themes/solarized.json` 复制到 `~/.config/herdr-app/themes/`；
4. 如果 Herdr 正在运行，切换到 `zh` 布局。

切换布局后界面立即变中文；之后每次启动 Herdr 都停在中文布局。

也可手动安装：复制 `mods/zh-cn`、`mods/shortcuts`、`layouts/zh*.json` 与
`themes/solarized.json`，然后 `herdr-app do layout.switch --name zh`。

## 卸载

```powershell
powershell -ExecutionPolicy Bypass -File uninstall.ps1
```

```sh
./uninstall.sh
```

删除语言包（含随包安装的 `solarized` 主题）并切回 `main`。内置 mod 与界面文件会在下次启动时
恢复英文（不会留下 `*-edited` 副本）。

## 原理与限制

Herdr 每次启动都会：

- 用二进制里的内容重写 `frame/`（设置、欢迎页、命令面板等）；
- 校验并还原 `mods/` 下的内置 mod。

所以普通的替换文件会在重启后失效。语言包的做法是：

- `layouts/zh*.json` 把官方布局复制一份，并加入一个**不绘制任何内容的浮动 mod** `zh-cn`；
- 这个 mod 在窗口启动时读取 Herdr 刚还原出来的英文文件，按 `patches.json` 里的规则
  「英文原文 → 中文」逐条就地替换：先匹配带上下文的整段，再匹配改动行；上游在同一段里
  插入或改写了别的行时，退化为逐行替换（只替换在文件里唯一出现的行），避免一处小改动
  让整段翻译失效；
- 同时把 `installed.json` 里对应 mod 的指纹更新为翻译后的文件，应用便不会把翻译当成用户改动而
  克隆出 `*-edited`。

`shortcuts` mod 也由 `zh*` 布局里的浮动块启动：它先等语言包写完（设置文件出现中文标记），
再按代码锚点把「快捷键」导航项和页面注入 `frame/settings/main.js`；注入内容放在
`frame/settings/shortcuts.js` 与 `keys-edit.js`，图标是 `keyboard.svg`。用目录锁串行化
热重载时的多个实例，避免两个写入者把文件写坏。

改键时只改 `keys.json`：读文件、删旧 chord、写新 chord，带快照校验地原子写回（文件被别人
同时改过就重读重试）。`keys.json` 是完整按键表而不是补丁，所以删掉一条就真正解绑；Herdr
监听该文件，保存后立即生效。应用保留的 `ctrl-alt-shift-escape` 只读，页面不会写回它。

**升级不需要重装。** 规则不绑定 Herdr 版本：新版本里文本没变的片段继续翻译；上游改动过的片段
匹配失败就保留英文，不会写坏新界面。只有想翻译新版本新增的文字时，才需要更新规则表。

限制：

- 只有中文布局会加载补丁：切到 `main` / `win98` / `terminals` 后，本次运行仍是中文，但下次启动
  不会应用语言包，`shortcuts` 注入的「快捷键」页也会随 `frame/` 还原而消失。用 `zh*` 布局即可。
- 上游改写过的句子会暂时显示英文；重新生成规则即可补齐（见下文）。

## 文件

```
zh-cn/
  install.ps1, uninstall.ps1, install.sh, uninstall.sh
  layouts/zh.json          主界面中文布局（main + 浮动补丁块，固定 solarized 主题）
  layouts/zh-terminals.json
  layouts/zh-win98.json
  themes/solarized.json    深色主题（由 macOS Terminal 的 111.terminal 转换）
  mods/zh-cn/
    main.js                补丁：应用规则、维护 installed.json 指纹
    patches.json           规则表（英文 → 中文）
  mods/shortcuts/
    main.js                启动后把「快捷键」页注入 frame/settings
    shortcuts.js           快捷键页本体（keys() 分组、美化按键、就地编辑）
    keys-edit.js           chord 规范化与 keys.json 绑定改写（纯函数，有测试）
    keyboard.svg           设置导航图标
  test/keys-edit.test.mjs  改键逻辑测试（node --test）
  orig/                    0.1.12 官方英文原文（生成规则用，不随包安装）
  reference/               对应的中文全文（维护用，不随包安装）
  tools/make-patches.py    从 orig/ 与 reference/ 生成 patches.json
```

## 维护 / 更新规则

1. 用新版 Herdr 启动一次，让它把界面文件还原成新版本；
2. 把新版文件复制到 `orig/`（保留路径），在 `reference/` 里同步翻译差异；
3. 运行 `python tools/make-patches.py`（脚本会回放校验：规则必须逐字还原 `reference/`）；
4. 对 `reference/` 下每个 mod/frame 运行 `herdr-app check`，再安装。
