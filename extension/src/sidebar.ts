import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { getConfig, getWorkspacePath } from "./extension";

interface ExplainResponse {
  summary: string;
  connections: string;
  key_components: string;
}

interface Question {
  id: number;
  question: string;
}

interface ScoreEntry {
  score: number;
  attempts: number;
  lastUpdated: string;
}

type ScoreStore = Record<string, ScoreEntry>;

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _currentFilePath?: string;
  private _currentNodeId?: string;
  private _currentExplanation?: ExplainResponse;
  private _questions?: Question[];
  private _answers: Record<number, string> = {};
  private _scores: ScoreStore = {};

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {
    this._loadScores();
  }

  public resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._getWelcomeHtml();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case "startQuiz":
          await this._generateQuiz();
          break;
        case "submitAnswer":
          await this._scoreAnswer(message.questionId, message.answer);
          break;
      }
    });
  }

  public async showExplanation(filePath: string, nodeId: string) {
    if (!this._view) return;

    this._currentFilePath = filePath;
    this._currentNodeId = nodeId;
    this._currentExplanation = undefined;
    this._questions = undefined;
    this._answers = {};

    this._view.webview.html = this._getLoadingHtml(path.basename(filePath));

    const config = getConfig();
    const apiKey = config.get<string>("apiKey") || "";
    const backendUrl = config.get<string>("backendUrl") || "http://localhost:8000";
    const workspacePath = getWorkspacePath() || "";

    if (!apiKey) {
      this._view.webview.html = this._getNoKeyHtml();
      return;
    }

    let fileContent = "";
    try {
      fileContent = fs.readFileSync(filePath, "utf-8");
    } catch {
      this._view.webview.html = this._getErrorHtml("Could not read file.");
      return;
    }

    try {
      const response = await fetch(`${backendUrl}/explain`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify({
          file_path: filePath,
          workspace_path: workspacePath,
          file_content: fileContent,
        }),
      });

      if (!response.ok) {
        const err = await response.json() as { detail?: string };
        throw new Error(err.detail || `HTTP ${response.status}`);
      }

      this._currentExplanation = await response.json() as ExplainResponse;
      const existing = this._scores[nodeId];
      this._view.webview.html = this._getExplanationHtml(
        path.basename(filePath),
        this._currentExplanation,
        existing
      );
    } catch (err: any) {
      this._view.webview.html = this._getErrorHtml(err.message);
    }
  }

  private async _generateQuiz() {
    if (!this._view || !this._currentFilePath || !this._currentExplanation) return;

    const config = getConfig();
    const apiKey = config.get<string>("apiKey") || "";
    const backendUrl = config.get<string>("backendUrl") || "http://localhost:8000";

    this._view.webview.html = this._getLoadingHtml("Generating quiz...");

    let fileContent = "";
    try {
      fileContent = fs.readFileSync(this._currentFilePath, "utf-8");
    } catch {}

    const explanationText = [
      this._currentExplanation.summary,
      this._currentExplanation.connections,
      this._currentExplanation.key_components,
    ].join("\n\n");

    try {
      const response = await fetch(`${backendUrl}/quiz/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify({
          file_path: this._currentFilePath,
          file_content: fileContent,
          explanation: explanationText,
        }),
      });

      if (!response.ok) {
        const err = await response.json() as { detail?: string };
        throw new Error(err.detail || `HTTP ${response.status}`);
      }

      const data = await response.json() as { questions: Question[] };
      this._questions = data.questions;
      this._answers = {};
      this._view.webview.html = this._getQuizHtml(
        path.basename(this._currentFilePath),
        this._questions
      );
    } catch (err: any) {
      this._view.webview.html = this._getErrorHtml(err.message);
    }
  }

  private async _scoreAnswer(questionId: number, answer: string) {
    if (!this._view || !this._currentFilePath || !this._questions) return;

    const config = getConfig();
    const apiKey = config.get<string>("apiKey") || "";
    const backendUrl = config.get<string>("backendUrl") || "http://localhost:8000";

    const question = this._questions.find((q) => q.id === questionId);
    if (!question) return;

    let fileContent = "";
    try {
      fileContent = fs.readFileSync(this._currentFilePath, "utf-8");
    } catch {}

    try {
      const response = await fetch(`${backendUrl}/quiz/score`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify({
          file_path: this._currentFilePath,
          question: question.question,
          answer,
          file_content: fileContent,
        }),
      });

      if (!response.ok) {
        const err = await response.json() as { detail?: string };
        throw new Error(err.detail || `HTTP ${response.status}`);
      }

      const result = await response.json() as { correct: boolean; score: number; feedback: string };
      this._answers[questionId] = answer;

      // Update cumulative score
      const nodeId = this._currentNodeId!;
      const existing = this._scores[nodeId] || { score: 0, attempts: 0, lastUpdated: "" };
      const totalAttempts = existing.attempts + 1;
      const avgScore = Math.round(
        (existing.score * existing.attempts + result.score) / totalAttempts
      );
      this._scores[nodeId] = {
        score: avgScore,
        attempts: totalAttempts,
        lastUpdated: new Date().toISOString(),
      };
      this._saveScores();

      this._view!.webview.postMessage({
        command: "answerResult",
        questionId,
        correct: result.correct,
        score: result.score,
        feedback: result.feedback,
        fileScore: avgScore,
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Comprendo: ${err.message}`);
    }
  }

  private _loadScores() {
    const workspacePath = getWorkspacePath();
    if (!workspacePath) return;
    const scorePath = path.join(workspacePath, ".comprendo_scores.json");
    try {
      const raw = fs.readFileSync(scorePath, "utf-8");
      this._scores = JSON.parse(raw);
    } catch {
      this._scores = {};
    }
  }

  private _saveScores() {
    const workspacePath = getWorkspacePath();
    if (!workspacePath) return;
    const scorePath = path.join(workspacePath, ".comprendo_scores.json");
    try {
      fs.writeFileSync(scorePath, JSON.stringify(this._scores, null, 2));
    } catch {}
  }

  private _getWelcomeHtml(): string {
    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: 'Segoe UI', sans-serif; padding: 20px; color: var(--vscode-foreground);
         background: var(--vscode-sideBar-background); }
  h2 { color: #4fc3f7; margin-bottom: 12px; font-size: 16px; }
  p { font-size: 12px; line-height: 1.6; color: var(--vscode-descriptionForeground); }
  .step { margin: 10px 0; font-size: 12px; }
  .step span { color: #4fc3f7; font-weight: bold; }
</style></head>
<body>
  <h2>Comprendo</h2>
  <p>Click a file node in the Brain Tree to see its explanation here.</p>
  <div class="step"><span>1.</span> Open the Brain Tree: <code>Cmd+Shift+P</code> → <em>Comprendo: Open Brain Tree</em></div>
  <div class="step"><span>2.</span> Click any file node</div>
  <div class="step"><span>3.</span> Read the explanation, then quiz yourself</div>
</body>
</html>`;
  }

  private _getLoadingHtml(label: string): string {
    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: 'Segoe UI', sans-serif; padding: 20px;
         color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
  .label { font-size: 12px; color: #4fc3f7; margin-bottom: 12px; }
  .bar { height: 3px; background: #333; border-radius: 2px; overflow: hidden; }
  .fill { height: 100%; background: #4fc3f7; border-radius: 2px;
          animation: slide 1.2s ease-in-out infinite; width: 40%; }
  @keyframes slide { 0%{transform:translateX(-100%)} 100%{transform:translateX(350%)} }
</style></head>
<body>
  <div class="label">${label}</div>
  <div class="bar"><div class="fill"></div></div>
</body>
</html>`;
  }

  private _getNoKeyHtml(): string {
    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: 'Segoe UI', sans-serif; padding: 20px;
         color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
  .warn { color: #ffcc00; font-size: 13px; }
  p { font-size: 12px; color: var(--vscode-descriptionForeground); line-height: 1.6; }
</style></head>
<body>
  <p class="warn">No API key configured.</p>
  <p>Go to <strong>Settings → comprendo.apiKey</strong> and paste your Claude API key.</p>
</body>
</html>`;
  }

  private _getErrorHtml(message: string): string {
    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: 'Segoe UI', sans-serif; padding: 20px;
         color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
  .err { color: #f48771; font-size: 13px; margin-bottom: 8px; }
  p { font-size: 12px; color: var(--vscode-descriptionForeground); }
</style></head>
<body>
  <div class="err">Error</div>
  <p>${message}</p>
</body>
</html>`;
  }

  private _getExplanationHtml(
    filename: string,
    exp: ExplainResponse,
    existing?: ScoreEntry
  ): string {
    const scoreHtml = existing
      ? `<div class="score-badge">Comprehension score: <strong>${existing.score}%</strong> (${existing.attempts} attempt${existing.attempts !== 1 ? "s" : ""})</div>`
      : "";

    const keyComponents = exp.key_components
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        const clean = l.replace(/^[-•]\s*/, "");
        const colonIdx = clean.indexOf(":");
        if (colonIdx > -1) {
          return `<li><strong>${clean.slice(0, colonIdx)}</strong>${clean.slice(colonIdx)}</li>`;
        }
        return `<li>${clean}</li>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: 'Segoe UI', sans-serif; padding: 16px;
         color: var(--vscode-foreground); background: var(--vscode-sideBar-background);
         font-size: 12px; line-height: 1.6; }
  h1 { font-size: 14px; color: #4fc3f7; margin: 0 0 4px; word-break: break-all; }
  .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px;
                   color: #888; margin: 14px 0 4px; }
  .content { background: var(--vscode-editor-background); border-radius: 6px;
             padding: 10px 12px; color: var(--vscode-editor-foreground); }
  ul { margin: 0; padding-left: 16px; }
  li { margin: 3px 0; }
  .score-badge { background: #1a3a1a; color: #81c784; border-radius: 4px;
                 padding: 4px 10px; font-size: 11px; margin-bottom: 12px; display: inline-block; }
  button { width: 100%; margin-top: 16px; padding: 8px; background: #4fc3f7;
           color: #000; border: none; border-radius: 6px; cursor: pointer;
           font-size: 13px; font-weight: 600; }
  button:hover { background: #81d4fa; }
</style></head>
<body>
  <h1>${filename}</h1>
  ${scoreHtml}

  <div class="section-title">What it does</div>
  <div class="content">${exp.summary}</div>

  <div class="section-title">Connections</div>
  <div class="content">${exp.connections}</div>

  <div class="section-title">Key components</div>
  <div class="content"><ul>${keyComponents}</ul></div>

  <button onclick="startQuiz()">Quiz me</button>

  <script>
    const vscode = acquireVsCodeApi();
    function startQuiz() { vscode.postMessage({ command: 'startQuiz' }); }
  </script>
</body>
</html>`;
  }

  private _getQuizHtml(filename: string, questions: Question[]): string {
    const questionsHtml = questions
      .map(
        (q) => `
      <div class="question" id="q${q.id}">
        <div class="q-label">Q${q.id}</div>
        <div class="q-text">${q.question}</div>
        <textarea id="answer-${q.id}" placeholder="Type your answer..."></textarea>
        <button onclick="submit(${q.id})">Submit</button>
        <div class="feedback" id="feedback-${q.id}"></div>
      </div>`
      )
      .join("");

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: 'Segoe UI', sans-serif; padding: 16px;
         color: var(--vscode-foreground); background: var(--vscode-sideBar-background);
         font-size: 12px; line-height: 1.6; }
  h1 { font-size: 14px; color: #4fc3f7; margin: 0 0 12px; }
  .question { margin-bottom: 18px; }
  .q-label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.8px; }
  .q-text { margin: 4px 0 6px; color: var(--vscode-editor-foreground); }
  textarea { width: 100%; height: 70px; background: var(--vscode-input-background);
             color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
             border-radius: 4px; padding: 6px; font-size: 12px; resize: vertical;
             font-family: inherit; }
  button { padding: 5px 12px; background: #4fc3f7; color: #000; border: none;
           border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;
           margin-top: 4px; }
  button:hover { background: #81d4fa; }
  button:disabled { opacity: 0.4; cursor: default; }
  .feedback { margin-top: 8px; padding: 8px 10px; border-radius: 4px; font-size: 12px;
              display: none; }
  .feedback.correct { background: #1a3a1a; color: #81c784; border-left: 3px solid #81c784; }
  .feedback.wrong { background: #3a1a1a; color: #f48771; border-left: 3px solid #f48771; }
  .score-line { font-size: 11px; color: #888; margin-top: 2px; }
  #overall { margin-top: 16px; padding: 10px; background: var(--vscode-editor-background);
             border-radius: 6px; font-size: 12px; display: none; }
</style></head>
<body>
  <h1>Quiz — ${filename}</h1>
  ${questionsHtml}
  <div id="overall"></div>

  <script>
    const vscode = acquireVsCodeApi();
    let answered = {};

    function submit(id) {
      const val = document.getElementById('answer-' + id).value.trim();
      if (!val) return;
      const btn = document.querySelector('#q' + id + ' button');
      btn.disabled = true;
      vscode.postMessage({ command: 'submitAnswer', questionId: id, answer: val });
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.command === 'answerResult') {
        const fb = document.getElementById('feedback-' + msg.questionId);
        fb.style.display = 'block';
        fb.className = 'feedback ' + (msg.correct ? 'correct' : 'wrong');
        fb.innerHTML = (msg.correct ? '✓ Correct' : '✗ Incorrect') +
          ' (' + msg.score + '/100)<br>' + msg.feedback;
        answered[msg.questionId] = msg.score;

        if (Object.keys(answered).length === ${questions.length}) {
          const avg = Math.round(Object.values(answered).reduce((a, b) => a + b, 0) / ${questions.length});
          const el = document.getElementById('overall');
          el.style.display = 'block';
          el.innerHTML = '<strong>Quiz complete!</strong> Average score: ' + avg +
            '/100<br><span style="color:#888;font-size:11px">File comprehension score updated to ' + msg.fileScore + '%</span>';
        }
      }
    });
  </script>
</body>
</html>`;
  }
}
