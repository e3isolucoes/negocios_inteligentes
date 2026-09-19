import { MONTH_NAMES, MONTH_FULL } from './constants.js';

export function pad(n) {
  return String(n).padStart(2, '0');
}

export function fmtKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtBR(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function daysInMonth(y, mIdx) {
  return new Date(y, mIdx + 1, 0).getDate();
}

export function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Empurra a data para a frente (`proximo_util`) ou para trás
// (`anterior_util`) até cair num dia que não seja sábado(6), domingo(0)
// nem um feriado cadastrado em `holidaysSet` (Set de strings "YYYY-MM-DD").
// Não altera nada se `shift` for 'nenhum' (ou vazio/nulo) — usado quando a
// obrigação tem business_day_shift diferente de 'nenhum'.
export function shiftToBusinessDay(date, holidaysSet, shift) {
  if (!shift || shift === 'nenhum') return date;
  const step = shift === 'anterior_util' ? -1 : 1;
  const d = new Date(date);
  while (d.getDay() === 0 || d.getDay() === 6 || holidaysSet.has(fmtKey(d))) {
    d.setDate(d.getDate() + step);
  }
  return d;
}

// Rótulo curto para mostrar em listagens (Gerenciar → Regras/Obrigações).
export function businessDayShiftShortLabel(shift) {
  if (shift === 'proximo_util') return 'empurra p/ próximo dia útil';
  if (shift === 'anterior_util') return 'antecipa p/ dia útil anterior';
  return '';
}

// O "Nº-ésimo dia útil do mês" (ex.: 3º dia útil), contando a partir do
// dia 1 e pulando fins de semana e feriados cadastrados. Se o mês não
// tiver dias úteis suficientes (situação rara, só aconteceria com um "n"
// muito alto), cai no último dia útil encontrado no mês como resultado
// mais seguro em vez de estourar para o mês seguinte silenciosamente.
export function nthBusinessDayOfMonth(year, monthIdx, n, holidaysSet) {
  const dim = daysInMonth(year, monthIdx);
  let count = 0;
  let lastBusinessDay = null;
  for (let day = 1; day <= dim; day++) {
    const d = new Date(year, monthIdx, day);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const isHoliday = holidaysSet.has(fmtKey(d));
    if (!isWeekend && !isHoliday) {
      count++;
      lastBusinessDay = d;
      if (count === n) return d;
    }
  }
  return lastBusinessDay || new Date(year, monthIdx, dim);
}

// Calcula a data "crua" de uma ocorrência (dia fixo do mês OU Nº-ésimo dia
// útil, dependendo de ob.day_type) para um determinado ano/mês.
function rawOccurrenceDate(ob, year, monthIdx, holidaysSet) {
  if (ob.day_type === 'util_do_mes') {
    return nthBusinessDayOfMonth(year, monthIdx, ob.day_of_month, holidaysSet);
  }
  const dim = daysInMonth(year, monthIdx);
  const day = Math.min(ob.day_of_month, dim);
  return new Date(year, monthIdx, day);
}

// Todas as ocorrências de uma obrigação dentro do intervalo [from, to].
// `holidaysSet` é opcional (Set de strings "YYYY-MM-DD"); é usado sempre
// que a obrigação tem day_type = 'util_do_mes', e também quando tem
// business_day_shift diferente de 'nenhum'.
export function occurrencesInRange(ob, from, to, holidaysSet = new Set()) {
  const res = [];
  const push = (raw) => {
    const dd = shiftToBusinessDay(raw, holidaysSet, ob.business_day_shift);
    if (dd >= from && dd <= to) res.push(dd);
  };

  if (ob.frequency === 'pontual') {
    push(new Date(`${ob.due_date}T00:00:00`));
    return res;
  }

  if (ob.frequency === 'diaria') {
    const current = new Date(from);
    current.setHours(0, 0, 0, 0);
    while (current <= to) {
      // A recorrência diária representa cada dia do calendário. Não se
      // aplica deslocamento de dia útil, pois sábado/domingo convergiriam
      // para a mesma segunda-feira e criariam ocorrências duplicadas.
      res.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return res;
  }

  if (ob.frequency === 'anual') {
    const y0 = from.getFullYear() - 1;
    const yEnd = to.getFullYear() + 1;
    for (let y = y0; y <= yEnd; y++) {
      push(rawOccurrenceDate(ob, y, ob.month - 1, holidaysSet));
    }
    return res;
  }

  if (ob.frequency === 'trimestral') {
    const y0 = from.getFullYear() - 1;
    const yEnd = to.getFullYear() + 1;
    for (let y = y0; y <= yEnd; y++) {
      (ob.months || []).forEach((m) => {
        push(rawOccurrenceDate(ob, y, m - 1, holidaysSet));
      });
    }
    res.sort((a, b) => a - b);
    return res;
  }

  if (ob.frequency === 'mensal') {
    let cur = new Date(from.getFullYear(), from.getMonth() - 1, 1);
    const end = new Date(to.getFullYear(), to.getMonth() + 2, 1);
    while (cur < end) {
      push(rawOccurrenceDate(ob, cur.getFullYear(), cur.getMonth(), holidaysSet));
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
    return res;
  }

  return res;
}

// Próxima ocorrência ainda não concluída (janela de -90/+180 dias).
export function getActiveOccurrence(ob, completionsByObligation, holidaysSet = new Set()) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const from = new Date(today);
  from.setDate(from.getDate() - 90);
  const to = new Date(today);
  to.setDate(to.getDate() + 180);

  const occs = occurrencesInRange(ob, from, to, holidaysSet).sort((a, b) => a - b);
  const done = completionsByObligation.get(ob.id) || new Set();
  for (const occ of occs) {
    if (!done.has(fmtKey(occ))) return occ;
  }
  return null;
}

export function statusOf(activeDate) {
  if (!activeDate) return { label: 'Sem pendência próxima', tone: 'muted', diffDays: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((activeDate - today) / 86400000);
  if (diffDays < 0) return { label: 'Atrasada', tone: 'red', diffDays };
  if (diffDays <= 5) return { label: 'Vence em breve', tone: 'amber', diffDays };
  return { label: 'No prazo', tone: 'green', diffDays };
}

export function deltaLabel(diffDays) {
  if (diffDays === null || diffDays === undefined) return '—';
  if (diffDays === 0) return 'vence hoje';
  if (diffDays > 0) return `em ${diffDays}${diffDays > 1 ? ' dias' : ' dia'}`;
  const a = Math.abs(diffDays);
  return `há ${a}${a > 1 ? ' dias' : ' dia'}`;
}

export function trackPercent(diffDays) {
  const c = Math.max(-15, Math.min(30, diffDays));
  return ((c - -15) / 45) * 100;
}

export function freqSummary(ob) {
  const dayLabel = ob.day_type === 'util_do_mes' ? `${ob.day_of_month}º dia útil` : `dia ${ob.day_of_month}`;
  if (ob.frequency === 'diaria') return 'Todos os dias da semana';
  if (ob.frequency === 'mensal') return `Todo ${dayLabel} do mês`;
  if (ob.frequency === 'anual') return `${MONTH_FULL[ob.month - 1]} — ${dayLabel}`;
  if (ob.frequency === 'trimestral') {
    const months = (ob.months || []).map((m) => MONTH_NAMES[m - 1]).join(', ');
    return `${dayLabel} em: ${months}`;
  }
  if (ob.frequency === 'pontual') {
    return `Data única: ${ob.due_date ? fmtBR(new Date(`${ob.due_date}T00:00:00`)) : '—'}`;
  }
  return '';
}

// Progresso do checklist na última conclusão, para exibir na listagem sem
// abrir o modal. `checklist_total`/`checklist_checked` ficam nulos em
// conclusões sem checklist ou registradas antes dessa coluna existir —
// nesses casos não há nada a mostrar.
export function checklistProgressLabel(completion) {
  if (!completion || !completion.checklist_total) return '';
  return `Checklist: ${completion.checklist_checked}/${completion.checklist_total} concluído`;
}
