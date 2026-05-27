export const OFFICIAL_POLICY_SOURCES = [
  {
    id: 'bokjiro-central-welfare',
    label: '복지로 중앙부처 복지서비스',
    priority: 100,
    strategy: 'official_api',
    apiBaseEnv: 'BOKJIRO_CENTRAL_API_URL',
    apiKeyEnv: 'BOKJIRO_SERVICE_KEY',
    enabledEnv: 'ENABLE_BOKJIRO_CENTRAL',
    defaultEnabled: true,
    note: '공식 API가 제공하는 목록·상세 데이터를 우선 수집합니다.',
  },
  {
    id: 'bokjiro-local-welfare',
    label: '복지로 지자체 복지서비스',
    priority: 90,
    strategy: 'official_api',
    apiBaseEnv: 'BOKJIRO_LOCAL_API_URL',
    apiKeyEnv: 'BOKJIRO_SERVICE_KEY',
    enabledEnv: 'ENABLE_BOKJIRO_LOCAL',
    defaultEnabled: true,
    note: '지역별 복지서비스 상세를 수집해 중앙 정책과 분리 저장합니다.',
  },
  {
    id: 'gov24-benefits',
    label: '정부24/공공서비스 혜택 정보',
    priority: 80,
    strategy: 'official_api',
    apiBaseEnv: 'GOV24_BENEFIT_API_URL',
    apiKeyEnv: 'GOV24_SERVICE_KEY',
    enabledEnv: 'ENABLE_GOV24_BENEFITS',
    defaultEnabled: true,
    note: '보조금·공공서비스성 혜택 정보를 정책 후보로 수집합니다.',
  },
  {
    id: 'local-notice-allowlist',
    label: '허용된 지자체 공고문 보조 수집',
    priority: 30,
    strategy: 'crawl_allowlist',
    urlListEnv: 'LOCAL_NOTICE_URLS',
    enabledEnv: 'ENABLE_LOCAL_NOTICE_CRAWLER',
    defaultEnabled: false,
    note: 'API 반영이 늦은 지자체 공고만 allowlist URL에서 보조 수집합니다.',
  },
];

export function enabledSources(env = process.env) {
  return OFFICIAL_POLICY_SOURCES.filter((source) => {
    const raw = env[source.enabledEnv];
    if (raw === undefined || raw === '') return source.defaultEnabled;
    return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
  });
}
