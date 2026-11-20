#!/bin/sh
# 卸载 Herdr 配色主题（macOS / Linux）。
set -eu

app_home="${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}"
removed=""
for name in idea-new-ui.json opencode-black-gold.json; do
  path="$app_home/themes/$name"
  if [ -f "$path" ]; then
    rm -f "$path"
    removed="$removed $name"
  fi
done

if [ -n "$removed" ]; then
  echo "已删除主题：$removed"
  echo "当前布局若正在使用它们，会回退到 Herdr 的默认主题；可在「设置 → 主题」重新选择。"
else
  echo "未安装配色主题"
fi