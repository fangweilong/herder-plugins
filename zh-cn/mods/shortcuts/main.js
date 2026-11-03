// 设置里的「快捷键」页：Herdr 每次启动都会用自带内容还原 frame/，所以本 mod 在启动后
// 把这一页注入 frame/settings/main.js，并放入 frame/settings/shortcuts.js（页面本体）与
// keyboard.svg（导航图标）。
//
// 与 zh-cn 语言包写同一个文件：语言包每次启动只写一次，写完的文件带中文标记。本 mod 先等
// 中文标记出现（没装语言包时最多等 4 秒）再注入；注入只按代码锚点匹配，不动语言包的文案。
// 热重载可能同时跑两个本 mod 的实例，用 mkdir 原子锁把写入串行化。
// 沙箱里的 fs/promises 只有 exists/mkdir/readFile/readdir/rmdir/unlink/writeFile，没有
// stat/rename/rm/appendFile。

import { View, div } from "gpui-kit";
import * as fsp from "fs/promises";
import { appHome, notify } from "herdr";

const MARK = "st-s-keys";
const LOCK = ".shortcuts-lock";
const TRANSLATED = 'child("设置")';

// 导入行会随版本增删名字（0.1.12 加了 window），只按结构匹配。
const IMPORT = /^import \{[^\n]*\} from "herdr";$/m;
const NAV =
  '        }),\n' +
  '      );\n' +
  '    return h_flex()\n' +
  '      .id("settings")';

const PAGE =
  '                    this.section === "look"\n' +
  '                      ? this.look(t, cx)';

const RENDER = "  render(cx) {";

const NAV_NEW =
  '        }),\n' +
  '      )\n' +
  '      .child(this.navKeys(t));\n' +
  '    return h_flex()\n' +
  '      .id("settings")';

const PAGE_NEW =
  '                    this.section === "look"\n' +
  '                      ? this.look(t, cx)\n' +
  '                      : this.section === "keys"\n' +
  '                        ? Shortcuts(t)';

const RENDER_NEW =
  '  navKeys(t) {\n' +
  '    const on = this.section === "keys";\n' +
  '    return h_flex()\n' +
  '      .id("st-s-keys")\n' +
  '      .gap(10)\n' +
  '      .px(10)\n' +
  '      .py(7)\n' +
  '      .items_center()\n' +
  '      .rounded(7)\n' +
  '      .cursor_pointer()\n' +
  '      .bg(on ? t.raised : "#00000000")\n' +
  '      .hover((st) => st.bg(t.raised))\n' +
  '      .on_click((_e, cx) => {\n' +
  '        this.section = "keys";\n' +
  '        this.picking = null;\n' +
  '        this.machineEdit = null;\n' +
  '        this.handle.focus();\n' +
  '        cx.notify();\n' +
  '      })\n' +
  '      .child(svg(I("keyboard")).size(15).text_color(on ? t.accent : t.dim))\n' +
  '      .child(div().flex_1().text_size(13.5).text_color(on ? t.foreground : t.muted).child("快捷键"));\n' +
  '  }\n' +
  '\n' +
  '  render(cx) {';

const icon = `<svg
  class="lucide lucide-keyboard"
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <rect width="20" height="16" x="2" y="4" rx="2" />
  <path d="M6 8h.01" />
  <path d="M8 12h.01" />
  <path d="M10 8h.01" />
  <path d="M12 12h.01" />
  <path d="M14 8h.01" />
  <path d="M16 12h.01" />
  <path d="M18 8h.01" />
  <path d="M7 16h10" />
  <path d="M12 16h.01" />
  <path d="M16 16h.01" />
</svg>
`;

// 所有锚点都在才注入；Herdr 改版后锚点缺失就原样返回，绝不写坏设置界面。
function inject(text) {
  if (text.includes(MARK)) return text;
  if (!IMPORT.test(text) || !text.includes(NAV) || !text.includes(PAGE) || !text.includes(RENDER)) return text;
  return text
    .replace(IMPORT, (line) => `${line}\nimport Shortcuts from "./shortcuts.js";`)
    .replace(NAV, NAV_NEW)
    .replace(PAGE, PAGE_NEW)
    .replace(RENDER, RENDER_NEW);
}

const wait = (cx, ms) => new Promise((resolve) => cx.timer.after(ms, () => resolve()));

async function writeIfChanged(path, text) {
  const old = await fsp.readFile(path, "utf8").catch(() => null);
  if (old !== text) await fsp.writeFile(path, text, "utf8");
}

// mkdir 是原子的：抢到目录才算拿到锁；超过 15 秒的锁当作上次崩溃留下的。
async function acquire(cx, home) {
  const dir = `${home}/${LOCK}`;
  for (let i = 0; i < 150; i++) {
    try {
      await fsp.mkdir(dir);
      await fsp.writeFile(`${dir}/at`, String(Date.now()), "utf8");
      return true;
    } catch {
      const at = Number(await fsp.readFile(`${dir}/at`, "utf8").catch(() => "0"));
      if (Date.now() - at > 15000) {
        await fsp.unlink(`${dir}/at`).catch(() => {});
        await fsp.rmdir(dir).catch(() => {});
        continue;
      }
      await wait(cx, 100);
    }
  }
  return false;
}

async function release(home) {
  await fsp.unlink(`${home}/${LOCK}/at`).catch(() => {});
  await fsp.rmdir(`${home}/${LOCK}`).catch(() => {});
}

async function install(cx) {
  const home = appHome();
  const mod = `${home}/mods/shortcuts`;
  const dir = `${home}/frame/settings`;
  await fsp.mkdir(dir, { recursive: true });
  await writeIfChanged(`${dir}/shortcuts.js`, await fsp.readFile(`${mod}/shortcuts.js`, "utf8"));
  await writeIfChanged(`${dir}/keyboard.svg`, icon);

  const file = `${dir}/main.js`;
  let raw = await fsp.readFile(file, "utf8").catch(() => null);
  if (raw === null) throw new Error("找不到 frame/settings/main.js");
  if (raw.includes(MARK)) return;

  // 语言包（如果装了）先翻译；它写完后文件里会有中文标记，此时再注入就不会互相覆盖。
  const until = Date.now() + 4000;
  while (!raw.includes(TRANSLATED) && Date.now() < until) {
    await wait(cx, 150);
    raw = await fsp.readFile(file, "utf8").catch(() => raw);
  }

  const locked = await acquire(cx, home);
  try {
    raw = await fsp.readFile(file, "utf8");
    const text = raw.replace(/\r\n/g, "\n");
    if (text.includes(MARK)) return;
    const next = inject(text);
    if (next === text) throw new Error("Herdr 的设置界面结构已变化，暂时无法注入快捷键页");
    await fsp.writeFile(file, next, "utf8");
    const back = await fsp.readFile(file, "utf8");
    if (!back.includes(MARK)) throw new Error("快捷键页写入后未生效");
  } finally {
    if (locked) await release(home);
  }
}

export default class ShortcutsPack extends View {
  init(_props, cx) {
    cx.spawn(async (cx) => {
      try {
        await install(cx);
      } catch (error) {
        notify({
          title: "快捷键页加载失败",
          body: String(error?.message ?? error),
          level: "error",
          timeout: 12000,
        });
      }
    });
  }

  render() {
    return div();
  }
}
