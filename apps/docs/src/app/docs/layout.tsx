import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import Image from 'next/image';
import { source } from '@/lib/source';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{
        title: (
          <>
            <Image src="/logo.png" alt="" width={20} height={20} aria-hidden />
            Aziru
          </>
        ),
      }}
    >
      {children}
    </DocsLayout>
  );
}
