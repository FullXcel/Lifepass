const STOPWORDS = new Set(['지원', '신청', '대상', '내용', '사업', '정책', '제도', '및', '또는', '그리고', '있는', '없는']);

export function tokenize(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

export function buildSearchIndex(policies = []) {
  const index = {};
  for (const policy of policies) {
    const text = [policy.name, policy.description, policy.target, policy.domain, ...(policy.required_docs || [])].join(' ');
    const terms = new Set(tokenize(text));
    for (const term of terms) {
      if (!index[term]) index[term] = [];
      index[term].push(policy.id);
    }
  }
  return { generated_at: new Date().toISOString(), index };
}

export function searchPolicies(query = '', policies = [], indexDoc = null, limit = 20) {
  const terms = tokenize(query);
  if (!terms.length) return policies.slice(0, limit);
  const index = indexDoc?.index || buildSearchIndex(policies).index;
  const scores = new Map();
  for (const term of terms) {
    for (const id of index[term] || []) scores.set(id, (scores.get(id) || 0) + 1);
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => policies.find((p) => p.id === id))
    .filter(Boolean)
    .slice(0, limit);
}
