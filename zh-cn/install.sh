#!/bin/sh
# Herdr 中文语言包安装（macOS / Linux）
set -e
here=$(cd "$(dirname "$0")" && pwd)
home_="${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}"
[ -f "$home_/installed.json" ] || { echo "找不到 Herdr 应用目录：$home_（先启动一次 herdr-app）" >&2; exit 1; }

# 重装时保留用户选的语言（language.json），与 files-plus 保留 hosts.json 同理。
saved_lang=
cleanup_lang() { [ -n "$saved_lang" ] && rm -f "$saved_lang"; }
trap cleanup_lang EXIT
if [ -f "$home_/mods/zh-cn/language.json" ]; then
  saved_lang=$(mktemp "${TMPDIR:-/tmp}/herdr-zh-cn-language.XXXXXX")
  cp -f "$home_/mods/zh-cn/language.json" "$saved_lang"
fi

rm -rf "$home_/mods/zh-cn"
mkdir -p "$home_/mods"
cp -R "$here/mods/zh-cn" "$home_/mods/zh-cn"
[ -n "$saved_lang" ] && cp -f "$saved_lang" "$home_/mods/zh-cn/language.json"
rm -rf "$home_/mods/shortcuts"
cp -R "$here/mods/shortcuts" "$home_/mods/shortcuts"
cp -f "$here"/layouts/zh*.json "$home_/layouts/"
mkdir -p "$home_/themes"
cp -f "$here"/themes/*.json "$home_/themes/"
if pgrep -x herdr-app >/dev/null 2>&1 || pgrep -f herdr-app >/dev/null 2>&1; then
  herdr-app do layout.switch --name zh
  echo "已安装并切换到「zh」布局。"
else
  echo "已安装。启动 Herdr 后切到「zh」布局。"
fi
