#!/bin/sh
# 安装 Git Workbench（macOS / Linux）。Windows 用 install.ps1。
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
py=$(find_python) || { echo "需要 python3（或 python）来安全修改 keys.json 和布局" >&2; exit 1; }
[ -f "$here/layout-panel.py" ] || { echo "找不到 layout-panel.py；未做任何修改。" >&2; exit 1; }

target="$app_home/mods/git-workbench"
mkdir -p "$(dirname "$target")"
rm -rf "$target"
cp -R "$here" "$target"
# 开发文件不随包安装。
rm -rf "$target/gpui-kit.d.ts" "$target/jsconfig.json" "$target/test" \
       "$target/dev.ps1" "$target/install.ps1" "$target/uninstall.ps1" \
       "$target/install.sh" "$target/uninstall.sh" "$target/layout-panel.ps1" \
       "$target/layout-panel.py" "$target/README.md" "$target/AGENTS.md"

out=$("$herdr" check "$target" 2>&1) || { printf '%s\n' "$out" >&2; echo "herdr-app check 未通过" >&2; exit 1; }
printf '%s\n' "$out"
case "$out" in *"check passed"*) ;; *) echo "herdr-app check 未通过" >&2; exit 1 ;; esac

# 已不再使用浮层快捷键；顺手清掉旧版本留下的绑定。
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
      REMOVED*) echo "已移除旧快捷键：${result#REMOVED }" ;;
    esac
  else
    echo "快捷键清理失败，可忽略。"
  fi
fi

"$py" "$here/layout-panel.py" --app-home "$app_home"

echo "已安装 Git Workbench。点击右侧「更改」打开，或运行：$herdr do layout.select --stack panel-body --child changes"
