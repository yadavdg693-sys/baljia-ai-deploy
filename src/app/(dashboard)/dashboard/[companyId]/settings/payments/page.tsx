import { redirect } from 'next/navigation';
import { getSessionFromCookies } from '@/lib/auth';
import { db, companies } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import { isValidUUID } from '@/lib/uuid-validation';
import { listConnections } from '@/lib/services/payment-connection.service';
import { PaymentSettingsClient } from './PaymentSettingsClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ companyId: string }>;
}

export default async function PaymentSettingsPage({ params }: Props) {
  const { companyId } = await params;
  const user = await getSessionFromCookies();
  if (!user) redirect('/login');

  const companyLookup = isValidUUID(companyId)
    ? eq(companies.id, companyId)
    : eq(companies.slug, companyId);

  const [company] = await db
    .select({ id: companies.id, name: companies.name, slug: companies.slug })
    .from(companies)
    .where(and(companyLookup, eq(companies.owner_id, user.id)))
    .limit(1);

  if (!company) redirect('/portfolio');

  const connections = await listConnections(company.id);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <a
          href={`/dashboard/${company.slug ?? company.id}`}
          className="text-sm text-text-muted hover:text-text-primary"
        >
          ← Back to {company.name}
        </a>
        <h1 className="mt-3 text-2xl font-display font-semibold">Payments</h1>
        <p className="mt-2 text-sm text-text-muted">
          Connect your own Stripe or Razorpay account so your AI team can build payment flows
          into your app. Money flows directly from your customer to your bank — Baljia never
          touches your funds.
        </p>
      </header>

      <PaymentSettingsClient
        companyId={company.id}
        companySlug={company.slug ?? company.id}
        stripeOAuthEnabled={Boolean(process.env.STRIPE_CONNECT_CLIENT_ID)}
        initialConnections={connections.map((c) => ({
          id: c.id,
          provider: c.provider,
          mode: c.mode,
          auth_method: c.auth_method,
          status: c.status,
          account_id: c.account_id,
          display_name: c.display_name,
          publishable_key: c.publishable_key,
          last_validated_at: c.last_validated_at ? c.last_validated_at.toISOString() : null,
          connected_at: c.connected_at.toISOString(),
        }))}
      />
    </div>
  );
}
