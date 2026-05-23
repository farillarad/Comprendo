import * as path from 'path';
import * as fs from 'fs';
import { callClaude } from './claudeClient';

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
  imports?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const SCANNABLE_EXTS = new Set(['.py', '.ts', '.js', '.tsx', '.jsx', '.html', '.css', '.json']);
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'out', 'dist', '__pycache__', 'pycache', '.venv', '.comprendo', '.vscode', '.next',
]);
const MAX_FILES = 100;

function walk(dir: string, files: string[] = []): string[] {
  if (files.length >= MAX_FILES) return files;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= MAX_FILES) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) walk(full, files);
      } else if (SCANNABLE_EXTS.has(path.extname(entry.name))) {
        files.push(full);
      }
    }
  } catch { /* skip inaccessible dirs */ }
  return files;
}

function extractImports(content: string, ext: string): Array<{ modPath: string; names: string }> {
  const results: Array<{ modPath: string; names: string }> = [];

  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
    const esRe = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = esRe.exec(content)) !== null) {
      const what = m[1].trim();
      const modPath = m[2];
      if (!modPath.startsWith('.')) continue;
      let names: string;
      const braceMatch = what.match(/\{([^}]+)\}/);
      if (braceMatch) {
        names = braceMatch[1].split(',')
          .map(s => s.trim().split(/\s+as\s+/)[0].trim())
          .filter(Boolean)
          .join(', ');
      } else if (what.startsWith('*')) {
        names = what;
      } else if (what) {
        names = what.split(',')[0].trim();
      } else {
        names = '';
      }
      results.push({ modPath, names });
    }
    const reqRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = reqRe.exec(content)) !== null) {
      if (!m[1].startsWith('.')) continue;
      results.push({ modPath: m[1], names: '' });
    }
  } else if (ext === '.py') {
    const fromRe = /^from\s+(\S+)\s+import\s+(.+)/gm;
    let m: RegExpExecArray | null;
    while ((m = fromRe.exec(content)) !== null) {
      if (!m[1].startsWith('.')) continue;
      const names = m[2].split(',')
        .map((s: string) => s.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean)
        .join(', ');
      results.push({ modPath: m[1], names });
    }
  }

  return results;
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
    nodeMap.set(id, {
      id,
      label: path.basename(f),
      fullPath: f,
      ext: path.extname(f).slice(1),
      type: 'file',
    });
  }

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

  const addEdge = (source: string, target: string, edgeType: 'import' | 'structural', extra?: Partial<GraphEdge>) => {
    const key = `${source}\x00${target}\x00${edgeType}`;
    if (!edgeKey.has(key) && source !== target) {
      edgeKey.add(key);
      edges.push({ source, target, edgeType, ...extra });
    }
  };

  for (const f of files) {
    const parentId = toId(path.dirname(f));
    if (nodeMap.has(parentId)) addEdge(parentId, toId(f), 'structural');
  }

  for (const dir of activeFolders) {
    if (dir === workspaceRoot) continue;
    const parent = path.dirname(dir);
    if (activeFolders.has(parent)) addEdge(toId(parent), toId(dir), 'structural');
  }

  const importAccum = new Map<string, string[]>();

  for (const file of files) {
    const ext = path.extname(file);
    if (!SCANNABLE_EXTS.has(ext)) continue;
    let content: string;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }

    for (const { modPath, names } of extractImports(content, ext)) {
      const base = path.resolve(path.dirname(file), modPath);
      let targetId: string | undefined;
      for (const tryExt of ['', '.ts', '.tsx', '.js', '.jsx', '.py']) {
        const r1 = toId(base + tryExt);
        if (nodeMap.get(r1)?.type === 'file') { targetId = r1; break; }
        const r2 = toId(path.join(base, `index${tryExt}`));
        if (nodeMap.get(r2)?.type === 'file') { targetId = r2; break; }
      }
      if (!targetId) continue;
      const pairKey = `${toId(file)}\x00${targetId}`;
      if (!importAccum.has(pairKey)) importAccum.set(pairKey, []);
      if (names) importAccum.get(pairKey)!.push(...names.split(', ').filter(Boolean));
    }
  }

  for (const [pairKey, nameArr] of importAccum) {
    const [source, target] = pairKey.split('\x00');
    const unique = [...new Set(nameArr)];
    addEdge(source, target, 'import', { imports: unique.length > 0 ? unique.join(', ') : undefined });
  }

  return { nodes: Array.from(nodeMap.values()), edges };
}

export async function explainEdge(
  sourceLabel: string,
  targetLabel: string,
  edgeType: 'import' | 'structural',
  imports?: string,
): Promise<string> {
  const prompt = edgeType === 'import'
    ? `In one sentence, explain in plain English: the file "${sourceLabel}" imports ${imports ? `"${imports}"` : 'something'} from "${targetLabel}". What does this mean for the project architecture?`
    : `In one sentence, explain in plain English: "${targetLabel}" is located inside the "${sourceLabel}" folder in the project structure.`;
  return callClaude(prompt);
}
