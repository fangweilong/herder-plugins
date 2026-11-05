# 卸载 Git Workbench：还原「更改」面板、删除 mod 并移除旧快捷键绑定。
$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$appHome = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME }
           elseif ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "herdr-app" }
           else { Join-Path $env:USERPROFILE ".config\herdr-app" }

$layoutHelper = Join-Path $here "layout-panel.ps1"
if (Test-Path $layoutHelper) { & $layoutHelper -appHome $appHome -Restore }

$target = Join-Path $appHome "mods/git-workbench"
if (Test-Path $target) {
  Remove-Item -Recurse -Force $target
  Write-Host "已删除 $target"
} else {
  Write-Host "未安装 Git Workbench"
}

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
      Write-Host "已移除快捷键：$($removed -join ', ')"
    }
  } catch {
    Write-Host "快捷键清理失败（$($_.Exception.Message)），原文件未改。"
  }
}
