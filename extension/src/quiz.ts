import { callClaude } from './claudeClient';
import * as path from 'path';
import * as fs from 'fs';

export async function generateQuestions(
  explanation: string,
  code: string
): Promise<string[]> {
  const raw = await callClaude(
    `Based on this code and explanation, generate exactly 3 comprehension questions ` +
    `to test a developer's understanding.\n\n` +
    `Explanation:\n${explanation}\n\n` +
    `Code:\n\`\`\`\n${code}\n\`\`\`\n\n` +
    `Respond with ONLY a JSON array of 3 question strings. No other text.\n` +
    `Example: ["What does X do?", "Why is Y used here?", "What would happen if Z?"]`
  );

  const match = raw.match(/\[[\s\S]*?\]/);
  if (!match) {
    throw new Error('Could not parse questions from Claude response');
  }
  const questions: unknown = JSON.parse(match[0]);
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('Invalid questions format');
  }
  return (questions as string[]).slice(0, 3);
}

export async function scoreAnswer(
  question: string,
  answer: string,
  code: string
): Promise<{ correct: boolean; feedback: string }> {
  const raw = await callClaude(
    `Grade this student's answer about the following code.\n\n` +
    `Code:\n\`\`\`\n${code}\n\`\`\`\n\n` +
    `Question: ${question}\n` +
    `Student answer: ${answer}\n\n` +
    `Respond with ONLY a JSON object. No other text.\n` +
    `Example: {"correct": true, "feedback": "Good explanation of the callback pattern."}`
  );

  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) {
    throw new Error('Could not parse score from Claude response');
  }
  const result = JSON.parse(match[0]) as { correct: boolean; feedback: string };
  return { correct: !!result.correct, feedback: result.feedback ?? '' };
}

export function saveScore(
  workspaceRoot: string,
  fileName: string,
  correct: number,
  total: number
): void {
  const dir = path.join(workspaceRoot, '.comprendo');
  const file = path.join(dir, 'scores.json');

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let scores: Array<{ file: string; correct: number; total: number; timestamp: string }> = [];
  if (fs.existsSync(file)) {
    try {
      scores = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof scores;
    } catch { /* start fresh if corrupt */ }
  }

  scores.push({ file: fileName, correct, total, timestamp: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(scores, null, 2));
}
