import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { collectAlerts, groupRecipients, html, renderItems } from './notification-core.mjs';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESv2Client({});

async function loadRecords() {
  const records = []; let ExclusiveStartKey;
  do {
    const page = await dynamo.send(new ScanCommand({
      TableName: process.env.TABLE_NAME,
      ProjectionExpression: 'id, entityType, workspace_id, email, display_name, active, #role, module_access, obligation_id, occurrence_date, holiday_date, original_date, override_date, responsible_id, responsible, module_key, #name, frequency, due_date, day_type, day_of_month, #month, months, business_day_shift',
      ExpressionAttributeNames: { '#role': 'role', '#name': 'name', '#month': 'month' },
      ExclusiveStartKey
    }));
    records.push(...(page.Items || [])); ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return records;
}

async function send(to, subject, body) {
  await ses.send(new SendEmailCommand({ FromEmailAddress: process.env.NOTIFICATION_FROM_EMAIL, Destination: { ToAddresses: [to] }, Content: { Simple: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Html: { Data: body, Charset: 'UTF-8' } } } } }));
}

export async function handler(event = {}) {
  const records = await loadRecords();
  const alerts = collectAlerts(records, { daysAhead: Number(process.env.NOTIFICATION_DAYS_AHEAD || 5) });
  const { owners, managers } = groupRecipients(records, alerts);
  const planned = owners.size + managers.size;
  if (event.dryRun === true) {
    console.log(JSON.stringify({ level: 'info', event: 'notification_dry_run', records: records.length, alerts: alerts.length, planned, requestId: event.id }));
    return { records: records.length, alerts: alerts.length, planned, sent: 0, dryRun: true };
  }
  if (event.testRecipient) {
    const recipient = String(event.testRecipient).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error('testRecipient inválido');
    await send(recipient, `Gestão de Atividades — teste (${alerts.length} alerta(s))`, `<p>Este é um teste controlado das notificações.</p><p>Foram encontrados <strong>${alerts.length}</strong> alertas e <strong>${planned}</strong> envios seriam realizados.</p><ul>${renderItems(alerts, true)}</ul>`);
    console.log(JSON.stringify({ level: 'info', event: 'notification_test', records: records.length, alerts: alerts.length, planned, sent: 1, requestId: event.id }));
    return { records: records.length, alerts: alerts.length, planned, sent: 1, test: true };
  }
  let sent = 0;
  for (const { person, items } of owners.values()) {
    await send(person.email, `Gestão de Atividades — ${items.length} pendência(s) para você`, `<p>Olá, ${html(person.display_name || '')}.</p><p>Estas atividades precisam de atenção:</p><ul>${renderItems(items)}</ul><p>Acesse o Portal E3I para atualizar o andamento.</p>`);
    sent += 1;
  }
  for (const { person, items } of managers.values()) {
    await send(person.email, `Gestão de Atividades — resumo da equipe (${items.length})`, `<p>Olá, ${html(person.display_name || '')}.</p><p>Resumo das atividades que precisam de atenção no seu ambiente:</p><ul>${renderItems(items, true)}</ul><p>Mensagem automática restrita à sua empresa e aos módulos sob sua gestão.</p>`);
    sent += 1;
  }
  console.log(JSON.stringify({ level: 'info', event: 'notification_digest', records: records.length, alerts: alerts.length, sent, requestId: event.id }));
  return { records: records.length, alerts: alerts.length, planned, sent };
}
