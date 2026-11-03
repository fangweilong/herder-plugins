// The taskbar: Start, Quick Launch, the shown space's tabs as windows (the
// shown one pressed in; click it to minimize = settle), open games, and the
// tray: agents, the speaker, the clock. It also owns the layout's key
// commands ("win98.<command>" in keys.json) and plays the startup sound.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, panes, agents, run, shared, setShared, nextCommand, exec, layouts, home, settings, openOverlay, closeOverlay } from "herdr";
import {
  C, ASSETS, unit, root, bevel, button, etch, grip, icon, programIcon, sfx, apps, setApp, label, own,
  fitLayout, openMenu, openDialog, dither, perform,
} from "./kit.js";

// Agents the Start menu offers when installed: [command, name, icon].
const AGENTS = [
  ["claude", "Claude Code", "icons/claude.svg"],
  ["codex", "Codex", "icons/codex.svg"],
  ["pi", "Pi", "icons/pi.svg"],
  ["opencode", "OpenCode", "icons/opencode.svg"],
  ["amp", "Amp", "icons/amp.svg"],
  ["gemini", "Gemini", "icons/gemini.svg"],
  ["cursor-agent", "Cursor", "icons/cursor.svg"],
  ["copilot", "Copilot", "icons/copilot.svg"],
  ["grok", "Grok", "icons/grok.svg"],
  ["kimi", "Kimi", "icons/kimi.svg"],
  ["crush", "Crush", "icons/crush.svg"],
];

const GAMES = { mines: ["扫雷", "mines"], sol: ["纸牌", "sol"] };

function lead(all, tab) {
  const mine = all.filter((p) => p.tab === tab);
  return mine.find((p) => p.focused) ?? mine.find((p) => p.program?.agent) ?? mine[0];
}

function clock(d) {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const pm = h >= 12;
  h = h % 12 || 12;
  return `${h}:${m} ${pm ? "PM" : "AM"}`;
}

