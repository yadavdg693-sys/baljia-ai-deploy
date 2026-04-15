'use client';

import { useState, useEffect } from 'react';
import { ExternalLink, AlertCircle } from 'lucide-react';

interface ConnectionsPanelProps {
  companyId: string;
}

interface PlatformConnection {
  platform: 'linkedin' | 'x' | 'reddit' | 'product_hunt';
  name: string;
  icon: string;
  connected: boolean;
  accountName?: string;
  accountUrl?: string;
  lastConnected?: string;
}

const PLATFORM_INFO = {
  linkedin: {
    icon: '🔗',
    description: 'Share company updates, thought leadership, and news',
    setup: 'Get API credentials from LinkedIn Developer Portal',
  },
  x: {
    icon: '𝕏',
    description: 'Post tweets, engage with the dev community',
    setup: 'Create a Developer Account at developer.twitter.com',
  },
  reddit: {
    icon: '🔴',
    description: 'Engage in relevant subreddits, post updates',
    setup: 'Register an app at reddit.com/prefs/apps',
  },
  product_hunt: {
    icon: '🦌',
    description: 'Launch products, engage with makers',
    setup: 'Use Product Hunt API credentials',
  },
};

export function ConnectionsPanel({ companyId }: ConnectionsPanelProps) {
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [showSetupModal, setShowSetupModal] = useState(false);

  useEffect(() => {
    loadConnections();
  }, [companyId]);

  async function loadConnections() {
    try {
      setLoading(true);
      const response = await fetch(`/api/marketing/connections?companyId=${companyId}`);
      if (response.ok) {
        const data = await response.json();
        setConnections(data.connections || []);
      }
    } catch (error) {
      console.error('Error loading connections:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect(platform: string) {
    if (!confirm(`Disconnect from ${platform}?`)) return;

    try {
      const response = await fetch(`/api/marketing/connections/${platform}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });

      if (response.ok) {
        loadConnections();
      }
    } catch (error) {
      console.error('Error disconnecting:', error);
      alert('Failed to disconnect');
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-text-secondary">Loading connections...</p>
      </div>
    );
  }

  const platforms = Object.entries(PLATFORM_INFO) as [string, typeof PLATFORM_INFO[keyof typeof PLATFORM_INFO]][];

  return (
    <div className="space-y-6">
      {/* Connection Status Overview */}
      <div className="bg-surface-card border border-border-default rounded-lg p-6">
        <h3 className="text-lg font-semibold text-text-primary mb-4">Connection Status</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {platforms.map(([key, platform]) => {
            const connection = connections.find((c) => c.platform === key);
            const isConnected = connection?.connected || false;

            return (
              <div
                key={key}
                className="p-4 rounded-lg border transition-all"
                style={{
                  borderColor: isConnected
                    ? 'var(--color-baljia-gold)'
                    : 'var(--color-border-default)',
                  backgroundColor: isConnected
                    ? 'color-mix(in srgb, var(--color-baljia-gold) 5%, transparent)'
                    : 'transparent',
                }}
              >
                <div className="text-center">
                  <div className="text-3xl mb-2">{platform.icon}</div>
                  <p className="text-sm font-semibold text-text-primary mb-1">
                    {connection?.name || key.replace('_', ' ').toUpperCase()}
                  </p>
                  <div
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold mb-3 ${
                      isConnected
                        ? 'bg-status-success/20 text-status-success'
                        : 'bg-text-muted/20 text-text-muted'
                    }`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full ${
                        isConnected ? 'bg-status-success' : 'bg-text-muted'
                      }`}
                    />
                    {isConnected ? 'Connected' : 'Not Connected'}
                  </div>
                  {isConnected && connection?.accountName && (
                    <p className="text-xs text-text-secondary mb-3 truncate">
                      @{connection.accountName}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detailed Connection Cards */}
      <div className="space-y-4">
        {platforms.map(([key, platform]) => {
          const connection = connections.find((c) => c.platform === key);
          const isConnected = connection?.connected || false;

          return (
            <div
              key={key}
              className="bg-surface-card border border-border-default rounded-lg p-6 hover:border-baljia-gold/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl">{platform.icon}</span>
                    <div>
                      <h4 className="font-semibold text-text-primary">
                        {connection?.name || key.replace('_', ' ')}
                      </h4>
                      <p className="text-sm text-text-secondary">{platform.description}</p>
                    </div>
                  </div>

                  {isConnected && connection?.accountName && (
                    <div className="mt-3 p-3 bg-surface-primary border border-border-default rounded text-sm">
                      <p className="text-text-muted mb-1">Connected Account</p>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-text-primary">@{connection.accountName}</p>
                        {connection.accountUrl && (
                          <a
                            href={connection.accountUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-baljia-gold hover:text-baljia-gold-light transition-colors"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                      </div>
                      {connection.lastConnected && (
                        <p className="text-xs text-text-muted mt-2">
                          Last verified: {new Date(connection.lastConnected).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  )}

                  {!isConnected && (
                    <div className="mt-3 p-3 bg-surface-primary border border-border-default border-dashed rounded text-sm">
                      <div className="flex items-start gap-2 text-text-secondary">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <p>{platform.setup}</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  {isConnected ? (
                    <>
                      <button
                        onClick={() => {
                          setSelectedPlatform(key);
                          setShowSetupModal(true);
                        }}
                        className="px-4 py-2 border border-border-default rounded-lg text-text-secondary hover:text-text-primary text-sm font-medium transition-colors whitespace-nowrap"
                      >
                        Re-authorize
                      </button>
                      <button
                        onClick={() => handleDisconnect(key)}
                        className="px-4 py-2 border border-status-error/30 rounded-lg text-status-error hover:bg-status-error/10 text-sm font-medium transition-colors whitespace-nowrap"
                      >
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        setSelectedPlatform(key);
                        setShowSetupModal(true);
                      }}
                      className="px-4 py-2 bg-baljia-gold text-surface-primary rounded-lg text-sm font-medium hover:bg-baljia-gold-light transition-colors whitespace-nowrap"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Setup Modal */}
      {showSetupModal && selectedPlatform && (
        <SetupModal
          platform={selectedPlatform}
          onClose={() => setShowSetupModal(false)}
          onSuccess={() => {
            setShowSetupModal(false);
            loadConnections();
          }}
        />
      )}
    </div>
  );
}

function SetupModal({
  platform,
  onClose,
  onSuccess,
}: {
  platform: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [step, setStep] = useState<'instructions' | 'credentials'>('instructions');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!apiKey.trim()) {
      alert('Please enter your API key');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/marketing/connections/${platform}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          apiSecret: apiSecret || undefined,
        }),
      });

      if (response.ok) {
        onSuccess();
      } else {
        alert('Failed to connect platform');
      }
    } catch (error) {
      console.error('Error connecting platform:', error);
      alert('Error connecting platform');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-card border border-border-default rounded-xl max-w-md w-full p-6">
        <h2 className="text-lg font-bold text-text-primary mb-4">
          Connect {platform.replace('_', ' ').toUpperCase()}
        </h2>

        {step === 'instructions' ? (
          <div className="space-y-4 mb-6">
            <div>
              <h3 className="font-semibold text-text-primary mb-2">Setup Instructions</h3>
              <ol className="space-y-2 text-sm text-text-secondary">
                <li>1. Go to the {platform} Developer Portal</li>
                <li>2. Create a new application</li>
                <li>3. Generate API keys and access tokens</li>
                <li>4. Copy your credentials and paste them below</li>
              </ol>
            </div>

            {platform === 'x' && (
              <a
                href="https://developer.twitter.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-sm text-baljia-gold hover:text-baljia-gold-light underline"
              >
                Twitter Developer Portal →
              </a>
            )}

            {platform === 'linkedin' && (
              <a
                href="https://www.linkedin.com/developers"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-sm text-baljia-gold hover:text-baljia-gold-light underline"
              >
                LinkedIn Developer Portal →
              </a>
            )}
          </div>
        ) : (
          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste your API key"
                className="w-full px-3 py-2 bg-surface-primary border border-border-default rounded-lg text-text-primary placeholder-text-muted text-sm"
              />
            </div>
            {platform !== 'reddit' && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  API Secret
                </label>
                <input
                  type="password"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  placeholder="Paste your API secret (if required)"
                  className="w-full px-3 py-2 bg-surface-primary border border-border-default rounded-lg text-text-primary placeholder-text-muted text-sm"
                />
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-border-default rounded-lg text-text-secondary hover:text-text-primary transition-colors font-medium"
          >
            Cancel
          </button>
          {step === 'instructions' ? (
            <button
              onClick={() => setStep('credentials')}
              className="flex-1 px-4 py-2 bg-baljia-gold text-surface-primary rounded-lg font-medium hover:bg-baljia-gold-light transition-colors"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-baljia-gold text-surface-primary rounded-lg font-medium hover:bg-baljia-gold-light transition-colors disabled:opacity-50"
            >
              {submitting ? 'Connecting...' : 'Connect'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
