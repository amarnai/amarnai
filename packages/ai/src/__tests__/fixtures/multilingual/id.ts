// Indonesian (id) multilingual routing test fixtures. Test data only.
import type { TestEmail } from "../sorting-fixtures.js";

const SENT_AT = new Date("2026-01-15T10:00:00Z");

export const THREADS_ID_FLAT: TestEmail[] = [
  {
    id: "id-finance-faktur-jatuh-tempo",
    difficulty: "easy",
    messages: [
      {
        subject: "Faktur INV-2026-0142 jatuh tempo 30 Januari",
        senderEmail: "penagihan@nusantaracloud.co.id",
        senderName: "Tim Penagihan Nusantara Cloud",
        bodyText: `Halo, terlampir faktur INV-2026-0142 sebesar Rp4.750.000 untuk langganan bulan Januari.\nMohon lakukan pembayaran melalui transfer bank ke rekening BCA yang tertera sebelum tanggal jatuh tempo 30 Januari 2026.\nJika sudah membayar, silakan kirimkan bukti transfer agar kami dapat memperbarui status tagihan Anda.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "finance",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "id-sales-penawaran-paket-enterprise",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: Minta penawaran paket Enterprise untuk 250 pengguna",
        senderEmail: "dwi.santoso@retailmaju.co.id",
        senderName: "Dwi Santoso",
        bodyText: `Terima kasih atas demonya kemarin. Tim kami tertarik untuk berlangganan paket Enterprise dan ingin meminta penawaran harga resmi untuk 250 pengguna dengan kontrak tahunan.\nApakah ada diskon jika kami membayar di muka untuk satu tahun penuh? Mohon kirimkan proposal dan rincian harganya minggu ini.\n\n> Pada 12 Jan 2026, tim sales kami menulis:\n> Senang sekali bisa mempresentasikan produk kami kepada tim Anda.\n> Silakan beri tahu jumlah pengguna yang dibutuhkan agar kami dapat menyusun penawaran yang sesuai.\n> Kami siap membantu proses pengadaan dari sisi komersial.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "sales",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "id-customer-support-tidak-bisa-login",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: Tidak bisa masuk ke akun setelah reset kata sandi",
        senderEmail: "rina.wijaya@gmail.com",
        senderName: "Rina Wijaya",
        bodyText: `Saya sudah mengikuti petunjuk untuk mereset kata sandi, tetapi sekarang aplikasi terus menampilkan error "sesi tidak valid" setiap kali saya mencoba login. Saya sudah menghapus cache dan mencoba di browser lain, namun masalahnya tetap sama.\nMohon bantuannya agar saya bisa kembali mengakses akun saya secepatnya.\n\nPada Sen, 12 Jan 2026 pukul 09.00, Tim Dukungan Amarnai <support@amarnai.app> menulis:\nTerima kasih telah menghubungi kami. Silakan coba reset kata sandi melalui tautan yang kami kirimkan, lalu masuk kembali menggunakan kata sandi baru Anda.\nKabari kami jika masih mengalami kendala.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "customer-support",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "id-ambiguous-perpanjangan-kontrak-lisensi",
    difficulty: "hard",
    messages: [
      {
        subject: "Perpanjangan kontrak lisensi dan harga tahun depan",
        senderEmail: "agus.pranoto@mediakreasi.co.id",
        senderName: "Agus Pranoto",
        bodyText: `Kontrak lisensi perangkat lunak kami akan berakhir bulan depan dan kami ingin memperpanjangnya. Bisakah Anda mengirimkan dokumen perjanjian terbaru beserta klausul perpanjangan untuk ditinjau tim hukum kami?\nSelain itu, tolong informasikan apakah harga perpanjangan masih sama atau ada penyesuaian biaya langganan untuk tahun depan.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "legal",
    allowNeedsHumanReview: true,
    split: "holdout",
    misleadingKeywords: ["harga", "biaya langganan", "penyesuaian"],
  },
  {
    id: "id-hr-lamaran-posisi-backend",
    difficulty: "easy",
    messages: [
      {
        subject: "Lamaran untuk posisi Backend Engineer",
        senderEmail: "bayu.kurniawan@gmail.com",
        senderName: "Bayu Kurniawan",
        bodyText: `Selamat pagi, saya ingin melamar posisi Backend Engineer yang diiklankan di halaman karier perusahaan Anda. Saya memiliki pengalaman lima tahun mengembangkan layanan dengan Node.js dan PostgreSQL.\nCV dan portofolio saya terlampir. Mohon informasinya mengenai tahapan proses rekrutmen selanjutnya.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "hr",
    allowNeedsHumanReview: true,
    split: "holdout",
  },
];

export const THREADS_ID_D3: TestEmail[] = [
  {
    id: "id-d3-invoices-faktur-vendor",
    difficulty: "medium",
    messages: [
      {
        subject: "Faktur vendor PO-8841 untuk pengadaan server",
        senderEmail: "billing@datapintarvendor.co.id",
        senderName: "Data Pintar Vendor",
        bodyText: `Terlampir faktur vendor atas pesanan pembelian PO-8841 untuk pengadaan tiga unit server senilai Rp82.500.000. Pembayaran mohon diproses dalam 30 hari sesuai ketentuan kontrak pengadaan.\nSilakan teruskan faktur ini ke bagian utang usaha untuk diproses sesuai jadwal pembayaran vendor.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "d3-invoices",
    allowNeedsHumanReview: true,
    split: "tune",
  },
];
