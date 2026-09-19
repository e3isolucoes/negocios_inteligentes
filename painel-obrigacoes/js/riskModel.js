// Previsão local e explicável: aprende com as conclusões já registradas, sem
// enviar dados a serviços externos. Cada característica recebe uma taxa de
// atraso suavizada (para poucos registros não virarem uma certeza) e as taxas
// são combinadas conforme a quantidade de exemplos disponível.
const MIN_TRAINING_ROWS = 5;
const PRIOR_STRENGTH = 4;

function dateKey(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function wasLate(completion) {
  return dateKey(completion.done_at) > completion.occurrence_date;
}

function featureValues(obligation) {
  return [
    ['esta obrigação', `ob:${obligation.id}`],
    ['esta empresa', `company:${obligation.company_id || 'none'}`],
    ['esta categoria', `category:${obligation.category || 'none'}`],
    ['este responsável', `owner:${obligation.responsible_id || obligation.responsible || 'none'}`],
  ];
}

export function trainDelayRiskModel(obligations, completions) {
  const obligationsById = new Map(obligations.map((ob) => [ob.id, ob]));
  const usable = completions.filter((c) => obligationsById.has(c.obligation_id) && c.done_at && c.occurrence_date);
  const globalLate = usable.filter(wasLate).length;
  const globalRate = usable.length ? globalLate / usable.length : 0;
  const groups = new Map();

  usable.forEach((completion) => {
    const late = wasLate(completion) ? 1 : 0;
    featureValues(obligationsById.get(completion.obligation_id)).forEach(([, key]) => {
      const value = groups.get(key) || { total: 0, late: 0 };
      value.total += 1;
      value.late += late;
      groups.set(key, value);
    });
  });

  return {
    sampleSize: usable.length,
    ready: usable.length >= MIN_TRAINING_ROWS,
    predict(obligation) {
      if (usable.length < MIN_TRAINING_ROWS) return null;
      let weightedRate = globalRate * PRIOR_STRENGTH;
      let weight = PRIOR_STRENGTH;
      const signals = [];

      featureValues(obligation).forEach(([label, key]) => {
        const group = groups.get(key);
        if (!group) return;
        const smoothedRate = (group.late + (globalRate * PRIOR_STRENGTH)) / (group.total + PRIOR_STRENGTH);
        const groupWeight = Math.min(group.total, 8);
        weightedRate += smoothedRate * groupWeight;
        weight += groupWeight;
        if (group.total >= 2 && smoothedRate > globalRate) signals.push({ label, rate: smoothedRate, total: group.total });
      });

      const probability = Math.round((weightedRate / weight) * 100);
      const strongest = signals.sort((a, b) => b.rate - a.rate || b.total - a.total)[0];
      return {
        probability,
        level: probability >= 60 ? 'high' : probability >= 35 ? 'medium' : 'low',
        reason: strongest
          ? `${strongest.label} atrasou com mais frequência no histórico`
          : 'o histórico geral disponível indica este nível de atenção',
      };
    },
  };
}
