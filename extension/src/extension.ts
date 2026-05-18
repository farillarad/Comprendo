import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SidebarProvider } from './sidebar';
import { explainCode } from './explain';
import { generateQuestions, scoreAnswer, saveScore } from './quiz';
import { buildGraph } from './brainTree';
import { getApiKey } from './claudeClient';

interface QuizState {
  code: string;
  explanation: string;
  fileName: string;
  questions: string[];
  questionIdx: number;
  correctCount: number;
}

const quizState: QuizState = {
  code: '',
  explanation: '',
  fileName: '',
  questions: [],
  questionIdx: 0,
  correctCount: 0,
};

export function activate(context: vscode.ExtensionContext): void {
  const sidebar = new SidebarProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebar)
  );

  sidebar.onMessage(async (msg: unknown) => {
    const m = msg as Record<string, unknown>;
    if (m.type === 'quizMe') {
      await startQuiz(sidebar);
    } else if (m.type === 'submitAnswer') {
      await handleAnswer(sidebar, m.answer as string);
    } else if (m.type === 'openSettings') {
      vscode.commands.executeCommand('workbench.action.openSettings', 'comprendo.apiKey');
    } else if (m.type === 'openBrainTree') {
      await openBrainTree(context, sidebar);
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('comprendo.explainThis', () =>
      runExplain(sidebar)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('comprendo.openBrainTree', () =>
      openBrainTree(context, sidebar)
    )
  );

  // Prompt for API key on first activation
  if (!getApiKey()) {
    vscode.window
      .showWarningMessage(
        'Comprendo: Add your Claude API key to get started.',
        'Open Settings'
      )
      .then(choice => {
        if (choice === 'Open Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'comprendo.apiKey');
        }
      });
  }
}

function requireApiKey(sidebar?: SidebarProvider): boolean {
  if (getApiKey()) return true;
  vscode.window
    .showErrorMessage('Comprendo: No API key set.', 'Open Settings')
    .then(choice => {
      if (choice === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'comprendo.apiKey');
      }
    });
  sidebar?.send({ type: 'apiKeyError' });
  return false;
}

async function runExplain(sidebar: SidebarProvider): Promise<void> {
  if (!requireApiKey(sidebar)) return;

  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    vscode.window.showErrorMessage('Comprendo: Select some code first.');
    return;
  }

  const code = editor.document.getText(editor.selection);
  const fileContent = editor.document.getText();
  const fileName = path.basename(editor.document.fileName);

  Object.assign(quizState, {
    code, explanation: '', fileName,
    questions: [], questionIdx: 0, correctCount: 0,
  });

  await vscode.commands.executeCommand('comprendo.sidebarView.focus');
  sidebar.send({ type: 'loading', message: 'Generating explanation…' });

  try {
    const explanation = await explainCode(code, fileContent, fileName);
    quizState.explanation = explanation;
    sidebar.send({ type: 'explanation', content: explanation, code, fileName });
  } catch (e: unknown) {
    sidebar.send({ type: 'error', message: errorMessage(e) });
  }
}

async function startQuiz(sidebar: SidebarProvider): Promise<void> {
  if (!requireApiKey(sidebar)) return;
  if (!quizState.explanation) {
    sidebar.send({ type: 'error', message: 'Explain some code first before starting a quiz.' });
    return;
  }

  sidebar.send({ type: 'loading', message: 'Generating quiz questions…' });

  try {
    const questions = await generateQuestions(quizState.explanation, quizState.code);
    quizState.questions = questions;
    quizState.questionIdx = 0;
    quizState.correctCount = 0;
    sidebar.send({ type: 'questions', questions });
  } catch (e: unknown) {
    sidebar.send({ type: 'error', message: errorMessage(e) });
  }
}

async function handleAnswer(sidebar: SidebarProvider, answer: string): Promise<void> {
  if (!requireApiKey(sidebar)) return;

  const { questions, questionIdx, code } = quizState;
  if (questionIdx >= questions.length) return;

  sidebar.send({ type: 'loading', message: 'Scoring your answer…' });

  try {
    const result = await scoreAnswer(questions[questionIdx], answer, code);
    if (result.correct) quizState.correctCount++;

    const isLast = questionIdx === questions.length - 1;
    sidebar.send({ type: 'answerResult', correct: result.correct, feedback: result.feedback, isLast });
    quizState.questionIdx++;

    if (isLast) {
      const folders = vscode.workspace.workspaceFolders;
      if (folders?.length) {
        saveScore(folders[0].uri.fsPath, quizState.fileName, quizState.correctCount, questions.length);
      }
      sidebar.send({ type: 'quizDone', correct: quizState.correctCount, total: questions.length });
    }
  } catch (e: unknown) {
    sidebar.send({ type: 'error', message: errorMessage(e) });
  }
}

async function openBrainTree(
  context: vscode.ExtensionContext,
  sidebar: SidebarProvider
): Promise<void> {
  if (!requireApiKey()) return;

  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    vscode.window.showErrorMessage('Comprendo: Open a workspace folder first.');
    return;
  }
  const root = folders[0].uri.fsPath;

  const panel = vscode.window.createWebviewPanel(
    'comprendoBrainTree',
    'Comprendo: Brain Tree',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const htmlPath = path.join(context.extensionUri.fsPath, 'media', 'brainTree.html');
  panel.webview.html = fs.readFileSync(htmlPath, 'utf8');

  try {
    const graph = buildGraph(root);
    panel.webview.postMessage({ type: 'graphData', data: graph });
  } catch (e: unknown) {
    panel.webview.postMessage({ type: 'error', message: errorMessage(e) });
  }

  panel.webview.onDidReceiveMessage(async (msg: Record<string, unknown>) => {
    if (msg.type !== 'nodeClick') return;
    if (!requireApiKey(sidebar)) return;

    const filePath = msg.fullPath as string;
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      sidebar.send({ type: 'error', message: `Cannot read ${filePath}` });
      return;
    }

    const fileName = path.basename(filePath);
    Object.assign(quizState, {
      code: content, explanation: '', fileName,
      questions: [], questionIdx: 0, correctCount: 0,
    });

    await vscode.commands.executeCommand('comprendo.sidebarView.focus');
    sidebar.send({ type: 'loading', message: `Explaining ${fileName}…` });

    try {
      const explanation = await explainCode(content, content, fileName);
      quizState.explanation = explanation;
      sidebar.send({ type: 'explanation', content: explanation, code: content, fileName });
    } catch (e: unknown) {
      sidebar.send({ type: 'error', message: errorMessage(e) });
    }
  });
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    if (e.message === 'API_KEY_NOT_SET') {
      return 'No API key set. Open Settings and add your key under comprendo.apiKey.';
    }
    return e.message;
  }
  return String(e);
}

export function deactivate(): void {}
