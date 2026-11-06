# 快捷命令

给 Herdr App 的命令模板面板：按 `Ctrl+Shift+R` 打开，搜索或选择一条模板，回车把命令发送到**当前聚焦的终端**。不用再手输 `npm start`、`npm run build`、`cargo run` 这类命令。

## 功能

- **搜索式面板**：按名称、命令、分组、说明过滤，支持精确子串和字符子序列（`npb` 能找到 `npm run build`）。
- **发送到当前终端**：通过 `hc send` 粘贴命令并回车；没有聚焦终端时给出提示，不会猜目标。
- **新增 / 编辑 / 删除**：面板内直接操作，写回 JSON 配置；外部修改配置文件也会自动重载。
- **项目感知模板**：打开面板时检测当前终端所在目录和 git 根，只排列这个项目实际用得上的启动、构建、测试命令；按启动 → 开发 → 构建 → 测试 → 检查排序。
- **变量替换**：`${cwd}`、`${repo}`、`${branch}` 等；`${input:标签}` 会在运行前弹出一个输入表单。
- 跟随 Herdr 主题配色；不占侧边栏或布局节点。

## 安装

```powershell
cd quick-commands
powershell -ExecutionPolicy Bypass -File install.ps1
```

脚本会：

1. 复制 mod 到 `~/.config/herdr-app/mods/quick-commands/`；
2. 运行 `herdr-app check`；
3. 在 `keys.json` 的 `global` 中加入 `ctrl-shift-r` → `mod.open:quick-commands`（已被占用时不覆盖，并提示手动绑定）。

也可以手动绑定：

```json
{ "global": { "ctrl-shift-r": "mod.open:quick-commands" } }
```

或直接运行：

```powershell
herdr-app do mod.open --name quick-commands
```

## 使用

- `Ctrl+Shift+R` 打开 / 关闭面板。
- 输入关键词过滤；`↑` / `↓` 选择，`Enter` 运行。
- `Ctrl+N` 新增命令，`Ctrl+E` 编辑选中的命令；自定义命令每行右侧也有「编辑」「删除」。
- 自动模板右侧显示「复制」：点击会把模板内容填进新增表单，保存成自定义命令；自动模板本身不会写进配置文件。
- 自定义命令和自动模板的命令文本完全相同时，只显示自定义命令。
- 项目检测结果在面板顶部显示，可点「重新检测」刷新；检测失败或没有项目标记时回退到通用模板。
- 删除需要再点一次「删除」确认。
- `Esc` 关闭面板；在新增 / 编辑 / 变量输入界面按 `Esc` 返回列表。

命令会发送到打开面板时聚焦的终端。若该终端上的 agent 正处于 `blocked`（等待审批），`hc send` 会拒绝写入，这是 Herdr 的安全行为；先处理审批再运行。

## 项目模板

打开面板时按以下顺序检测：

1. 先看当前终端的工作目录（`cwd`）；
2. 再看 `git rev-parse --show-toplevel` 得到的仓库根。

选第一个包含项目标记的目录作为「项目」。标记包括 `package.json`、`Cargo.toml`、`pom.xml`、`build.gradle(.kts)`、`pyproject.toml`、`requirements.txt`、`setup.py`、`setup.cfg`、`uv.lock`、`poetry.lock`、`main.py`、Docker Compose 文件。这样在 monorepo 子包里打开时优先用子包自己的脚本，子包没有标记时再退回仓库根。

检测到项目后只生成对应的命令：

| 项目 | 生成规则 |
| --- | --- |
| Node.js | 读取 `package.json` 的 `scripts`，按 `start` → `dev` → `serve` → `build` → `test` → `lint` → `format` → `typecheck` → `preview` → `watch` → `clean` 排序；其余脚本排在后面。锁文件决定包管理器：`pnpm-lock.yaml` → pnpm，`yarn.lock` → yarn，`bun.lockb` / `bun.lock` → bun，否则 npm。npm 的 `start` / `test` 用 `npm start`、`npm test`，其余用 `npm run <name>`。最后附加安装依赖。 |
| Rust | `cargo run`、`cargo build`、`cargo test`、`cargo clippy --all-targets --all-features`、`cargo fmt`。 |
| Maven | 优先使用 wrapper：Windows 为 `.\mvnw.cmd`，其它平台为 `./mvnw`；没有 wrapper 时用 `mvn`。检测到 Spring Boot 时，分组为 Spring Boot 并附加 `<wrapper> spring-boot:run`。 |
| Gradle | 优先使用 wrapper：Windows 为 `.\gradlew.bat`，其它平台为 `./gradlew`；没有 wrapper 时用 `gradle`。检测到 Spring Boot 时，分组为 Spring Boot 并附加 `<wrapper> bootRun`。 |
| Python | `uv.lock` 或 `[tool.uv]` → `uv sync`、`uv run pytest`；`poetry.lock` 或 `[tool.poetry]` → `poetry install`、`poetry run pytest`；否则 `python -m venv .venv`、`pip install -r requirements.txt`、`python -m pytest`。有 `main.py` 时附加运行命令。 |
| Docker | 存在 Compose 文件时生成 `docker compose up`、`up -d`、`down`、`logs -f`。 |
| Git | 在 git 仓库里时生成 `git status`、`git log`、`git diff`、`git pull --ff-only`、`git push`。 |

