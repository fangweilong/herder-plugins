// 设置 → 快捷键：列出 keys.json 的绑定（首次启动时由内置默认生成），并就地改键。
//
// keys.json 是完整按键表，不是补丁：改键 = 删掉旧 chord、写入新 chord，应用会实时重载。
// 编辑状态放在模块里，因为设置页每次渲染都会重新调用本函数；输入框只用 InputState。

import { div } from "gpui-kit";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import { appHome, keys, readTextFile, writeTextFile } from "herdr";
import { normalizeChord, sectionsFromListing, updateBindings } from "./keys-edit.js";

const MODNAMES = {
  ctrl: "Ctrl",
  control: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  option: "Alt",
  fn: "Fn",
  function: "Fn",
  meta: "Meta",
  cmd: "Cmd",
  win: "Win",
  super: "Super",
  secondary: "Secondary",
};

const KEYNAMES = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  pageup: "PageUp",
  pagedown: "PageDown",
  backspace: "Backspace",
  escape: "Esc",
  enter: "Enter",
  tab: "Tab",
  space: "Space",
  delete: "Delete",
  home: "Home",
  end: "End",
  insert: "Insert",
  plus: "+",
  minus: "-",
};

// "ctrl-shift-p" → "Ctrl+Shift+P"；"ctrl--" → "Ctrl+-"。
function prettyKey(binding) {
  const m = /^((?:(?:ctrl|control|shift|alt|option|meta|cmd|win|super|fn|function|secondary)-)*)(.*)$/.exec(binding);
  if (!m) return binding;
  const mods = m[1].split("-").filter(Boolean).map((x) => MODNAMES[x] ?? x);
  const raw = m[2];
  const key = raw.length === 1
    ? raw.toUpperCase()
    : (KEYNAMES[raw.toLowerCase()] ?? raw.charAt(0).toUpperCase() + raw.slice(1));
  return [...mods, key].join("+");
}

const DIRS = { left: "左", right: "右", up: "上", down: "下" };

const LABELS = {
  "app.help": "显示快捷键与帮助",
  "app.palette": "打开命令面板",
  "app.settings": "打开设置",
  "app.reset": "重置布局与按键（逃生）",
  "app.zoom_in": "放大界面",
  "app.zoom_out": "缩小界面",
  "app.zoom_reset": "重置缩放",
  "layout.switch": "切换到下一个布局",
  "layout.toggle:sidebar": "显示 / 隐藏侧栏",
  "mod.open:picker": "打开选择器",
  "space.new": "新建空间",
  "space.prev": "上一个空间",
  "space.next": "下一个空间",
  "space.rename": "重命名空间",
  "tab.new": "新建标签",
  "tab.prev": "上一个标签",
  "tab.next": "下一个标签",
  "tab.close": "关闭标签",
  "tab.rename": "重命名标签",
  "agent.prev": "上一个智能体",
  "agent.next": "下一个智能体",
  "pane.close": "关闭窗格",
  "pane.zoom": "放大 / 还原窗格",
  "terminal.copy": "复制",
  "terminal.paste": "粘贴",
  "terminal.paste_image": "粘贴图片",
};

// send:<控制字符>：让终端程序直接收到这些字节。
function sentText(text) {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c === 27) out += "Esc ";
    else if (c === 9) out += "Tab ";
    else if (c === 13) out += "Enter ";
    else if (c === 127) out += "Del ";
    else if (c >= 1 && c <= 26) out += `Ctrl+${String.fromCharCode(64 + c)} `;
    else out += ch;
  }
  return out.trim();
}

function describe(action) {
  if (LABELS[action]) return LABELS[action];
  const i = action.indexOf(":");
  const name = i < 0 ? action : action.slice(0, i);
  const arg = i < 0 ? "" : action.slice(i + 1);
  if (name === "space.select") return `切换到空间 ${arg}`;
  if (name === "tab.select") return `切换到标签 ${arg}`;
  if (name === "pane.go") return `聚焦${DIRS[arg] ?? arg}侧窗格`;
  if (name === "pane.swap") return `与${DIRS[arg] ?? arg}侧窗格交换`;
  if (name === "pane.split") return arg === "down" ? "向下拆分窗格" : "向右拆分窗格";
  if (name === "layout.toggle") return `切换 ${arg}`;
  if (name === "send") return `直接发送 ${sentText(arg)}`;
  if (LABELS[name]) return LABELS[name];
  return action;
}

