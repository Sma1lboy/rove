import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      // Wordmark with a terminal cursor: the site is a terminal product's
      // manual, so the logo carries the one glyph every terminal shares. The
      // bar inherits the theme's primary (the brand orange) in both modes.
      title: (
        <span className="font-mono font-semibold tracking-tight">
          Rove
          <span aria-hidden className="rove-cursor" />
        </span>
      ),
    },
    githubUrl: 'https://github.com/Sma1lboy/rove',
  };
}
