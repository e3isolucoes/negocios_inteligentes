(() => {
  const legacyRequested = new URLSearchParams(window.location.search).get('backend') === 'supabase';

  globalThis.E3I_CONFIG = Object.freeze({
    dataBackend: legacyRequested ? 'supabase' : 'aws',
    awsApiBase: 'https://oezgdex1li.execute-api.sa-east-1.amazonaws.com',
    authBackend: legacyRequested ? 'supabase' : 'cognito',
    cognitoRegion: 'sa-east-1',
    cognitoUserPoolId: 'sa-east-1_cc1svByQA',
    cognitoClientId: '28ggf95n4b9q5d5ve5vvlj048p',
    portalOrigin: 'https://portal.e3isolucoes.com.br',
    enabledModules: ['obrigacoes', 'validacoes', 'dashboard', 'relatorios', 'administracao'],
    environment: legacyRequested ? 'production' : 'staging',
  });
})();
