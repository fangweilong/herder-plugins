// 编辑器发现与启动参数：纯函数，node --test 可以直接测试。
//
// 不读配置文件。编辑器来自环境变量（HERDR_EDITORS / VISUAL / EDITOR）和 PATH
// 里能直接找到的命令行启动器，选择结果由 Herdr 的 shared 记住。

import { fileUri, protocolUrl, uriPath } from "./uri.js";
import { latestEnvFunctionPowerShell, latestPathPowerShell } from "./windows-env.js";

/** PATH 探测顺序；也是没有环境变量偏好时的菜单顺序。 */
export const PROBE_COMMANDS = [
  "code",
  "code-insiders",
  "cursor",
  "zed",
  "zed-preview",
  "idea",
  "idea64",
  "openidea",
  "subl",
];

/**
 * 已知命令的启动方式。键是 normalizeCommand 之后的名字。
 * 只有 VS Code 内建 Remote-SSH；其他编辑器的远程打开会在界面上标为不可用。
 */
const PRESETS = {
  code: {
    id: "code",
    name: "VS Code",
    file: ["--reuse-window", "{file}"],
    folder: ["{folder}"],
    url: "vscode://file{uri}",
    remote: "vscode",
  },
  "code-insiders": {
    id: "code-insiders",
    name: "VS Code Insiders",
    file: ["--reuse-window", "{file}"],
    folder: ["{folder}"],
    url: "vscode-insiders://file{uri}",
    remote: "vscode",
  },
  cursor: {
    id: "cursor",
    name: "Cursor",
    file: ["--reuse-window", "{file}"],
    folder: ["{folder}"],
    url: "cursor://file{uri}",
  },
  zed: { id: "zed", name: "Zed", file: ["{file}"], folder: ["{folder}"] },
  "zed-preview": { id: "zed-preview", name: "Zed Preview", file: ["{file}"], folder: ["{folder}"] },
  idea: { id: "idea", name: "IntelliJ IDEA", file: ["{file}"], folder: ["{folder}"] },
  // Windows 上的启动器叫 idea64.exe，菜单里与 idea 合并成一项。
  idea64: { id: "idea", name: "IntelliJ IDEA", file: ["{file}"], folder: ["{folder}"] },
  openidea: { id: "openidea", name: "OpenIDEA", file: ["{file}"], folder: ["{folder}"] },
  subl: { id: "subl", name: "Sublime Text", file: ["{file}"], folder: ["{folder}"] },
};

/**
 * 命令名归一化：取 basename、去掉 Windows 扩展名、小写。
 * `C:\Program Files\...\Code.exe` -> `code`，`/usr/local/bin/zed` -> `zed`。
 */
export function normalizeCommand(command) {
  const base = String(command ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
  return base.toLowerCase().replace(/\.(exe|cmd|bat|com|sh)$/, "");
}

/**
 * 拆分环境变量里的命令行，只取第一个词。支持单双引号，反斜杠保持原样
 * （Windows 路径里的 `\` 不是转义符）。`"C:\a b\code.exe" --wait` -> `C:\a b\code.exe`。
 */
export function firstToken(value) {
  let token = "";
  let quote = null;
  let started = false;
  for (const ch of String(value ?? "")) {
    if (quote) {
      if (ch === quote) quote = null;
      else token += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) return token;
    } else {
      token += ch;
      started = true;
    }
  }
  return started ? token : "";
}

