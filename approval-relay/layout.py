#!/usr/bin/env python3
"""安装/卸载时维护 approval-relay 的布局节点。

与 install.ps1 / uninstall.ps1 里的布局逻辑一致，供 macOS 安装脚本调用。
"""
import argparse
import glob
import json
import os
import shutil
import sys


def remove_floating(layout):
    """移除旧版留下的 approval-relay-tab 浮层；返回是否有改动。"""
    floating = layout.get("floating")
    if not isinstance(floating, list):
        return False
    kept = []
    changed = False
    for item in floating:
        if isinstance(item, dict):
            content = item.get("content")
            if item.get("id") == "approval-relay-tab" or (
                isinstance(content, dict) and content.get("mod") == "approval-relay-tab"
            ):
                changed = True
                continue
        kept.append(item)
    if changed:
        layout["floating"] = kept
    return changed


def remove_panel(node):
    """递归移除 content.mod 为 approval-relay 的子节点；返回是否有改动。"""
    if not isinstance(node, dict):
        return False
    children = node.get("children")
    if not isinstance(children, list):
        return False
    kept = []
    changed = False
    for child in children:
        content = child.get("content") if isinstance(child, dict) else None
        if isinstance(content, dict) and content.get("mod") == "approval-relay":
            changed = True
            continue
        if remove_panel(child):
            changed = True
        kept.append(child)
    if changed:
        node["children"] = kept
    return changed


def has_host(node):
    """布局里是否已有 approval-relay 宿主节点。"""
    if not isinstance(node, dict):
        return False
    content = node.get("content")
    if isinstance(content, dict) and content.get("mod") == "approval-relay":
        return True
    children = node.get("children")
    if isinstance(children, list):
        return any(has_host(child) for child in children)
    return False


def add_host(layout):
    """没有宿主节点时追加一个 0 宽节点；返回是否新增。"""
    if has_host(layout):
        return False
    host = {
        "id": "approval-relay-host",
        "type": "block",
        "size": {"px": 0},
        "min": 0,
        "max": 0,
        "content": {"mod": "approval-relay"},
    }
    children = layout.get("children")
    if isinstance(children, list):
        children.append(host)
    else:
        layout["children"] = [host]
    return True


def write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.chmod(tmp, os.stat(path).st_mode & 0o777)
    os.replace(tmp, path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-home", required=True)
    parser.add_argument("--mode", choices=("install", "uninstall"), required=True)
    args = parser.parse_args()

    layout_dir = os.path.join(args.app_home, "layouts")
    if not os.path.isdir(layout_dir):
        return 0

    for path in sorted(glob.glob(os.path.join(layout_dir, "*.json"))):
        name = os.path.basename(path)
        try:
            with open(path, encoding="utf-8-sig") as f:
                raw = f.read()
            if args.mode == "uninstall" and "approval-relay" not in raw:
                continue
            layout = json.loads(raw)
            if not isinstance(layout, dict):
                raise ValueError("布局顶层不是对象")

            changed = remove_floating(layout)
            if remove_panel(layout):
                changed = True
            if args.mode == "install" and add_host(layout):
                changed = True
            if not changed:
                continue

            backup = path + ".bak"
            if not os.path.exists(backup):
                shutil.copy2(path, backup)
            write_json(path, layout)
            print(f"已更新布局：{os.path.splitext(name)[0]}")
        except Exception as e:
            print(f"布局 {os.path.splitext(name)[0]} 清理失败：{e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
