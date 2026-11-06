#!/bin/sh
# 卸载快捷命令（macOS / Linux）。--purge 同时删除命令模板。
set -eu

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

keys="$app_home/keys.json"
py=""
if [ -f "$keys" ]; then
  py=$(find_python) || { echo "需要 python3（或 python）来清理 keys.json；未做任何修改。" >&2; exit 1; }
fi

target="$app_home/mods/quick-commands"
if [ -d "$target" ]; then
  rm -rf "$target"
  echo "已删除 $target"
else
  echo "未安装快捷命令"
fi

if [ -f "$keys" ]; then
  if result=$("$py" - "$keys" "mod.open:quick-commands" <<'PY'
import json, os, shutil, sys

path, binding = sys.argv[1:3]
path = os.path.realpath(path)
try:
    with open(path, encoding="utf-8-sig") as f:
        data = json.load(f)
except Exception as e:
    print(f"读取 keys.json 失败：{e}", file=sys.stderr)
    sys.exit(1)
glob = data.get("global") if isinstance(data, dict) else None
if isinstance(glob, dict):
    removed = [k for k, v in glob.items() if v == binding]
    if removed:
        shutil.copy2(path, path + ".quick-commands.bak")
        for k in removed:
            del glob[k]
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.chmod(tmp, os.stat(path).st_mode & 0o777)
        os.replace(tmp, path)
        print("REMOVED " + ", ".join(removed))
PY
  ); then
    result=$(printf '%s' "$result" | tr -d '\r')
    case "$result" in
      REMOVED*) echo "已移除快捷键：${result#REMOVED }" ;;
    esac
  else
    echo "快捷键清理失败，原文件未改。"
  fi
fi

if [ "$purge" -eq 1 ]; then
  data="$app_home/data/quick-commands"
  if [ -d "$data" ]; then
    rm -rf "$data"
    echo "已删除命令模板：$data"
  fi
fi
