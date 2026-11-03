# 移除中文语言包：删除补丁 mod 与 zh 布局，并切回 main。
$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$home_ = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME }
         elseif ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "herdr-app" }
         else { Join-Path $HOME ".config/herdr-app" }

if (-not (Test-Path (Join-Path $home_ "installed.json"))) {
    throw "找不到 Herdr 应用目录：$home_"
}

if (Get-Process herdr-app -ErrorAction SilentlyContinue) {
    try { & herdr-app do layout.switch --name main | Out-Null } catch {}
}

Remove-Item -Recurse -Force (Join-Path $home_ "mods/zh-cn") -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $home_ "mods/shortcuts") -ErrorAction SilentlyContinue
foreach ($n in "zh", "zh-win98", "zh-terminals") {
    Remove-Item -Force (Join-Path $home_ "layouts/$n.json") -ErrorAction SilentlyContinue
    Remove-Item -Force (Join-Path $home_ "layouts/.state/$n.json") -ErrorAction SilentlyContinue
}
Write-Host "已卸载。内置 mod 会在下次启动 Herdr 时恢复为英文；本次运行中已加载的中文界面会保留到重启。"
