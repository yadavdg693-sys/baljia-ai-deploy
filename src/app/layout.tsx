import type { Metadata } from 'next';
import { ErrorBoundary } from '@/components/error-boundary';
import './globals.css';

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
    <html lang="en" className="dark">
      <head>
        <link
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&f[]=general-sans@400,500,600&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased min-h-screen bg-surface-primary text-text-primary">
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </body>
    </html>
  );
}

