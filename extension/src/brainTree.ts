import * as path from 'path';
import * as fs from 'fs';

export interface GraphNode {
  id: string;
  label: string;
  fullPath: string;
  ext: string;
  type: 'file' | 'folder';
}

export interface GraphEdge {
  source: string;
  target: string;
  edgeType: 'import' | 'structural';
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const SUPPORTED_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.py'];
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'out', 'dist', '__pycache__', '.venv', '.comprendo',
]);
const MAX_FILES = 500;

const IMPORT_PATTERNS: Record<string, RegExp[]> = {
  '.ts':  [/import\s+.*?from\s+['"]([^'"]+)['"]/g, /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g],
  '.tsx': [/import\s+.*?from\s+['"]([^'"]+)['"]/g, /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g],
  '.js':  [/import\s+.*?from\s+['"]([^'"]+)['"]/g, /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g],
  '.jsx': [/import\s+.*?from\s+['"]([^'"]+)['"]/g, /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g],
  '.py':  [/^from\s+(\S+)\s+import/gm, /^import\s+(\S+)/gm],
};

function walk(dir: string, files: string[] = []): string[] {
  if (files.length >= MAX_FILES) return files;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= MAX_FILES) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) walk(full, files);
      } else if (SUPPORTED_EXTS.includes(path.extname(entry.name))) {
        files.push(full);
      }
    }
  } catch { /* skip inaccessible dirs */ }
  return files;
}

export function buildGraph(workspaceRoot: string): GraphData {
  const files = walk(workspaceRoot);

  const toId = (f: string): string => {
    const rel = path.relative(workspaceRoot, f).replace(/\\/g, '/');
    return rel === '' ? '.' : rel;
  };

  const nodeMap = new Map<string, GraphNode>();

  for (const f of files) {
    const id = toId(f);
    nodeMap.set(id, { id, label: path.basename(f), fullPath: f, ext: path.extname(f).slice(1), type: 'file' });
  }

  // Collect all ancestor folders of every file, up to workspaceRoot
  const activeFolders = new Set<string>();
  for (const f of files) {
    let dir = path.dirname(f);
    while (true) {
      activeFolders.add(dir);
      if (dir === workspaceRoot) break;
      const parent = path.dirname(dir);
      if (parent === dir || !dir.startsWith(workspaceRoot)) break;
      dir = parent;
    }
  }

  for (const dir of activeFolders) {
    const id = toId(dir);
    nodeMap.set(id, {
      id,
      label: dir === workspaceRoot ? path.basename(workspaceRoot) : path.basename(dir),
      fullPath: dir,
      ext: '',
      type: 'folder',
    });
  }

  const edges: GraphEdge[] = [];
  const edgeKey = new Set<string>();

  const addEdge = (source: string, target: string, edgeType: 'import' | 'structural') => {
    const key = `${source}\x00${target}\x00${edgeType}`;
    if (!edgeKey.has(key) && source !== target) {
      edgeKey.add(key);
      edges.push({ source, target, edgeType });
    }
  };

  // Structural: parent folder -> direct child file
  for (const f of files) {
    const parentId = toId(path.dirname(f));
    if (nodeMap.has(parentId)) addEdge(parentId, toId(f), 'structural');
  }

  // Structural: parent folder -> child folder
  for (const dir of activeFolders) {
    if (dir === workspaceRoot) continue;
    const parent = path.dirname(dir);
    if (activeFolders.has(parent)) addEdge(toId(parent), toId(dir), 'structural');
  }

  // Import edges between files
  for (const file of files) {
    const ext = path.extname(file);
    const patterns = IMPORT_PATTERNS[ext] ?? [];
    let content: string;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }

    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(content)) !== null) {
        const imp = m[1];
        if (!imp.startsWith('.')) continue;
        const base = path.resolve(path.dirname(file), imp);
        let targetId: string | undefined;
        for (const tryExt of ['', ...SUPPORTED_EXTS]) {
          const r1 = toId(base + tryExt);
          if (nodeMap.get(r1)?.type === 'file') { targetId = r1; break; }
          const r2 = toId(path.join(base, `index${tryExt}`));
          if (nodeMap.get(r2)?.type === 'file') { targetId = r2; break; }
        }
        if (targetId) addEdge(toId(file), targetId, 'import');
      }
    }
  }

  return { nodes: Array.from(nodeMap.values()), edges };
}
