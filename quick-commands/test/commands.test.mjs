import test from "node:test";
import assert from "node:assert/strict";
import {
  FALLBACK_COMMANDS,
  defaultConfig,
  expandCommand,
  matchCommands,
  migrateConfig,
  normalizeConfig,
  removeCommand,
  scanVariables,
  serializeConfig,
  upsertCommand,
} from "../commands.js";

test("回退模板覆盖 npm、pnpm、Rust、Spring Boot、Python 与 Git", () => {
  const groups = new Set(FALLBACK_COMMANDS.map((command) => command.group));
  for (const group of ["npm", "pnpm", "Rust", "Spring Boot", "Python", "Git"]) {
    assert.ok(groups.has(group), `缺少分组 ${group}`);
  }
  assert.ok(FALLBACK_COMMANDS.some((command) => command.command === "npm start"));
  assert.ok(FALLBACK_COMMANDS.some((command) => command.command === "npm run build"));
});

test("normalizeConfig 丢弃空条目并修复重复或缺失的 id", () => {
  const commands = normalizeConfig({
    commands: [
      { id: "same", name: "A", command: "a" },
      { id: "same", name: "B", command: "b" },
      { name: "", command: "ignored" },
      { name: "C", command: "" },
    ],
  });
  assert.equal(commands.length, 2);
  assert.notEqual(commands[0].id, commands[1].id);
  assert.equal(commands[1].name, "B");
});

test("normalizeConfig 兼容裸数组，serializeConfig 可回读", () => {
  const commands = normalizeConfig([{ name: "构建", command: "npm run build", group: "npm" }]);
  assert.equal(commands.length, 1);
  const text = serializeConfig(commands);
  assert.match(text, /"version": 2/);
  assert.deepEqual(normalizeConfig(JSON.parse(text)), commands);
  assert.ok(text.endsWith("\n"));
});

test("defaultConfig 只保存用户命令，项目模板由运行时生成", () => {
  const config = defaultConfig();
  assert.equal(config.version, 2);
  assert.deepEqual(config.commands, []);
});

test("migrateConfig 丢掉未改动的 v1 内置模板，保留用户命令", () => {
  const seed = FALLBACK_COMMANDS[0];
  const customized = { ...FALLBACK_COMMANDS[1], name: "我的启动" };
  const custom = { id: "mine", name: "自定义", command: "echo hi", group: "", description: "" };
  const migrated = migrateConfig({
    version: 1,
    commands: [seed, customized, custom],
  });
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.commands.map((item) => item.id), [customized.id, "mine"]);
});

test("matchCommands 支持精确子串与字符子序列", () => {
  const commands = [
    { id: "a", name: "构建", command: "npm run build", group: "npm", description: "" },
    { id: "b", name: "测试", command: "npm test", group: "npm", description: "" },
    { id: "c", name: "运行", command: "cargo run", group: "Rust", description: "" },
  ];
  assert.deepEqual(matchCommands(commands, "build").map((item) => item.id), ["a"]);
  assert.deepEqual(matchCommands(commands, "npb").map((item) => item.id), ["a"]);
  assert.deepEqual(matchCommands(commands, "rust").map((item) => item.id), ["c"]);
  assert.deepEqual(matchCommands(commands, "").map((item) => item.id), ["a", "b", "c"]);
});

test("scanVariables 识别变量、去重并忽略未知 shell 变量", () => {
  const variables = scanVariables("cd ${cwd} && ${cwd} ${input:分支} ${input:分支} ${env:HOME} ${HOME} ${repo}");
  assert.deepEqual(variables, [
    { kind: "cwd" },
    { kind: "input", label: "分支" },
    { kind: "env", name: "HOME" },
    { kind: "repo" },
  ]);
});

test("expandCommand 替换已知变量，未知变量保持原样", () => {
  const text = "cd ${cwd} && git switch ${input:分支} && echo ${env:HOME} ${HOME} @ ${repo}:${branch}";
  const expanded = expandCommand(text, {
    cwd: "D:/work/app",
    repo: "app",
    branch: "main",
    inputs: { 分支: "feature/login" },
    env: { HOME: "/home/me" },
  });
  assert.equal(expanded, "cd D:/work/app && git switch feature/login && echo /home/me ${HOME} @ app:main");
});

test("expandCommand 对空字符串也执行替换", () => {
  assert.equal(expandCommand("echo ${env:MISSING}", { env: { MISSING: "" } }), "echo ");
});

test("upsertCommand 插入或覆盖，removeCommand 删除", () => {
  const base = [{ id: "a", name: "A", command: "a" }];
  const added = upsertCommand(base, { id: "b", name: "B", command: "b" });
  assert.deepEqual(added.map((item) => item.id), ["a", "b"]);
  const updated = upsertCommand(added, { id: "a", name: "A2", command: "a2" });
  assert.equal(updated[0].name, "A2");
  assert.deepEqual(removeCommand(updated, "a").map((item) => item.id), ["b"]);
});
