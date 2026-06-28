// French (fr) email-thread test fixtures for the email-routing benchmark.
import type { TestEmail } from "../sorting-fixtures.js";

const SENT_AT = new Date("2026-01-15T10:00:00Z");

export const THREADS_FR_FLAT: TestEmail[] = [
  // 1. clear — unambiguous finance/invoice, no reply tail.
  {
    id: "fr-finance-facture-impayee",
    difficulty: "easy",
    messages: [
      {
        subject: "Facture n° FAC-2026-0147 en attente de règlement",
        senderEmail: "comptabilite@fournisseur.fr",
        senderName: "Service Comptabilité",
        bodyText:
          "Bonjour, vous trouverez ci-joint la facture n° FAC-2026-0147 d'un montant de 3 240 € TTC. Le règlement est attendu sous 30 jours par virement bancaire aux coordonnées indiquées sur le document. Merci de nous confirmer la date de paiement prévue.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "finance",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  // 2. quoted — sales request on top, quoted reply tail with "> ".
  {
    id: "fr-sales-devis-volume",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: Tarification pour 80 licences entreprise",
        senderEmail: "achats@grandcompte.fr",
        senderName: "Direction des Achats",
        bodyText:
          "Bonjour, suite à votre réponse, nous souhaitons recevoir une proposition commerciale chiffrée pour 80 licences en édition entreprise, avec les remises par volume et vos conditions de paiement pour un engagement sur trois ans.\n\n" +
          "Le mar. 13 janv. 2026 à 11:20, Équipe Commerciale <ventes@example.com> a écrit :\n" +
          "> Bonjour, merci de votre intérêt pour notre offre entreprise. Pouvez-vous nous préciser le nombre exact d'utilisateurs concernés ?\n" +
          "> Bien cordialement, l'équipe commerciale",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "sales",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  // 3. unquoted — support request on top, French attribution line ending with a
  //    colon, then prior message with no ">" markers.
  {
    id: "fr-customer-support-connexion-bloquee",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: Impossible de se connecter au tableau de bord",
        senderEmail: "marie.leroy@cliente.fr",
        senderName: "Marie Leroy",
        bodyText:
          "Bonjour, j'ai bien suivi la procédure que vous m'avez indiquée, mais le code d'authentification à deux facteurs n'arrive toujours pas et je reste bloquée à l'écran de connexion. Mon compte est inaccessible depuis hier et cela bloque tout mon travail. Pouvez-vous intervenir en urgence ?\n\n" +
          "Le lun. 12 janv. 2026 à 09:00, Support Technique <support@example.com> a écrit :\n" +
          "Bonjour Marie, merci de votre message. Pourriez-vous d'abord réinitialiser votre mot de passe puis réessayer de vous connecter ? Tenez-nous au courant.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "customer-support",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  // 4. ambiguous — partnership co-marketing vs sales. The relationship goal is a
  //    partnership, but it is loaded with commercial/pricing vocabulary.
  {
    id: "fr-partnerships-co-marketing-ambigu",
    difficulty: "hard",
    messages: [
      {
        subject: "Proposition de partenariat et offre commerciale conjointe",
        senderEmail: "alliances@agence-digitale.fr",
        senderName: "Pôle Alliances",
        bodyText:
          "Bonjour, nous souhaitons nouer un partenariat de co-marketing entre nos deux sociétés, avec une campagne commune et une intégration technique de nos produits. Nous pourrions aussi proposer une offre commerciale groupée à nos clients respectifs, avec des tarifs préférentiels. Pourriez-vous nous indiquer qui pilote ce type de collaboration chez vous ?",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "partnerships",
    allowNeedsHumanReview: true,
    split: "holdout",
    misleadingKeywords: ["offre commerciale", "tarifs", "clients", "vente"],
  },

  // 5. second — clear HR recruiting email, different category, no tail.
  {
    id: "fr-hr-candidature-developpeur",
    difficulty: "easy",
    messages: [
      {
        subject: "Candidature au poste de Développeur back-end senior",
        senderEmail: "thomas.bernard@example.com",
        senderName: "Thomas Bernard",
        bodyText:
          "Bonjour, je vous adresse ma candidature pour le poste de Développeur back-end senior publié sur votre page carrières. Vous trouverez ci-joint mon CV ainsi que ma lettre de motivation. Je reste à votre disposition pour échanger sur le processus de recrutement et les prochaines étapes. Merci de me confirmer la bonne réception de ma candidature.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "hr",
    allowNeedsHumanReview: true,
    split: "holdout",
  },
];

export const THREADS_FR_D3: TestEmail[] = [
  // 6. deep — clear vendor invoice targeting the d3-invoices leaf, no tail.
  {
    id: "fr-d3-invoices-facture-prestataire",
    difficulty: "medium",
    messages: [
      {
        subject: "Facture n° FR-2026-0521 — prestation de conseil, échéance 30 jours",
        senderEmail: "facturation@cabinet-conseil.fr",
        senderName: "Cabinet Conseil — Facturation",
        bodyText:
          "Bonjour, veuillez trouver ci-jointe notre facture n° FR-2026-0521 d'un montant de 6 000 € HT au titre de la prestation de conseil réalisée au quatrième trimestre, en référence au bon de commande BC-2026-0210. Le règlement est attendu sous 30 jours par virement aux coordonnées figurant sur la facture. N'hésitez pas à nous contacter pour toute question relative à ce document.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "d3-invoices",
    allowNeedsHumanReview: true,
    split: "tune",
  },
];
