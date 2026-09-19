import {
  STATE, isAdmin, isSuperUser, holidaysDateSet, completionsIndex, overrideForOccurrence, rulesForRegime, taxRegimeName,
} from './state.js';
import { fetchObligations, createObligation, updateObligation, deleteObligation as apiDeleteObligation, createObligationsBulk } from './api/obligations.js?v=20260813-create-rls-fix-v7';
import { fetchCompletions, markCompletion, deleteCompletion } from './api/completions.js';
import {
  fetchCompanies, ensureCompany, createCompany, updateCompany, updateCompanyRegime, deleteCompany as apiDeleteCompany,
} from './api/companies.js';
import { fetchProfiles, updateProfile } from './api/profiles.js';
import { fetchComments, createComment, deleteComment as apiDeleteComment } from './api/comments.js';
import { fetchAuditLog } from './api/auditLog.js';
import {
  fetchChecklistItems, fetchAllChecklistItems, createChecklistItem, createChecklistItemsBulk, deleteChecklistItem as apiDeleteChecklistItem,
  toggleChecklistItem, resetChecklistItems,
} from './api/checklist.js?v=20260814-sankhya-checklists-v1';
import { fetchHolidays, createHoliday, deleteHoliday as apiDeleteHoliday, fetchNationalHolidays } from './api/holidays.js';
import {
  fetchObligationRules, createObligationRule, updateObligationRule, deleteObligationRule as apiDeleteObligationRule,
} from './api/obligationRules.js';
import {
  fetchOccurrenceOverrides, setOccurrenceOverride, deleteOccurrenceOverride as apiDeleteOccurrenceOverride,
} from './api/occurrenceOverrides.js';
import {
  fetchTaxRegimes, createTaxRegime, updateTaxRegime, deleteTaxRegime as apiDeleteTaxRegime,
  fetchTaxRegimeRules, linkRuleToRegime, unlinkRuleFromRegime,
} from './api/taxRegimes.js';
import { createUserAccount } from './api/adminUsers.js';
import { signOut, sendPasswordResetEmail, fetchMyProfile } from './api/auth.js';
import { uploadAttachment } from './api/storage.js';
import { completeDialog } from './ui/completeDialog.js?v=20260817-optional-receipts-v2';
import { overrideDialog } from './ui/overrideDialog.js';
import { applyRuleDialog } from './ui/applyRuleDialog.js';
import { regimeDialog } from './ui/regimeDialog.js';
import { regimeRulesDialog } from './ui/regimeRulesDialog.js';
import { regimeCompaniesDialog } from './ui/regimeCompaniesDialog.js';
import { getActiveOccurrence, fmtKey } from './dateUtils.js';
import { showToast } from './ui/toast.js';
import { confirmDialog } from './ui/confirmDialog.js';
import { findClosestProfile } from './csv.js';
import { fetchCategories } from './api/categories.js';
import { countPendingValidations, countRejected } from './api/validation.js';
import { applyCategories } from './constants.js';
import { fetchWorkspaces, createWorkspace, updateWorkspace } from './api/workspaces.js';
import { getSankhyaChecklistTemplate } from './obligationChecklistTemplates.js?v=20260814-sankhya-checklists-v1';

// Carrega as dez tabelas em paralelo. Cada uma é independente — se uma
// falhar (ex.: sem conexão), as outras ainda tentam, e sinalizamos o erro
// via STATE.connectionError para a interface mostrar o banner de aviso.
export async function loadAll() {
  STATE.connectionError = null;
  try {
    const [
      obligations, completions, companies, profiles, holidays, obligationRules, occurrenceOverrides,
      taxRegimes, taxRegimeRules, checklistItems, categories, pendingValidation, rejectedValidation,
    ] = await Promise.all([
      fetchObligations(),
      fetchCompletions(),
      fetchCompanies(),
      fetchProfiles(),
      fetchHolidays(),
      fetchObligationRules(),
      fetchOccurrenceOverrides(),
      fetchTaxRegimes(),
      fetchTaxRegimeRules(),
      fetchAllChecklistItems(),
      fetchCategories(),
      countPendingValidations(),
      countRejected(),
    ]);
    STATE.obligations = obligations;
    STATE.completions = completions;
    STATE.companies = companies;
    STATE.profiles = profiles;
    STATE.holidays = holidays;
    STATE.obligationRules = obligationRules;
    STATE.occurrenceOverrides = occurrenceOverrides;
    STATE.taxRegimes = taxRegimes;
    STATE.taxRegimeRules = taxRegimeRules;
    STATE.checklistItems = checklistItems;
    applyCategories(categories);
    STATE.validation = { pending: pendingValidation, rejected: rejectedValidation };
    STATE.workspaces = isSuperUser() ? await fetchWorkspaces() : [];
  } catch (err) {
    console.error('Falha ao carregar dados do painel', err);
    STATE.connectionError = 'Não foi possível carregar os dados agora. Verifique sua conexão com a internet.';
    throw err;
  }
}

export async function doCreateWorkspace({ name, document, accessStatus }, onDone) {
  if (!isSuperUser()) return;
  if (!name.trim()) { showToast('Informe a razão social da empresa.', 'error'); return; }
  if ((document || '').replace(/\D/g, '').length !== 14) { showToast('Informe um CNPJ com 14 dígitos.', 'error'); return; }
  try {
    const trialEndsAt = accessStatus === 'trial'
      ? new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10) : null;
    const created = await createWorkspace({ name: name.trim(), document: document.trim() || null, access_status: accessStatus, trial_ends_at: trialEndsAt });
    STATE.workspaces.push(created);
    showToast('Espaço da empresa criado com sucesso.', 'success');
  } catch (err) { console.error(err); showToast('Não foi possível criar o espaço.', 'error'); }
  onDone?.();
}

export async function doUpdateWorkspaceAccess(id, accessStatus, onDone) {
  if (!isSuperUser()) return;
  try {
    const trialEndsAt = accessStatus === 'trial' ? new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10) : null;
    const updated = await updateWorkspace(id, { access_status: accessStatus, trial_ends_at: trialEndsAt });
    STATE.workspaces = STATE.workspaces.map((w) => (w.id === id ? updated : w));
    showToast('Acesso da empresa atualizado.', 'success');
  } catch (err) { console.error(err); showToast('Não foi possível atualizar o acesso.', 'error'); }
  onDone?.();
}

export async function refreshObligationsAndCompletions() {
  const [obligations, completions] = await Promise.all([fetchObligations(), fetchCompletions()]);
  STATE.obligations = obligations;
  STATE.completions = completions;
}

