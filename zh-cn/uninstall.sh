#!/bin/sh
# 移除 Herdr 中文语言包（macOS / Linux）
set -e
home_="${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}"
[ -f "$home_/installed.json" ] || { echo "找不到 Herdr 应用目录：$home_" >&2; exit 1; }
if pgrep -f herdr-app >/dev/null 2>&1; then
  herdr-app do layout.switch --name main >/dev/null 2>&1 || true
fi
rm -rf "$home_/mods/zh-cn" "$home_/mods/shortcuts"
for n in zh zh-win98 zh-terminals; do
  rm -f "$home_/layouts/$n.json" "$home_/layouts/.state/$n.json"
done
rm -f "$home_/themes/solarized.json"
echo "已卸载。内置界面会在下次启动 Herdr 时恢复为英文。"
