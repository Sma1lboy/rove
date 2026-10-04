import { getMDXComponents } from '@/components/mdx';
import { pageSchema } from '@/lib/page-schema';
import { source } from '@/lib/source';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export default async function Page(props: PageProps<'/[[...slug]]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const schema = pageSchema({
    url: page.url,
    title: page.data.title,
    description: page.data.description,
  });

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD has no
          other injection point in React, and the payload is built from our own
          page metadata, not user input. */}
      <script
        type="application/ld+json"
        // biome-ignore lint/correctness/useUniqueElementIds: not an id.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<'/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const url = `https://docs.rove.run${page.url}`;
  return {
    title: page.data.title,
    description: page.data.description,
    alternates: { canonical: url },
    openGraph: {
      title: page.data.title,
      description: page.data.description,
      url,
      type: 'article',
    },
  };
}