// ---------- ações ----------

export async function doMarkDone(obligationId, onDone) {
  const ob = STATE.obligations.find((o) => o.id === obligationId);
  if (!ob) return;
  // Administradores podem concluir o próprio envio diretamente. A mesma
  // exceção é aplicada pelo trigger no banco, que é a fonte de verdade.
  if (ob.requires_validation && !ob.validator_id && !isAdmin()) {
    showToast('A Gestão precisa definir quem validará esta tarefa antes do envio.', 'error');
    return;
  }
  if (ob.requires_validation && ob.validator_id === STATE.session?.id && !isAdmin()) {
    showToast('Quem executa a tarefa não pode validar o próprio trabalho.', 'error');
    return;
  }
  const completionsByObligation = new Map(
    STATE.completions
      .filter((c) => c.obligation_id === obligationId)
      .reduce((acc, c) => {
        if (!acc.has(c.obligation_id)) acc.set(c.obligation_id, new Set());
        acc.get(c.obligation_id).add(c.occurrence_date);
        return acc;
      }, new Map())
  );
  const active = getActiveOccurrence(ob, completionsByObligation, holidaysDateSet());
  if (!active) return;

  // Checklist (se houver) e, quando configurado, comprovante são exigidos
  // ANTES da conclusão ser gravada — ao cancelar, nada é salvo.
  let checklistItems = [];
  try {
    checklistItems = await fetchChecklistItems(obligationId);
  } catch (err) {
    console.error('Falha ao carregar checklist, seguindo sem ele', err);
  }

  const occurrenceDate = fmtKey(active);
  // Cada item já mostra o estado marcado/desmarcado persistido (quem foi
  // riscando o checklist ao longo do período, direto no cartão do Painel,
  // já chega aqui com tudo pronto). Marcar/desmarcar dentro do próprio
  // diálogo também é permitido e persiste na hora — os dois jeitos de
  // trabalhar (aos poucos, ou tudo de uma vez ao concluir) continuam
  // válidos e ficam em sincronia.
  const result = await completeDialog(ob.name, checklistItems, occurrenceDate, {
    requiresAttachment: ob.requires_attachment !== false,
    allowsNoMovementWithoutAttachment: ob.activity_type === 'obrigacao_acessoria'
      && ob.requires_attachment_no_movement === false,
    onToggleItem: (itemId, checkedVal) => {
      toggleChecklistItem(itemId, checkedVal)
        .then((updated) => {
          STATE.checklistItems = STATE.checklistItems.map((it) => (it.id === itemId ? updated : it));
        })
        .catch((err) => console.error('Falha ao salvar o item do checklist', err));
    },
  });
  if (!result) return; // cancelado — nada foi salvo

  let attachmentPath = null;
  if (result.file) {
    try {
      attachmentPath = await uploadAttachment(result.file, obligationId, occurrenceDate);
    } catch (err) {
      console.error(err);
      showToast('Não foi possível enviar o comprovante. A conclusão não foi salva — tente novamente.', 'error');
      return;
    }
  }

  try {
    const created = await markCompletion({
      obligationId,
      occurrenceDate,
      userId: STATE.session.id,
      userLabel: STATE.profile?.display_name || STATE.session.email,
      attachmentPath,
      checklistTotal: result.checklistTotal,
      checklistChecked: result.checklistChecked,
      ocrStatus: result.ocrStatus,
      ocrExtractedPeriod: result.ocrExtractedPeriod,
      movementStatus: result.movementStatus,
    });
    STATE.completions.push(created);

    // Reinicia o checklist para o próximo ciclo (mês/trimestre/ano
    // seguinte) começar do zero — o total/marcados desta conclusão já
    // ficou registrado em completions acima, então isso não perde histórico.
    if (checklistItems.length) {
      try {
        await resetChecklistItems(obligationId);
        STATE.checklistItems = STATE.checklistItems.map((it) => (
          it.obligation_id === obligationId ? { ...it, completed: false, completed_by: null, completed_at: null } : it
        ));
      } catch (err) {
        console.error('Falha ao reiniciar o checklist para o próximo ciclo', err);
      }
    }

    if (result.ocrStatus === 'mismatch') {
      showToast('Obrigação concluída, mas a competência do comprovante ficou sinalizada para revisão do gestor.', 'info');
    } else {
      showToast(ob.requires_validation && !isAdmin()
        ? 'Tarefa enviada. Ela será concluída após a validação da Gestão.'
        : attachmentPath
          ? 'Obrigação marcada como concluída, com comprovante anexado.'
          : 'Obrigação marcada como concluída.', 'success');
    }
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      showToast('Alguém já registrou essa conclusão agora há pouco. Atualizando o painel…', 'info');
      await refreshObligationsAndCompletions();
    } else {
      showToast('Não foi possível salvar a conclusão. Tente novamente.', 'error');
    }
  } finally {
    onDone?.();
  }
}

export async function doUndoLast(obligationId, onDone) {
  const mine = STATE.completions.filter((c) => c.obligation_id === obligationId);
  if (!mine.length) return;
  const last = mine.slice().sort((a, b) => a.occurrence_date.localeCompare(b.occurrence_date)).pop();

  const canUndo = isAdmin() || last.done_by === STATE.session?.id;
  if (!canUndo) {
    showToast('Só quem concluiu (ou um administrador) pode desfazer esta conclusão.', 'error');
    return;
  }

  const ok = await confirmDialog({
    title: 'Desfazer conclusão',
    message: 'Desfazer a última conclusão registrada para esta obrigação?',
    confirmLabel: 'Desfazer',
  });
  if (!ok) return;

  try {
    await deleteCompletion(last.id);
    STATE.completions = STATE.completions.filter((c) => c.id !== last.id);
    showToast('Conclusão desfeita.', 'success');
  } catch (err) {
    console.error(err);
    showToast('Não foi possível desfazer agora. Tente novamente.', 'error');
  } finally {
    onDone?.();
  }
}

export async function doDeleteObligation(obligationId, onDone) {
  const ok = await confirmDialog({
    title: 'Excluir obrigação',
    message: 'Excluir esta obrigação do painel? Esta ação não pode ser desfeita.',
    confirmLabel: 'Excluir',
  });
  if (!ok) return;

  try {
    await apiDeleteObligation(obligationId);
    STATE.obligations = STATE.obligations.filter((o) => o.id !== obligationId);
    STATE.completions = STATE.completions.filter((c) => c.obligation_id !== obligationId);
    STATE.checklistItems = STATE.checklistItems.filter((it) => it.obligation_id !== obligationId);
    showToast('Obrigação excluída.', 'success');
  } catch (err) {
    console.error(err);
    showToast('Não foi possível excluir agora. Tente novamente.', 'error');
  } finally {
    onDone?.();
  }
}

