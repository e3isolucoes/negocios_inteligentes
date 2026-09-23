import { fmtBR, getActiveOccurrence, statusOf } from '../js/dateUtils.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function overrideKey(obligationId, originalDate) {
  return `${obligationId}:${originalDate.toISOString().slice(0, 10)}`;
}

export function collectDeadlineAlerts({ obligations, completions, holidays, overrides = [], daysAhead = 5, now = new Date() }) {
  const holidaysSet = new Set(holidays.map((item) => item.holiday_date));
  const completed = new Map();
  completions.forEach((item) => {
    if (!completed.has(item.obligation_id)) completed.set(item.obligation_id, new Set());
    completed.get(item.obligation_id).add(item.occurrence_date);
  });
  const overrideMap = new Map(overrides.map((item) => [`${item.obligation_id}:${item.original_date}`, item]));

  return obligations.flatMap((ob) => {
    const originalOccurrence = getActiveOccurrence(ob, completed, holidaysSet, now);
    if (!originalOccurrence) return [];
    const override = overrideMap.get(overrideKey(ob.id, originalOccurrence));
    const occurrence = override ? new Date(`${override.override_date}T00:00:00`) : originalOccurrence;
    const status = statusOf(occurrence, now);
    if (status.diffDays === null || status.diffDays > daysAhead) return [];
    return [{ ob, occurrence, originalOccurrence, override, status }];
  });
}

export function recipientsForAlerts({ alerts, profiles }) {
  const activeProfiles = profiles.filter((profile) => profile.active !== false && profile.email);
  const profileById = new Map(activeProfiles.map((profile) => [profile.id, profile]));
  const responsible = new Map();
  const managers = new Map();

  alerts.forEach((item) => {
    const owner = profileById.get(item.ob.responsible_id);
    if (owner && (!item.ob.workspace_id || owner.workspace_id === item.ob.workspace_id)) {
      if (!responsible.has(owner.id)) responsible.set(owner.id, { person: owner, items: [] });
      responsible.get(owner.id).items.push(item);
    }

    activeProfiles
      .filter((profile) => ['admin', 'gestor'].includes(profile.role) && profile.workspace_id === item.ob.workspace_id)
      .filter((profile) => profile.role === 'admin' || !item.ob.module_key || (profile.module_access || []).includes(item.ob.module_key))
      .forEach((profile) => {
        if (!managers.has(profile.id)) managers.set(profile.id, { person: profile, items: [] });
        managers.get(profile.id).items.push(item);
      });
  });

  return { responsible, managers };
}

export function itemsHtml(items, { showResponsible = false } = {}) {
  return [...items].sort((a, b) => a.occurrence - b.occurrence).map((item) => {
    const overdue = item.status.tone === 'red';
    const label = overdue ? 'Atrasada' : 'Vence em breve';
    const color = overdue ? '#A63D40' : '#A9791F';
    const owner = showResponsible ? ` · Responsável: ${escapeHtml(item.ob.responsible || 'não definido')}` : '';
    const adjusted = item.override ? ' · data ajustada' : '';
    return `<li style="margin-bottom:8px;"><strong style="color:${color};">[${label}]</strong> ${escapeHtml(item.ob.name)} — vencimento ${fmtBR(item.occurrence)}${adjusted}${owner}</li>`;
  }).join('');
}

export function mismatchItems({ completions, obligationById, since }) {
  return completions.filter((item) => item.ocr_status === 'mismatch' && item.done_at >= since).map((item) => ({
    ...item,
    obligation: obligationById.get(item.obligation_id),
  }));
}

export function mismatchesHtml(items) {
  return items.map((item) => `<li style="margin-bottom:8px;"><strong style="color:#A9791F;">[Divergência de competência]</strong> ${escapeHtml(item.obligation?.name || 'Atividade removida')} — comprovante ${escapeHtml(item.ocr_extracted_period || 'sem competência identificada')} (ocorrência ${escapeHtml(item.occurrence_date)}), concluído por ${escapeHtml(item.done_by_name || 'usuário não identificado')}</li>`).join('');
}
