// Vietnamese (vi) multilingual routing test fixtures. Test data only.
import type { TestEmail } from "../sorting-fixtures.js";

const SENT_AT = new Date("2026-01-15T10:00:00Z");

export const THREADS_VI_FLAT: TestEmail[] = [
  {
    id: "vi-finance-hoa-don-den-han",
    difficulty: "easy",
    messages: [
      {
        subject: "Hóa đơn INV-2026-0142 đến hạn ngày 30 tháng 1",
        senderEmail: "thanhtoan@vietcloud.com.vn",
        senderName: "Bộ phận Thanh toán VietCloud",
        bodyText: `Kính gửi Quý khách, đính kèm là hóa đơn INV-2026-0142 với số tiền 4.750.000 VNĐ cho gói thuê bao tháng 1.\nVui lòng thanh toán bằng cách chuyển khoản vào tài khoản Vietcombank ghi trên hóa đơn trước ngày đến hạn 30/01/2026.\nSau khi thanh toán, xin gửi lại chứng từ chuyển khoản để chúng tôi cập nhật trạng thái công nợ của Quý khách.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "finance",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "vi-sales-bao-gia-goi-enterprise",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: Xin báo giá gói Enterprise cho 250 người dùng",
        senderEmail: "dung.tran@banleviet.com.vn",
        senderName: "Trần Tiến Dũng",
        bodyText: `Cảm ơn buổi demo hôm qua. Đội ngũ chúng tôi rất quan tâm và muốn xin báo giá chính thức cho gói Enterprise dành cho 250 người dùng với hợp đồng một năm.\nNếu chúng tôi thanh toán trước trọn năm thì có được chiết khấu không? Mong bên bạn gửi đề xuất kèm bảng giá chi tiết trong tuần này.\n\n> Vào ngày 12/01/2026, đội ngũ kinh doanh của chúng tôi đã viết:
> Rất vui được giới thiệu sản phẩm tới quý công ty trong buổi demo.
> Vui lòng cho biết số lượng người dùng cần thiết để chúng tôi xây dựng báo giá phù hợp.
> Chúng tôi sẵn sàng hỗ trợ quy trình mua sắm ở khía cạnh thương mại.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "sales",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "vi-customer-support-khong-dang-nhap-duoc",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: Không đăng nhập được sau khi đặt lại mật khẩu",
        senderEmail: "lan.pham@gmail.com",
        senderName: "Phạm Thị Lan",
        bodyText: `Tôi đã làm theo hướng dẫn để đặt lại mật khẩu, nhưng bây giờ ứng dụng liên tục báo lỗi "phiên làm việc không hợp lệ" mỗi khi tôi cố đăng nhập. Tôi đã xóa bộ nhớ đệm và thử trên trình duyệt khác nhưng vẫn bị lỗi như cũ.\nMong bộ phận hỗ trợ giúp tôi truy cập lại tài khoản sớm nhất có thể.\n\nVào lúc 09:00 ngày 12/01/2026, Bộ phận Hỗ trợ Amarnai <support@amarnai.app> đã viết:\nCảm ơn bạn đã liên hệ. Vui lòng đặt lại mật khẩu qua liên kết chúng tôi vừa gửi, sau đó đăng nhập lại bằng mật khẩu mới.\nHãy báo cho chúng tôi nếu bạn vẫn gặp trục trặc.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "customer-support",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "vi-ambiguous-gia-han-hop-dong-ban-quyen",
    difficulty: "hard",
    messages: [
      {
        subject: "Gia hạn hợp đồng bản quyền và giá cho năm tới",
        senderEmail: "an.nguyen@truyenthongsang.com.vn",
        senderName: "Nguyễn Văn An",
        bodyText: `Hợp đồng bản quyền phần mềm của chúng tôi sẽ hết hạn vào tháng tới và chúng tôi muốn gia hạn. Bên bạn có thể gửi bản thỏa thuận mới nhất kèm điều khoản gia hạn để bộ phận pháp lý của chúng tôi rà soát không?\nNgoài ra, xin cho biết giá gia hạn có giữ nguyên hay sẽ có điều chỉnh chi phí thuê bao cho năm tới.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "legal",
    allowNeedsHumanReview: true,
    split: "holdout",
    misleadingKeywords: ["giá", "chi phí thuê bao", "điều chỉnh"],
  },
  {
    id: "vi-hr-ung-tuyen-vi-tri-backend",
    difficulty: "easy",
    messages: [
      {
        subject: "Ứng tuyển vị trí Kỹ sư Backend",
        senderEmail: "khoi.le@gmail.com",
        senderName: "Lê Đăng Khôi",
        bodyText: `Chào anh chị, tôi muốn ứng tuyển vị trí Kỹ sư Backend được đăng trên trang tuyển dụng của công ty. Tôi có năm năm kinh nghiệm phát triển dịch vụ với Node.js và PostgreSQL.\nCV và portfolio của tôi được đính kèm trong email này. Mong anh chị thông tin về các bước tiếp theo của quy trình tuyển dụng.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "hr",
    allowNeedsHumanReview: true,
    split: "holdout",
  },
];

export const THREADS_VI_D3: TestEmail[] = [
  {
    id: "vi-d3-invoices-hoa-don-nha-cung-cap",
    difficulty: "medium",
    messages: [
      {
        subject: "Hóa đơn nhà cung cấp PO-8841 cho lô máy chủ",
        senderEmail: "ketoan@dataviet-vendor.com.vn",
        senderName: "Công ty Data Việt",
        bodyText: `Đính kèm là hóa đơn nhà cung cấp theo đơn đặt hàng PO-8841 cho ba máy chủ với tổng giá trị 82.500.000 VNĐ. Vui lòng xử lý thanh toán trong vòng 30 ngày theo điều khoản hợp đồng mua sắm.\nXin chuyển hóa đơn này tới bộ phận công nợ phải trả để xử lý theo lịch thanh toán nhà cung cấp.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "d3-invoices",
    allowNeedsHumanReview: true,
    split: "tune",
  },
];
