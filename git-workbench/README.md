# Git Workbench

给 Herdr App 的 Git 工具：提交历史、工作区变更、分支、提交对比与 blame，直接取代右侧原生「更改」面板，逐文件显示**并排 diff**。

Herdr 自带的 `changes` 面板只有单栏 diff 和一键提交；这个 mod 补充浏览历史、比较任意两点、按行 blame，以及常用的写操作。

## 功能

- **历史**：分页提交列表（信息/作者/hash/refs），搜索过滤；右侧显示完整说明、改动文件与并排 diff；diff 可「主区域打开」。
- **变更**：Staged / Unstaged / Untracked 分组；逐文件暂存、取消暂存、丢弃；全部暂存；提交与 Amend；Stash / Pop；diff 可「主区域打开」。
- **分支**：本地分支、远程分支、标签；ahead/behind 与作者、时间；树形展开 **分支 → 提交 → 文件**，提交行显示作者、时间与 hash，悬浮可看完整信息；逐层查看，右侧显示提交详情与并排 diff；diff 可「主区域打开」；切换、新建、删除、合并、rebase、Fetch/Pull/Push、删除标签。
- **对比**：起点/终点用下拉选择分支、标签或 HEAD；终点可选工作区。逐文件并排 diff；点「主区域打开」把对比放进中央的「Git 对比」标签页，用整窗宽度查看，之后在侧栏切换文件会实时跟随。
- **Blame**：文件从仓库文件列表中选择（可搜索），逐行显示提交、作者、时间与代码；点击一行跳到该提交；支持指定修订；长文件分页显示。
- **并排 diff**：左右行号对齐、增删色块、词级行内高亮；横向滚动条常驻，长行可以左右拖看。
- **主区域对比**：左右两栏各自独立（和 IDEA 一样），中间分隔条可拖动；两栏顶部标出各自对应的版本号；新增/删除文件这种一侧全空的对比只显示有内容的一栏；滚动默认两栏同步，按住 Alt 滚动或拖动滚动条可单独滚动一侧。
- **完整 Git 操作**：cherry-pick、revert、reset（soft/mixed/hard）、打标签；所有改写历史的操作都有二次确认。

## 安装

```powershell
cd git-workbench
powershell -ExecutionPolicy Bypass -File install.ps1
```

脚本会复制 mod、运行 `herdr-app check`，并把当前布局（`shared.json` 里的 `layout`）右侧「更改」面板换成这个 mod，原布局备份为 `<layout>.json.git-workbench.bak`。面板 id 仍是 `changes`，原生「更改」按钮和侧栏拖宽照常可用。卸载：

```powershell
powershell -ExecutionPolicy Bypass -File uninstall.ps1
```

卸载会把「更改」面板换回原生 mod。开发时用 `dev.ps1`：同步 mod、check，并接入「更改」面板，不改 `keys.json`。

> 重新安装语言包（zh-cn）可能覆盖布局文件；覆盖后重新跑一次 `install.ps1` / `dev.ps1` 即可。

## 使用

- 点右侧「更改」打开；标题栏的仓库名可点击切换仓库。
- 停靠状态下跟随当前聚焦终端：切到别的仓库会自动切换；同一仓库内切换 tab 不打断浏览。
- 顶部：历史 / 变更 / 分支 / 对比 / 追溯。
- 面板窄于 760px 时上下分栏（列表在上、详情在下），拖宽后自动变成左右分栏；拖动侧栏左边缘调节宽度。
- 任一视图的 diff 都可用「主区域打开」：在中央新建（或切回）「Git 对比」标签页，diff 用整个工作区宽度显示，两栏顶部标注版本号，中间分隔条可拖动；之后在侧栏**点击**其他文件或提交，标签页实时跟随（历史、分支、变更、对比通用）。切换对话/仓库不会自动打开主区域；后台刷新只在主区域正显示同一目标时更新它的内容，不会打开标签页。中间标签页被手动关掉后，再点击文件会自动重新打开；点状态栏「主区域跟随 ✓」可关闭这个行为。滚轮纵向滚动、触控板横滑或 Shift + 滚轮横向滚动，默认两栏同步；按住 Alt 滚动或拖动滚动条只动当前栏。新增文件或删除文件只显示有内容的一栏。
- 追溯视图：点文件选择框打开仓库文件列表，输入关键词筛选；选中后加载该文件的逐行 blame。
- 分支视图：点分支展开提交，点提交展开文件，点文件在右侧看并排 diff；点提交不再跳到「历史」视图。
- 右上角「刷新」重新读取；仓库目录变化会自动刷新（节流 400ms）。
- 后台每 5 秒读取一次仓库状态，数据没变时不动界面；文件有变化才更新列表与 diff。
- 直接执行命令也可以：
  - `herdr-app do layout.select --stack panel-body --child changes`
  - `herdr-app do git-workbench.changes`（同样支持 log/branches/compare/blame）
  - `herdr-app do git-workbench.open-compare` 把当前对比目标放到主区域标签页
  - `herdr-app do git-workbench.blame-file` 对当前选中文件打开 blame
  - `herdr-app do git-workbench.refresh`

