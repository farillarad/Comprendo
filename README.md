# Comprendo

A VS Code extension that helps developers understand their codebase using AI.

## Features

- **Brain Tree** — interactive D3.js dependency graph showing how files connect
- **File Explanation** — click any node to get a plain-English breakdown of what the file does
- **Quiz Mode** — test your comprehension with AI-generated questions; scores saved per file

## Setup

### 1. Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

The backend runs at `http://localhost:8000` by default.

### 2. VS Code Extension

```bash
cd extension
npm install
npm run compile
```

Then press `F5` in VS Code to launch the extension in a new Extension Development Host window.

### 3. Add your Claude API key

1. Open VS Code Settings (`Cmd+,` / `Ctrl+,`)
2. Search for `comprendo.apiKey`
3. Paste your Claude API key (get one at [console.anthropic.com](https://console.anthropic.com))

## Usage

1. Make sure the backend is running
2. Open a workspace folder in VS Code
3. Run `Comprendo: Open Brain Tree` from the Command Palette (`Cmd+Shift+P`)
4. Click any file node — the **Comprendo** sidebar shows the explanation
5. Click **Quiz me** to test your understanding

## Settings

| Setting | Default | Description |
|---|---|---|
| `comprendo.apiKey` | _(empty)_ | Your Claude API key |
| `comprendo.backendUrl` | `http://localhost:8000` | URL of the FastAPI backend |

## Project Structure

```
comprendo/
  extension/          # TypeScript VS Code extension
    src/
      extension.ts    # Entry point, commands, settings
      treeView.ts     # Brain Tree D3.js webview
      sidebar.ts      # Explanation + quiz panel
    package.json
    tsconfig.json
  backend/            # Python FastAPI
    main.py           # App entry point
    routes/
      tree.py         # Dependency graph parsing
      explain.py      # File explanation via Claude
      quiz.py         # Quiz generation + scoring via Claude
    requirements.txt
```

## Supported Languages

The Brain Tree parses import/dependency statements from:
- Python (`.py`)
- TypeScript (`.ts`, `.tsx`)
- JavaScript (`.js`, `.jsx`, `.mjs`, `.cjs`)
