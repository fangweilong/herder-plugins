import test from "node:test";
import assert from "node:assert/strict";
import { parseApproval, cleanScreen, screenHash } from "../mods/approval-relay/parse.js";

const fake = `
Do you want to proceed?
 > 1. Yes
   2. No, and tell what to do differently (esc)
`;

const claude = `
╭──────────────────────────────────────────────╮
│ Bash command                                  │
│                                               │
│   rm -rf build                                │
│   Remove the build folder                     │
│                                               │
│ Do you want to proceed?                       │
│ ❯ 1. Yes                                      │
│   2. Yes, and don't ask again for rm commands │
│   3. No, and tell Claude what to do differently (esc)
│                                               │
╰──────────────────────────────────────────────╯
`;

test("numbered dialog from a plain prompt", () => {
  const p = parseApproval(fake);
  assert.ok(p);
  assert.equal(p.options.length, 2);
  assert.deepEqual(p.options[0].keys, ["1", "enter"]);
  assert.match(p.question, /Do you want to proceed/);
});

test("box-drawn Claude dialog keeps only the option text", () => {
  const p = parseApproval(claude);
  assert.ok(p);
  assert.equal(p.options.length, 3);
  assert.equal(p.options[0].label, "1. Yes");
  assert.equal(p.options[2].keys[0], "3");
  assert.equal(p.options[0].selected, true);
});

test("codex numbers confirm without an extra Enter", () => {
  const p = parseApproval(fake, { app: "codex" });
  assert.ok(p);
  assert.deepEqual(p.options[0].keys, ["1"]);
  assert.deepEqual(parseApproval(fake).options[0].keys, ["1", "enter"]);
});

test("yes/no prompt", () => {
  const p = parseApproval("This will overwrite files. Continue? [y/N]");
  assert.ok(p);
  assert.equal(p.options.length, 2);
  assert.deepEqual(p.options[0].keys, ["y", "enter"]);
  assert.equal(p.defaultOption, "no");
});

test("a printed prompt followed by real output is not live", () => {
  const p = parseApproval(`Do you want to proceed?
1. Yes
2. No
npm test
> 30 tests passed
> build finished in 2.1s
`);
  assert.equal(p, null);
});

test("a menu far above the bottom is not live", () => {
  const p = parseApproval(`1. Yes
2. No
${Array.from({ length: 24 }, (_, i) => `line ${i} of output`).join("\n")}`);
  assert.equal(p, null);
});

test("generic prompt with hints but no parsed options", () => {
  const p = parseApproval("Allow this tool to run? (Enter to confirm, Esc to cancel)");
  assert.ok(p);
  assert.equal(p.generic, true);
  assert.equal(p.kind, "text");
  assert.equal(p.options.length, 0);
});

test("free-text question with an empty input line", () => {
  const p = parseApproval(`What should the new component be called?
╭──────────────────────────╮
│ >                        │
╰──────────────────────────╯
Enter to submit · Esc to cancel`);
  assert.ok(p);
  assert.equal(p.kind, "text");
  assert.match(p.question, /component be called/);
});

test("free-text question after an unrelated header keeps the question", () => {
  const p = parseApproval(`Fake coding agent — question test

What should the new component be called?

╭──────────────────────────╮
│ >                        │
╰──────────────────────────╯
Enter to submit · Esc to cancel`);
  assert.ok(p);
  assert.equal(p.kind, "text");
  assert.match(p.question, /What should the new component be called/);
  assert.doesNotMatch(p.question, /Fake coding agent/);
});

test("numbered options with an Other input line stay options", () => {
  const p = parseApproval(`Do you want to proceed?
 > 1. Yes
   2. No
   3. Other (type your answer)
╭──────────────────────────╮
│ >                        │
╰──────────────────────────╯
Enter to submit · Esc to cancel`);
  assert.ok(p);
  assert.equal(p.kind, "options");
  assert.equal(p.options.length, 3);
  assert.equal(p.options[2].other, true);
});


test("omp Ask panel parses radio options and Other across descriptions", () => {
  const p = parseApproval(`╭─ Ask ─────────────────────────────────────────────╮
│ GitHub/GitLab 登录弹窗用哪种凭据？（GitHub 官方已不接受密码）
├───────────────────────────────────────────────────┤
│ ❯ ○ Token 登录（推荐）
│       弹窗粘贴 PAT，一键打开创建页。
│   ○ 浏览器 OAuth 授权
│       GitHub Device Flow / GitLab OAuth。
│   ○ 账密直连（Basic）
│       仅对自建实例可能有效。
│   ○ Other (type your own)
├───────────────────────────────────────────────────┤
│ ⏎ select · n note · ↑/↓ move · ⎋ cancel
╰───────────────────────────────────────────────────╯
 2026-11-03 15:11:59  ⚡ 106.8 tok/s
OpenCode Go  mo 54%`);
  assert.ok(p);
  assert.equal(p.kind, "options");
  assert.match(p.question, /GitHub\/GitLab 登录弹窗/);
  assert.deepEqual(p.options.map((o) => o.label), [
    "Token 登录（推荐）",
    "浏览器 OAuth 授权",
    "账密直连（Basic）",
    "Other (type your own)",
  ]);
  assert.equal(p.options[3].other, true);
});

