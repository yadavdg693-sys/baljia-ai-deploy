import type { Metadata } from 'next';
import { requireSuperAdminPage, getSuperAdminBasePath } from '@/lib/super-admin';
import { SuperAdminShell } from '@/components/super-admin/SuperAdminShell';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Baljia Owner Dashboard',
  robots: {
    index: false,
    follow: false,
  },
};

type Props = {
  children: React.ReactNode;
  params: Promise<{ accessKey: string }>;
};

export default async function SuperAdminLayout({ children, params }: Props) {
  const { accessKey } = await params;
  const user = await requireSuperAdminPage(accessKey);

  return (
    <SuperAdminShell basePath={getSuperAdminBasePath(accessKey)} userEmail={user.email}>
      {children}
    </SuperAdminShell>
  );
}
