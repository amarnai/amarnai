import { describe, it, expect } from "vitest";
import {
  detectAutomatedThread,
  isAutomatedMessage,
  senderIsNoReply,
  subjectIsTransactionalAuto,
} from "../detection/automated-mail.js";
import type { SnapshotMessage } from "../thread-snapshot.js";

function msg(overrides: Partial<SnapshotMessage> = {}): SnapshotMessage {
  return {
    providerMessageId: "m1",
    senderEmail: "alice@example.com",
    senderName: "Alice",
    toEmails: [],
    ccEmails: [],
    subject: "Hi",
    bodyExcerpt: null,
    attachments: [],
    receivedAt: new Date("2026-01-01T00:00:00Z"),
    labelIds: ["INBOX"],
    automatedHeaders: { listUnsubscribe: false, listId: false, autoSubmitted: null, precedence: null },
    ...overrides,
  };
}

describe("detectAutomatedThread", () => {
  it("flags a Google no-reply notification (sender signal, no List-* headers)", () => {
    const m = msg({ senderEmail: "google-maps-noreply@google.com", labelIds: ["INBOX"] });
    expect(isAutomatedMessage(m)).toBe(true);
    expect(detectAutomatedThread([m])).toBe(true);
  });

  it("flags a non-Google newsletter via List-Unsubscribe header", () => {
    const m = msg({
      senderEmail: "news@substack.com",
      automatedHeaders: { listUnsubscribe: true, listId: false, autoSubmitted: null, precedence: null },
    });
    expect(detectAutomatedThread([m])).toBe(true);
  });

  it("flags bulk via Precedence and Auto-Submitted headers", () => {
    expect(
      detectAutomatedThread([
        msg({ automatedHeaders: { listUnsubscribe: false, listId: false, autoSubmitted: null, precedence: "bulk" } }),
      ])
    ).toBe(true);
    expect(
      detectAutomatedThread([
        msg({ automatedHeaders: { listUnsubscribe: false, listId: false, autoSubmitted: "auto-generated", precedence: null } }),
      ])
    ).toBe(true);
  });

  it("flags Gmail bulk categories", () => {
    expect(detectAutomatedThread([msg({ labelIds: ["CATEGORY_UPDATES"] })])).toBe(true);
    expect(detectAutomatedThread([msg({ labelIds: ["CATEGORY_SOCIAL"] })])).toBe(true);
  });

  it("does NOT flag a genuine personal email", () => {
    expect(detectAutomatedThread([msg({ senderEmail: "bob@gmail.com", labelIds: ["INBOX", "UNREAD"] })])).toBe(false);
  });

  it("does NOT flag a thread with any human-authored message (every guard)", () => {
    const automated = msg({ senderEmail: "no-reply@service.com" });
    const human = msg({ senderEmail: "carol@gmail.com" });
    expect(detectAutomatedThread([automated, human])).toBe(false);
  });

  it("IMPORTANT does NOT veto a strong signal (no-reply sender or bulk headers)", () => {
    // Gmail's IMPORTANT auto-heuristic routinely flags bulk (e.g. Google's own
    // no-reply notifications); a machine-origin signal must override it.
    expect(
      detectAutomatedThread([msg({ senderEmail: "google-maps-noreply@google.com", labelIds: ["INBOX", "IMPORTANT"] })])
    ).toBe(true);
    expect(
      detectAutomatedThread([
        msg({
          senderEmail: "news@substack.com",
          labelIds: ["INBOX", "IMPORTANT"],
          automatedHeaders: { listUnsubscribe: true, listId: false, autoSubmitted: null, precedence: null },
        }),
      ])
    ).toBe(true);
  });

  it("IMPORTANT vetoes a weak (category-only) detection", () => {
    // Only a Gmail bulk category, no strong signal — IMPORTANT wins.
    expect(
      detectAutomatedThread([msg({ senderEmail: "person@gmail.com", labelIds: ["CATEGORY_UPDATES", "IMPORTANT"] })])
    ).toBe(false);
  });

  it("CATEGORY_PERSONAL vetoes a weak (category-only) detection", () => {
    // Default human sender, automated only via a Gmail bulk category — Primary wins.
    expect(
      detectAutomatedThread([msg({ labelIds: ["CATEGORY_UPDATES", "CATEGORY_PERSONAL"] })])
    ).toBe(false);
  });

  it("CATEGORY_PERSONAL does NOT veto a strong signal (no-reply sender)", () => {
    // Gmail files lots of transactional no-reply mail under Primary
    // (CATEGORY_PERSONAL); a machine-origin sender must still be auto-filed.
    expect(
      detectAutomatedThread([
        msg({ senderEmail: "no-reply@monidentifiant.sncf", labelIds: ["INBOX", "CATEGORY_PERSONAL"] }),
      ])
    ).toBe(true);
    // Even with both Primary and IMPORTANT set, a strong signal wins.
    expect(
      detectAutomatedThread([
        msg({
          senderEmail: "notifications@moonshot.money",
          labelIds: ["INBOX", "CATEGORY_PERSONAL", "IMPORTANT"],
        }),
      ])
    ).toBe(true);
  });

  it("CATEGORY_PERSONAL does NOT veto a strong HEADER signal (no no-reply sender)", () => {
    // The strong-signal override must not be sender-only: a human-named sender
    // carrying bulk headers (List-Unsubscribe, Precedence: bulk, Auto-Submitted)
    // is still machine-origin and must override Primary.
    expect(
      detectAutomatedThread([
        msg({
          senderEmail: "newsletter-team@brand.com",
          labelIds: ["INBOX", "CATEGORY_PERSONAL", "IMPORTANT"],
          automatedHeaders: { listUnsubscribe: true, listId: false, autoSubmitted: null, precedence: null },
        }),
      ])
    ).toBe(true);
  });

  it("CATEGORY_PERSONAL still vetoes a MIXED thread (not every message is strong)", () => {
    // The override requires EVERY message to be strongly automated. A no-reply
    // message alongside a merely category-automated one is not all-strong, so
    // Gmail's Primary hint still wins — we will not over-file a thread that
    // contains a message we cannot strongly attribute to a machine.
    const strong = msg({ providerMessageId: "m1", senderEmail: "no-reply@service.com", labelIds: ["INBOX"] });
    const weak = msg({ providerMessageId: "m2", senderEmail: "person@gmail.com", labelIds: ["CATEGORY_UPDATES", "CATEGORY_PERSONAL"] });
    expect(detectAutomatedThread([strong, weak])).toBe(false);
  });

  it("auto-files a mailer-daemon bounce in Primary once the owner's reply is excluded", () => {
    // Real-world bounce thread: the owner's original send + a mailer-daemon
    // bounce that Gmail filed under Primary and flagged IMPORTANT. Excluding the
    // owner leaves only the (strong) bounce, which must be detected.
    const ownSend = msg({ providerMessageId: "m1", senderEmail: "owner@gmail.com", labelIds: ["SENT"] });
    const bounce = msg({
      providerMessageId: "m2",
      senderEmail: "mailer-daemon@googlemail.com",
      labelIds: ["INBOX", "CATEGORY_PERSONAL", "IMPORTANT"],
    });
    expect(detectAutomatedThread([ownSend, bounce], "owner@gmail.com")).toBe(true);
  });

  it("is not automated for an empty thread", () => {
    expect(detectAutomatedThread([])).toBe(false);
  });

  it("does not false-positive on a 'reply@' style address", () => {
    expect(isAutomatedMessage(msg({ senderEmail: "reply@person.com" }))).toBe(false);
  });

  it("ignores the owner's own reply to a no-reply notification (selfEmail)", () => {
    const notification = msg({ providerMessageId: "m1", senderEmail: "no-reply@service.com" });
    const ownReply = msg({ providerMessageId: "m2", senderEmail: "owner@gmail.com" });
    // Without selfEmail the human reply defeats the every-message guard.
    expect(detectAutomatedThread([notification, ownReply])).toBe(false);
    // With selfEmail the owner's reply is excluded, so the thread is automated.
    expect(detectAutomatedThread([notification, ownReply], "owner@gmail.com")).toBe(true);
  });

  it("matches selfEmail case-insensitively", () => {
    const notification = msg({ providerMessageId: "m1", senderEmail: "no-reply@service.com" });
    const ownReply = msg({ providerMessageId: "m2", senderEmail: "Owner@Gmail.com" });
    expect(detectAutomatedThread([notification, ownReply], "owner@gmail.com")).toBe(true);
  });

  it("is not automated when only the owner's own messages remain", () => {
    const ownOnly = msg({ senderEmail: "owner@gmail.com" });
    expect(detectAutomatedThread([ownOnly], "owner@gmail.com")).toBe(false);
  });

  it("does NOT flag a genuine two-person thread even with selfEmail", () => {
    const alice = msg({ providerMessageId: "m1", senderEmail: "alice@gmail.com" });
    const ownReply = msg({ providerMessageId: "m2", senderEmail: "owner@gmail.com" });
    // Excluding the owner must not turn a real correspondent into automated mail.
    expect(detectAutomatedThread([alice, ownReply], "owner@gmail.com")).toBe(false);
  });
});

