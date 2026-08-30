import { type ReactNode } from 'react';
import { isSupportedLocale, type SupportedLocale } from '@aziru/i18n';
import { useSession } from '../auth/session';
import { LinguiProvider } from './LinguiProvider';

export function SessionLocaleProvider({ children }: { children: ReactNode }) {
  const { locale } = useSession();
  const resolvedLocale: SupportedLocale | null =
    locale && isSupportedLocale(locale) ? locale : null;
  return <LinguiProvider locale={resolvedLocale}>{children}</LinguiProvider>;
}
