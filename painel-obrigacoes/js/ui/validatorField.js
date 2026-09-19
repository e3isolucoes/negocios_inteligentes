// js/ui/validatorField.js
// ---------------------------------------------------------------------------
// Campo "Exige validação" + seletor de validador, para o formulário de
// obrigação (js/ui/modal.js). Isolado num módulo próprio para não inchar o
// modal e para poder ser reaproveitado na tela de categorias.
//
// Só a Gestão (admin) vê e edita: quem valida é decisão de gestão, não do
// executor. Para o membro o campo aparece somente leitura.
// ---------------------------------------------------------------------------
import { escapeHtml } from '../dateUtils.js';

/**
 * HTML do bloco. Insira no modal logo depois do campo de responsável.
 *
 * @param {object}  ob        obrigação sendo editada
 * @param {Array}   profiles  equipe: [{ id, display_name, email, role }]
 * @param {boolean} isAdmin   se o usuário logado é da Gestão
 */
export function validatorFieldHtml(ob, profiles = [], isAdmin = false) {
  const marcado = ob?.requires_validation !== false ? 'checked' : '';
  const atual = ob?.validator_id || '';

  if (!isAdmin) {
    if (!ob?.requires_validation) return '';
    const quem = profiles.find(p => p.id === atual);
    return `
      <div class="field field-leitura">
        <label>Validação</label>
        <p class="valor-leitura">
          Esta obrigação exige validação de
          <strong>${escapeHtml(quem?.display_name || 'um validador designado')}</strong>.
          Somente a Gestão altera isso.
        </p>
      </div>`;
  }

  const opcoes = profiles
    .slice()
    .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '', 'pt-BR'))
    .map(p => `<option value="${p.id}" ${p.id === atual ? 'selected' : ''}>`
      + `${escapeHtml(p.display_name || p.email)}${p.role === 'admin' ? ' (Gestão)' : ''}</option>`)
    .join('');

  return `
    <div class="field field-validacao">
      <label class="check-inline">
        <input type="checkbox" id="fRequiresValidation" ${marcado} disabled />
        <span>Exige validação antes de ser concluída</span>
      </label>
      <div class="sub-campo" id="fValidatorWrap" ${marcado ? '' : 'hidden'}>
        <label for="fValidator">Quem valida</label>
        <select id="fValidator">
          <option value="">— selecione —</option>
          ${opcoes}
        </select>
        <small class="hint">
          Toda tarefa passa por validação. Membros não podem validar o próprio
          trabalho; administradores concluem diretamente as atividades que executam.
        </small>
      </div>
    </div>`;
}

/** Liga o mostra/esconde do seletor. Chame depois de inserir o HTML no modal. */
export function bindValidatorField(root = document) {
  const check = root.querySelector('#fRequiresValidation');
  const wrap = root.querySelector('#fValidatorWrap');
  if (!check || !wrap) return;
  check.addEventListener('change', () => { wrap.hidden = !check.checked; });
}

/** Lê os valores na hora de salvar. Devolve {} se o campo não estiver na tela. */
export function readValidatorField(root = document) {
  const check = root.querySelector('#fRequiresValidation');
  if (!check) return {};
  const select = root.querySelector('#fValidator');
  return {
    requires_validation: check.checked,
    validator_id: check.checked ? (select?.value || null) : null,
  };
}