/** HERDR_EDITORS 用逗号或分号分隔；每项是一个命令名或可执行文件路径。 */
export function splitEditorList(value) {
  return String(value ?? "")
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** 由命令生成一个可启动的编辑器档案；未知命令也能用，只是没有预设参数。 */
export function editorFor(command, source = "PATH") {
  const normalized = normalizeCommand(command);
  const preset = PRESETS[normalized] ?? {};
  return {
    id: (preset.id ?? normalized) || String(command),
    name: (preset.name ?? normalized) || String(command),
    command,
    file: [...(preset.file ?? ["{path}"])],
    folder: [...(preset.folder ?? ["{path}"])],
    url: preset.url ?? null,
    remote: preset.remote ?? null,
    source,
  };
}

/**
 * 合并发现结果并去重。
 *
 * 顺序：HERDR_EDITORS -> VISUAL -> EDITOR -> PATH 探测。先出现的同名编辑器胜出，
 * 因此环境变量既是显式偏好，也是默认项。
 */
export function discoverFrom({ explicit, visual, editor, found } = {}) {
  const ordered = [
    ...splitEditorList(explicit).map((command) => ({ command, source: "HERDR_EDITORS" })),
    ...(firstToken(visual) ? [{ command: firstToken(visual), source: "VISUAL" }] : []),
    ...(firstToken(editor) ? [{ command: firstToken(editor), source: "EDITOR" }] : []),
    ...(Array.isArray(found) ? found : []).filter(Boolean).map((command) => ({ command, source: "PATH" })),
  ];

  const seen = new Set();
  const editors = [];
  for (const { command, source } of ordered) {
    const item = editorFor(command, source);
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    editors.push(item);
  }
  return editors;
}

/** 解析发现脚本的输出（KEY=value 行）；缺行时按空值处理。 */
export function parseDiscovery(stdout) {
  const sources = { explicit: "", visual: "", editor: "", found: [] };
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    if (line.startsWith("HERDR_EDITORS=")) sources.explicit = line.slice("HERDR_EDITORS=".length).trim();
    else if (line.startsWith("VISUAL=")) sources.visual = line.slice("VISUAL=".length).trim();
    else if (line.startsWith("EDITOR=")) sources.editor = line.slice("EDITOR=".length).trim();
    else if (line.startsWith("FOUND=")) sources.found.push(line.slice("FOUND=".length).trim());
  }
  return sources;
}

/**
 * Windows 发现脚本。
 *
 * Herdr 进程的环境变量和 PATH 是启动时的快照，之后新装的命令不会自己出现，所以这里
 * 从注册表读取最新的用户/机器环境变量，并把最新的机器/用户 PATH 并进来。有些应用
 * （OpenIDEA）完全不写 PATH，再看开始菜单快捷方式和卸载项的 DisplayIcon——它们通常
 * 就指向应用的可执行文件。只接受已知的 exe 名，避免把卸载程序之类的条目当成编辑器。
 */
export function discoveryScriptWindows() {
  const names = PROBE_COMMANDS.map((name) => `'${name}'`).join(", ");
  return `
$ErrorActionPreference = 'SilentlyContinue'
${latestEnvFunctionPowerShell()}
'HERDR_EDITORS=' + (Read-Latest 'HERDR_EDITORS')
'VISUAL=' + (Read-Latest 'VISUAL')
'EDITOR=' + (Read-Latest 'EDITOR')
${latestPathPowerShell()}
foreach ($n in @(${names})) { if (Get-Command $n) { 'FOUND=' + $n } }
$ok = @('code.exe','code-insiders.exe','cursor.exe','zed.exe','zed-preview.exe','idea.exe','idea64.exe','openidea.exe','subl.exe')
$startMenus = @(
  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'),
  (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$shell = New-Object -ComObject WScript.Shell
if ($shell) {
  foreach ($dir in $startMenus) {
    foreach ($lnk in @(Get-ChildItem -LiteralPath $dir -Recurse -Filter *.lnk)) {
      $target = $shell.CreateShortcut($lnk.FullName).TargetPath
      if (-not $target) { continue }
      $name = [IO.Path]::GetFileName($target).ToLowerInvariant()
      if ($ok -contains $name -and (Test-Path -LiteralPath $target)) { 'FOUND=' + $target }
    }
  }
}
$wanted = @('openidea','intellij idea','visual studio code','vs code','cursor','zed','sublime text')
Get-ItemProperty @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
) | Where-Object { $d = $_.DisplayName; $d -and ($wanted | Where-Object { $d -like "*$_*" }) } | ForEach-Object {
  $p = [string]$_.DisplayIcon
  if (-not $p) { return }
  if ($p.StartsWith('"')) {
    $end = $p.IndexOf('"', 1)
    if ($end -gt 1) { $p = $p.Substring(1, $end - 1) }
  } elseif ($p.Contains(',')) {
    $p = $p.Split(',')[0]
  }
  $p = $p.Trim()
  $name = [IO.Path]::GetFileName($p).ToLowerInvariant()
  if ($ok -contains $name -and (Test-Path -LiteralPath $p)) { 'FOUND=' + $p }
}
`;
}

