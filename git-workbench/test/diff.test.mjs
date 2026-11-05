import test from "node:test";
import assert from "node:assert/strict";
import {
  countChanges,
  inlineSegments,
  parseUnifiedDiff,
  sideBySide,
  similarity,
  wholeFileDiff,
} from "../diff.js";

const DIFF = `diff --git a/src/a.js b/src/a.js
index 111..222 100644
--- a/src/a.js
+++ b/src/a.js
@@ -1,5 +1,6 @@
 const a = 1;
-const b = 2;
+const b = 20;
+const c = 3;
 function f() {
   return a;
 }
`;

test("parseUnifiedDiff 取出行号与增删", () => {
  const parsed = parseUnifiedDiff(DIFF);
  assert.equal(parsed.hunks.length, 1);
  const rows = parsed.hunks[0].rows;
  assert.deepEqual(rows.map((r) => r.kind), ["ctx", "del", "add", "add", "ctx", "ctx", "ctx"]);
  assert.equal(rows[0].oldNo, 1);
  assert.equal(rows[0].newNo, 1);
  assert.equal(rows[1].oldNo, 2);
  assert.equal(rows[1].newNo, null);
  assert.equal(rows[2].newNo, 2);
  assert.equal(rows[6].oldNo, 5);
  assert.equal(rows[6].newNo, 6);
  assert.deepEqual(countChanges(parsed.hunks), { add: 2, del: 1 });
});

test("parseUnifiedDiff 忽略空仓库与二进制", () => {
  assert.equal(parseUnifiedDiff("").empty, true);
  assert.equal(parseUnifiedDiff("Binary files a/x and b/x differ\n").binary, true);
});

test("sideBySide 相似行并排且标出词级变化", () => {
  const rows = parseUnifiedDiff(DIFF).hunks[0].rows;
  const side = sideBySide({ rows });
  assert.equal(side.length, 6);
  assert.equal(side[0].left.text, "const a = 1;");
  assert.equal(side[0].right.text, "const a = 1;");
  assert.equal(side[1].left.text, "const b = 2;");
  assert.equal(side[1].right.text, "const b = 20;");
  const changed = side[1].right.segments.filter((s) => s.changed).map((s) => s.text).join("");
  assert.equal(changed, "20");
  // 纯新增行只有右侧。
  const added = side.find((row) => row.left === null);
  assert.equal(added.right.text, "const c = 3;");
});

test("sideBySide 不把不相干的行硬配对", () => {
  const rows = [
    { kind: "del", oldNo: 1, newNo: null, text: "alpha beta gamma" },
    { kind: "add", oldNo: null, newNo: 1, text: "完全不同的一行内容" },
  ];
  const side = sideBySide({ rows });
  assert.equal(side.length, 2);
  assert.equal(side[0].right, null);
  assert.equal(side[1].left, null);
});

test("inlineSegments 合并相邻同类片段", () => {
  const segs = inlineSegments("foo bar baz", "foo qux baz");
  assert.deepEqual(segs.left.map((s) => s.changed), [false, true, false]);
  assert.deepEqual(segs.right.map((s) => s.changed), [false, true, false]);
  assert.equal(segs.left[1].text, "bar");
  assert.equal(segs.right[1].text, "qux");
});

test("similarity 对改一行给高分", () => {
  assert.ok(similarity("const b = 2;", "const b = 20;") > 0.8);
  assert.ok(similarity("abc", "xyz") < 0.2);
});

test("wholeFileDiff 全为新增", () => {
  const parsed = wholeFileDiff("a\nb\n");
  assert.equal(parsed.hunks[0].rows.length, 2);
  assert.deepEqual(countChanges(parsed.hunks), { add: 2, del: 0 });
});