// Real no-reply / notification senders observed unfiled in production because
// Gmail had placed them under Primary (CATEGORY_PERSONAL) and/or flagged them
// IMPORTANT. Each must be detected as automated so it auto-files to catch-all.
// Worst-case placement (Primary + IMPORTANT) is asserted so a regression in the
// strong-signal override is caught regardless of how Gmail categorises them.
const REAL_NO_REPLY_SENDERS = [
  "mailer-daemon@googlemail.com",
  "no-reply@bestunion.com",
  "no-reply@glovoapp.com",
  "noreply-maps+8d032a7a@google.com",
  "no-reply@modemobile.com",
  "no-reply@monidentifiant.sncf",
  "noreply@starboost.biz",
  "notifications@moonshot.money",
];

describe("detectAutomatedThread — real-world no-reply senders in Primary", () => {
  it.each(REAL_NO_REPLY_SENDERS)(
    "auto-detects %s even when filed under Primary + IMPORTANT",
    (senderEmail) => {
      expect(senderIsNoReply(senderEmail)).toBe(true);
      expect(
        detectAutomatedThread([msg({ senderEmail, labelIds: ["INBOX", "CATEGORY_PERSONAL", "IMPORTANT"] })])
      ).toBe(true);
    }
  );
});

// Transactional automated mail that is NOT bulk: OTP / verification codes and
// unsubscribe confirmations. These carry no List-* headers, often come from a
// sender the no-reply localpart misses, and Gmail files them under Primary and
// flags them IMPORTANT. They must still auto-file to catch-all, driven purely by
// the templated subject.
describe("detectAutomatedThread — transactional subjects (OTP / unsubscribe)", () => {
  it("flags an OTP from a non-no-reply sender filed in Primary + IMPORTANT", () => {
    const m = msg({
      senderEmail: "security@github.com",
      subject: "Your verification code is 314159",
      labelIds: ["INBOX", "CATEGORY_PERSONAL", "IMPORTANT"],
    });
    expect(isAutomatedMessage(m)).toBe(true);
    expect(detectAutomatedThread([m])).toBe(true);
  });

  it("flags an unsubscribe confirmation from a non-no-reply sender in Primary", () => {
    const m = msg({
      senderEmail: "hello@brand.com",
      subject: "You've been unsubscribed",
      labelIds: ["INBOX", "CATEGORY_PERSONAL"],
    });
    expect(detectAutomatedThread([m])).toBe(true);
  });

  const TRANSACTIONAL_SUBJECTS = [
    "Your verification code",
    "123456 is your security code",
    "Your one-time passcode",
    "Use this OTP to sign in",
    "Verify your email to continue",
    "Two-factor authentication code",
    "You have been unsubscribed",
    "You've successfully unsubscribed from our list",
    "Unsubscribe confirmation",
    "Your email preferences updated",
  ];
  it.each(TRANSACTIONAL_SUBJECTS)("matches transactional subject %j", (subject) => {
    expect(subjectIsTransactionalAuto(subject)).toBe(true);
  });

  const HUMAN_SUBJECTS = [
    "Hi",
    "Can you review my code?",
    "Re: lunch tomorrow",
    "Unsubscribe link is at the bottom", // live marketing mentions unsubscribe
    "Notes from the 1:1",
    "Quick question about the access list",
  ];
  it.each(HUMAN_SUBJECTS)("does NOT match human subject %j", (subject) => {
    expect(subjectIsTransactionalAuto(subject)).toBe(false);
  });

  it("returns false for a null/empty subject", () => {
    expect(subjectIsTransactionalAuto(null)).toBe(false);
    expect(subjectIsTransactionalAuto("")).toBe(false);
  });

  const MORE_TRANSACTIONAL_SUBJECTS = [
    // Shipping / delivery status.
    "Your order has shipped",
    "Out for delivery: your package arrives today",
    "Your package was delivered",
    "Shipping confirmation for order #5521",
    "Your parcel is on its way",
    // Receipts / order & payment confirmations.
    "Your receipt from Acme Coffee",
    "Receipt for your purchase",
    "Order confirmation #9087",
    "Payment received - thank you",
    "Thanks for your order",
    // Routine sign-in / new-device alerts.
    "New sign-in to your account",
    "New login from Chrome on macOS",
    "You signed in to your Google Account",
    // Document / statement ready (availability).
    "Your statement is ready",
    "Your tax document is now available",
    "Your monthly report is available to view",
    // Calendar event notifications.
    "Invitation: Team sync @ Mon 10am",
    "Accepted: Lunch with Sam",
    "Declined: Budget review",
    "Updated invitation: Sprint planning",
    "Canceled event: 1:1",
  ];
  it.each(MORE_TRANSACTIONAL_SUBJECTS)("matches transactional subject %j", (subject) => {
    expect(subjectIsTransactionalAuto(subject)).toBe(true);
  });

  // The action-required veto: even though these brush against transactional
  // templates, the email itself is the action trigger, so it must NOT auto-file.
  const ACTION_REQUIRED_SUBJECTS = [
    "Action required: confirm your details",
    "Your payment failed",
    "Payment declined - please update your card",
    "Your invoice is overdue",
    "Update your payment method",
    "Your card is expiring soon",
    "Delivery failed - action needed",
    "Problem with your order",
    "Suspicious sign-in to your account",
    "Unusual login attempt detected",
    "Your password was changed",
    "Was this you? Verify it was you",
    "Secure your account now",
  ];
  it.each(ACTION_REQUIRED_SUBJECTS)("vetoes action-required subject %j", (subject) => {
    expect(subjectIsTransactionalAuto(subject)).toBe(false);
  });

  it("vetoes a sign-in subject that also reads as suspicious", () => {
    // Matches the routine sign-in pattern AND the suspicious veto — veto wins.
    const m = msg({
      senderEmail: "no-reply@accounts.google.com",
      subject: "New sign-in flagged as suspicious",
      labelIds: ["INBOX", "CATEGORY_PERSONAL", "IMPORTANT"],
    });
    // Still strongly automated via the no-reply sender, so the THREAD files anyway;
    // the point is the SUBJECT signal itself must not fire.
    expect(subjectIsTransactionalAuto("New sign-in flagged as suspicious")).toBe(false);
    expect(detectAutomatedThread([m])).toBe(true);
  });

  it("does NOT auto-file an action-required alert from a non-no-reply sender", () => {
    // No strong sender/header signal and the subject is vetoed, so it reaches triage.
    const m = msg({
      senderEmail: "billing@vendor.com",
      subject: "Your payment failed - update your card",
      labelIds: ["INBOX", "CATEGORY_PERSONAL", "IMPORTANT"],
    });
    expect(detectAutomatedThread([m])).toBe(false);
  });

  it("auto-files a shipping update from a non-no-reply sender in Primary", () => {
    const m = msg({
      senderEmail: "orders@shop.com",
      subject: "Your order has shipped",
      labelIds: ["INBOX", "CATEGORY_PERSONAL", "IMPORTANT"],
    });
    expect(detectAutomatedThread([m])).toBe(true);
  });

  it("still respects the every-message guard with a human reply present", () => {
    const otp = msg({ providerMessageId: "m1", senderEmail: "security@github.com", subject: "Your verification code is 314159" });
    const human = msg({ providerMessageId: "m2", senderEmail: "carol@gmail.com", subject: "thanks!" });
    expect(detectAutomatedThread([otp, human])).toBe(false);
  });
});

