import Link from 'next/link';
import { BaljiaMascot } from '@/components/mascot/BaljiaMascot';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-surface-primary text-text-primary">
      {/* Live bar */}
      <div className="bg-baljia-gold text-surface-primary text-center text-sm py-2 font-medium">
        <Link href="/live" className="hover:underline">
          <span className="inline-block w-2 h-2 rounded-full bg-surface-primary mr-2 animate-pulse" />
          Watch Baljia work on companies live &rarr;
        </Link>
      </div>

      {/* Header */}
      <header className="max-w-4xl mx-auto px-6 pt-10 pb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold font-[family-name:var(--font-display)] text-baljia-gold">
          Baljia
        </h1>
        <Link
          href="/login"
          className="text-sm text-text-secondary hover:text-text-primary underline underline-offset-4 transition-colors"
        >
          Sign in
        </Link>
      </header>

      {/* Hero */}
      <main className="max-w-4xl mx-auto px-6 py-16">
        <div className="flex items-center gap-8 mb-12">
          <div className="hidden md:block shrink-0">
            <BaljiaMascot
              status={{ state: 'listening', label: '', detail: '' }}
              size="hero"
              showLabel={false}
              showDetail={false}
            />
          </div>
          <div>
            <h2 className="text-4xl md:text-5xl font-bold leading-tight mb-6">
              AI That Runs Your Company While You Sleep.
            </h2>
            <p className="text-lg text-text-secondary leading-relaxed max-w-2xl">
              Baljia thinks, builds, and markets your projects autonomously. It plans, codes, and
              promotes your ideas continuously &mdash; operating 24/7, adapting to data, and
              improving itself without human intervention.
            </p>
          </div>
        </div>

        <Link
          href="/login"
          className="inline-block px-10 py-4 rounded-xl bg-baljia-gold text-surface-primary font-semibold text-lg hover:bg-baljia-gold-light transition-colors"
        >
          Get Started
        </Link>
        <p className="text-sm text-text-muted mt-4">
          No credit card required &middot; Free to start
        </p>
      </main>

      {/* Footer */}
      <footer className="max-w-4xl mx-auto px-6 py-12 border-t border-border-default">
        <div className="flex flex-wrap items-center gap-6 text-sm text-text-muted">
          <Link href="/about" className="hover:text-text-secondary">About</Link>
          <Link href="/terms" className="hover:text-text-secondary">Terms</Link>
          <Link href="/privacy" className="hover:text-text-secondary">Privacy</Link>
          <span>Contact: <a href="mailto:hello@baljia.app" className="hover:text-text-secondary">hello@baljia.app</a></span>
        </div>
      </footer>
    </div>
  );
}
