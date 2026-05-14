import * as path from 'path';
import * as fs from 'fs';

export interface GraphNode {
  id: string;
  label: string;
  fullPath: string;
  ext: string;
}

export interface GraphEdge {
  source: string;
  target: string;
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

function walk(dir: string, collected: string[] = []): string[] {
  if (collected.length >= MAX_FILES) return collected;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (collected.length >= MAX_FILES) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) walk(full, collected);
      } else if (SUPPORTED_EXTS.includes(path.extname(entry.name))) {
        collected.push(full);
      }
    }
  } catch { /* skip inaccessible dirs */ }
  return collected;
}

export function buildGraph(workspaceRoot: string): GraphData {
  const files = walk(workspaceRoot);
  const toId = (f: string) => path.relative(workspaceRoot, f).replace(/\\/g, '/');

  const nodeMap = new Map<string, GraphNode>(
    files.map(f => [
      toId(f),
      { id: toId(f), label: path.basename(f), fullPath: f, ext: path.extname(f).slice(1) },
    ])
  );

  const edgeSet = new Set<string>();

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
          if (nodeMap.has(r1)) { targetId = r1; break; }
          const r2 = toId(path.join(base, `index${tryExt}`));
          if (nodeMap.has(r2)) { targetId = r2; break; }
        }

        if (targetId) {
          const src = toId(file);
          if (src !== targetId) edgeSet.add(`${src}\x00${targetId}`);
        }
      }
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeSet).map(k => {
      const i = k.indexOf('\x00');
      return { source: k.slice(0, i), target: k.slice(i + 1) };
    }),
  };
}
