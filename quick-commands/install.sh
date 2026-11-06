#!/bin/sh
# 安装快捷命令（macOS / Linux）。Windows 用 install.ps1。
set -eu

here=$(cd "$(dirname "$0")" && pwd)
app_home=${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}
[ -f "$app_home/installed.json" ] || { echo "找不到 Herdr App 目录：$app_home（先启动一次 herdr-app）" >&2; exit 1; }

find_herdr() {
  for c in "${HERDR_APP_BIN:-}" herdr-app; do
    [ -n "$c" ] || continue
    if command -v "$c" >/dev/null 2>&1; then command -v "$c"; return 0; fi
    if [ -x "$c" ]; then printf '%s\n' "$c"; return 0; fi
  done
  if [ -x "/Applications/Herdr.app/Contents/MacOS/herdr-app" ]; then
    printf '%s\n' "/Applications/Herdr.app/Contents/MacOS/herdr-app"; return 0
  fi
  return 1
}
herdr=$(find_herdr) || { echo "找不到 herdr-app（PATH、HERDR_APP_BIN 或 /Applications/Herdr.app）" >&2; exit 1; }

find_python() {
  for c in python3 python; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import json, sys; raise SystemExit(0 if sys.version_info >= (3, 6) else 1)' >/dev/null 2>&1; then
      printf '%s\n' "$c"; return 0
    fi
  done
  return 1
}
py=$(find_python) || { echo "需要 python3（或 python）来安全修改 keys.json" >&2; exit 1; }

target="$app_home/mods/quick-commands"
mkdir -p "$(dirname "$target")"
rm -rf "$target"
cp -R "$here" "$target"
# 开发文件不随包安装。
rm -rf "$target/gpui-kit.d.ts" "$target/jsconfig.json" "$target/test" \
       "$target/install.ps1" "$target/uninstall.ps1" "$target/install.sh" \
       "$target/uninstall.sh" "$target/README.md" "$target/AGENTS.md"

out=$("$herdr" check "$target" 2>&1) || { printf '%s\n' "$out" >&2; echo "herdr-app check 未通过" >&2; exit 1; }
printf '%s\n' "$out"
case "$out" in *"check passed"*) ;; *) echo "herdr-app check 未通过" >&2; exit 1 ;; esac

key="ctrl-shift-r"
binding="mod.open:quick-commands"
keys="$app_home/keys.json"
if [ ! -f "$keys" ]; then
  echo "未找到 keys.json。先启动一次 Herdr，让它生成默认快捷键，再重新运行本脚本；"
  echo "或手动在 keys.json 的 global 中加入 \"$key\": \"$binding\"。"
else
  if result=$("$py" - "$keys" "$key" "$binding" <<'PY'
import json, os, shutil, sys

path, key, binding = sys.argv[1:4]
path = os.path.realpath(path)
try:
    with open(path, encoding="utf-8-sig") as f:
        data = json.load(f)
except Exception as e:
    print(f"读取 keys.json 失败：{e}", file=sys.stderr)
    sys.exit(1)
if not isinstance(data, dict):
    print("keys.json 顶层不是对象", file=sys.stderr)
    sys.exit(1)
glob = data.get("global")
if glob is None:
    glob = {}
    data["global"] = glob
if not isinstance(glob, dict):
    print("keys.json 的 global 不是对象", file=sys.stderr)
    sys.exit(1)
if key not in glob:
    shutil.copy2(path, path + ".quick-commands.bak")
    glob[key] = binding
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.chmod(tmp, os.stat(path).st_mode & 0o777)
    os.replace(tmp, path)
    print("ADDED")
elif glob[key] == binding:
    print("EXISTS")
else:
    print("OCCUPIED " + str(glob[key]))
PY
  ); then
    result=$(printf '%s' "$result" | tr -d '\r')
    case "$result" in
      ADDED*) echo "已绑定 $key -> $binding（备份 keys.json.quick-commands.bak）" ;;
      EXISTS*) echo "快捷键已存在：$key -> $binding" ;;
      OCCUPIED*) echo "快捷键 $key 已被占用（${result#OCCUPIED }），未覆盖。请手动绑定 $binding。" ;;
      *) printf '%s\n' "$result" ;;
    esac
  else
    echo "快捷键合并失败，原文件未改。请手动绑定 $binding。"
  fi
fi

echo "已安装快捷命令。按 Ctrl+Shift+R 打开，或运行：$herdr do mod.open --name quick-commands"
