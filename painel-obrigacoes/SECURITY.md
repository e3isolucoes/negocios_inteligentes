# Política de segurança

Não registre vulnerabilidades em issues públicas. Comunique o responsável técnico
da E3I Soluções por canal privado, incluindo impacto, passos de reprodução e a
versão afetada. Não inclua dados reais de clientes na evidência.

Segredos, backups e credenciais nunca devem ser enviados ao GitHub. A chave
`service_role` do Supabase é permitida somente em execução server-side e deve ser
rotacionada imediatamente se aparecer em chat, log, commit ou captura pública.

Correções críticas que afetem autenticação, autorização, RLS ou isolamento entre
empresas bloqueiam novas versões até validação no ambiente de preview.
