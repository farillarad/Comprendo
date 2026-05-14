import * as vscode from "vscode";
import { BrainTreePanel } from "./treeView";
import { SidebarProvider } from "./sidebar";

export function activate(context: vscode.ExtensionContext) {
  const sidebarProvider = new SidebarProvider(context.extensionUri, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "comprendo.sidebarView",
      sidebarProvider
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("comprendo.openBrainTree", () => {
      const workspacePath = getWorkspacePath();
      if (!workspacePath) {
        vscode.window.showErrorMessage("Comprendo: No workspace folder open.");
        return;
      }
      BrainTreePanel.createOrShow(context.extensionUri, workspacePath, sidebarProvider);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("comprendo.startBackend", async () => {
      vscode.window.showInformationMessage(
        "Start the backend manually: cd backend && uvicorn main:app --reload"
      );
    })
  );

  // Check for API key on activation
  const config = vscode.workspace.getConfiguration("comprendo");
  const apiKey = config.get<string>("apiKey");
  if (!apiKey) {
    vscode.window
      .showWarningMessage(
        "Comprendo: No Claude API key set. Add it in Settings under comprendo.apiKey.",
        "Open Settings"
      )
      .then((choice) => {
        if (choice === "Open Settings") {
          vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "comprendo.apiKey"
          );
        }
      });
  }
}

export function deactivate() {}

export function getWorkspacePath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function getConfig() {
  return vscode.workspace.getConfiguration("comprendo");
}
