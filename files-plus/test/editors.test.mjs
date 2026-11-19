import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverFrom,
  discoveryScriptWindows,
  editorFor,
  fallbackEditor,
  firstToken,
  launchPlan,
  normalizeCommand,
  parseDiscovery,
  parseDiscoveryState,
  parseEditors,
  pickDefault,
  supportsRemote,
} from "../editors.js";

test("normalizeCommand：取 basename、去掉 Windows 扩展名、忽略大小写", () => {
  assert.equal(normalizeCommand(String.raw`C:\Program Files\Microsoft VS Code\bin\code.cmd`), "code");
  assert.equal(normalizeCommand(String.raw`D:\JetBrains\bin\idea64.exe`), "idea64");
  assert.equal(normalizeCommand("/usr/local/bin/zed"), "zed");
  assert.equal(normalizeCommand("Code.EXE"), "code");
});

test("firstToken：拆出命令本身，支持引号，忽略后面的参数", () => {
  assert.equal(firstToken("code --wait"), "code");
  assert.equal(firstToken(String.raw`"C:\Program Files\Microsoft VS Code\bin\code.cmd" --wait`), String.raw`C:\Program Files\Microsoft VS Code\bin\code.cmd`);
  assert.equal(firstToken("/usr/bin/zed"), "/usr/bin/zed");
  assert.equal(firstToken(""), "");
});

test("editorFor：已知命令带预设参数，未知命令也能启动", () => {
  const code = editorFor(String.raw`C:\Program Files\Microsoft VS Code\bin\code.cmd`, "EDITOR");
  assert.equal(code.id, "code");
  assert.equal(code.name, "VS Code");
  assert.equal(code.remote, "vscode");
  assert.deepEqual(code.file, ["--reuse-window", "{file}"]);
  assert.equal(code.source, "EDITOR");

  const idea = editorFor("idea64");
  assert.equal(idea.id, "idea");
  assert.equal(idea.name, "IntelliJ IDEA");

  const app = editorFor(String.raw`C:\apps\OpenIDEA\openidea.exe`, "PATH");
  assert.equal(app.id, "openidea");
  assert.equal(app.name, "OpenIDEA");
  assert.deepEqual(app.file, ["{file}"]);

  const custom = editorFor("/opt/tools/myedit");
  assert.equal(custom.id, "myedit");
  assert.equal(custom.name, "myedit");
  assert.deepEqual(custom.file, ["{path}"]);
  assert.equal(custom.remote, null);
});

test("discoverFrom：HERDR_EDITORS -> VISUAL -> EDITOR -> PATH，并按 id 去重", () => {
  const editors = discoverFrom({
    explicit: "zed, idea64",
    visual: "code --wait",
    editor: "code",
    found: ["code", "subl"],
  });
  assert.deepEqual(editors.map((editor) => editor.id), ["zed", "idea", "code", "subl"]);
  assert.deepEqual(editors.map((editor) => editor.source), ["HERDR_EDITORS", "HERDR_EDITORS", "VISUAL", "PATH"]);
});

test("discoverFrom：空结果交给兜底，HERDR_EDITORS 支持逗号/分号", () => {
  assert.deepEqual(discoverFrom({}), []);

  const editors = discoverFrom({ explicit: "code; /opt/tools/myedit , zed" });
  assert.deepEqual(editors.map((editor) => editor.name), ["VS Code", "myedit", "Zed"]);
});

test("parseDiscovery：解析环境变量和 PATH 探测输出", () => {
  const sources = parseDiscovery(
    ["HERDR_EDITORS=zed,idea", "VISUAL=", "EDITOR=code --wait", "FOUND=code", "FOUND=subl", ""].join("\n"),
  );
  assert.deepEqual(sources, { explicit: "zed,idea", visual: "", editor: "code --wait", found: ["code", "subl"] });
  assert.deepEqual(parseDiscovery(""), { explicit: "", visual: "", editor: "", found: [] });
});

test("discoverFrom：注册表里找到的完整路径也能映射到预设", () => {
  const editors = discoverFrom({ found: [String.raw`C:\apps\OpenIDEA\openidea.exe`] });
  assert.equal(editors.length, 1);
  assert.equal(editors[0].id, "openidea");
  assert.equal(editors[0].name, "OpenIDEA");
  assert.equal(editors[0].command, String.raw`C:\apps\OpenIDEA\openidea.exe`);
});

