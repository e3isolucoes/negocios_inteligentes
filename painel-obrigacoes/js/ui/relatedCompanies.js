function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function renderRelatedCompaniesTags(record = {}) {
  const related = Array.isArray(record.relatedCompanies)
    ? record.relatedCompanies.filter((company) => company?.razaoSocial)
    : [];

  if (!related.length) return '';

  return '<div class="related-companies-tags" aria-label="Empresas também envolvidas">'
    + related.map((company) => (
      '<span class="badge related-company-tag">'
      + `Também envolve: ${escapeHtml(company.razaoSocial)}`
      + '</span>'
    )).join('')
    + '</div>';
}
