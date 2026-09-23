export const frontendPayloads = Object.freeze({
  obligation: {
    name: 'DCTFWeb', category: 'federal', module_key: 'fiscal', company_id: null,
    responsible: 'Equipe Fiscal', responsible_id: null, frequency: 'mensal', day_of_month: 15,
    month: null, months: null, due_date: null, notes: '', priority: 'media',
    business_day_shift: 'nenhum', day_type: 'fixo', requires_validation: true,
    validator_id: null, activity_type: 'obrigacao_acessoria', process_name: '', area_name: '',
    predecessor_id: null, requires_attachment: true, requires_attachment_no_movement: true
  },
  completion: {
    obligation_id: 'obligation-a', occurrence_date: '2026-09-01', done_by: 'user-a',
    done_by_name: 'Usuário', attachment_path: null, checklist_total: 2, checklist_checked: 2,
    ocr_status: 'not_checked', ocr_extracted_period: null, movement_status: 'nao_informado'
  },
  category: { name: 'federal', descricao: null, cor: '#2563eb', ordem: 10, ativo: true },
  checklist: { obligation_id: 'obligation-a', description: 'Transmitir declaração', position: 0 },
  rule: { name: 'DCTFWeb', category: 'federal', frequency: 'mensal', day_type: 'fixo', day_of_month: 15, month: null, months: null, adjust_business_day: false, business_day_shift: 'nenhum', notes: '', checklist_template: ['Transmitir declaração'] },
  profileLegacy: { email: 'user@example.com', display_name: 'Usuário', role: 'gestor', active: true, module_access: ['fiscal'] },
  workspaceTrial: { name: 'Empresa A', document: '12345678000199', access_status: 'trial', trial_ends_at: '2026-09-23' },
  approve: { status: 'validada', validated_at: '2026-09-09T12:00:00.000Z', validator_id: 'validator-a' },
  reject: { status: 'rejeitada', rejection_reason: 'Documento contém período incorreto.', rejected_at: '2026-09-09T12:00:00.000Z', validator_id: 'validator-a' }
});
