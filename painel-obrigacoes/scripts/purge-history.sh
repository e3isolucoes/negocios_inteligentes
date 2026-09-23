#!/usr/bin/env bash
# Purge histórico do arquivo js/config.js do repositório remoto
# USO: execute este script localmente numa máquina com git instalado.
# AVISO: isto reescreve o histórico e exige force-push; todos os colaboradores
# terão que re-clonar o repositório após a operação.

set -euo pipefail

REPO_URL="https://github.com/e3isolucoes/portal-e3i-solucoes.git"
TMP_DIR="painel-obrigacoes-purge-temp"
PATH_TO_REMOVE="js/config.js"

echo "1) Fazendo clone espelho do repositório (backup)..."
# Clona um mirror completo (inclui todos os refs)
rm -rf "$TMP_DIR"
git clone --mirror "$REPO_URL" "$TMP_DIR"
cd "$TMP_DIR"

echo "2) Executando git filter-repo para remover $PATH_TO_REMOVE do histórico..."
# Requer git-filter-repo instalado: https://github.com/newren/git-filter-repo
# Se não tiver, instale via pip: pip install git-filter-repo
if ! command -v git-filter-repo >/dev/null 2>&1; then
  echo "ERRO: git-filter-repo não encontrado. Instale-o (pip install git-filter-repo) e execute novamente." >&2
  exit 1
fi

# Remove o arquivo do histórico
git filter-repo --path "$PATH_TO_REMOVE" --invert-paths

echo "3) Forçando push do histórico limpo para o origin (ATENÇÃO: força push)..."
# Forçar push de todos os refs para a origem
GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=no" git push --force --tags origin 'refs/heads/*'

echo "4) Limpeza local e instruções para colaboradores"
cd ..
rm -rf "$TMP_DIR"

echo "Purge completo. IMPORTANTE: informe a todos os colaboradores para:
  1) Fazer backup de qualquer trabalho local não-pushado.
  2) Rodar: git fetch origin && git reset --hard origin/main (ou re-clonar o repositório).
  3) Reclonar é a forma mais segura: git clone $REPO_URL
"

echo "5) Rotacione as chaves no Supabase imediatamente se as credenciais foram expostas."

# Fim
