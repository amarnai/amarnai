// Thai (th) email-thread test fixtures for the email-routing benchmark.
import type { TestEmail } from "../sorting-fixtures.js";

const SENT_AT = new Date("2026-01-15T10:00:00Z");

export const THREADS_TH_FLAT: TestEmail[] = [
  // 1. clear — unambiguous finance/invoice, no reply tail.
  {
    id: "th-finance-bai-gaeb-ngern-khang-chamra",
    difficulty: "easy",
    messages: [
      {
        subject: "ใบแจ้งหนี้เลขที่ INV-2026-0147 กำหนดชำระ 31 มกราคม",
        senderEmail: "banchi@siam-trading.co.th",
        senderName: "ฝ่ายบัญชี บริษัท สยามเทรดดิ้ง",
        bodyText:
          "เรียน ฝ่ายจัดซื้อ ทางเราขอแนบใบแจ้งหนี้เลขที่ INV-2026-0147 ยอดรวมสุทธิ 324,000 บาท มาเพื่อให้ท่านตรวจสอบ กำหนดชำระภายในวันที่ 31 มกราคม โดยโอนเข้าบัญชีตามที่ระบุไว้ในใบแจ้งหนี้ รบกวนแจ้งวันที่คาดว่าจะชำระเงินกลับมาด้วยจะขอบคุณมาก",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "finance",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  // 2. quoted — sales request on top, quoted reply tail with "> ".
  {
    id: "th-sales-bai-suer-rakha-license",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: ขอใบเสนอราคา Enterprise จำนวน 80 ไลเซนส์",
        senderEmail: "jatuporn@megacorp.co.th",
        senderName: "จตุพร ฝ่ายจัดซื้อ",
        bodyText:
          "ขอบคุณสำหรับการตอบกลับครับ จากที่ได้คุยกันก่อนหน้านี้ รบกวนขอใบเสนอราคาฉบับทางการสำหรับ Enterprise จำนวน 80 ไลเซนส์ พร้อมส่วนลดแบบซื้อจำนวนมาก และขอเงื่อนไขการชำระเงินสำหรับสัญญา 3 ปีด้วยครับ\n\n" +
          "เมื่อวันที่ 13 มกราคม 2026 เวลา 11:20 ทีมขาย <sales@example.com> เขียนว่า:\n" +
          "> ขอบคุณที่ติดต่อเข้ามา และขอบคุณที่ให้ความสนใจรุ่น Enterprise ของเรา รบกวนแจ้งจำนวนผู้ใช้งานที่ต้องการให้ทราบด้วยครับ\n" +
          "> ขอแสดงความนับถือ ทีมขาย",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "sales",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  // 3. unquoted — support request on top, Thai attribution line ending with a colon
  //    (sender email in <...> + date), then prior message with no ">" markers.
  {
    id: "th-customer-support-khao-rabob-mai-dai",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: เข้าสู่ระบบแดชบอร์ดไม่ได้",
        senderEmail: "wipada.s@luknha.co.th",
        senderName: "วิภาดา สุขใจ",
        bodyText:
          "เรียนทีมงาน ดิฉันลองทำตามขั้นตอนที่แนะนำมาทั้งหมดแล้ว แต่รหัสยืนยันแบบสองชั้นก็ยังไม่ส่งเข้ามาสักที จึงเข้าสู่ระบบไม่ได้เลย ตั้งแต่เมื่อวานเข้าใช้งานบัญชีไม่ได้ทำให้งานหยุดชะงัก รบกวนช่วยแก้ไขให้ด่วนได้ไหมคะ\n\n" +
          "เมื่อวันที่ 12 มกราคม 2026 เวลา 09:00 ฝ่ายสนับสนุนทางเทคนิค <support@example.com> เขียนว่า:\n" +
          "เรียนคุณวิภาดา ขอบคุณที่ติดต่อเข้ามา เบื้องต้นรบกวนลองตั้งรหัสผ่านใหม่แล้วลองเข้าสู่ระบบอีกครั้ง จากนั้นแจ้งผลให้เราทราบด้วยนะคะ",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "customer-support",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  // 4. ambiguous — partnership co-marketing vs sales. The goal is a partnership, but
  //    the message is loaded with commercial/pricing vocabulary.
  {
    id: "th-partnerships-kerd-rwam-co-marketing-khlumchruea",
    difficulty: "hard",
    messages: [
      {
        subject: "ข้อเสนอความร่วมมือทางธุรกิจและการขายร่วมกัน",
        senderEmail: "alliance@digital-agency.co.th",
        senderName: "ส่วนงานพันธมิตรเชิงกลยุทธ์",
        bodyText:
          "เรียนผู้เกี่ยวข้อง เราติดต่อมาเพื่อเสนอความร่วมมือทางธุรกิจในการทำการตลาดร่วมกันระหว่างสองบริษัท นอกจากการจัดแคมเปญร่วมกันแล้ว เรายังมองถึงการเชื่อมต่อทางเทคนิคของผลิตภัณฑ์ทั้งสองฝ่ายด้วย อีกทั้งสามารถจัดแพ็กเกจขายร่วมในราคาพิเศษให้แก่ลูกค้าของทั้งสองฝ่ายได้ รบกวนแจ้งผู้รับผิดชอบที่จะเป็นผู้ประสานงานในเรื่องนี้ให้เราทราบด้วยครับ",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "partnerships",
    allowNeedsHumanReview: true,
    split: "holdout",
    misleadingKeywords: ["การขายร่วม", "ราคาพิเศษ", "ลูกค้า", "ใบเสนอราคา", "ราคา"],
  },

  // 5. second — clear HR recruiting email, different category, no tail.
  {
    id: "th-hr-samak-backend-engineer",
    difficulty: "easy",
    messages: [
      {
        subject: "สมัครงานตำแหน่ง Backend Engineer (Senior)",
        senderEmail: "narongchai.k@example.com",
        senderName: "ณรงค์ชัย กิตติคุณ",
        bodyText:
          "เรียนฝ่ายทรัพยากรบุคคล ผมขอสมัครงานในตำแหน่ง Backend Engineer (Senior) ตามที่ประกาศไว้ในหน้ารับสมัครงานของบริษัท ได้แนบประวัติย่อและเอกสารประวัติการทำงานมาด้วยแล้ว รบกวนช่วยยืนยันการรับใบสมัคร และแจ้งขั้นตอนการคัดเลือกในลำดับถัดไปให้ทราบด้วยครับ",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "hr",
    allowNeedsHumanReview: true,
    split: "holdout",
  },
];

export const THREADS_TH_D3: TestEmail[] = [
  // 6. deep — clear vendor invoice targeting the d3-invoices leaf, no tail.
  {
    id: "th-d3-invoices-bai-gaeb-nee-thee-prueksa",
    difficulty: "medium",
    messages: [
      {
        subject: "ใบแจ้งหนี้เลขที่ TH-2026-0521 — ค่าที่ปรึกษา กำหนดชำระ 30 วัน",
        senderEmail: "billing@consult-partners.co.th",
        senderName: "ฝ่ายวางบิล บริษัท คอนซัลท์ พาร์ทเนอร์ส",
        bodyText:
          "เรียนลูกค้าผู้มีอุปการคุณ สำหรับงานที่ปรึกษาที่ได้ดำเนินการในไตรมาสที่ 4 ทางเราขอแนบใบแจ้งหนี้เลขที่ TH-2026-0521 ยอดก่อนภาษี 600,000 บาท ตามใบสั่งซื้อเลขที่ PO-2026-0210 มาด้วย รบกวนชำระเงินโดยโอนเข้าบัญชีตามที่ระบุในใบแจ้งหนี้ภายใน 30 วันนับจากวันที่ออกเอกสาร หากมีข้อสงสัยเกี่ยวกับเอกสารนี้สามารถสอบถามได้ตลอดครับ",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "d3-invoices",
    allowNeedsHumanReview: true,
    split: "tune",
  },
];
