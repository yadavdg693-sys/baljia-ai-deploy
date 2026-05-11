// Download the deployed landing HTML for the latest company from R2, strip
// LLM-residue artifacts (em/en-dashes, **bold**, *italic*, _italic_, `code`),
// and re-upload. Use after sanitization fixes that didn't get applied at
// generation time.
import { db, companies } from '@/lib/db';
import { desc } from 'drizzle-orm';
import { getLandingHtml, uploadLandingHtml } from '@/lib/services/cf-deploy.service';

function cleanHtml(html: string): string {
  let out = html;
  // Strip **bold** markers (keep content inside)
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, '$1');
  out = out.replace(/\*\*\s*([^*\n]+?)\s*\*\*/g, '$1');
  // Strip *italic* (word-boundary aware to avoid `1.5*x`)
  out = out.replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, '$1');
  // Strip _italic_
  out = out.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, '$1');
  // Strip ~~strike~~
  out = out.replace(/~~([^~\n]+?)~~/g, '$1');
  // Replace em-dash / en-dash globally with comma
  out = out.replace(/[ \t]*[—–][ \t]*/g, ', ');
  // Clean leftover "lead, detail" double-spaces from the prior replacements
  out = out.replace(/,\s+,\s+/g, ', ');
  return out;
}

void (async () => {
  const [c] = await db.select().from(companies).orderBy(desc(companies.created_at)).limit(1);
  if (!c) { console.log('no co'); process.exit(0); }
  if (!c.subdomain) { console.log('no subdomain on company'); process.exit(0); }
  console.log(`Company: ${c.company_name} (${c.id}) subdomain=${c.subdomain}`);

  const html = await getLandingHtml(c.subdomain);
  if (!html) {
    console.log(`No landing HTML found in R2 for subdomain ${c.subdomain}`);
    process.exit(0);
  }

  const cleaned = cleanHtml(html);
  if (cleaned === html) {
    console.log('No artifacts found in landing HTML — nothing to do.');
    process.exit(0);
  }

  const beforeDashes = (html.match(/—/g) ?? []).length;
  const beforeBolds = (html.match(/\*\*/g) ?? []).length;
  const afterDashes = (cleaned.match(/—/g) ?? []).length;
  const afterBolds = (cleaned.match(/\*\*/g) ?? []).length;
  console.log(`em-dashes: ${beforeDashes} → ${afterDashes}`);
  console.log(`** markers: ${beforeBolds} → ${afterBolds}`);

  const upload = await uploadLandingHtml({ subdomain: c.subdomain, html: cleaned });
  if (!upload) { console.log('upload failed'); process.exit(1); }
  console.log(`✓ Re-uploaded to ${upload.url} (${cleaned.length} bytes)`);
  process.exit(0);
})();
