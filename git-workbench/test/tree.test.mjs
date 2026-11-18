import test from "node:test";
import assert from "node:assert/strict";
import { fileTreeRows } from "../tree.js";

function files(...paths) {
  return paths.map((path) => ({ path }));
}

function shape(rows) {
  return rows.map((row) => [row.kind, row.path, row.depth]);
}

test("fileTreeRows 目录在前、同级按名称排序", () => {
  const rows = fileTreeRows(files("b.txt", "src/z.js", "a.txt", "src/a.js"));
  assert.deepEqual(shape(rows), [
    ["dir", "src", 0],
    ["file", "src/a.js", 1],
    ["file", "src/z.js", 1],
    ["file", "a.txt", 0],
    ["file", "b.txt", 0],
  ]);
});

test("fileTreeRows 合并单子目录链", () => {
  const rows = fileTreeRows(files("src/app/components/a.js", "src/app/components/b.js"));
  assert.deepEqual(shape(rows), [
    ["dir", "src/app/components", 0],
    ["file", "src/app/components/a.js", 1],
    ["file", "src/app/components/b.js", 1],
  ]);
  assert.equal(rows[0].name, "src/app/components");
  assert.equal(rows[0].count, 2);
});

test("fileTreeRows 目录自己有文件时不再向下合并", () => {
  const rows = fileTreeRows(files("src/index.js", "src/views/A.js"));
  assert.deepEqual(shape(rows), [
    ["dir", "src", 0],
    ["dir", "src/views", 1],
    ["file", "src/views/A.js", 2],
    ["file", "src/index.js", 1],
  ]);
  assert.equal(rows[0].count, 2);
});

test("fileTreeRows 收起的目录只保留目录行", () => {
  const rows = fileTreeRows(files("src/a.js", "src/deep/b.js", "top.js"), (dir) => dir === "src");
  assert.deepEqual(shape(rows), [
    ["dir", "src", 0],
    ["file", "top.js", 0],
  ]);
  assert.equal(rows[0].collapsed, true);
  assert.equal(rows[0].count, 2);
});

test("fileTreeRows 忽略空路径并保留原文件对象", () => {
  const input = files("", "src/a.js");
  const rows = fileTreeRows(input);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].file, input[1]);
  assert.equal(rows[1].name, "a.js");
});
