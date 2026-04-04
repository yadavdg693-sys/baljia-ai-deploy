import type { Metadata } from 'next';
import { getSessionFromCookies } from '@/lib/auth';
import { redirect } from 'next/navigation';

// C6: SEO metadata for dashboard pages
export const metadata: Metadata = {
  title: 'Dashboard | Baljia AI',
  description: 'Manage your AI-powered company. View tasks, credits, and activity in one place.',
};

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  const user = await getSessionFromCookies();
  if (!user) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-surface-primary text-text-primary">
      {children}
    </div>
  );
}
