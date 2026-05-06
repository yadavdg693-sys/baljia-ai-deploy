// Apply provider_packs migration and seed 8 starter recipes.
// Run: npx tsx --env-file=.env.local src/scripts/seed-provider-packs.ts
//
// Idempotent — uses ON CONFLICT (provider_id) DO UPDATE.

import { db, providerPacks } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { join } from 'path';

interface PackSeed {
  provider_id: string;
  display_name: string;
  category: string;
  signup_url: string;
  api_key_url: string | null;
  steps: Array<{ kind: string; instruction: string; selector?: string; expected?: string }>;
  api_key_env_var: string | null;
  notes: string | null;
}

const PACKS: PackSeed[] = [
  {
    provider_id: 'openai',
    display_name: 'OpenAI',
    category: 'llm',
    signup_url: 'https://platform.openai.com/signup',
    api_key_url: 'https://platform.openai.com/api-keys',
    api_key_env_var: 'OPENAI_API_KEY',
    steps: [
      { kind: 'navigate', instruction: 'Go to https://platform.openai.com/signup' },
      { kind: 'fill', instruction: 'Enter the company email address', selector: 'input[type=email]' },
      { kind: 'click', instruction: 'Click Continue / Sign up' },
      { kind: 'fill', instruction: 'Set a strong password (use generate_password)', selector: 'input[type=password]' },
      { kind: 'verify_email', instruction: 'Wait for verification email, click confirmation link' },
      { kind: 'navigate', instruction: 'Go to https://platform.openai.com/api-keys' },
      { kind: 'click', instruction: 'Click "Create new secret key"' },
      { kind: 'fill', instruction: 'Name the key, e.g., "baljia-{company-slug}"' },
      { kind: 'click', instruction: 'Click Create' },
      { kind: 'capture', instruction: 'Copy the secret key (sk-...) — visible ONCE only', expected: 'starts with sk-' },
      { kind: 'save', instruction: 'Save key as OPENAI_API_KEY via record_provider_secret' },
    ],
    notes: 'Phone verification required for new accounts. Free tier provides $5 trial credit. Org-level billing must be set up before API key works for paid models.',
  },
  {
    provider_id: 'anthropic',
    display_name: 'Anthropic',
    category: 'llm',
    signup_url: 'https://console.anthropic.com/login',
    api_key_url: 'https://console.anthropic.com/settings/keys',
    api_key_env_var: 'ANTHROPIC_API_KEY',
    steps: [
      { kind: 'navigate', instruction: 'Go to https://console.anthropic.com/login' },
      { kind: 'click', instruction: 'Click "Continue with email"' },
      { kind: 'fill', instruction: 'Enter the company email address', selector: 'input[type=email]' },
      { kind: 'verify_email', instruction: 'Wait for magic link email, click it' },
      { kind: 'navigate', instruction: 'Go to https://console.anthropic.com/settings/keys' },
      { kind: 'click', instruction: 'Click "Create Key"' },
      { kind: 'fill', instruction: 'Name the key' },
      { kind: 'capture', instruction: 'Copy the key (sk-ant-...)', expected: 'starts with sk-ant-' },
      { kind: 'save', instruction: 'Save key as ANTHROPIC_API_KEY' },
    ],
    notes: 'Magic-link auth only — no password. Phone verification + workspace setup required before keys can be created. Pay-as-you-go billing.',
  },
  {
    provider_id: 'stripe',
    display_name: 'Stripe',
    category: 'payments',
    signup_url: 'https://dashboard.stripe.com/register',
    api_key_url: 'https://dashboard.stripe.com/apikeys',
    api_key_env_var: 'STRIPE_SECRET_KEY',
    steps: [
      { kind: 'navigate', instruction: 'Go to https://dashboard.stripe.com/register' },
      { kind: 'fill', instruction: 'Enter email + name + password', selector: 'input[name=email]' },
      { kind: 'click', instruction: 'Click "Create your Stripe account"' },
      { kind: 'verify_email', instruction: 'Click email confirmation link' },
      { kind: 'navigate', instruction: 'Go to https://dashboard.stripe.com/apikeys (test mode)' },
      { kind: 'click', instruction: 'Reveal "Secret key" for test mode' },
      { kind: 'capture', instruction: 'Copy publishable key (pk_test_...) and secret key (sk_test_...)', expected: 'pk_test_ and sk_test_' },
      { kind: 'save', instruction: 'Save sk_test_ as STRIPE_SECRET_KEY, pk_test_ as STRIPE_PUBLISHABLE_KEY' },
    ],
    notes: 'Test mode keys work immediately. Live mode requires business verification (KYC) — manual checkpoint, do NOT attempt KYC autonomously.',
  },
  {
    provider_id: 'render',
    display_name: 'Render',
    category: 'hosting',
    signup_url: 'https://dashboard.render.com/register',
    api_key_url: 'https://dashboard.render.com/u/settings#api-keys',
    api_key_env_var: 'RENDER_API_KEY',
    steps: [
      { kind: 'navigate', instruction: 'Go to https://dashboard.render.com/register' },
      { kind: 'click', instruction: 'Click "Sign up with GitHub" if a GitHub account is linked, otherwise email signup' },
      { kind: 'fill', instruction: 'Email + password if email path' },
      { kind: 'verify_email', instruction: 'Click confirmation link from email' },
      { kind: 'navigate', instruction: 'Go to https://dashboard.render.com/u/settings#api-keys' },
      { kind: 'click', instruction: 'Click "Create API Key"' },
      { kind: 'fill', instruction: 'Name the key, e.g., "baljia"' },
      { kind: 'capture', instruction: 'Copy the API key (rnd_...)', expected: 'starts with rnd_' },
      { kind: 'save', instruction: 'Save key as RENDER_API_KEY' },
    ],
    notes: 'GitHub-linked signup is faster but requires a GitHub account. Free tier exists. Credit card required to provision web services beyond the free static site limit.',
  },
  {
    provider_id: 'github',
    display_name: 'GitHub',
    category: 'devtools',
    signup_url: 'https://github.com/signup',
    api_key_url: 'https://github.com/settings/tokens?type=beta',
    api_key_env_var: 'GITHUB_TOKEN',
    steps: [
      { kind: 'navigate', instruction: 'Go to https://github.com/signup' },
      { kind: 'fill', instruction: 'Email, password, username (use the founder slug)' },
      { kind: 'verify_email', instruction: 'Wait for "Verify your email address" email, click link' },
      { kind: 'manual', instruction: 'GitHub may require puzzle/captcha. If detected, abort and surface to founder.' },
      { kind: 'navigate', instruction: 'Go to https://github.com/settings/tokens?type=beta (fine-grained tokens)' },
      { kind: 'click', instruction: 'Click "Generate new token"' },
      { kind: 'fill', instruction: 'Name + expiration (90 days) + repo access (All repositories)' },
      { kind: 'click', instruction: 'Set permissions: Contents Read+Write, Metadata Read, Pull Requests Read+Write, Workflows Read+Write' },
      { kind: 'click', instruction: 'Click "Generate token"' },
      { kind: 'capture', instruction: 'Copy the token (github_pat_...)', expected: 'starts with github_pat_' },
      { kind: 'save', instruction: 'Save as GITHUB_TOKEN' },
    ],
    notes: 'GitHub frequently shows visual puzzle/CAPTCHA on signup — escalate to founder rather than try to bypass. Fine-grained tokens preferred over classic PATs.',
  },
  {
    provider_id: 'postmark',
    display_name: 'Postmark',
    category: 'email',
    signup_url: 'https://account.postmarkapp.com/sign_up',
    api_key_url: 'https://account.postmarkapp.com/servers',
    api_key_env_var: 'POSTMARK_SERVER_TOKEN',
    steps: [
      { kind: 'navigate', instruction: 'Go to https://account.postmarkapp.com/sign_up' },
      { kind: 'fill', instruction: 'Email + password' },
      { kind: 'verify_email', instruction: 'Click confirmation link from email' },
      { kind: 'navigate', instruction: 'In dashboard, click into the default Server (or create one)' },
      { kind: 'click', instruction: 'Click "API Tokens" tab' },
      { kind: 'capture', instruction: 'Copy the Server API Token (UUID format)', expected: 'UUID with dashes' },
      { kind: 'save', instruction: 'Save as POSTMARK_SERVER_TOKEN' },
      { kind: 'manual', instruction: 'To send mail, the sender domain must be verified — DKIM + Return-Path DNS records on Cloudflare. Document this in domain skills.' },
    ],
    notes: 'Postmark login is email + password only — no Google OAuth. Domain verification (DKIM/Return-Path) is needed before you can actually send. ~$15/mo for 10K emails.',
  },
  {
    provider_id: 'sentry',
    display_name: 'Sentry',
    category: 'observability',
    signup_url: 'https://sentry.io/signup/',
    api_key_url: 'https://sentry.io/settings/account/api/auth-tokens/',
    api_key_env_var: 'SENTRY_AUTH_TOKEN',
    steps: [
      { kind: 'navigate', instruction: 'Go to https://sentry.io/signup/' },
      { kind: 'fill', instruction: 'Email + password + organization name' },
      { kind: 'verify_email', instruction: 'Click confirmation link' },
      { kind: 'click', instruction: 'Skip the "create your first project" wizard if shown' },
      { kind: 'navigate', instruction: 'Go to https://sentry.io/settings/account/api/auth-tokens/' },
      { kind: 'click', instruction: 'Click "Create New Token"' },
      { kind: 'fill', instruction: 'Name + scopes: project:read, project:write, event:read, org:read' },
      { kind: 'capture', instruction: 'Copy the auth token', expected: 'long alphanumeric' },
      { kind: 'save', instruction: 'Save as SENTRY_AUTH_TOKEN' },
    ],
    notes: 'For per-project DSNs, see https://sentry.io/settings/<org>/projects/<project>/keys/. Free tier: 5K errors/month.',
  },
  {
    provider_id: 'cloudflare-r2',
    display_name: 'Cloudflare R2',
    category: 'storage',
    signup_url: 'https://dash.cloudflare.com/sign-up',
    api_key_url: 'https://dash.cloudflare.com/profile/api-tokens',
    api_key_env_var: 'R2_ACCESS_KEY_ID',
    steps: [
      { kind: 'navigate', instruction: 'Go to https://dash.cloudflare.com/sign-up' },
      { kind: 'fill', instruction: 'Email + password' },
      { kind: 'verify_email', instruction: 'Click confirmation link' },
      { kind: 'navigate', instruction: 'Go to R2 in left nav, accept terms' },
      { kind: 'manual', instruction: 'R2 requires payment method on file even for free tier — surface to founder' },
      { kind: 'click', instruction: 'Click "Manage R2 API Tokens"' },
      { kind: 'click', instruction: 'Click "Create API Token"' },
      { kind: 'fill', instruction: 'Token name + permissions (Object Read & Write) + bucket scope' },
      { kind: 'capture', instruction: 'Copy Access Key ID + Secret Access Key + endpoint URL', expected: '3 values' },
      { kind: 'save', instruction: 'Save as R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT' },
    ],
    notes: 'R2 free tier: 10 GB storage + 1M Class A operations/month. Account ID is also needed (visible in right sidebar of dashboard).',
  },
];

