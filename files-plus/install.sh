#!/bin/sh
# 安装 files-plus（macOS / Linux）。Windows 用 install.ps1。
set -eu

here=$(cd "$(dirname "$0")" && pwd)
app_home=${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}
[ -f "$app_home/installed.json" ] || { echo "找不到 Herdr App 目录：$app_home（先启动一次 herdr-app）" >&2; exit 1; }
command -v herdr-app >/dev/null 2>&1 || { echo "找不到 herdr-app（把它放进 PATH）" >&2; exit 1; }

target="$app_home/mods/files-plus"
hosts_tmp=""
if [ -f "$target/hosts.json" ]; then
  hosts_tmp=$(mktemp)
  cp "$target/hosts.json" "$hosts_tmp"
fi

rm -rf "$target"
mkdir -p "$(dirname "$target")"
cp -R "$here" "$target"
[ -n "$hosts_tmp" ] && cp "$hosts_tmp" "$target/hosts.json" && rm -f "$hosts_tmp"
# 开发文件不随包安装。
rm -rf "$target/gpui-kit.d.ts" "$target/jsconfig.json" "$target/test" \
       "$target/install.ps1" "$target/uninstall.ps1" "$target/install.sh" \
       "$target/uninstall.sh" "$target/README.md" "$target/AGENTS.md"

herdr-app check "$target"

# 只改个人布局；main / terminals / win98 是内置布局，每次启动会被还原。
changed=""
already=""
for file in "$app_home/layouts"/*.json; do
  [ -f "$file" ] || continue
  case "$(basename "$file")" in
    main.json|terminals.json|win98.json) continue ;;
  esac
  if grep -q '"mod"[[:space:]]*:[[:space:]]*"files"' "$file"; then
    cp -f "$file" "$file.files-plus.bak"
    sed 's/"mod"[[:space:]]*:[[:space:]]*"files"/"mod": "files-plus"/g' "$file" > "$file.files-plus.tmp"
    mv -f "$file.files-plus.tmp" "$file"
    changed="$changed $(basename "$file")"
  elif grep -q '"mod"[[:space:]]*:[[:space:]]*"files-plus"' "$file"; then
    already="$already $(basename "$file")"
  fi
done

if [ -n "$changed" ]; then
  echo "已指向 files-plus 的布局：$changed"
elif [ -n "$already" ]; then
  echo "布局已经指向 files-plus：$already"
else
  echo "没有找到引用内置 files 的个人布局。请手动把布局里 content.mod 的 \"files\" 改成 \"files-plus\"。"
fi
echo "内置 main 布局按设计保持原样；切换回 main 会看到原来的文件面板。"
echo "可选快捷键：在 keys.json 的 global 中加入 \"ctrl-shift-g\": \"files-plus.open-in-editor\"（当前文件）、\"ctrl-shift-alt-g\": \"files-plus.open-project\"（项目）"
echo "已安装 files-plus。"
