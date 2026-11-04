// keys.json 的解析与改写：只做纯数据变换，不碰文件，不依赖 gpui。快捷键页与测试共用。

const MODS = {
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  shift: "shift",
  fn: "fn",
  function: "fn",
  cmd: "cmd",
  command: "cmd",
  meta: "cmd",
  super: "super",
  win: "win",
  secondary: "secondary",
};

// GPUI 的 keystroke 只认这些修饰键拼写；显示顺序固定，改键后文件内容稳定。
const MOD_ORDER = ["ctrl", "alt", "shift", "fn", "secondary", "cmd", "super", "win"];

const NAMED = new Set([
  "up",
  "down",
  "left",
  "right",
  "pageup",
  "pagedown",
  "home",
  "end",
  "insert",
  "delete",
  "backspace",
  "escape",
  "enter",
  "tab",
  "space",
  "capslock",
  "numlock",
  "scrolllock",
  "printscreen",
  "pause",
  "menu",
  "contextmenu",
  "plus",
  "minus",
]);

const KEY_ALIASES = {
  esc: "escape",
  return: "enter",
  ret: "enter",
  del: "delete",
  ins: "insert",
  pgup: "pageup",
  pgdn: "pagedown",
  page_up: "pageup",
  page_down: "pagedown",
  spacebar: "space",
};

function splitChord(text) {
  const tokens = [];
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "-" || ch === "+") {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
      // 末尾的分隔符就是字面量按键本身："ctrl--" / "ctrl-+" / "ctrl++"。
      if (i === text.length - 1) tokens.push(ch);
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

function normalizeKey(key) {
  if (key === "-" || key === "+") return key;
  if (key.length === 1) {
    const c = key.codePointAt(0);
    if (c > 32 && c < 127) return key;
    return null;
  }
  const alias = KEY_ALIASES[key];
  if (alias) return alias;
  if (NAMED.has(key)) return key;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) return key;
  return null;
}

/**
 * 把用户输入整理成 keys.json 里的 chord 拼写。
 * 接受 "Ctrl+Shift+K"、"ctrl-shift-k"、"ctrl--"（减号键）、"ctrl++"（加号键）。
 * @returns {{ chord?: string, error?: string }}
 */
export function normalizeChord(input) {
  const text = String(input ?? "").trim().toLowerCase();
  if (!text) return { error: "请输入按键组合" };
  if (/\s/.test(text)) return { error: "只支持单段组合（不要包含空格）" };
  const tokens = splitChord(text);
  if (tokens.length === 0) return { error: "请输入按键组合" };

  const mods = new Set();
  for (const token of tokens.slice(0, -1)) {
    const mod = MODS[token];
    if (!mod) return { error: `无法识别的修饰键「${token}」` };
    mods.add(mod);
  }
  const key = normalizeKey(tokens[tokens.length - 1]);
  if (!key) return { error: `无法识别的按键「${tokens[tokens.length - 1]}」` };

  return { chord: [...MOD_ORDER.filter((m) => mods.has(m)), key].join("-") };
}

/** keys() 的结果转成 keys.json 的形状；逃生快捷键由应用保留，不写回。 */
export function sectionsFromListing(list) {
  const doc = {};
  for (const entry of list) {
    if (entry.action === "app.reset" && entry.keys === "ctrl-alt-shift-escape") continue;
    (doc[entry.section] ??= {})[entry.keys] = entry.action;
  }
  return doc;
}

/**
 * 在 keys.json 对象上改一条绑定。
 * edit: { section, action, keys }（keys 为 null 表示新增；chord 为 null 表示删除）
 * @returns {{ error?: string }}
 */
export function updateBindings(doc, edit, chord) {
  const current = doc[edit.section];
  if (current !== undefined && (current === null || typeof current !== "object" || Array.isArray(current))) {
    return { error: `keys.json 里「${edit.section}」不是按键表，无法修改` };
  }
  const bindings = current ?? {};
  if (edit.keys && bindings[edit.keys] === edit.action) delete bindings[edit.keys];
  if (chord !== null) {
    const owner = bindings[chord];
    if (owner !== undefined && owner !== edit.action) {
      return { error: `该按键已绑定给「${owner}」，请先改掉它` };
    }
    bindings[chord] = edit.action;
  }
  if (Object.keys(bindings).length === 0) delete doc[edit.section];
  else doc[edit.section] = bindings;
  return {};
}