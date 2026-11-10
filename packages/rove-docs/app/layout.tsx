import type { Metadata } from 'next';
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import { Provider } from '@/components/provider';
import './global.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://docs.rove.run'),
  title: { default: 'Rove docs', template: '%s — Rove docs' },
  description:
    'Documentation for Rove, an agentic development environment (ADE) for the terminal: every coding agent in one window, an isolated git worktree per task, hosted engine sessions, and agents that hand tasks to each other.',
  openGraph: {
    type: 'website',
    siteName: 'Rove docs',
    url: 'https://docs.rove.run',
  },
  twitter: { card: 'summary_large_image' },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
