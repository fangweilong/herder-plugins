// 发现并启动编辑器。编辑器总是开在本机；远程位置只有 VS Code 的 Remote-SSH 能打开。

import { appHome, exec, hc, readTextFile, window as appWindow } from "herdr";
import { discoverFrom, discoveryScriptPosix, discoveryScriptWindows, launchPlan, parseDiscovery } from "./editors.js";
import { windowsOpenScript } from "./launch.js";
import { resolveHost } from "./uri.js";

const platform = () => appWindow()?.platform ?? "linux";

// Windows 上 exec 从 GUI 进程启动 powershell 会分配一个控制台窗口；
// -WindowStyle Hidden 让它保持隐藏，避免每次打开文件都闪黑窗口。
async function powershell(script) {
  const r = await exec("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script]);
  if (r.code !== 0) throw new Error((r.stderr || "").trim() || `PowerShell 退出码 ${r.code}`);
  return r;
}

/**
 * 机器名 -> VS Code Remote-SSH 的 Host。
 * `hc machine ls --json` 里的 target 是 ssh 配置里的 Host；经中转的机器没有可用 Host。
 * 例外写在 `mods/files-plus/hosts.json`：`{"workbox": "workbox-lan"}`。
 */
export async function hostFor(machine) {
  if (!machine) return null;
  let overrides = {};
  const raw = await readTextFile(`${appHome()}/mods/files-plus/hosts.json`).catch(() => null);
  if (raw) {
    try { overrides = JSON.parse(raw) ?? {}; } catch { overrides = {}; }
  }
  if (overrides[machine]) return overrides[machine];
  const r = await hc(["machine", "ls", "--json"]);
  if (r.code !== 0) throw new Error((r.stderr || "").trim() || "无法列出机器");
  const machines = JSON.parse(r.stdout || "{}").machines ?? [];
  const host = resolveHost(machine, machines);
  if (!host) {
    throw new Error(`机器 ${machine} 没有可用的 SSH Host。请在 mods/files-plus/hosts.json 里配置：{"${machine}": "<ssh 配置里的 Host>"}`);
  }
  return host;
}

/**
 * 自动发现编辑器：一次调用同时读取环境变量和探测 PATH。
 * 只在本机找——编辑器总是开在用户面前，远程机器上装没装命令行工具无关紧要。
 */
export async function discoverEditors() {
  const r =
    platform() === "windows"
      ? await powershell(discoveryScriptWindows())
      : await exec("sh", ["-c", discoveryScriptPosix()]);
  if (r.code !== 0) throw new Error((r.stderr || "").trim() || `发现编辑器失败（退出码 ${r.code}）`);
  return discoverFrom(parseDiscovery(r.stdout));
}

/** 本机启动失败后，用编辑器注册的操作系统链接兜底（macOS 的 open / Linux 的 xdg-open）。 */
async function openUrl(url) {
  const opener = platform() === "macos" ? "open" : "xdg-open";
  const r = await exec(opener, [url]);
  if (r.code !== 0) throw new Error((r.stderr || "").trim() || `${opener} 退出码 ${r.code}`);
}

/**
 * 用配置的编辑器打开文件或项目。
 * kind: "file" 打开文件；"folder" 打开项目文件夹。host 为空表示本机。
 */
export async function openInEditor(editor, path, kind = "file", host = null) {
  const plan = launchPlan(editor, path, kind, host);

  if (platform() === "windows") {
    // 编辑器命令可能是 .cmd / .bat，Rust 的 Command 不能直接启动；交给 PowerShell 解析。
    await powershell(windowsOpenScript(plan.command, plan.args, plan.url, editor.name));
    return;
  }

  let failure = null;
  const r = await exec(plan.command, plan.args).catch((e) => {
    failure = e;
    return null;
  });
  if (r?.code === 0) return;
  if (plan.url) return openUrl(plan.url);
  const detail = r
    ? (r.stderr || "").trim() || `退出码 ${r.code}`
    : failure?.message ?? `找不到命令 ${plan.command}`;
  throw new Error(`无法启动 ${editor.name}：${detail}。请确认命令在 Herdr 的 PATH 中，或用 HERDR_EDITORS 指定完整路径。`);
}