// Copia o checklist-padrão de uma ou mais regras (obligation_rules) para
// `checklist_items` de cada obrigação recém-criada — usado tanto ao criar
// uma obrigação a partir de "Usar modelo de mercado" quanto ao aplicar uma
// regra/regime a várias empresas de uma vez. `ruleForObligation` é uma
// função (ob) => rule|undefined, para funcionar nos dois casos (uma regra
// só, ou várias regras diferentes por obrigação criada).
async function seedChecklistTemplatesForCreated(createdObligations, ruleForObligation = () => null) {
  const tasks = createdObligations
    .map((ob) => {
      const rule = ruleForObligation(ob);
      // Regra cadastrada pela Gestão tem precedência. Se ela não possuir
      // checklist próprio, usa o modelo minucioso derivado da planilha
      // Sankhya pelo nome da obrigação.
      const descriptions = rule?.checklist_template?.length
        ? rule.checklist_template
        : getSankhyaChecklistTemplate(ob);
      return { ob, descriptions };
    })
    .filter(({ descriptions }) => descriptions.length);
  if (!tasks.length) return;
  try {
    const payload = tasks.flatMap(({ ob, descriptions }) => descriptions.map(
      (description, position) => ({ obligationId: ob.id, description, position }),
    ));
    const created = await createChecklistItemsBulk(payload);
    STATE.checklistItems = STATE.checklistItems.concat(created);
  } catch (err) {
    console.error('Falha ao copiar o checklist-padrão do modelo', err);
  }
}

// `formData` vem do modal já validado; `id` é null para criação.
export async function doSaveObligation(id, formData, onDone) {
  const save = async () => {
    let companyId = null;
    if (formData.empresaNome) {
      const company = await ensureCompany(formData.empresaNome);
      companyId = company?.id || null;
      if (!STATE.companies.some((c) => c.id === companyId) && company) {
        STATE.companies.push(company);
      }
    }

    const payload = {
      name: formData.name,
      category: formData.category,
      module_key: formData.module_key || 'fiscal',
      company_id: companyId,
      responsible: formData.responsible,
      responsible_id: formData.responsible_id ?? null,
      frequency: formData.frequency,
      day_of_month: formData.day_of_month ?? null,
      month: formData.month ?? null,
      months: formData.months ?? null,
      due_date: formData.due_date ?? null,
      notes: formData.notes,
      priority: formData.priority || 'media',
      business_day_shift: formData.business_day_shift || 'nenhum',
      day_type: formData.day_type || 'fixo',
      requires_validation: formData.requires_validation !== false,
      validator_id: formData.validator_id || null,
      activity_type: formData.activity_type || 'obrigacao_acessoria',
      process_name: formData.process_name || '',
      area_name: formData.area_name || '',
      predecessor_id: formData.predecessor_id || null,
      requires_attachment: formData.requires_attachment !== false,
      requires_attachment_no_movement: formData.requires_attachment_no_movement !== false,
    };

    if (id) return updateObligation(id, payload);
    return createObligation(payload);
  };

  try {
    let saved;
    try {
      saved = await save();
    } catch (err) {
      // O vínculo empresarial pode ser alterado pela administração enquanto
      // esta aba permanece aberta. Nesse caso o formulário ainda carregava o
      // workspace antigo e a RLS o recusava. Atualize o próprio perfil e tente
      // uma única vez com o vínculo atual, sem afrouxar o isolamento no banco.
      if (id || err.code !== '42501' || !STATE.session?.id) throw err;
      const previousWorkspaceId = STATE.profile?.workspace_id;
      const refreshedProfile = await fetchMyProfile(STATE.session.id);
      STATE.profile = refreshedProfile;
      STATE.profiles = STATE.profiles.map((profile) => (
        profile.id === refreshedProfile.id ? refreshedProfile : profile
      ));
      if (refreshedProfile.active === false || refreshedProfile.workspace_id === previousWorkspaceId) throw err;
      saved = await save();
    }

    if (id) {
      STATE.obligations = STATE.obligations.map((o) => (o.id === id ? saved : o));
    } else {
      STATE.obligations.push(saved);
      const rule = formData.sourceRuleId
        ? STATE.obligationRules.find((r) => r.id === formData.sourceRuleId)
        : null;
      await seedChecklistTemplatesForCreated([saved], () => rule);
    }
    showToast(id ? 'Obrigação atualizada.' : 'Obrigação cadastrada.', 'success');
    onDone?.(saved);
  } catch (err) {
    console.error(err);
    if (err.code === '23514' && /frequency_fields_check/i.test(`${err.message || ''} ${err.details || ''}`)) {
      showToast('O banco ainda não aceita a frequência diária. Execute sql/migrations/20260813_fix_import_obligations.sql no SQL Editor do Supabase e tente novamente.', 'error');
    } else if (err.code === '42501' && err.importRpcMissing) {
      showToast('A correção de segurança ainda não foi aplicada ao banco. Execute sql/migrations/20260813_fix_import_obligations.sql e tente novamente.', 'error');
    } else if (err.code === '42501') {
      showToast('Seu perfil precisa estar ativo e vinculado ao espaço da empresa para cadastrar obrigações.', 'error');
    } else {
      showToast('Não foi possível salvar. Verifique os campos e tente novamente.', 'error');
    }
  }
}

