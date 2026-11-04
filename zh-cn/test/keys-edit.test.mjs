// keys.json 改写的纯逻辑：chord 规范化 + 绑定增删改。

import test from "node:test";
import assert from "node:assert/strict";

import { normalizeChord, sectionsFromListing, updateBindings } from "../mods/shortcuts/keys-edit.js";

test("normalizeChord 接受常见写法并统一拼写", () => {
  assert.equal(normalizeChord("Ctrl+Shift+P").chord, "ctrl-shift-p");
  assert.equal(normalizeChord("control + alt + k".replace(/\s+/g, "")).chord, "ctrl-alt-k");
  assert.equal(normalizeChord("option+up").chord, "alt-up");
  assert.equal(normalizeChord("meta+k").chord, "cmd-k");
  assert.equal(normalizeChord("f12").chord, "f12");
  assert.equal(normalizeChord("shift+pgup").chord, "shift-pageup");
});

test("normalizeChord 把分隔符末尾当作字面量按键", () => {
  assert.equal(normalizeChord("ctrl--").chord, "ctrl--");
  assert.equal(normalizeChord("Ctrl+-").chord, "ctrl--");
  assert.equal(normalizeChord("ctrl++").chord, "ctrl-+");
  assert.equal(normalizeChord("ctrl-+").chord, "ctrl-+");
});

test("normalizeChord 拒绝不完整或未知的按键", () => {
  assert.match(normalizeChord("").error, /请输入/);
  assert.match(normalizeChord("ctrl-shift").error, /无法识别/);
  assert.match(normalizeChord("ctrl-banana").error, /无法识别/);
  assert.match(normalizeChord("ctrl-k ctrl-s").error, /空格/);
  assert.equal(normalizeChord("ctrl-shift-escape").chord, "ctrl-shift-escape");
});

test("updateBindings 改绑时删掉旧 chord", () => {
  const doc = { global: { "ctrl-shift-t": "tab.new" } };
  assert.equal(updateBindings(doc, { section: "global", action: "tab.new", keys: "ctrl-shift-t" }, "ctrl-alt-t").error, undefined);
  assert.deepEqual(doc, { global: { "ctrl-alt-t": "tab.new" } });
});

test("updateBindings 新增时保留同一动作的其它键", () => {
  const doc = { global: { "ctrl-tab": "tab.next" } };
  assert.equal(updateBindings(doc, { section: "global", action: "tab.next", keys: null }, "alt-]").error, undefined);
  assert.deepEqual(doc, { global: { "ctrl-tab": "tab.next", "alt-]": "tab.next" } });
});

test("updateBindings 拒绝改到别的动作已占用的 chord", () => {
  const doc = { global: { "ctrl-shift-p": "app.palette" } };
  const result = updateBindings(doc, { section: "global", action: "tab.next", keys: null }, "ctrl-shift-p");
  assert.match(result.error, /app\.palette/);
  assert.deepEqual(doc, { global: { "ctrl-shift-p": "app.palette" } });
});

test("updateBindings 删除最后一条绑定后移除空分区", () => {
  const doc = { global: { "ctrl-shift-p": "app.palette" }, terminal: {} };
  assert.equal(updateBindings(doc, { section: "global", action: "app.palette", keys: "ctrl-shift-p" }, null).error, undefined);
  assert.deepEqual(doc, { terminal: {} });
});

test("updateBindings 不改动其它分区的同名 chord", () => {
  const doc = { global: { "ctrl-v": "terminal.paste" }, terminal: { "ctrl-v": "terminal.paste_image" } };
  assert.equal(updateBindings(doc, { section: "global", action: "terminal.paste", keys: "ctrl-v" }, "ctrl-shift-v").error, undefined);
  assert.deepEqual(doc, { global: { "ctrl-shift-v": "terminal.paste" }, terminal: { "ctrl-v": "terminal.paste_image" } });
});

test("sectionsFromListing 跳过应用保留的逃生快捷键", () => {
  const doc = sectionsFromListing([
    { section: "global", keys: "ctrl-alt-shift-escape", action: "app.reset" },
    { section: "global", keys: "ctrl-shift-p", action: "app.palette" },
  ]);
  assert.deepEqual(doc, { global: { "ctrl-shift-p": "app.palette" } });
});