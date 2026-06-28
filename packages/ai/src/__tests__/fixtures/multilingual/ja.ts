// Japanese (ja) email-thread test fixtures for the email-routing benchmark.
import type { TestEmail } from "../sorting-fixtures.js";

const SENT_AT = new Date("2026-01-15T10:00:00Z");

export const THREADS_JA_FLAT: TestEmail[] = [
  // 1. clear — unambiguous finance/invoice, no reply tail.
  {
    id: "ja-finance-seikyusho-mishorai",
    difficulty: "easy",
    messages: [
      {
        subject: "請求書 No. INV-2026-0147 のお支払いについて",
        senderEmail: "keiri@kabushiki-shouji.co.jp",
        senderName: "経理部",
        bodyText:
          "お世話になっております。請求書 No. INV-2026-0147（税込 324,000円）を添付いたしましたのでご確認ください。お支払い期限は1月31日まで、お振込先は請求書記載の口座宛にお願いいたします。お振込予定日をご返信いただけますと幸いです。",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "finance",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  // 2. quoted — sales request on top, quoted reply tail with "> ".
  {
    id: "ja-sales-mitsumori-volume",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: エンタープライズ版80ライセンスのお見積もり",
        senderEmail: "kobai@daikigyou.co.jp",
        senderName: "購買部",
        bodyText:
          "ご連絡ありがとうございます。先日のご返信を踏まえ、エンタープライズ版80ライセンスについて、ボリュームディスカウントを含めた正式なお見積書をお願いいたします。あわせて、3年契約を前提としたお支払い条件もご提示いただけますでしょうか。\n\n" +
          "2026年1月13日 11:20 営業チーム <sales@example.com> のメッセージ:\n" +
          "> お問い合わせいただきありがとうございます。弊社エンタープライズ版にご関心をお寄せいただき感謝いたします。対象となるご利用人数を教えていただけますでしょうか。\n" +
          "> よろしくお願いいたします。営業チーム",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "sales",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  // 3. unquoted — support request on top, Japanese attribution line ending with a
  //    colon (sender email in <...> + date), then prior message with no ">" markers.
  {
    id: "ja-customer-support-login-fuguai",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: ダッシュボードにログインできません",
        senderEmail: "sato.yui@kokyaku.co.jp",
        senderName: "佐藤結衣",
        bodyText:
          "お世話になっております。ご案内いただいた手順を一通り試しましたが、二段階認証のコードがいまだに届かず、ログイン画面から先に進めません。昨日からアカウントにアクセスできず業務が滞っております。至急ご対応をお願いできますでしょうか。\n\n" +
          "2026年1月12日 9:00 テクニカルサポート <support@example.com> のメッセージ:\n" +
          "佐藤様、ご連絡ありがとうございます。まずはパスワードを再設定のうえ、再度ログインをお試しいただけますでしょうか。状況をお知らせください。",
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
    id: "ja-partnerships-co-marketing-aimai",
    difficulty: "hard",
    messages: [
      {
        subject: "業務提携と共同販売のご提案",
        senderEmail: "alliance@digital-agency.co.jp",
        senderName: "アライアンス推進室",
        bodyText:
          "お世話になります。両社による共同マーケティングの業務提携をぜひ検討させていただきたくご連絡いたしました。共同キャンペーンの実施に加え、両社製品の技術連携も視野に入れております。また、双方のお客様向けに特別価格での共同販売プランをご提供することも可能です。こうした取り組みの窓口となるご担当者様をご教示いただけますでしょうか。",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "partnerships",
    allowNeedsHumanReview: true,
    split: "holdout",
    misleadingKeywords: ["共同販売", "特別価格", "お客様", "見積もり", "価格"],
  },

  // 5. second — clear HR recruiting email, different category, no tail.
  {
    id: "ja-hr-oubo-backend-engineer",
    difficulty: "easy",
    messages: [
      {
        subject: "バックエンドエンジニア（シニア）職への応募の件",
        senderEmail: "tanaka.kenta@example.com",
        senderName: "田中健太",
        bodyText:
          "はじめまして。御社の採用ページに掲載されておりましたバックエンドエンジニア（シニア）の求人に応募いたします。履歴書および職務経歴書を添付いたしましたのでご確認ください。採用プロセスや今後の選考の流れについてご相談できればと存じます。応募の受領をご確認いただけますと幸いです。",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "hr",
    allowNeedsHumanReview: true,
    split: "holdout",
  },
];

export const THREADS_JA_D3: TestEmail[] = [
  // 6. deep — clear vendor invoice targeting the d3-invoices leaf, no tail.
  {
    id: "ja-d3-invoices-gaichu-seikyusho",
    difficulty: "medium",
    messages: [
      {
        subject: "請求書 No. JP-2026-0521 — コンサルティング費用、支払期限30日",
        senderEmail: "billing@consulting-firm.co.jp",
        senderName: "コンサルティングファーム 請求担当",
        bodyText:
          "平素より大変お世話になっております。第4四半期に実施いたしましたコンサルティング業務につきまして、発注書 PO-2026-0210 に基づく請求書 No. JP-2026-0521（税抜 600,000円）を添付いたします。お支払いは請求書記載の口座宛に、発行日より30日以内のお振込にてお願い申し上げます。本書類に関するご不明点がございましたらお気軽にお問い合わせください。",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "d3-invoices",
    allowNeedsHumanReview: true,
    split: "tune",
  },
];
