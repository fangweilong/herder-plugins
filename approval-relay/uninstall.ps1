# 卸载审批中继：停掉助手、删除审批 mod 和旧把手、移除布局节点和快捷键。
param([switch]$Purge)

$ErrorActionPreference = "Stop"

$appHome = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME }
           elseif ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "herdr-app" }
           else { Join-Path $env:USERPROFILE ".config\herdr-app" }

$data = Join-Path $appHome "data/approval-relay"
if (Test-Path $data) {
  New-Item -ItemType Directory -Force -Path $data | Out-Null
  Set-Content -LiteralPath (Join-Path $data "stop.flag") -Value "stop" -Encoding UTF8
  Start-Sleep -Milliseconds 1500
}

foreach ($name in @("approval-relay", "approval-relay-tab")) {
  $target = Join-Path $appHome "mods/$name"
  if (Test-Path $target) { Remove-Item -Recurse -Force $target }
}

$keysPath = Join-Path $appHome "keys.json"
if (Test-Path $keysPath) {
  try {
    $keys = Get-Content -LiteralPath $keysPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $value = $keys.global.'ctrl-shift-a'
    if ($value -eq "layout.toggle:approval-relay-panel" -or $value -eq "approval-relay.open") {
      Copy-Item -Force $keysPath "$keysPath.bak"
      $keys.global.PSObject.Properties.Remove('ctrl-shift-a')
      $json = $keys | ConvertTo-Json -Depth 12
      [System.IO.File]::WriteAllText($keysPath, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
      Write-Host "已移除 ctrl-shift-a 绑定（备份 keys.json.bak）"
    }
  } catch {
    Write-Host "快捷键未改：$($_.Exception.Message)"
  }
}

function Remove-Panel($node) {
  if ($null -eq $node -or $null -eq $node.PSObject.Properties['children']) { return }
  $kept = @()
  foreach ($child in @($node.children)) {
    if ($null -ne $child.PSObject.Properties['content'] -and $null -ne $child.content -and $child.content.mod -eq "approval-relay") {
      continue
    }
    Remove-Panel $child
    $kept += $child
  }
  $node.children = $kept
}

$layoutDir = Join-Path $appHome "layouts"
if (Test-Path $layoutDir) {
  Get-ChildItem $layoutDir -Filter "*.json" | ForEach-Object {
    $path = $_.FullName
    $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8
    if ($raw -notmatch "approval-relay") { return }
    try {
      $layout = $raw | ConvertFrom-Json
      if ($null -ne $layout.PSObject.Properties['floating']) {
        $layout.floating = @($layout.floating | Where-Object {
          $_.id -ne "approval-relay-tab" -and ($null -eq $_.content -or $_.content.mod -ne "approval-relay-tab")
        })
      }
      Remove-Panel $layout
      Copy-Item -Force $path "$path.bak"
      $json = $layout | ConvertTo-Json -Depth 100
      [System.IO.File]::WriteAllText($path, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
      Write-Host "已更新布局：$($_.BaseName)"
    } catch {
      Write-Host "布局 $($_.BaseName) 清理失败：$($_.Exception.Message)"
    }
  }
}

if ($Purge -and (Test-Path $data)) { Remove-Item -Recurse -Force $data }
Write-Host "已卸载审批中继。"
