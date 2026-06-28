// Italian (it) multilingual email-thread fixtures for the routing benchmark. Test data only.

import type { TestEmail } from "../sorting-fixtures.js";

const SENT_AT = new Date("2026-01-15T10:00:00Z");

export const THREADS_IT_FLAT: TestEmail[] = [
  {
    // 1. clear — unambiguous finance/invoice, no reply tail.
    id: "it-finance-fattura-in-scadenza",
    difficulty: "easy",
    messages: [
      {
        subject: "Fattura n. FT-2026-0142 in scadenza",
        senderEmail: "amministrazione@fornitore.it",
        senderName: "Ufficio Amministrazione",
        bodyText:
          "Buongiorno, in allegato trovate la fattura n. FT-2026-0142 dell'importo di 3.450 € relativa ai servizi di dicembre. " +
          "Il termine di pagamento è di 30 giorni dalla data di emissione. " +
          "Vi preghiamo di effettuare il bonifico sulle coordinate bancarie indicate in fattura e di confermarci quando risulterà saldata. " +
          "Per qualsiasi chiarimento sull'incasso, restiamo a disposizione tramite il nostro ufficio contabilità.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "finance",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  {
    // 2. quoted — sales request on top, then quoted reply tail with "> " prefixes.
    id: "it-sales-preventivo-50-licenze",
    difficulty: "medium",
    messages: [
      {
        subject: "Richiesta di preventivo per 50 licenze aziendali",
        senderEmail: "acquisti@clienteimpresa.it",
        senderName: "Ufficio Acquisti",
        bodyText:
          "Salve, a seguito della nostra conversazione, desideriamo ricevere una proposta commerciale per 50 licenze dell'edizione enterprise, " +
          "con gli sconti per volume e le vostre condizioni di pagamento. Ci serve l'offerta entro fine mese per finalizzare l'acquisto.\n\n" +
          "Il giorno lun 12 gen 2026 alle ore 09:30, Team Commerciale <vendite@example.com> ha scritto:\n" +
          "> Salve, grazie per l'interesse verso la nostra soluzione. Potete indicarci quanti utenti sono coinvolti?\n" +
          "> Cordiali saluti, il team commerciale",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "sales",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  {
    // 3. unquoted — support signal on top; Italian attribution line ending in colon
    //    with <email> and date, then prior message WITHOUT ">" markers.
    id: "it-customer-support-errore-accesso",
    difficulty: "medium",
    messages: [
      {
        subject: "Continuo a non riuscire ad accedere al mio account",
        senderEmail: "utente@example.it",
        senderName: "Marta Gentile",
        bodyText:
          "Buonasera, ho seguito i passaggi che mi avete indicato ma il codice di verifica in due passaggi non mi arriva e continuo a non riuscire " +
          "ad accedere al mio account. L'applicazione mi mostra un errore ogni volta che provo a entrare nel pannello. Ho bisogno che venga risolto con urgenza.\n\n" +
          "Il giorno lun 8 gen 2026 alle ore 10:00, Supporto Tecnico <supporto@example.com> ha scritto:\n" +
          "Grazie per averci contattato. Per iniziare, le consigliamo di reimpostare la password e di provare nuovamente l'accesso. " +
          "Se il problema persiste, ci indichi quale messaggio di errore compare esattamente sullo schermo e da quale dispositivo si collega.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "customer-support",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  {
    // 4. ambiguous — between partnerships and sales. The real intent is a partnership
    //    (integration + co-marketing), but commercial/pricing vocabulary pulls toward sales.
    id: "it-partnerships-integrazione-comarketing",
    difficulty: "hard",
    messages: [
      {
        subject: "Proposta di collaborazione: integrazione e campagna congiunta",
        senderEmail: "alleanze@aziendapartner.it",
        senderName: "Team Alleanze Strategiche",
        bodyText:
          "Gentile team, vi scriviamo per proporre una collaborazione strategica tra le nostre aziende. " +
          "Vorremmo integrare le nostre piattaforme e lanciare una campagna di marketing congiunta con materiale a marchio condiviso. " +
          "Anche se questa alleanza genererà valore commerciale per entrambe le parti e più avanti potremo discutere di prezzi e condizioni, " +
          "il nostro obiettivo principale è una relazione di comarketing a lungo termine. Potete indicarci chi gestisce questo tipo di accordi?",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "partnerships",
    allowNeedsHumanReview: true,
    split: "holdout",
    misleadingKeywords: ["commerciale", "prezzi", "condizioni", "acquisto", "offerta"],
  },

  {
    // 5. second — clear security email (responsible vulnerability disclosure), no tail.
    id: "it-security-divulgazione-vulnerabilita",
    difficulty: "easy",
    messages: [
      {
        subject: "Divulgazione responsabile di una vulnerabilità critica di autenticazione",
        senderEmail: "ricercatore@sicurezza.it",
        senderName: "Ricercatore di Sicurezza",
        bodyText:
          "Vi scrivo per segnalarvi in modo responsabile una vulnerabilità critica che abbiamo individuato nel vostro sistema di autenticazione. " +
          "Il difetto consentirebbe a un malintenzionato di aggirare la procedura di accesso e di entrare negli account senza autorizzazione. " +
          "In allegato trovate i dettagli tecnici e i passaggi per riprodurre il problema. " +
          "Vi preghiamo di inoltrare questa segnalazione al vostro team di sicurezza affinché avvii la risposta all'incidente e applichi la correzione al più presto.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "security",
    allowNeedsHumanReview: true,
    split: "holdout",
  },
];

export const THREADS_IT_D3: TestEmail[] = [
  {
    // 6. deep — vendor software invoice targeting the d3-invoices leaf, no tail.
    id: "it-d3-invoices-fattura-fornitore",
    difficulty: "medium",
    messages: [
      {
        subject: "Fattura n. FT-2026-0357 — rinnovo annuale licenze: 15 postazioni",
        senderEmail: "fatturazione@acme-software.it",
        senderName: "Fatturazione Acme Software",
        bodyText:
          "In allegato trovate la fattura n. FT-2026-0357 relativa al rinnovo annuale della vostra licenza software. " +
          "15 postazioni × 240 €/postazione = 3.600 €. Condizioni di pagamento: 30 giorni. " +
          "Riferimento ordine d'acquisto: ODA-2026-0891. " +
          "Vi preghiamo di effettuare il pagamento sulle coordinate bancarie riportate in fattura e di avvisarci in caso di necessità di chiarimenti.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "d3-invoices",
    allowNeedsHumanReview: true,
    split: "tune",
  },
];
