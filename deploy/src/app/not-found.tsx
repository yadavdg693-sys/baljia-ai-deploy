// 404 page — warm cream + gold theme (FIXED — was dark).

import Link from 'next/link';

export default function NotFound() {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: '#FCFBF8', color: '#1E1A16' }}
    >
      <div className="text-center max-w-md">
        <img
          src="/mascot.png"
          alt="Baljia"
          className="w-20 h-20 mx-auto mb-5 object-contain"
          style={{
            filter: 'drop-shadow(0 6px 16px rgba(217,119,6,0.25)) brightness(1.08) saturate(1.2)',
            opacity: 0.8,
          }}
        />
        <h1
          className="text-7xl font-normal mb-3"
          style={{
            fontFamily: 'var(--font-display, Newsreader, Georgia, serif)',
            color: '#E1B12C',
            letterSpacing: '-2px',
          }}
        >
          404
        </h1>
        <h2 className="text-xl font-semibold mb-2">Page not found</h2>
        <p className="text-sm mb-8" style={{ color: '#5C5147' }}>
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/"
            className="px-6 py-3 rounded-xl font-semibold text-white"
            style={{
              background: 'linear-gradient(135deg, #E1B12C, #D97706)',
              boxShadow: '0 6px 18px rgba(217,119,6,0.28), inset 0 1px 0 rgba(255,255,255,0.3)',
            }}
          >
            Go home
          </Link>
          <Link
            href="/login"
            className="px-6 py-3 rounded-xl transition-colors"
            style={{
              border: '1px solid #DED6CA',
              color: '#5C5147',
            }}
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
