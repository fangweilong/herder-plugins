// 快捷命令：可搜索的命令模板面板。
//
// 模板保存在 ~/.config/herdr-app/data/quick-commands/commands.json，首次打开时写入默认模板。
// 选中后通过 `hc send` 把展开后的命令送到当前聚焦终端；变量只展开白名单，其余 ${...}
// 原样交给 shell。面板本身是 mod.open 打开的浮层，不占布局节点。

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import * as fsp from "fs/promises";
import {
  appHome, closeOverlay, exec, focused, hc, home, notify, panes, props, readTextFile, settings, spaces, theme,
  watchFolder, window, writeTextFile,
} from "herdr";
import {
  defaultConfig, expandCommand, makeId, matchCommands, migrateConfig, removeCommand,
  scanVariables, serializeConfig, upsertCommand,
} from "./commands.js";
import { buildProjectCommands, hasProjectMarkers, rootCandidates } from "./project.js";

const ROW_HEIGHT = 50;

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatTime(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function baseName(path) {
  const clean = String(path ?? "").replace(/[\\/]+$/, "");
  return clean.split(/[\\/]/).pop() || clean;
}

function errorMessage(error) {
  return error?.message ? String(error.message) : String(error ?? "未知错误");
}

const VARIABLE_HINT = "变量：${cwd} ${repo} ${branch} ${home} ${date} ${time} ${env:NAME} ${input:标签}";

export default class QuickCommands extends View {
  init(_props, cx) {
    this.dir = `${appHome()}/data/quick-commands`;
    this.path = `${this.dir}/commands.json`;

    this.mode = "list";
    this.commands = [];
    this.projectCommands = [];
    this.projectRoot = "";
    this.projectLoading = true;
    this.projectError = "";
    this.editingGenerated = false;
    this.raw = null;
    this.filter = "";
    this.at = 0;
    this.scroll = 0;
    this.listHeight = 320;
    this.busy = false;
    this.closed = false;
    this.confirmId = null;
    this.loadError = "";
    this.actionError = "";
    this.editError = "";
    this.inputError = "";
    this.broken = false;
    this.pendingReload = false;
    this.edit = null;
    this.editFocus = "";
    this.inputCmd = null;
    this.inputStates = null;
    this.inputFocus = "";

    this.handle = cx.focus_handle();
    this.target = null;

    this.search = InputState.new({ placeholder: "搜索命令、模板或分组…" });
    this.search.on("change", (_event, cx) => {
      this.filter = this.search.value();
      this.at = 0;
      this.scroll = 0;
      cx.notify();
    });
    this.search.on("submit", (_event, cx) => this.runSelected(cx));
    this.search.focus();

    // 浮层刚打开时输入框可能还没拿到键盘焦点，和内置 picker 一样补一次。
    cx.timer.after(600, () => {
      if (this.mode === "list" && !this.closed) this.search.focus();
    });

    // 打开浮层前聚焦的终端。浮层获得键盘焦点后 focused() 可能变成 null，留作回退。
    this.target = this.captureTarget();

    cx.spawn(async (cx) => {
      await this.load(cx);
      await this.loadProject(cx);
      this.watch(cx);
    });
  }

  async close() {
    this.closed = true;
  }

  allCommands() {
    // 自定义命令与自动模板同命令时以自定义为准，避免同一个动作出现两次。
    const overridden = new Set(this.commands.map((command) => command.command));
    return [
      ...this.projectCommands.filter((command) => !overridden.has(command.command)),
      ...this.commands,
    ];
  }

  rows() {
    return matchCommands(this.allCommands(), this.filter);
  }

  selected() {
    return this.rows()[this.at];
  }

  captureTarget() {
    const focus = focused();
    if (focus?.terminal) {
      const space = spaces().find((item) => item.id === focus.space);
      return { address: focus.terminal, cwd: focus.cwd ?? "", on: space?.machine ?? null };
    }
    const pane = panes().find((item) => item.focused && item.terminal);
    if (pane) {
      const space = spaces().find((item) => item.tabs.some((tab) => tab.id === pane.tab));
      return { address: pane.terminal, cwd: pane.cwd ?? "", on: space?.machine ?? null };
    }
    return null;
  }

  currentTarget() {
    return this.captureTarget() ?? this.target;
  }

  async readRaw() {
    // Herdr 的 fs/promises 不保证错误里带 Node 的 code；先 exists 再读。
    if (!(await fsp.exists(this.path))) return null;
    return await fsp.readFile(this.path, "utf8");
  }

  async load(cx) {
    try {
      await fsp.mkdir(this.dir, { recursive: true });
      let raw = await this.readRaw();
      if (raw === null) {
        raw = serializeConfig(defaultConfig().commands);
        await writeTextFile(this.path, raw, null);
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        this.raw = raw;
        this.commands = [];
        this.broken = true;
        this.loadError = `配置文件不是合法 JSON：${this.path}\n${errorMessage(error)}`;
        cx.notify();
        return;
      }
      this.commands = migrateConfig(parsed).commands;
      this.raw = raw;
      this.broken = false;
      this.loadError = "";
      const rows = this.rows();
      if (this.at >= rows.length) this.at = Math.max(0, rows.length - 1);
    } catch (error) {
      this.broken = true;
      this.loadError = `读取配置失败：${errorMessage(error)}`;
    }
    cx.notify();
  }

  watch(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        try {
          await watchFolder(this.dir);
        } catch {
          return;
        }
        if (this.closed) return;
        if (this.mode === "list" && !this.busy) {
          await this.load(cx);
        } else {
          this.pendingReload = true;
        }
        if (this.closed) return;
        cx.notify();
      }
    });
  }

  async readFacts(root, target, platform, git) {
    const base = String(root).replace(/[\\/]+$/, "");
    const names = [
      "package.json",
      "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock",
      "Cargo.toml",
      "pom.xml", "mvnw", "mvnw.cmd",
      "build.gradle", "build.gradle.kts", "gradlew", "gradlew.bat",
      "pyproject.toml", "requirements.txt", "setup.py", "setup.cfg", "uv.lock", "poetry.lock",
      "main.py",
      "compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml",
    ];
    const texts = {};
    const files = new Set();
    await Promise.all(names.map(async (name) => {
      try {
        const text = await readTextFile(`${base}/${name}`, { on: target.on });
        if (text !== null) {
          files.add(name);
          texts[name] = text;
        }
      } catch {}
    }));
    const compose = ["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"]
      .find((name) => files.has(name)) ?? null;
    return {
      root: base,
      platform,
      git,
      files,
      mainPy: files.has("main.py"),
      compose,
      packageJson: texts["package.json"] ?? null,
      pom: texts["pom.xml"] ?? null,
      gradle: texts["build.gradle"] ?? null,
      gradleKts: texts["build.gradle.kts"] ?? null,
      pyproject: texts["pyproject.toml"] ?? null,
    };
  }

  async loadProject(cx) {
    this.projectLoading = true;
    this.projectError = "";
    cx.notify();
    const target = this.currentTarget();
    const platform = window()?.platform === "windows" && !target?.on ? "windows" : "unix";
    if (!target?.cwd) {
      this.projectCommands = buildProjectCommands({
        root: "", platform, git: false, files: new Set(), mainPy: false, compose: null,
        packageJson: null, pom: null, gradle: null, gradleKts: null, pyproject: null,
      });
      this.projectRoot = "";
      this.projectLoading = false;
      cx.notify();
      return;
    }
    try {
      let gitRoot = "";
      try {
        const result = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: target.cwd, on: target.on });
        if (result.code === 0) gitRoot = result.stdout.trim();
      } catch {}
      const roots = rootCandidates(target.cwd, gitRoot);
      for (const root of roots) {
        const facts = await this.readFacts(root, target, platform, Boolean(gitRoot));
        if (hasProjectMarkers(facts) || root === roots[roots.length - 1]) {
          this.projectCommands = buildProjectCommands(facts);
          this.projectRoot = facts.root;
          this.projectLoading = false;
          cx.notify();
          return;
        }
      }
    } catch (error) {
      this.projectError = `项目检测失败：${errorMessage(error)}`;
    }
    this.projectCommands = buildProjectCommands({
      root: target.cwd, platform, git: false, files: new Set(), mainPy: false, compose: null,
      packageJson: null, pom: null, gradle: null, gradleKts: null, pyproject: null,
    });
    this.projectRoot = target.cwd;
    this.projectLoading = false;
    cx.notify();
  }

  detectProject(cx) {
    cx.spawn(async (cx) => { await this.loadProject(cx); });
  }

  async persist(mutate) {
    if (this.broken) {
      this.actionError = "配置文件有错误，先修复或重新加载后再编辑。";
      return false;
    }
    let raw = this.raw;
    let current = this.commands;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0 || raw === null) {
        raw = await this.readRaw();
        if (raw === null) {
          current = [];
        } else {
          try {
            // 冲突重读时也要走迁移，否则会把 v1 里的内置模板重新当成用户命令写回去。
            current = migrateConfig(JSON.parse(raw)).commands;
          } catch (error) {
            this.actionError = `保存失败：配置文件被其他程序改成了非法 JSON（${errorMessage(error)}）`;
            return false;
          }
        }
      }
      const next = mutate(current);
      const text = serializeConfig(next);
      try {
        await writeTextFile(this.path, text, raw);
        this.raw = text;
        this.commands = next;
        this.broken = false;
        this.loadError = "";
        return true;
      } catch (error) {
        if (attempt === 2) {
          this.actionError = `保存失败：${errorMessage(error)}`;
          notify({ title: "快捷命令", body: this.actionError, level: "error" });
          return false;
        }
      }
    }
    return false;
  }

  key(event, cx) {
    const key = event.key;
    if (this.mode === "edit" || this.mode === "inputs") {
      if (key === "escape") {
        this.backToList(cx);
        cx.stop_propagation();
      }
      return;
    }
    if (key === "escape") {
      if (this.confirmId) {
        this.confirmId = null;
        cx.notify();
      } else {
        closeOverlay(props().overlay);
      }
      cx.stop_propagation();
      return;
    }
    if (key === "down") {
      this.move(1);
      cx.stop_propagation();
      cx.notify();
      return;
    }
    if (key === "up") {
      this.move(-1);
      cx.stop_propagation();
      cx.notify();
      return;
    }
    if (key === "n" && event.modifiers.control) {
      this.openEditor(null, cx);
      cx.stop_propagation();
      return;
    }
    if (key === "e" && event.modifiers.control) {
      const command = this.selected();
      if (command) this.openEditor(command, cx);
      cx.stop_propagation();
    }
  }

  move(delta) {
    const rows = this.rows();
    if (!rows.length) return;
    this.at = (this.at + delta + rows.length) % rows.length;
    this.ensureVisible();
  }

  ensureVisible() {
    const height = Math.max(ROW_HEIGHT, this.listHeight);
    const top = this.at * ROW_HEIGHT;
    if (top < this.scroll) this.scroll = top;
    if (top + ROW_HEIGHT > this.scroll + height) this.scroll = top + ROW_HEIGHT - height;
  }

  backToList(cx) {
    this.mode = "list";
    this.edit = null;
    this.editFocus = "";
    this.editError = "";
    this.inputCmd = null;
    this.inputStates = null;
    this.inputFocus = "";
    this.inputError = "";
    this.editingGenerated = false;
    this.search.focus();
    if (this.pendingReload) {
      this.pendingReload = false;
      cx.spawn(async (cx) => { await this.load(cx); });
    }
    cx.notify();
  }

  openEditor(command, cx) {
    if (this.broken) {
      this.actionError = "配置文件有错误，先修复或重新加载后再编辑。";
      cx.notify();
      return;
    }
    this.mode = "edit";
    this.confirmId = null;
    this.editError = "";
    this.editFocus = "name";
    // 自动模板没有配置 id：编辑它等于复制成一条自定义命令，保存后覆盖同命令的自动模板。
    const generated = Boolean(command?.generated);
    this.editingGenerated = generated;
    this.edit = {
      id: generated ? "" : (command?.id ?? ""),
      name: InputState.new({ value: command?.name ?? "", placeholder: "例如：启动开发服务器" }),
      command: InputState.new({ value: command?.command ?? "", placeholder: "例如：npm run dev" }),
      group: InputState.new({ value: command?.group ?? "", placeholder: "可选，例如：npm" }),
      description: InputState.new({ value: command?.description ?? "", placeholder: "可选，显示在命令右侧" }),
    };
    const bind = (field, state) => {
      state.on("change", (_event, cx) => cx.notify());
      state.on("focus", (_event, cx) => {
        this.editFocus = field;
        cx.notify();
      });
      state.on("submit", (_event, cx) => this.saveEditor(cx));
    };
    bind("name", this.edit.name);
    bind("command", this.edit.command);
    bind("group", this.edit.group);
    bind("description", this.edit.description);
    cx.timer.after(30, () => {
      if (this.mode === "edit" && this.edit && !this.closed) this.edit.name.focus();
    });
    cx.notify();
  }

  saveEditor(cx) {
    if (this.busy || this.mode !== "edit" || !this.edit) return;
    const name = this.edit.name.value().trim();
    const command = this.edit.command.value().trim();
    if (!name || !command) {
      this.editError = "名称和命令不能为空。";
      cx.notify();
      return;
    }
    const savedId = this.edit.id || makeId();
    const next = {
      id: savedId,
      name,
      command,
      group: this.edit.group.value().trim(),
      description: this.edit.description.value().trim(),
    };
    this.busy = true;
    this.editError = "";
    cx.notify();
    cx.spawn(async (cx) => {
      const ok = await this.persist((commands) => upsertCommand(commands, next));
      if (this.closed) return;
      this.busy = false;
      if (ok) {
        this.mode = "list";
        this.edit = null;
        this.editFocus = "";
        this.editingGenerated = false;
        this.filter = "";
        this.search.set_value("");
        this.at = Math.max(0, this.rows().findIndex((item) => item.id === savedId));
        this.confirmId = null;
        this.search.focus();
        this.ensureVisible();
        if (this.pendingReload) {
          this.pendingReload = false;
          await this.load(cx);
        }
      } else {
        this.editError = this.actionError || "保存失败，请重试。";
      }
      cx.notify();
    });
  }

  askDelete(command) {
    this.confirmId = command.id;
  }

  deleteCommand(cx) {
    const command = this.commands.find((item) => item.id === this.confirmId);
    if (!command || this.busy) return;
    this.busy = true;
    this.confirmId = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const ok = await this.persist((commands) => removeCommand(commands, command.id));
      if (this.closed) return;
      this.busy = false;
      if (ok) this.at = Math.min(this.at, Math.max(0, this.rows().length - 1));
      cx.notify();
    });
  }

  openInputs(command, cx) {
    const labels = scanVariables(command.command)
      .filter((variable) => variable.kind === "input")
      .map((variable) => variable.label);
    this.mode = "inputs";
    this.inputCmd = command;
    this.inputError = "";
    this.inputStates = {};
    this.inputFocus = labels[0] ?? "";
    for (const label of labels) {
      const state = InputState.new({ placeholder: label });
      state.on("change", (_event, cx) => cx.notify());
      state.on("focus", (_event, cx) => {
        this.inputFocus = label;
        cx.notify();
      });
      state.on("submit", (_event, cx) => this.runInputs(cx));
      this.inputStates[label] = state;
    }
    cx.timer.after(30, () => {
      if (this.mode === "inputs" && this.inputStates && !this.closed) {
        this.inputStates[labels[0]]?.focus();
      }
    });
    cx.notify();
  }

  runInputs(cx) {
    if (!this.inputCmd || !this.inputStates) return;
    const values = {};
    for (const [label, state] of Object.entries(this.inputStates)) values[label] = state.value();
    this.run(this.inputCmd, values, cx);
  }

  runSelected(cx) {
    const command = this.selected();
    if (!command) return;
    if (scanVariables(command.command).some((variable) => variable.kind === "input")) {
      this.openInputs(command, cx);
    } else {
      this.run(command, {}, cx);
    }
  }

  run(command, inputs, cx) {
    if (this.busy) return;
    const target = this.currentTarget();
    if (!target) {
      this.actionError = "没有聚焦的终端，无法发送命令。";
      notify({ title: "快捷命令", body: this.actionError, level: "warning" });
      cx.notify();
      return;
    }
    this.busy = true;
    this.actionError = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const values = await this.resolveValues(command.command, target, inputs);
        const text = expandCommand(command.command, values);
        const result = await hc(["send", "--", target.address, text]);
        if (result.code !== 0) {
          const detail = (result.stderr || result.stdout || `hc 退出码 ${result.code}`).trim();
          throw new Error(detail);
        }
        closeOverlay(props().overlay);
      } catch (error) {
        if (this.closed) return;
        this.busy = false;
        this.actionError = `运行失败：${errorMessage(error)}`;
        notify({ title: "快捷命令", body: this.actionError, level: "error" });
        cx.notify();
      }
    });
  }

  async resolveValues(command, target, inputs) {
    const variables = scanVariables(command);
    const kinds = new Set(variables.map((variable) => variable.kind));
    const now = new Date();
    const values = {
      cwd: target.cwd ?? "",
      home: home(),
      date: formatDate(now),
      time: formatTime(now),
      inputs: inputs ?? {},
      env: {},
    };
    if ((kinds.has("repo") || kinds.has("branch")) && !values.cwd) {
      throw new Error("当前终端没有工作目录，无法解析 ${repo} / ${branch}。");
    }
    if (kinds.has("repo") || kinds.has("branch")) {
      let root = "";
      try {
        const result = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: values.cwd, on: target.on });
        if (result.code === 0) root = result.stdout.trim();
      } catch {}
      values.repo = baseName(root || values.cwd);
      if (kinds.has("branch")) {
        let branch = "";
        try {
          const result = await exec("git", ["branch", "--show-current"], { cwd: values.cwd, on: target.on });
          if (result.code === 0) branch = result.stdout.trim();
        } catch {}
        if (!branch) {
          try {
            const result = await exec("git", ["rev-parse", "--short", "HEAD"], { cwd: values.cwd, on: target.on });
            if (result.code === 0) branch = result.stdout.trim();
          } catch {}
        }
        values.branch = branch;
      }
    }
    for (const variable of variables) {
      if (variable.kind === "env") values.env[variable.name] = await this.readEnv(variable.name, target);
    }
    return values;
  }

  async readEnv(name, target) {
    try {
      // 远程机器基本是 Unix；只有本地 Windows 才走 PowerShell。
      const posix = Boolean(target.on) || window()?.platform !== "windows";
      const options = { cwd: target.cwd || undefined, on: target.on };
      if (posix) {
        const result = await exec("printenv", [name], options);
        return result.code === 0 ? result.stdout.trim() : "";
      }
      const escaped = name.replace(/'/g, "''");
      const result = await exec("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        `[Environment]::GetEnvironmentVariable('${escaped}')`,
      ], options);
      return result.code === 0 ? result.stdout.trim() : "";
    } catch {
      return "";
    }
  }

  panelTitle() {
    if (this.mode === "edit") {
      if (this.editingGenerated) return "复制为自定义命令";
      return this.edit?.id ? "编辑命令" : "新增命令";
    }
    if (this.mode === "inputs") return "运行命令";
    return "快捷命令";
  }

  field(label, element, t) {
    return v_flex().w_full().gap(4).child(div().text_size(11).text_color(t.dim).child(label)).child(element);
  }

  inputBox(state, id, focused, t) {
    return h_flex().id(id).w_full().h(36).px(10).items_center().rounded(9).border_1()
      .border_color(focused ? t.accent : t.input).bg(t.background)
      .child(Input.new(state).flex_1().h_full().text_size(12.8).text_color(t.foreground));
  }

  button(id, label, kind, action, t) {
    const primary = kind === "primary";
    const danger = kind === "danger";
    const background = primary ? t.solid : t.raised;
    const foreground = primary ? t.solid_foreground : danger ? t.blocked : t.foreground;
    return h_flex().id(id).h(30).px(12).items_center().justify_center().rounded(7)
      .bg(background).border_1().border_color(t.border).text_color(foreground).text_size(12)
      .cursor_pointer().hover((style) => style.opacity(0.88))
      .on_click((_event, cx) => action(cx)).child(label);
  }

  linkButton(id, label, color, action, t) {
    return div().id(id).h(22).px(6).flex().items_center().rounded(5).text_size(10.5)
      .text_color(color).cursor_pointer().hover((style) => style.bg(t.hover))
      .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
      .on_click((_event, cx) => {
        cx.stop_propagation();
        action(cx);
      })
      .child(label);
  }

  errorBar(message, t, cx) {
    return h_flex().flex_none().w_full().px(10).py(7).gap(8).items_center().rounded(7).bg(t.raised)
      .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.blocked).child(message))
      .when(this.broken, (element) => element.child(this.linkButton("qc-reload", "重新加载", t.accent, (cx) => {
        cx.spawn(async (cx) => { await this.load(cx); });
      }, t)));
  }

  listRow(command, index, t, cx) {
    const selected = index === this.at;
    const group = command.group || (command.generated ? "" : "自定义");
    const badge = group
      ? div().px(6).h(17).flex().items_center().rounded(4).bg(t.raised).text_size(10)
        .text_color(command.generated ? t.accent : t.dim).child(group)
      : null;
    const hint = command.description
      ? div().flex_none().max_w(200).truncate().text_size(10.5).text_color(t.dim).child(command.description)
      : null;
    return h_flex().id(`qc-row-${command.id}`).w_full().px(10).gap(10).items_center().rounded(7)
      .bg(selected ? t.selected : t.popover)
      .when(!selected, (element) => element.hover((style) => style.bg(t.hover)))
      .on_click((_event, cx) => {
        this.at = index;
        this.runSelected(cx);
      })
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().gap(8).items_center()
          .child(div().text_size(13).font_medium().truncate().child(command.name))
          .when(Boolean(badge), (element) => element.child(badge)))
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(command.command))
          .when(Boolean(hint), (element) => element.child(hint))))
      .child(h_flex().flex_none().gap(2).items_center()
        .child(this.linkButton(`qc-edit-${command.id}`, command.generated ? "复制" : "编辑", t.muted,
          (cx) => this.openEditor(command, cx), t))
        .when(!command.generated, (element) => element.child(
          this.linkButton(`qc-del-${command.id}`, "删除", t.blocked, () => this.askDelete(command), t))));
  }

  renderList(t, cx) {
    const rows = this.rows();
    if (this.at >= rows.length) this.at = Math.max(0, rows.length - 1);
    const height = Math.max(ROW_HEIGHT, this.listHeight);
    const total = rows.length * ROW_HEIGHT;
    const fixed = total > height;
    const maxScroll = Math.max(0, total - height);
    this.scroll = clamp(this.scroll, 0, maxScroll);
    const confirm = this.commands.find((command) => command.id === this.confirmId);

    const list = v_flex().id("qc-list").relative().flex_1().min_h(0)
      .on_size_change((size, cx) => {
        this.listHeight = Math.max(ROW_HEIGHT, size.height / (settings().zoom || 1));
        cx.notify();
      })
      .when(fixed, (element) => element.overflow_hidden().on_scroll_wheel((event, cx) => {
        this.scroll = clamp(this.scroll - event.delta.y, 0, maxScroll);
        if (rows.length) this.at = clamp(Math.floor(this.scroll / ROW_HEIGHT), 0, rows.length - 1);
        cx.notify();
      }))
      .children(rows.map((command, index) => {
        const top = index * ROW_HEIGHT - this.scroll;
        if (fixed && (top + ROW_HEIGHT <= 0 || top >= height)) return null;
        const row = this.listRow(command, index, t, cx);
        if (!fixed) return row.h(ROW_HEIGHT);
        return row.absolute().left(0).right(0).top(top).bottom(height - (top + ROW_HEIGHT));
      }).filter(Boolean))
      .when(!rows.length, (element) => element.child(
        div().absolute().inset_0().flex().items_center().justify_center().text_size(12).text_color(t.dim)
          .child(this.filter ? "没有匹配的命令" : "还没有命令，按 Ctrl+N 新增")));

    return v_flex().flex_1().min_h(0).gap(8)
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
        .child(Input.new(this.search).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .child(h_flex().flex_none().w_full().px(2).gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.dim)
          .child(this.projectLoading
            ? "正在检测项目…"
            : this.projectError || (this.projectRoot ? `项目：${baseName(this.projectRoot)}` : "未检测到项目")))
        .when(!this.projectLoading, (element) => element.child(
          this.linkButton("qc-redetect", "重新检测", t.accent, (cx) => this.detectProject(cx), t))))
      .when(Boolean(this.loadError || this.actionError), (element) => element.child(
        this.errorBar(this.loadError || this.actionError, t, cx)))
      .child(list)
      .when(Boolean(confirm), (element) => element.child(
        h_flex().flex_none().w_full().px(10).py(8).gap(8).items_center().rounded(8).bg(t.raised)
          .child(div().flex_1().text_size(12).child(`删除「${confirm.name}」？`))
          .child(this.button("qc-cancel-delete", "取消", "normal", (cx) => {
            this.confirmId = null;
            cx.notify();
          }, t))
          .child(this.button("qc-do-delete", "删除", "danger", (cx) => this.deleteCommand(cx), t))))
      .child(h_flex().flex_none().w_full().items_center().gap(8)
        .child(div().flex_1().min_w(0).text_size(11).text_color(t.dim)
          .child(this.busy ? "正在发送…" : "↑↓ 选择 · Enter 运行 · Ctrl+N 新增 · Ctrl+E 编辑 · Esc 关闭"))
        .child(this.button("qc-add", "+ 新增", "normal", (cx) => this.openEditor(null, cx), t)));
  }

  renderEditor(t, cx) {
    const busy = this.busy;
    return v_flex().flex_1().min_h(0).w_full().gap(10)
      .child(this.field("名称", this.inputBox(this.edit.name, "qc-e-name", this.editFocus === "name", t), t))
      .child(this.field("命令", this.inputBox(this.edit.command, "qc-e-command", this.editFocus === "command", t), t))
      .child(h_flex().w_full().gap(10)
        .child(v_flex().flex_1().gap(4)
          .child(div().text_size(11).text_color(t.dim).child("分组"))
          .child(this.inputBox(this.edit.group, "qc-e-group", this.editFocus === "group", t)))
        .child(v_flex().flex_1().gap(4)
          .child(div().text_size(11).text_color(t.dim).child("说明"))
          .child(this.inputBox(this.edit.description, "qc-e-description", this.editFocus === "description", t))))
      .when(this.editingGenerated, (element) => element.child(
        div().text_size(10.5).text_color(t.accent)
          .child("自动模板不会写入配置；保存后生成一条自定义命令，同命令的自动模板会被隐藏。")))
      .child(div().text_size(10.5).text_color(t.dim).child(VARIABLE_HINT))
      .when(Boolean(this.editError), (element) => element.child(
        div().text_size(11.5).text_color(t.blocked).child(this.editError)))
      .child(div().flex_1())
      .child(h_flex().flex_none().justify_end().gap(8)
        .child(this.button("qc-e-cancel", "取消", "normal", (cx) => this.backToList(cx), t))
        .child(this.button("qc-e-save", busy ? "保存中…" : "保存", "primary", (cx) => this.saveEditor(cx), t)));
  }

  renderInputs(t, cx) {
    const command = this.inputCmd;
    const labels = Object.keys(this.inputStates ?? {});
    return v_flex().flex_1().min_h(0).w_full().gap(10)
      .child(v_flex().flex_none().gap(4)
        .child(div().text_size(11).text_color(t.dim).child("命令"))
        .child(div().w_full().px(10).py(8).rounded(7).bg(t.background).border_1().border_color(t.input)
          .text_size(11.5).text_color(t.muted).child(command?.command ?? "")))
      .children(labels.map((label) => v_flex().flex_none().gap(4)
        .child(div().text_size(11).text_color(t.dim).child(label))
        .child(this.inputBox(this.inputStates[label], `qc-i-${label}`, this.inputFocus === label, t))))
      .when(Boolean(this.inputError), (element) => element.child(
        div().text_size(11.5).text_color(t.blocked).child(this.inputError)))
      .child(div().flex_1())
      .child(h_flex().flex_none().justify_end().gap(8)
        .child(this.button("qc-i-cancel", "返回", "normal", (cx) => this.backToList(cx), t))
        .child(this.button("qc-i-run", this.busy ? "运行中…" : "运行", "primary", (cx) => this.runInputs(cx), t)));
  }

  render(cx) {
    const t = theme();
    const body = this.mode === "edit"
      ? this.renderEditor(t, cx)
      : this.mode === "inputs"
        ? this.renderInputs(t, cx)
        : this.renderList(t, cx);
    return v_flex().w_full().h(520).min_h(0).p(12).gap(8)
      .bg(t.popover).text_color(t.foreground).text_size(12.8)
      .id("qc-root").track_focus(this.handle).on_key_down((event, cx) => this.key(event, cx))
      .child(h_flex().flex_none().items_center().gap(8)
        .child(div().flex_1().text_size(15).font_semibold().child(this.panelTitle()))
        .child(div().text_size(11).text_color(t.dim).child(this.mode === "list" ? "Esc" : "Esc 返回")))
      .child(body);
  }
}
