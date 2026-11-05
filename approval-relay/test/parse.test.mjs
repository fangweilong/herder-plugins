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
  const p = parseApproval(`╭─ Ask 3 questions ─────────────────────────────────╮
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
  assert.deepEqual(p.options.map((o) => o.hint), [
    "弹窗粘贴 PAT，一键打开创建页。",
    "GitHub Device Flow / GitLab OAuth。",
    "仅对自建实例可能有效。",
    "",
  ]);
  assert.equal(p.multiQuestion, true);
  assert.equal(p.questionCount, 3);
});

test("numbered options keep their indented description lines", () => {
  const p = parseApproval(`╭──────────────────────────────────────────────╮
│ Do you want to proceed?                       │
│ ❯ 1. Yes                                      │
│      Run the test command                     │
│   2. No                                       │
│      Skip this step                           │
│                                               │
╰──────────────────────────────────────────────╯`);
  assert.ok(p);
  assert.deepEqual(p.options.map((o) => [o.label, o.hint]), [
    ["1. Yes", "Run the test command"],
    ["2. No", "Skip this step"],
  ]);
});

test("multi-question sections keep their own options and hints", () => {
  const p = parseApproval(`│ ├─── [auth] · options:2 ───
│   Auth method?
│   ○ Token
│       输入 PAT 登录
│   ○ OAuth
│       浏览器跳转授权
│ ├─── [trigger] · multi · options:2 ───
│   Which triggers?
│   ☐ 401
│   ☐ Preflight
│ ├─── [scope] · options:2 ───
│   Which scope?
│   ○ API
│   ○ Downloads
╰─────────────────────────────╯`);
  assert.ok(p);
  const auth = p.questions.find((q) => q.id === "auth");
  assert.deepEqual(auth.options.map((o) => [o.label, o.hint ?? ""]), [
    ["Token", "输入 PAT 登录"],
    ["OAuth", "浏览器跳转授权"],
    ["Other (type your own)", ""],
  ]);
});


test("omp multi-question screen exposes every question for the wizard", () => {
  const p = parseApproval(`│ ├─── [auth] · options:2 ───
│   Auth method?
│   ○ Token
│   ○ OAuth
│ ├─── [trigger] · multi · options:2 ───
│   Which triggers?
│   ☐ 401
│   ☐ Preflight
│ ├─── [scope] · options:2 ───
│   Which scope?
│   ○ API
│   ○ Downloads
╰─────────────────────────────╯`);
  assert.ok(p);
  assert.equal(p.multiQuestion, true);
  assert.equal(p.questions.length, 3);
  assert.deepEqual(p.questions.map((q) => q.id), ["auth", "trigger", "scope"]);
  assert.equal(p.questions[1].multi, true);
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

const claudeMultiSelect = `←  ☐ 功能范围  ☐ Diff 视图  ✔ Submit  →

这个 Git 插件第一版要覆盖哪些视图？（可多选）

❯ 1. [ ] 提交历史 + 提交 diff（推荐）
         浏览提交列表，查看单次提交的文件变更与 diff
  2. [ ] 工作区变更 + 暂存/提交
         查看未暂存/已暂存变更，执行暂存与提交
  3. [ ] 分支 / 提交对比
         选择两个分支或提交进行差异对比
  4. [ ] Blame / 文件历史
         按行查看 blame，浏览单个文件的变更历史
  5. [ ] Type something
     Next
────────────────────────────────────────────────────────
  6. Chat about this

Enter to select · Tab/Arrow keys to navigate · Esc to cancel`;

const claudeSingleSelect = `←  ☐ 功能范围  ☐ Diff 视图  ✔ Submit  →

diff 怎么显示？

❯ 1. 并排双栏（推荐）
     左右两栏对照显示旧版本与新版本
  2. 单栏统一 diff
     单一栏位显示 +/- 行的统一 diff
  3. 两种可切换
     提供切换按钮，两种模式都支持
  4. Type something.
────────────────────────────────────────────────────────
  5. Chat about this

Enter to select · Tab/Arrow keys to navigate · Esc to cancel`;

test("Claude multi-select keeps the tab headers and only toggles", () => {
  const p = parseApproval(claudeMultiSelect);
  assert.ok(p);
  assert.equal(p.multi, true);
  assert.equal(p.submit, "Next");
  assert.deepEqual(p.tabs.map((tab) => tab.label), ["功能范围", "Diff 视图"]);
  assert.equal(p.multiQuestion, true);
  assert.equal(p.questionCount, 2);
  assert.match(p.question, /哪些视图/);
  assert.deepEqual(p.options.map((option) => option.label), [
    "提交历史 + 提交 diff（推荐）",
    "工作区变更 + 暂存/提交",
    "分支 / 提交对比",
    "Blame / 文件历史",
    "Other (type your own)",
  ]);
  // 多选只发数字键切换，绝不附带 Enter。
  assert.deepEqual(p.options.map((option) => option.keys), [["1"], ["2"], ["3"], ["4"], ["5"]]);
  assert.equal(p.options[4].other, true);
  assert.equal(p.options[0].hint, "浏览提交列表，查看单次提交的文件变更与 diff");
});

test("Claude single-select inside a tabbed form keeps tab names", () => {
  const p = parseApproval(claudeSingleSelect);
  assert.ok(p);
  assert.equal(p.multi, false);
  assert.equal(p.submit, "");
  assert.deepEqual(p.tabs.map((tab) => tab.label), ["功能范围", "Diff 视图"]);
  assert.equal(p.options.length, 4);
  assert.deepEqual(p.options[3].keys, ["4", "enter"]);
  assert.equal(p.options[3].other, true);
  assert.match(p.question, /diff 怎么显示/);
});

test("Claude multi-select marked rows become selected checkboxes", () => {
  const p = parseApproval(claudeMultiSelect.replace("❯ 1. [ ]", "  1. [✓]"));
  assert.ok(p);
  assert.equal(p.options[0].selected, true);
  assert.deepEqual(p.options[0].keys, ["1"]);
});

test("multi-select checkboxes without a tab bar still only toggle", () => {
  const p = parseApproval(`Pick some?
❯ 1. [ ] Alpha
  2. [ ] Beta
  3. [ ] Gamma
  4. [ ] Type something
     Submit
Enter to select`);
  assert.ok(p);
  assert.equal(p.multi, true);
  assert.deepEqual(p.options.map((option) => option.keys), [["1"], ["2"], ["3"], ["4"]]);
  assert.equal(p.options[3].other, true);
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
