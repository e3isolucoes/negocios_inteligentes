import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('AWS é o padrão e Supabase permanece como reversão explícita', async () => {
  const source = await readFile(new URL('../js/runtime-config.js', import.meta.url), 'utf8');
  assert.match(source, /get\('backend'\) === 'supabase'/);
  assert.match(source, /legacyRequested \? 'supabase' : 'aws'/);
  assert.match(source, /legacyRequested \? 'supabase' : 'cognito'/);
  assert.match(source, /oezgdex1li\.execute-api\.sa-east-1\.amazonaws\.com/);
});

test('CSP permite somente a API e o S3 necessários para a prévia AWS', async () => {
  const config = await readFile(new URL('../staticwebapp.config.json', import.meta.url), 'utf8');
  assert.match(config, /https:\/\/oezgdex1li\.execute-api\.sa-east-1\.amazonaws\.com/);
  assert.match(config, /https:\/\/\*\.s3\.sa-east-1\.amazonaws\.com/);
  assert.doesNotMatch(config, /connect-src[^;]*https:\/\/\*\.amazonaws\.com/);
});

test('cliente AWS respeita o limite da API e repete respostas 429', async () => {
  const client = await readFile(new URL('../js/api/awsDataClient.js', import.meta.url), 'utf8');
  assert.doesNotMatch(client, /remainingInitialBurst/);
  assert.match(client, /sleep\(1100\)/);
  assert.match(client, /response\.status\s*!==\s*429/);
});

test('falha em dados complementares não impede a abertura do painel AWS', async () => {
  const data = await readFile(new URL('../js/data.js', import.meta.url), 'utf8');

  assert.match(data, /const \[obligations, completions, companies\] = await Promise\.all/);
  assert.match(data, /optionalLoads = await Promise\.allSettled/);
  assert.match(data, /Lista de espaços indisponível/);
});

test('conclusões criadas na AWS recebem data de conclusão compatível com o painel', async () => {
  const repository = await readFile(new URL('../aws/api/src/repository.mjs', import.meta.url), 'utf8');
  assert.match(repository, /entity === 'completions'/);
  // done_at é lido do payload já validado (validateCreate), não do input
  // bruto — validated.done_at passa pelo validador de timestamp antes de
  // ser gravado.
  assert.match(repository, /done_at: validated\.done_at \|\| timestamp/);
});

test('histórico continua carregando para conclusões AWS legadas sem done_at', async () => {
  const board = await readFile(new URL('../js/ui/board.js', import.meta.url), 'utf8');
  assert.match(board, /completion\.done_at \|\| b\.completion\.created_at \|\| ''/);
  assert.match(board, /completion\.done_at \|\| a\.completion\.created_at \|\| ''/);
});

test('exclusão de conclusão AWS também remove o comprovante do S3', async () => {
  // A exclusão não chama o S3 de forma síncrona no handler: o Repository.remove()
  // grava, na mesma transação do DynamoDB, um registro pendente e um evento na
  // fila outbox (com attachment_path), e o deletion-worker consome esse evento
  // de forma assíncrona/idempotente para remover o objeto do S3. Isso evita
  // apagar o registro no banco e falhar ao apagar o arquivo (ou vice-versa).
  const repository = await readFile(new URL('../aws/api/src/repository.mjs', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../aws/api/src/deletion-worker.mjs', import.meta.url), 'utf8');
  const files = await readFile(new URL('../aws/api/src/files.mjs', import.meta.url), 'utf8');
  assert.match(repository, /entityType: 'file_deletion_outbox'/);
  assert.match(repository, /attachment_path: current\.attachment_path/);
  assert.match(worker, /if \(event\.attachment_path\) await s3\.send\(new DeleteObjectCommand/);
  assert.match(files, /DeleteObjectCommand/);
  assert.match(files, /path\?\.startsWith\(prefix\)/);
});

test('infraestrutura de produção protege dados e monitora falhas sem permitir autoelevação do deployer', async () => {
  const template = await readFile(new URL('../aws/template.yaml', import.meta.url), 'utf8');
  const deployer = await readFile(new URL('../aws/bootstrap/deployer.yaml', import.meta.url), 'utf8');
  assert.match(template, /DeletionProtectionEnabled: !If \[IsProduction, true, false\]/);
  assert.match(template, /PointInTimeRecoveryEnabled: !If \[IsProduction, true, false\]/);
  assert.match(template, /MetricName: Errors/);
  assert.match(template, /MetricName: ReadThrottleEvents/);
  assert.match(deployer, /dynamodb:UpdateTimeToLive/);
  assert.match(deployer, /lambda:CreateEventSourceMapping/);
  assert.match(deployer, /sqs:CreateQueue/);
  assert.match(deployer, /pipes:CreatePipe/);
  assert.match(deployer, /scheduler:ListTagsForResource/);
  assert.match(deployer, /cognito-idp:CreateUserPool/);
  assert.match(deployer, /role\/e3i-staging-\*-api/);
  assert.match(deployer, /role\/e3i-staging-painel-obrigacoes-\*/);
  assert.match(deployer, /role\/e3i-staging-painel-obriga-\*/);
  assert.doesNotMatch(deployer, /role\/e3i-staging-\*\s*$/m);
});

test('deploy AWS confia somente na origem canônica do Portal E3I', async () => {
  const deployer = await readFile(new URL('../aws/bootstrap/deployer.yaml', import.meta.url), 'utf8');
  const workflow = await readFile(new URL('../.github/workflows/aws-sam-staging.yml', import.meta.url), 'utf8');

  assert.match(deployer, /Default: e3isolucoes/);
  assert.match(deployer, /Default: '272208026'/);
  assert.match(deployer, /Default: portal-e3i-solucoes/);
  assert.match(deployer, /Default: '1351772197'/);
  assert.doesNotMatch(deployer, /DCont-Solucoes|1324605622|313186334/);
  assert.match(workflow, /github\.repository == 'e3isolucoes\/portal-e3i-solucoes'/);
});
