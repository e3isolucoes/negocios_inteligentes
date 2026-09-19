import { STATE, activeOccurrences } from '../state.js';
import { escapeHtml } from '../dateUtils.js';

const ACTION_LABELS = { insert: 'criou', update: 'alterou', delete: 'excluiu' };
const ACTION_TONE = { insert: 'green', update: 'amber', delete: 'red' };

// Campos que definem quando uma obrigação vence — mudar um deles é o tipo
// de edição que vale mais atenção quando acontece perto do vencimento.
const DEADLINE_FIELDS = ['due_date', 'day_of_month', 'month', 'months'];
// Janela para considerar uma criação como possível "recriação" de algo
// excluído pouco antes, em vez de coincidência de nome.
const RECREATE_WINDOW_MS = 48 * 60 * 60 * 1000;

function summarizeDiff(entry) {
  if (entry.action === 'update' && entry.diff?.antes && entry.diff?.depois) {
    const antes = entry.diff.antes;
    const depois = entry.diff.depois;
    const changed = Object.keys(depois).filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(depois[k]) && k !== 'updated_at');
    if (!changed.length) return '';
    return `Campos alterados: ${changed.join(', ')}`;
  }
  const name = entry.diff?.name;
  return name ? `"${name}"` : '';
}

// Sinaliza um "delete" seguido de um "insert" com o mesmo nome pouco
// depois — pode ser só coincidência (empresa recadastrou algo do zero),
// mas também pode ser alguém tentando apagar o rastro de uma obrigação
// (excluir e recriar "limpa" o vínculo com o histórico antigo daquele id).
function detectDeleteRecreate(auditLog) {
  const flagged = new Map(); // entry.id -> motivo
  const deletes = auditLog.filter((e) => e.action === 'delete' && e.diff?.name);
  const inserts = auditLog.filter((e) => e.action === 'insert' && e.diff?.name);

  deletes.forEach((del) => {
    const delName = del.diff.name.trim().toLowerCase();
    const delTime = new Date(del.changed_at).getTime();
    const match = inserts.find((ins) => (
      ins.row_id !== del.row_id
      && ins.diff.name.trim().toLowerCase() === delName
      && new Date(ins.changed_at).getTime() > delTime
      && new Date(ins.changed_at).getTime() - delTime <= RECREATE_WINDOW_MS
    ));
    if (match) {
      flagged.set(del.id, `Excluída e recriada com o mesmo nome em menos de 48h (recriada por ${match.changed_by_name || 'alguém'})`);
      flagged.set(match.id, `Recriada com o mesmo nome de uma obrigação excluída pouco antes (excluída por ${del.changed_by_name || 'alguém'})`);
    }
  });

  return flagged;
}

// Sinaliza uma edição de campo de vencimento (due_date/day_of_month/month/
// months) numa obrigação que, hoje, está atrasada ou vencendo em breve —
// não prova má-fé (pode ser correção legítima de um erro de cadastro),
// mas é o tipo de mudança que vale conferir com quem editou.
function detectUrgentDeadlineEdits(auditLog) {
  const flagged = new Map();
  const activeByObligationId = new Map(activeOccurrences().map((it) => [it.ob.id, it]));

  auditLog.forEach((e) => {
    if (e.action !== 'update' || !e.diff?.antes || !e.diff?.depois) return;
    const changedFields = DEADLINE_FIELDS.filter((f) => JSON.stringify(e.diff.antes[f]) !== JSON.stringify(e.diff.depois[f]));
    if (!changedFields.length) return;

    const current = activeByObligationId.get(e.row_id);
    if (current && (current.status.tone === 'red' || current.status.tone === 'amber')) {
      flagged.set(e.id, `Alterou campo(s) de vencimento (${changedFields.join(', ')}) numa obrigação que hoje está "${current.status.label.toLowerCase()}"`);
    }
  });

  return flagged;
}

export function renderAuditManage() {
  if (STATE.auditLog === null) {
    return '<div class="empty">Carregando histórico…</div>';
  }
  if (!STATE.auditLog.length) {
    return '<div class="empty">Nenhum registro de alteração ainda.</div>';
  }

  const anomalies = new Map([
    ...detectDeleteRecreate(STATE.auditLog),
    ...detectUrgentDeadlineEdits(STATE.auditLog),
  ]);

  let html = '<div class="empty" style="text-align:left;padding:14px 16px;margin-bottom:14px;">'
    + 'Mostra as últimas 200 criações, edições e exclusões de obrigações, com quem fez e quando. '
    + `Linhas com <span class="status-pill tone-red">⚠ Anomalia</span> foram sinalizadas por heurísticas simples `
    + '(exclusão seguida de recriação rápida, ou alteração de prazo numa obrigação hoje urgente) — vale conferir, não é acusação automática. '
    + 'Visível só para administradores.'
    + '</div>';

  html += STATE.auditLog.map((e) => {
    const when = new Date(e.changed_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const summary = summarizeDiff(e);
    const anomalyReason = anomalies.get(e.id);
    return '<div class="mgmt-row">'
      + '<div class="mgmt-main">'
        + `<div class="mgmt-name"><span class="status-pill tone-${ACTION_TONE[e.action]}">${ACTION_LABELS[e.action] || e.action}</span>${anomalyReason ? ' <span class="status-pill tone-red">⚠ Anomalia</span>' : ''} ${escapeHtml(e.changed_by_name || 'sistema')}</div>`
        + `<div class="mgmt-sub">${when}${summary ? ` · ${escapeHtml(summary)}` : ''}</div>`
        + (anomalyReason ? `<div class="mgmt-sub" style="color:var(--red);">${escapeHtml(anomalyReason)}</div>` : '')
      + '</div>'
    + '</div>';
  }).join('');

  return html;
}
