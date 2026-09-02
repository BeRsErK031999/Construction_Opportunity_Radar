import { mkdir, writeFile } from "node:fs/promises";

const createdAt = "2026-09-01T00:00:00.000Z";
const datasetId = "construction-opportunity-radar-ingestion-v1";
const schemaVersion = "fixture-ingestion/v1";
const output = new URL("../fixtures/ingestion/v1/dataset.json", import.meta.url);

const sourceDefinitions = [
  ["CONSTRUCTION", "construction-registry-altai", "Реестр строительных проектов Алтая"],
  ["CONSTRUCTION", "construction-tenders-siberia", "Строительные закупки Сибири"],
  ["CONSTRUCTION", "construction-permits-novosibirsk", "Разрешения на строительство Новосибирска"],
  ["CONSTRUCTION", "construction-review-lab", "Строительные материалы на проверке прав"],
  ["HORECA", "horeca-openings-siberia", "Открытия HoReCa Сибири"],
  ["HORECA", "horeca-procurement-altai", "Закупки HoReCa Алтая"],
  ["HORECA", "horeca-hospitality-news", "Новости гостеприимства"],
  ["HORECA", "horeca-supplier-feed", "Партнёрский фид поставщиков HoReCa"],
  ["OTHER", "other-public-notices", "Прочие публичные уведомления"],
  ["OTHER", "other-promo-feed", "Прочие рекламные материалы"],
];

const sources = sourceDefinitions.map(([vertical, slug, name], index) => {
  const reviewRequired = slug === "construction-review-lab";
  return {
    aiProcessingAllowed: !reviewRequired,
    country: "RU",
    id: `61000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name,
    regions:
      vertical === "CONSTRUCTION"
        ? ["Алтайский край", "Новосибирская область"]
        : vertical === "HORECA"
          ? ["Новосибирская область", "Республика Алтай"]
          : ["Сибирский федеральный округ"],
    reliabilityScore: 78 + index,
    rightsBasis: reviewRequired
      ? null
      : "Синтетический материал создан проектом для локальной разработки",
    rightsStatus: reviewRequired ? "REVIEW_REQUIRED" : "CONSENT",
    url: `https://fixtures.radar.local/v1/sources/${slug}`,
    verticals: [vertical],
  };
});

const configurations = [
  {
    advertisementCount: 10,
    exactCount: 13,
    nearCount: 12,
    originalCount: 75,
    sourceIndexes: [0, 1, 2, 3],
    vertical: "CONSTRUCTION",
  },
  {
    advertisementCount: 5,
    exactCount: 10,
    nearCount: 10,
    originalCount: 60,
    sourceIndexes: [4, 5, 6, 7],
    vertical: "HORECA",
  },
  {
    advertisementCount: 5,
    exactCount: 2,
    nearCount: 3,
    originalCount: 15,
    sourceIndexes: [8, 9],
    vertical: "OTHER",
  },
];

const constructionRegions = ["Барнаул", "Бийск", "Новоалтайск", "Новосибирск", "Искитим"];
const horecaRegions = ["Новосибирск", "Белокуриха", "Горно-Алтайск", "Барнаул", "Бердск"];

const materialText = (vertical, index, advertisement) => {
  const number = String(index).padStart(3, "0");
  if (advertisement) {
    if (vertical === "CONSTRUCTION") {
      return `Реклама ${number}: скидка на строительные смеси и доставку до объекта. Оставьте заявку на коммерческое предложение.`;
    }
    if (vertical === "HORECA") {
      return `Реклама ${number}: профессиональное оборудование для ресторанов со скидкой. Закажите консультацию поставщика.`;
    }
    return `Реклама ${number}: универсальные офисные услуги по специальной цене. Акция действует ограниченное время.`;
  }

  if (vertical === "CONSTRUCTION") {
    const region = constructionRegions[(index - 1) % constructionRegions.length];
    const budget = 40 + index * 3;
    return `Извещение ${number}: в городе ${region} запланированы строительно-монтажные работы. Бюджет ${budget} млн рублей, приём заявок до ${String((index % 27) + 1).padStart(2, "0")}.10.2026.`;
  }
  if (vertical === "HORECA") {
    const region = horecaRegions[(index - 1) % horecaRegions.length];
    const places = 40 + index;
    return `Сообщение ${number}: в городе ${region} готовится открытие объекта HoReCa на ${places} посадочных мест. Идёт отбор поставщиков оборудования и продуктов.`;
  }
  return `Уведомление ${number}: опубликована информация общего назначения о городском мероприятии и наборе волонтёров. Коммерческих закупок для Construction или HoReCa не заявлено.`;
};

