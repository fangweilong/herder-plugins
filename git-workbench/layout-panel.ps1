# 把当前布局右侧「更改」面板的 mod 换成 git-workbench（-Restore 换回）。
# 保留节点 id "changes"，所以原生「更改」按钮和可拖拽的侧栏宽度都不变。
param(
  [string]$appHome,
  [switch]$Restore
)
$ErrorActionPreference = "Stop"

if (-not $appHome) {
  $appHome = if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME }
             elseif ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "herdr-app" }
             else { Join-Path $env:USERPROFILE ".config\herdr-app" }
}

$layoutName = "main"
$sharedPath = Join-Path $appHome "shared.json"
if (Test-Path $sharedPath) {
  # shared.json 里可能有空字符串键，Windows PowerShell 的 ConvertFrom-Json 会直接失败，这里只取 layout。
  $raw = Get-Content -LiteralPath $sharedPath -Raw -Encoding UTF8
  if ($raw -match '"layout"\s*:\s*"([^"]+)"') { $layoutName = $Matches[1] }
}

$layoutPath = Join-Path $appHome "layouts/$layoutName.json"
if (-not (Test-Path $layoutPath)) {
  Write-Host "布局 $layoutName 没有文件，跳过侧栏集成。"
  return
}

$layout = Get-Content -LiteralPath $layoutPath -Raw -Encoding UTF8 | ConvertFrom-Json

$node = $null
function Find-ChangesPanel($current) {
  if ($null -eq $current) { return }
  if ($current.PSObject.Properties.Name -contains "id" -and $current.id -eq "changes" -and
      $current.PSObject.Properties.Name -contains "content") {
    $script:node = $current
    return
  }
  foreach ($prop in $current.PSObject.Properties) {
    $value = $prop.Value
    if ($value -is [System.Management.Automation.PSCustomObject]) {
      Find-ChangesPanel $value
    } elseif ($value -is [System.Collections.IEnumerable] -and $value -isnot [string]) {
      foreach ($item in $value) {
        if ($item -is [System.Management.Automation.PSCustomObject]) { Find-ChangesPanel $item }
        if ($script:node) { return }
      }
    }
    if ($script:node) { return }
  }
}
Find-ChangesPanel $layout
if (-not $node) {
  Write-Host "布局 $layoutName 里没有「更改」面板，跳过侧栏集成。"
  return
}

if ($Restore) {
  if ($node.content.mod -ne "git-workbench") {
    Write-Host "「更改」面板当前不是 Git Workbench，未修改。"
    return
  }
  $node.content = [pscustomobject]@{ mod = "changes" }
} else {
  if ($node.content.mod -eq "git-workbench" -and $node.content.props.view -eq "changes") {
    Write-Host "布局 $layoutName 的「更改」面板已接入 Git Workbench。"
    return
  }
  $node.content = [pscustomobject]@{
    mod = "git-workbench"
    props = [pscustomobject]@{ view = "changes" }
  }
}

$backup = "$layoutPath.git-workbench.bak"
if (-not (Test-Path $backup)) { Copy-Item -Force $layoutPath $backup }
$json = $layout | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($layoutPath, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))
if ($Restore) { Write-Host "已把 $layoutName 的「更改」面板换回原生 mod。" }
else { Write-Host "已把 $layoutName 的「更改」面板换成 git-workbench。" }
