/**
 * Profile photos for the demo senders (the Amarna-letter kings), keyed by demo
 * thread id so every surface that renders the seed shows the same face for the
 * same sender: the landing hero feed and the Outlook inbox mock.
 *
 * Keyed by id rather than name because sender names are localized, so a name
 * lookup would miss in non-English catalogs. Senders without a portrait (t3, the
 * Bureau of Royal Appointments) fall back to their initials avatar.
 *
 * Paths are root-relative, so every app that renders the demo must ship these
 * files at its own web root: apps/site/public and apps/extension/public.
 */
export const DEMO_AVATARS: Record<string, string> = {
  t1: "/burna-buriash-pfp.png",
  t2: "/suppiluliuma-pfp.png",
  t4: "/rib-hadda-pfp.png",
  t5: "/abdi-heba-pfp.png",
  t6: "/tushratta-pfp.png",
};