const publishedAt = (offset) =>
  new Date(Date.parse(createdAt) + (offset + 1) * 60 * 60 * 1_000).toISOString();

const items = [];
let publicationOffset = 0;

for (const configuration of configurations) {
  const originals = [];
  const verticalSlug = configuration.vertical.toLowerCase();
  const advertisementStart = configuration.originalCount - configuration.advertisementCount + 1;

  for (let index = 1; index <= configuration.originalCount; index += 1) {
    const sourcePosition = (index - 1) % configuration.sourceIndexes.length;
    const sourceIndex = configuration.sourceIndexes[sourcePosition];
    const advertisement = index >= advertisementStart;
    const fixtureId = `${verticalSlug}-original-${String(index).padStart(3, "0")}`;
    originals.push({
      externalId: fixtureId,
      fixtureId,
      labels: {
        duplicateGroup: null,
        duplicateKind: null,
        isAdvertisement: advertisement,
        vertical: configuration.vertical,
      },
      originalUrl: `${sources[sourceIndex].url}/items/${fixtureId}`,
      publishedAt: publishedAt(publicationOffset),
      rawText: materialText(configuration.vertical, index, advertisement),
      sourceId: sources[sourceIndex].id,
      sourcePosition,
    });
    publicationOffset += 1;
  }

  const createDuplicate = (base, duplicateKind, duplicateNumber) => {
    const sourcePosition = (base.sourcePosition + 1) % configuration.sourceIndexes.length;
    const sourceIndex = configuration.sourceIndexes[sourcePosition];
    const group = `${verticalSlug}-${duplicateKind.toLowerCase()}-${String(duplicateNumber).padStart(3, "0")}`;
    base.labels = {
      ...base.labels,
      duplicateGroup: group,
      duplicateKind: "ORIGINAL",
    };
    const fixtureId = `${group}-${duplicateKind.toLowerCase()}`;
    const rawText =
      duplicateKind === "EXACT"
        ? base.rawText
        : `${base.rawText} Обновление: срок ответа продлён на один рабочий день.`;
    return {
      externalId: fixtureId,
      fixtureId,
      labels: {
        ...base.labels,
        duplicateKind,
      },
      originalUrl: `${sources[sourceIndex].url}/items/${fixtureId}`,
      publishedAt: publishedAt(publicationOffset),
      rawText,
      sourceId: sources[sourceIndex].id,
      sourcePosition,
    };
  };

  const duplicates = [];
  for (let index = 0; index < configuration.exactCount; index += 1) {
    duplicates.push(createDuplicate(originals[index], "EXACT", index + 1));
    publicationOffset += 1;
  }
  for (let index = 0; index < configuration.nearCount; index += 1) {
    const original = originals[configuration.exactCount + index];
    duplicates.push(createDuplicate(original, "NEAR", index + 1));
    publicationOffset += 1;
  }

  items.push(...originals, ...duplicates);
}

const serializedItems = items.map(({ sourcePosition: _sourcePosition, ...item }) => ({
  ...item,
  rawPayload: {
    datasetId,
    duplicateGroup: item.labels.duplicateGroup,
    duplicateKind: item.labels.duplicateKind,
    fixtureId: item.fixtureId,
    schemaVersion,
    isAdvertisement: item.labels.isAdvertisement,
    vertical: item.labels.vertical,
  },
}));

const dataset = {
  createdAt,
  datasetId,
  items: serializedItems,
  schemaVersion,
  sources,
};

await mkdir(new URL("../fixtures/ingestion/v1/", import.meta.url), { recursive: true });
await writeFile(output, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
process.stdout.write(`Generated ${serializedItems.length} fixtures at ${output.pathname}\n`);
