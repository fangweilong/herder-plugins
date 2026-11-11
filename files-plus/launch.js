// Windows 启动脚本（纯函数，node --test 可直接测）。
//
// 为什么用 Start-Process 而不是 `& code`：`& code` 会让 PowerShell 等 VS Code
// 的 GUI 进程，继承的 stdout 不关闭，exec 要等到 30 秒超时才返回。
// Start-Process 立即返回。
//
// 为什么带 -WindowStyle Hidden：`code` 实际是 code.cmd，Start-Process 会为批处理
// 新建一个控制台窗口，并在 CLI 退出前一直显示（拉起 VS Code 或远程连接时可达数秒）。
// Hidden 只影响这个控制台窗口，VS Code 自己的窗口照常显示。

// PowerShell 单引号字符串：只把单引号写两遍，其余原样。
const ps = (s) => `'${String(s).replaceAll("'", "''")}'`;

/** 路径包一层双引号，Start-Process 才会在空格处保留成一个参数。 */
const quoted = (s) => ps(`"${s}"`);

/**
 * 生成 Windows 上打开 VS Code 的 PowerShell 脚本。
 * kind: "file" 复用当前窗口跳到文件；"folder" 让 VS Code 自己决定新窗口还是复用。
 */
export function windowsLaunchScript(path, host, uri, url, kind = "file") {
  const folder = kind === "folder";
  const args = [];
  if (!folder) args.push(ps("--reuse-window"));
  if (host) args.push(ps(folder ? "--folder-uri" : "--file-uri"), quoted(uri));
  else args.push(quoted(path));
  return `$ErrorActionPreference = 'Stop'; if (Get-Command code -ErrorAction SilentlyContinue) { Start-Process -FilePath 'code' -ArgumentList @(${args.join(", ")}) -WindowStyle Hidden } else { Start-Process ${ps(url)} }`;
}