test("numbered options are tagged as options", () => {
  const p = parseApproval(fake);
  assert.equal(p.kind, "options");
});

test("pi permission dialog uses spaced numbers", () => {
  const p = parseApproval(`╭─ permission · bash ──────────────────────────────────╮
│ pnpm test                                            │
│                                                      │
│ ❯ 1  yes                                             │
│   2  always yes                                      │
│   3  deny                                            │
│                                                      │
│ ↑↓ or 1-3 pick   enter confirm   tab note   esc deny │
╰──────────────────────────────────────────────────────╯`);
  assert.ok(p);
  assert.equal(p.kind, "options");
  assert.deepEqual(p.options.map((o) => o.label), ["1. yes", "2. always yes", "3. deny"]);
  assert.deepEqual(p.options[1].keys, ["2", "enter"]);
  assert.match(p.question, /permission · bash/);
});

test("[a]llow style hotkeys are parsed without pressing Enter", () => {
  const p = parseApproval(`Allow this tool?
[a]llow once
(d)eny`);
  assert.ok(p);
  assert.deepEqual(p.options.map((o) => o.label), ["allow once", "deny"]);
  assert.deepEqual(p.options[0].keys, ["a"]);
  assert.deepEqual(p.options[1].keys, ["d"]);
});

test("oh-my-pi approval has no numbers and uses arrows", () => {
  const p = parseApproval(`Allow tool: bash
Reason: Critical pattern detected
rm -rf build
Approve
Approve bash for this session
Deny
↑↓ select  Enter confirm  Esc deny`);
  assert.ok(p);
  assert.equal(p.kind, "options");
  assert.deepEqual(p.options.map((o) => o.label), ["Approve", "Approve bash for this session", "Deny"]);
  assert.deepEqual(p.options[0].keys, ["enter"]);
  assert.deepEqual(p.options[1].keys, ["down", "enter"]);
  assert.deepEqual(p.options[2].keys, ["down", "down", "enter"]);
});

test("oh-my-pi ask-and-remember skips the checkbox but counts its row", () => {
  const p = parseApproval(`Allow tool: read
☐ Remember across sessions
Approve Directory: D:\\work
Approve File
Approve Once
Approve read for this session
Deny
↑↓ select  Enter confirm  Esc deny`);
  assert.ok(p);
  assert.equal(p.options.length, 5);
  assert.equal(p.options.some((o) => /Remember/.test(o.label)), false);
  const once = p.options.find((o) => o.label === "Approve Once");
  assert.equal(once.default, true);
  assert.deepEqual(once.keys, ["enter"]);
  assert.deepEqual(p.options.find((o) => o.label === "Deny").keys, ["down", "down", "enter"]);
});

test("opencode permission choices are parsed", () => {
  const p = parseApproval(`Permission required
Run this command?
Allow once
Always allow
Reject
esc to dismiss`);
  assert.ok(p);
  assert.deepEqual(p.options.map((o) => o.label), ["Allow once", "Always allow", "Reject"]);
  assert.deepEqual(p.options[2].keys, ["down", "down", "enter"]);
});

test("pi's always-yes depth list expands around the marker", () => {
  const p = parseApproval(`always yes for...
  pnpm
❯ pnpm test
↑↓ depth   enter confirm`);
  assert.ok(p);
  assert.deepEqual(p.options.map((o) => o.label), ["pnpm", "pnpm test"]);
  assert.deepEqual(p.options[0].keys, ["up", "enter"]);
  assert.deepEqual(p.options[1].keys, ["enter"]);
});

test("a focused block in a multi-question form wins over the last block", () => {
  const p = parseApproval(`Question 1: Which database?
 ❯ 1. SQLite
   2. Postgres

Question 2: Which ORM?
   1. Drizzle
   2. Prisma
↑↓ select   enter confirm`);
  assert.ok(p);
  assert.deepEqual(p.options.map((o) => o.label), ["1. SQLite", "2. Postgres"]);
  assert.match(p.question, /Question 1/);
});

test("plain working screen has no approval", () => {
  assert.equal(parseApproval("Building...\n  compiled 12 files\nDone."), null);
});

test("ANSI and carriage returns are cleaned", () => {
  const raw = "\u001b[31mDo you want to proceed?\u001b[0m\r\n > 1. Yes\r\n   2. No\r\n";
  assert.equal(cleanScreen(raw).includes("\u001b"), false);
  assert.ok(parseApproval(raw));
});

test("screen hash ignores ANSI, spacing and trailing lines", () => {
  const a = screenHash("Do you want to proceed?\n > 1. Yes\n2. No\n");
  const b = screenHash("\u001b[1mDo you want to proceed?\u001b[0m   \n > 1. Yes\n2. No\n\n");
  assert.equal(a, b);
});
