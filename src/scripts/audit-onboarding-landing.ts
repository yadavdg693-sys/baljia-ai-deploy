import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LandingAuditFinding {
  code:
    | 'dead_hash_link'
    | 'emoji_in_heading_or_button'
    | 'forbidden_indigo_purple'
    | 'ai_trust_gradient'
    | 'rounded_left_border_card'
    | 'missing_h1'
    | 'missing_preview_artifact';
  message: string;
}

const FORBIDDEN_PURPLE = /#(?:6366f1|4f46e5|4338ca|3730a3|8b5cf6|7c3aed|a855f7|818cf8|f5f3ff|1e1b4b|e0e7ff)\b/i;
const AI_TRUST_GRADIENT = /bg-gradient-to-r\s+from-|linear-gradient\([^)]*(?:#6366f1|#4f46e5|#8b5cf6|indigo|purple)[^)]*(?:#06b6d4|#3b82f6|cyan|blue|pink)/i;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

export function auditOnboardingLandingHtml(html: string): LandingAuditFinding[] {
  const findings: LandingAuditFinding[] = [];

  if (/\bhref=["']#["']/i.test(html)) {
    findings.push({ code: 'dead_hash_link', message: 'Generated page contains a dead href="#".' });
  }

  const headingButtonText = [...html.matchAll(/<(h[1-6]|button)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => stripTags(match[2]))
    .join('\n');
  if (EMOJI_RE.test(headingButtonText)) {
    findings.push({ code: 'emoji_in_heading_or_button', message: 'Emoji found in heading or button text.' });
  }

  if (FORBIDDEN_PURPLE.test(html)) {
    findings.push({ code: 'forbidden_indigo_purple', message: 'Default indigo/purple accent color found.' });
  }

  if (AI_TRUST_GRADIENT.test(html)) {
    findings.push({ code: 'ai_trust_gradient', message: 'AI-default purple/blue trust gradient found.' });
  }

  if (hasRoundedLeftBorderCard(html)) {
    findings.push({ code: 'rounded_left_border_card', message: 'A selector combines border-left with border-radius.' });
  }

  if (!/<h1\b/i.test(html)) {
    findings.push({ code: 'missing_h1', message: 'Generated page is missing an h1.' });
  }

  if (!/data-preview-artifact=|class=["'][^"']*\bpreview-artifact\b/i.test(html)) {
    findings.push({ code: 'missing_preview_artifact', message: 'Generated page is missing the preview artifact marker.' });
  }

  return findings;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ');
}

function hasRoundedLeftBorderCard(html: string): boolean {
  const styleBlocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]);
  const css = styleBlocks.length ? styleBlocks.join('\n') : html;
  return [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)].some((match) => {
    const selector = match[1].trim();
    const body = match[2];
    return /\.(?:card|feature|tile|panel)\b/i.test(selector)
      && /\bborder-left\s*:/i.test(body)
      && /\bborder-radius\s*:/i.test(body);
  });
}

function htmlFilesFromTarget(target: string): string[] {
  if (!existsSync(target)) throw new Error(`Path not found: ${target}`);
  const stat = statSync(target);
  if (stat.isFile()) return [target];
  return readdirSync(target)
    .flatMap((name) => {
      const child = join(target, name);
      const childStat = statSync(child);
      if (childStat.isDirectory()) return htmlFilesFromTarget(child);
      return extname(name).toLowerCase() === '.html' ? [child] : [];
    });
}

function main(): void {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npx tsx src/scripts/audit-onboarding-landing.ts <html-file-or-directory>');
    process.exit(1);
  }

  let total = 0;
  for (const file of htmlFilesFromTarget(target)) {
    const html = readFileSync(file, 'utf8');
    const findings = auditOnboardingLandingHtml(html);
    if (findings.length === 0) {
      console.log(`PASS ${file}`);
      continue;
    }
    total += findings.length;
    console.log(`FAIL ${file}`);
    for (const finding of findings) {
      console.log(`  ${finding.code}: ${finding.message}`);
    }
  }

  if (total > 0) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
