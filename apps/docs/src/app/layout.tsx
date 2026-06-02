import { RootProvider } from 'fumadocs-ui/provider/next';
import 'fumadocs-ui/style.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: {
    template: '%s | Amarnai Docs',
    default: 'Amarnai Docs',
  },
  description: 'Amarnai documentation — self-hosting and architecture.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
