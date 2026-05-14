import Anthropic from '@anthropic-ai/sdk';
import * as vscode from 'vscode';

const MODEL = 'claude-sonnet-4-5-20250514';
const MAX_TOKENS = 2048;

export function getApiKey(): string {
  return vscode.workspace.getConfiguration('comprendo').get<string>('apiKey', '');
}

export async function callClaude(prompt: string): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('API_KEY_NOT_SET');
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = response.content[0];
  if (block.type !== 'text') {
    throw new Error('Unexpected response type from Claude');
  }
  return block.text;
}
