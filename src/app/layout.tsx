import type { Metadata } from 'next';
import { ErrorBoundary } from '@/components/error-boundary';
import './globals.css';
import '@/styles/polsia-shell.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://baljia.ai'),
  title: { default: 'Baljia AI — Your AI Angel', template: '%s | Baljia AI' },
  description: 'Baljia AI runs your company autonomously — planning, building, and marketing 24/7 with AI agents.',
  openGraph: { title: 'Baljia AI — Your AI Angel', description: 'AI that runs your company while you sleep.', url: 'https://baljia.ai', siteName: 'Baljia AI', locale: 'en_US', type: 'website', images: [{ url: 'https://baljia.ai/assets/og-cover.png', width: 1200, height: 630, alt: 'Baljia AI — Your AI Angel' }] },
  twitter: { card: 'summary_large_image', title: 'Baljia AI — Your AI Angel', description: 'AI that runs your company while you sleep.', images: ['https://baljia.ai/assets/og-cover.png'] },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true } },
  alternates: { canonical: 'https://baljia.ai' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500;1,6..72,600&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
        <link rel="icon" type="image/png" href="/mascot.png" />
        <meta name="theme-color" content="#FCFBF8" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#14110D" media="(prefers-color-scheme: dark)" />
        {/* Inline script to prevent flash of wrong theme */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            try {
              var t = localStorage.getItem('baljia-theme');
              if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                document.documentElement.style.colorScheme = 'dark';
                document.body && document.body.classList.add('dark');
              }
            } catch(e){}
          })();
        `}} />
      </head>
      <body className="site-shell">
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
