# Herdr 中文语言包安装：复制补丁 mod，把当前 main 布局克隆成 zh 布局（含不可见的补丁块），再切过去。
$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$home_ = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME }
         elseif ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "herdr-app" }
         else { Join-Path $HOME ".config/herdr-app" }

if (-not (Test-Path (Join-Path $home_ "installed.json"))) {
    throw "找不到 Herdr 应用目录：$home_（先启动一次 herdr-app）"
}

$target = Join-Path $home_ "mods/zh-cn"
if (Test-Path $target) { Remove-Item -Recurse -Force $target }
New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
Copy-Item -Recurse (Join-Path $here "mods/zh-cn") $target

# 快捷键页：设置里的新标签页，由独立的 shortcuts mod 注入 frame/settings。
$shortcuts = Join-Path $home_ "mods/shortcuts"
if (Test-Path $shortcuts) { Remove-Item -Recurse -Force $shortcuts }
Copy-Item -Recurse (Join-Path $here "mods/shortcuts") $shortcuts

# 中文布局 = 官方布局 + 一个不绘制任何内容的浮动补丁块（main / Herdr 98 / Terminals）。
Get-ChildItem (Join-Path $here "layouts") -Filter "zh*.json" | ForEach-Object {
    Copy-Item -Force $_.FullName (Join-Path $home_ "layouts/$($_.Name)")
}

# 主题随语言包分发：zh 布局固定使用 solarized。
$themes = Join-Path $here "themes"
if (Test-Path $themes) {
    New-Item -ItemType Directory -Force -Path (Join-Path $home_ "themes") | Out-Null
    Get-ChildItem $themes -Filter "*.json" | ForEach-Object {
        Copy-Item -Force $_.FullName (Join-Path $home_ "themes/$($_.Name)")
    }
}

$running = $null -ne (Get-Process herdr-app -ErrorAction SilentlyContinue)
if ($running) {
    & herdr-app do layout.switch --name zh
    Write-Host "已安装并切换到「zh」布局。界面中的面板会立即变为中文。"
} else {
    Write-Host "已安装。启动 Herdr 后切到「zh」布局（Ctrl+Shift+L 循环，或命令面板 Layout）。"
}
