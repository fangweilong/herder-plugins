import test from "node:test";
import assert from "node:assert/strict";
import { resolveLanguage, makeT, formatShortcut, findShortcut } from "../mods/approval-relay/i18n.js";

const dict = {
  zh: { hello: "你好 {name}", only: "只有中文" },
  en: { hello: "Hello {name}", only: "English only" },
};

test("explicit language wins", () => {
  assert.equal(resolveLanguage({ language: "zh" }, "en-US"), "zh");
  assert.equal(resolveLanguage({ language: "en" }, "zh-CN"), "en");
});

test("auto follows the system locale", () => {
  assert.equal(resolveLanguage({ language: "auto" }, "zh-CN"), "zh");
  assert.equal(resolveLanguage({}, "zh-Hant"), "zh");
  assert.equal(resolveLanguage({}, "de-DE"), "en");
});

test("a Chinese layout picks Chinese even on an English system", () => {
  assert.equal(resolveLanguage({}, "en-US", "zh"), "zh");
  assert.equal(resolveLanguage({}, "en-US", "zh-win98"), "zh");
  assert.equal(resolveLanguage({}, "en-US", "main"), "en");
  assert.equal(resolveLanguage({ language: "en" }, "en-US", "zh"), "en");
});

test("missing keys fall back to English", () => {
  const t = makeT(dict, "zh");
  assert.equal(t("only"), "只有中文");
  assert.equal(t("missing"), "missing");
  const en = makeT(dict, "de");
  assert.equal(en("hello", { name: "Ada" }), "Hello Ada");
});

test("shortcut display", () => {
  assert.equal(formatShortcut("ctrl-shift-a"), "Ctrl+Shift+A");
  assert.equal(formatShortcut("alt-enter"), "Alt+Enter");
  assert.equal(formatShortcut("meta-1"), "Win+1");
  assert.equal(formatShortcut(""), "");
});

test("find the approval shortcut from keys.json", () => {
  const keys = { global: { "ctrl-shift-a": "approval-relay.open", "ctrl-p": "app.palette" } };
  assert.equal(findShortcut(keys, "approval-relay.open"), "Ctrl+Shift+A");
  assert.equal(findShortcut(keys, "nope"), "");
});
