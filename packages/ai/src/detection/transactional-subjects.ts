/**
 * Multilingual subject matcher for TRANSACTIONAL automated mail that is NOT bulk:
 * one-time codes, unsubscribe confirmations, shipping status, receipts, routine
 * sign-in alerts, document-ready notices, and calendar notifications. Such mail
 * carries no List-* headers (it is not list mail), frequently comes from a sender
 * the no-reply localpart misses (`security@`, `verify@`, `id@apple.com`), and
 * Gmail files it under Primary (CATEGORY_PERSONAL) and often flags it IMPORTANT —
 * so the header/sender/category signals all miss it. The subject is the stable
 * invariant for these classes, so we match on it.
 *
 * ── Why this is NOT a Lingui job ──────────────────────────────────────────────
 * Lingui localizes OUTGOING strings into the *user's* UI locale. These patterns
 * match INBOUND subjects, whose language is the *sender's*, not the user's. One
 * inbox is multilingual (an OTP from GitHub in English, one from SNCF in French),
 * so there is no single active locale to compile against: the matcher must test
 * the UNION of all supported languages at once, unconditionally. Hence a hand-
 * maintained per-language registry, not a compiled catalog.
 *
 * ── Discipline ────────────────────────────────────────────────────────────────
 * A class qualifies only when (1) a human mailbox effectively never produces it,
 * (2) the email itself triggers no durable action — any action happens at the
 * source app, not by acting on the mail — and (3) the subject is templated.
 * Patterns stay tight, in keeping with the module's "rather under-detect than
 * mis-file genuine mail" stance. A positive match is treated as a STRONG signal
 * by the caller, so it overrides Gmail's Primary / IMPORTANT vetoes.
 *
 * ── Adding a language ─────────────────────────────────────────────────────────
 * Only add a language someone on the team can QA. The `actionRequired` veto is
 * safety-critical: a missed veto auto-files a "payment failed" / "suspicious
 * sign-in" into the catch-all, hiding mail the user must act on — so the veto is
 * held to a higher bar than the positives. A language with verified positives but
 * an unverified veto should ship NEITHER (omit it) rather than run a veto we
 * cannot read. CJK/Thai (ja, ko, zh-CN, th) are deliberately absent: these
 * `\b`-anchored patterns do not work without whitespace word boundaries and need
 * a script-aware matcher first. The subject is lowercased before matching, so
 * patterns are authored lowercase and accents are matched directly (É → é).
 */

type SubjectRules = {
  /** Templated subjects that mark transactional automated mail. */
  positive: RegExp[];
  /** Subjects where the email itself is the action trigger; these VETO a positive match. */
  actionRequired: RegExp[];
};

/**
 * Signals that do not depend on language at all. Kept separate so they apply to
 * every inbox regardless of which locales are populated below.
 */
const LANGUAGE_AGNOSTIC: SubjectRules = {
  positive: [
    // A subject that is ONLY a 5-8 digit code is almost always an OTP. 4 digits
    // is excluded: a bare year ("2024") would false-positive.
    /^\s*\d{5,8}\s*$/,
    // "123456 is your code" / "123456 est votre code" — the loanword "code" is
    // shared across most Latin-script locales, so this is effectively agnostic.
    /\b\d{4,8}\b[^\n]*\bcode\b/i,
  ],
  actionRequired: [],
};

