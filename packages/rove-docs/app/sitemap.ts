import { lastModified } from '@/lib/last-modified';
import { source } from '@/lib/source';
import type { MetadataRoute } from 'next';

// `output: export` needs this emitted at build time, not per request.
export const dynamic = 'force-static';

const SITE = 'https://docs.rove.run';

export default function sitemap(): MetadataRoute.Sitemap {
  return source.getPages().map((page) => {
    const modified = lastModified(page.url);
    return {
      url: `${SITE}${page.url}`,
      // Omitted when the build couldn't derive a real date — a <lastmod> of
      // "today" on every page is a freshness claim crawlers learn to distrust.
      ...(modified ? { lastModified: modified } : {}),
      changeFrequency: 'weekly' as const,
      priority: page.url === '/rove/quick-start' ? 1 : 0.7,
    };
  });
}