(async () => {
  // Apply migration
  console.log('Applying migration 0003...');
  const migration = readFileSync(join(process.cwd(), 'drizzle/0003_unique_jack_power.sql'), 'utf8');
  for (const stmt of migration.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) {
    try {
      await db.execute(sql.raw(stmt));
      console.log('  applied:', stmt.substring(0, 60) + '...');
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('already exists')) {
        console.log('  skipped (exists):', stmt.substring(0, 60) + '...');
      } else {
        throw e;
      }
    }
  }

  // Seed
  console.log('\nSeeding', PACKS.length, 'provider packs...');
  for (const pack of PACKS) {
    await db.insert(providerPacks).values({
      provider_id: pack.provider_id,
      display_name: pack.display_name,
      category: pack.category,
      signup_url: pack.signup_url,
      api_key_url: pack.api_key_url,
      api_key_env_var: pack.api_key_env_var,
      steps: pack.steps,
      notes: pack.notes,
    }).onConflictDoUpdate({
      target: providerPacks.provider_id,
      set: {
        display_name: pack.display_name,
        category: pack.category,
        signup_url: pack.signup_url,
        api_key_url: pack.api_key_url,
        api_key_env_var: pack.api_key_env_var,
        steps: pack.steps,
        notes: pack.notes,
        updated_at: new Date(),
      },
    });
    console.log('  seeded:', pack.provider_id);
  }
  console.log('\nDone — 8 packs seeded.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
