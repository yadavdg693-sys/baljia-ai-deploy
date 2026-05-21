'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

type Provider = 'stripe' | 'razorpay';
type AuthMethod = 'paste_key' | 'oauth';

interface ConnectionView {
  id: string;
  provider: Provider;
  mode: 'test' | 'live';
  auth_method: AuthMethod;
  status: 'connected' | 'invalid' | 'revoked';
  account_id: string | null;
  display_name: string | null;
  publishable_key: string | null;
  last_validated_at: string | null;
  connected_at: string;
}

interface Props {
  companyId: string;
  companySlug: string;
  stripeOAuthEnabled: boolean;
  initialConnections: ConnectionView[];
}

const PROVIDER_LABELS: Record<Provider, string> = {
  stripe: 'Stripe',
  razorpay: 'Razorpay',
};

const PROVIDER_HINTS: Record<Provider, { secret: string; publishable?: string; help: string }> = {
  stripe: {
    secret: 'sk_test_... or sk_live_...',
    help: 'Find your secret key at dashboard.stripe.com → Developers → API keys. Test mode is fine to start. (For a one-click flow, use Connect with Stripe above.)',
  },
  razorpay: {
    secret: 'Key Secret (long random string)',
    publishable: 'rzp_test_... or rzp_live_... (Key ID)',
    help: 'Find both at dashboard.razorpay.com → Settings → API Keys. You need both the Key ID and Key Secret.',
  },
};

