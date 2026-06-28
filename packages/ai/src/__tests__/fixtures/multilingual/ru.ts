// Russian (ru) multilingual routing test fixtures.
import type { TestEmail } from "../sorting-fixtures.js";

const SENT_AT = new Date("2026-01-15T10:00:00Z");

export const THREADS_RU_FLAT: TestEmail[] = [
  {
    id: "ru-finance-clear",
    difficulty: "easy",
    messages: [
      {
        subject: "Счёт № 2026-0042 к оплате",
        senderEmail: "buhgalteria@postavshik-grupp.ru",
        senderName: "Бухгалтерия ООО «Поставщик-Групп»",
        bodyText: `Уважаемые коллеги,

направляем вам счёт № 2026-0042 на сумму 74 900 рублей. Просим оплатить его в течение 14 календарных дней на указанные в счёте реквизиты. По всем вопросам, связанным с оплатой, обращайтесь в нашу бухгалтерию.

С уважением,
ООО «Поставщик-Групп»`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "finance",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "ru-sales-quoted",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: Коммерческое предложение на корпоративные лицензии",
        senderEmail: "a.smirnov@vektor-it.ru",
        senderName: "Алексей Смирнов",
        bodyText: `Добрый день!

Спасибо за предварительную оценку. Теперь мы хотели бы запросить официальное коммерческое предложение на 250 корпоративных лицензий со скидками за объём и условиями для трёхлетнего контракта. Также подскажите, пожалуйста, какая скидка возможна при оплате за год вперёд.

С уважением,
Алексей Смирнов

> Здравствуйте, Алексей!
> С радостью пришлём вам ориентировочный прайс на корпоративные
> пакеты. Для подготовки точного предложения нам нужно уточнить
> желаемое количество лицензий.
> С уважением, отдел продаж`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "sales",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "ru-customer-support-unquoted",
    difficulty: "medium",
    messages: [
      {
        subject: "Re: Не работает вход после обновления",
        senderEmail: "petr.kozlov@mail.ru",
        senderName: "Пётр Козлов",
        bodyText: `Доброе утро,

к сожалению, сброс пароля не помог. После последнего обновления я вообще не могу войти в систему: после ввода логина и пароля страница постоянно показывает ошибку «Сессия недействительна». Пожалуйста, проверьте мою учётную запись и помогите восстановить доступ.

С уважением,
Пётр Козлов

15 января 2026 г. в 09:00, Служба поддержки <support@amarnai-app.ru> написал(а):
Здравствуйте, Пётр! Пожалуйста, сначала попробуйте сбросить пароль через функцию «Забыли пароль» и очистите кэш браузера. Напишите нам снова, если проблема сохранится.`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "customer-support",
    allowNeedsHumanReview: true,
    split: "tune",
  },
  {
    id: "ru-legal-ambiguous",
    difficulty: "hard",
    messages: [
      {
        subject: "Согласование соглашения о конфиденциальности перед интеграцией",
        senderEmail: "y.fedorova@severpunkt.io",
        senderName: "Юлия Фёдорова",
        bodyText: `Здравствуйте,

прежде чем технически объединять наши платформы, нам необходимо подписать прилагаемые соглашение об обработке данных и соглашение о неразглашении. Просим вашу юридическую службу проверить пункты об ответственности и соответствии требованиям о персональных данных и вернуть нам подписанную редакцию. Только после этого мы сможем открыть общий программный интерфейс.

С уважением,
Юлия Фёдорова`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "legal",
    allowNeedsHumanReview: true,
    split: "holdout",
    misleadingKeywords: ["интеграция", "объединить платформы", "интерфейс", "общий", "партнёрство"],
  },
  {
    id: "ru-security-second",
    difficulty: "easy",
    messages: [
      {
        subject: "Сообщение об уязвимости в форме авторизации",
        senderEmail: "researcher@bughunt.dev",
        senderName: "Дмитрий Орлов",
        bodyText: `Здравствуйте,

я исследователь безопасности и хочу ответственно сообщить об обнаруженной уязвимости. На странице входа в ваш сервис возможна SQL-инъекция через поле логина, что позволяет обойти проверку учётных данных. Прошу подтвердить получение этого сообщения и сообщить контакт для передачи технических деталей.

С уважением,
Дмитрий Орлов`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "security",
    allowNeedsHumanReview: true,
    split: "holdout",
  },
];

export const THREADS_RU_D3: TestEmail[] = [
  {
    id: "ru-d3-subscriptions-deep",
    difficulty: "medium",
    messages: [
      {
        subject: "Ваша подписка на КиноПоток продлена",
        senderEmail: "billing@kinopotok.ru",
        senderName: "КиноПоток",
        bodyText: `Здравствуйте!

Сообщаем, что ваша подписка на тариф «Премиум» была автоматически продлена на следующий месяц. С вашей привязанной карты списано 599 рублей, следующее списание состоится 15 февраля 2026 года. Управлять подпиской или отключить автопродление можно в личном кабинете.

С уважением,
Команда КиноПоток`,
        receivedAt: SENT_AT,
      },
    ],
    expectedFinalNodeId: "d3-subscriptions",
    allowNeedsHumanReview: true,
    split: "tune",
  },
];
