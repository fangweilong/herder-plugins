import assert from "node:assert/strict";
import test from "node:test";
import { injectLanguage, LANG_MARK, languageOf } from "../mods/zh-cn/inject.js";

const FIXTURE = [
  "class Settings extends View {",
  "  look(t, cx) {",
  "    return v_flex()",
  "      .w_full()",
  '      .child(this.heading(t, "布局"))',
  "      .child(this.layoutPicker(t, cx));",
  "  }",
  "",
  "  render(cx) {",
  "  }",
  "}",
].join("\n");

test("语言设置读取：缺省为中文，只有 en 才关闭翻译", () => {
  assert.equal(languageOf(null), "zh");
  assert.equal(languageOf({}), "zh");
  assert.equal(languageOf({ language: "zh" }), "zh");
  assert.equal(languageOf({ language: "en" }), "en");
});

test("把语言选项注入外观页顶部", () => {
  const next = injectLanguage(FIXTURE);
  assert.notEqual(next, FIXTURE);
  assert.ok(next.includes(LANG_MARK));
  assert.ok(next.includes("st-s-lang-v2"));
  assert.ok(next.includes(".child(this.languageRow(t, cx))\n"));
  assert.ok(next.includes('"语言 / Language"'));
  assert.ok(next.includes('pick("zh", "中文")'));
  assert.ok(next.includes('pick("en", "English")'));
  // 语言行在「布局」之前，方法插在 render 之前。
  assert.ok(next.indexOf("languageRow(t, cx)") < next.indexOf("this.heading"));
  assert.ok(next.indexOf("  languageRow(t, cx) {") < next.indexOf("  render(cx) {"));
});

test("重复注入不改变文件", () => {
  const once = injectLanguage(FIXTURE);
  assert.equal(injectLanguage(once), once);
});

test("旧版页尾注入会移动到顶部且不重复", () => {
  const old = [
    "class Settings extends View {",
    "  look(t, cx) {",
    "    return v_flex()",
    "      .w_full()",
    '      .child(this.heading(t, "布局"))',
    "      .child(this.layoutPicker(t, cx))",
    "      .child(this.languageRow(t, cx));",
    "  }",
    "",
    "  languageRow(t, cx) {",
    '    return div().id("st-s-lang-" + value);',
    "  }",
    "",
    "  navKeys(t) {",
    '    return div().id("st-s-keys");',
    "  }",
    "",
    "  render(cx) {",
    "  }",
    "}",
  ].join("\n");

  const next = injectLanguage(old);
  assert.equal(next.split(".child(this.languageRow(t, cx))").length - 1, 1);
  assert.equal(next.split("  languageRow(t, cx) {").length - 1, 1);
  assert.ok(!next.includes('return div().id("st-s-lang-" + value);'));
  assert.ok(next.includes("st-s-keys"));
  assert.ok(next.indexOf("languageRow(t, cx)") < next.indexOf("this.heading"));
});

test("同一位置的旧版注入会被替换，且保留相邻方法", () => {
  const once = injectLanguage(FIXTURE);
  const withNav = once.replace(
    "  render(cx) {",
    '  navKeys(t) {\n    return div().id("st-s-keys");\n  }\n\n  render(cx) {',
  );
  const stale = withNav
    .replace("    // st-s-lang-v2\n", "")
    .replace("UI language; restart Herdr to apply.", "旧文案");

  const next = injectLanguage(stale);
  assert.ok(next.includes("st-s-lang-v2"));
  assert.ok(next.includes("UI language"));
  assert.ok(!next.includes("旧文案"));
  assert.ok(next.includes("st-s-keys"));
  assert.equal(next.split("  languageRow(t, cx) {").length - 1, 1);
});

test("锚点缺失时原样返回", () => {
  const text = "class Settings extends View {\n  render(cx) {\n  }\n}\n";
  assert.equal(injectLanguage(text), text);
});
