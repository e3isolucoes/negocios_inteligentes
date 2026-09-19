// Service worker intencionalmente "vazio": não cacheia nada.
//
// Este painel mostra prazos e status que mudam todo dia (atrasada, vence em
// breve, no prazo...). Cachear a página ou os dados criaria o risco de
// alguém ver uma informação desatualizada sem perceber — inaceitável para
// uma ferramenta de compliance. Este arquivo existe só para satisfazer o
// critério técnico de "instalável como app" dos navegadores; toda
// requisição continua indo para a rede normalmente.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Sem cache — deixa o navegador tratar a requisição normalmente.
});
