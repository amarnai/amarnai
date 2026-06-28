// German (de) multilingual routing test fixtures.
import type { TestEmail } from "../sorting-fixtures.js";

const SENT_AT = new Date("2026-01-15T10:00:00Z");

export const THREADS_DE_FLAT: TestEmail[] = [
  {
    id: "de-finance-clear",
    difficulty: "easy",
    messages: [
      {
        subject: "Rechnung Nr. 2026-0042 zur Zahlung fällig",
        senderEmail: "buchhaltung@lieferwerk.de",
        senderName: "Lieferwerk GmbH Buchhaltung",
        bodyText: `Sehr geehrte Damen und Herren,

anbei erhalten Sie unsere Rechnung Nr. 2026-0042 über einen Betrag von 1.249,00 EUR. Der Rechnungsbetrag ist innerhalb von 14 Tagen ohne Abzug auf das angegebene Konto zu überweisen. Bei Fragen zur Abrechnung steht Ihnen unsere Buchhaltung gerne zur Verfügung.

Mit freundlichen Grüßen
Lieferwerk GmbH`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "finance",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "de-sales-quoted",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: Angebot für Enterprise-Lizenzen",
        senderEmail: "thomas.becker@hagedorn-systems.de",
        senderName: "Thomas Becker",
        bodyText: `Hallo zusammen,

vielen Dank für die erste Einschätzung. Wir möchten nun ein verbindliches Angebot für 250 Enterprise-Lizenzen anfordern, inklusive Staffelpreisen und der Konditionen für eine dreijährige Vertragslaufzeit. Können Sie uns außerdem mitteilen, welche Rabatte bei einer Jahresvorauszahlung möglich sind?

Viele Grüße
Thomas Becker

> Guten Tag Herr Becker,
> gerne senden wir Ihnen eine grobe Preisübersicht für unsere
> Enterprise-Pakete zu. Für ein detailliertes Angebot benötigen wir
> noch die gewünschte Anzahl der Lizenzen.
> Mit freundlichen Grüßen, Vertriebsteam`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "sales",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "de-customer-support-unquoted",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: Login funktioniert seit dem Update nicht mehr",
        senderEmail: "petra.schulz@webmail.de",
        senderName: "Petra Schulz",
        bodyText: `Guten Morgen,

leider hilft das Zurücksetzen des Passworts nicht. Nach dem letzten Update kann ich mich gar nicht mehr anmelden, die Seite zeigt nach der Eingabe meiner Zugangsdaten dauerhaft den Fehler "Sitzung ungültig". Könnten Sie mein Konto bitte prüfen und mir beim Wiederherstellen des Zugangs helfen?

Viele Grüße
Petra Schulz

Am Mo., 5. Jan. 2026 um 09:00 Uhr schrieb Support-Team <support@amarnai-app.de>:
Hallo Frau Schulz, bitte versuchen Sie zunächst, Ihr Passwort über die Funktion "Passwort vergessen" zurückzusetzen, und leeren Sie anschließend den Browser-Cache. Melden Sie sich gerne wieder, falls das Problem weiterhin besteht.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "customer-support",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "de-legal-ambiguous",
    difficulty: "hard",
    messages: [
      {
        subject: "Datenschutzvereinbarung zur Integration prüfen",
        senderEmail: "j.fischer@nordpunkt.io",
        senderName: "Julia Fischer",
        bodyText: `Hallo,

bevor wir unsere Plattformen technisch zusammenführen, müssen wir den beiliegenden Auftragsverarbeitungsvertrag und die Geheimhaltungsvereinbarung gegenzeichnen. Bitte lassen Sie die Klauseln zur Haftung und zur DSGVO-Konformität von Ihrer Rechtsabteilung prüfen und uns die unterschriebene Fassung zurücksenden. Erst danach können wir die gemeinsame Schnittstelle freigeben.

Beste Grüße
Julia Fischer`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "legal",
    allowNeedsHumanReview: true,
    split: "holdout",
    misleadingKeywords: ["Integration", "Plattformen zusammenführen", "Schnittstelle", "gemeinsame", "Partnerschaft"],
  },
  {
    id: "de-hr-second",
    difficulty: "easy",
    messages: [
      {
        subject: "Bewerbung als Senior Backend-Entwicklerin",
        senderEmail: "anna.lorenz@gmail.com",
        senderName: "Anna Lorenz",
        bodyText: `Sehr geehrtes Recruiting-Team,

hiermit bewerbe ich mich auf die ausgeschriebene Stelle als Senior Backend-Entwicklerin. Im Anhang finden Sie meinen Lebenslauf sowie meine Arbeitszeugnisse. Über die Einladung zu einem Vorstellungsgespräch würde ich mich sehr freuen.

Mit freundlichen Grüßen
Anna Lorenz`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "hr",
    allowNeedsHumanReview: true,
    split: "holdout",
  },
];

export const THREADS_DE_D3: TestEmail[] = [
  {
    id: "de-d3-invoices-deep",
    difficulty: "medium",
    messages: [
      {
        subject: "Eingangsrechnung Druckservice Januar",
        senderEmail: "rechnung@printpartner-druck.de",
        senderName: "PrintPartner Druck",
        bodyText: `Sehr geehrte Damen und Herren,

für die im Januar gelieferten Drucksachen stellen wir Ihnen hiermit die Rechnung RE-2026-118 über 384,50 EUR. Die Lieferung erfolgte gemäß Bestellung Nr. 7741. Bitte begleichen Sie den Betrag bis zum 29.01.2026 unter Angabe der Rechnungsnummer.

Mit freundlichen Grüßen
PrintPartner Druck GmbH`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "d3-invoices",
    allowNeedsHumanReview: true,
    split: "tune",
  },
];
