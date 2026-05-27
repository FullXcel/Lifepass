function condition(field, op, value, label) {
  if (value === undefined || value === null || value === '') return null;
  return { field, op, value, label };
}

export function generateRuleFromPolicySignals(signals = {}) {
  const all = [];
  if (signals.age_range) all.push(condition('age', 'between', signals.age_range, `만 ${signals.age_range[0]}~${signals.age_range[1]}세`));
  if (signals.regions?.length === 1) all.push(condition('region', '==', signals.regions[0], `${signals.regions[0]} 거주`));
  if (signals.regions?.length > 1) all.push(condition('region', 'in', signals.regions, `해당 지역: ${signals.regions.join(', ')}`));
  if (signals.rent_cap) all.push(condition('rent', '<=', signals.rent_cap, `월세 ${signals.rent_cap.toLocaleString()}원 이하`));
  if (signals.deposit_cap) all.push(condition('deposit', '<=', signals.deposit_cap, `보증금 ${signals.deposit_cap.toLocaleString()}원 이하`));
  const incomeCap = Math.min(...(signals.income_percent_criteria || []).filter((n) => Number.isFinite(n)));
  if (Number.isFinite(incomeCap)) all.push(condition('income_percent_median', '<=', incomeCap, `기준 중위소득 ${incomeCap}% 이하`));
  if (signals.required_docs?.some((doc) => /임대차|월세/.test(doc))) {
    all.push(condition('has_housing_contract', '==', true, '임대차계약 확인 가능'));
  }
  return { all: all.filter(Boolean) };
}

export function generateWarningRuleFromPolicySignals(signals = {}) {
  const incomeCap = Math.min(...(signals.income_percent_criteria || []).filter((n) => Number.isFinite(n)));
  if (Number.isFinite(incomeCap)) {
    return {
      field: 'income_percent_median',
      op: 'between',
      value: [Math.max(0, incomeCap - 10), incomeCap + 10],
      label: `소득 기준 ${incomeCap}% 근처: 소득 변동 시 탈락 가능`,
    };
  }
  return null;
}
