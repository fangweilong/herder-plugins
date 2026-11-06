#!/bin/sh
# 安装审批中继（macOS）。Windows 用 install.ps1；Linux 暂不支持助手。
set -eu

case "$(uname -s 2>/dev/null || echo unknown)" in
  Darwin) ;;
  Linux) echo "approval-relay 的弹窗助手目前只支持 Windows 和 macOS；Linux 尚未支持。" >&2; exit 1 ;;
  MINGW*|MSYS*|CYGWIN*) echo "Windows 请使用 install.ps1。" >&2; exit 1 ;;
  *) echo "不支持的平台：$(uname -s 2>/dev/null || echo unknown)" >&2; exit 1 ;;
esac

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
[ -f "$here/layout.py" ] || { echo "找不到 layout.py" >&2; exit 1; }

# 先让旧助手退出，避免安装期间弹出旧窗口或占用文件。
data="$app_home/data/approval-relay"
if [ -d "$data" ]; then
  mkdir -p "$data"
  printf 'stop\n' > "$data/stop.flag"
  sleep 2
fi

target="$app_home/mods/approval-relay"
# 升级时如果源码目录没有新构建产物，沿用已安装的助手，避免把可用安装弄坏。
preserved=""
if [ -f "$target/helper/approval-helper" ]; then
  preserved=$(mktemp)
  cp "$target/helper/approval-helper" "$preserved"
fi

# Rust 自绘助手：macOS 的二进制名没有 .exe；没有 PowerShell 回退。
# 在删除旧 mod 之前确认有可用助手，避免留下装了一半的目录。
binary="$here/helper-rs/target/release/approval-helper"
if [ ! -f "$binary" ] && [ -z "$preserved" ]; then
  rm -f "$preserved"
  echo "未找到 helper-rs/target/release/approval-helper；先运行 cargo build --release 后重装。" >&2
  echo "macOS 没有 PowerShell 回退，缺少助手时弹窗不会启动。" >&2
  exit 1
fi

mkdir -p "$(dirname "$target")"
rm -rf "$target"
cp -R "$here/mods/approval-relay" "$target"

mkdir -p "$target/helper"
if [ -f "$binary" ]; then
  cp "$binary" "$target/helper/approval-helper"
  echo "已安装 Rust 弹窗助手 approval-helper"
else
  cp "$preserved" "$target/helper/approval-helper"
  echo "未找到新构建产物，沿用已安装的 approval-helper"
fi
chmod +x "$target/helper/approval-helper"
[ -n "$preserved" ] && rm -f "$preserved"

out=$("$herdr" check "$target" 2>&1) || { printf '%s\n' "$out" >&2; echo "herdr-app check 未通过" >&2; exit 1; }
printf '%s\n' "$out"
case "$out" in *"check passed"*) ;; *) echo "herdr-app check 未通过" >&2; exit 1 ;; esac

# 不再绑定侧边面板快捷键；旧版安装过的默认绑定一并移除。
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
      REMOVED*) echo "已移除旧的 ctrl-shift-a 面板绑定（备份 keys.json.bak）" ;;
    esac
  else
    echo "快捷键清理失败，原文件未改。"
  fi
fi

# 布局：移除旧版侧边面板和右侧把手；只保留独立弹窗。
"$py" "$here/layout.py" --mode install --app-home "$app_home"

active=main
if [ -f "$app_home/shared.json" ]; then
  active=$("$py" - "$app_home/shared.json" <<'PY'
import re, sys
try:
    raw = open(sys.argv[1], encoding="utf-8-sig").read()
except FileNotFoundError:
    raw = ""
m = re.search(r'"layout"\s*:\s*"([^"]+)"', raw)
print(m.group(1) if m else "main")
PY
  )
  active=$(printf '%s' "$active" | tr -d '\r')
fi
"$herdr" do layout.switch --name "$active" >/dev/null 2>&1 || true

echo "已安装审批中继（仅弹窗，无侧边栏）。"
