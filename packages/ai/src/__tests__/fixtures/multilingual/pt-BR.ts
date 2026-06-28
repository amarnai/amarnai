// Brazilian Portuguese (pt-BR) email-thread test fixtures for the email-routing benchmark.
import type { TestEmail } from "../sorting-fixtures.js";

const SENT_AT = new Date("2026-01-15T10:00:00Z");

export const THREADS_PT_BR_FLAT: TestEmail[] = [
  // 1. clear — unambiguous finance/invoice, no reply tail.
  {
    id: "pt-br-finance-fatura-vencida",
    difficulty: "easy",
    messages: [
      {
        subject: "Nota fiscal NF-2026-0473 com vencimento próximo",
        senderEmail: "financeiro@fornecedora.com.br",
        senderName: "Setor Financeiro",
        bodyText:
          "Olá, segue em anexo a nota fiscal NF-2026-0473 no valor de R$ 4.820,00. O pagamento deve ser feito por boleto até o dia 30, conforme os dados informados no documento. Por favor, confirmem a data prevista para a quitação.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "finance",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  // 2. quoted — sales request on top, quoted reply tail with "> ".
  {
    id: "pt-br-sales-proposta-licencas",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: Cotação para 60 licenças do plano corporativo",
        senderEmail: "compras@grandevarejo.com.br",
        senderName: "Departamento de Compras",
        bodyText:
          "Olá, após a resposta de vocês, gostaríamos de receber uma proposta comercial detalhada para 60 licenças do plano corporativo, com os descontos por volume e as condições de pagamento para um contrato de três anos.\n\n" +
          "Em ter., 13 de jan. de 2026 às 11:20, Equipe Comercial <vendas@example.com> escreveu:\n" +
          "> Olá, obrigado pelo interesse na nossa solução corporativa. Vocês poderiam informar o número exato de usuários que vão utilizar o sistema?\n" +
          "> Atenciosamente, equipe comercial",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "sales",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  // 3. unquoted — support signal on top, pt-BR attribution line ending with a colon, no ">".
  {
    id: "pt-br-customer-support-erro-login",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: Não consigo acessar minha conta no aplicativo",
        senderEmail: "mariana.souza@gmail.com",
        senderName: "Mariana Souza",
        bodyText:
          "Oi, segui o passo a passo que vocês mandaram, mas continuo recebendo a mensagem de \"senha incorreta\" mesmo depois de redefinir a senha duas vezes. O aplicativo trava na tela de login e não recebo o e-mail de recuperação. Conseguem verificar o que está acontecendo com a minha conta?\n\n" +
          "Em seg., 12 de jan. de 2026 às 09:00, Suporte Amarnai <suporte@example.com> escreveu:\n" +
          "Olá, Mariana. Pedimos desculpas pelo transtorno. Você poderia tentar redefinir a senha pela opção \"Esqueci minha senha\" e nos avisar se o acesso volta a funcionar?\n" +
          "Atenciosamente, equipe de suporte",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "customer-support",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  // 4. ambiguous — invoice/payment dispute that is really a contract/compliance question (legal vs finance).
  {
    id: "pt-br-legal-disputa-contrato-fatura",
    difficulty: "hard",
    messages: [
      {
        subject: "Cobrança da fatura NF-9921 e cláusula de reajuste do contrato",
        senderEmail: "rfernandes@empresacliente.com.br",
        senderName: "Ricardo Fernandes",
        bodyText:
          "Recebemos a fatura NF-9921 com um reajuste de 18%, mas isso contraria a cláusula 7.2 do nosso contrato, que limita o reajuste anual ao índice IPCA. Antes de efetuar qualquer pagamento, precisamos que o jurídico revise se a cobrança está em conformidade com os termos assinados. Solicitamos uma análise formal da validade dessa cláusula e do aditivo contratual.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "legal",
    allowNeedsHumanReview: true,
    misleadingKeywords: ["fatura", "cobrança", "pagamento", "reajuste", "NF-9921"],
    split: "holdout",
  },

  // 5. second — clear HR/recruiting email, no tail.
  {
    id: "pt-br-hr-vaga-engenheiro",
    difficulty: "easy",
    messages: [
      {
        subject: "Candidatura para a vaga de Engenheiro de Software Pleno",
        senderEmail: "carla.almeida@outlook.com",
        senderName: "Carla Almeida",
        bodyText:
          "Olá, gostaria de me candidatar à vaga de Engenheiro de Software Pleno divulgada no LinkedIn de vocês. Segue em anexo o meu currículo e o portfólio com os projetos mais recentes. Fico à disposição para uma entrevista e para enviar referências profissionais.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "hr",
    allowNeedsHumanReview: true,
    split: "holdout",
  },
];

export const THREADS_PT_BR_D3: TestEmail[] = [
  // 6. deep — vendor invoice for the work-finance branch leaf "d3-invoices", no tail.
  {
    id: "pt-br-d3-invoices-fornecedor",
    difficulty: "medium",
    messages: [
      {
        subject: "Nota fiscal de fornecedor NF-2026-1188 referente ao pedido PO-554",
        senderEmail: "faturamento@graficacentral.com.br",
        senderName: "Gráfica Central",
        bodyText:
          "Prezados, segue a nota fiscal NF-2026-1188 no valor de R$ 12.350,00 referente ao pedido de compra PO-554 do material gráfico entregue na semana passada. O prazo de pagamento é de 28 dias a partir da data de emissão. Solicitamos o envio do comprovante após a quitação.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "d3-invoices",
    allowNeedsHumanReview: true,
    split: "tune",
  },
];