const EN: SubjectRules = {
  positive: [
    // ── One-time verification / security / login codes ──
    /\b(verification|security|login|access|auth(?:entication)?|one[- ]?time)\s+codes?\b/i,
    /\b(one[- ]?time\s+(?:passcode|password|pin)|otp|passcode|2fa|two[- ]?factor)\b/i,
    /\bverify your (?:email|account|identity|sign[- ]?in)\b/i,
    // ── Unsubscribe confirmations (NOT a bare "unsubscribe" — that appears in live marketing) ──
    /you('?ve| have)\s+(?:been\s+)?unsubscrib/i,
    /successfully\s+unsubscrib/i,
    /unsubscrib\w*\s+(?:confirmed|successful|confirmation)/i,
    /(?:email|subscription)\s+preferences\s+(?:updated|saved)/i,
    // ── Shipping / delivery status (pure status, action at the source) ──
    /\bout for delivery\b/i,
    /\b(?:your|the)\s+(?:order|package|parcel|shipment|item|delivery)\b[^\n]*\b(?:shipped|dispatched|delivered|on its way|on the way)\b/i,
    /\b(?:shipping|delivery|tracking|dispatch)\s+(?:confirmation|update|notification)\b/i,
    /\b(?:has|have|been)\s+shipped\b/i,
    // ── Receipts / order & payment confirmations (completed transactions) ──
    /\byour receipt\b/i,
    /\breceipt (?:from|for|#)/i,
    /\border confirmation\b/i,
    /\border\s+#?\w+\s+(?:confirmed|placed)\b/i,
    /\bpayment (?:received|confirmed|successful)\b/i,
    /\bthank(?:s| you) for your (?:order|purchase|payment)\b/i,
    // ── Account sign-in / new-device alerts (routine only; compromise vetoed below) ──
    /\bnew (?:sign[- ]?in|login)\b/i,
    /\b(?:signed|logged) in to your\b/i,
    /\bnew device\b[^\n]*\b(?:sign(?:ed)?[- ]?in|log(?:ged)?[- ]?in|access)/i,
    // ── "Document/statement ready" availability (informational; payment demands vetoed below) ──
    /\byour (?:\w+\s+){0,2}(?:statement|tax document|document|report)\b[^\n]*\b(?:is ready|is available|now available|ready to view|available to view)\b/i,
    // ── Calendar event notifications (Google Calendar templated subject prefixes) ──
    /^(?:invitation|accepted|declined|tentative|updated invitation|updated event|canceled event|cancelled event):/i,
  ],
  actionRequired: [
    /\b(?:action required|action needed|requires? your (?:action|attention))\b/i,
    /\b(?:payment|invoice|bill|card|subscription)\b[^\n]*\b(?:failed|declined|due|overdue|past due|unpaid|outstanding|expir(?:ed|ing)|problem)\b/i,
    /\b(?:failed|declined|overdue|past due|unpaid|expir(?:ed|ing))\b[^\n]*\b(?:payment|invoice|bill|card|subscription)\b/i,
    /\bupdate your (?:payment|billing|card|subscription)\b/i,
    /\b(?:delivery|shipment|package|order)\b[^\n]*\b(?:failed|delayed|on hold|problem|issue|unsuccessful|could ?n'?t be|reschedul)\b/i,
    /\b(?:suspicious|unusual|unauthori[sz]ed|unrecognized)\b/i,
    /\bpassword (?:was |has been )?(?:changed|reset)\b/i,
    /\b(?:verify (?:it was|that it was) you|secure your account|was this you)\b/i,
  ],
};

/**
 * `\b` in JS is ASCII-only: it does not register a boundary next to an accented
 * letter (é, è, à…), so `\b` after "sécurité" or before "échec" silently fails.
 * For accented locales we compile patterns with Unicode-aware boundaries: write
 * `\b` in the source string and it is rewritten to a `\p{L}`/`\p{N}` boundary.
 * Compiled with the `u` flag (required by `\p{…}`); input is already lowercased.
 */
const UNICODE_WORD = "[\\p{L}\\p{N}_]";
const UNICODE_BOUNDARY = `(?:(?<!${UNICODE_WORD})(?=${UNICODE_WORD})|(?<=${UNICODE_WORD})(?!${UNICODE_WORD}))`;
function accented(src: string): RegExp {
  return new RegExp(src.split("\\b").join(UNICODE_BOUNDARY), "u");
}

const FR: SubjectRules = {
  positive: [
    // ── Codes de vérification / sécurité / connexion à usage unique ──
    accented("\\bcode (?:de (?:vérification|sécurité|connexion|confirmation)|d['’](?:accès|authentification|activation)|à usage unique|confidentiel)\\b"),
    accented("\\b(?:mot de passe à usage unique|code otp)\\b"),
    accented("\\bvérifiez votre (?:adresse (?:e-?mail|courriel)|e-?mail|courriel|compte|identité)\\b"),
    // ── Confirmations de désabonnement ──
    accented("\\bvous (?:êtes|avez été)\\b[^\\n]*\\bdésabonné"),
    accented("\\bdésabonnement (?:confirmé|réussi)\\b"),
    accented("\\bdésinscription (?:confirmée|réussie)\\b"),
    // ── Statut d'expédition / livraison ──
    accented("\\ben cours de livraison\\b"),
    accented("\\b(?:votre|la)\\s+(?:commande|colis|paquet|envoi|article|livraison)\\b[^\\n]*\\b(?:expédiée?s?|expédié|livrée?s?|en route)\\b"),
    accented("\\bconfirmation d['’]expédition\\b"),
    accented("\\bsuivi de\\b[^\\n]*\\b(?:commande|colis|livraison|expédition)\\b"),
    accented("\\b(?:a été|été)\\s+(?:expédiée?|livrée?)\\b"),
    // ── Reçus / confirmations de commande & paiement ──
    accented("\\bvotre reçu\\b"),
    accented("\\breçu (?:de|pour|n[°o])"),
    accented("\\bconfirmation de (?:commande|paiement)\\b"),
    accented("\\bcommande (?:confirmée|enregistrée)\\b"),
    accented("\\bpaiement (?:reçu|confirmé|accepté)\\b"),
    accented("\\bmerci pour votre (?:commande|achat|paiement|réservation)\\b"),
    // ── Alertes de connexion / nouvel appareil (routine ; compromission vétoée) ──
    accented("\\bnouvelle connexion\\b"),
    accented("\\bconnexion à votre compte\\b"),
    accented("\\bnouvel appareil\\b"),
    // ── Document / relevé disponible (informationnel ; facture/demande de paiement exclue) ──
    accented("\\bvotre (?:\\S+\\s+){0,2}(?:relevé|document|rapport|attestation)\\b[^\\n]*\\b(?:est (?:disponible|prêt|prête)|maintenant disponible|disponible)\\b"),
    // ── Notifications d'agenda (préfixes Google Agenda localisés) ──
    accented("^(?:invitation|acceptée?|refusée?|provisoire|invitation mise à jour|événement (?:annulé|mis à jour))\\s*:"),
  ],
  actionRequired: [
    accented("\\baction (?:requise|nécessaire|à effectuer)\\b"),
    accented("\\b(?:paiement|facture|carte|abonnement|prélèvement)\\b[^\\n]*\\b(?:échouée?|échoué|refusée?|impayée?|en retard|en souffrance|expirée?|expire|problème|rejeté)\\b"),
    accented("\\b(?:échouée?|échoué|refusée?|impayée?|expirée?|rejeté)\\b[^\\n]*\\b(?:paiement|facture|carte|abonnement)\\b"),
    accented("\\bmett(?:ez|re) à jour (?:votre|vos)\\s+(?:paiement|carte|moyen de paiement|coordonnées bancaires|abonnement)\\b"),
    accented("\\b(?:livraison|colis|commande|envoi)\\b[^\\n]*\\b(?:échouée?|échec|retardée?|problème|incident|impossible)\\b"),
    accented("\\béchec (?:de|d['’])\\s*(?:livraison|paiement|connexion)\\b"),
    accented("\\b(?:suspecte?|inhabituelle?|non autorisée?|non reconnue?)\\b"),
    accented("\\bmot de passe (?:a été )?(?:modifié|réinitialisé|changé)\\b"),
    accented("\\b(?:était-ce vous|sécurisez votre compte|confirmez que c['’]est vous)\\b"),
  ],
};

const ES: SubjectRules = {
  positive: [
    // ── Códigos de verificación / seguridad / acceso de un solo uso ──
    accented("\\bcódigo de (?:verificación|seguridad|acceso|confirmación|inicio de sesión|un solo uso|autenticación)\\b"),
    accented("\\b(?:contraseña de un solo uso|código otp)\\b"),
    accented("\\bverific[ae] (?:tu|su) (?:correo(?: electrónico)?|cuenta|identidad)\\b"),
    // ── Confirmaciones de baja ──
    accented("\\bte has dado de baja\\b"),
    accented("\\bcancelación de (?:la )?suscripción\\b"),
    accented("\\bsuscripción cancelada\\b"),
    // ── Estado de envío / entrega ──
    accented("\\b(?:tu|su)\\s+(?:pedido|paquete|envío|artículo|compra)\\b[^\\n]*\\b(?:enviad[oa]s?|despachad[oa]s?|entregad[oa]s?|en camino|en reparto)\\b"),
    accented("\\ben (?:camino|reparto)\\b"),
    accented("\\bconfirmación de envío\\b"),
    accented("\\bseguimiento de (?:tu|su)\\s+(?:pedido|paquete|envío)\\b"),
    accented("\\bha sido (?:enviad[oa]|entregad[oa])\\b"),
    // ── Recibos / confirmaciones de pedido y pago ──
    accented("\\b(?:tu|su) recibo\\b"),
    accented("\\brecibo (?:de|por|n[°o]|#)"),
    accented("\\bconfirmación de (?:pedido|pago|compra)\\b"),
    accented("\\bpedido confirmado\\b"),
    accented("\\bpago (?:recibido|confirmado|realizado|aceptado)\\b"),
    accented("\\bgracias por (?:tu|su) (?:pedido|compra|pago|reserva)\\b"),
    // ── Inicio de sesión / nuevo dispositivo (rutina; el compromiso se veta) ──
    accented("\\bnuevo inicio de sesión\\b"),
    accented("\\binicio de sesión en (?:tu|su) cuenta\\b"),
    accented("\\bnuevo dispositivo\\b"),
    // ── Documento / extracto disponible (informativo; factura excluida) ──
    accented("\\b(?:tu|su) (?:\\S+\\s+){0,2}(?:estado de cuenta|extracto|documento|informe)\\b[^\\n]*\\b(?:está (?:disponible|list[oa])|ya disponible|disponible)\\b"),
    // ── Notificaciones de calendario (prefijos de Google Calendar) ──
    accented("^(?:invitación|aceptad[ao]|rechazad[ao]|provisional|invitación actualizada|evento (?:cancelado|actualizado))\\s*:"),
  ],
  actionRequired: [
    accented("\\b(?:acción requerida|se requiere (?:tu|su) (?:acción|atención)|requiere (?:tu|su) (?:acción|atención))\\b"),
    accented("\\b(?:pago|factura|tarjeta|suscripción|cargo)\\b[^\\n]*\\b(?:fallid[oa]|falló|rechazad[oa]|vencid[oa]|atrasad[oa]|pendiente|caducad[oa]|caduca|vence|problema)\\b"),
    accented("\\b(?:fallid[oa]|falló|rechazad[oa]|vencid[oa]|caducad[oa])\\b[^\\n]*\\b(?:pago|factura|tarjeta|suscripción)\\b"),
    accented("\\bactualiza (?:tu|su)\\s+(?:pago|tarjeta|método de pago|datos de pago|suscripción)\\b"),
    accented("\\b(?:entrega|envío|paquete|pedido)\\b[^\\n]*\\b(?:fallid[oa]|falló|fallo|retrasad[oa]|problema|incidencia|no se pudo)\\b"),
    accented("\\b(?:actividad|inicio de sesión|acceso)\\s+(?:sospechos[ao]|inusual|no autorizad[oa]|no reconocid[oa])\\b"),
    accented("\\bcontraseña (?:cambiada|restablecida|modificada)\\b"),
    accented("\\b(?:fuiste tú|protege tu cuenta|asegura tu cuenta)\\b"),
  ],
};

const DE: SubjectRules = {
  positive: [
    // ── Verifizierungs- / Sicherheits- / Einmalcodes (Komposita) ──
    accented("\\b(?:bestätigungs|verifizierungs|sicherheits|anmelde|zugangs|einmal)code\\b"),
    accented("\\b(?:einmalpasswort|otp-code)\\b"),
    accented("\\b(?:verifizieren|bestätigen) sie ihre (?:e-?mail(?:-adresse)?|konto|identität)\\b"),
    accented("\\b(?:bestätige|verifiziere) deine (?:e-?mail(?:-adresse)?|konto|identität)\\b"),
    // ── Abmelde-/Abbestell-Bestätigungen ──
    accented("\\bsie haben sich (?:erfolgreich )?abgemeldet\\b"),
    accented("\\b(?:abmeldung|abbestellung) (?:bestätigt|erfolgreich)\\b"),
    accented("\\bnewsletter abbestellt\\b"),
    // ── Versand- / Lieferstatus ──
    accented("\\b(?:ihre|deine)\\s+(?:bestellung|sendung|paket|lieferung|ware)\\b[^\\n]*\\b(?:versandt|versendet|verschickt|zugestellt|unterwegs|geliefert)\\b"),
    accented("\\bversandbestätigung\\b"),
    accented("\\bsendungsverfolgung\\b"),
    accented("\\b(?:wurde|ist)\\s+(?:versandt|versendet|verschickt|zugestellt|geliefert)\\b"),
    // ── Quittungen / Bestell- & Zahlungsbestätigungen ──
    accented("\\b(?:ihre|deine) (?:quittung|kassenbon)\\b"),
    accented("\\b(?:bestellbestätigung|zahlungsbestätigung)\\b"),
    accented("\\bzahlung (?:erhalten|bestätigt|erfolgreich)\\b"),
    accented("\\b(?:vielen dank|danke) für (?:ihre|deine) (?:bestellung|zahlung)\\b"),
    // ── Anmeldung / neues Gerät (Routine; Kompromittierung wird vetoiert) ──
    accented("\\bneue anmeldung\\b"),
    accented("\\banmeldung (?:bei|in) (?:ihrem|deinem) konto\\b"),
    accented("\\bneues gerät\\b"),
    // ── Dokument / Kontoauszug verfügbar (informativ; Rechnung ausgeschlossen) ──
    accented("\\b(?:ihr|dein) (?:\\S+\\s+){0,2}(?:kontoauszug|auszug|dokument|bericht)\\b[^\\n]*\\b(?:ist (?:verfügbar|bereit)|jetzt verfügbar|steht (?:bereit|zur verfügung))\\b"),
    // ── Kalenderbenachrichtigungen (Google-Kalender-Präfixe) ──
    accented("^(?:einladung|zusage|zugesagt|absage|abgelehnt|aktualisierte einladung|abgesagter termin|terminänderung)\\s*:"),
  ],
  actionRequired: [
    accented("\\b(?:aktion erforderlich|handlung erforderlich)\\b"),
    accented("\\b(?:zahlung|rechnung|karte|abonnement|lastschrift)\\b[^\\n]*\\b(?:fehlgeschlagen|abgelehnt|fällig|überfällig|offen|unbezahlt|abgelaufen|läuft ab|problem)\\b"),
    accented("\\b(?:fehlgeschlagen|abgelehnt|überfällig|abgelaufen)\\b[^\\n]*\\b(?:zahlung|rechnung|karte|abonnement)\\b"),
    accented("\\b(?:aktualisieren sie|aktualisiere) (?:ihre|deine)\\s+(?:zahlung|karte|zahlungsmethode|zahlungsdaten|abonnement)\\b"),
    accented("\\b(?:lieferung|sendung|paket|bestellung|zustellung)\\b[^\\n]*\\b(?:fehlgeschlagen|verzögert|problem|nicht möglich|gescheitert)\\b"),
    accented("\\b(?:verdächtige?|ungewöhnliche?|nicht autorisierte?|unbekannte?) (?:anmeldung|aktivität|aktivitäten|zugriff)\\b"),
    accented("\\bpasswort (?:wurde )?(?:geändert|zurückgesetzt)\\b"),
    accented("\\b(?:waren das sie|sichern sie ihr konto|schützen sie ihr konto)\\b"),
  ],
};

const IT: SubjectRules = {
  positive: [
    // ── Codici di verifica / sicurezza / monouso ──
    accented("\\bcodice di (?:verifica|sicurezza|accesso|conferma|autenticazione)\\b"),
    accented("\\b(?:codice (?:otp|monouso|usa e getta)|password monouso)\\b"),
    accented("\\bverifica (?:il tuo|la tua) (?:indirizzo (?:e-?mail|email)|e-?mail|account|identità)\\b"),
    // ── Conferme di disiscrizione ──
    accented("\\bti sei (?:disiscritto|cancellato|disinscritto)\\b"),
    accented("\\b(?:disiscrizione|cancellazione (?:dell')?iscrizione) (?:confermata|riuscita)\\b"),
    accented("\\biscrizione annullata\\b"),
    // ── Stato di spedizione / consegna ──
    accented("\\b(?:il tuo|la tua)\\s+(?:ordine|pacco|spedizione|articolo|consegna)\\b[^\\n]*\\b(?:spedit[oa]|inviat[oa]|consegnat[oa]|in consegna|in arrivo)\\b"),
    accented("\\bin (?:consegna|arrivo)\\b"),
    accented("\\bconferma di spedizione\\b"),
    accented("\\btracciamento (?:del|della)\\s+(?:ordine|spedizione|pacco)\\b"),
    accented("\\bè stat[oa] (?:spedit[oa]|consegnat[oa]|inviat[oa])\\b"),
    // ── Ricevute / conferme d'ordine e pagamento ──
    accented("\\b(?:la tua|il tuo) (?:ricevuta|scontrino)\\b"),
    accented("\\bricevuta (?:di|per|n[°o]|#)"),
    accented("\\bconferma (?:d'|di )?(?:ordine|pagamento)\\b"),
    accented("\\bordine confermato\\b"),
    accented("\\bpagamento (?:ricevuto|confermato|riuscito|accettato)\\b"),
    accented("\\bgrazie per (?:il tuo|la tua) (?:ordine|acquisto|pagamento|prenotazione)\\b"),
    // ── Accesso / nuovo dispositivo (routine; la compromissione viene vetata) ──
    accented("\\bnuovo accesso\\b"),
    accented("\\baccesso al tuo account\\b"),
    accented("\\bnuovo dispositivo\\b"),
    // ── Documento / estratto conto disponibile (informativo; fattura esclusa) ──
    accented("\\b(?:il tuo|la tua) (?:\\S+\\s+){0,2}(?:estratto conto|estratto|documento|rapporto|report)\\b[^\\n]*\\b(?:è (?:disponibile|pront[oa])|ora disponibile|disponibile)\\b"),
    // ── Notifiche del calendario (prefissi di Google Calendar) ──
    accented("^(?:invito|accettat[oa]|rifiutat[oa]|forse|invito aggiornato|evento (?:annullato|aggiornato))\\s*:"),
  ],
  actionRequired: [
    accented("\\b(?:azione richiesta|intervento richiesto)\\b"),
    accented("\\b(?:pagamento|fattura|carta|abbonamento|addebito)\\b[^\\n]*\\b(?:fallit[oa]|non riuscit[oa]|rifiutat[oa]|scadut[oa]|in scadenza|scade|non pagat[oa]|insoluto|problema)\\b"),
    accented("\\b(?:fallit[oa]|rifiutat[oa]|scadut[oa]|non pagat[oa])\\b[^\\n]*\\b(?:pagamento|fattura|carta|abbonamento)\\b"),
    accented("\\baggiorna (?:il tuo|la tua)\\s+(?:pagamento|carta|metodo di pagamento|abbonamento)\\b"),
    accented("\\b(?:consegna|spedizione|pacco|ordine)\\b[^\\n]*\\b(?:fallit[oa]|non riuscit[oa]|ritardo|in ritardo|problema)\\b"),
    accented("\\b(?:attività|accesso) (?:sospett[oa]|insolit[oa]|non autorizzat[oa]|non riconosciut[oa])\\b"),
    accented("\\bpassword (?:modificata|reimpostata|cambiata)\\b"),
    accented("\\b(?:sei stato tu|proteggi il tuo account|metti al sicuro il tuo account)\\b"),
  ],
};

const PT: SubjectRules = {
  positive: [
    // ── Códigos de verificação / segurança / uso único ──
    accented("\\bcódigo de (?:verificação|segurança|acesso|confirmação|autenticação|uso único)\\b"),
    accented("\\b(?:código otp|senha de uso único)\\b"),
    accented("\\b(?:verifique|confirme) (?:seu|sua) (?:e-?mail|conta|identidade|endereço de e-?mail)\\b"),
    // ── Confirmações de cancelamento de inscrição ──
    accented("\\bcancelamento (?:de|da) (?:inscrição|assinatura)\\b"),
    accented("\\binscrição cancelada\\b"),
    accented("\\b(?:você foi |)descadastr(?:ado|o)\\b"),
    // ── Status de envio / entrega ──
    accented("\\b(?:seu|sua)\\s+(?:pedido|pacote|encomenda|entrega|item)\\b[^\\n]*\\b(?:enviad[oa]s?|despachad[oa]s?|entregue|a caminho|saiu para entrega)\\b"),
    accented("\\bsaiu para entrega\\b"),
    accented("\\bconfirmação de envio\\b"),
    accented("\\brastreamento (?:do|da)\\s+(?:pedido|encomenda|entrega)\\b"),
    accented("\\bfoi (?:enviad[oa]|entregue|despachad[oa])\\b"),
    // ── Recibos / confirmações de pedido e pagamento ──
    accented("\\b(?:seu|sua) (?:recibo|comprovante)\\b"),
    accented("\\b(?:recibo|comprovante) (?:de|do|da|#)"),
    accented("\\bconfirmação (?:de|do) (?:pedido|pagamento|compra)\\b"),
    accented("\\bpedido confirmado\\b"),
    accented("\\bpagamento (?:recebido|confirmado|aprovado|realizado)\\b"),
    accented("\\bobrigad[oa] (?:pela sua|pelo seu) (?:compra|pedido|pagamento)\\b"),
    // ── Login / novo dispositivo (rotina; comprometimento é vetado) ──
    accented("\\bnovo (?:login|acesso)\\b"),
    accented("\\bacesso à sua conta\\b"),
    accented("\\bnovo dispositivo\\b"),
    // ── Documento / extrato disponível (informativo; fatura excluída) ──
    accented("\\b(?:seu|sua) (?:\\S+\\s+){0,2}(?:extrato|documento|relatório|demonstrativo)\\b[^\\n]*\\b(?:está disponível|já disponível|disponível|pronto)\\b"),
    // ── Notificações de agenda (prefixos do Google Agenda) ──
    accented("^(?:convite|aceit[oa]|recusad[oa]|talvez|convite atualizado|evento (?:cancelado|atualizado))\\s*:"),
  ],
  actionRequired: [
    accented("\\b(?:ação necessária|ação obrigatória|requer (?:sua )?(?:ação|atenção))\\b"),
    accented("\\b(?:pagamento|fatura|cartão|assinatura|cobrança)\\b[^\\n]*\\b(?:falhou|recusad[oa]|vencid[oa]|atrasad[oa]|pendente|expirad[oa]|expira|não pago|problema)\\b"),
    accented("\\b(?:falhou|recusad[oa]|vencid[oa]|expirad[oa])\\b[^\\n]*\\b(?:pagamento|fatura|cartão|assinatura)\\b"),
    accented("\\batualize (?:seu|sua)\\s+(?:pagamento|cartão|forma de pagamento|método de pagamento|assinatura)\\b"),
    accented("\\b(?:entrega|envio|pacote|pedido|encomenda)\\b[^\\n]*\\b(?:falhou|atrasad[oa]|atraso|problema|não foi possível)\\b"),
    accented("\\b(?:atividade|login|acesso) (?:suspeit[oa]|incomum|não autorizad[oa]|não reconhecid[oa])\\b"),
    accented("\\bsenha (?:alterada|redefinida|modificada)\\b"),
    accented("\\b(?:foi você|proteja sua conta|mantenha sua conta segura)\\b"),
  ],
};

/**
 * Verified languages only. Add an entry here once both its positives AND its
 * action-required veto have been reviewed by someone who reads the language.
 */
const REGISTRY: SubjectRules[] = [LANGUAGE_AGNOSTIC, EN, FR, ES, DE, IT, PT];

const ALL_POSITIVE: RegExp[] = REGISTRY.flatMap((r) => r.positive);
const ALL_ACTION_REQUIRED: RegExp[] = REGISTRY.flatMap((r) => r.actionRequired);

/**
 * True when the subject matches a transactional-auto template in ANY supported
 * language (OTP, unsubscribe confirmation, shipping status, receipt, routine
 * sign-in, document-ready, calendar notification) AND is not an action-required
 * exception. The subject is lowercased once so patterns can be authored lowercase
 * and uppercase accents (É) still match.
 */
export function subjectIsTransactionalAuto(subject: string | null | undefined): boolean {
  if (!subject) return false;
  const s = subject.toLowerCase();
  if (ALL_ACTION_REQUIRED.some((re) => re.test(s))) return false;
  return ALL_POSITIVE.some((re) => re.test(s));
}
