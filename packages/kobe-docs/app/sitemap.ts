import { source } from '@/lib/source';
import type { MetadataRoute } from 'next';

// `output: export` needs this emitted at build time, not per request.
export const dynamic = 'force-static';

const SITE = 'https://docs.rove.run';

export default function sitemap(): MetadataRoute.Sitemap {
  return source.getPages().map((page) => ({
    url: `${SITE}${page.url}`,
    changeFrequency: 'weekly' as const,
    priority: page.url === '/rove/quick-start' ? 1 : 0.7,
  }));
}
