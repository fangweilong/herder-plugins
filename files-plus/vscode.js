// 在本机启动 VS Code。远程文件/文件夹走 Remote-SSH：内容留在那台机器，窗口开在本机。

import { appHome, exec, hc, readTextFile, window as appWindow } from "herdr";
import { windowsLaunchScript } from "./launch.js";
import { fileUri, protocolUrl, resolveHost } from "./uri.js";

const platform = () => appWindow()?.platform ?? "linux";
const isWindows = () => platform() === "windows";

async function powershell(script) {
  const r = await exec("powershell", ["-NoProfile", "-Command", script]);
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
 * kind "file": 在当前 VS Code 窗口里跳到文件；
 * kind "folder": 打开文件夹，由 VS Code 决定新窗口还是复用（与 code <folder> 一致）。
 */
async function launchInVscode(path, host, kind) {
  const uri = fileUri(path, host);
  const url = protocolUrl(path, host);
  const folder = kind === "folder";

  if (isWindows()) {
    // `code` 是 code.cmd，Rust 的 Command 不能直接启动；交给 PowerShell 解析。
    await powershell(windowsLaunchScript(path, host, uri, url, kind));
    return;
  }

  const args = [];
  if (!folder) args.push("--reuse-window");
  if (host) args.push(folder ? "--folder-uri" : "--file-uri", uri);
  else args.push(path);
  const r = await exec("code", args).catch(() => null);
  if (r?.code === 0) return;
  const opener = platform() === "macos" ? "open" : "xdg-open";
  const o = await exec(opener, [url]);
  if (o.code !== 0) throw new Error((o.stderr || "").trim() || `${opener} 退出码 ${o.code}`);
}

/** 在 VS Code 打开一个文件；host 为空表示本机。 */
export function openInVscode(path, host = null) {
  return launchInVscode(path, host, "file");
}

/** 在 VS Code 打开一个项目文件夹；host 为空表示本机。 */
export function openFolderInVscode(path, host = null) {
  return launchInVscode(path, host, "folder");
}
