import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const requiredFiles = [
  'SECURITY.md',
  'docs/adr/ADR-PLATFORM-001-hybrid-free-tier.md',
  'docs/adr/ADR-PLATFORM-002-aws-data-plane.md',
  'docs/governance/operational-governance.md',
  'docs/governance/disaster-recovery.md',
  'docs/governance/platform-inventory.md',
  'docs/governance/aws-cutover-runbook.md',
  'aws/bootstrap/production-deployer.yaml',
  'aws/production-parameters.json',
];

const failures = [];
for (const file of requiredFiles) {
  if (!existsSync(file)) failures.push(`Documento obrigatório ausente: ${file}`);
}

const ignored = readFileSync('.gitignore', 'utf8');
for (const entry of ['.secrets/', '.migration/', '.tools/']) {
  if (!ignored.includes(entry)) failures.push(`Diretório sensível não ignorado: ${entry}`);
}

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !file.endsWith('package-lock.json'));

const forbidden = [
  { name: 'Supabase service role JWT', pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]{20,}/ },
  { name: 'Resend API key', pattern: /\bre_[a-zA-Z0-9_-]{20,}\b/ },
  { name: 'OpenAI API key', pattern: /\bsk-[a-zA-Z0-9_-]{20,}\b/ },
  { name: 'arquivo DPAPI', pattern: /supabase-(?:db-password|service-role)\.dpapi/ },
];

for (const file of tracked) {
  let content;
  try { content = readFileSync(file, 'utf8'); } catch { continue; }
  for (const rule of forbidden) {
    if (rule.pattern.test(content)) failures.push(`${rule.name} detectado em ${file}`);
  }
}

const retiredProviderNames = [
  ['net', 'lify'].join(''),
  ['ver', 'cel'].join(''),
];
const retiredProviders = new RegExp(`\\b(?:${retiredProviderNames.join('|')})\\b`, 'i');
// Bibliotecas de terceiros vendorizadas (ex.: vendor/supabase-*) legitimamente
// fazem detecção de ambiente/runtime para outras plataformas de hospedagem
// dentro do próprio SDK. Isso não indica que este projeto está hospedado
// nelas, então essa checagem só se aplica a superfícies implantáveis. Relatórios
// históricos em docs/migration registram justamente a remoção desses provedores
// e não representam configuração ativa.
for (const file of tracked) {
  if (file.startsWith('vendor/') || file.startsWith('docs/migration/')) continue;
  let content;
  try { content = readFileSync(file, 'utf8'); } catch { continue; }
  if (retiredProviders.test(content)) {
    failures.push(`Referência a provedor de hospedagem descontinuado em ${file}`);
  }
}

if (failures.length) {
  console.error(failures.map((item) => `- ${item}`).join('\n'));
  process.exit(1);
}

console.log('Controles mínimos de governança validados.');
