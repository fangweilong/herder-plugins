// Windows 环境变量的统一解析：发现编辑器和启动编辑器都用这里生成的 PowerShell。
//
// Herdr 的 PATH 是进程启动时的快照，在它之后安装的编辑器（例如 OpenIDEA 的
// openidea.cmd）不会出现在 $env:Path 里。两边都合并注册表里最新的机器/用户 PATH，
// 才不会出现「发现得到、却启动不了」这种两套口径。

/**
 * 读取最新的用户/机器环境变量，用户值优先，其次机器值，最后才是进程里的值。
 * 生成的 PowerShell 定义 Read-Latest 函数。
 */
export function latestEnvFunctionPowerShell() {
  return [
    "function Read-Latest([string]$name) {",
    "  $v = [Environment]::GetEnvironmentVariable($name, 'User')",
    "  if (-not $v) { $v = [Environment]::GetEnvironmentVariable($name, 'Machine') }",
    "  if (-not $v) { $v = [Environment]::GetEnvironmentVariable($name) }",
    "  $v",
    "}",
  ].join("\n");
}

/**
 * 把注册表里最新的机器/用户 PATH 并进当前 PowerShell 的 $env:Path。
 * 发现脚本用它解析命令；启动脚本用它重新解析 Herdr 启动后才加入 PATH 的命令。
 */
export function latestPathPowerShell() {
  return [
    "$env:Path = (@(",
    "  $env:Path,",
    "  [Environment]::GetEnvironmentVariable('Path','Machine'),",
    "  [Environment]::GetEnvironmentVariable('Path','User')",
    ") | Where-Object { $_ } | ForEach-Object { [Environment]::ExpandEnvironmentVariables($_) }) -join ';'",
  ].join("\n");
}