// ---------- exceção de data (prorrogação pontual de uma ocorrência) ----------
// Ajusta só a ocorrência que está ativa agora — não mexe na regra de
// recorrência da obrigação (day_of_month/month/months continuam os
// mesmos, as próximas ocorrências seguem normalmente).
export async function doAdjustOccurrenceDate(obligationId, onDone) {
  const ob = STATE.obligations.find((o) => o.id === obligationId);
  if (!ob) return;

  const rawActive = getActiveOccurrence(ob, completionsIndex(), holidaysDateSet());
  if (!rawActive) {
    showToast('Esta obrigação não tem uma próxima ocorrência para ajustar agora.', 'error');
    return;
  }
  const rawKey = fmtKey(rawActive);
  const existing = overrideForOccurrence(obligationId, rawKey);

  const result = await overrideDialog({ obligationName: ob.name, rawDate: rawActive, existingOverride: existing });
  if (!result) return; // cancelado

  try {
    if (result === 'remove') {
      if (existing) {
        await apiDeleteOccurrenceOverride(existing.id);
        STATE.occurrenceOverrides = STATE.occurrenceOverrides.filter((o) => o.id !== existing.id);
        showToast('Ajuste removido — volta a usar o vencimento padrão da regra.', 'success');
      }
    } else {
      const saved = await setOccurrenceOverride({
        obligationId, originalDate: rawKey, overrideDate: result.overrideDate, reason: result.reason,
      });
      STATE.occurrenceOverrides = STATE.occurrenceOverrides.filter((o) => o.id !== saved.id).concat(saved);
      showToast('Data ajustada para esta ocorrência.', 'success');
    }
  } catch (err) {
    console.error(err);
    showToast('Não foi possível salvar o ajuste agora.', 'error');
  } finally {
    onDone?.();
  }
}

// ---------- empresas (CRUD) ----------

export async function doCreateCompany(name, onDone) {
  const trimmed = (name || '').trim();
  if (!trimmed) { showToast('Informe o nome da empresa.', 'error'); return; }
  if (STATE.companies.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
    showToast('Já existe uma empresa com esse nome.', 'error');
    return;
  }
  try {
    const created = await createCompany(trimmed);
    STATE.companies.push(created);
    STATE.companies.sort((a, b) => a.name.localeCompare(b.name));
    showToast('Empresa cadastrada.', 'success');
    onDone?.(created);
  } catch (err) {
    console.error(err);
    showToast('Não foi possível cadastrar a empresa agora.', 'error');
  }
}

export async function doRenameCompany(id, name, onDone) {
  const trimmed = (name || '').trim();
  if (!trimmed) { showToast('Informe o nome da empresa.', 'error'); return; }
  try {
    const updated = await updateCompany(id, trimmed);
    STATE.companies = STATE.companies.map((c) => (c.id === id ? updated : c));
    STATE.companies.sort((a, b) => a.name.localeCompare(b.name));
    showToast('Empresa atualizada.', 'success');
    onDone?.(updated);
  } catch (err) {
    console.error(err);
    showToast('Não foi possível salvar o novo nome agora.', 'error');
  }
}

export async function doDeleteCompany(id, onDone) {
  const inUse = STATE.obligations.filter((o) => o.company_id === id).length;
  const ok = await confirmDialog({
    title: 'Excluir empresa',
    message: inUse
      ? `Excluir esta empresa? ${inUse} obrigação(ões) associada(s) a ela ficarão sem empresa vinculada — elas não serão excluídas.`
      : 'Excluir esta empresa do painel?',
    confirmLabel: 'Excluir',
  });
  if (!ok) return;

  try {
    await apiDeleteCompany(id);
    STATE.companies = STATE.companies.filter((c) => c.id !== id);
    STATE.obligations = STATE.obligations.map((o) => (o.company_id === id ? { ...o, company_id: null } : o));
    showToast('Empresa excluída.', 'success');
  } catch (err) {
    console.error(err);
    showToast('Não foi possível excluir agora. Tente novamente.', 'error');
  } finally {
    onDone?.();
  }
}

// ---------- equipe (papéis de acesso) ----------

