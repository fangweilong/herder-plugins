#!/bin/sh
# 卸载 Git Workbench（macOS / Linux）：还原「更改」面板、删除 mod、清理旧快捷键。
set -eu

here=$(cd "$(dirname "$0")" && pwd)
app_home=${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}

find_python() {
  for c in python3 python; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import json, sys; raise SystemExit(0 if sys.version_info >= (3, 6) else 1)' >/dev/null 2>&1; then
      printf '%s\n' "$c"; return 0
    fi
  done
  return 1
}
py=$(find_python) || { echo "需要 python3（或 python）来还原布局和清理 keys.json；未做任何修改。" >&2; exit 1; }
[ -f "$here/layout-panel.py" ] || { echo "找不到 layout-panel.py，无法还原「更改」面板；未做任何修改。" >&2; exit 1; }

# 先还原布局；失败时不要删除 mod，避免留下指向不存在 mod 的面板。
"$py" "$here/layout-panel.py" --app-home "$app_home" --restore

target="$app_home/mods/git-workbench"
if [ -d "$target" ]; then
  rm -rf "$target"
  echo "已删除 $target"
else
  echo "未安装 Git Workbench"
fi

keys="$app_home/keys.json"
if [ -f "$keys" ]; then
  if result=$("$py" - "$keys" "mod.open:git-workbench" <<'PY'
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
        shutil.copy2(path, path + ".git-workbench.bak")
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