// Language-agnostic signals must fire regardless of which locales are populated.
describe("subjectIsTransactionalAuto — language-agnostic", () => {
  it("matches a subject that is only a 5-8 digit code", () => {
    expect(subjectIsTransactionalAuto("845102")).toBe(true);
    expect(subjectIsTransactionalAuto("  93020114 ")).toBe(true);
  });

  it("does NOT match a bare 4-digit year", () => {
    expect(subjectIsTransactionalAuto("2024")).toBe(false);
  });

  it("matches 'NNNNNN ... code' across Latin-script locales (shared loanword)", () => {
    expect(subjectIsTransactionalAuto("314159 is your code")).toBe(true);
    expect(subjectIsTransactionalAuto("314159 est votre code")).toBe(true);
  });
});

// French is a verified locale (positives + veto reviewed). The matcher tests the
// UNION of all locales unconditionally, so French mail is detected for any user.
describe("subjectIsTransactionalAuto — French (fr)", () => {
  const FR_TRANSACTIONAL = [
    "Votre code de vérification",
    "Code de sécurité pour votre connexion",
    "Votre code d'accès à usage unique",
    "Vérifiez votre adresse e-mail",
    "Vous avez été désabonné de notre liste",
    "Désabonnement confirmé",
    "Votre commande a été expédiée",
    "Votre colis est en cours de livraison",
    "Confirmation d'expédition",
    "Suivi de votre commande",
    "Votre reçu",
    "Confirmation de commande",
    "Paiement reçu",
    "Merci pour votre commande",
    "Nouvelle connexion à votre compte",
    "Connexion à votre compte depuis un nouvel appareil",
    "Votre relevé est disponible",
    "Votre relevé mensuel est maintenant disponible",
    "Invitation : Réunion d'équipe",
    "Acceptée : Déjeuner",
    "Événement annulé : point hebdo",
  ];
  it.each(FR_TRANSACTIONAL)("matches French transactional subject %j", (subject) => {
    expect(subjectIsTransactionalAuto(subject)).toBe(true);
  });

  const FR_ACTION_REQUIRED = [
    "Action requise : confirmez vos informations",
    "Votre paiement a échoué",
    "Paiement refusé, mettez à jour votre carte",
    "Votre facture est en retard",
    "Mettez à jour votre moyen de paiement",
    "Votre carte expire bientôt",
    "Échec de livraison de votre colis",
    "Problème avec votre commande",
    "Connexion suspecte détectée",
    "Tentative de connexion inhabituelle",
    "Votre mot de passe a été modifié",
    "Était-ce vous ?",
    "Sécurisez votre compte",
  ];
  it.each(FR_ACTION_REQUIRED)("vetoes French action-required subject %j", (subject) => {
    expect(subjectIsTransactionalAuto(subject)).toBe(false);
  });

  const FR_HUMAN = [
    "Salut, on déjeune demain ?",
    "Peux-tu relire mon document ?",
    "Re: la réunion de lundi",
    "Question rapide sur le projet",
  ];
  it.each(FR_HUMAN)("does NOT match French human subject %j", (subject) => {
    expect(subjectIsTransactionalAuto(subject)).toBe(false);
  });

  it("auto-files a French OTP from a non-no-reply sender in Primary + IMPORTANT", () => {
    const m = msg({
      senderEmail: "securite@sncf.fr",
      subject: "Votre code de vérification est 314159",
      labelIds: ["INBOX", "CATEGORY_PERSONAL", "IMPORTANT"],
    });
    expect(detectAutomatedThread([m])).toBe(true);
  });

  it("does NOT auto-file a French action-required alert from a non-no-reply sender", () => {
    const m = msg({
      senderEmail: "facturation@vendeur.fr",
      subject: "Votre paiement a échoué",
      labelIds: ["INBOX", "CATEGORY_PERSONAL", "IMPORTANT"],
    });
    expect(detectAutomatedThread([m])).toBe(false);
  });
});

