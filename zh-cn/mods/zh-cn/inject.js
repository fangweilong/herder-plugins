// 设置里的「语言 / Language」选项：中文语言包由 zh 布局里的隐形浮动块启动，
// 每次启动时把这一行注入 Herdr 刚还原出来的 frame/settings/main.js。
//
// 选项写在 mods/zh-cn/language.json，而不是 settings.json：Herdr 的未知设置项可能
// 在它自己回写时丢失；这个文件属于本 mod，卸载时随目录一起删除。
// 语言包只在 zh 布局运行，所以英文模式下也要注入，否则切回中文后没有入口。

/** 注入后用于判断是否已经处理过的标记。 */
export const LANG_MARK = "st-s-lang";

/** 注入代码的版本：升级文案或修复注入时改这里，旧注入会被替换。 */
const LANG_VERSION = "st-s-lang-v2";

const METHOD_ANCHOR = "  render(cx) {";
const LOOK_ANCHOR = "  look(t, cx) {";
const CHAIN_ANCHOR = "return v_flex()\n      .w_full()\n";

/**
 * 读取 language.json 解析后的对象，得到当前界面语言。
 *
 * @param {unknown} person `language.json` 的内容。
 * @returns {"zh" | "en"}
 */
export function languageOf(person) {
  return person && person.language === "en" ? "en" : "zh";
}

const LANGUAGE_METHOD = [
  "  languageRow(t, cx) {",
  "    // st-s-lang-v2",
  "    if (this.langValue === undefined) {",
  '      this.langValue = "zh";',
  "      cx.spawn(async (cx) => {",
  '        const raw = await readTextFile(appHome() + "/mods/zh-cn/language.json").catch(() => null);',
  "        try {",
  '          this.langValue = JSON.parse(raw)?.language === "en" ? "en" : "zh";',
  "        } catch {",
  '          this.langValue = "zh";',
  "        }",
  "        cx.notify();",
  "      });",
  "    }",
  "    const lang = this.langValue;",
  "    const pick = (value, label) =>",
  "      div()",
  '        .id("st-s-lang-" + value)',
  "        .px(11)",
  "        .py(4)",
  "        .rounded(6)",
  "        .cursor_pointer()",
  '        .bg(lang === value ? t.accent : "#00000000")',
  "        .text_color(lang === value ? t.accent_foreground : t.muted)",
  "        .hover((s) => s.bg(lang === value ? t.accent : t.hover))",
  "        .on_click((_e, cx) => {",
  "          this.langValue = value;",
  "          cx.spawn(async (cx) => {",
  '            const path = appHome() + "/mods/zh-cn/language.json";',
  "            try {",
  "              const raw = await readTextFile(path);",
  '              await writeTextFile(path, JSON.stringify({ language: value }) + "\\n", raw);',
  '              notify({ title: value === "en" ? "English 将在重启 Herdr 后生效" : "中文将在重启 Herdr 后生效", timeout: 5000 });',
  "            } catch (e) {",
  '              notify({ title: "语言设置保存失败", body: String(e?.message ?? e), level: "error", timeout: 8000 });',
  "            }",
  "            cx.notify();",
  "          });",
  "        })",
  "        .child(label);",
  "    return this.row(",
  "      t,",
  '      "语言 / Language",',
  '      "界面语言；切换后重启 Herdr 生效。 / UI language; restart Herdr to apply.",',
  "      h_flex()",
  "        .p(2)",
  "        .gap(2)",
  "        .rounded(8)",
  "        .bg(t.raised)",
  '        .child(pick("zh", "中文"))',
  '        .child(pick("en", "English")),',
  "    );",
  "  }",
  "",
].join("\n");

/**
 * 去掉旧版本留下的注入：页尾语言行与 languageRow 方法。用于把旧会话的文件升级到
 * 顶部注入；调用前已确认标记存在。
 *
 * @param {string} text
 * @returns {string}
 */
function stripLanguage(text) {
  text = text.replace(/\n      \.child\(this\.languageRow\(t, cx\)\);?/g, "");
  const method = text.indexOf("  languageRow(t, cx) {");
  if (method >= 0) {
    // 只删到本方法的收尾 `  }`；不能删到 render，否则会把随后注入的 navKeys 一起删掉。
    const end = text.indexOf("\n  }\n", method);
    if (end > method) text = text.slice(0, method) + text.slice(end + 5);
  }
  return text;
}

/**
 * 把语言选项注入设置页外观页的顶部。锚点缺失（Herdr 改版）时原样返回，
 * 由调用方报告，避免写坏设置界面。
 *
 * @param {string} text `frame/settings/main.js` 的内容（LF）。
 * @returns {string} 注入后的内容；无法注入时与输入相同。
 */
export function injectLanguage(text) {
  if (text.includes(LANG_MARK)) {
    // 已经在顶部（本次格式）就什么都不做；页尾旧格式则去掉后重新注入。
    const look = text.indexOf(LOOK_ANCHOR);
    if (look >= 0) {
      const chain = text.indexOf(CHAIN_ANCHOR, look);
      if (chain >= 0) {
        const head = text.slice(chain + CHAIN_ANCHOR.length);
        if (head.startsWith("      .child(this.languageRow(t, cx))\n") && text.includes(LANG_VERSION)) return text;
      }
    }
    text = stripLanguage(text);
  }
  if (!text.includes(METHOD_ANCHOR)) return text;

  const look = text.indexOf(LOOK_ANCHOR);
  if (look < 0) return text;
  const chain = text.indexOf(CHAIN_ANCHOR, look);
  if (chain < 0) return text;

  // 外观页的 return v_flex() 链：在 .w_full() 后插入语言行，位于「布局」之前。
  const at = chain + CHAIN_ANCHOR.length;
  let next = text.slice(0, at) + "      .child(this.languageRow(t, cx))\n" + text.slice(at);

  const method = next.indexOf(METHOD_ANCHOR);
  if (method < 0) return text;
  next = next.slice(0, method) + LANGUAGE_METHOD + "\n" + next.slice(method);
  return next;
}
