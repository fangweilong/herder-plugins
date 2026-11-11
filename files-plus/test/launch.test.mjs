import test from "node:test";
import assert from "node:assert/strict";
import { windowsLaunchScript } from "../launch.js";

test("Windows 本地：Start-Process、路径加引号、单引号翻倍", () => {
  const path = String.raw`C:\a b\it's.ts`;
  const script = windowsLaunchScript(path, null, "file:///C:/a%20b/it%27s.ts", "vscode://file/C:/a%20b/it%27s.ts");
  assert.match(script, /Start-Process -FilePath 'code'/);
  // `& code` 会让 PowerShell 等 GUI 进程，exec 直到超时才返回。
  assert.ok(!script.includes("& code"));
  assert.ok(script.includes("'--reuse-window'"));
  assert.ok(script.includes(String.raw`'"C:\a b\it''s.ts"'`));
  assert.ok(script.includes("Start-Process 'vscode://file/C:/a%20b/it%27s.ts'"));
});

test("Windows：code.cmd 的控制台窗口隐藏，协议 URL 回退不隐藏", () => {
  const script = windowsLaunchScript(String.raw`C:\a.ts`, null, "file:///C:/a.ts", "vscode://file/C:/a.ts");
  // code.cmd 由 Start-Process 拉起时会新建可见控制台窗口，必须隐藏。
  assert.match(script, /Start-Process -FilePath 'code'.*-WindowStyle Hidden/);
  // 协议 URL 交给系统处理，隐藏窗口会把 VS Code 一起隐藏。
  assert.ok(!script.includes("Start-Process 'vscode://file/C:/a.ts' -WindowStyle Hidden"));
});

test("Windows 远程：用 --file-uri", () => {
  const uri = "vscode-remote://ssh-remote+workbox/home/u/x.ts";
  const script = windowsLaunchScript("/home/u/x.ts", "workbox", uri, "vscode://vscode-remote/ssh-remote+workbox/home/u/x.ts");
  assert.ok(script.includes("'--reuse-window'"));
  assert.ok(script.includes("'--file-uri'"));
  assert.ok(script.includes(`'"${uri}"'`));
});

test("Windows 本地项目：不加 --reuse-window，直接打开文件夹", () => {
  const script = windowsLaunchScript(String.raw`D:\Code\my proj`, null, "file:///D:/Code/my%20proj", "vscode://file/D:/Code/my%20proj", "folder");
  assert.ok(!script.includes("--reuse-window"));
  assert.ok(script.includes(String.raw`'"D:\Code\my proj"'`));
});

test("Windows 远程项目：用 --folder-uri，不加 --reuse-window", () => {
  const uri = "vscode-remote://ssh-remote+workbox/home/u/proj";
  const script = windowsLaunchScript("/home/u/proj", "workbox", uri, "vscode://vscode-remote/ssh-remote+workbox/home/u/proj", "folder");
  assert.ok(!script.includes("--reuse-window"));
  assert.ok(script.includes("'--folder-uri'"));
  assert.ok(script.includes(`'"${uri}"'`));
});
