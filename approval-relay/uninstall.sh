#!/bin/sh
# 卸载审批中继（macOS / Linux 清理）。Windows 用 uninstall.ps1。
set -eu

case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW*|MSYS*|CYGWIN*) echo "Windows 请使用 uninstall.ps1。" >&2; exit 1 ;;
esac

here=$(cd "$(dirname "$0")" && pwd)
app_home=${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}
purge=0
case "${1:-}" in
  --purge|-p) purge=1 ;;
  "") ;;
  *) echo "用法：$0 [--purge]" >&2; exit 2 ;;
esac

find_python() {
  for c in python3 python; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import json, sys; raise SystemExit(0 if sys.version_info >= (3, 6) else 1)' >/dev/null 2>&1; then
      printf '%s\n' "$c"; return 0
    fi
  done
  return 1
}
py=$(find_python) || { echo "需要 python3（或 python）来清理布局和 keys.json；未做任何修改。" >&2; exit 1; }
[ -f "$here/layout.py" ] || { echo "找不到 layout.py；未做任何修改。" >&2; exit 1; }

data="$app_home/data/approval-relay"
if [ -d "$data" ]; then
  mkdir -p "$data"
  printf 'stop\n' > "$data/stop.flag"
  sleep 2
fi

for name in approval-relay approval-relay-tab; do
  target="$app_home/mods/$name"
  if [ -d "$target" ]; then
    rm -rf "$target"
  fi
done

keys="$app_home/keys.json"
if [ -f "$keys" ]; then
  if result=$("$py" - "$keys" <<'PY'
import json, os, shutil, sys

path = os.path.realpath(sys.argv[1])
try:
    with open(path, encoding="utf-8-sig") as f:
        data = json.load(f)
except Exception as e:
    print(f"读取 keys.json 失败：{e}", file=sys.stderr)
    sys.exit(1)
glob = data.get("global") if isinstance(data, dict) else None
if isinstance(glob, dict) and glob.get("ctrl-shift-a") in (
    "layout.toggle:approval-relay-panel",
    "approval-relay.open",
):
    shutil.copy2(path, path + ".bak")
    del glob["ctrl-shift-a"]
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.chmod(tmp, os.stat(path).st_mode & 0o777)
    os.replace(tmp, path)
    print("REMOVED")
PY
  ); then
    result=$(printf '%s' "$result" | tr -d '\r')
    case "$result" in
      REMOVED*) echo "已移除 ctrl-shift-a 绑定（备份 keys.json.bak）" ;;
    esac
  else
    echo "快捷键未改，原文件保持不变。"
  fi
fi

"$py" "$here/layout.py" --mode uninstall --app-home "$app_home"

if [ "$purge" -eq 1 ] && [ -d "$data" ]; then
  rm -rf "$data"
fi
echo "已卸载审批中继。"