// 第二行的动作 id：send 的控制字符不能直接显示。
function actionText(action) {
  const i = action.indexOf(":");
  if (i < 0 || action.slice(0, i) !== "send") return action;
  return `send: ${sentText(action.slice(i + 1))}`;
}

const SECTION_TITLES = { global: "全局", terminal: "终端" };

// 编辑状态要跨渲染保存；一次只改一条绑定。
const state = { edit: null };

// 对象动作（{"command":...}）和多段组合不在本页改写；逃生键由应用保留。
function locked(entry, binding) {
  return (
    (entry.action === "app.reset" && binding === "ctrl-alt-shift-escape") ||
    entry.action.trim().startsWith("{") ||
    /\s/.test(binding)
  );
}

function startEdit(cx, section, action, binding) {
  const input = InputState.new({
    value: binding ? prettyKey(binding) : "",
    placeholder: "如 ctrl-shift-k",
  });
  input.on("submit", (_event, cx) => commit(cx));
  state.edit = { section, action, keys: binding ?? null, input, error: null };
  cx.timer.after(60, (cx) => {
    if (state.edit?.input === input) input.focus();
  });
  cx.notify();
}

function endEdit() {
  state.edit = null;
}

// keys.json 是完整按键表；读—改—写，写失败说明文件被同时改了，重读再来。
async function applyChange(edit, chord) {
  const file = `${appHome()}/keys.json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let raw;
    try {
      raw = await readTextFile(file);
    } catch (error) {
      return `读取 keys.json 失败：${String(error?.message ?? error)}`;
    }
    let doc;
    if (raw === null) {
      doc = sectionsFromListing(keys());
    } else {
      try {
        doc = JSON.parse(raw);
      } catch {
        return "keys.json 不是有效的 JSON，请先修复它";
      }
    }
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
      return "keys.json 的结构不支持编辑";
    }
    const result = updateBindings(doc, edit, chord);
    if (result.error) return result.error;
    try {
      await writeTextFile(file, JSON.stringify(doc, null, 2) + "\n", raw);
      return null;
    } catch {}
  }
  return "keys.json 正在被其他程序修改，请重试";
}

function commit(cx) {
  const edit = state.edit;
  if (!edit) return;
  const parsed = normalizeChord(edit.input.value());
  if (parsed.error) {
    edit.error = parsed.error;
    cx.notify();
    return;
  }
  if (parsed.chord === "ctrl-alt-shift-escape") {
    edit.error = "该组合由 Herdr 保留（应急重置），不能绑定";
    cx.notify();
    return;
  }
  cx.spawn(async (cx) => {
    const problem = await applyChange(edit, parsed.chord);
    if (problem) {
      edit.error = problem;
      cx.notify();
      return;
    }
    endEdit();
    cx.notify();
  });
}

function remove(cx) {
  const edit = state.edit;
  if (!edit?.keys) return;
  cx.spawn(async (cx) => {
    const problem = await applyChange(edit, null);
    if (problem) {
      edit.error = problem;
      cx.notify();
      return;
    }
    endEdit();
    cx.notify();
  });
}

function button(t, id, label, onClick) {
  return div()
    .id(id)
    .px(10)
    .py(4)
    .rounded(6)
    .border_1()
    .border_color(t.border)
    .bg(t.raised)
    .cursor_pointer()
    .text_size(12)
    .text_color(t.foreground)
    .hover((s) => s.bg(t.hover))
    .on_click(onClick)
    .child(label);
}

export default function Shortcuts(t, cx) {
  const merged = new Map();
  for (const k of keys()) {
    const id = `${k.section}\u0000${k.action}`;
    const entry = merged.get(id) ?? { section: k.section, action: k.action, keys: [] };
    entry.keys.push(k.keys);
    merged.set(id, entry);
  }
  // 保持 keys() 的原有顺序（与默认绑定表的逻辑顺序一致），只把同一动作的多个键合并。
  const list = [...merged.values()];
  const order = ["global", "terminal"];
  const sections = [...new Set(list.map((e) => e.section))]
    .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));

  const editingHere = (e) => state.edit?.section === e.section && state.edit.action === e.action;

  const chip = (e, binding) => {
    const fixed = locked(e, binding);
    return div()
      .id(`st-key-${e.section}-${e.action}-${binding}`.replace(/[^a-z0-9]+/gi, "-"))
      .px(7)
      .py(3)
      .rounded(5)
      .border_1()
      .border_color(t.border)
      .bg(t.raised)
      .text_size(11.5)
      .text_color(fixed ? t.dim : t.foreground)
      .when(!fixed, (el) =>
        el
          .cursor_pointer()
          .hover((s) => s.bg(t.hover).border_color(t.accent))
          .on_click((_event, cx) => startEdit(cx, e.section, e.action, binding)),
      )
      .child(prettyKey(binding));
  };

  const addChip = (e) => {
    if (locked(e, "x")) return div();
    return div()
      .id(`st-key-add-${e.section}-${e.action}`.replace(/[^a-z0-9]+/gi, "-"))
      .px(7)
      .py(3)
      .rounded(5)
      .border_1()
      .border_color(t.border)
      .cursor_pointer()
      .text_size(11.5)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_event, cx) => startEdit(cx, e.section, e.action, null))
      .child("+");
  };

  const editor = (e) => {
    const edit = state.edit;
    return h_flex()
      .flex_none()
      .gap(6)
      .items_center()
      .child(div().w(210).child(Input.new(edit.input).h(28).text_color(t.foreground)))
      .child(button(t, `st-key-save-${e.action}`, "保存", (_event, cx) => commit(cx)))
      .child(button(t, `st-key-cancel-${e.action}`, "取消", (_event, cx) => (endEdit(), cx.notify())))
      .when(Boolean(edit.keys), (el) =>
        el.child(
          div()
            .id(`st-key-remove-${e.action}`)
            .px(8)
            .py(4)
            .rounded(6)
            .cursor_pointer()
            .text_size(12)
            .text_color(t.dim)
            .hover((s) => s.text_color(t.blocked))
            .on_click((_event, cx) => remove(cx))
            .child("删除"),
        ),
      );
  };

  const row = (e) =>
    h_flex()
      .id(`st-key-${e.section}-${e.action}`.replace(/[^a-z0-9]+/gi, "-"))
      .w_full()
      .gap(16)
      .py(10)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(3)
          .child(div().text_size(13.5).text_color(t.foreground).child(describe(e.action)))
          .child(div().text_size(11.5).text_color(t.dim).child(actionText(e.action)))
          .when(editingHere(e) && state.edit.error, (el) =>
            el.child(div().text_size(11.5).text_color(t.blocked).child(state.edit.error)),
          ),
      )
      .child(
        editingHere(e)
          ? editor(e)
          : h_flex()
              .flex_none()
              .gap(4)
              .items_center()
              .children(e.keys.sort().map((binding) => chip(e, binding)))
              .child(addChip(e)),
      );

  return v_flex()
    .w_full()
    .child(div().text_size(16).font_semibold().text_color(t.foreground).child("快捷键"))
    .child(
      div().pt(4).text_size(12.5).line_height("18px").text_color(t.dim)
        .child(
          `来自 ${appHome().replace(/\\/g, "/")}/keys.json（首次启动时由内置默认生成）。` +
            "点击按键即可修改，回车保存，立即生效；+ 为同一动作添加另一个键。",
        ),
    )
    .children(
      sections.map((s) =>
        v_flex()
          .w_full()
          .pt(16)
          .child(div().text_size(11).text_color(t.dim).child(SECTION_TITLES[s] ?? s))
          .children(list.filter((e) => e.section === s).map(row)),
      ),
    );
}