export function PaymentSettingsClient({ companyId, companySlug, stripeOAuthEnabled, initialConnections }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [connections, setConnections] = useState(initialConnections);
  const [activeForm, setActiveForm] = useState<Provider | null>(null);
  const [secretKey, setSecretKey] = useState('');
  const [publishableKey, setPublishableKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Surface OAuth callback results from the query string.
  useEffect(() => {
    const stripeError = searchParams?.get('stripe_error');
    const stripeConnected = searchParams?.get('stripe_connected');
    if (stripeError) setError(`Stripe: ${stripeError}`);
    if (stripeConnected) setFlash('Stripe connected via OAuth.');
    if (stripeError || stripeConnected) {
      // Clean the URL so refreshing doesn't re-show the message.
      const url = new URL(window.location.href);
      url.searchParams.delete('stripe_error');
      url.searchParams.delete('stripe_connected');
      window.history.replaceState({}, '', url.toString());
    }
  }, [searchParams]);

  const getConnection = (p: Provider) => connections.find((c) => c.provider === p);

  function resetForm() {
    setSecretKey('');
    setPublishableKey('');
    setWebhookSecret('');
    setError(null);
  }

  function handleConnect(provider: Provider) {
    setActiveForm(provider);
    resetForm();
  }

  function handleConnectWithStripeOAuth() {
    const returnTo = `/dashboard/${companySlug}/settings/payments`;
    const params = new URLSearchParams({ company_id: companyId, return_to: returnTo });
    window.location.href = `/api/oauth/stripe/authorize?${params.toString()}`;
  }

  function handleSave(provider: Provider) {
    setError(null);
    if (!secretKey.trim()) {
      setError('Secret key is required.');
      return;
    }
    if (provider === 'razorpay' && !publishableKey.trim()) {
      setError('Razorpay requires both Key ID and Key Secret.');
      return;
    }

    startTransition(async () => {
      const resp = await fetch('/api/payment-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          provider,
          secret_key: secretKey.trim(),
          publishable_key: publishableKey.trim() || undefined,
          webhook_secret: webhookSecret.trim() || undefined,
        }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError(body.error ?? 'Failed to save connection.');
        return;
      }
      const list = await fetch(`/api/payment-connections?company_id=${companyId}`).then((r) => r.json());
      setConnections(list.connections ?? []);
      setActiveForm(null);
      resetForm();
      setFlash(`${PROVIDER_LABELS[provider]} connected.`);
      router.refresh();
    });
  }

  function handleDisconnect(provider: Provider) {
    if (!confirm(`Disconnect ${PROVIDER_LABELS[provider]}? Your AI team won't be able to create new payment flows until you reconnect.`)) {
      return;
    }
    startTransition(async () => {
      const resp = await fetch(`/api/payment-connections?company_id=${companyId}&provider=${provider}`, {
        method: 'DELETE',
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError(body.error ?? 'Failed to disconnect.');
        return;
      }
      setConnections((prev) => prev.filter((c) => c.provider !== provider));
      setFlash(`${PROVIDER_LABELS[provider]} disconnected.`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {flash && (
        <div className="rounded-md border border-status-success/40 bg-status-success/10 px-4 py-2 text-sm text-status-success">
          {flash}
        </div>
      )}

      {(['stripe', 'razorpay'] as Provider[]).map((provider) => {
        const conn = getConnection(provider);
        const isFormOpen = activeForm === provider;
        const hints = PROVIDER_HINTS[provider];
        const showStripeOAuthButton = provider === 'stripe' && !conn && stripeOAuthEnabled;

        return (
          <section
            key={provider}
            className="rounded-xl border border-border-default bg-surface-card p-6"
          >
            <header className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-display font-semibold">{PROVIDER_LABELS[provider]}</h2>
                {conn ? (
                  <p className="mt-1 text-sm text-text-muted">
                    Connected via {conn.auth_method === 'oauth' ? 'OAuth' : 'API key'} ·{' '}
                    <span className={conn.mode === 'live' ? 'text-status-success' : 'text-baljia-gold'}>
                      {conn.mode} mode
                    </span>
                    {conn.account_id ? ` · ${conn.account_id}` : ''}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-text-muted">Not connected yet.</p>
                )}
              </div>

              {conn ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDisconnect(provider)}
                  disabled={isPending}
                >
                  Disconnect
                </Button>
              ) : null}
            </header>

            {conn?.display_name && (
              <p className="mt-2 text-sm text-text-secondary">Account: {conn.display_name}</p>
            )}

            {!conn && (
              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border-default pt-5">
                {showStripeOAuthButton && (
                  <Button variant="primary" size="md" onClick={handleConnectWithStripeOAuth}>
                    Connect with Stripe
                  </Button>
                )}
                {!isFormOpen && (
                  <Button
                    variant={showStripeOAuthButton ? 'secondary' : 'primary'}
                    size="md"
                    onClick={() => handleConnect(provider)}
                  >
                    {showStripeOAuthButton ? 'Or paste an API key' : `Paste ${PROVIDER_LABELS[provider]} API key`}
                  </Button>
                )}
                {provider === 'stripe' && !stripeOAuthEnabled && (
                  <p className="text-xs text-text-muted">
                    (Connect-with-Stripe OAuth not configured on this server — set <code>STRIPE_CONNECT_CLIENT_ID</code> to enable it.)
                  </p>
                )}
              </div>
            )}

            {isFormOpen && (
              <div className="mt-6 space-y-4 border-t border-border-default pt-6">
                <p className="text-xs text-text-muted">{hints.help}</p>

                {provider === 'razorpay' && (
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">
                      Key ID (publishable)
                    </label>
                    <Input
                      type="text"
                      placeholder={hints.publishable}
                      value={publishableKey}
                      onChange={(e) => setPublishableKey(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    {provider === 'razorpay' ? 'Key Secret' : 'Secret API Key'}
                  </label>
                  <Input
                    type="password"
                    placeholder={hints.secret}
                    value={secretKey}
                    onChange={(e) => setSecretKey(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    Webhook signing secret <span className="text-text-muted">(optional, can add later)</span>
                  </label>
                  <Input
                    type="password"
                    placeholder={provider === 'stripe' ? 'whsec_...' : 'webhook secret'}
                    value={webhookSecret}
                    onChange={(e) => setWebhookSecret(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>

                {error && (
                  <p className="text-sm text-status-error break-words">{error}</p>
                )}

                <div className="flex gap-3">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleSave(provider)}
                    isLoading={isPending}
                  >
                    Save & validate
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setActiveForm(null);
                      resetForm();
                    }}
                    disabled={isPending}
                  >
                    Cancel
                  </Button>
                </div>

                <p className="text-xs text-text-muted">
                  Your key is encrypted (AES-256-GCM) before being stored. We validate it against{' '}
                  {PROVIDER_LABELS[provider]} on save and reject invalid keys before they reach the database.
                </p>
              </div>
            )}
          </section>
        );
      })}

      {error && !activeForm && (
        <p className="text-sm text-status-error break-words">{error}</p>
      )}

      <section className="rounded-xl border border-border-default/50 bg-surface-card/50 p-6 text-sm text-text-muted">
        <h3 className="font-semibold text-text-primary mb-2">How it works</h3>
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>Connect your own Stripe (OAuth or paste-key) or Razorpay (paste-key) account.</li>
          <li>When you ask Baljia to add a payment flow, your AI engineer uses your account to create products, prices, and payment links — in <em>your</em> Stripe / Razorpay, not ours.</li>
          <li>Customers pay you directly. Money lands in your bank. Baljia never holds your funds.</li>
        </ol>
      </section>
    </div>
  );
}
