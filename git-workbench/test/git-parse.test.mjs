import test from "node:test";
import assert from "node:assert/strict";
import {
  FIELD,
  RECORD,
  buildStatusFiles,
  parseAheadBehind,
  parseBlame,
  parseBranches,
  parseLog,
  parseNameStatusZ,
  parseNumstatZ,
  parseRefs,
  parseStatusZ,
  relativeTime,
  repoName,
  statusLetter,
} from "../git-parse.js";

test("parseLog 解析字段、父提交与 refs", () => {
  const out = [
    `aaa111${FIELD}aaa${FIELD}Alice${FIELD}a@x.com${FIELD}2026-11-01T10:00:00+08:00${FIELD}bbb222 ccc333${FIELD}feat: x${FIELD}HEAD -> main, origin/main, tag: v1`,
    `bbb222${FIELD}bbb${FIELD}Bob${FIELD}b@x.com${FIELD}2026-10-01T10:00:00+08:00${FIELD}${FIELD}init${FIELD}`,
  ].join(RECORD) + RECORD;
  const commits = parseLog(out);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].merge, true);
  assert.deepEqual(commits[0].parents, ["bbb222", "ccc333"]);
  assert.deepEqual(commits[0].refs.map((r) => r.name), ["main", "origin/main", "v1"]);
  assert.equal(commits[0].refs[2].kind, "tag");
  assert.equal(commits[1].merge, false);
  assert.equal(commits[1].subject, "init");
});

test("parseRefs 处理 HEAD 与远程", () => {
  const refs = parseRefs("HEAD -> feat/x, origin/feat/x, HEAD");
  assert.deepEqual(refs.map((r) => [r.name, r.head, r.kind]), [
    ["feat/x", true, "branch"],
    ["origin/feat/x", false, "remote"],
    ["HEAD", true, "head"],
  ]);
});

test("parseStatusZ 区分暂存与工作区", () => {
  const files = parseStatusZ("MM src/a.js\0?? new.txt\0 D gone.js\0A  added.js\0");
  assert.deepEqual(files, [
    { x: "M", y: "M", path: "src/a.js" },
    { x: "?", y: "?", path: "new.txt" },
    { x: " ", y: "D", path: "gone.js" },
    { x: "A", y: " ", path: "added.js" },
  ]);
});

test("buildStatusFiles 标出 staged/unstaged/untracked", () => {
  const entries = parseStatusZ("MM a\0?? b\0 M c\0A  d\0");
  const staged = new Map([["a", { add: 1, del: 1, binary: false }], ["d", { add: 3, del: 0, binary: false }]]);
  const work = new Map([["a", { add: 2, del: 0, binary: false }], ["c", { add: 4, del: 1, binary: false }]]);
  const files = buildStatusFiles(entries, staged, work);
  const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
  assert.equal(byPath.a.staged, true);
  assert.equal(byPath.a.unstaged, true);
  assert.equal(byPath.a.add, 1);
  assert.equal(byPath.b.untracked, true);
  assert.equal(byPath.c.staged, false);
  assert.equal(byPath.c.unstaged, true);
  assert.equal(byPath.d.staged, true);
  assert.equal(statusLetter(byPath.d), "A");
  assert.equal(statusLetter(byPath.c), "M");
});

test("parseNumstatZ 处理二进制", () => {
  const stats = parseNumstatZ("12\t3\tsrc/a.js\0-\t-\timg.png\0");
  assert.deepEqual(stats, [
    { path: "src/a.js", add: 12, del: 3, binary: false },
    { path: "img.png", add: 0, del: 0, binary: true },
  ]);
});

test("parseNameStatusZ 处理重命名", () => {
  const files = parseNameStatusZ("M\0a.js\0R100\0old.js\0new.js\0A\0b.js\0");
  assert.deepEqual(files, [
    { status: "M", path: "a.js", oldPath: null },
    { status: "R", path: "new.js", oldPath: "old.js" },
    { status: "A", path: "b.js", oldPath: null },
  ]);
});

test("parseBranches 解析追踪信息与类型", () => {
  const line = [
    "refs/heads/main", "main", "abc1234", "*", "origin/main", "[ahead 2, behind 1]",
    "2026-11-01T10:00:00+08:00", "feat: x", "", "Alice",
  ].join("|");
  const remote = [
    "refs/remotes/origin/dev", "origin/dev", "def5678", "", "", "",
    "2026-10-01T10:00:00+08:00", "dev work",
  ].join("|");
  const tag = [
    "refs/tags/v1", "v1", "aaa0000", "", "", "", "2026-09-01T10:00:00+08:00", "release",
  ].join("|");
  const head = [
    "refs/remotes/origin/HEAD", "origin", "abc1234", "", "", "", "", "", "refs/remotes/origin/main",
  ].join("|");
  const branches = parseBranches([line, remote, tag, head].join("\n"));
  assert.equal(branches.length, 4);
  assert.equal(branches[0].current, true);
  assert.equal(branches[0].ahead, 2);
  assert.equal(branches[0].behind, 1);
  assert.equal(branches[0].author, "Alice");
  assert.equal(branches[1].kind, "remote");
  assert.equal(branches[1].symbolic, false);
  assert.equal(branches[2].kind, "tag");
  assert.equal(branches[3].symbolic, true);
});

test("parseBlame 解析提交元数据与代码行", () => {
  const out = [
    "abc1234def 1 1 1",
    "author Alice",
    "author-mail <a@x.com>",
    "author-time 1700000000",
    "author-tz +0800",
    "summary feat: x",
    "filename a.js",
    "\tconst a = 1;",
    "^1111111 2 2 1",
    "author Bob",
    "author-time 1700000100",
    "summary init",
    "filename a.js",
    "\t",
  ].join("\n");
  const lines = parseBlame(out);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].hash, "abc1234def");
  assert.equal(lines[0].short, "abc1234");
  assert.equal(lines[0].author, "Alice");
  assert.equal(lines[0].line, 1);
  assert.equal(lines[0].code, "const a = 1;");
  assert.equal(lines[1].hash, "1111111");
  assert.equal(lines[1].code, "");
});

test("parseAheadBehind", () => {
  assert.deepEqual(parseAheadBehind("3\t5\n"), { ahead: 3, behind: 5 });
  assert.deepEqual(parseAheadBehind(""), { ahead: 0, behind: 0 });
});

test("relativeTime 与 repoName", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  assert.equal(relativeTime("2026-11-04T11:59:30Z", now), "刚刚");
  assert.equal(relativeTime("2026-11-04T11:30:00Z", now), "30 分钟前");
  assert.equal(relativeTime("2026-11-04T09:00:00Z", now), "3 小时前");
  assert.equal(relativeTime("2026-11-01T12:00:00Z", now), "3 天前");
  assert.equal(relativeTime("2025-03-02T12:00:00Z", now), "2025-03-02");
  assert.equal(repoName("D:\\Codes\\x\\repo"), "repo");
  assert.equal(repoName("/home/x/repo/"), "repo");
});