test("discoveryScriptWindows：包含 OpenIDEA、最新环境变量、开始菜单和注册表兜底", () => {
  const script = discoveryScriptWindows();
  assert.ok(script.includes("'openidea'"));
  assert.ok(script.includes("openidea.exe"));
  assert.ok(script.includes("DisplayIcon"));
  assert.ok(script.includes("GetEnvironmentVariable('Path','User')"));
  // 后装的编辑器可能只更新了注册表里的用户环境变量。
  assert.ok(script.includes("GetEnvironmentVariable($name, 'User')"));
  // 没写 PATH、也没进卸载项的应用，从开始菜单快捷方式找目标。
  assert.ok(script.includes("WScript.Shell"));
  assert.ok(script.includes("Start Menu"));
});

test("parseEditors：只保留结构完整的项，并补齐可选字段", () => {
  assert.equal(parseEditors(null), null);
  assert.equal(parseEditors([]), null);
  assert.equal(parseEditors([{ id: "code" }]), null);

  const editors = parseEditors([
    { id: "code", name: "VS Code", command: "code", file: ["{file}"], folder: ["{folder}"], url: "vscode://file{uri}", remote: "vscode" },
    { id: "zed", name: "Zed", command: "zed", file: ["{file}"], folder: ["{folder}"], source: "PATH", extra: true },
  ]);
  assert.deepEqual(editors.map((editor) => editor.id), ["code", "zed"]);
  assert.equal(editors[0].remote, "vscode");
  assert.equal(editors[1].url, null);
  assert.equal(editors[1].remote, null);
  assert.equal(editors[1].source, "PATH");
  assert.equal("extra" in editors[1], false);
});

test("pickDefault：优先记住的 id，否则第一项，再否则 VS Code", () => {
  const [code, zed] = discoverFrom({ explicit: "code,zed" });
  assert.equal(pickDefault([code, zed], "zed").id, "zed");
  assert.equal(pickDefault([code, zed], "missing").id, "code");
  assert.equal(pickDefault([], "zed").name, "VS Code");
});

test("parseDiscoveryState：空列表是有效状态，损坏的数据当作没有缓存", () => {
  assert.equal(parseDiscoveryState(null), null);
  assert.equal(parseDiscoveryState({}), null);
  assert.equal(parseDiscoveryState({ editors: "nope" }), null);

  const empty = parseDiscoveryState({ editors: [], at: 123, error: "没有发现编辑器" });
  assert.deepEqual(empty.editors, []);
  assert.equal(empty.at, 123);
  assert.equal(empty.error, "没有发现编辑器");

  const state = parseDiscoveryState({ editors: [fallbackEditor()], at: "456" });
  assert.equal(state.editors.length, 1);
  assert.equal(state.at, 456);
  assert.equal(state.error, null);
});

test("fallbackEditor：默认是 VS Code", () => {
  const editor = fallbackEditor();
  assert.equal(editor.name, "VS Code");
  assert.equal(editor.command, "code");
  assert.equal(editor.source, "默认");
});

test("launchPlan：本机文件与项目使用预设参数", () => {
  const code = editorFor("code");
  const file = launchPlan(code, String.raw`C:\a b\x.ts`, "file");
  assert.deepEqual(file.args, ["--reuse-window", String.raw`C:\a b\x.ts`]);
  assert.equal(file.url, "vscode://file/C:/a%20b/x.ts");

  const zed = editorFor("zed");
  const folder = launchPlan(zed, String.raw`C:\a b\proj`, "folder");
  assert.deepEqual(folder.args, [String.raw`C:\a b\proj`]);
  assert.equal(folder.url, null);
});

test("launchPlan：VS Code 远程沿用 Remote-SSH 的 URI 参数", () => {
  const code = editorFor("code");
  const file = launchPlan(code, "/home/u/x.ts", "file", "workbox");
  assert.deepEqual(file.args, ["--reuse-window", "--file-uri", "vscode-remote://ssh-remote+workbox/home/u/x.ts"]);
  assert.equal(file.url, "vscode://vscode-remote/ssh-remote+workbox/home/u/x.ts");

  const folder = launchPlan(code, "/home/u/proj", "folder", "workbox");
  assert.deepEqual(folder.args, ["--folder-uri", "vscode-remote://ssh-remote+workbox/home/u/proj"]);
});

test("launchPlan：其他编辑器不能打开远程位置，明确报错", () => {
  const zed = editorFor("zed");
  assert.equal(supportsRemote(zed), false);
  assert.throws(() => launchPlan(zed, "/home/u/x.ts", "file", "workbox"), /不支持远程打开/);
});

test("launchPlan：拼错的占位符直接报错", () => {
  const broken = { ...fallbackEditor(), file: ["{fiel}"] };
  assert.throws(() => launchPlan(broken, "/x", "file"), /未知占位符/);
});
