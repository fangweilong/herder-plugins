# 卸载 files-plus：把个人布局指回内置 files，再删除 mod。
$ErrorActionPreference = "Stop"

$appHome = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME }
           elseif ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "herdr-app" }
           else { Join-Path $env:USERPROFILE ".config\herdr-app" }

$shipped = @("main.json", "terminals.json", "win98.json")
$layouts = Join-Path $appHome "layouts"
$changed = @()
if (Test-Path $layouts) {
  foreach ($file in Get-ChildItem -LiteralPath $layouts -Filter *.json -File) {
    if ($shipped -contains $file.Name) { continue }
    $raw = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
    $next = [regex]::Replace($raw, '"mod"\s*:\s*"files-plus"', '"mod": "files"')
    if ($next -eq $raw) { continue }
    Copy-Item -Force $file.FullName "$($file.FullName).files-plus-uninstall.bak"
    [System.IO.File]::WriteAllText($file.FullName, $next, (New-Object System.Text.UTF8Encoding($false)))
    $changed += $file.Name
  }
}
if ($changed.Count -gt 0) { Write-Host "已恢复内置文件面板的布局：$($changed -join ', ')" }

$target = Join-Path $appHome "mods/files-plus"
if (Test-Path $target) {
  Remove-Item -Recurse -Force $target
  Write-Host "已删除 $target"
} else {
  Write-Host "没有安装 files-plus。"
}
