import slugify from 'slugify';
import { nanoid } from 'nanoid';

const RESERVED_SLUGS = new Set([
  'api', 'auth', 'admin', 'app', 'blog', 'dashboard', 'docs',
  'help', 'live', 'login', 'signup', 'settings', 'status',
  'support', 'terms', 'privacy', 'about', 'pricing', 'contact',
  'www', 'mail', 'ftp', 'cdn', 'static', 'assets',
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

export async function generateSlug(
  companyName: string,
  collisionCheck: (slug: string) => Promise<boolean>
): Promise<string> {
  const base = slugify(companyName, { lower: true, strict: true });

  if (isReservedSlug(base)) {
    return generateSlug(`${companyName}-co`, collisionCheck);
  }

  let slug = base;
  let attempts = 0;
  const maxAttempts = 20;

  while (attempts < maxAttempts) {
    const taken = await collisionCheck(slug);
    if (!taken) return slug;

    attempts++;
    slug = `${base}-${nanoid(4).toLowerCase()}`;
  }

  throw new Error(`Could not generate unique slug for "${companyName}" after ${maxAttempts} attempts`);
}