没有项目标记但仍在 git 仓库里时，只给 Git 命令和清屏；纯文件夹才回退到 npm、pnpm、Rust、Spring Boot、Python 的通用模板（Git 命令会过滤掉）。

自动模板由运行时生成，不写入配置文件；要固定修改某条就点「复制」保存成自定义命令，之后它会覆盖同命令的自动模板。

## 配置

路径：

```
~/.config/herdr-app/data/quick-commands/commands.json
```

首次打开面板时创建。v2 只保存**自定义命令**，项目模板由运行时生成：

```json
{
  "version": 2,
  "commands": [
    {
      "id": "my-dev",
      "name": "启动开发服务器",
      "command": "npm run dev",
      "group": "npm",
      "description": "使用 8080 端口"
    }
  ]
}
```

- `name`、`command` 必填；`group`、`description` 可省略。
- `id` 可省略；缺失或重复时保存时自动生成。编辑时保留原 id。
- 从 v1 升级时，配置里「原封不动」的内置模板会被丢弃，用户改过或新增的命令保留；文件在下一次保存时写成 v2。
- 面板打开期间直接改文件会自动重载；正在编辑表单时会等返回列表后重载。
- 配置文件不是合法 JSON 时，面板会显示错误并停止编辑，避免覆盖掉手写内容；修复后点「重新加载」。

## 变量

| 变量 | 替换为 |
| --- | --- |
| `${cwd}` | 当前终端的工作目录 |
| `${repo}` | 当前 git 仓库根目录名；不在仓库里时用工作目录名 |
| `${branch}` | 当前分支；detached HEAD 时用短 hash |
| `${home}` | 本机用户主目录 |
| `${date}` | 本地日期，`YYYY-MM-DD` |
| `${time}` | 本地时间，`HH:MM:SS` |
| `${env:NAME}` | 环境变量 `NAME`；本地 Windows 用 PowerShell 读取，其它平台用 `printenv` |
| `${input:标签}` | 运行前弹出输入框，标签作为字段名 |

未识别的 `${...}` 原样保留，交给 shell 自己处理，例如 `echo ${HOME}`。

变量替换是纯文本替换，不自动加引号。路径含空格时自己写成 `cd "${cwd}"`。

## 文件

```
quick-commands/
  mod.json                place: none；浮层尺寸与位置
  main.js                 面板、搜索、增删改、项目检测、变量解析、发送
  commands.js             回退模板、配置校验与迁移、搜索、变量展开（纯函数）
  project.js              按项目事实生成模板、排序（纯函数）
  test/commands.test.mjs  配置与变量测试
  test/project.test.mjs   项目检测与模板生成测试
  install.ps1 / uninstall.ps1
```

## 测试

```sh
node --test test/*.mjs
herdr-app check .
```

## 限制

- 命令通过 `hc send` 发送，会粘贴文本并按下回车；没有“只填入不执行”的模式。
- 不支持多行脚本；需要串联时用 `&&`、`;` 或写成脚本文件再调用。
- 不会切换工作目录；要固定目录请在命令里写 `cd <目录> && ...`，或用 `${cwd}`。
- 只发送到打开面板时的当前终端，不提供“在新标签页运行”。
- `${home}` 始终是本机主目录；远程机器上的命令请用 `${env:HOME}` 或目标机器自己的变量。
- `${env:NAME}` 在远程 Windows 机器上不受支持（远端按 Unix 处理）。
- 不读取终端选中文本，也没有 `${selectedText}` 之类的变量。
- 项目检测在打开面板时执行一次；终端 `cd` 到别的项目或新增项目标记后，需要点「重新检测」。
- 检测只读取文件名和少量文本（`package.json`、`pom.xml`、`build.gradle(.kts)`、`pyproject.toml`）；远程文件读取受 `readTextFile` 的大小限制，单个文件过大时可能检测不到关键内容。
- 宿主是 Windows 且终端在本地时生成 `.\mvnw.cmd` / `.\gradlew.bat`；远程终端按 Unix 生成 `./mvnw` / `./gradlew`。
