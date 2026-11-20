#!/bin/sh
# 安装 Herdr 配色主题（macOS / Linux）：复制到 Herdr 的 themes/ 目录。
set -eu

here=$(cd "$(dirname "$0")" && pwd)
app_home="${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}"
[ -f "$app_home/installed.json" ] || { echo "找不到 Herdr App 目录：$app_home（先启动一次 herdr-app）" >&2; exit 1; }

target="$app_home/themes"
mkdir -p "$target"
for src in "$here"/themes/*.json; do
  [ -f "$src" ] || continue
  dst="$target/$(basename "$src")"
  # 用户改过的主题先备份，再写回本插件版本。
  if [ -f "$dst" ] && ! cmp -s "$src" "$dst"; then
    cp -f "$dst" "$dst.color-themes.bak"
  fi
  cp -f "$src" "$dst"
  echo "已安装主题：$dst"
done

echo '打开「设置 → 主题 → 深色」，可选 "idea new ui" 和 "opencode black gold"；也可以运行：'
echo "  herdr-app do app.theme --name idea-new-ui"
echo "  herdr-app do app.theme --name opencode-black-gold"
echo '若外观模式是「跟随系统」而系统为浅色，先把外观模式切到「深色」。'