import { mkdir, writeFile } from "node:fs/promises";

const schemaVersion = "eval-gold/v1";
const datasetId = "construction-opportunity-radar-eval-gold-v1";
const createdAt = "2026-09-03T00:00:00.000Z";
const output = new URL("../fixtures/evals/v1/dataset.json", import.meta.url);

const cities = [
  "Барнауле",
  "Бийске",
  "Новоалтайске",
  "Новосибирске",
  "Бердске",
  "Искитиме",
  "Горно-Алтайске",
  "Белокурихе",
  "Томске",
  "Кемерове",
];
const regions = [
  "Алтайском крае",
  "Новосибирской области",
  "Республике Алтай",
  "Томской области",
  "Кемеровской области",
];

const sources = {
  constructionOfficial: {
    sourceId: "91000000-0000-4000-8000-000000000001",
    sourceName: "Синтетический реестр строительных закупок",
  },
  constructionMarket: {
    sourceId: "91000000-0000-4000-8000-000000000002",
    sourceName: "Синтетический строительный бюллетень",
  },
  horecaOfficial: {
    sourceId: "91000000-0000-4000-8000-000000000003",
    sourceName: "Синтетический реестр HoReCa",
  },
  horecaMarket: {
    sourceId: "91000000-0000-4000-8000-000000000004",
    sourceName: "Синтетический бюллетень гостеприимства",
  },
};

const fact = (id, evidenceQuote, statement) => ({ evidenceQuote, id, statement });

const relevant = ({
  actionKind,
  actionRationale,
  actionTitle,
  category,
  eventType,
  facts,
  importance,
  importanceReason,
  summary,
  text,
  title,
}) => ({
  category,
  eventType,
  expectedAction: {
    kind: actionKind,
    rationale: actionRationale,
    title: actionTitle,
  },
  facts,
  importance: { reason: importanceReason, score: importance },
  relevant: true,
  summary,
  text,
  title,
});

const irrelevant = ({ factStatement, quote, summary, text, title }) => ({
  category: "OTHER",
  eventType: "IRRELEVANT_NOTICE",
  expectedAction: {
    kind: "IGNORE",
    rationale:
      "Материал не содержит проверяемой коммерческой возможности или риска для этой вертикали.",
    title: "Исключить из рекомендаций",
  },
  facts: [fact("fact-1", quote, factStatement)],
  importance: {
    reason: "Нет события, срока или коммерческого решения, требующего действия компании.",
    score: 10,
  },
  relevant: false,
  summary,
  text,
  title,
});