/** POSIX 发现脚本；`${VAR-}` 保证三行环境变量始终存在，解析端不用猜。 */
export function discoveryScriptPosix() {
  return (
    "printf 'HERDR_EDITORS=%s\\nVISUAL=%s\\nEDITOR=%s\\n' \"${HERDR_EDITORS-}\" \"${VISUAL-}\" \"${EDITOR-}\"; " +
    `for n in ${PROBE_COMMANDS.join(" ")}; do command -v "$n" >/dev/null 2>&1 && printf 'FOUND=%s\\n' "$n"; done`
  );
}

/** 一个编辑器也没发现时的兜底，保持升级前的行为；命令不存在时打开会明确报错。 */
export function fallbackEditor() {
  return editorFor("code", "默认");
}

/** 从已保存的默认 id 里选编辑器；id 不存在时退回列表第一项。 */
export function pickDefault(editors, id) {
  const list = Array.isArray(editors) ? editors : [];
  return list.find((editor) => editor?.id === id) ?? list[0] ?? fallbackEditor();
}

/**
 * 校验 shared 里反序列化出来的编辑器列表，丢掉缺字段的项。
 * 只接受启动时真正需要的字段，避免旧版本或手改 shared.json 的数据把菜单弄坏。
 */
export function parseEditors(value) {
  if (!Array.isArray(value)) return null;
  const editors = value
    .filter(
      (editor) =>
        editor &&
        typeof editor === "object" &&
        typeof editor.id === "string" &&
        editor.id &&
        typeof editor.name === "string" &&
        typeof editor.command === "string" &&
        editor.command &&
        Array.isArray(editor.file) &&
        editor.file.every((arg) => typeof arg === "string") &&
        Array.isArray(editor.folder) &&
        editor.folder.every((arg) => typeof arg === "string"),
    )
    .map((editor) => ({
      id: editor.id,
      name: editor.name,
      command: editor.command,
      file: [...editor.file],
      folder: [...editor.folder],
      url: typeof editor.url === "string" ? editor.url : null,
      remote: typeof editor.remote === "string" ? editor.remote : null,
      source: typeof editor.source === "string" ? editor.source : "PATH",
    }));
  return editors.length ? editors : null;
}

/**
 * 解析 `files-plus.editors` 的缓存：{ editors, at, error }。
 * 空列表是有效状态（本机确实没有发现编辑器），与“从没发现过”区分开。
 */
export function parseDiscoveryState(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.editors)) return null;
  return {
    editors: parseEditors(value.editors) ?? [],
    at: Number(value.at) || 0,
    error: typeof value.error === "string" && value.error ? value.error : null,
  };
}

/** 是否内建了远程打开方式（目前只有 VS Code Remote-SSH）。 */
export function supportsRemote(editor) {
  return editor?.remote === "vscode";
}

/** 远程打开的配置缺失时给用户看的错误；与 launchPlan 共用一份文案。 */
export function remoteUnsupported(editor) {
  return (
    `${editor.name} 不支持远程打开。远程位置目前只能交给 VS Code 的 Remote-SSH，` +
    `请在本机安装 VS Code，或把 code 命令加入 Herdr 可见的 PATH。`
  );
}

/**
 * 生成一次打开动作：命令、参数、可选的操作系统链接兜底。
 *
 * kind: "file" 打开文件；"folder" 打开项目文件夹。
 * host: 远程机器的 SSH Host；为空表示本机。只有 VS Code 能打开远程位置，
 * 其他编辑器明确报错，而不是悄悄打开本机同名路径。
 */
export function launchPlan(editor, path, kind = "file", host = null) {
  const folder = kind === "folder";
  const values = { path, file: path, folder: path, uri: uriPath(path) };

  if (!host) {
    return {
      command: editor.command,
      args: [...(folder ? editor.folder : editor.file)].map((arg) => expand(arg, values)),
      url: editor.url ? expand(editor.url, values) : null,
    };
  }

  if (!supportsRemote(editor)) throw new Error(remoteUnsupported(editor));

  return {
    command: editor.command,
    args: folder
      ? ["--folder-uri", fileUri(path, host)]
      : ["--reuse-window", "--file-uri", fileUri(path, host)],
    url: protocolUrl(path, host),
  };
}

/** 展开一个模板字符串；未知占位符直接报错，避免把拼错的 `{fiel}` 当参数传出去。 */
function expand(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) => {
    if (!(key in values)) throw new Error(`启动参数里有未知占位符：${match}`);
    return String(values[key]);
  });
}
