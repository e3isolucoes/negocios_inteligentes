// Produção foi transferida para EventBridge Scheduler + Lambda (aws/template.yaml).
// Este comando não envia mensagens e deliberadamente não aceita credenciais Supabase.
console.log('Alertas de produção são executados pela Lambda NotificationFunction. Para rollback manual, use enviar-alertas-legacy-supabase.mjs.');
