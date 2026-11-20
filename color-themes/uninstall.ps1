# 卸载 Herdr 配色主题：删除本插件安装的主题文件。
$ErrorActionPreference = "Stop"

$appHome = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME }
           elseif ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "herdr-app" }
           else { Join-Path $env:USERPROFILE ".config\herdr-app" }

$names = @("idea-new-ui.json", "opencode-black-gold.json")
$removed = @()
foreach ($name in $names) {
  $path = Join-Path $appHome "themes/$name"
  if (Test-Path $path) {
    Remove-Item -Force $path
    $removed += $name
  }
}

if ($removed.Count -gt 0) {
  Write-Host "已删除主题：$($removed -join ', ')"
  Write-Host "当前布局若正在使用它们，会回退到 Herdr 的默认主题；可在「设置 → 主题」重新选择。"
} else {
  Write-Host "未安装配色主题"
}