export async function doChangeRole(profileId, newRole, onDone) {
  if (!isAdmin()) return;
  const person = STATE.profiles.find((p) => p.id === profileId);
  if (!person) return;

  if (profileId === STATE.session?.id && newRole === 'membro') {
    const ok = await confirmDialog({
      title: 'Remover seu próprio acesso de administrador',
      message: 'Você está prestes a se rebaixar para membro. Você perderá acesso a esta área imediatamente. Deseja continuar?',
      confirmLabel: 'Continuar',
    });
    if (!ok) return;
  }

  try {
    const updated = await updateProfile(profileId, { role: newRole });
    STATE.profiles = STATE.profiles.map((p) => (p.id === profileId ? updated : p));
    if (profileId === STATE.session?.id) STATE.profile = updated;
    const roleLabel = newRole === 'admin' ? 'administrador(a)' : (newRole === 'gestor' ? 'gestor(a)' : 'membro');
    showToast(`${person.display_name || person.email} agora é ${roleLabel}.`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Não foi possível alterar o papel agora.', 'error');
  } finally {
    onDone?.();
  }
}

export async function doChangeModuleAccess(profileId, moduleAccess, onDone) {
  if (!isAdmin()) return;
  try {
    const updated = await updateProfile(profileId, { module_access: moduleAccess });
    STATE.profiles = STATE.profiles.map((profile) => (profile.id === profileId ? updated : profile));
    if (profileId === STATE.session?.id) STATE.profile = updated;
    showToast('Acessos aos módulos atualizados.', 'success');
  } catch (err) {
    console.error(err);
    showToast('Não foi possível atualizar os módulos.', 'error');
  } finally { onDone?.(); }
}

// Revoga ou reativa o acesso de alguém (profiles.active) — não apaga a
// conta nem o perfil, só bloqueia a entrada (ver checagem em js/app.js e a
// função is_admin() no banco, que já ignora papel de quem está revogado).
export async function doSetUserActive(profileId, active, onDone) {
  if (!isAdmin()) return;
  const person = STATE.profiles.find((p) => p.id === profileId);
  if (!person) return;

  const isSelf = profileId === STATE.session?.id;
  if (!active) {
    const ok = await confirmDialog({
      title: isSelf ? 'Revogar seu próprio acesso' : 'Revogar acesso',
      message: isSelf
        ? 'Você está prestes a revogar seu próprio acesso. Você será desconectado agora — só outro administrador poderá reativar sua conta depois.'
        : `Revogar o acesso de ${person.display_name || person.email}? A pessoa não vai mais conseguir entrar no painel até que um admin reative a conta.`,
      confirmLabel: 'Revogar acesso',
    });
    if (!ok) return;
  }

  try {
    const updated = await updateProfile(profileId, { active });
    STATE.profiles = STATE.profiles.map((p) => (p.id === profileId ? updated : p));
    if (isSelf) {
      STATE.profile = updated;
      if (!active) {
        showToast('Acesso revogado. Encerrando sua sessão…', 'info');
        await signOut();
        return;
      }
    }
    showToast(active ? `${person.display_name || person.email} reativado(a).` : `Acesso de ${person.display_name || person.email} revogado.`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Não foi possível alterar o acesso agora.', 'error');
  } finally {
    onDone?.();
  }
}

// Manda o e-mail de redefinição de senha (ver api/auth.js) — não é
// possível trocar a senha de outra pessoa direto pelo app sem a
// service_role key, então isso é o que um admin tem à disposição: a
// pessoa recebe o link e escolhe a senha nova ela mesma.
export async function doSendPasswordReset(profileId, onDone) {
  if (!isAdmin()) return;
  const person = STATE.profiles.find((p) => p.id === profileId);
  if (!person) return;

  try {
    await sendPasswordResetEmail(person.email);
    showToast(`E-mail de redefinição de senha enviado para ${person.email}.`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Não foi possível enviar o e-mail de redefinição agora.', 'error');
  } finally {
    onDone?.();
  }
}

// ---------- comentários ----------

export async function doLoadComments(obligationId) {
  try {
    return await fetchComments(obligationId);
  } catch (err) {
    console.error(err);
    showToast('Não foi possível carregar os comentários agora.', 'error');
    return [];
  }
}

export async function doAddComment(obligationId, body, onDone) {
  const trimmed = (body || '').trim();
  if (!trimmed) return;
  try {
    const created = await createComment({
      obligationId,
      authorId: STATE.session.id,
      authorName: STATE.profile?.display_name || STATE.session.email,
      body: trimmed,
    });
    onDone?.(created);
  } catch (err) {
    console.error(err);
    showToast('Não foi possível salvar o comentário agora.', 'error');
  }
}

export async function doDeleteComment(commentId, onDone) {
  const ok = await confirmDialog({
    title: 'Excluir comentário',
    message: 'Excluir este comentário? Esta ação não pode ser desfeita.',
    confirmLabel: 'Excluir',
  });
  if (!ok) return;
  try {
    await apiDeleteComment(commentId);
    onDone?.();
  } catch (err) {
    console.error(err);
    showToast('Não foi possível excluir o comentário agora.', 'error');
  }
}

// ---------- checklist ----------

export async function doLoadChecklist(obligationId) {
  try {
    return await fetchChecklistItems(obligationId);
  } catch (err) {
    console.error(err);
    showToast('Não foi possível carregar o checklist agora.', 'error');
    return [];
  }
}

export async function doAddChecklistItem(obligationId, description, position, onDone) {
  const trimmed = (description || '').trim();
  if (!trimmed) return;
  try {
    const created = await createChecklistItem({ obligationId, description: trimmed, position });
    STATE.checklistItems.push(created);
    onDone?.(created);
  } catch (err) {
    console.error(err);
    showToast('Não foi possível adicionar o item agora.', 'error');
  }
}

export async function doDeleteChecklistItem(id, onDone) {
  try {
    await apiDeleteChecklistItem(id);
    STATE.checklistItems = STATE.checklistItems.filter((it) => it.id !== id);
    onDone?.();
  } catch (err) {
    console.error(err);
    showToast('Não foi possível remover o item agora.', 'error');
  }
}

// Marca/desmarca um passo do checklist direto no cartão do Painel (ou na
// listagem de Gerenciar → Obrigações) — qualquer pessoa autenticada pode
// fazer isso, não só quem é responsável pela obrigação (mesmo modelo aberto
// já usado em "Marcar concluído"). O percentual de conclusão (ver
// state.js, checklistProgress) é sempre calculado a partir do estado
// persistido aqui, então atualiza sozinho a cada toque.
export async function doToggleChecklistItem(itemId, done, onDone) {
  try {
    const updated = await toggleChecklistItem(itemId, done);
    STATE.checklistItems = STATE.checklistItems.map((it) => (it.id === itemId ? updated : it));
  } catch (err) {
    console.error(err);
    showToast('Não foi possível atualizar o item do checklist agora.', 'error');
  } finally {
    onDone?.();
  }
}

// ---------- histórico / auditoria ----------

export async function doLoadAuditLog(onDone) {
  try {
    const rows = await fetchAuditLog({ limit: 200 });
    STATE.auditLog = rows;
  } catch (err) {
    console.error(err);
    showToast('Não foi possível carregar o histórico agora.', 'error');
    STATE.auditLog = [];
  } finally {
    onDone?.();
  }
}

// ---------- feriados ----------

export async function doAddHoliday(date, name, onDone) {
  if (!date || !name.trim()) { showToast('Informe a data e o nome do feriado.', 'error'); return; }
  try {
    const created = await createHoliday({ date, name: name.trim() });
    STATE.holidays.push(created);
    STATE.holidays.sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
    showToast('Feriado cadastrado.', 'success');
  } catch (err) {
    console.error(err);
    const msg = err.code === '23505' ? 'Já existe um feriado cadastrado nessa data.' : 'Não foi possível cadastrar o feriado agora.';
    showToast(msg, 'error');
  } finally {
    onDone?.();
  }
}

export async function doDeleteHoliday(id, onDone) {
  try {
    await apiDeleteHoliday(id);
    STATE.holidays = STATE.holidays.filter((h) => h.id !== id);
    showToast('Feriado removido.', 'success');
  } catch (err) {
    console.error(err);
    showToast('Não foi possível remover o feriado agora.', 'error');
  } finally {
    onDone?.();
  }
}

export async function doImportNationalHolidays(year, onDone) {
  try {
    const list = await fetchNationalHolidays(year);
    let added = 0;
    for (const h of list) {
      if (STATE.holidays.some((existing) => existing.holiday_date === h.date)) continue;
      try {
        const created = await createHoliday(h);
        STATE.holidays.push(created);
        added++;
      } catch (err) {
        if (err.code !== '23505') throw err; // ignora duplicidade, propaga outros erros
      }
    }
    STATE.holidays.sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
    showToast(`${added} feriado(s) de ${year} importado(s).`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Não foi possível buscar os feriados agora (serviço externo pode estar indisponível). Você ainda pode cadastrar manualmente.', 'error');
  } finally {
    onDone?.();
  }
}

// `validRows` já vem filtrado e validado por js/csv.js (validateImportRows).
// Cada item tem `.mapped` com os campos prontos, faltando só resolver
// empresa (criar se não existir) e responsável (vincular a um perfil, se
// o nome bater com alguém já cadastrado).
export async function doImportObligations(validRows, onDone) {
  if (!validRows.length) return;
  try {
    const companyCache = new Map();
    for (const row of validRows) {
      const key = row.mapped.empresaNome.toLowerCase();
      if (row.mapped.empresaNome && !companyCache.has(key)) {
        const company = await ensureCompany(row.mapped.empresaNome);
        companyCache.set(key, company);
        if (company && !STATE.companies.some((c) => c.id === company.id)) {
          STATE.companies.push(company);
        }
      }
    }

    const payloads = validRows.map((row) => {
      const { mapped } = row;
      const company = mapped.empresaNome ? companyCache.get(mapped.empresaNome.toLowerCase()) : null;
      // findClosestProfile tolera acentuação/pontuação/erro de digitação
      // pequeno; em caso de ambiguidade ou distância grande, prefere não
      // vincular (fica como texto livre) a arriscar a pessoa errada.
      const profile = mapped.responsibleText ? findClosestProfile(STATE.profiles, mapped.responsibleText) : null;
      return {
        name: mapped.name,
        category: mapped.category,
        company_id: company ? company.id : null,
        responsible: profile ? profile.display_name : mapped.responsibleText,
        responsible_id: profile ? profile.id : null,
        frequency: mapped.frequency,
        day_type: mapped.day_type || 'fixo',
        day_of_month: mapped.day_of_month,
        month: mapped.month,
        months: mapped.months,
        due_date: mapped.due_date,
        notes: mapped.notes,
      };
    });

    const created = await createObligationsBulk(payloads);
    STATE.obligations.push(...created);
    await seedChecklistTemplatesForCreated(created);
    showToast(`${created.length} obrigação(ões) importada(s) com sucesso.`, 'success');
    STATE.importPreview = null;
    onDone?.({ success: created.length });
  } catch (err) {
    console.error(err);
    const permissionDenied = err.code === '42501';
    const outdatedFrequencyConstraint = err.code === '23514'
      && /frequency_fields_check/i.test(`${err.message || ''} ${err.details || ''}`);
    const reason = outdatedFrequencyConstraint
      ? 'O banco ainda não aceita a frequência diária. Execute sql/migrations/20260813_fix_import_obligations.sql no SQL Editor do Supabase e tente novamente.'
      : (permissionDenied && err.importRpcMissing
        ? 'O banco ainda não recebeu a atualização da importação. Execute sql/migrations/20260813_fix_import_obligations.sql no SQL Editor do Supabase e tente novamente.'
        : (permissionDenied
          ? 'O banco recusou a importação: a sessão não pertence a um perfil administrador ativo. Confirme o perfil em Authentication/ profiles e entre novamente.'
          : (err.message || 'O banco recusou a operação.')));
    showToast(`Falha ao importar. Nenhuma obrigação foi salva. Motivo: ${reason}`, 'error');
    onDone?.({ success: 0 });
  }
}

// ---------- regras de obrigações (catálogo de mercado, gerenciado pela gerência) ----------
// `formData` já vem validado do modal (ui/ruleModal.js). Editar/excluir uma
// regra nunca afeta obrigações já criadas a partir dela — o vínculo existe
// só no momento de pré-preencher o formulário, não fica salvo depois.

export async function doSaveRule(id, formData, onDone) {
  try {
    const payload = {
      name: formData.name,
      category: formData.category,
      frequency: formData.frequency,
      day_type: formData.day_type,
      day_of_month: formData.day_of_month,
      month: formData.month,
      months: formData.months,
      business_day_shift: formData.business_day_shift || 'nenhum',
      notes: formData.notes,
      checklist_template: formData.checklist_template || [],
    };

    let saved;
    if (id) {
      saved = await updateObligationRule(id, payload);
      STATE.obligationRules = STATE.obligationRules.map((r) => (r.id === id ? saved : r));
    } else {
      saved = await createObligationRule(payload);
      STATE.obligationRules.push(saved);
    }
    STATE.obligationRules.sort((a, b) => a.name.localeCompare(b.name));
    showToast(id ? 'Regra atualizada.' : 'Regra cadastrada.', 'success');
    onDone?.(saved);
  } catch (err) {
    console.error(err);
    const msg = err.code === '23505' ? 'Já existe uma regra com esse nome.' : 'Não foi possível salvar a regra agora.';
    showToast(msg, 'error');
  }
}

export async function doDeleteRule(id, onDone) {
  const ok = await confirmDialog({
    title: 'Excluir regra',
    message: 'Excluir esta regra do catálogo? Obrigações já cadastradas a partir dela não são afetadas — só deixa de aparecer como modelo.',
    confirmLabel: 'Excluir',
  });
  if (!ok) return;

  try {
    await apiDeleteObligationRule(id);
    STATE.obligationRules = STATE.obligationRules.filter((r) => r.id !== id);
    showToast('Regra excluída.', 'success');
  } catch (err) {
    console.error(err);
    showToast('Não foi possível excluir a regra agora.', 'error');
  } finally {
    onDone?.();
  }
}

// Cria uma obrigação por empresa selecionada a partir de um modelo de
// mercado — evita duplicar em empresas que já têm uma obrigação com o
// mesmo nome (comparação por nome, já que não há um vínculo formal
// regra → obrigação).
export async function doApplyRuleToCompanies(ruleId, onDone) {
  const rule = STATE.obligationRules.find((r) => r.id === ruleId);
  if (!rule) return;

  const companyIds = await applyRuleDialog({ ruleName: rule.name });
  if (!companyIds || !companyIds.length) return;

  const existingNamesByCompany = new Set(
    STATE.obligations
      .filter((ob) => companyIds.includes(ob.company_id))
      .map((ob) => `${ob.company_id}::${ob.name.trim().toLowerCase()}`),
  );

  const targetCompanyIds = companyIds.filter(
    (cid) => !existingNamesByCompany.has(`${cid}::${rule.name.trim().toLowerCase()}`),
  );
  const skipped = companyIds.length - targetCompanyIds.length;

  if (!targetCompanyIds.length) {
    showToast('Todas as empresas selecionadas já têm uma obrigação com este nome.', 'error');
    return;
  }

  const payload = targetCompanyIds.map((companyId) => ({
    name: rule.name,
    category: rule.category,
    company_id: companyId,
    responsible: '',
    frequency: rule.frequency,
    day_type: rule.day_type,
    day_of_month: rule.day_of_month,
    month: rule.month,
    months: rule.months,
    business_day_shift: rule.business_day_shift,
    notes: rule.notes,
  }));

  try {
    const created = await createObligationsBulk(payload);
    STATE.obligations = STATE.obligations.concat(created);
    await seedChecklistTemplatesForCreated(created, () => rule);
    const skippedMsg = skipped ? ` (${skipped} empresa(s) já tinham essa obrigação e foram ignoradas)` : '';
    showToast(`${created.length} obrigação(ões) criada(s) a partir do modelo.${skippedMsg}`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Não foi possível aplicar o modelo agora.', 'error');
  } finally {
    onDone?.();
  }
}

// ---------- usuários (criação/edição de conta pela gerência) ----------
// Formulário único faz as duas coisas: se o e-mail digitado já pertence a
// um perfil existente (STATE.profiles), atualizamos nome/papel dessa conta
// em vez de tentar criar outra (o Supabase Auth rejeitaria mesmo, já que
// e-mail é único) — cobre tanto "editar alguém que já tem conta" quanto
// "reativar" (junto com o botão de revogar, ver doSetUserActive acima). Se
// o e-mail não existir ainda, cai no fluxo de criação de conta normal.
export async function doCreateUser(formData, onDone) {
  if (!isAdmin()) return;
  const email = (formData.email || '').trim();
  const displayName = (formData.displayName || '').trim();
  const password = formData.password || '';
  const role = ['admin', 'gestor'].includes(formData.role) ? formData.role : 'membro';
  const workspaceId = isSuperUser() ? (formData.workspaceId || null) : STATE.profile?.workspace_id;

  if (!email || !displayName) { showToast('Informe nome e e-mail.', 'error'); return; }
  if (isSuperUser() && !workspaceId) { showToast('Selecione a empresa à qual a pessoa ficará vinculada.', 'error'); return; }

  const existing = STATE.profiles.find((p) => (p.email || '').trim().toLowerCase() === email.toLowerCase());
  if (existing) {
    await doUpdateExistingUser(existing, { displayName, role, workspace_id: workspaceId }, onDone);
    return;
  }

  if (password.length < 6) { showToast('A senha precisa ter pelo menos 6 caracteres.', 'error'); return; }

  try {
    const { user } = await createUserAccount({ email, password, displayName });
    if (!user) throw new Error('O cadastro não retornou o usuário criado.');

    try {
      const profile = await updateProfile(user.id, { display_name: displayName, role, workspace_id: workspaceId });
      STATE.profiles = STATE.profiles.filter((p) => p.id !== profile.id).concat(profile);
      STATE.profiles.sort((a, b) => a.email.localeCompare(b.email));
    } catch (err) {
      // A conta em si já foi criada com sucesso (o trigger do banco já
      // criou o perfil com papel "membro" padrão) — só o ajuste fino de
      // nome/papel falhou. Não é motivo para reportar falha geral.
      console.error('Conta criada, mas falhou ao ajustar nome/papel — pode corrigir na lista abaixo', err);
      showToast('Conta criada, mas não deu para ajustar nome/papel agora — corrija na lista abaixo.', 'info');
    }

    STATE.pendingNewUserCredentials = { email, password };
    showToast('Conta criada com sucesso.', 'success');
    onDone?.();
  } catch (err) {
    console.error(err);
    let msg = 'Não foi possível criar a conta agora. Verifique os dados e tente novamente.';
    if (/already|existe|registered/i.test(err.message || '')) {
      msg = 'Já existe uma conta com esse e-mail.';
    } else if (/signup.*disab|not allowed|signups? not/i.test(err.message || '') || err.code === 'signup_disabled') {
      // Este projeto tem "Allow new users to sign up" desligado nas
      // configurações de Auth do Supabase — o SETUP.md pede para deixar
      // ligado justamente para esta tela funcionar (ver README, seção
      // "Criação de contas de usuário").
      msg = 'Cadastro de contas novas está desligado neste projeto Supabase. Habilite em Authentication → Sign In / Providers → "Allow new users to sign up" e tente de novo.';
    }
    showToast(msg, 'error');
  }
}

export async function doChangeUserWorkspace(profileId, workspaceId, onDone) {
  if (!isSuperUser()) return;
  try {
    const updated = await updateProfile(profileId, { workspace_id: workspaceId || null });
    STATE.profiles = STATE.profiles.map((profile) => (profile.id === profileId ? updated : profile));
    showToast(workspaceId ? 'Vínculo empresarial atualizado.' : 'Vínculo empresarial removido.', 'success');
  } catch (err) {
    console.error(err);
    showToast('Não foi possível atualizar o vínculo empresarial.', 'error');
  } finally {
    onDone?.();
  }
}

async function doUpdateExistingUser(existing, { displayName, role, workspace_id: workspaceId }, onDone) {
  try {
    const updated = await updateProfile(existing.id, { display_name: displayName, role, workspace_id: workspaceId || null });
    STATE.profiles = STATE.profiles.map((p) => (p.id === existing.id ? updated : p));
    if (existing.id === STATE.session?.id) STATE.profile = updated;
    showToast(`Já existia uma conta com esse e-mail — dados de ${updated.display_name || updated.email} atualizados.`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Já existe uma conta com esse e-mail, mas não deu para atualizar os dados agora.', 'error');
  } finally {
    onDone?.();
  }
}

// ---------- regimes tributários (catálogo mantido pela gerência) ----------

export async function doOpenRegimeDialog(id, onDone) {
  const existing = id ? STATE.taxRegimes.find((r) => r.id === id) : null;
  const result = await regimeDialog({ existing });
  if (!result) return; // cancelado
  await doSaveTaxRegime(id, result, onDone);
}

export async function doSaveTaxRegime(id, formData, onDone) {
  try {
    const payload = { name: formData.name, description: formData.description || '' };
    let saved;
    if (id) {
      saved = await updateTaxRegime(id, payload);
      STATE.taxRegimes = STATE.taxRegimes.map((r) => (r.id === id ? saved : r));
    } else {
      saved = await createTaxRegime(payload);
      STATE.taxRegimes.push(saved);
    }
    STATE.taxRegimes.sort((a, b) => a.name.localeCompare(b.name));
    showToast(id ? 'Regime atualizado.' : 'Regime cadastrado.', 'success');
    onDone?.(saved);
  } catch (err) {
    console.error(err);
    const msg = err.code === '23505' ? 'Já existe um regime com esse nome.' : 'Não foi possível salvar o regime agora.';
    showToast(msg, 'error');
  }
}

export async function doDeleteTaxRegime(id, onDone) {
  const inUse = STATE.companies.filter((c) => c.tax_regime_id === id).length;
  const ok = await confirmDialog({
    title: 'Excluir regime',
    message: inUse
      ? `Excluir este regime tributário? ${inUse} empresa(s) vinculada(s) a ele ficarão sem regime definido — elas não serão excluídas.`
      : 'Excluir este regime tributário do catálogo?',
    confirmLabel: 'Excluir',
  });
  if (!ok) return;

  try {
    await apiDeleteTaxRegime(id);
    STATE.taxRegimes = STATE.taxRegimes.filter((r) => r.id !== id);
    STATE.taxRegimeRules = STATE.taxRegimeRules.filter((l) => l.tax_regime_id !== id);
    STATE.companies = STATE.companies.map((c) => (c.tax_regime_id === id ? { ...c, tax_regime_id: null } : c));
    showToast('Regime excluído.', 'success');
  } catch (err) {
    console.error(err);
    showToast('Não foi possível excluir o regime agora.', 'error');
  } finally {
    onDone?.();
  }
}

// Abre o diálogo de checkboxes com o catálogo inteiro de regras
// (obligation_rules), pré-marcando as já vinculadas a este regime, e
// grava só a diferença (adiciona o que foi marcado a mais, remove o que
// foi desmarcado).
export async function doOpenRegimeRulesDialog(regimeId, onDone) {
  const regime = STATE.taxRegimes.find((r) => r.id === regimeId);
  if (!regime) return;

  const selectedIds = await regimeRulesDialog({ regime });
  if (!selectedIds) return; // cancelado

  const currentIds = new Set(
    STATE.taxRegimeRules.filter((l) => l.tax_regime_id === regimeId).map((l) => l.obligation_rule_id),
  );
  const nextIds = new Set(selectedIds);
  const toAdd = [...nextIds].filter((rid) => !currentIds.has(rid));
  const toRemove = [...currentIds].filter((rid) => !nextIds.has(rid));

  try {
    await Promise.all([
      ...toAdd.map((ruleId) => linkRuleToRegime(regimeId, ruleId)),
      ...toRemove.map((ruleId) => unlinkRuleFromRegime(regimeId, ruleId)),
    ]);
    STATE.taxRegimeRules = STATE.taxRegimeRules
      .filter((l) => !(l.tax_regime_id === regimeId && toRemove.includes(l.obligation_rule_id)))
      .concat(toAdd.map((ruleId) => ({ tax_regime_id: regimeId, obligation_rule_id: ruleId })));
    showToast('Obrigações vinculadas ao regime atualizadas.', 'success');
  } catch (err) {
    console.error(err);
    showToast('Não foi possível salvar os vínculos agora.', 'error');
  } finally {
    onDone?.();
  }
}

// Mesma lógica do diálogo acima, mas para empresas — como cada empresa só
// tem um regime por vez, marcar uma empresa aqui move ela para este regime
// (mesmo que já estivesse vinculada a outro).
export async function doOpenRegimeCompaniesDialog(regimeId, onDone) {
  const regime = STATE.taxRegimes.find((r) => r.id === regimeId);
  if (!regime) return;

  const selectedIds = await regimeCompaniesDialog({ regime });
  if (!selectedIds) return; // cancelado

  const currentIds = new Set(STATE.companies.filter((c) => c.tax_regime_id === regimeId).map((c) => c.id));
  const nextIds = new Set(selectedIds);
  const toAssign = [...nextIds].filter((cid) => !currentIds.has(cid));
  const toUnassign = [...currentIds].filter((cid) => !nextIds.has(cid));

  try {
    const updated = await Promise.all([
      ...toAssign.map((cid) => updateCompanyRegime(cid, regimeId)),
      ...toUnassign.map((cid) => updateCompanyRegime(cid, null)),
    ]);
    const byId = new Map(updated.map((c) => [c.id, c]));
    STATE.companies = STATE.companies.map((c) => byId.get(c.id) || c);
    showToast('Empresas vinculadas ao regime atualizadas.', 'success');
  } catch (err) {
    console.error(err);
    showToast('Não foi possível salvar os vínculos agora.', 'error');
  } finally {
    onDone?.();
  }
}

// Traz automaticamente, de uma vez, todas as obrigações-padrão do regime
// tributário da empresa (com o checklist de cada uma, se a regra tiver um
// cadastrado) — pulando as que a empresa já tem (mesmo nome).
export async function doApplyRegimeToCompany(companyId, onDone) {
  const company = STATE.companies.find((c) => c.id === companyId);
  if (!company) return;

  if (!company.tax_regime_id) {
    showToast('Defina o regime tributário desta empresa primeiro (aba Gerenciar → Regimes).', 'error');
    return;
  }
  const rules = rulesForRegime(company.tax_regime_id);
  if (!rules.length) {
    showToast(`O regime "${taxRegimeName(company.tax_regime_id)}" ainda não tem obrigações vinculadas (aba Gerenciar → Regimes).`, 'error');
    return;
  }

  const existingNames = new Set(
    STATE.obligations.filter((o) => o.company_id === companyId).map((o) => o.name.trim().toLowerCase()),
  );
  const targetRules = rules.filter((r) => !existingNames.has(r.name.trim().toLowerCase()));
  const skipped = rules.length - targetRules.length;

  if (!targetRules.length) {
    showToast('Esta empresa já tem todas as obrigações deste regime cadastradas.', 'error');
    return;
  }

  const payload = targetRules.map((rule) => ({
    name: rule.name,
    category: rule.category,
    company_id: companyId,
    responsible: '',
    frequency: rule.frequency,
    day_type: rule.day_type,
    day_of_month: rule.day_of_month,
    month: rule.month,
    months: rule.months,
    business_day_shift: rule.business_day_shift,
    notes: rule.notes,
  }));

  try {
    const created = await createObligationsBulk(payload);
    STATE.obligations = STATE.obligations.concat(created);

    // Casa cada obrigação criada com a regra de origem pelo NOME (não pela
    // posição/ordem) — o retorno de um insert em lote não tem garantia
    // formal de preservar a ordem de envio, e o nome já é único no
    // catálogo (unique constraint em obligation_rules.name).
    const ruleByName = new Map(targetRules.map((r) => [r.name, r]));
    await seedChecklistTemplatesForCreated(created, (ob) => ruleByName.get(ob.name));

    const skippedMsg = skipped ? ` (${skipped} já existiam nesta empresa e foram ignoradas)` : '';
    showToast(`${created.length} obrigação(ões) trazida(s) do regime "${taxRegimeName(company.tax_regime_id)}".${skippedMsg}`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Não foi possível trazer as obrigações do regime agora.', 'error');
  } finally {
    onDone?.();
  }
}
