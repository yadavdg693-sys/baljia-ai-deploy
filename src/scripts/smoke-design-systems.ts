// Standalone smoke test for the design-systems handlers — bypasses
// dispatch/agent loop and calls the file readers directly.
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = '.claude/skills/design-systems';

async function listDesignSystems(): Promise<string> {
  return readFile(join(process.cwd(), ROOT, 'INDEX.md'), 'utf8');
}

async function getDesignSystem(name: string): Promise<string> {
  const raw = name.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]*$/.test(raw)) throw new Error(`bad name: ${name}`);
  const p = join(process.cwd(), ROOT, raw, 'DESIGN.md');
  const s = await stat(p).catch(() => null);
  if (!s) throw new Error(`not found: ${raw}`);
  return readFile(p, 'utf8');
}

(async () => {
  const idx = await listDesignSystems();
  console.log('INDEX size:', idx.length, 'bytes');
  console.log('INDEX has 149 systems:', idx.includes('149 design-language references'));
  console.log('---first category---');
  console.log(idx.split('\n').slice(0, 14).join('\n'));

  console.log('\n--- get_design_system("linear-app") ---');
  const linear = await getDesignSystem('linear-app');
  console.log('linear-app spec size:', linear.length, 'bytes');
  console.log('opens with:', linear.split('\n').slice(0, 3).join(' | '));

  console.log('\n--- get_design_system("stripe") ---');
  const stripe = await getDesignSystem('stripe');
  console.log('stripe spec size:', stripe.length, 'bytes');
  console.log('mentions sohne-var:', stripe.includes('sohne-var'));
  console.log('mentions weight 300:', stripe.includes('weight 300') || stripe.includes('Weight 300'));

  console.log('\n--- error path: bad name ---');
  try { await getDesignSystem('not-a-real-system'); console.log('FAIL: should have thrown'); }
  catch (e) { console.log('correctly errored:', (e as Error).message); }
})();
