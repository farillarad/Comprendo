import { callClaude } from './claudeClient';

export async function explainCode(
  code: string,
  fileContent: string,
  fileName: string
): Promise<string> {
  return callClaude(
    `You are a code explanation assistant helping developers understand codebases.\n\n` +
    `File: ${fileName}\n\n` +
    `Full file contents:\n\`\`\`\n${fileContent}\n\`\`\`\n\n` +
    `Code to explain:\n\`\`\`\n${code}\n\`\`\`\n\n` +
    `Explain what this code does in plain English. Describe its purpose, how it works, ` +
    `and how it connects to the rest of the file. Be concise and developer-friendly.`
  );
}
