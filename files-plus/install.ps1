# 安装 files-plus：复制 mod、运行 check、把个人布局里的「文件」面板指向它。
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

$target = Join-Path $appHome "mods/files-plus"
New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
# 升级时保留用户配置的 SSH Host 覆盖。
$hostsPath = Join-Path $target "hosts.json"
$hosts = if (Test-Path $hostsPath) { Get-Content -LiteralPath $hostsPath -Raw -Encoding UTF8 } else { $null }
if (Test-Path $target) { Remove-Item -Recurse -Force $target }
Copy-Item -Recurse $here $target
if ($null -ne $hosts) {
  [System.IO.File]::WriteAllText($hostsPath, $hosts, (New-Object System.Text.UTF8Encoding($false)))
}
# 开发文件不随包安装。
foreach ($name in @("gpui-kit.d.ts", "jsconfig.json", "test", "install.ps1", "uninstall.ps1", "install.sh", "uninstall.sh", "README.md", "AGENTS.md")) {
  $path = Join-Path $target $name
  if (Test-Path $path) { Remove-Item -Recurse -Force $path }
}

$check = & $herdr check $target 2>&1 | Out-String
Write-Host $check.Trim()
if ($check -notmatch "check passed") { throw "herdr-app check 未通过" }

# Herdr 自带的布局每次启动会被还原，只有个人布局能保留改动。
# main / terminals / win98 是内置布局；zh*、main-edited、自定义布局都可以改。
$shipped = @("main.json", "terminals.json", "win98.json")
$layouts = Join-Path $appHome "layouts"
$changed = @()
$already = @()
if (Test-Path $layouts) {
  foreach ($file in Get-ChildItem -LiteralPath $layouts -Filter *.json -File) {
    if ($shipped -contains $file.Name) { continue }
    if ($file.Name -match "\.(bak|old-.*)$") { continue }
    $raw = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
    $next = [regex]::Replace($raw, '"mod"\s*:\s*"files"', '"mod": "files-plus"')
    if ($next -eq $raw) {
      if ($raw -match '"mod"\s*:\s*"files-plus"') { $already += $file.Name }
      continue
    }
    Copy-Item -Force $file.FullName "$($file.FullName).files-plus.bak"
    [System.IO.File]::WriteAllText($file.FullName, $next, (New-Object System.Text.UTF8Encoding($false)))
    $changed += $file.Name
  }
}

if ($changed.Count -gt 0) {
  Write-Host "已指向 files-plus 的布局：$($changed -join ', ')"
} elseif ($already.Count -gt 0) {
  Write-Host "布局已经指向 files-plus：$($already -join ', ')"
} else {
  Write-Host "没有找到引用内置 files 的个人布局。请手动把布局里 content.mod 的 `"files`" 改成 `"files-plus`"。"
}
Write-Host "内置 main 布局按设计保持原样；切换回 main 会看到原来的文件面板。"

# 不自动占用全局按键；需要时把下面几行合并进 keys.json 的 global。
Write-Host "可选快捷键：在 keys.json 的 global 中加入 `"ctrl-shift-g`": `"files-plus.open-in-editor`"（当前文件）、`"ctrl-shift-alt-g`": `"files-plus.open-project`"（项目）"
Write-Host "已安装 files-plus。"