function longDate(d) {
  return d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

/** Seconds since the Herdr app started (exec's parent), or null where ps can't say. */
async function appAge() {
  try {
    const r = await exec("sh", ["-c", 'ps -o etime= -p "$PPID"']);
    const m = r.stdout.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
    if (!m) return null;
    const [, d, h, mi, s] = m.map((x) => Number(x) || 0);
    return ((d * 24 + h) * 60 + mi) * 60 + s;
  } catch {
    return null;
  }
}

export function userName() {
  const h = home() ?? "";
  const n = h.split(/[\\/]/).filter(Boolean).pop() ?? "用户";
  return n.charAt(0).toUpperCase() + n.slice(1);
}

export default class Taskbar {
  init(_p, cx) {
    this.now = new Date();
    this.installed = [];
    this.zoom = null;
    this.scale = null;
    const tick = (cx) => {
      this.now = new Date();
      cx.notify();
    };
    cx.timer.after(60000 - (Date.now() % 60000) + 50, (cx) => {
      tick(cx);
      cx.timer.every(60000, tick);
    });
    cx.spawn(async (cx) => {
      try {
        const names = AGENTS.map((a) => a[0]).join(" ");
        const r = await exec("sh", ["-c", `for c in ${names}; do command -v "$c" >/dev/null 2>&1 && echo "$c"; done`]);
        this.installed = r.stdout.split("\n").filter(Boolean);
      } catch {}
      cx.notify();
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        try {
          this.command(c);
        } catch (e) {
          console.log(`win98 taskbar: ${c} failed: ${e}`);
        }
        cx.notify();
      }
    });
    if (shared("win98.start")) setShared("win98.start", null);
    // Herdr just started with this layout on: always boot. Else (a switch to
    // it, a reload of the mod) the half-hour rule below.
    cx.spawn(async () => {
      const age = await appAge();
      this.boot(age !== null && age < 45);
    });
  }

  // Coming into Herdr 98: the boot screen and the welcome (at most every half
  // hour unless forced), else just the chime (not on every reload of the mod).
  boot(force = false) {
    const now = Date.now();
    const last = force ? 0 : Number(shared("win98.boot")) || 0;
    const seen = Number(shared("win98.init")) || 0;
    setShared("win98.init", now);
    if (now - last > 30 * 60 * 1000) {
      setShared("win98.boot", now);
      openOverlay({ mod: "win98", kind: "dialog", frame: "none", modal: true, width: 1, height: 1, props: { role: "dialog", kind: "screen", mode: "boot" } });
    } else if (now - seen > 20 * 1000) sfx("startup");
  }

  space() {
    return spaces().find((s) => s.active);
  }

  command(c) {
    const s = this.space();
    const tab = s?.tabs.find((t) => t.active);
    switch (c) {
      case "start":
        return this.toggleStart(this.startBounds ?? (this.screen ? { x: this.screen.x, y: this.screen.y } : null));
      case "new_tab":
        return openDialog("prompt", { title: "新建标签页", text: "输入新标签页的名称：", icon: "dos", command: { name: "tab.new", args: {} } });
      case "new_space":
        return openDialog("prompt", { title: "新建空间", text: "输入新空间的名称：", icon: "folder", machines: true, command: { name: "space.new", args: {} } });
      case "rename_tab":
        if (tab) openDialog("prompt", { title: "重命名", text: "输入此标签页的新名称：", icon: "rename", value: tab.name, command: { name: "tab.rename", args: { id: tab.id } } });
        return;
      case "rename_space":
        if (s) openDialog("prompt", { title: "重命名", text: "输入此空间的新名称：", icon: "folder", value: s.name, command: { name: "space.rename", args: { id: s.id } } });
        return;
      case "close_tab":
        if (tab) openDialog("confirm", closeTabAsk(s, tab));
        return;
      case "close_space":
        if (s) openDialog("confirm", closeSpaceAsk(s));
        return;
      case "taskman":
        return openDialog("taskman", {});
      case "run":
        return openDialog("run", {});
      case "shutdown":
        return openDialog("shutdown", {});
      case "about":
        return openDialog("about", {});
      case "display":
        return openDialog("display", {});
      case "welcome":
        return openDialog("welcome", {});
      case "boot":
        return this.boot(true);
      case "small_fonts":
        return setShared("win98.scale", 1);
      case "large_fonts":
        return setShared("win98.scale", 2);
      case "mines":
      case "sol":
        return setApp(c, "open");
      case "mycomputer":
      case "network":
      case "bin":
      case "datetime":
      case "logoff":
        return openDialog(c, {});
    }
  }

  // ---- the games' windows: one per open (or minimized) game, by key, so each
  // comes back where it was dragged last; a minimized game draws nothing.

  syncGames() {
    this.wins ??= {};
    const open = apps();
    for (const k of Object.keys(GAMES)) {
      if (open[k] && !this.wins[k]) {
        const id = openOverlay({ mod: "win98", kind: "window", frame: "none", key: k, props: { role: k } });
        this.wins[k] = id;
      } else if (!open[k] && this.wins[k]) {
        closeOverlay(this.wins[k]);
        delete this.wins[k];
      }
    }
  }

  // ---- the Start menu

  startItems() {
    const s = this.space();
    const agentItems = AGENTS.filter((a) => this.installed.includes(a[0])).map(([cmd, name, ico]) => ({
      label: name,
      img: ico,
      act: { run: ["tab.new", { name, argv: [cmd] }] },
    }));
    const spaceItems = spaces().map((p, i) => ({
      label: `${i < 9 ? `&${i + 1} ` : ""}${p.name}`,
      icon: p.active ? "folder-open" : "folder",
      act: { run: ["space.select", { id: p.id }] },
    }));
    const layoutItems = layouts().map((name) => ({
      label: name === "win98" ? "Herdr 98" : name,
      radio: name === "win98",
      act: { run: ["layout.switch", { name }] },
    }));
    return [
      { label: "Herdr 更新", icon: "update", act: { run: ["app.settings", { section: "updates" }] } },
      { sep: true },
      {
        label: "程序",
        icon: "programs",
        sub: [
          {
            label: "附件",
            icon: "programs",
            sub: [
              { label: "游戏", icon: "programs", sub: [
                { label: "扫雷", icon: "mines", act: { app: "mines" } },
                { label: "纸牌", icon: "sol", act: { app: "sol" } },
              ] },
              { label: "Office 助手", icon: "clippy", act: { shared: ["win98.clippy", "on"] } },
              { label: "欢迎使用 Herdr 98", icon: "start", act: { dialog: { kind: "welcome" } } },
              { label: "命令面板", icon: "find", act: { run: ["app.palette", {}] } },
            ],
          },
          { label: "智能体", icon: "programs", sub: agentItems.length ? agentItems : [{ label: "（空）", disabled: true }] },
          { label: "DOS 提示符", icon: "dos", act: { run: ["tab.new", { name: "DOS 提示符" }] } },
          { label: "新建空间...", icon: "folder", act: { dialog: { kind: "prompt", title: "新建空间", text: "输入新空间的名称：", icon: "folder", machines: true, command: { name: "space.new", args: {} } } } },
        ],
      },
      { label: "空间", icon: "documents", sub: spaceItems.length ? spaceItems : [{ label: "（空）", disabled: true }] },
      {
        label: "设置",
        icon: "settings",
        sub: [
          { label: "控制面板", icon: "control", act: { run: ["app.settings", {}] } },
          { label: "显示...", icon: "display", act: { dialog: { kind: "display" } } },
          { label: "布局", icon: "programs", sub: layoutItems },
          { label: "任务栏和开始菜单...", icon: "taskbar", act: { dialog: { kind: "display" } } },
        ],
      },
      {
        label: "查找",
        icon: "find",
        sub: [
          { label: "命令...", icon: "find", act: { run: ["app.palette", {}] } },
          { label: "智能体...", icon: "find", act: { dialog: { kind: "taskman" } } },
        ],
      },
      { label: "帮助", icon: "help", act: { run: ["app.help", {}] } },
      { label: "运行...", icon: "run", act: { dialog: { kind: "run" } } },
      { sep: true },
      { label: `注销 ${userName()}...`, icon: "logoff", act: { dialog: { kind: "logoff" } } },
      { label: "关闭系统...", icon: "shutdown", act: { dialog: { kind: "shutdown" } } },
    ];
  }

  toggleStart(bounds) {
    if (shared("win98.start")) {
      setShared("win98.start", null);
      return;
    }
    sfx("start");
    const id = openMenu(this.startItems(), bounds ? { above: bounds } : undefined, { start: true });
    setShared("win98.start", id);
  }

  // ---- render

  tabButton(u, t, all) {
    const p = lead(all, t.id);
    const flash = t.status === "blocked";
    const pressed = t.active && !t.settled;
    const fg = flash ? C.selectText : C.text;
    const badge = t.status === "working" ? "hourglass" : t.status === "done" ? "check-badge" : null;
    const face = h_flex()
      .relative()
      .flex_1()
      .min_w(0)
      .h_full()
      .items_center()
      .gap(u(3))
      .when(pressed && !flash, (el) => el.child(dither(u)))
      .when(flash, (el) => el.bg(C.select))
      .child(
        div()
          .relative()
          .flex_none()
          .child(programIcon(u, p?.program, 16))
          .when(Boolean(badge), (el) =>
            el.child(
              div()
                .absolute()
                .right(u(-3))
                .bottom(u(-3))
                .child(icon(u, badge, 9))
                .when(badge === "hourglass", (b) => b.loop("opacity", { from: 0.35, to: 1, period: 1400 })),
            ),
          ),
      )
      .child(div().relative().flex_1().min_w(0).truncate().text_color(fg).when(pressed, (el) => el.font_weight(700)).child(t.name));
    return button(
      u,
      `tb-${t.id}`,
      face,
      () => {
        if (pressed) run("tab.settle", { id: t.id });
        else run("tab.select", { id: t.id });
      },
      {
        toggled: pressed,
        pad: [0, 3],
        h: 22,
        tooltip: `${t.name}${p?.program ? ` - ${p.program.name}` : ""}${t.status ? ` (${ { working: "工作中", blocked: "需要你", done: "已完成", idle: "空闲" }[t.status] ?? t.status })` : ""}`,
        onRight: () =>
          openMenu([
            { label: "还原", act: { run: ["tab.select", { id: t.id }] }, disabled: pressed },
            { label: "最小化", act: { run: ["tab.settle", { id: t.id }] }, disabled: t.settled },
            { label: "最大化", act: { run: ["pane.zoom", {}] }, disabled: !t.active },
            { sep: true },
            { label: "重命名...", act: { dialog: { kind: "prompt", title: "重命名", text: "输入此标签页的新名称：", icon: "rename", value: t.name, command: { name: "tab.rename", args: { id: t.id } } } } },
            { sep: true },
            { label: "关闭", bold: true, shortcut: "Alt+F4", act: { run: ["tab.close", { id: t.id }] } },
          ]),
      },
    )
      .flex_1()
      .min_w(u(40))
      .max_w(u(160));
  }

  gameButton(u, key, state) {
    const [name, ico] = GAMES[key];
    const open = state === "open";
    const face = h_flex()
      .relative()
      .flex_1()
      .min_w(0)
      .h_full()
      .items_center()
      .gap(u(3))
      .when(open, (el) => el.child(dither(u)))
      .child(div().relative().child(icon(u, ico, 16)))
      .child(div().relative().flex_1().min_w(0).truncate().when(open, (el) => el.font_weight(700)).child(name));
    return button(u, `tg-${key}`, face, () => setApp(key, open ? "min" : "open"), {
      toggled: open,
      pad: [0, 3],
      h: 22,
      onRight: () =>
        openMenu([
          { label: "还原", act: { app: key }, disabled: open },
          { label: "最小化", act: { shared: ["win98.apps", { ...apps(), [key]: "min" }] }, disabled: !open },
          { sep: true },
          { label: "关闭", bold: true, act: { shared: ["win98.apps", Object.fromEntries(Object.entries(apps()).filter(([k]) => k !== key))] } },
        ]),
    })
      .flex_1()
      .min_w(u(40))
      .max_w(u(160));
  }

  quick(u, id, ico, tip, act) {
    // Flat until hovered, then a 1 px raised bump (two nested edges).
    const none = "#00000000";
    const inner = div()
      .size_full()
      .flex()
      .items_center()
      .justify_center()
      .border_t(u(1))
      .border_l(u(1))
      .border_color(none)
      .hover((s) => s.border_color(C.hi))
      .child(typeof ico === "string" ? icon(u, ico, 16) : ico);
    return own(
      div()
        .id(`ql-${id}`)
        .flex_none()
        .w(u(23))
        .h(u(22))
        .flex()
        .border_r(u(1))
        .border_b(u(1))
        .border_color(none)
        .hover((s) => s.border_color(C.shadow))
        .tooltip(tip)
        .on_click(() => perform(act))
        .child(inner),
    );
  }

  tray(u) {
    const list = agents().slice(0, 10);
    const mute = shared("win98.mute") === true;
    const icons = list.map((a) => {
      const badge = a.status === "working" ? "hourglass" : a.status === "blocked" ? "warn-badge" : a.status === "done" ? "check-badge" : null;
      return own(
        div()
          .id(`tray-${a.address}`)
          .relative()
          .flex_none()
          .tooltip(`${a.program?.name ?? a.app ?? "智能体"}：${{ working: "工作中", blocked: "需要你", done: "已完成", idle: "空闲" }[a.status] ?? a.status} - ${a.space_name} \\ ${a.tab_name}`)
          .on_click(() => run("agent.focus", { terminal: a.address }))
          .child(programIcon(u, a.program, 16))
          .when(Boolean(badge), (el) =>
            el.child(
              div()
                .absolute()
                .right(u(-2))
                .bottom(u(-2))
                .child(icon(u, badge, 9))
                .when(a.status === "blocked", (b) => b.loop("opacity", { from: 0, to: 1, period: 900 })),
            ),
          ),
      );
    });
    const content = h_flex()
      .h_full()
      .items_center()
      .gap(u(3))
      .px(u(2))
      .children(icons)
      .child(
        own(div().id("tray-speaker").flex_none().tooltip(mute ? "声音：关" : "音量").on_click((_e, cx) => {
          setShared("win98.mute", !mute);
          cx.notify();
        })).child(icon(u, mute ? "speaker-mute" : "speaker", 16)),
      )
      .child(
        own(div().id("tray-clock").flex_none().pl(u(4)).pr(u(2)).tooltip(longDate(this.now)).on_click((e) => {
          if (e.click_count >= 2) openDialog("datetime", {});
        })).child(clock(this.now)),
      );
    return bevel(u, "well", content, { pad: [0, 0] }).h(u(22)).flex_none();
  }

  render(cx) {
    const u = unit();
    // Keep the bars whole Win98 pixels when the zoom or the scale changes.
    const z = settings()?.zoom;
    const sc = shared("win98.scale");
    if (z !== this.zoom || sc !== this.scale) {
      this.zoom = z;
      this.scale = sc;
      cx.spawn(async () => fitLayout());
    }
    this.syncGames();
    const s = this.space();
    const all = panes();
    const startOpen = Boolean(shared("win98.start"));
    const tabs = (s?.tabs ?? []).map((t) => this.tabButton(u, t, all));
    const games = Object.entries(apps())
      .filter(([k]) => GAMES[k])
      .map(([k, v]) => this.gameButton(u, k, v));

    const start = button(
      u,
      "start",
      h_flex().gap(u(3)).items_center().child(icon(u, "start", 16)).child(label("开始", { bold: true })),
      null,
      {
        toggled: startOpen,
        pad: [0, 3],
        h: 22,
        onDown: (e) => {
          this.startBounds = e.bounds;
          this.toggleStart(e.bounds);
        },
      },
    ).flex_none();

    const ql = [
      this.quick(u, "dos", "dos", "DOS 提示符", { run: ["tab.new", { name: "DOS 提示符" }] }),
      ...AGENTS.filter((a) => this.installed.includes(a[0]))
        .slice(0, 2)
        .map(([cmd, name, ico]) => this.quick(u, cmd, programIcon(u, { icon: ico, tint: false }, 16), name, { run: ["tab.new", { name, argv: [cmd] }] })),
      this.quick(u, "mines", "mines", "扫雷", { app: "mines" }),
    ];

    return root(
      u,
      v_flex()
        .id("taskbar")
        .size_full()
        .bg(C.face)
        .on_mouse_move((e) => {
          if (e.bounds) this.screen = e.bounds;
        }),
    )
      .child(div().flex_none().h(u(1)).w_full().bg(C.light))
      .child(div().flex_none().h(u(1)).w_full().bg(C.hi))
      .child(
        h_flex()
          .flex_1()
          .min_h(0)
          .items_center()
          .px(u(2))
          .gap(u(2))
          .child(start)
          .child(div().h(u(20)).child(etch(u, true)))
          .child(grip(u))
          .child(h_flex().flex_none().gap(u(1)).items_center().children(ql))
          .child(div().h(u(20)).child(etch(u, true)))
          .child(grip(u))
          .child(h_flex().flex_1().min_w(0).gap(u(3)).items_center().children([...tabs, ...games]))
          .child(this.tray(u)),
      );
  }
}

export function closeTabAsk(s, tab) {
  return {
    title: "关闭标签页",
    icon: "warning",
    text: `Are you sure you want to close '${tab.name}'?\nIts programs will be ended.`,
    buttons: [
      { label: "是", default: true, act: { run: ["tab.close", { id: tab.id }] } },
      { label: "&No" },
    ],
  };
}

export function closeSpaceAsk(s) {
  return {
    title: "确认删除文件夹",
    icon: "warning",
    text: `Are you sure you want to close the space '${s.name}' and all its tabs?\nEvery program in it will be ended.`,
    buttons: [
      { label: "是", default: true, act: { run: ["space.close", { id: s.id, confirmed: true }] } },
      { label: "&No" },
    ],
  };
}
