import * as vscode from "vscode";
import { getConfig } from "./extension";
import { SidebarProvider } from "./sidebar";

interface FileNode {
  id: string;
  label: string;
  path: string;
  extension: string;
}

interface FileEdge {
  source: string;
  target: string;
}

export class BrainTreePanel {
  public static currentPanel: BrainTreePanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    workspacePath: string,
    sidebar: SidebarProvider
  ) {
    const column = vscode.ViewColumn.One;

    if (BrainTreePanel.currentPanel) {
      BrainTreePanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "comprendo.brainTree",
      "Comprendo — Brain Tree",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    BrainTreePanel.currentPanel = new BrainTreePanel(panel, workspacePath, sidebar);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private workspacePath: string,
    private sidebar: SidebarProvider
  ) {
    this._panel = panel;
    this._panel.webview.html = this._getLoadingHtml();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.command === "nodeClicked") {
          await this.sidebar.showExplanation(message.filePath, message.nodeId);
        }
      },
      null,
      this._disposables
    );

    this._fetchAndRender();
  }

  private async _fetchAndRender() {
    const config = getConfig();
    const backendUrl = config.get<string>("backendUrl") || "http://localhost:8000";

    try {
      const response = await fetch(`${backendUrl}/tree`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_path: this.workspacePath }),
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const data = await response.json() as { nodes: FileNode[]; edges: FileEdge[] };
      this._panel.webview.html = this._getGraphHtml(data.nodes, data.edges);
    } catch (err: any) {
      this._panel.webview.html = this._getErrorHtml(err.message);
    }
  }

  private _getLoadingHtml(): string {
    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
  body { background: #1e1e1e; color: #ccc; display: flex; align-items: center;
         justify-content: center; height: 100vh; margin: 0; font-family: sans-serif; }
  .spinner { text-align: center; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%;
         background: #4fc3f7; margin: 0 4px; animation: bounce 1s infinite alternate; }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce { from { transform: translateY(0); } to { transform: translateY(-12px); } }
</style>
</head>
<body>
  <div class="spinner">
    <div><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
    <p>Building Brain Tree...</p>
  </div>
</body>
</html>`;
  }

  private _getErrorHtml(message: string): string {
    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
  body { background: #1e1e1e; color: #f48771; display: flex; align-items: center;
         justify-content: center; height: 100vh; margin: 0; font-family: sans-serif; }
  .box { text-align: center; max-width: 500px; padding: 24px; }
  code { background: #2d2d2d; padding: 8px 12px; border-radius: 4px; display: block;
         margin-top: 12px; color: #ccc; font-size: 13px; white-space: pre-wrap; }
</style>
</head>
<body>
  <div class="box">
    <h2>Failed to build Brain Tree</h2>
    <p>Make sure the Comprendo backend is running:</p>
    <code>cd backend\npip install -r requirements.txt\nuvicorn main:app --reload</code>
    <p style="margin-top:16px; color:#999; font-size:13px;">${message}</p>
  </div>
</body>
</html>`;
  }

  private _getGraphHtml(nodes: FileNode[], edges: FileEdge[]): string {
    const nodesJson = JSON.stringify(nodes);
    const edgesJson = JSON.stringify(edges);

    const extColors: Record<string, string> = {
      py: "#4fc3f7",
      ts: "#81c784",
      tsx: "#a5d6a7",
      js: "#fff176",
      jsx: "#ffe082",
      mjs: "#ffcc80",
      cjs: "#ffcc80",
    };

    const colorMap = JSON.stringify(extColors);

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #1e1e1e; overflow: hidden; font-family: 'Segoe UI', sans-serif; }
  #graph { width: 100vw; height: 100vh; }
  .node circle { cursor: pointer; stroke-width: 2px; }
  .node text { fill: #ddd; font-size: 11px; pointer-events: none; }
  .link { stroke: #444; stroke-opacity: 0.7; }
  .link.highlighted { stroke: #4fc3f7; stroke-opacity: 1; stroke-width: 2px; }
  .node.dimmed circle { opacity: 0.2; }
  .node.dimmed text { opacity: 0.2; }
  #tooltip {
    position: fixed; background: #2d2d2d; color: #ddd; padding: 8px 12px;
    border-radius: 6px; font-size: 12px; pointer-events: none; opacity: 0;
    transition: opacity 0.15s; border: 1px solid #444; max-width: 260px;
  }
  #legend {
    position: fixed; bottom: 16px; left: 16px; background: #2a2a2a;
    border: 1px solid #444; border-radius: 8px; padding: 10px 14px;
    font-size: 11px; color: #aaa;
  }
  #legend .row { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
  #legend .dot { width: 10px; height: 10px; border-radius: 50%; }
  #info { position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
          color: #666; font-size: 12px; pointer-events: none; }
</style>
</head>
<body>
<div id="graph"></div>
<div id="tooltip"></div>
<div id="info">Click a node to explore — drag to reposition — scroll to zoom</div>
<div id="legend"></div>

<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
const nodes = ${nodesJson};
const links = ${edgesJson};
const COLOR_MAP = ${colorMap};

const vscode = acquireVsCodeApi();

const width = window.innerWidth;
const height = window.innerHeight;

const svg = d3.select("#graph")
  .append("svg")
  .attr("width", width)
  .attr("height", height);

const g = svg.append("g");

// Zoom
const zoom = d3.zoom()
  .scaleExtent([0.1, 4])
  .on("zoom", (event) => g.attr("transform", event.transform));
svg.call(zoom);

// Arrow marker
svg.append("defs").append("marker")
  .attr("id", "arrow")
  .attr("viewBox", "0 -5 10 10")
  .attr("refX", 20)
  .attr("refY", 0)
  .attr("markerWidth", 6)
  .attr("markerHeight", 6)
  .attr("orient", "auto")
  .append("path")
  .attr("d", "M0,-5L10,0L0,5")
  .attr("fill", "#555");

const simulation = d3.forceSimulation(nodes)
  .force("link", d3.forceLink(links).id(d => d.id).distance(120))
  .force("charge", d3.forceManyBody().strength(-300))
  .force("center", d3.forceCenter(width / 2, height / 2))
  .force("collision", d3.forceCollide(30));

const link = g.append("g")
  .selectAll("line")
  .data(links)
  .join("line")
  .attr("class", "link")
  .attr("marker-end", "url(#arrow)");

const node = g.append("g")
  .selectAll(".node")
  .data(nodes)
  .join("g")
  .attr("class", "node")
  .call(d3.drag()
    .on("start", dragStart)
    .on("drag", dragged)
    .on("end", dragEnd));

node.append("circle")
  .attr("r", 14)
  .attr("fill", d => COLOR_MAP[d.extension] || "#90a4ae")
  .attr("stroke", "#1e1e1e");

node.append("text")
  .attr("dy", 26)
  .attr("text-anchor", "middle")
  .text(d => d.label);

const tooltip = document.getElementById("tooltip");

node.on("mouseover", (event, d) => {
    tooltip.style.opacity = "1";
    tooltip.textContent = d.id;
  })
  .on("mousemove", (event) => {
    tooltip.style.left = (event.clientX + 14) + "px";
    tooltip.style.top = (event.clientY - 10) + "px";
  })
  .on("mouseout", () => { tooltip.style.opacity = "0"; })
  .on("click", (event, d) => {
    event.stopPropagation();
    highlightNode(d);
    vscode.postMessage({ command: "nodeClicked", filePath: d.path, nodeId: d.id });
  });

svg.on("click", () => clearHighlight());

function highlightNode(selected) {
  const connectedIds = new Set();
  connectedIds.add(selected.id);
  links.forEach(l => {
    const sid = typeof l.source === "object" ? l.source.id : l.source;
    const tid = typeof l.target === "object" ? l.target.id : l.target;
    if (sid === selected.id) connectedIds.add(tid);
    if (tid === selected.id) connectedIds.add(sid);
  });

  node.classed("dimmed", d => !connectedIds.has(d.id));
  link.classed("highlighted", l => {
    const sid = typeof l.source === "object" ? l.source.id : l.source;
    const tid = typeof l.target === "object" ? l.target.id : l.target;
    return sid === selected.id || tid === selected.id;
  });
}

function clearHighlight() {
  node.classed("dimmed", false);
  link.classed("highlighted", false);
}

simulation.on("tick", () => {
  link
    .attr("x1", d => d.source.x)
    .attr("y1", d => d.source.y)
    .attr("x2", d => d.target.x)
    .attr("y2", d => d.target.y);
  node.attr("transform", d => \`translate(\${d.x},\${d.y})\`);
});

function dragStart(event, d) {
  if (!event.active) simulation.alphaTarget(0.3).restart();
  d.fx = d.x; d.fy = d.y;
}
function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
function dragEnd(event, d) {
  if (!event.active) simulation.alphaTarget(0);
  d.fx = null; d.fy = null;
}

// Build legend
const seen = {};
nodes.forEach(n => { if (!seen[n.extension]) seen[n.extension] = COLOR_MAP[n.extension] || "#90a4ae"; });
const legend = document.getElementById("legend");
Object.entries(seen).forEach(([ext, color]) => {
  legend.innerHTML += \`<div class="row"><div class="dot" style="background:\${color}"></div>.\${ext}</div>\`;
});
</script>
</body>
</html>`;
  }

  public dispose() {
    BrainTreePanel.currentPanel = undefined;
    this._panel.dispose();
    this._disposables.forEach((d) => d.dispose());
  }
}