## 实现

```
git-workbench/
  mod.json                place: none；由布局把「更改」面板指向本 mod
  layout-panel.ps1        把活动布局的 changes 面板换成/换回本 mod
  main.js                 仓库定位、视图切换、自适应分栏、命令、确认框、状态栏
  git.js                  exec 封装；log/status/branches/blame/diff 查询与写操作
  git-parse.js            纯解析函数（node --test 覆盖）
  diff.js                 统一 diff 解析、并排配对、词级 LCS
  ui.js                   按钮、标签、空状态、输入框外壳
  views/log.js            提交列表 + 提交详情 + 文件 diff
  views/changes.js        工作区分组、暂存/提交
  views/branches.js       分支/远程/标签树、提交与文件展开
  views/compare.js        两点对比、分支下拉、主区域「Git 对比」标签页
  views/stage.js          主区域标签页：左右两栏、同步滚动、可拖分隔条
  views/blame.js          逐行 blame
  views/diff-view.js      固定行高虚拟列表渲染并排 diff；主区域单栏行渲染
  test/*.test.mjs         node --test
  dev.ps1 / install.ps1 / uninstall.ps1
```

- 所有读操作带 `--no-optional-locks -c core.fsmonitor=false -c diff.autoRefreshIndex=false`，避免刷新本身写入 `.git` 又触发文件夹监听。
- 并排 diff 在 `diff.js` 内按 hunk 配对：先配对完全相同的行，再按 token 相似度贪心配对；低于 0.34 的不硬凑，左右各占一行。
- 文件列表用普通子元素（Herdr 的 `v_virtual_list` 在从空列表变成有数据时不刷新）；提交列表与侧栏 diff 使用虚拟列表。
- 主区域两栏各只渲染可见的几十行、共用一个纵向偏移，所以滚动天然同步；原生滚动区域读不到偏移量，滚动条是自绘的。
- 写操作全部在 `git.js` 的 `write` 对象里，界面只通过确认框调用。

## 测试

```sh
node --test test/*.mjs
herdr-app check .
```

## 限制

- 只支持本地窗口内的仓库；远程机器上的 space 会通过 `exec(..., { on })` 执行，但文件读取受 `readTextFile` 的 1 MiB 限制。
- 单文件 diff 截断到 1.5 MB；blame 最多 5000 行、每页显示 400 行（整文件一次渲染会触发宿主元素上限）；提交列表每页 150 条；分支展开一次最多 200 条提交。
- 没有语法高亮和真正的提交图（graph）；merge 提交相对第一父显示。
- 布局集成按面板 id `changes` 定位；若自定义布局删掉了这个面板，安装脚本会跳过并提示，需手动把面板内容改成本 mod。
- 对比视图从分支、标签、HEAD 中下拉选择，暂不支持输入任意 hash。
- 分支树用普通子元素渲染，一次展开很多分支/提交时性能不如虚拟列表。
- 没有三方合并编辑器；冲突文件仍显示 diff，解决冲突需要回终端。
- `pull` 固定 `--ff-only`，`push` 不带 `-f`。
