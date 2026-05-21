import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/dashboard/', '/ops/', '/api/', '/owner/'],
      },
    ],
    sitemap: 'https://baljia.ai/sitemap.xml',
  };
}
