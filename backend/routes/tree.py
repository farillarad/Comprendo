import os
import re
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

IGNORE_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv",
    "dist", "build", ".next", ".nuxt", "out", "coverage",
    ".mypy_cache", ".pytest_cache", ".tox", "eggs", ".eggs"
}

SUPPORTED_EXTENSIONS = {".py", ".ts", ".js", ".tsx", ".jsx", ".mjs", ".cjs"}


class TreeRequest(BaseModel):
    workspace_path: str


class FileNode(BaseModel):
    id: str
    label: str
    path: str
    extension: str


class FileEdge(BaseModel):
    source: str
    target: str


class TreeResponse(BaseModel):
    nodes: list[FileNode]
    edges: list[FileEdge]


def collect_files(workspace_path: str) -> list[Path]:
    root = Path(workspace_path)
    files = []
    for item in root.rglob("*"):
        if item.is_file() and item.suffix in SUPPORTED_EXTENSIONS:
            if not any(part in IGNORE_DIRS for part in item.parts):
                files.append(item)
    return files


def extract_imports_python(content: str, file_path: Path, all_files: list[Path]) -> list[str]:
    deps = []
    import_patterns = [
        re.compile(r"^from\s+([\w.]+)\s+import", re.MULTILINE),
        re.compile(r"^import\s+([\w.]+)", re.MULTILINE),
    ]
    for pattern in import_patterns:
        for match in pattern.finditer(content):
            module = match.group(1)
            parts = module.split(".")
            module_path = "/".join(parts)
            for f in all_files:
                rel = str(f.with_suffix("")).replace("\\", "/")
                if rel.endswith(module_path):
                    deps.append(str(f))
                    break
    return deps


def extract_imports_js_ts(content: str, file_path: Path, all_files: list[Path]) -> list[str]:
    deps = []
    file_dir = file_path.parent
    patterns = [
        re.compile(r'(?:import|from)\s+["\']([^"\']+)["\']', re.MULTILINE),
        re.compile(r'require\s*\(\s*["\']([^"\']+)["\']\s*\)', re.MULTILINE),
    ]
    for pattern in patterns:
        for match in pattern.finditer(content):
            raw = match.group(1)
            if not raw.startswith("."):
                continue
            candidate = (file_dir / raw).resolve()
            for ext in ["", ".ts", ".tsx", ".js", ".jsx", ".mjs"]:
                full = Path(str(candidate) + ext)
                if any(str(f.resolve()) == str(full) for f in all_files):
                    deps.append(str(full))
                    break
            index_candidate = candidate / "index"
            for ext in [".ts", ".tsx", ".js", ".jsx"]:
                full = Path(str(index_candidate) + ext)
                if any(str(f.resolve()) == str(full) for f in all_files):
                    deps.append(str(full))
                    break
    return deps


@router.post("/tree", response_model=TreeResponse)
def build_tree(request: TreeRequest):
    workspace = request.workspace_path
    if not os.path.isdir(workspace):
        raise HTTPException(status_code=400, detail="Invalid workspace path")

    files = collect_files(workspace)
    path_to_id = {str(f): str(f.relative_to(workspace)).replace("\\", "/") for f in files}

    nodes = []
    for f in files:
        node_id = path_to_id[str(f)]
        nodes.append(FileNode(
            id=node_id,
            label=f.name,
            path=str(f).replace("\\", "/"),
            extension=f.suffix.lstrip(".")
        ))

    edges = []
    seen_edges = set()

    for f in files:
        try:
            content = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        if f.suffix == ".py":
            deps = extract_imports_python(content, f, files)
        else:
            deps = extract_imports_js_ts(content, f, files)

        source_id = path_to_id[str(f)]
        for dep in deps:
            dep_resolved = str(Path(dep).resolve())
            for other in files:
                if str(other.resolve()) == dep_resolved:
                    target_id = path_to_id[str(other)]
                    edge_key = (source_id, target_id)
                    if edge_key not in seen_edges and source_id != target_id:
                        seen_edges.add(edge_key)
                        edges.append(FileEdge(source=source_id, target=target_id))
                    break

    return TreeResponse(nodes=nodes, edges=edges)