const constructionArchetypes = [
  (index) => {
    const city = cities[index - 1];
    const budget = 38 + index * 4;
    const deadline = `${String(10 + index).padStart(2, "0")}.10.2026`;
    const first = `Администрация объявила закупку строительных материалов для новой школы в ${city}.`;
    const second = `Начальная цена контракта — ${budget} млн рублей, заявки принимаются до ${deadline}.`;
    return relevant({
      actionKind: "PREPARE_OFFER",
      actionRationale: "Есть подтверждённые бюджет и срок подачи заявки.",
      actionTitle: "Подготовить тендерное предложение",
      category: "CONSTRUCTION_TENDER",
      eventType: "CONSTRUCTION_TENDER",
      facts: [
        fact("fact-1", first, `В ${city} объявлена закупка материалов для строительства школы.`),
        fact("fact-2", second, `Цена контракта ${budget} млн рублей; срок заявок ${deadline}.`),
      ],
      importance: 76 + (index % 5),
      importanceReason: "Крупная закупка с определённым бюджетом и близким сроком подачи.",
      summary: `Закупка материалов для школы в ${city} с бюджетом ${budget} млн рублей.`,
      text: `${first} ${second}`,
      title: `Материалы для школы в ${city}: закупка №${String(index).padStart(2, "0")}`,
    });
  },
  (index) => {
    const region = regions[(index - 1) % regions.length];
    const budget = 110 + index * 7;
    const first = `Региональный заказчик ищет генерального подрядчика для реконструкции больницы в ${region}.`;
    const second = `Стоимость работ оценена в ${budget} млн рублей, начало работ запланировано на ноябрь 2026 года.`;
    return relevant({
      actionKind: "CONTACT",
      actionRationale:
        "Ранний контакт позволит уточнить квалификационные требования и состав субподряда.",
      actionTitle: "Связаться с заказчиком проекта",
      category: "CONSTRUCTION_TENDER",
      eventType: "CONTRACTOR_SELECTION",
      facts: [
        fact("fact-1", first, `Для реконструкции больницы в ${region} выбирают генподрядчика.`),
        fact("fact-2", second, `Оценка работ — ${budget} млн рублей, старт — ноябрь 2026 года.`),
      ],
      importance: 84 + (index % 4),
      importanceReason:
        "Большой подряд с названным сроком старта создаёт прямую возможность продаж.",
      summary: `Выбор генподрядчика на реконструкцию больницы стоимостью ${budget} млн рублей.`,
      text: `${first} ${second}`,
      title: `Реконструкция больницы в ${region}: поиск подрядчика ${index}`,
    });
  },
  (index) => {
    const city = cities[(index + 1) % cities.length];
    const area = 18 + index * 2;
    const first = `Девелопер получил разрешение на строительство жилого комплекса в ${city}.`;
    const second = `Проект предусматривает ${area} тысяч квадратных метров жилья и старт площадки в декабре 2026 года.`;
    return relevant({
      actionKind: "CONTACT",
      actionRationale:
        "Разрешение и срок старта позволяют предложить материалы и субподряд до мобилизации площадки.",
      actionTitle: "Предложить поставку или субподряд",
      category: "CONSTRUCTION_PROJECT",
      eventType: "CONSTRUCTION_PERMIT",
      facts: [
        fact("fact-1", first, `В ${city} выдано разрешение на жилой комплекс.`),
        fact(
          "fact-2",
          second,
          `Площадь проекта ${area} тыс. м²; старт намечен на декабрь 2026 года.`,
        ),
      ],
      importance: 69 + (index % 7),
      importanceReason: "Новый разрешённый проект формирует спрос до начала строительных работ.",
      summary: `Разрешён жилой комплекс площадью ${area} тыс. м² со стартом в декабре.`,
      text: `${first} ${second}`,
      title: `Разрешение на жилой комплекс в ${city} — очередь ${index}`,
    });
  },
  (index) => {
    const region = regions[index % regions.length];
    const distance = 12 + index * 3;
    const budget = 240 + index * 11;
    const first = `Опубликован план реконструкции ${distance} километров региональной автодороги в ${region}.`;
    const second = `Финансирование составляет ${budget} млн рублей, конкурс на строительно-монтажные работы откроется в октябре.`;
    return relevant({
      actionKind: "MONITOR",
      actionRationale: "План содержит объём и бюджет, но конкурс ещё не опубликован.",
      actionTitle: "Поставить конкурс на мониторинг",
      category: "CONSTRUCTION_PROJECT",
      eventType: "INFRASTRUCTURE_PROJECT",
      facts: [
        fact("fact-1", first, `Запланирована реконструкция ${distance} км дороги в ${region}.`),
        fact(
          "fact-2",
          second,
          `Финансирование — ${budget} млн рублей; конкурс ожидается в октябре.`,
        ),
      ],
      importance: 78 + (index % 6),
      importanceReason:
        "Инфраструктурный проект имеет значительный объём и заранее объявленный конкурс.",
      summary: `Планируется реконструкция ${distance} км дороги с бюджетом ${budget} млн рублей.`,
      text: `${first} ${second}`,
      title: `Дорожная реконструкция в ${region}: участок ${index}`,
    });
  },
  (index) => {
    const city = cities[(index + 3) % cities.length];
    const area = 8 + index;
    const first = `Инвестор утвердил строительство логистического комплекса площадью ${area} тысяч квадратных метров в ${city}.`;
    const second = `Выбор поставщиков металлоконструкций и инженерных систем начнётся 1 ноября 2026 года.`;
    return relevant({
      actionKind: "PREPARE_OFFER",
      actionRationale: "До начала отбора можно подготовить техническое и ценовое предложение.",
      actionTitle: "Подготовить предложение по комплектации",
      category: "CONSTRUCTION_PROJECT",
      eventType: "COMMERCIAL_CONSTRUCTION",
      facts: [
        fact(
          "fact-1",
          first,
          `В ${city} утверждён логистический комплекс площадью ${area} тыс. м².`,
        ),
        fact("fact-2", second, "Отбор поставщиков стартует 1 ноября 2026 года."),
      ],
      importance: 65 + (index % 8),
      importanceReason: "Проект прямо называет будущий отбор поставщиков инженерных решений.",
      summary: `Логистический комплекс в ${city} готовит отбор поставщиков с 1 ноября.`,
      text: `${first} ${second}`,
      title: `Логистический комплекс в ${city}: проект ${index}`,
    });
  },
  (index) => {
    const effectiveDate = `${String(index).padStart(2, "0")}.01.2027`;
    const first = `Регион утвердил новые требования к энергоэффективности общественных зданий с ${effectiveDate}.`;
    const second = `Для проектов площадью свыше ${5 + index} тысяч квадратных метров потребуется отдельный энергетический расчёт.`;
    return relevant({
      actionKind: "ADJUST_PLAN",
      actionRationale: "Новые требования меняют проектную документацию и состав работ.",
      actionTitle: "Обновить проектные шаблоны",
      category: "CONSTRUCTION_PROJECT",
      eventType: "CONSTRUCTION_REGULATION",
      facts: [
        fact("fact-1", first, `Новые требования вступают в силу ${effectiveDate}.`),
        fact(
          "fact-2",
          second,
          `Энергетический расчёт обязателен для объектов свыше ${5 + index} тыс. м².`,
        ),
      ],
      importance: 58 + index,
      importanceReason:
        "Регуляторное изменение влияет на будущие проекты и себестоимость подготовки документации.",
      summary: `С ${effectiveDate} меняются требования к энергоэффективности крупных общественных зданий.`,
      text: `${first} ${second}`,
      title: `Энергоэффективность зданий: изменение требований ${index}`,
    });
  },
  (index) => {
    const material = ["цемент", "арматуру", "кирпич", "щебень", "газобетон"][index % 5];
    const change = 4 + index;
    const first = `Производитель уведомил дилеров о повышении цены на ${material} на ${change}% с 1 октября 2026 года.`;
    const second = `Заказы по старой цене принимаются до ${String(10 + index).padStart(2, "0")} сентября.`;
    return relevant({
      actionKind: "ADJUST_PLAN",
      actionRationale: "Есть подтверждённые процент изменения и последний срок старой цены.",
      actionTitle: "Пересчитать закупочный план",
      category: "CONSTRUCTION_PROJECT",
      eventType: "CONSTRUCTION_PRICE_CHANGE",
      facts: [
        fact("fact-1", first, `Цена на ${material} вырастет на ${change}% с 1 октября.`),
        fact("fact-2", second, `Старая цена доступна до ${10 + index} сентября.`),
      ],
      importance: 55 + index,
      importanceReason:
        "Изменение цены и короткое окно закупки влияют на сметы действующих проектов.",
      summary: `Поставщик повышает цену на ${material} на ${change}% и ограничивает старую цену.`,
      text: `${first} ${second}`,
      title: `Изменение цены на ${material}: уведомление ${index}`,
    });
  },
  (index) => {
    const city = cities[(index + 5) % cities.length];
    const length = 6 + index;
    const deadline = `${String(15 + index).padStart(2, "0")}.10.2026`;
    const first = `В ${city} объявлен конкурс на замену ${length} километров водопроводных сетей.`;
    const second = `Заявки от подрядчиков принимаются до ${deadline}, обязательный опыт — два аналогичных контракта.`;
    return relevant({
      actionKind: "VERIFY",
      actionRationale: "Перед участием нужно проверить соответствие требованию по опыту.",
      actionTitle: "Проверить квалификацию для конкурса",
      category: "CONSTRUCTION_TENDER",
      eventType: "UTILITY_TENDER",
      facts: [
        fact("fact-1", first, `Конкурс охватывает ${length} км сетей в ${city}.`),
        fact("fact-2", second, `Срок заявок ${deadline}; требуется два аналогичных контракта.`),
      ],
      importance: 70 + (index % 9),
      importanceReason: "Конкурс имеет измеримый объём, срок и квалификационный барьер.",
      summary: `Конкурс на замену ${length} км водопровода в ${city} со сроком ${deadline}.`,
      text: `${first} ${second}`,
      title: `Замена водопровода в ${city}: конкурс ${index}`,
    });
  },
  (index) => {
    const city = cities[index - 1];
    const quote = `Строительный колледж в ${city} подвёл итоги студенческого конкурса макетов за 2026 год.`;
    return irrelevant({
      factStatement: `В ${city} завершился студенческий конкурс макетов.`,
      quote,
      summary: "Новость об учебном конкурсе не содержит закупки, проекта или коммерческого срока.",
      text: `${quote} Победители получили памятные дипломы на торжественной церемонии №${index}.`,
      title: `Итоги конкурса студенческих макетов — выпуск ${index}`,
    });
  },
  (index) => {
    const region = regions[index % regions.length];
    const quote = `Музей архитектуры открыл выставку исторических чертежей в ${region}.`;
    return irrelevant({
      factStatement: `В ${region} открылась выставка исторических чертежей.`,
      quote,
      summary: "Культурное событие не сообщает о строительном заказе или изменении рынка.",
      text: `${quote} Экспозиция №${index} будет доступна посетителям до конца месяца без деловой программы.`,
      title: `Выставка архитектурных чертежей ${index}`,
    });
  },
];

