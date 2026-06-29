// Hermes ships an incomplete `Intl` (no `Intl.PluralRules` on most builds), so
// Lingui's plural formatter crashes with "Cannot read property 'prototype' of
// undefined" the moment it evaluates `new Intl.PluralRules(...)`. Polyfill the
// missing pieces before any catalog message is formatted. `shouldPolyfill`
// guards make each block a no-op on engines that already implement the API.
//
// Metro has no dynamic import(), so the polyfills and their locale data are
// pulled in with static require() calls inside the guards. Locale data must be
// required AFTER the polyfill installs the constructor it attaches data to.
// Subpaths carry a `.js` suffix because that is how this package's `exports`
// map is keyed.
/* eslint-disable @typescript-eslint/no-require-imports */
import { shouldPolyfill as shouldPolyfillGetCanonicalLocales } from '@formatjs/intl-getcanonicallocales/should-polyfill.js';
import { shouldPolyfill as shouldPolyfillLocale } from '@formatjs/intl-locale/should-polyfill.js';
import { shouldPolyfill as shouldPolyfillPluralRules } from '@formatjs/intl-pluralrules/should-polyfill.js';

if (shouldPolyfillGetCanonicalLocales()) {
  require('@formatjs/intl-getcanonicallocales/polyfill.js');
}

if (shouldPolyfillLocale()) {
  require('@formatjs/intl-locale/polyfill.js');
}

// Pass no locale so this reflects whether PluralRules itself is missing, not
// whether one specific locale is supported.
if (shouldPolyfillPluralRules(undefined)) {
  require('@formatjs/intl-pluralrules/polyfill-force.js');
  // Keep in sync with the supported app locales (base languages only —
  // PluralRules data is per-language, not per-region).
  require('@formatjs/intl-pluralrules/locale-data/en.js');
  require('@formatjs/intl-pluralrules/locale-data/fr.js');
  require('@formatjs/intl-pluralrules/locale-data/es.js');
  require('@formatjs/intl-pluralrules/locale-data/de.js');
  require('@formatjs/intl-pluralrules/locale-data/pt.js');
  require('@formatjs/intl-pluralrules/locale-data/it.js');
  require('@formatjs/intl-pluralrules/locale-data/nl.js');
  require('@formatjs/intl-pluralrules/locale-data/ja.js');
  require('@formatjs/intl-pluralrules/locale-data/zh.js');
}
/* eslint-enable @typescript-eslint/no-require-imports */
