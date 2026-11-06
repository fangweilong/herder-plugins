# 安装 Git Workbench：复制 mod、检查、接入右侧「更改」面板。
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

$target = Join-Path $appHome "mods/git-workbench"
New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
if (Test-Path $target) { Remove-Item -Recurse -Force $target }
Copy-Item -Recurse $here $target
# 运行时生成的类型文件与开发文件不随包安装。
foreach ($name in @("gpui-kit.d.ts", "jsconfig.json", "test", "dev.ps1", "install.ps1", "uninstall.ps1", "install.sh", "uninstall.sh", "layout-panel.ps1", "layout-panel.py", "README.md", "AGENTS.md")) {
  $path = Join-Path $target $name
  if (Test-Path $path) { Remove-Item -Recurse -Force $path }
}

$check = & $herdr check $target 2>&1 | Out-String
Write-Host $check.Trim()
if ($check -notmatch "check passed") { throw "herdr-app check 未通过" }

# 已不再使用浮层快捷键；顺手清掉旧版本留下的绑定。
$keysPath = Join-Path $appHome "keys.json"
if (Test-Path $keysPath) {
  try {
    $keys = Get-Content -LiteralPath $keysPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $binding = "mod.open:git-workbench"
    $removed = @()
    foreach ($prop in @($keys.global.PSObject.Properties)) {
      if ($prop.Value -eq $binding) { $removed += $prop.Name }
    }
    if ($removed.Count -gt 0) {
      Copy-Item -Force $keysPath "$keysPath.git-workbench.bak"
      foreach ($name in $removed) { $keys.global.PSObject.Properties.Remove($name) }
      $json = $keys | ConvertTo-Json -Depth 12
      [System.IO.File]::WriteAllText($keysPath, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
      Write-Host "已移除旧快捷键：$($removed -join ', ')"
    }
  } catch {
    Write-Host "快捷键清理失败（$($_.Exception.Message)），可忽略。"
  }
}

# 把当前布局右侧「更改」面板换成插件（保留面板 id 与可拖拽宽度）。
& (Join-Path $here "layout-panel.ps1") -appHome $appHome

Write-Host "已安装 Git Workbench。点击右侧「更改」打开，或运行：herdr-app do layout.select --stack panel-body --child changes"
