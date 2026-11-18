// 文件列表的目录树整理：只做纯数据，不依赖宿主 API，便于 node --test 覆盖。

function createDir(name) {
  return { name, children: new Map(), files: [] };
}

function byName(a, b) {
  const left = a.name.toLowerCase();
  const right = b.name.toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
}

function countFiles(dir) {
  let count = dir.files.length;
  for (const child of dir.children.values()) count += countFiles(child);
  return count;
}

/**
 * 把文件列表整理成目录树行。
 *
 * 目录排在文件前面，同级按名称排序；中间只有一层子目录时（如 `src/app/components`）
 * 合并成一行，避免为了一个目录占用多级缩进。目录默认展开，收起状态由调用方提供。
 *
 * @param {Array<{path: string}>} files 文件列表，path 以 "/" 分隔。
 * @param {(dir: string) => boolean} [isCollapsed] 目录路径是否收起；默认全部展开。
 * @returns {Array<object>} 行：
 *   目录 `{ kind: "dir", path, name, depth, count, collapsed }`；
 *   文件 `{ kind: "file", path, name, file, depth }`，`file` 保留传入对象。
 */
export function fileTreeRows(files, isCollapsed = () => false) {
  const root = createDir("");
  for (const file of files) {
    const parts = String(file.path ?? "").split("/").filter(Boolean);
    if (!parts.length) continue;
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      let next = dir.children.get(part);
      if (!next) {
        next = createDir(part);
        dir.children.set(part, next);
      }
      dir = next;
    }
    dir.files.push({ file, name: parts[parts.length - 1] });
  }
  const rows = [];
  walk(root, "", 0, isCollapsed, rows);
  return rows;
}

function walk(dir, parentPath, depth, isCollapsed, rows) {
  for (const child of [...dir.children.values()].sort(byName)) {
    let node = child;
    let name = child.name;
    let path = parentPath ? `${parentPath}/${name}` : name;
    while (!node.files.length && node.children.size === 1) {
      node = [...node.children.values()][0];
      name = `${name}/${node.name}`;
      path = `${path}/${node.name}`;
    }
    const collapsed = Boolean(isCollapsed(path));
    rows.push({ kind: "dir", path, name, depth, count: countFiles(node), collapsed });
    if (!collapsed) walk(node, path, depth + 1, isCollapsed, rows);
  }
  for (const entry of [...dir.files].sort(byName)) {
    rows.push({ kind: "file", path: entry.file.path, name: entry.name, file: entry.file, depth });
  }
}
