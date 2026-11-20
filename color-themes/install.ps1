# 安装 Herdr 配色主题：把主题 JSON 复制到 Herdr 的 themes/ 目录。
$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$appHome = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME }
           elseif ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "herdr-app" }
           else { Join-Path $env:USERPROFILE ".config\herdr-app" }

if (-not (Test-Path (Join-Path $appHome "installed.json"))) {
  throw "找不到 Herdr App 目录：$appHome（先启动一次 herdr-app）"
}

$source = Join-Path $here "themes"
$target = Join-Path $appHome "themes"
New-Item -ItemType Directory -Force -Path $target | Out-Null

Get-ChildItem -LiteralPath $source -Filter "*.json" -File | ForEach-Object {
  $raw = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8
  $parsed = $raw | ConvertFrom-Json
  if ($null -eq $parsed.ansi -or @($parsed.ansi).Count -ne 16) {
    throw "主题文件无效（需要 16 个 ANSI 颜色）：$($_.Name)"
  }
  $dest = Join-Path $target $_.Name
  if (Test-Path $dest) {
    $old = Get-Content -LiteralPath $dest -Raw -Encoding UTF8
    # 用户改过的主题先备份，再写回本插件版本。
    if ($old -ne $raw) { Copy-Item -Force $dest "$dest.color-themes.bak" }
  }
  [System.IO.File]::WriteAllText($dest, $raw, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "已安装主题：$dest"
}

Write-Host '打开「设置 → 主题 → 深色」，可选「idea new ui」和「opencode black gold」；也可以运行：'
Write-Host "  herdr-app do app.theme --name idea-new-ui"
Write-Host "  herdr-app do app.theme --name opencode-black-gold"
Write-Host '若外观模式是「跟随系统」而系统为浅色，先把外观模式切到「深色」。'