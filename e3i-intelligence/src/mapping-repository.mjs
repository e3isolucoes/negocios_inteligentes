export function mappingStorageKey(tenantId, mappingId) {
  return JSON.stringify([String(tenantId), String(mappingId)]);
}

export function assertMappingRepository(repository) {
  if (!repository || typeof repository !== 'object') {
    throw new TypeError('mapping repository is required');
  }
  for (const method of ['save', 'get', 'list']) {
    if (typeof repository[method] !== 'function') {
      throw new TypeError(`mapping repository must implement ${method}()`);
    }
  }
  return repository;
}
