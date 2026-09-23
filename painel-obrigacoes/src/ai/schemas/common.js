export const RiskLevel = Object.freeze({ LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' });
export const HumanControlLevel = Object.freeze({ READ_ONLY: 'READ_ONLY', RECOMMEND: 'RECOMMEND', DRAFT_ACTION: 'DRAFT_ACTION', EXECUTE_WITH_APPROVAL: 'EXECUTE_WITH_APPROVAL', EXECUTE_WITH_POLICY: 'EXECUTE_WITH_POLICY', AUTONOMOUS: 'AUTONOMOUS' });
export const InferenceType = Object.freeze({ FACT: 'FACT', INFERENCE: 'INFERENCE', HYPOTHESIS: 'HYPOTHESIS', RECOMMENDATION: 'RECOMMENDATION' });
export const TenantContextSchema = {
  safeParse(value) {
    const ok = value && ['organizationId', 'userId', 'membershipId'].every((key) => typeof value[key] === 'string' && value[key]) && value.membershipActive === true;
    return ok ? { success: true, data: value } : { success: false, error: new Error('TenantContext inválido') };
  },
};
