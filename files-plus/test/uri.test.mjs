import test from "node:test";
import assert from "node:assert/strict";
import { fileUri, protocolUrl, resolveHost, sshAuthority, uriPath } from "../uri.js";

test("uriPath: Windows 盘符、空格和单引号", () => {
  assert.equal(uriPath(String.raw`C:\Users\fang w\a'b.ts`), "/C:/Users/fang%20w/a%27b.ts");
});

test("uriPath: POSIX 中文路径", () => {
  assert.equal(uriPath("/home/u/中文 文件.md"), "/home/u/%E4%B8%AD%E6%96%87%20%E6%96%87%E4%BB%B6.md");
});

test("fileUri: 本机与 Remote-SSH", () => {
  assert.equal(fileUri(String.raw`C:\a b\x.ts`, null), "file:///C:/a%20b/x.ts");
  assert.equal(fileUri("/home/u/x.ts", "workbox"), "vscode-remote://ssh-remote+workbox/home/u/x.ts");
});

test("sshAuthority: 小写 Host 原样，大写 Host 十六进制", () => {
  assert.equal(sshAuthority("workbox"), "ssh-remote+workbox");
  assert.equal(sshAuthority("Workbox"), "ssh-remote+7b22686f73744e616d65223a22576f726b626f78227d");
});

test("protocolUrl: 本机与 Remote-SSH", () => {
  assert.equal(protocolUrl("/home/u/x.ts", null), "vscode://file/home/u/x.ts");
  assert.equal(protocolUrl("/home/u/x.ts", "workbox"), "vscode://vscode-remote/ssh-remote+workbox/home/u/x.ts");
});

test("resolveHost: 直连、带空格、经中转", () => {
  const machines = [
    { name: "a", target: "host-a" },
    { name: "b", target: "host b" },
    { name: "c", via: "relay", target: "host-c" },
  ];
  assert.equal(resolveHost("a", machines), "host-a");
  assert.equal(resolveHost("b", machines), null);
  assert.equal(resolveHost("c", machines), null);
  assert.equal(resolveHost("a", machines, { a: "override" }), "override");
  assert.equal(resolveHost("missing", machines), null);
});
