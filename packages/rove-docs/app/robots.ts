import type { MetadataRoute } from 'next';

// `output: export` needs this emitted at build time, not per request.
export const dynamic = 'force-static';

/**
 * AI citation bots are how these docs reach people who ask an assistant about
 * Rove instead of searching. They get an explicit Allow so a future
 * `User-agent: *` tightening can never silently cut them off.
 */
const AI_CITATION_BOTS = [
  'OAI-SearchBot',
  'ChatGPT-User',
  'PerplexityBot',
  'Perplexity-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'Google-Extended',
  'Applebot',
  'Applebot-Extended',
  'cohere-ai',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      ...AI_CITATION_BOTS.map((userAgent) => ({ userAgent, allow: '/' })),
      { userAgent: '*', allow: '/' },
    ],
    sitemap: 'https://docs.rove.run/sitemap.xml',
    host: 'https://docs.rove.run',
  };
}
