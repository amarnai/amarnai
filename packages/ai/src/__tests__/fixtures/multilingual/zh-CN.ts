// Simplified Chinese (zh-CN) email-routing test fixtures. Test data only.
import type { TestEmail } from "../sorting-fixtures.js";

const SENT_AT = new Date("2026-01-15T10:00:00Z");

export const THREADS_ZH_CN_FLAT: TestEmail[] = [
  {
    id: "zh-cn-finance-invoice-clear",
    difficulty: "easy",
    messages: [
      {
        subject: "发票 INV-2026-0312 付款提醒",
        senderEmail: "caiwu@gongyingshang.com.cn",
        senderName: "财务部",
        bodyText:
          `您好，附件是本月发票 INV-2026-0312，金额合计人民币 18,600 元，付款期限为 30 天。\n` +
          `请在到期日前完成转账，并将汇款水单回传给我们以便核销。如有疑问请随时联系财务部。`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "finance",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  {
    id: "zh-cn-sales-enterprise-quote",
    difficulty: "medium",
    messages: [
      {
        subject: "回复：50 个企业版席位的报价请求",
        senderEmail: "caigou@kehugongsi.com",
        senderName: "采购部 李伟",
        bodyText:
          `您好，根据之前的沟通，我们希望正式获取企业版 50 个席位的商业报价，包含批量折扣和年度付款条款。\n` +
          `另外也请提供续费价格，方便我们走内部采购审批流程。\n\n` +
          `> 您好，感谢您对我们产品的关注。请问贵公司大概需要多少个用户席位？\n` +
          `> 我们可以据此为您准备阶梯报价。\n` +
          `> 此致，销售团队`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "sales",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  {
    id: "zh-cn-customer-support-login-error",
    difficulty: "medium",
    messages: [
      {
        subject: "回复：无法登录账户，提示密码错误",
        senderEmail: "zhangmin@yonghu.com",
        senderName: "张敏",
        bodyText:
          `你们好，我按照上次的指引重置了密码，但现在仍然登录不了，页面一直提示“验证码无效”，而且重置邮件也收不到了。\n` +
          `请帮我检查一下账户状态，这个问题已经影响我两天的工作了。\n\n` +
          `在 2026年1月5日 09:00，技术支持 <support@example.com> 写道：\n` +
          `您好，请先尝试清除浏览器缓存并使用密码重置链接重新设置密码。如果仍有问题，请回复本邮件告知我们。\n` +
          `祝好，技术支持团队`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "customer-support",
    allowNeedsHumanReview: true,
    split: "tune",
  },

  {
    id: "zh-cn-ambiguous-refund-dispute",
    difficulty: "hard",
    messages: [
      {
        subject: "关于多收费用的退款申请",
        senderEmail: "wangfang@kehu.cn",
        senderName: "王芳",
        bodyText:
          `你们好，我这个月的账单被重复扣款了两次，多扣了 299 元，希望尽快处理退款到原支付方式。\n` +
          `我之所以会注意到，是因为登录后台时还遇到了页面报错，但主要问题还是这笔多收的费用，请帮我核对发票与扣款明细。`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "finance",
    allowNeedsHumanReview: true,
    split: "holdout",
    misleadingKeywords: ["登录", "页面报错", "后台"],
  },

  {
    id: "zh-cn-hr-job-application",
    difficulty: "easy",
    messages: [
      {
        subject: "应聘高级后端工程师职位",
        senderEmail: "liuyang@qiuzhi.com",
        senderName: "刘洋",
        bodyText:
          `您好，我在贵公司招聘页面看到“高级后端工程师”的职位，对此非常感兴趣，现附上我的简历应聘。\n` +
          `我有六年分布式系统开发经验，期待有机会进一步沟通面试安排。`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "hr",
    allowNeedsHumanReview: true,
    split: "holdout",
  },
];

export const THREADS_ZH_CN_D3: TestEmail[] = [
  {
    id: "zh-cn-d3-invoices-vendor-bill",
    difficulty: "medium",
    messages: [
      {
        subject: "云服务器 12 月账单及发票 INV-CL-8842",
        senderEmail: "billing@yunfuwu.com.cn",
        senderName: "云服务商 计费中心",
        bodyText:
          `尊敬的客户，附件为贵司 12 月份云服务器使用账单，发票号 INV-CL-8842，应付金额人民币 7,320 元。\n` +
          `请在收到账单后 15 个工作日内完成对公转账付款，相关增值税专用发票已随附，供贵司入账核销。`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "d3-invoices",
    allowNeedsHumanReview: true,
    split: "tune",
  },
];
