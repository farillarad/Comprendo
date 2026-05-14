import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'comprendo.sidebarView';

  private _view?: vscode.WebviewView;
  private _msgHandler?: (msg: unknown) => void;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._buildHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(msg => this._msgHandler?.(msg));
  }

  onMessage(handler: (msg: unknown) => void): void {
    this._msgHandler = handler;
  }

  send(msg: unknown): void {
    this._view?.webview.postMessage(msg);
  }

  focus(): void {
    this._view?.show?.(true);
  }

  private _buildHtml(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'styles.css')
    );
    const htmlPath = path.join(this._extensionUri.fsPath, 'media', 'sidebar.html');
    return fs
      .readFileSync(htmlPath, 'utf8')
      .replace('{{stylesUri}}', cssUri.toString())
      .replace('{{cspSource}}', webview.cspSource);
  }
}
