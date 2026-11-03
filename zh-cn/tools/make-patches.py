#!/usr/bin/env python3
"""从 orig/（官方英文）与 reference/（中文参考）生成规则表 patches.json。

规则在 Herdr 启动后作用于它刚还原出来的界面文件：先匹配带上下文的整段，匹配不到时
再匹配改动行。上游改动过的片段匹配失败就保留英文，不会写坏文件。
"""
import difflib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ORIG = os.path.join(ROOT, "orig")
REF = os.path.join(ROOT, "reference")
OUT = os.path.join(ROOT, "mods", "zh-cn", "patches.json")


def line_pairs(old, new):
    """逐行替换的备用规则：上游在同一段里插入或改写别的行时整段匹配会失败，
    但被翻译的那几行仍在，就按行替换（每行必须在文件里唯一出现）。"""
    o = old.splitlines(keepends=True)
    n = new.splitlines(keepends=True)
    pairs = []
    for tag, a1, a2, b1, b2 in difflib.SequenceMatcher(None, o, n, autojunk=False).get_opcodes():
        if tag != "replace":
            continue
        for a, b in zip(o[a1:a2], n[b1:b2]):
            if a != b:
                pairs.append([a, b])
    return pairs


def rules_for(old, new):
    o = old.splitlines(keepends=True)
    n = new.splitlines(keepends=True)
    sm = difflib.SequenceMatcher(None, o, n, autojunk=False)
    rules = []
    for group in sm.get_grouped_opcodes(3):
        i1, i2 = group[0][1], group[-1][2]
        j1, j2 = group[0][3], group[-1][4]
        core_o, core_n = [], []
        for tag, a1, a2, b1, b2 in group:
            if tag != "equal":
                core_o += o[a1:a2]
                core_n += n[b1:b2]
        rule = {"old": "".join(o[i1:i2]), "new": "".join(n[j1:j2])}
        if core_o:
            rule["core_old"] = "".join(core_o)
            rule["core_new"] = "".join(core_n)
        pairs = line_pairs(rule["old"], rule["new"])
        if pairs:
            rule["lines"] = pairs
        rules.append(rule)
    return rules


def walk(base):
    for dp, _, fs in os.walk(base):
        for f in fs:
            path = os.path.join(dp, f)
            yield os.path.relpath(path, base).replace("\\", "/")


def main():
    files = {}
    skipped = []
    for rel in sorted(walk(REF)):
        orig_path = os.path.join(ORIG, rel)
        if not os.path.isfile(orig_path):
            skipped.append(rel)
            continue
        old = open(orig_path, encoding="utf-8").read()
        new = open(os.path.join(REF, rel), encoding="utf-8").read()
        if old == new:
            continue
        files[rel] = rules_for(old, new)

    # 用同一套匹配逻辑回放，必须逐字还原 reference/。
    bad = []
    for rel, rules in files.items():
        text = open(os.path.join(ORIG, rel), encoding="utf-8").read()
        for rule in rules:
            if rule["old"] and text.count(rule["old"]) == 1:
                text = text.replace(rule["old"], rule["new"], 1)
            elif rule.get("core_old") and text.count(rule["core_old"]) == 1:
                text = text.replace(rule["core_old"], rule["core_new"], 1)
            else:
                bad.append((rel, "no match"))
        if text != open(os.path.join(REF, rel), encoding="utf-8").read():
            bad.append((rel, "result differs"))

    data = {"base_version": "0.1.12", "files": files}
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"{len(files)} files, {sum(len(v) for v in files.values())} rules -> {OUT}")
    if skipped:
        print("no english original for:", ", ".join(skipped))
    for b in bad[:20]:
        print("BAD", b)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
