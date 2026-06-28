// Turkish (tr) multilingual routing test fixtures.
import type { TestEmail } from "../sorting-fixtures.js";

const SENT_AT = new Date("2026-01-15T10:00:00Z");

export const THREADS_TR_FLAT: TestEmail[] = [
  {
    id: "tr-finance-clear",
    difficulty: "easy",
    messages: [
      {
        subject: "2026-0042 numaralı fatura ödemesi hakkında",
        senderEmail: "muhasebe@tedarikas.com.tr",
        senderName: "Tedarik A.Ş. Muhasebe",
        bodyText: `Sayın yetkili,

Ekte 4.250,00 TL tutarındaki 2026-0042 numaralı faturamızı bilgilerinize sunuyoruz. Ödemenin son tarihi olan 31 Ocak 2026'ya kadar, dekontta belirtilen banka hesabına yapılmasını rica ederiz. Faturayla ilgili sorularınız için muhasebe ekibimiz size yardımcı olmaktan memnuniyet duyar.

Saygılarımızla
Muhasebe Departmanı`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "finance",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "tr-sales-quoted",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: Kurumsal lisans teklifi",
        senderEmail: "mehmet.yilmaz@aydinholding.com.tr",
        senderName: "Mehmet Yılmaz",
        bodyText: `Merhaba,

Ön fiyatlandırma için teşekkür ederiz. Şimdi 200 adet Kurumsal lisans için bağlayıcı bir teklif almak istiyoruz; kademeli birim fiyatları ve üç yıllık sözleşme koşullarını da içermesini rica ederiz. Ayrıca yıllık peşin ödemede uygulanabilecek indirim oranlarını da belirtebilir misiniz?

İyi çalışmalar
Mehmet Yılmaz

> Sayın Mehmet Bey,
> Kurumsal paketlerimizin ön fiyat listesini memnuniyetle paylaşırız.
> Ayrıntılı bir teklif hazırlayabilmemiz için hedeflediğiniz
> lisans sayısını öğrenebilir miyiz?
> Saygılarımızla, Satış Ekibi`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "sales",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "tr-customer-support-unquoted",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: Güncellemeden sonra giriş yapılamıyor",
        senderEmail: "ayse.demir@eposta.com.tr",
        senderName: "Ayşe Demir",
        bodyText: `Merhaba,

Maalesef şifre sıfırlama işe yaramadı. Son güncellemeden sonra hesabıma hiç giriş yapamıyorum; bilgilerimi girdikten sonra sayfa sürekli "oturum geçersiz" hatası veriyor. Hesabımı kontrol edip erişimimi geri kazanmama yardımcı olabilir misiniz?

Teşekkürler
Ayşe Demir

5 Oca 2026 Pzt 09:00 tarihinde Destek Ekibi <destek@amarnai-app.com.tr> şunu yazdı:
Sayın Ayşe Hanım, lütfen öncelikle "Şifremi unuttum" seçeneğiyle şifrenizi sıfırlamayı deneyin, ardından tarayıcınızın önbelleğini temizleyin. Sorun devam ederse bizimle tekrar iletişime geçmenizi rica ederiz.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "customer-support",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "tr-legal-ambiguous",
    difficulty: "hard",
    messages: [
      {
        subject: "Entegrasyon öncesi veri işleme sözleşmesinin incelenmesi",
        senderEmail: "z.kaya@nordpunkt.io",
        senderName: "Zeynep Kaya",
        bodyText: `Merhaba,

Platformlarımızı teknik olarak birbirine bağlamadan önce, ekteki veri işleme sözleşmesini ve gizlilik anlaşmasını karşılıklı olarak imzalamamız gerekiyor. Sorumluluk maddelerini ve KVKK uyumluluğuna ilişkin hükümleri hukuk ekibinizin incelemesini ve imzalı nüshayı bize geri göndermenizi rica ediyorum. Ortak API'yi ancak bu adımdan sonra devreye alabileceğiz.

Saygılarımla
Zeynep Kaya`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "legal",
    allowNeedsHumanReview: true,
    split: "holdout",
    misleadingKeywords: ["entegrasyon", "platform bağlantısı", "API", "ortak", "iş birliği"],
  },
  {
    id: "tr-security-second",
    difficulty: "easy",
    messages: [
      {
        subject: "Güvenlik açığı bildirimi: kimlik doğrulama atlatma",
        senderEmail: "arastirmaci@guvenlikarastirma.com",
        senderName: "Can Öztürk",
        bodyText: `Merhaba,

Giriş sisteminizde, yetkisiz bir kişinin kimlik doğrulama adımını atlayarak hesaplara erişmesine olanak tanıyan kritik bir güvenlik açığı tespit ettim. Bu açığı sorumlu ifşa ilkeleri çerçevesinde size bildiriyorum ve teknik ayrıntıları yalnızca güvenlik ekibinizle paylaşmak istiyorum. Lütfen bu bildirimi en kısa sürede ilgili ekibe yönlendirin.

Saygılarımla
Can Öztürk`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "security",
    allowNeedsHumanReview: true,
    split: "holdout",
  },
];

export const THREADS_TR_D3: TestEmail[] = [
  {
    id: "tr-d3-invoices-deep",
    difficulty: "medium",
    messages: [
      {
        subject: "Ocak ayı baskı hizmetleri faturası",
        senderEmail: "fatura@baskipartner.com.tr",
        senderName: "BaskıPartner Matbaa",
        bodyText: `Sayın yetkili,

Ocak ayında teslim edilen basılı materyaller için 1.180,00 TL tutarında FT-2026-118 numaralı faturayı düzenledik. Teslimat, 7741 numaralı siparişe uygun şekilde gerçekleştirilmiştir. Ödemenin 29.01.2026 tarihine kadar, açıklama kısmına fatura numarası yazılarak yapılmasını rica ederiz.

Saygılarımızla
BaskıPartner Matbaa Ltd. Şti.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "d3-invoices",
    allowNeedsHumanReview: true,
    split: "tune",
  },
];
