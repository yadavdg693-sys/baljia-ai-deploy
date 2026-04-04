import Link from 'next/link';

// I2: Custom 404 page — branded, helpful, not a blank white page
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-primary p-6">
      <div className="text-center max-w-md">
        {/* Large 404 */}
        <h1 className="text-7xl font-bold font-[family-name:var(--font-display)] text-baljia-gold mb-4">
          404
        </h1>
        <h2 className="text-xl font-semibold text-text-primary mb-3">
          Page not found
        </h2>
        <p className="text-text-secondary mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/"
            className="px-6 py-3 rounded-xl bg-baljia-gold text-surface-primary font-semibold hover:bg-baljia-gold-light transition-colors"
          >
            Go home
          </Link>
          <Link
            href="/login"
            className="px-6 py-3 rounded-xl border border-border-default text-text-secondary hover:border-baljia-gold hover:text-text-primary transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
