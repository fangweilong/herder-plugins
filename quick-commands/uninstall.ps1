# 卸载快捷命令：删除 mod、移除本插件写入的快捷键。
# -Purge 同时删除 ~/.config/herdr-app/data/quick-commands（命令模板）。
param([switch]$Purge)

$ErrorActionPreference = "Stop"

$appHome = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME }
           elseif ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "herdr-app" }
           else { Join-Path $env:USERPROFILE ".config\herdr-app" }

$target = Join-Path $appHome "mods/quick-commands"
if (Test-Path $target) {
  Remove-Item -Recurse -Force $target
  Write-Host "已删除 $target"
} else {
  Write-Host "未安装快捷命令"
}

$binding = "mod.open:quick-commands"
$keysPath = Join-Path $appHome "keys.json"
if (Test-Path $keysPath) {
  try {
    $keys = Get-Content -LiteralPath $keysPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -ne $keys.PSObject.Properties['global']) {
      $removed = @()
      foreach ($prop in @($keys.global.PSObject.Properties)) {
        if ($prop.Value -eq $binding) { $removed += $prop.Name }
      }
      if ($removed.Count -gt 0) {
        Copy-Item -Force $keysPath "$keysPath.quick-commands.bak"
        foreach ($name in $removed) { $keys.global.PSObject.Properties.Remove($name) }
        $json = $keys | ConvertTo-Json -Depth 12
        [System.IO.File]::WriteAllText($keysPath, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "已移除快捷键：$($removed -join ', ')"
      }
    }
  } catch {
    Write-Host "快捷键清理失败（$($_.Exception.Message)），原文件未改。"
  }
}

if ($Purge) {
  $data = Join-Path $appHome "data/quick-commands"
  if (Test-Path $data) {
    Remove-Item -Recurse -Force $data
    Write-Host "已删除命令模板：$data"
  }
}
