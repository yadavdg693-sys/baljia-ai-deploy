import { describe, expect, it } from 'vitest';
import { scanFiles, summarizeFindings } from './static-code-scan';

describe('static code scan runtime wrapper rules', () => {
  it('flags raw provider SDK imports in generated app feature code', () => {
    const findings = scanFiles([
      {
        path: 'app/actions/tailor-resume.ts',
        content: [
          'import OpenAI from "openai";',
          'export async function tailor() {',
          '  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });',
          '}',
        ].join('\n'),
      },
    ]);

    expect(summarizeFindings(findings)).toContain('raw-ai-sdk-import');
    expect(findings.some((finding) => finding.severity === 'high')).toBe(true);
  });
});
