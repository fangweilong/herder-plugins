// VS Code 能识别的 URI：本地文件和 SSH 远程文件。
// 逻辑取自 CacaoRick/herdr-open-vscode 的 uri.js（MIT），
// 保留它对 Windows 盘符、空格、大写 Host 的处理。

// 除 unreserved 字符外全部编码，URI 才能安全穿过 PowerShell 和 code.cmd。
function encodeSegment(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** 文件系统路径转 URI path：`C:\\a b` -> `/C:/a%20b`，`/a b` -> `/a%20b`。 */
export function uriPath(path) {
  const slashed = String(path ?? "").replace(/\\/g, "/");
  const drive = slashed.match(/^([A-Za-z]):(\/.*)?$/);
  if (drive) return `/${drive[1]}:${(drive[2] ?? "/").split("/").map(encodeSegment).join("/")}`;
  return slashed.split("/").map(encodeSegment).join("/");
}

// Herdr 的 JS 没有 TextEncoder：encodeURIComponent 给出的就是 UTF-8 字节。
function utf8Hex(s) {
  return encodeURIComponent(s)
    .replace(/%([0-9A-F]{2})|([\s\S])/g, (_, hex, c) => (hex ?? c.charCodeAt(0).toString(16).padStart(2, "0")).toLowerCase());
}

/**
 * VS Code 会把 URI authority 转成小写；含大写字母的 SSH Host 必须十六进制编码。
 * 这是 Remote-SSH 的已知行为。
 */
export function sshAuthority(host) {
  if (/^[a-z0-9._@-]+$/.test(host)) return `ssh-remote+${host}`;
  return `ssh-remote+${utf8Hex(JSON.stringify({ hostName: host }))}`;
}

/** 文件的 VS Code URI；host 为空表示本机。 */
export function fileUri(path, host) {
  return host ? `vscode-remote://${sshAuthority(host)}${uriPath(path)}` : `file://${uriPath(path)}`;
}

/** 同样的位置，作为交给操作系统的链接；`code` 不在 PATH 时用它兜底。 */
export function protocolUrl(path, host) {
  return host ? `vscode://vscode-remote/${sshAuthority(host)}${uriPath(path)}` : `vscode://file${uriPath(path)}`;
}

/**
 * 从 `hc machine ls --json` 的结果里找出 VS Code Remote-SSH 能用的 Host。
 * 返回 null 表示这台机器不能直接开（例如经 herdr-core 中转）。
 */
export function resolveHost(name, machines, overrides = {}) {
  if (overrides?.[name]) return overrides[name];
  const m = machines.find((x) => x.name === name);
  if (!m || m.via || !m.target || /\s/.test(m.target)) return null;
  return m.target;
}
