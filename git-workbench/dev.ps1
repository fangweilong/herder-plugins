# 开发同步：把插件复制到 Herdr 的 mods 目录、接入「更改」面板并运行 check。
# 不改 keys.json；Herdr 会热重载已打开的窗口。
$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$appHome = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME }
           elseif ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "herdr-app" }
           else { Join-Path $env:USERPROFILE ".config\herdr-app" }

$herdr = (Get-Command herdr-app -ErrorAction SilentlyContinue).Source
if (-not $herdr) { $herdr = Join-Path $env:LOCALAPPDATA "Programs\herdr-app\herdr-app.exe" }
if (-not (Test-Path $herdr)) { throw "找不到 herdr-app.exe" }

$target = Join-Path $appHome "mods/git-workbench"
New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
if (Test-Path $target) { Remove-Item -Recurse -Force $target }
Copy-Item -Recurse $here $target
# 测试与开发脚本不需要跟着安装。
foreach ($name in @("test", "dev.ps1", "install.ps1", "uninstall.ps1", "layout-panel.ps1", "README.md", "gpui-kit.d.ts", "jsconfig.json")) {
  $path = Join-Path $target $name
  if (Test-Path $path) { Remove-Item -Recurse -Force $path }
}

$check = & $herdr check $target 2>&1 | Out-String
Write-Host $check.Trim()
if ($check -notmatch "check passed") { throw "herdr-app check 未通过" }
& (Join-Path $here "layout-panel.ps1") -appHome $appHome
Write-Host "已同步到 $target"
