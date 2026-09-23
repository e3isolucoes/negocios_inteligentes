// Compatibilidade deliberadamente segura: o migrador antigo não usa mais BatchWrite/Put.
// A execução só ocorre pelo fluxo snapshot -> apply, com manifesto explícito.
if (process.argv.includes('--execute')) {
  throw new Error('migrate.mjs foi desativado. Use `npm run snapshot` e `npm run apply -- --manifest <arquivo>`.');
}
process.argv.splice(2, process.argv.length - 2, 'plan');
await import('./commands.mjs');
