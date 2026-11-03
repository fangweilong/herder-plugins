// 与 helper 共用的界面文案：i18n.json 里每种语言一张表，缺失的 key 回退到 en。
// 语言解析：config.language 为 zh/en 时强制；auto 时按系统 UI 语言，zh* → zh。

export function resolveLanguage(config, locale, layout) {
  const forced = String(config?.language ?? "auto").toLowerCase();
  if (forced === "zh" || forced === "en") return forced;
  // 中文布局是 Herdr 里最可靠的语言信号（zh / zh-win98 / zh-terminals）。
  const layoutName = String(layout ?? "").toLowerCase();
  if (layoutName === "zh" || layoutName.startsWith("zh-")) return "zh";
  const tag = String(locale ?? globalThis.Intl?.DateTimeFormat?.().resolvedOptions?.().locale ?? "en").toLowerCase();
  return tag.startsWith("zh") ? "zh" : "en";
}

export function makeT(dict, language) {
  const table = dict?.[language] ?? dict?.en ?? {};
  const fallback = dict?.en ?? {};
  return (key, vars = {}) => {
    let text = table[key] ?? fallback[key] ?? key;
    for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value));
    return text;
  };
}

const KEY_NAMES = {
  ctrl: "Ctrl",
  control: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  option: "Alt",
  meta: "Win",
  super: "Win",
  cmd: "Win",
  win: "Win",
  enter: "Enter",
  return: "Enter",
  esc: "Esc",
  escape: "Esc",
  tab: "Tab",
  space: "Space",
  backspace: "Backspace",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  pageup: "PgUp",
  pagedown: "PgDn",
  home: "Home",
  end: "End",
  delete: "Del",
};

export function formatShortcut(binding) {
  if (!binding) return "";
  return String(binding)
    .split(/[-+]/)
    .filter(Boolean)
    .map((part) => {
      const name = part.toLowerCase();
      if (KEY_NAMES[name]) return KEY_NAMES[name];
      if (part.length === 1) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("+");
}

export function findShortcut(keys, action) {
  const global = keys?.global ?? {};
  for (const [binding, value] of Object.entries(global)) {
    if (value === action) return formatShortcut(binding);
  }
  return "";
}
