import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyRule } from "../mods/zh-cn/rules.js";

const rules = JSON.parse(
  await readFile(new URL("../mods/zh-cn/patches-extra.json", import.meta.url), "utf8"),
).files["frame/settings/main.js"];

// 0.1.16 设置页里尚未翻译的原文行。规则是纯字符串匹配，这里保留足够的上下文
// 验证每条 old 在真实文件里唯一出现。
const FIXTURE = [
  '        if (this.broken) return { title: "settings.json has errors: fix it first" };',
  '        return { title: "Cannot read settings.json", body: String(e?.message ?? e) };',
  '    return { title: "Not saved to settings.json", body: String(error?.message ?? error) };',
  'const LOOKS = { main: "Herdr", terminals: "Terminals", win98: "Herdr 98" };',
  '          "Terminal font weight",',
  '          own("font_weight", s.font_weight, 500) ? "This layout sets its own; yours shows in the others." : "Bold text stays at 700.",',
  '        ["terminal_line_height", "Terminal line height", 0.8, 2, 0.1],',
  '        ["terminal_cell_width", "Terminal cell width", 0.8, 2, 0.05],',
  '        ["terminal_scroll_speed", "Terminal scroll speed", 0.1, 5, 0.1],',
  '          own(key, s[key], 1) ? "This layout sets its own; yours shows in the others." : null,',
  '          .text_color(t.blocked).cursor_pointer().tooltip("Agents stop when you disconnect. Click for the fix.")',
  '        .child(div().text_size(12.5).text_color(t.blocked).child("needs a login: run"))',
  '          .child(this.button(t, `st-m-login-copy-${m.name}`, this.copiedLogin === command ? "Copied" : "Copy", (_e, cx) => {',
].join("\n");

test("每条补充规则的原文在设置页里只出现一次", () => {
  assert.ok(rules.length > 0);
  for (const rule of rules) {
    assert.equal(FIXTURE.split(rule.old).length - 1, 1, rule.old);
  }
});

test("补充规则把 0.1.16 新增文字翻译成中文", () => {
  let text = FIXTURE;
  for (const rule of rules) text = applyRule(text, rule).text;

  for (const english of [
    "settings.json has errors",
    "Cannot read settings.json",
    "Not saved to settings.json",
    'terminals: "Terminals"',
    "Terminal font weight",
    "Bold text stays at 700.",
    "Terminal line height",
    "Terminal cell width",
    "Terminal scroll speed",
    '"This layout sets its own; yours shows in the others."',
    "Agents stop when you disconnect",
    "needs a login: run",
    '"Copied"',
  ]) {
    assert.ok(!text.includes(english), `仍保留英文：${english}`);
  }
  for (const chinese of [
    "settings.json 有错误",
    "无法读取 settings.json",
    "未保存到 settings.json",
    'terminals: "终端"',
    "终端字体粗细",
    "粗体文字保持 700。",
    "终端行高",
    "终端列宽",
    "终端滚动速度",
    "此布局有自己的设置；你的设置会用于其他布局。",
    "断开连接后智能体将停止。点击修复。",
    "需要登录：运行",
    "已复制",
    "复制",
  ]) {
    assert.ok(text.includes(chinese), `缺少中文：${chinese}`);
  }
});

test("applyRule 不替换重复出现的片段", () => {
  const result = applyRule("same same", { old: "same", new: "不同" });
  assert.equal(result.hit, false);
  assert.equal(result.text, "same same");
});
