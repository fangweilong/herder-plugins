# 安装审批中继：复制两个 mod、检查、合并快捷键、给布局加稳定 id 和侧边把手。
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

foreach ($name in @("approval-relay")) {
  $target = Join-Path $appHome "mods/$name"
  New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
  if (Test-Path $target) { Remove-Item -Recurse -Force $target }
  Copy-Item -Recurse (Join-Path $here "mods/$name") $target
  $check = & $herdr check $target 2>&1 | Out-String
  Write-Host $check.Trim()
  if ($check -notmatch "check passed") { throw "herdr-app check 未通过：$name" }
}

# 不再绑定侧边面板快捷键；旧版安装过的默认绑定一并移除。
$keysPath = Join-Path $appHome "keys.json"
if (Test-Path $keysPath) {
  try {
    $keys = Get-Content -LiteralPath $keysPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $current = $keys.global.'ctrl-shift-a'
    if ($current -eq "layout.toggle:approval-relay-panel" -or $current -eq "approval-relay.open") {
      Copy-Item -Force $keysPath "$keysPath.bak"
      $keys.global.PSObject.Properties.Remove('ctrl-shift-a')
      $json = $keys | ConvertTo-Json -Depth 12
      [System.IO.File]::WriteAllText($keysPath, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
      Write-Host "已移除旧的 ctrl-shift-a 面板绑定（备份 keys.json.bak）"
    }
  } catch {
    Write-Host "快捷键清理失败（$($_.Exception.Message)），原文件未改。"
  }
}

# 布局：移除旧版留下的 approval-relay 侧边面板和右侧把手；只保留独立弹窗。
$sharedPath = Join-Path $appHome "shared.json"
$activeLayout = "main"
try {
  $shared = Get-Content -LiteralPath $sharedPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($shared.layout) { $activeLayout = [string]$shared.layout }
} catch {}

function Remove-ApprovalPanel($node) {
  if ($null -eq $node -or $null -eq $node.PSObject.Properties['children']) { return }
  $kept = @()
  foreach ($child in @($node.children)) {
    $isPanel = $null -ne $child.PSObject.Properties['content'] -and $null -ne $child.content -and $child.content.mod -eq "approval-relay"
    if (-not $isPanel) {
      Remove-ApprovalPanel $child
      $kept += $child
    }
  }
  $node.children = $kept
}

function Add-ApprovalHost($layout) {
  $hasHost = $false
  $walk = {
    param($node)
    if ($null -eq $node) { return }
    if ($null -ne $node.PSObject.Properties['content'] -and $null -ne $node.content -and $node.content.mod -eq "approval-relay") { $script:hasApprovalHost = $true }
    foreach ($child in @($node.children)) { & $walk $child }
  }
  $script:hasApprovalHost = $false
  & $walk $layout
  if ($script:hasApprovalHost) { return }
  $hostNode = [pscustomobject]@{
    id = "approval-relay-host"
    type = "block"
    size = [pscustomobject]@{ px = 0 }
    min = 0
    max = 0
    content = [pscustomobject]@{ mod = "approval-relay" }
  }
  if ($null -eq $layout.PSObject.Properties['children']) {
    $layout | Add-Member -NotePropertyName children -NotePropertyValue @($hostNode)
  } else {
    $layout.children = @($layout.children) + $hostNode
  }
}

$layoutDir = Join-Path $appHome "layouts"
if (Test-Path $layoutDir) {
  Get-ChildItem $layoutDir -Filter "*.json" | ForEach-Object {
    $path = $_.FullName
    $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8
    try {
      $layout = $raw | ConvertFrom-Json
      if ($null -ne $layout.PSObject.Properties['floating']) {
        $layout.floating = @($layout.floating | Where-Object {
          $_.id -ne "approval-relay-tab" -and ($null -eq $_.content -or $_.content.mod -ne "approval-relay-tab")
        })
      }
      Remove-ApprovalPanel $layout
      Add-ApprovalHost $layout
      Copy-Item -Force $path "$path.bak"
      $json = $layout | ConvertTo-Json -Depth 100
      [System.IO.File]::WriteAllText($path, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
      Write-Host "已从布局移除审批侧边栏：$($_.BaseName)"
    } catch {
      Write-Host "布局 $($_.BaseName) 清理失败：$($_.Exception.Message)"
    }
  }
}

if ($activeLayout) {
  try { & $herdr do layout.switch --name $activeLayout 2>&1 | Out-Null } catch {}
}

Write-Host "已安装审批中继（仅弹窗，无侧边栏）。"