// Tier-A locales (es, de, it, pt-BR). Each has verified positives + veto. Spot
// checks per language: a few positives, a few action-required vetoes, a couple of
// human negatives, and one end-to-end thread case in Primary + IMPORTANT.
describe.each([
  {
    lang: "Spanish (es)",
    positive: [
      "Tu código de verificación",
      "Código de seguridad para tu cuenta",
      "Tu pedido ha sido enviado",
      "Confirmación de envío",
      "Tu recibo",
      "Pago recibido",
      "Gracias por tu compra",
      "Nuevo inicio de sesión en tu cuenta",
      "Tu extracto está disponible",
      "Invitación: Reunión de equipo",
    ],
    veto: [
      "Acción requerida",
      "Tu pago ha fallado",
      "Tu factura está vencida",
      "Actualiza tu método de pago",
      "Entrega fallida de tu paquete",
      "Inicio de sesión sospechoso",
      "Tu contraseña ha sido cambiada",
    ],
    human: ["Hola, ¿comemos mañana?", "¿Puedes revisar mi documento?"],
    otp: { sender: "seguridad@banco.es", subject: "Tu código de verificación es 314159" },
    alert: { sender: "facturacion@tienda.es", subject: "Tu pago ha fallado" },
  },
  {
    lang: "German (de)",
    positive: [
      "Ihr Bestätigungscode",
      "Sicherheitscode für Ihre Anmeldung",
      "Ihre Bestellung wurde versandt",
      "Versandbestätigung",
      "Ihre Quittung",
      "Zahlung erhalten",
      "Vielen Dank für Ihre Bestellung",
      "Neue Anmeldung",
      "Ihr Kontoauszug ist verfügbar",
      "Einladung: Team-Meeting",
    ],
    veto: [
      "Aktion erforderlich",
      "Ihre Zahlung ist fehlgeschlagen",
      "Ihre Rechnung ist überfällig",
      "Aktualisieren Sie Ihre Zahlungsmethode",
      "Lieferung fehlgeschlagen",
      "Verdächtige Anmeldung erkannt",
      "Ihr Passwort wurde geändert",
    ],
    human: ["Hallo, Mittagessen morgen?", "Kannst du mein Dokument prüfen?"],
    otp: { sender: "sicherheit@bank.de", subject: "Ihr Bestätigungscode lautet 314159" },
    alert: { sender: "rechnung@shop.de", subject: "Ihre Zahlung ist fehlgeschlagen" },
  },
  {
    lang: "Italian (it)",
    positive: [
      "Il tuo codice di verifica",
      "Codice di sicurezza per il tuo accesso",
      "Il tuo ordine è stato spedito",
      "Conferma di spedizione",
      "La tua ricevuta",
      "Pagamento ricevuto",
      "Grazie per il tuo ordine",
      "Nuovo accesso",
      "Il tuo estratto conto è disponibile",
      "Invito: Riunione del team",
    ],
    veto: [
      "Azione richiesta",
      "Il tuo pagamento è fallito",
      "La tua fattura è scaduta",
      "Aggiorna il tuo metodo di pagamento",
      "Consegna fallita",
      "Accesso sospetto rilevato",
      "La tua password è stata modificata",
    ],
    human: ["Ciao, pranziamo domani?", "Puoi rivedere il mio documento?"],
    otp: { sender: "sicurezza@banca.it", subject: "Il tuo codice di verifica è 314159" },
    alert: { sender: "fatturazione@negozio.it", subject: "Il tuo pagamento è fallito" },
  },
  {
    lang: "Portuguese (pt-BR)",
    positive: [
      "Seu código de verificação",
      "Código de segurança para sua conta",
      "Seu pedido foi enviado",
      "Confirmação de envio",
      "Seu recibo",
      "Pagamento recebido",
      "Obrigado pela sua compra",
      "Novo login",
      "Seu extrato está disponível",
      "Convite: Reunião de equipe",
    ],
    veto: [
      "Ação necessária",
      "Seu pagamento falhou",
      "Sua fatura está vencida",
      "Atualize sua forma de pagamento",
      "Entrega falhou",
      "Login suspeito detectado",
      "Sua senha foi alterada",
    ],
    human: ["Oi, almoçamos amanhã?", "Você pode revisar meu documento?"],
    otp: { sender: "seguranca@banco.com.br", subject: "Seu código de verificação é 314159" },
    alert: { sender: "faturamento@loja.com.br", subject: "Seu pagamento falhou" },
  },
])("subjectIsTransactionalAuto — $lang", ({ positive, veto, human, otp, alert }) => {
  it.each(positive)("matches transactional subject %j", (s) => {
    expect(subjectIsTransactionalAuto(s)).toBe(true);
  });
  it.each(veto)("vetoes action-required subject %j", (s) => {
    expect(subjectIsTransactionalAuto(s)).toBe(false);
  });
  it.each(human)("does NOT match human subject %j", (s) => {
    expect(subjectIsTransactionalAuto(s)).toBe(false);
  });
  it("auto-files an OTP from a non-no-reply sender in Primary + IMPORTANT", () => {
    const m = msg({ senderEmail: otp.sender, subject: otp.subject, labelIds: ["INBOX", "CATEGORY_PERSONAL", "IMPORTANT"] });
    expect(detectAutomatedThread([m])).toBe(true);
  });
  it("does NOT auto-file an action-required alert from a non-no-reply sender", () => {
    const m = msg({ senderEmail: alert.sender, subject: alert.subject, labelIds: ["INBOX", "CATEGORY_PERSONAL", "IMPORTANT"] });
    expect(detectAutomatedThread([m])).toBe(false);
  });
});

describe("senderIsNoReply", () => {
  it("matches no-reply and notification local parts across domains", () => {
    expect(senderIsNoReply("no-reply@accounts.google.com")).toBe(true);
    expect(senderIsNoReply("noreply@crunchyroll.com")).toBe(true);
    expect(senderIsNoReply("notifications@service.com")).toBe(true);
    expect(senderIsNoReply("google-maps-noreply@google.com")).toBe(true);
  });

  it("does not match a human or a 'reply@' style address", () => {
    expect(senderIsNoReply("bob@gmail.com")).toBe(false);
    expect(senderIsNoReply("reply@person.com")).toBe(false);
  });
});

