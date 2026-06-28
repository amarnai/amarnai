// Spanish (es) multilingual email-thread fixtures for the routing benchmark. Test data only.

import type { TestEmail } from "../sorting-fixtures.js";

const SENT_AT = new Date("2026-01-15T10:00:00Z");

export const THREADS_ES_FLAT: TestEmail[] = [
  {
    // 1. clear — unambiguous finance/invoice, no reply tail.
    id: "es-finance-factura-pendiente",
    difficulty: "easy",
    messages: [
      {
        subject: "Factura n.º FAC-2026-0142 pendiente de pago",
        senderEmail: "facturacion@proveedor.es",
        senderName: "Departamento de Facturación",
        bodyText:
          "Buenos días, les adjuntamos la factura n.º FAC-2026-0142 por un importe de 3.450 € correspondiente a los servicios de diciembre. " +
          "El plazo de pago es de 30 días desde la fecha de emisión. " +
          "Les rogamos realicen la transferencia a la cuenta bancaria indicada en la factura y nos confirmen cuándo quedará abonada. " +
          "Para cualquier duda sobre el cobro, no duden en contactar con nuestro equipo de contabilidad.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "finance",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  {
    // 2. quoted — sales request on top, then quoted reply tail with "> " prefixes.
    id: "es-sales-cotizacion-50-licencias",
    difficulty: "medium",
    messages: [
      {
        subject: "Solicitud de presupuesto para 50 licencias empresariales",
        senderEmail: "compras@clienteempresa.es",
        senderName: "Departamento de Compras",
        bodyText:
          "Hola, tras nuestra conversación, nos gustaría recibir una propuesta comercial para 50 licencias de la edición empresarial, " +
          "con los descuentos por volumen y sus condiciones de pago. Necesitamos la oferta antes de fin de mes para cerrar la compra.\n\n" +
          "El lun, 12 ene 2026 a las 09:30, Equipo Comercial <ventas@example.com> escribió:\n" +
          "> Hola, gracias por su interés en nuestra solución. ¿Podrían indicarnos cuántos usuarios necesitan?\n" +
          "> Un saludo, el equipo comercial",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "sales",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  {
    // 3. unquoted — support signal on top; Spanish attribution line ending in colon
    //    with <email> and date, then prior message WITHOUT ">" markers.
    id: "es-customer-support-error-acceso",
    difficulty: "medium",
    messages: [
      {
        subject: "Sigo sin poder acceder a mi cuenta tras el último intento",
        senderEmail: "usuario@example.es",
        senderName: "Marta Giménez",
        bodyText:
          "Buenas tardes, he seguido los pasos que me indicaron pero el código de verificación en dos pasos no me llega y sigo sin poder " +
          "iniciar sesión en mi cuenta. La aplicación me muestra un error cada vez que intento entrar al panel. Necesito que lo resuelvan con urgencia.\n\n" +
          "El lun, 8 ene 2026 a las 10:00, Soporte Técnico <soporte@example.com> escribió:\n" +
          "Gracias por contactar con nosotros. Para empezar, le recomendamos restablecer su contraseña y volver a intentar el acceso. " +
          "Si el problema persiste, indíquenos qué mensaje de error aparece exactamente en pantalla y desde qué dispositivo accede.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "customer-support",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  {
    // 4. ambiguous — between partnerships and sales. The real intent is a partnership
    //    (co-marketing + integration), but commercial/pricing vocabulary pulls toward sales.
    id: "es-partnerships-integracion-comarketing",
    difficulty: "hard",
    messages: [
      {
        subject: "Propuesta de colaboración: integración y campaña conjunta",
        senderEmail: "alianzas@empresaaliada.es",
        senderName: "Equipo de Alianzas",
        bodyText:
          "Estimado equipo, les escribimos para proponer una colaboración estratégica entre nuestras empresas. " +
          "Nos gustaría integrar nuestras plataformas y lanzar una campaña de marketing conjunta con material de marca compartido. " +
          "Aunque esta alianza generará valor comercial para ambas partes y podríamos hablar de precios y condiciones más adelante, " +
          "nuestro objetivo principal es una relación de comarketing a largo plazo. ¿Podrían indicarnos quién gestiona este tipo de acuerdos?",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "partnerships",
    allowNeedsHumanReview: true,
    split: "holdout",
    misleadingKeywords: ["comercial", "precios", "condiciones", "compra", "oferta"],
  },

  {
    // 5. second — clear security email (vulnerability disclosure), no tail.
    id: "es-security-divulgacion-vulnerabilidad",
    difficulty: "easy",
    messages: [
      {
        subject: "Divulgación responsable de vulnerabilidad crítica de autenticación",
        senderEmail: "investigador@seguridad.es",
        senderName: "Investigador de Seguridad",
        bodyText:
          "Les escribo para comunicarles de forma responsable una vulnerabilidad crítica que hemos detectado en su sistema de autenticación. " +
          "El fallo permitiría a un atacante eludir el inicio de sesión y acceder a cuentas sin autorización. " +
          "Adjunto los detalles técnicos y los pasos para reproducir el problema. " +
          "Les rogamos trasladen este informe a su equipo de seguridad para que inicien la respuesta al incidente y apliquen la corrección cuanto antes.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "security",
    allowNeedsHumanReview: true,
    split: "holdout",
  },
];

export const THREADS_ES_D3: TestEmail[] = [
  {
    // 6. deep — vendor software invoice targeting the d3-invoices leaf, no tail.
    id: "es-d3-invoices-factura-proveedor",
    difficulty: "medium",
    messages: [
      {
        subject: "Factura n.º FAC-2026-0357 — renovación anual de licencias: 15 puestos",
        senderEmail: "facturacion@acme-software.es",
        senderName: "Facturación Acme Software",
        bodyText:
          "Les adjuntamos la factura n.º FAC-2026-0357 correspondiente a la renovación anual de su licencia de software. " +
          "15 puestos × 240 €/puesto = 3.600 €. Condiciones de pago: 30 días. " +
          "Referencia del pedido de compra: PED-2026-0891. " +
          "Les rogamos realicen el pago a los datos bancarios que figuran en la factura y nos avisen si necesitan cualquier aclaración.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "d3-invoices",
    allowNeedsHumanReview: true,
    split: "tune",
  },
];
