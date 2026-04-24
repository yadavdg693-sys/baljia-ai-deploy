import type { Metadata } from 'next';
import { ErrorBoundary } from '@/components/error-boundary';
import './globals.css';
// Polsia reference stylesheet — loaded after globals.css so its variables and
// utility classes win. Drives the founder dashboard + live wall + portfolio UI.
import '@/styles/polsia-shell.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://baljia.ai'),
  title: {
    default: 'Baljia AI — Your AI Angel',
    template: '%s | Baljia AI',
  },
  description:
    'Baljia AI runs your company autonomously — planning, building, and marketing 24/7 with AI agents. No credit card required.',
  keywords: [
    'AI company automation',
    'AI agents',
    'autonomous business',
    'AI startup tools',
    'AI CEO',
    'business automation platform',
  ],
  openGraph: {
    title: 'Baljia AI — Your AI Angel',
    description:
      'AI that runs your company while you sleep. Planning, coding, and marketing — fully autonomous.',
    url: 'https://baljia.ai',
    siteName: 'Baljia AI',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Baljia AI — Your AI Angel',
    description:
      'AI that runs your company while you sleep. Planning, coding, and marketing — fully autonomous.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  alternates: {
    canonical: 'https://baljia.ai',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="site-shell">
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </body>
    </html>
  );
}

