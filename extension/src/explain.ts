import { callClaude } from './claudeClient';

export async function explainCode(
  code: string,
  fileContent: string,
  fileName: string
): Promise<string> {
  return callClaude(
    `You are a code explanation assistant. Return ONLY a raw JSON object — no markdown fences, no commentary.\n\n` +
    `File: ${fileName}\n\n` +
    `Full file contents:\n\`\`\`\n${fileContent}\n\`\`\`\n\n` +
    `Code to explain:\n\`\`\`\n${code}\n\`\`\`\n\n` +
    `Return exactly this JSON structure (each text field ≤ 150 words):\n` +
    `{\n` +
    `  "whatItDoes": "Plain-English description of what this code does.",\n` +
    `  "howItWorks": "How it works internally.",\n` +
    `  "keyElements": [\n` +
    `    { "name": "identifierName", "description": "What this variable or function does." }\n` +
    `  ],\n` +
    `  "projectConnections": "How this connects to the rest of the file or project.",\n` +
    `  "flowSteps": ["Step 1: ...", "Step 2: ..."],\n` +
    `  "quickSummary": "One sentence plain-English description."\n` +
    `}\n\n` +
    `Rules:\n` +
    `- keyElements: list 2–6 important functions and variables found in the code\n` +
    `- flowSteps: list 2–6 execution steps only if there is a clear sequence; omit the field entirely if there is no meaningful flow\n` +
    `- All text fields must be ≤ 150 words\n` +
    `- Return ONLY the raw JSON object`
  );
}
