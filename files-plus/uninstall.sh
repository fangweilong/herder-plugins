#!/bin/sh
# 卸载 files-plus：把个人布局指回内置 files，再删除 mod。
set -eu

app_home=${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}
changed=""
for file in "$app_home/layouts"/*.json; do
  [ -f "$file" ] || continue
  case "$(basename "$file")" in
    main.json|terminals.json|win98.json) continue ;;
  esac
  if grep -q '"mod"[[:space:]]*:[[:space:]]*"files-plus"' "$file"; then
    cp -f "$file" "$file.files-plus-uninstall.bak"
    sed 's/"mod"[[:space:]]*:[[:space:]]*"files-plus"/"mod": "files"/g' "$file" > "$file.files-plus-uninstall.tmp"
    mv -f "$file.files-plus-uninstall.tmp" "$file"
    changed="$changed $(basename "$file")"
  fi
done
if [ -n "$changed" ]; then
  echo "已恢复内置文件面板的布局：$changed"
fi

target="$app_home/mods/files-plus"
if [ -d "$target" ]; then
  rm -rf "$target"
  echo "已删除 $target"
else
  echo "没有安装 files-plus。"
fi
