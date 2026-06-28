// Dutch (nl) multilingual routing test fixtures.
import type { TestEmail } from "../sorting-fixtures.js";

const SENT_AT = new Date("2026-01-15T10:00:00Z");

export const THREADS_NL_FLAT: TestEmail[] = [
  {
    id: "nl-finance-clear",
    difficulty: "easy",
    messages: [
      {
        subject: "Factuur nr. 2026-0042 vervalt binnenkort",
        senderEmail: "boekhouding@leverwerk.nl",
        senderName: "Leverwerk B.V. Boekhouding",
        bodyText: `Geachte heer/mevrouw,

Bijgaand ontvangt u onze factuur nr. 2026-0042 voor een bedrag van EUR 1.249,00. Wij verzoeken u vriendelijk het bedrag binnen 14 dagen over te maken op het vermelde rekeningnummer onder vermelding van het factuurnummer. Bij vragen over de afrekening kunt u contact opnemen met onze boekhouding.

Met vriendelijke groet,
Leverwerk B.V.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "finance",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "nl-sales-quoted",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: Offerte voor Enterprise-licenties",
        senderEmail: "thomas.bakker@hagedoorn-systems.nl",
        senderName: "Thomas Bakker",
        bodyText: `Hallo allemaal,

Bedankt voor de eerste inschatting. Wij willen nu graag een bindende offerte aanvragen voor 250 Enterprise-licenties, inclusief staffelprijzen en de voorwaarden voor een looptijd van drie jaar. Kunt u ons daarnaast laten weten welke korting mogelijk is bij vooruitbetaling per jaar?

Met vriendelijke groet,
Thomas Bakker

> Goedendag meneer Bakker,
> graag sturen wij u een globaal prijsoverzicht voor onze
> Enterprise-pakketten. Voor een gedetailleerde offerte hebben wij
> nog het gewenste aantal licenties nodig.
> Met vriendelijke groet, het verkoopteam`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "sales",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "nl-customer-support-unquoted",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: Inloggen lukt niet meer sinds de update",
        senderEmail: "petra.smit@webmail.nl",
        senderName: "Petra Smit",
        bodyText: `Goedemorgen,

Helaas helpt het opnieuw instellen van het wachtwoord niet. Sinds de laatste update kan ik helemaal niet meer inloggen; na het invoeren van mijn gegevens blijft de pagina de foutmelding "Sessie ongeldig" tonen. Kunt u mijn account controleren en mij helpen om mijn toegang te herstellen?

Met vriendelijke groet,
Petra Smit

Op ma 5 jan. 2026 om 09:00 schreef Supportteam <support@amarnai-app.nl>:
Hallo mevrouw Smit, probeer eerst uw wachtwoord opnieuw in te stellen via de functie "Wachtwoord vergeten" en leeg daarna de cache van uw browser. Laat het ons gerust weten als het probleem aanhoudt.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "customer-support",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "nl-legal-ambiguous",
    difficulty: "hard",
    messages: [
      {
        subject: "Verwerkersovereenkomst voor de integratie beoordelen",
        senderEmail: "j.visser@noordpunt.io",
        senderName: "Julia Visser",
        bodyText: `Hallo,

Voordat wij onze platformen technisch koppelen, moeten wij de bijgevoegde verwerkersovereenkomst en geheimhoudingsverklaring ondertekenen. Wij verzoeken uw juridische afdeling om de clausules over aansprakelijkheid en AVG-naleving te controleren en ons de ondertekende versie te retourneren. Pas daarna kunnen wij de gezamenlijke koppeling vrijgeven.

Met vriendelijke groet,
Julia Visser`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "legal",
    allowNeedsHumanReview: true,
    split: "holdout",
    misleadingKeywords: ["integratie", "platformen koppelen", "koppeling", "gezamenlijke", "samenwerking"],
  },
  {
    id: "nl-security-second",
    difficulty: "easy",
    messages: [
      {
        subject: "Kwetsbaarheid gevonden in jullie inlogformulier",
        senderEmail: "research@beveiligingslab.nl",
        senderName: "Sander de Vries",
        bodyText: `Beste beveiligingsteam,

Tijdens onafhankelijk onderzoek heb ik een kwetsbaarheid ontdekt in jullie inlogformulier waardoor een aanvaller via een geprepareerd verzoek de sessietoken van een andere gebruiker kan buitmaken. Ik meld dit verantwoord en deel graag de technische details en een proof-of-concept via een beveiligd kanaal. Laat me weten naar welk adres ik mijn rapport kan sturen.

Met vriendelijke groet,
Sander de Vries`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "security",
    allowNeedsHumanReview: true,
    split: "holdout",
  },
];

export const THREADS_NL_D3: TestEmail[] = [
  {
    id: "nl-d3-invoices-deep",
    difficulty: "medium",
    messages: [
      {
        subject: "Inkoopfactuur drukwerk januari",
        senderEmail: "factuur@printpartner-druk.nl",
        senderName: "PrintPartner Druk",
        bodyText: `Geachte heer/mevrouw,

Voor het in januari geleverde drukwerk sturen wij u hierbij factuur FA-2026-118 voor een bedrag van EUR 384,50. De levering vond plaats conform bestelling nr. 7741. Wij verzoeken u het bedrag voor 29-01-2026 te voldoen onder vermelding van het factuurnummer.

Met vriendelijke groet,
PrintPartner Druk B.V.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "d3-invoices",
    allowNeedsHumanReview: true,
    split: "tune",
  },
];
