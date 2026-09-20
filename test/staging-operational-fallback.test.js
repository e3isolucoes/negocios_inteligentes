import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('staging possui fallback operacional isolado quando o stack completo faz rollback', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy-staging.yml', import.meta.url), 'utf8');

  assert.match(workflow, /id: full_stack_deploy/);
  assert.match(workflow, /continue-on-error: true/);
  assert.match(workflow, /Diagnose full stack rollback/);
  assert.match(workflow, /Apply isolated API and CORS hotfix/);
  assert.match(workflow, /steps\.full_stack_deploy\.outcome == 'failure'/);
  assert.match(workflow, /aws lambda update-function-code/);
  assert.match(workflow, /aws apigatewayv2 update-api/);
  assert.match(workflow, /authorization.*content-type.*x-workspace-id/);
  assert.match(workflow, /Credentialed browser CORS smoke test/);
});

test('verificação completa do stack só é exigida quando o update completo vence', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy-staging.yml', import.meta.url), 'utf8');
  assert.match(
    workflow,
    /- name: Verify stack update\n\s+if: steps\.full_stack_deploy\.outcome == 'success'/,
  );
});
