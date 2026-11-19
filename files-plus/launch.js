// Windows 启动脚本（纯函数，node --test 可直接测）。
//
// 为什么用 Start-Process 而不是 `& <命令>`：`& code` 会让 PowerShell 等编辑器的
// GUI 进程，继承的 stdout 不关闭，exec 要等到 30 秒超时才返回。
// Start-Process 立即返回。
//
// 为什么带 -WindowStyle Hidden：code 实际是 code.cmd，Start-Process 会为批处理
// 新建一个控制台窗口，并在 CLI 退出前一直显示（拉起编辑器或远程连接时可达数秒）。
// Hidden 只影响这个控制台窗口，编辑器自己的窗口照常显示。

import { latestPathPowerShell } from "./windows-env.js";

// PowerShell 单引号字符串：只把单引号写两遍，其余原样。
const ps = (s) => `'${String(s).replaceAll("'", "''")}'`;

/** 路径包一层双引号，Start-Process 才会在空格处保留成一个参数。 */
const quoted = (s) => ps(`"${s}"`);

/** 带空格的参数必须加内层引号；普通命令行参数保持原样。 */
const quoteArg = (arg) => (arg === "" || /\s/.test(arg) ? quoted(arg) : ps(arg));

/**
 * 生成 Windows 上打开编辑器的 PowerShell 脚本。
 *
 * 先尝试配置的 command；找不到时如果有操作系统链接（url）就交给系统，
 * 否则抛出带编辑器名称的错误，由调用方显示通知。
 *
 * 启动前把注册表里最新的机器/用户 PATH 并进来：Herdr 的 PATH 是启动时的快照，
 * 在 Herdr 之后安装的编辑器（例如 OpenIDEA 的 openidea.cmd）能发现却启动不了。
 *
 * `.exe` 是 GUI 程序，-WindowStyle Hidden 可能把它的主窗口一起隐藏；只有
 * `.cmd` / `.bat` 和 PATH 里的命令名需要隐藏控制台窗口。
 */
export function windowsOpenScript(command, args, url = null, name = command) {
  const argList = args.length > 0 ? ` -ArgumentList @(${args.map(quoteArg).join(", ")})` : "";
  const hidden = /\.exe$/i.test(command) ? "" : " -WindowStyle Hidden";
  const invoke = `Start-Process -FilePath ${ps(command)}${argList}${hidden}`;
  // 协议 URL 交给系统处理，隐藏窗口会把编辑器一起隐藏。
  const fallback = url
    ? `Start-Process ${ps(url)}`
    : `throw ${ps(`找不到命令 ${command}；请安装 ${name}，或把它的可执行文件加入 PATH。`)}`;
  const latestPath = `${latestPathPowerShell()}; `;
  return `${latestPath}$ErrorActionPreference = 'Stop'; if (Get-Command ${ps(command)} -ErrorAction SilentlyContinue) { ${invoke} } else { ${fallback} }`;
}
