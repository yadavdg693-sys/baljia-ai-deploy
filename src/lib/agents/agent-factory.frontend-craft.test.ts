// Filesystem + prompt-content assertions for the craft-frontend skill
// vendored from nexu-io/open-design (Apache 2.0) and inlined into the
// Engineering agent's system prompt.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../..');
const skillDir = resolve(repoRoot, '.claude/skills/craft-frontend');
const promptFile = resolve(repoRoot, 'src/lib/agents/agent-factory.ts');

const CRAFT_FILES = [
  'anti-ai-slop.md',
  'color.md',
  'typography.md',
  'state-coverage.md',
  'form-validation.md',
  'accessibility-baseline.md',
  'animation-discipline.md',
];

const TAILWIND_INDIGO_HEXES = [
  '#6366f1', '#4f46e5', '#4338ca', '#3730a3',
  '#8b5cf6', '#7c3aed', '#a855f7',
];

describe('craft-frontend skill — directory structure', () => {
  it('directory exists', () => {
    expect(existsSync(skillDir)).toBe(true);
  });

  it('README.md exists with Apache 2.0 attribution', () => {
    const path = resolve(skillDir, 'README.md');
    expect(existsSync(path)).toBe(true);
    const body = readFileSync(path, 'utf-8');
    expect(body).toMatch(/Apache License 2\.0/);
    expect(body).toMatch(/nexu-io\/open-design/);
  });

  it('SKILL.md exists and lists every craft file', () => {
    const path = resolve(skillDir, 'SKILL.md');
    expect(existsSync(path)).toBe(true);
    const body = readFileSync(path, 'utf-8');
    for (const f of CRAFT_FILES) {
      expect(body, `SKILL.md must list ${f}`).toContain(f);
    }
  });
});

describe('craft-frontend skill — vendored craft files', () => {
  for (const f of CRAFT_FILES) {
    it(`${f} exists with attribution header`, () => {
      const path = resolve(skillDir, f);
      expect(existsSync(path), `missing ${f}`).toBe(true);
      const body = readFileSync(path, 'utf-8');
      expect(body, `${f} missing upstream attribution`).toMatch(/nexu-io\/open-design/);
      expect(body, `${f} missing Apache 2.0 reference`).toMatch(/Apache License 2\.0/);
      expect(body, `${f} missing pinned commit`).toContain('2afb002a6285f92ec80e6cee97f867dc7a680a77');
    });
  }
});

describe('Engineering agent prompt — Frontend Quality Bar', () => {
  const promptSource = readFileSync(promptFile, 'utf-8');

  it('contains the Frontend Quality Bar section header', () => {
    expect(promptSource).toContain('Frontend Quality Bar');
  });

  it('lists craft-frontend in the skill matrix', () => {
    expect(promptSource).toContain('craft-frontend');
  });

  it('forbids every Tailwind-default indigo hex by name', () => {
    for (const hex of TAILWIND_INDIGO_HEXES) {
      expect(promptSource, `prompt should name forbidden hex ${hex}`).toContain(hex);
    }
  });

  it('forbids lorem ipsum filler copy', () => {
    expect(promptSource.toLowerCase()).toContain('lorem ipsum');
  });

  it('caps accent token usage at 2 per screen', () => {
    expect(promptSource).toMatch(/2 (visible )?(uses?|times?) per screen/i);
  });
});
