# 安装快捷命令：复制 mod、运行 check、合并 Ctrl+Shift+R 快捷键。
$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$appHome = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME }
           elseif ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "herdr-app" }
           else { Join-Path $env:USERPROFILE ".config\herdr-app" }

if (-not (Test-Path (Join-Path $appHome "installed.json"))) {
  throw "找不到 Herdr App 目录：$appHome（先启动一次 herdr-app）"
}

$herdr = (Get-Command herdr-app -ErrorAction SilentlyContinue).Source
if (-not $herdr) { $herdr = Join-Path $env:LOCALAPPDATA "Programs\herdr-app\herdr-app.exe" }
if (-not (Test-Path $herdr)) { throw "找不到 herdr-app.exe（PATH 或默认安装位置）" }

$target = Join-Path $appHome "mods/quick-commands"
New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
if (Test-Path $target) { Remove-Item -Recurse -Force $target }
Copy-Item -Recurse $here $target
# 开发文件不随包安装。
foreach ($name in @("gpui-kit.d.ts", "jsconfig.json", "test", "install.ps1", "uninstall.ps1", "install.sh", "uninstall.sh", "README.md", "AGENTS.md")) {
  $path = Join-Path $target $name
  if (Test-Path $path) { Remove-Item -Recurse -Force $path }
}

$check = & $herdr check $target 2>&1 | Out-String
Write-Host $check.Trim()
if ($check -notmatch "check passed") { throw "herdr-app check 未通过" }

$key = "ctrl-shift-r"
$binding = "mod.open:quick-commands"
$keysPath = Join-Path $appHome "keys.json"
if (Test-Path $keysPath) {
  try {
    $keys = Get-Content -LiteralPath $keysPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -eq $keys.PSObject.Properties['global']) {
      $keys | Add-Member -NotePropertyName global -NotePropertyValue ([pscustomobject]@{})
    }
    $existing = $keys.global.PSObject.Properties[$key]
    if ($null -eq $existing) {
      Copy-Item -Force $keysPath "$keysPath.quick-commands.bak"
      $keys.global | Add-Member -NotePropertyName $key -NotePropertyValue $binding
      $json = $keys | ConvertTo-Json -Depth 12
      [System.IO.File]::WriteAllText($keysPath, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
      Write-Host "已绑定 $key -> $binding（备份 keys.json.quick-commands.bak）"
    } elseif ($existing.Value -eq $binding) {
      Write-Host "快捷键已存在：$key -> $binding"
    } else {
      Write-Host "快捷键 $key 已被占用（$($existing.Value)），未覆盖。请手动绑定 $binding。"
    }
  } catch {
    Write-Host "快捷键合并失败（$($_.Exception.Message)），原文件未改。请手动绑定 $binding。"
  }
} else {
  # keys.json 不存在时不要凭空造一个只有一条绑定的文件，否则 Herdr 的默认快捷键会全部丢失。
  Write-Host "未找到 keys.json。先启动一次 Herdr，让它生成默认快捷键，再重新运行本脚本；"
  Write-Host "或手动在 keys.json 的 global 中加入 `"$key`": `"$binding`"。"
}

Write-Host "已安装快捷命令。按 Ctrl+Shift+R 打开，或运行：herdr-app do mod.open --name quick-commands"
