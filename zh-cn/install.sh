#!/bin/sh
# Herdr 中文语言包安装（macOS / Linux）
set -e
here=$(cd "$(dirname "$0")" && pwd)
home_="${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}"
[ -f "$home_/installed.json" ] || { echo "找不到 Herdr 应用目录：$home_（先启动一次 herdr-app）" >&2; exit 1; }
rm -rf "$home_/mods/zh-cn"
mkdir -p "$home_/mods"
cp -R "$here/mods/zh-cn" "$home_/mods/zh-cn"
rm -rf "$home_/mods/shortcuts"
cp -R "$here/mods/shortcuts" "$home_/mods/shortcuts"
cp -f "$here"/layouts/zh*.json "$home_/layouts/"
if pgrep -x herdr-app >/dev/null 2>&1 || pgrep -f herdr-app >/dev/null 2>&1; then
  herdr-app do layout.switch --name zh
  echo "已安装并切换到「zh」布局。"
else
  echo "已安装。启动 Herdr 后切到「zh」布局。"
fi
