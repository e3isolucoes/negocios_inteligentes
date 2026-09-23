// LEGADO DE ROLLBACK MANUAL — NÃO AGENDADO. Requer Supabase service_role.
// =============================================================================
// Alertas diários por e-mail — obrigações atrasadas ou vencendo em breve.
// =============================================================================
// Roda fora do navegador (Node, via GitHub Actions agendado — veja
// .github/workflows/alertas-diarios.yml). Usa a service_role key do
// Supabase (que NUNCA deve ficar no front-end) para ler os dados sem
// depender de login, e a API da Resend (gratuita até 3.000 e-mails/mês)
// para enviar os e-mails.
//
// Formato do envio: um e-mail por pessoa, uma vez por dia, listando tudo
// que está atrasado ou vence nos próximos 5 dias. É um "lembrete diário"
// simples — a mesma pendência aparece de novo todo dia até ser concluída
// ou até o prazo passar da janela de 5 dias. Não guardamos "já mandei
// aviso disso" em lugar nenhum, de propósito: é mais fácil de entender e
// de depurar do que um sistema de deduplicação, e o "custo" de receber o
// mesmo lembrete de novo enquanto a pendência não é resolvida é baixo.
//
// Variáveis de ambiente necessárias (configuradas como Secrets no GitHub —
// veja o passo a passo no SETUP.md):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (Project Settings → API → service_role — NUNCA no front-end)
//   RESEND_API_KEY
//   ALERT_FROM_EMAIL            (ex.: "Painel de Obrigações <alertas@seudominio.com>")
//   ALERT_DAYS_AHEAD            (opcional, padrão "5" — avisa a partir de quantos dias antes)
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import {
  collectDeadlineAlerts, itemsHtml, mismatchItems, mismatchesHtml, recipientsForAlerts,
} from './alertas-core.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.ALERT_FROM_EMAIL;
const DAYS_AHEAD = parseInt(process.env.ALERT_DAYS_AHEAD || '5', 10);

function requireEnv() {
  const missing = [];
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!RESEND_API_KEY) missing.push('RESEND_API_KEY');
  if (!FROM_EMAIL) missing.push('ALERT_FROM_EMAIL');
  if (missing.length) {
    throw new Error(`Variáveis de ambiente faltando: ${missing.join(', ')}. Configure os Secrets no GitHub (veja SETUP.md).`);
  }
}

async function sendEmail({ to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend respondeu ${res.status}: ${body}`);
  }
}

async function main() {
  requireEnv();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const [{ data: obligations, error: e1 }, { data: completions, error: e2 }, { data: holidays, error: e3 }, { data: profiles, error: e4 }, { data: overrides, error: e5 }] = await Promise.all([
    supabase.from('obligations').select('*'),
    supabase.from('completions').select('*'),
    supabase.from('holidays').select('*'),
    supabase.from('profiles').select('*'),
    supabase.from('obligation_date_overrides').select('*'),
  ]);
  if (e1 || e2 || e3 || e4 || e5) throw (e1 || e2 || e3 || e4 || e5);

  const alerts = collectDeadlineAlerts({ obligations, completions, holidays, overrides, daysAhead: DAYS_AHEAD });
  const { responsible, managers } = recipientsForAlerts({ alerts, profiles });

  const obligationById = new Map(obligations.map((o) => [o.id, o]));
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentMismatches = mismatchItems({ completions, obligationById, since: oneDayAgo });
  let sentCount = 0;

  for (const { person, items } of responsible.values()) {
    await sendEmail({
      to: person.email,
      subject: `Painel de Obrigações — ${items.length} pendência(s) para você`,
      html: `<p>Olá, ${person.display_name || ''}.</p>`
        + `<p>Você tem ${items.length} obrigação(ões) atrasada(s) ou vencendo em breve:</p>`
        + `<ul>${itemsHtml(items)}</ul>`
        + '<p style="color:#5B6B70;font-size:12px;">Lembrete automático. Acesse o painel para atualizar ou concluir as atividades.</p>',
    });
    sentCount++;
  }

  // E-mail de visão geral para administradores, com tudo (não só o que é
  // deles) e também os comprovantes com competência divergente das
  // últimas 24h — mesmo quando não há nenhuma pendência de prazo, para o
  // gestor não depender só de abrir a Visão Executiva para saber disso.
  for (const { person, items } of managers.values()) {
    const workspaceMismatches = recentMismatches.filter((item) => item.obligation?.workspace_id === person.workspace_id);
    if (!items.length && !workspaceMismatches.length) continue;
    const pendingBlock = items.length
      ? `<p>Resumo das atividades atrasadas ou vencendo em breve na sua equipe:</p><ul>${itemsHtml(items, { showResponsible: true })}</ul>`
      : '<p>Nenhuma obrigação atrasada ou vencendo em breve na equipe hoje.</p>';
    const mismatchBlock = workspaceMismatches.length
      ? `<p style="margin-top:16px;">Comprovantes com possível divergência de competência nas últimas 24h:</p><ul>${mismatchesHtml(workspaceMismatches)}</ul>`
      : '';
    await sendEmail({
      to: person.email,
      subject: `Gestão de Atividades — resumo da equipe (${items.length} pendência(s), ${workspaceMismatches.length} divergência(s))`,
      html: pendingBlock + mismatchBlock
        + '<p style="color:#5B6B70;font-size:12px;">Resumo automático restrito ao seu ambiente e aos módulos sob sua gestão.</p>',
    });
    sentCount++;
  }

  console.log(`Concluído. ${sentCount} e-mail(is) enviado(s).`);
}

main().catch((err) => {
  console.error('Falha ao enviar alertas:', err);
  process.exit(1);
});