const horecaArchetypes = [
  (index) => {
    const city = cities[index - 1];
    const seats = 45 + index * 5;
    const date = `${String(10 + index).padStart(2, "0")}.11.2026`;
    const first = `Ресторанная группа откроет заведение на ${seats} посадочных мест в ${city} ${date}.`;
    const second =
      "До открытия компания выбирает поставщиков посуды, текстиля и расходных материалов.";
    return relevant({
      actionKind: "CONTACT",
      actionRationale: "До даты открытия действует прямое окно для предложения оснащения.",
      actionTitle: "Связаться с ресторанной группой",
      category: "HORECA_OPENING",
      eventType: "RESTAURANT_OPENING",
      facts: [
        fact("fact-1", first, `В ${city} ${date} откроется ресторан на ${seats} мест.`),
        fact("fact-2", second, "Компания выбирает поставщиков оснащения до открытия."),
      ],
      importance: 68 + (index % 8),
      importanceReason: "Названы дата, вместимость и категории закупаемого оснащения.",
      summary: `Ресторан на ${seats} мест в ${city} выбирает поставщиков перед открытием ${date}.`,
      text: `${first} ${second}`,
      title: `Новый ресторан в ${city}: открытие ${index}`,
    });
  },
  (index) => {
    const city = cities[(index + 2) % cities.length];
    const rooms = 30 + index * 4;
    const first = `После реконструкции в ${city} готовится открытие отеля на ${rooms} номеров.`;
    const second = `Комплектация мебели и гостиничной косметики должна завершиться до 20 декабря 2026 года.`;
    return relevant({
      actionKind: "PREPARE_OFFER",
      actionRationale:
        "Объём номерного фонда и срок комплектации позволяют рассчитать предложение.",
      actionTitle: "Подготовить предложение для отеля",
      category: "HORECA_OPENING",
      eventType: "HOTEL_OPENING",
      facts: [
        fact("fact-1", first, `В ${city} готовится отель на ${rooms} номеров.`),
        fact("fact-2", second, "Комплектация должна завершиться до 20 декабря 2026 года."),
      ],
      importance: 72 + (index % 7),
      importanceReason: "Открытие создаёт ограниченное по времени окно на комплексную поставку.",
      summary: `Отель на ${rooms} номеров в ${city} завершает комплектацию к 20 декабря.`,
      text: `${first} ${second}`,
      title: `Открытие отеля в ${city}: объект ${index}`,
    });
  },
  (index) => {
    const region = regions[(index + 1) % regions.length];
    const budget = 12 + index * 2;
    const deadline = `${String(12 + index).padStart(2, "0")}.10.2026`;
    const first = `Санаторий в ${region} объявил закупку профессионального кухонного оборудования на ${budget} млн рублей.`;
    const second = `Коммерческие предложения принимаются до ${deadline}, монтаж требуется выполнить за 45 дней.`;
    return relevant({
      actionKind: "PREPARE_OFFER",
      actionRationale: "Закупка содержит бюджет, срок ответа и требование к монтажу.",
      actionTitle: "Подготовить предложение на оборудование",
      category: "HORECA_PROCUREMENT",
      eventType: "EQUIPMENT_PROCUREMENT",
      facts: [
        fact("fact-1", first, `Санаторий закупает кухонное оборудование на ${budget} млн рублей.`),
        fact("fact-2", second, `Срок предложений ${deadline}, монтаж — 45 дней.`),
      ],
      importance: 74 + (index % 8),
      importanceReason: "Прямая закупка с финансовым объёмом и техническим сроком.",
      summary: `Санаторий закупает кухонное оборудование на ${budget} млн рублей до ${deadline}.`,
      text: `${first} ${second}`,
      title: `Оборудование для санатория: закупка ${index}`,
    });
  },
  (index) => {
    const city = cities[(index + 4) % cities.length];
    const volume = 6 + index;
    const first = `Сеть кафе в ${city} проводит отбор поставщика молочной продукции объёмом ${volume} тонн в месяц.`;
    const second = `Контракт рассчитан на 12 месяцев, образцы продукции принимаются до конца сентября 2026 года.`;
    return relevant({
      actionKind: "CONTACT",
      actionRationale:
        "Регулярный объём и процедура образцов дают понятный следующий шаг поставщику.",
      actionTitle: "Передать образцы и условия поставки",
      category: "HORECA_PROCUREMENT",
      eventType: "FOOD_SUPPLIER_SELECTION",
      facts: [
        fact(
          "fact-1",
          first,
          `Сеть кафе выбирает поставщика ${volume} тонн молочной продукции ежемесячно.`,
        ),
        fact("fact-2", second, "Контракт длится 12 месяцев; образцы нужны до конца сентября."),
      ],
      importance: 66 + (index % 9),
      importanceReason: "Долгосрочная регулярная поставка имеет измеримый месячный объём.",
      summary: `Сеть кафе в ${city} отбирает годового поставщика ${volume} тонн продукции в месяц.`,
      text: `${first} ${second}`,
      title: `Отбор поставщика для сети кафе ${index}`,
    });
  },
  (index) => {
    const date = `${String(index).padStart(2, "0")}.02.2027`;
    const first = `С ${date} предприятия общепита обязаны указывать аллергены в электронном меню.`;
    const second = `Проверки нового требования начнутся через 30 дней после вступления нормы в силу.`;
    return relevant({
      actionKind: "ADJUST_PLAN",
      actionRationale: "Норма требует изменения меню и внутренних процессов до начала проверок.",
      actionTitle: "Обновить меню и контроль аллергенов",
      category: "HORECA_PROCUREMENT",
      eventType: "HORECA_REGULATION",
      facts: [
        fact("fact-1", first, `Обязательная маркировка аллергенов действует с ${date}.`),
        fact("fact-2", second, "Проверки начнутся через 30 дней после вступления нормы в силу."),
      ],
      importance: 62 + index,
      importanceReason: "Обязательное требование создаёт срок для изменения меню и учётных систем.",
      summary: `С ${date} общепиту нужно маркировать аллергены; проверки начнутся через 30 дней.`,
      text: `${first} ${second}`,
      title: `Маркировка аллергенов в меню: изменение ${index}`,
    });
  },
  (index) => {
    const city = cities[(index + 6) % cities.length];
    const area = 80 + index * 10;
    const first = `Торговый центр в ${city} открыл приём заявок на аренду помещения food hall площадью ${area} квадратных метров.`;
    const second = `Льготная ставка действует первые шесть месяцев, заявки принимаются до 15 ноября 2026 года.`;
    return relevant({
      actionKind: "REVIEW",
      actionRationale: "Нужно сопоставить площадь, льготный период и формат с моделью ресторана.",
      actionTitle: "Оценить площадку food hall",
      category: "HORECA_OPENING",
      eventType: "HORECA_LEASE",
      facts: [
        fact("fact-1", first, `В ${city} предлагается food hall площадью ${area} м².`),
        fact("fact-2", second, "Льготная ставка — шесть месяцев; срок заявок — 15 ноября."),
      ],
      importance: 56 + index,
      importanceReason: "Предложение содержит конкретную площадь, льготу и срок подачи.",
      summary: `Food hall площадью ${area} м² в ${city} принимает заявки до 15 ноября.`,
      text: `${first} ${second}`,
      title: `Аренда food hall в ${city}: предложение ${index}`,
    });
  },
  (index) => {
    const ingredient = ["кофе", "сливочное масло", "лосось", "какао", "оливковое масло"][index % 5];
    const delay = 3 + (index % 6);
    const change = 5 + index;
    const first = `Дистрибьютор предупредил рестораны о задержке поставок категории «${ingredient}» на ${delay} дней.`;
    const second = `Новые партии будут дороже на ${change}% из-за изменения закупочной цены.`;
    return relevant({
      actionKind: "VERIFY",
      actionRationale: "Следует подтвердить остатки и альтернативы до изменения меню или цен.",
      actionTitle: "Проверить запас и замену ингредиента",
      category: "HORECA_PROCUREMENT",
      eventType: "HORECA_SUPPLY_RISK",
      facts: [
        fact("fact-1", first, `Поставка «${ingredient}» задерживается на ${delay} дней.`),
        fact("fact-2", second, `Цена новых партий увеличится на ${change}%.`),
      ],
      importance: 60 + index,
      importanceReason: "Одновременно меняются срок и цена критичной товарной категории.",
      summary: `Поставки «${ingredient}» задерживаются на ${delay} дней и дорожают на ${change}%.`,
      text: `${first} ${second}`,
      title: `Риск поставки «${ingredient}»: сообщение ${index}`,
    });
  },
  (index) => {
    const participants = 300 + index * 100;
    const budget = 3 + index;
    const deadline = `${String(8 + index).padStart(2, "0")}.10.2026`;
    const first = `Организатор конференции объявил тендер на кейтеринг для ${participants} участников.`;
    const second = `Бюджет услуги — ${budget} млн рублей, заявки принимаются до ${deadline}.`;
    return relevant({
      actionKind: "PREPARE_OFFER",
      actionRationale: "Известны число гостей, бюджет и срок тендера.",
      actionTitle: "Рассчитать кейтеринговое предложение",
      category: "HORECA_PROCUREMENT",
      eventType: "CATERING_TENDER",
      facts: [
        fact("fact-1", first, `Тендер рассчитан на кейтеринг для ${participants} участников.`),
        fact("fact-2", second, `Бюджет ${budget} млн рублей; срок заявок ${deadline}.`),
      ],
      importance: 70 + (index % 7),
      importanceReason: "Разовая крупная услуга имеет понятные объём, бюджет и срок.",
      summary: `Кейтеринговый тендер для ${participants} участников с бюджетом ${budget} млн рублей.`,
      text: `${first} ${second}`,
      title: `Кейтеринг для конференции: тендер ${index}`,
    });
  },
  (index) => {
    const city = cities[(index + 1) % cities.length];
    const quote = `Городской гастрономический фестиваль в ${city} подвёл итоги конкурса любительских рецептов.`;
    return irrelevant({
      factStatement: `В ${city} завершился конкурс любительских рецептов.`,
      quote,
      summary: "Итоги любительского конкурса не содержат закупки или решения для бизнеса HoReCa.",
      text: `${quote} Участникам выпуска №${index} вручили памятные дипломы и сувениры.`,
      title: `Итоги фестиваля рецептов ${index}`,
    });
  },
  (index) => {
    const region = regions[(index + 2) % regions.length];
    const quote = `Библиотека в ${region} провела лекцию об истории ресторанной культуры.`;
    return irrelevant({
      factStatement: `В ${region} прошла историческая лекция о ресторанной культуре.`,
      quote,
      summary: "Образовательная заметка не содержит открытия, закупки, риска или делового срока.",
      text: `${quote} Запись встречи №${index} опубликована в бесплатном просветительском архиве.`,
      title: `Лекция об истории ресторанов ${index}`,
    });
  },
];

