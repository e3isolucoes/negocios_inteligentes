import assert from 'node:assert/strict';
import test from 'node:test';
import { renderRelatedCompaniesTags } from '../painel-obrigacoes/js/ui/relatedCompanies.js';

test('relatedCompanies aparece como etiqueta informativa sem link de troca de workspace', () => {
  const html = renderRelatedCompaniesTags({
    relatedCompanies: [{
      workspaceId: 'workspace-b',
      razaoSocial: 'MRSLA Participações Ltda.',
      cnpj: '12345678000190',
    }],
  });

  assert.match(html, /Também envolve: MRSLA Participações Ltda\./);
  assert.match(html, /related-company-tag/);
  assert.doesNotMatch(html, /href=/i);
  assert.doesNotMatch(html, /<a\b/i);
  assert.doesNotMatch(html, /<button\b/i);
  assert.doesNotMatch(html, /data-action=/i);
  assert.doesNotMatch(html, /workspace-b/);
});

test('etiqueta escapa razão social e não cria ação por conteúdo malicioso', () => {
  const html = renderRelatedCompaniesTags({
    relatedCompanies: [{
      workspaceId: 'workspace-b',
      razaoSocial: '<script>alert(1)</script>',
      cnpj: '12345678000190',
    }],
  });

  assert.doesNotMatch(html, /<script>/i);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href=/i);
});
