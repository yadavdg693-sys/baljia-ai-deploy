export function extractOwnerAccessKeyFromPath(pathname: string): string | null {
  if (pathname !== '/owner' && !pathname.startsWith('/owner/')) return null;

  const [, ownerSegment, accessKey] = pathname.split('/');
  if (ownerSegment !== 'owner' || !accessKey) return null;

  try {
    return decodeURIComponent(accessKey);
  } catch {
    return accessKey;
  }
}

export function shouldHideOwnerPathBeforeAuth(
  pathname: string,
  expectedSlug = process.env.SUPER_ADMIN_DASHBOARD_SLUG
): boolean {
  if (pathname !== '/owner' && !pathname.startsWith('/owner/')) return false;

  const accessKey = extractOwnerAccessKeyFromPath(pathname);
  return !accessKey || !expectedSlug || accessKey !== expectedSlug;
}
