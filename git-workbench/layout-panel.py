#!/usr/bin/env python3
"""把当前布局右侧「更改」面板的 mod 换成 git-workbench（--restore 换回）。

保留节点 id "changes"，所以原生「更改」按钮和可拖拽的侧栏宽度都不变。
与 layout-panel.ps1 行为一致，供 macOS / Linux 安装脚本调用。
"""
import argparse
import json
import os
import re
import shutil
import sys


def find_panel(value):
    """在任意嵌套对象/数组里找 id 为 changes 且带 content 的节点。"""
    if isinstance(value, dict):
        if value.get("id") == "changes" and "content" in value:
            return value
        for child in value.values():
            found = find_panel(child)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find_panel(child)
            if found is not None:
                return found
    return None


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
    parser.add_argument("--restore", action="store_true")
    args = parser.parse_args()

    layout_name = "main"
    shared_path = os.path.join(args.app_home, "shared.json")
    try:
        with open(shared_path, encoding="utf-8-sig") as f:
            raw = f.read()
        match = re.search(r'"layout"\s*:\s*"([^"]+)"', raw)
        if match:
            layout_name = match.group(1)
    except FileNotFoundError:
        pass

    layout_path = os.path.join(args.app_home, "layouts", layout_name + ".json")
    if not os.path.isfile(layout_path):
        print(f"布局 {layout_name} 没有文件，跳过侧栏集成。")
        return 0

    with open(layout_path, encoding="utf-8-sig") as f:
        layout = json.load(f)

    node = find_panel(layout)
    if node is None:
        print(f"布局 {layout_name} 里没有「更改」面板，跳过侧栏集成。")
        return 0

    content = node.get("content")
    if not isinstance(content, dict):
        content = {}
    props = content.get("props")
    if not isinstance(props, dict):
        props = {}

    if args.restore:
        if content.get("mod") != "git-workbench":
            print("「更改」面板当前不是 Git Workbench，未修改。")
            return 0
        node["content"] = {"mod": "changes"}
    else:
        if content.get("mod") == "git-workbench" and props.get("view") == "changes":
            print(f"布局 {layout_name} 的「更改」面板已接入 Git Workbench。")
            return 0
        node["content"] = {"mod": "git-workbench", "props": {"view": "changes"}}

    backup = layout_path + ".git-workbench.bak"
    if not os.path.exists(backup):
        shutil.copy2(layout_path, backup)
    write_json(layout_path, layout)
    if args.restore:
        print(f"已把 {layout_name} 的「更改」面板换回原生 mod。")
    else:
        print(f"已把 {layout_name} 的「更改」面板换成 git-workbench。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
