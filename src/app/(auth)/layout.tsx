import type { Metadata } from 'next';

// C7: SEO metadata for auth pages
export const metadata: Metadata = {
  title: 'Sign In | Baljia AI',
  description: 'Sign in to Baljia AI — your AI Angel that runs your company while you enjoy life.',
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
