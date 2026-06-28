// Polish (pl) multilingual routing test fixtures.
import type { TestEmail } from "../sorting-fixtures.js";

const SENT_AT = new Date("2026-01-15T10:00:00Z");

export const THREADS_PL_FLAT: TestEmail[] = [
  {
    id: "pl-finance-clear",
    difficulty: "easy",
    messages: [
      {
        subject: "Faktura nr 2026-0042 do zapłaty",
        senderEmail: "ksiegowosc@dostawczak.pl",
        senderName: "Dostawczak Sp. z o.o. Księgowość",
        bodyText: `Szanowni Państwo,

w załączeniu przesyłamy fakturę nr 2026-0042 na kwotę 1 249,00 zł. Prosimy o uregulowanie należności w terminie 14 dni na wskazany numer rachunku bankowego. W razie pytań dotyczących rozliczenia pozostajemy do Państwa dyspozycji.

Z poważaniem
Dział Księgowości`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "finance",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "pl-sales-quoted",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: Oferta na licencje Enterprise",
        senderEmail: "tomasz.kowalczyk@hagedorn-systemy.pl",
        senderName: "Tomasz Kowalczyk",
        bodyText: `Dzień dobry,

dziękuję za wstępną wycenę. Chcielibyśmy teraz poprosić o wiążącą ofertę na 250 licencji Enterprise, wraz z cenami progowymi oraz warunkami przy trzyletnim okresie umowy. Czy mogliby Państwo dodatkowo wskazać, jakie rabaty przysługują przy płatności z góry za cały rok?

Pozdrawiam
Tomasz Kowalczyk

> Dzień dobry Panie Tomaszu,
> chętnie prześlemy wstępne zestawienie cen naszych pakietów
> Enterprise. Do przygotowania szczegółowej oferty potrzebujemy
> jeszcze docelowej liczby licencji.
> Z poważaniem, Zespół Sprzedaży`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "sales",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "pl-customer-support-unquoted",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: Logowanie nie działa po aktualizacji",
        senderEmail: "katarzyna.wisniewska@poczta.pl",
        senderName: "Katarzyna Wiśniewska",
        bodyText: `Dzień dobry,

niestety zresetowanie hasła nie pomogło. Po ostatniej aktualizacji w ogóle nie mogę się zalogować, a strona po wpisaniu danych ciągle wyświetla błąd "sesja nieprawidłowa". Czy mogliby Państwo sprawdzić moje konto i pomóc mi odzyskać dostęp?

Pozdrawiam
Katarzyna Wiśniewska

W dniu pon., 5 sty 2026 o 09:00 Zespół Wsparcia <wsparcie@amarnai-app.pl> napisał(a):
Dzień dobry Pani Katarzyno, prosimy najpierw spróbować zresetować hasło za pomocą opcji "Nie pamiętam hasła", a następnie wyczyścić pamięć podręczną przeglądarki. Prosimy o kontakt, jeśli problem będzie się powtarzał.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "customer-support",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "pl-legal-ambiguous",
    difficulty: "hard",
    messages: [
      {
        subject: "Umowa o ochronie danych do weryfikacji przed integracją",
        senderEmail: "j.lewandowska@nordpunkt.io",
        senderName: "Julia Lewandowska",
        bodyText: `Dzień dobry,

zanim technicznie połączymy nasze platformy, musimy obustronnie podpisać załączoną umowę powierzenia przetwarzania danych oraz umowę o zachowaniu poufności. Proszę o przekazanie zapisów dotyczących odpowiedzialności oraz zgodności z RODO do weryfikacji przez Państwa dział prawny i odesłanie podpisanej wersji. Dopiero wtedy będziemy mogli uruchomić wspólne API.

Pozdrawiam serdecznie
Julia Lewandowska`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "legal",
    allowNeedsHumanReview: true,
    split: "holdout",
    misleadingKeywords: ["integracja", "połączenie platform", "API", "wspólne", "partnerstwo"],
  },
  {
    id: "pl-hr-second",
    difficulty: "easy",
    messages: [
      {
        subject: "Aplikacja na stanowisko Senior Backend Developer",
        senderEmail: "anna.nowak@gmail.com",
        senderName: "Anna Nowak",
        bodyText: `Szanowny Zespole Rekrutacyjny,

niniejszym aplikuję na ogłoszone stanowisko Senior Backend Developer. W załączeniu przesyłam swoje CV oraz referencje z poprzednich miejsc pracy. Będę bardzo wdzięczna za zaproszenie na rozmowę kwalifikacyjną.

Z poważaniem
Anna Nowak`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "hr",
    allowNeedsHumanReview: true,
    split: "holdout",
  },
];

export const THREADS_PL_D3: TestEmail[] = [
  {
    id: "pl-d3-invoices-deep",
    difficulty: "medium",
    messages: [
      {
        subject: "Faktura za usługi druku za styczeń",
        senderEmail: "faktury@printpartner-druk.pl",
        senderName: "PrintPartner Druk",
        bodyText: `Szanowni Państwo,

za materiały drukowane dostarczone w styczniu wystawiamy fakturę FV-2026-118 na kwotę 384,50 zł. Dostawa została zrealizowana zgodnie z zamówieniem nr 7741. Prosimy o uregulowanie należności do dnia 29.01.2026 z podaniem numeru faktury w tytule przelewu.

Z poważaniem
PrintPartner Druk Sp. z o.o.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "d3-invoices",
    allowNeedsHumanReview: true,
    split: "tune",
  },
];
