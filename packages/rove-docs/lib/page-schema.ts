import { lastModified } from '@/lib/last-modified';

const SITE = 'https://docs.rove.run';

/** Section label for a docs path, from its module folder. */
const MODULE_TITLES: Record<string, string> = {
  rove: 'Rove',
  plugins: 'Plugins',
};

/**
 * schema.org JSON-LD for one docs page: a TechArticle so AI engines classify
 * the page as reference material rather than marketing, plus the breadcrumb
 * trail that places it inside its section.
 */
export function pageSchema(page: { url: string; title: string; description?: string }) {
  const url = `${SITE}${page.url}`;
  const moduleDir = page.url.split('/')[1] ?? '';
  const moduleTitle = MODULE_TITLES[moduleDir];
  const modified = lastModified(page.url);

  const trail = [{ name: 'Docs', item: SITE }];
  if (moduleTitle) trail.push({ name: moduleTitle, item: `${SITE}/${moduleDir}` });
  trail.push({ name: page.title, item: url });

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TechArticle',
        '@id': `${url}#article`,
        headline: page.title,
        ...(page.description ? { description: page.description } : {}),
        url,
        // Omitted when the build had no per-file git history — see
        // lib/last-modified.ts. A wrong date is worse than an absent one.
        ...(modified ? { dateModified: modified } : {}),
        inLanguage: 'en',
        isPartOf: { '@type': 'WebSite', '@id': `${SITE}/#website`, name: 'Rove docs', url: SITE },
        publisher: { '@type': 'Organization', name: 'Rove', url: 'https://rove.run/' },
        about: { '@type': 'SoftwareApplication', name: 'Rove', url: 'https://rove.run/' },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: trail.map((crumb, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: crumb.name,
          item: crumb.item,
        })),
      },
    ],
  };
}
