# Comprendo

A VS Code extension that helps developers understand their codebase using AI-powered explanations, quizzes, and dependency graphs.

## Features

| | Feature | How to use |
|---|---|---|
| 🔍 | **Explain This** | Select code → right-click → *Comprendo: Explain This* |
| 🧩 | **Quiz Me** | After an explanation appears, click **Quiz Me** to test your understanding |
| 🌳 | **Brain Tree** | Run *Comprendo: Open Brain Tree* from the Command Palette (`Ctrl+Shift+P`) |

## Setup

### 1. Install the extension

```bash
cd extension
npm install
npm run compile
```

Press `F5` in VS Code to launch the Extension Development Host.

### 2. Add your Claude API key

1. Open Settings (`Ctrl+,` / `Cmd+,`)
2. Search for `comprendo.apiKey`
3. Paste your Claude API key — get one at [console.anthropic.com](https://console.anthropic.com)

Or: when you first use any Comprendo feature without a key, a notification will appear with an **Open Settings** button.

### 3. Start using Comprendo

- **Explain code:** Select any code, right-click, choose **Comprendo: Explain This**. The Comprendo sidebar opens automatically.
- **Take a quiz:** After an explanation loads, click **Quiz Me** to answer 3 AI-generated questions about the code.
- **Explore dependencies:** Open the Command Palette (`Ctrl+Shift+P`) and run **Comprendo: Open Brain Tree** to see an interactive graph of how your files connect. Click any node to explain that file.

## Activity Bar

Click the Comprendo icon (node graph) in the left activity bar to open the sidebar at any time.

## Settings

| Setting | Description |
|---|---|
| `comprendo.apiKey` | Your Claude API key (required) |

## Supported Languages

Brain Tree parses imports from:
- TypeScript (`.ts`, `.tsx`)
- JavaScript (`.js`, `.jsx`)
- Python (`.py`)

## Project Structure

```
comprendo/
  extension/
    src/
      extension.ts    # Entry point and command handlers
      sidebar.ts      # Sidebar webview provider
      claudeClient.ts # Claude API wrapper
      explain.ts      # Code explanation logic
      quiz.ts         # Quiz generation, scoring, persistence
      brainTree.ts    # Dependency graph builder
    media/
      sidebar.html    # Sidebar UI
      brainTree.html  # Brain Tree D3.js visualization
      styles.css      # Sidebar styles
      comprendo.svg   # Activity bar icon
    package.json
    tsconfig.json
```
