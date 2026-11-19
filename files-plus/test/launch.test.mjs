import test from "node:test";
import assert from "node:assert/strict";
import { windowsOpenScript } from "../launch.js";
import { discoveryScriptWindows } from "../editors.js";
import { latestPathPowerShell } from "../windows-env.js";

test("Windows 本地：Start-Process、路径加引号、单引号翻倍", () => {
  const path = String.raw`C:\a b\it's.ts`;
  const script = windowsOpenScript("code", ["--reuse-window", path], "vscode://file/C:/a%20b/it%27s.ts", "VS Code");
  assert.match(script, /Start-Process -FilePath 'code'/);
  // `& code` 会让 PowerShell 等 GUI 进程，exec 直到超时才返回。
  assert.ok(!script.includes("& code"));
  assert.ok(script.includes("'--reuse-window'"));
  assert.ok(script.includes(String.raw`'"C:\a b\it''s.ts"'`));
  assert.ok(script.includes("Start-Process 'vscode://file/C:/a%20b/it%27s.ts'"));
});

test("Windows：命令的控制台窗口隐藏，协议 URL 回退不隐藏", () => {
  const script = windowsOpenScript("code", ["C:\\a.ts"], "vscode://file/C:/a.ts", "VS Code");
  // code.cmd 由 Start-Process 拉起时会新建可见控制台窗口，必须隐藏。
  assert.match(script, /Start-Process -FilePath 'code'.*-WindowStyle Hidden/);
  // 协议 URL 交给系统处理，隐藏窗口会把编辑器一起隐藏。
  assert.ok(!script.includes("Start-Process 'vscode://file/C:/a.ts' -WindowStyle Hidden"));
});

test("Windows 远程：用 --file-uri", () => {
  const uri = "vscode-remote://ssh-remote+workbox/home/u/x.ts";
  const script = windowsOpenScript(
    "code",
    ["--reuse-window", "--file-uri", uri],
    "vscode://vscode-remote/ssh-remote+workbox/home/u/x.ts",
    "VS Code",
  );
  assert.ok(script.includes("'--reuse-window'"));
  assert.ok(script.includes("'--file-uri'"));
  assert.ok(script.includes(`'"${uri}"'`) === false); // URI 已编码，不含空格，不需要内层引号
  assert.ok(script.includes(`'${uri}'`));
});

test("Windows 本地项目：直接打开文件夹，参数为空时仍可启动", () => {
  const script = windowsOpenScript("idea", [String.raw`D:\Code\my proj`], null, "IntelliJ IDEA");
  assert.ok(!script.includes("--reuse-window"));
  assert.ok(script.includes(String.raw`'"D:\Code\my proj"'`));
  assert.ok(script.includes("throw '找不到命令 idea"));
});

test("Windows 远程项目：用 --folder-uri", () => {
  const uri = "vscode-remote://ssh-remote+workbox/home/u/proj";
  const script = windowsOpenScript("code", ["--folder-uri", uri], "vscode://vscode-remote/ssh-remote+workbox/home/u/proj", "VS Code");
  assert.ok(!script.includes("--reuse-window"));
  assert.ok(script.includes("'--folder-uri'"));
  assert.ok(script.includes(`'${uri}'`));
});

test("Windows：.exe 是 GUI 程序，不加 -WindowStyle Hidden", () => {
  const script = windowsOpenScript(String.raw`C:\apps\OpenIDEA\openidea.exe`, [String.raw`D:\my proj`], null, "OpenIDEA");
  assert.ok(!script.includes("-WindowStyle Hidden"));
  assert.ok(script.includes(String.raw`-FilePath 'C:\apps\OpenIDEA\openidea.exe'`));
});

test("Windows：启动前合并注册表 PATH，后装的命令也能启动", () => {
  const script = windowsOpenScript("openidea", [String.raw`D:\proj`], null, "OpenIDEA");
  // Herdr 的 PATH 是启动快照；openidea 可能是在它之后才加入用户 PATH 的。
  assert.ok(script.includes("[Environment]::GetEnvironmentVariable('Path','User')"));
  assert.ok(script.includes("[Environment]::GetEnvironmentVariable('Path','Machine')"));
  // PATH 必须在 Get-Command 之前合并。
  assert.ok(script.indexOf("$env:Path =") < script.indexOf("Get-Command"));
  assert.ok(script.includes("-FilePath 'openidea'"));
});

test("Windows：发现和启动共用同一份 PATH 合并逻辑", () => {
  const snippet = latestPathPowerShell();
  assert.ok(discoveryScriptWindows().includes(snippet));
  assert.ok(windowsOpenScript("openidea", [String.raw`D:\proj`], null, "OpenIDEA").includes(snippet));
});

test("Windows：没有 url 时给出带编辑器名称的错误", () => {
  const script = windowsOpenScript("zed", ["/home/u/x.ts"], null, "Zed");
  assert.ok(script.includes("throw '找不到命令 zed；请安装 Zed"));
  assert.ok(!script.includes("Start-Process '")); // 没有协议回退
});