const publishedAt = (offset) =>
  new Date(Date.parse("2026-09-01T00:00:00.000Z") + offset * 60 * 60 * 1_000).toISOString();

const buildItems = (vertical, archetypes, sourceChoices, startingOffset) => {
  const items = [];
  for (const [archetypeIndex, archetype] of archetypes.entries()) {
    for (let variant = 1; variant <= 10; variant += 1) {
      const sequence = archetypeIndex * 10 + variant;
      const id = `eval-${vertical.toLowerCase()}-${String(sequence).padStart(3, "0")}`;
      const built = archetype(variant);
      const source = sourceChoices[(sequence - 1) % sourceChoices.length];
      items.push({
        id,
        labels: {
          category: built.category,
          eventType: built.eventType,
          expectedAction: built.expectedAction,
          facts: built.facts,
          importance: built.importance,
          relevant: built.relevant,
          summary: built.summary,
          vertical,
        },
        source: {
          originalUrl: `https://evals.radar.local/v1/${vertical.toLowerCase()}/${id}`,
          publishedAt: publishedAt(startingOffset + sequence),
          rightsBasis: "Синтетический материал создан проектом для локальной оценки качества",
          sourceId: source.sourceId,
          sourceName: source.sourceName,
          text: built.text,
          title: built.title,
        },
        split: variant <= 4 ? "CALIBRATION" : "HOLDOUT",
      });
    }
  }
  return items;
};

const items = [
  ...buildItems(
    "CONSTRUCTION",
    constructionArchetypes,
    [sources.constructionOfficial, sources.constructionMarket],
    0,
  ),
  ...buildItems("HORECA", horecaArchetypes, [sources.horecaOfficial, sources.horecaMarket], 100),
];

const dataset = {
  annotationPolicy: {
    factsRequireExactEvidenceQuote: true,
    status: "TECHNICAL_BASELINE",
    version: "eval-annotation-policy/v1",
  },
  createdAt,
  datasetId,
  items,
  language: "ru",
  provenance: {
    contentOrigin: "PROJECT_AUTHORED_SYNTHETIC",
    operationalSource: false,
    rightsBasis:
      "Все тексты и labels созданы внутри проекта; сторонний защищённый контент не копировался",
  },
  schemaVersion,
};

await mkdir(new URL("../fixtures/evals/v1/", import.meta.url), { recursive: true });
await writeFile(output, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
process.stdout.write(`Generated ${String(items.length)} eval items at ${output.pathname}\n`);
