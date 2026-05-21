import Link from 'next/link';

type Props = {
  basePath: string;
  userEmail: string;
  children: React.ReactNode;
};

export function SuperAdminShell({ basePath, userEmail, children }: Props) {
  return (
    <main className="min-h-screen bg-[#f7f7f4] text-[#171717]">
      <header className="border-b border-[#dedbd2] bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#6b6b60]">Baljia Owner</p>
            <h1 className="text-xl font-semibold">Super Admin Dashboard</h1>
          </div>
          <nav className="flex flex-wrap items-center gap-4 text-sm">
            <Link href={basePath} className="text-[#333] hover:text-black">
              Overview
            </Link>
            <Link href={`${basePath}/companies`} className="text-[#333] hover:text-black">
              Companies
            </Link>
            <Link href={`${basePath}/operations`} className="text-[#333] hover:text-black">
              Operations
            </Link>
            <Link href={`${basePath}/billing`} className="text-[#333] hover:text-black">
              Billing
            </Link>
            <Link href={`${basePath}/audit`} className="text-[#333] hover:text-black">
              Audit
            </Link>
            <span className="max-w-full truncate rounded border border-[#dedbd2] px-3 py-1 text-xs text-[#555] sm:max-w-64">
              {userEmail}
            </span>
          </nav>
        </div>
      </header>
      <section className="mx-auto max-w-7xl px-6 py-6">{children}</section>
    </main>
  );
}
