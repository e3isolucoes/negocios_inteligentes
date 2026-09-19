import { getActiveOccurrence, statusOf } from '../../../js/dateUtils.js';

export const html = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const dateKey = (date) => date.toISOString().slice(0, 10);

export function collectAlerts(records, { daysAhead = 5, now = new Date() } = {}) {
  const byType = (type) => records.filter((record) => record.entityType === type);
  const completed = new Map();
  byType('completions').forEach((item) => {
    if (!completed.has(item.obligation_id)) completed.set(item.obligation_id, new Set());
    completed.get(item.obligation_id).add(item.occurrence_date);
  });
  const holidaysByWorkspace = new Map();
  byType('holidays').forEach((item) => {
    if (!holidaysByWorkspace.has(item.workspace_id)) holidaysByWorkspace.set(item.workspace_id, new Set());
    holidaysByWorkspace.get(item.workspace_id).add(item.holiday_date);
  });
  const overrides = new Map(byType('obligation_date_overrides').map((item) => [`${item.obligation_id}:${item.original_date}`, item]));

  return byType('obligations').flatMap((obligation) => {
    const original = getActiveOccurrence(obligation, completed, holidaysByWorkspace.get(obligation.workspace_id) || new Set(), now);
    if (!original) return [];
    const override = overrides.get(`${obligation.id}:${dateKey(original)}`);
    const due = override ? new Date(`${override.override_date}T00:00:00`) : original;
    const status = statusOf(due, now);
    return status.diffDays !== null && status.diffDays <= daysAhead ? [{ obligation, due, status, override }] : [];
  });
}

export function groupRecipients(records, alerts) {
  const profiles = records.filter((record) => record.entityType === 'profiles' && record.active !== false && record.email);
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const owners = new Map(); const managers = new Map();
  const append = (map, person, item) => {
    if (!map.has(person.id)) map.set(person.id, { person, items: [] });
    map.get(person.id).items.push(item);
  };
  alerts.forEach((item) => {
    const owner = byId.get(item.obligation.responsible_id);
    if (owner?.workspace_id === item.obligation.workspace_id) append(owners, owner, item);
    profiles.filter((profile) => profile.workspace_id === item.obligation.workspace_id && ['admin', 'gestor', 'manager'].includes(profile.role))
      .filter((profile) => profile.role === 'admin' || !item.obligation.module_key || (profile.module_access || []).includes(item.obligation.module_key))
      .forEach((profile) => append(managers, profile, item));
  });
  return { owners, managers };
}

export function renderItems(items, showOwner = false) {
  return [...items].sort((a, b) => a.due - b.due).map((item) => {
    const overdue = item.status.tone === 'red';
    const owner = showOwner ? ` · Responsável: ${html(item.obligation.responsible || 'não definido')}` : '';
    return `<li><strong style="color:${overdue ? '#A63D40' : '#A9791F'}">[${overdue ? 'Atrasada' : 'Vence em breve'}]</strong> ${html(item.obligation.name)} — ${dateKey(item.due).split('-').reverse().join('/')}${item.override ? ' · data ajustada' : ''}${owner}</li>`;
  }).join('');
}
