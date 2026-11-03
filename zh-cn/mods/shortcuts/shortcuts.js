// 设置 → 快捷键：列出 keys() 的合并结果（内置默认 + keys.json），按动作合并同一命令的多个绑定。

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { appHome, keys } from "herdr";

const MODNAMES = {
  ctrl: "Ctrl",
  control: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  option: "Alt",
  meta: "Meta",
  cmd: "Cmd",
  win: "Win",
  super: "Super",
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
  const m = /^((?:(?:ctrl|control|shift|alt|option|meta|cmd|win|super)-)*)(.*)$/.exec(binding);
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
  "layout.toggle:approval-relay-panel": "显示 / 隐藏审批中继",
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

export default function Shortcuts(t) {
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

  const chip = (k) =>
    div().px(7).py(3).rounded(5).border_1().border_color(t.border).bg(t.raised)
      .text_size(11.5).text_color(t.foreground).child(prettyKey(k));

  const row = (e) =>
    h_flex()
      .id(`st-key-${e.action.replace(/[^a-z0-9]+/gi, "-")}`)
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
          .child(div().text_size(11.5).text_color(t.dim).child(actionText(e.action))),
      )
      .child(h_flex().flex_none().gap(4).items_center().children(e.keys.sort().map(chip)));

  return v_flex()
    .w_full()
    .child(div().text_size(16).font_semibold().text_color(t.foreground).child("快捷键"))
    .child(
      div().pt(4).text_size(12.5).line_height("18px").text_color(t.dim)
        .child(`内置默认与 ${appHome().replace(/\\/g, "/")}/keys.json 的合并结果；改键后重新打开设置即可看到。`),
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
