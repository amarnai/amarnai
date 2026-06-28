// Korean (ko) email-thread test fixtures for the email-routing benchmark.
import type { TestEmail } from "../sorting-fixtures.js";

const SENT_AT = new Date("2026-01-15T10:00:00Z");

export const THREADS_KO_FLAT: TestEmail[] = [
  // 1. clear — unambiguous finance/invoice, no reply tail.
  {
    id: "ko-finance-mibuljeong-cheonggu",
    difficulty: "easy",
    messages: [
      {
        subject: "세금계산서 INV-2026-0147 결제 요청드립니다",
        senderEmail: "accounting@gongeupsa.co.kr",
        senderName: "경리부",
        bodyText:
          "안녕하세요, 첨부해 드린 세금계산서 INV-2026-0147 건으로 연락드립니다. 공급가액 포함 총 3,240,000원이며 결제 기한은 발행일로부터 30일입니다. 명세서에 기재된 계좌로 계좌이체 부탁드리며, 입금 예정일을 회신으로 알려 주시면 감사하겠습니다.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "finance",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  // 2. quoted — sales request on top, quoted reply tail with "> ".
  {
    id: "ko-sales-daeryang-gyeonjeok",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: 기업용 라이선스 80개 견적 문의",
        senderEmail: "purchasing@daegieop.co.kr",
        senderName: "구매팀",
        bodyText:
          "안녕하세요, 답변 감사드립니다. 기업용(Enterprise) 라이선스 80개에 대한 정식 견적서를 받아 보고 싶습니다. 3년 약정 기준 볼륨 할인율과 결제 조건을 포함해서 제안서로 보내 주시면 검토 후 회신드리겠습니다.\n\n" +
          "2026년 1월 13일 (화) 오전 11:20, 영업팀 <sales@example.com> 님이 작성:\n" +
          "> 안녕하세요, 저희 기업용 솔루션에 관심 가져 주셔서 감사합니다. 정확한 사용자 수를 알려 주시면 그에 맞춰 안내드리겠습니다.\n" +
          "> 감사합니다. 영업팀 드림",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "sales",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  // 3. unquoted — support request on top, Korean attribution line ending with a
  //    colon (sender email in <...> + date), then prior message with no ">" markers.
  {
    id: "ko-customer-support-login-bulga",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: 대시보드 로그인이 되지 않습니다",
        senderEmail: "jiyoung.kim@gogaek.co.kr",
        senderName: "김지영",
        bodyText:
          "안녕하세요, 알려 주신 절차대로 다시 시도해 보았는데도 2단계 인증 코드가 도착하지 않아 여전히 로그인 화면에서 막혀 있습니다. 어제부터 계정에 접속할 수 없어 업무가 전부 중단된 상태입니다. 긴급하게 확인 부탁드립니다.\n\n" +
          "2026년 1월 12일 (월) 오전 9:00, 기술지원팀 <support@example.com> 님이 작성:\n" +
          "안녕하세요 지영님, 문의 주셔서 감사합니다. 먼저 비밀번호를 재설정하신 뒤 다시 로그인을 시도해 보시겠어요? 결과를 알려 주시면 이어서 도와드리겠습니다.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "customer-support",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  // 4. ambiguous — partnership co-marketing vs sales. The intent is a partnership,
  //    but the message is loaded with commercial/pricing vocabulary.
  {
    id: "ko-partnerships-co-marketing-aemaehan",
    difficulty: "hard",
    messages: [
      {
        subject: "공동 마케팅 제휴 및 패키지 상품 제안",
        senderEmail: "alliance@dijiteol-agency.co.kr",
        senderName: "제휴협력팀",
        bodyText:
          "안녕하세요, 양사 간 공동 마케팅 제휴를 맺고 공동 캠페인과 제품 연동을 함께 진행하고자 제안드립니다. 더불어 양사 고객을 대상으로 특별 할인가가 적용된 패키지 상품을 함께 판매하는 방안도 검토하고 있습니다. 귀사에서 이런 협업을 담당하시는 분을 연결해 주실 수 있을까요?",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "partnerships",
    allowNeedsHumanReview: true,
    split: "holdout",
    misleadingKeywords: ["할인가", "패키지 상품", "판매", "고객", "견적"],
  },

  // 5. second — clear HR recruiting email, different category, no tail.
  {
    id: "ko-hr-backend-jiwon",
    difficulty: "easy",
    messages: [
      {
        subject: "백엔드 시니어 개발자 채용 지원드립니다",
        senderEmail: "minjun.lee@example.com",
        senderName: "이민준",
        bodyText:
          "안녕하세요, 채용 페이지에 공고된 백엔드 시니어 개발자 포지션에 지원합니다. 이력서와 자기소개서를 첨부해 드렸으니 확인 부탁드립니다. 채용 절차와 다음 단계에 대해서도 안내해 주시면 감사하겠습니다. 지원서가 정상적으로 접수되었는지 회신으로 확인 부탁드립니다.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "hr",
    allowNeedsHumanReview: true,
    split: "holdout",
  },
];

export const THREADS_KO_D3: TestEmail[] = [
  // 6. deep — clear vendor invoice targeting the d3-invoices leaf, no tail.
  {
    id: "ko-d3-invoices-yongyeokeop-cheonggu",
    difficulty: "medium",
    messages: [
      {
        subject: "세금계산서 KR-2026-0521 발행 — 컨설팅 용역, 결제 기한 30일",
        senderEmail: "billing@consulting-firm.co.kr",
        senderName: "컨설팅펌 정산팀",
        bodyText:
          "안녕하세요, 4분기에 수행한 컨설팅 용역에 대한 세금계산서 KR-2026-0521을 첨부해 드립니다. 발주서 PO-2026-0210 기준 공급가액 6,000,000원이며, 결제 기한은 발행일로부터 30일입니다. 계산서에 기재된 계좌로 이체 부탁드리며, 문서 관련 문의 사항이 있으시면 언제든 연락 주십시오.",
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "d3-invoices",
    allowNeedsHumanReview: true,
    split: "tune",
  },
];
