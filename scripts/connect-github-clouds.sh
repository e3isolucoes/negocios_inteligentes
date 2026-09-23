#!/usr/bin/env bash
set -euo pipefail

readonly REPOSITORY="${GITHUB_REPOSITORY:-e3isolucoes/portal-e3i-solucoes}"
readonly AWS_REGION="${AWS_REGION:-sa-east-1}"
readonly AWS_STACK_NAME="${AWS_STACK_NAME:-e3i-github-staging-deployer}"
readonly AWS_DEPLOY_ROLE_NAME="${AWS_DEPLOY_ROLE_NAME:-e3i-staging-deployer}"
readonly AWS_EXISTING_DEPLOY_ROLE_ARN="${AWS_EXISTING_DEPLOY_ROLE_ARN:-}"

usage() {
  cat <<'EOF'
Uso:
  AZURE_RESOURCE_GROUP=<grupo> AZURE_STATIC_WEB_APP=<nome> \
    ./scripts/connect-github-clouds.sh

Se a role AWS de deploy já existir fora do stack de bootstrap, informe também:
  AWS_EXISTING_DEPLOY_ROLE_ARN=arn:aws:iam::<conta>:role/e3i-staging-deployer

Pré-requisitos: gh, az e aws instalados e autenticados nas contas corretas.
O script não imprime tokens e grava o token Azure diretamente nos ambientes
GitHub `production` e `preview`.
EOF
}

fail() {
  printf 'Erro: %s\n' "$*" >&2
  exit 1
}

for command_name in gh az aws; do
  command -v "$command_name" >/dev/null 2>&1 || fail "comando '$command_name' não encontrado"
done

[[ -n "${AZURE_RESOURCE_GROUP:-}" ]] || { usage >&2; fail 'AZURE_RESOURCE_GROUP não informado'; }
[[ -n "${AZURE_STATIC_WEB_APP:-}" ]] || { usage >&2; fail 'AZURE_STATIC_WEB_APP não informado'; }

gh auth status >/dev/null 2>&1 || fail 'autentique o GitHub CLI com gh auth login'
az account show >/dev/null 2>&1 || fail 'autentique o Azure CLI com az login'

account_id="$(aws sts get-caller-identity --query Account --output text)"
[[ "$account_id" =~ ^[0-9]{12}$ ]] || fail 'não foi possível identificar a conta AWS'

remote_url="$(gh repo view "$REPOSITORY" --json url --jq .url)"
printf 'GitHub: %s\n' "$remote_url"

for environment in preview production aws-staging; do
  gh api --method PUT "repos/${REPOSITORY}/environments/${environment}" --input - \
    <<< '{}' >/dev/null
done

oidc_arn="arn:aws:iam::${account_id}:oidc-provider/token.actions.githubusercontent.com"
aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$oidc_arn" \
  >/dev/null 2>&1 || fail "provedor OIDC ausente na AWS: $oidc_arn"

if [[ -n "$AWS_EXISTING_DEPLOY_ROLE_ARN" ]]; then
  expected_role_prefix="arn:aws:iam::${account_id}:role/"
  [[ "$AWS_EXISTING_DEPLOY_ROLE_ARN" == "${expected_role_prefix}"* ]] \
    || fail 'AWS_EXISTING_DEPLOY_ROLE_ARN não pertence à conta AWS autenticada'
  role_name="${AWS_EXISTING_DEPLOY_ROLE_ARN#${expected_role_prefix}}"
  aws iam get-role --role-name "$role_name" >/dev/null 2>&1 \
    || fail "role AWS existente não encontrada: $role_name"
  role_arn="$AWS_EXISTING_DEPLOY_ROLE_ARN"
  printf 'AWS: reutilizando role existente %s; criação via bootstrap foi ignorada.\n' "$role_arn"
else
  if aws iam get-role --role-name "$AWS_DEPLOY_ROLE_NAME" >/dev/null 2>&1; then
    if ! aws cloudformation describe-stack-resource \
      --stack-name "$AWS_STACK_NAME" \
      --logical-resource-id StagingDeployerRole \
      --region "$AWS_REGION" >/dev/null 2>&1; then
      fail "role '$AWS_DEPLOY_ROLE_NAME' já existe fora do stack '$AWS_STACK_NAME'; defina AWS_EXISTING_DEPLOY_ROLE_ARN=arn:aws:iam::${account_id}:role/${AWS_DEPLOY_ROLE_NAME} para reutilizá-la explicitamente"
    fi
  fi

  aws cloudformation deploy \
    --stack-name "$AWS_STACK_NAME" \
    --template-file painel-obrigacoes/aws/bootstrap/deployer.yaml \
    --region "$AWS_REGION" \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides AccountId="$account_id"

  role_arn="$(aws cloudformation describe-stacks \
    --stack-name "$AWS_STACK_NAME" \
    --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue" \
    --output text)"
fi

[[ "$role_arn" == arn:aws:iam::*:role/* ]] || fail 'ARN da role AWS inválida'
printf '%s' "$role_arn" | gh variable set AWS_STAGING_DEPLOY_ROLE_ARN \
  --repo "$REPOSITORY" --env aws-staging

azure_hostname="$(az staticwebapp show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_STATIC_WEB_APP" \
  --query defaultHostname --output tsv)"
[[ -n "$azure_hostname" ]] || fail 'Azure Static Web App não encontrada'

azure_token="$(az staticwebapp secrets list \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_STATIC_WEB_APP" \
  --query properties.apiKey --output tsv)"
[[ -n "$azure_token" ]] || fail 'token de implantação Azure não retornado'

for environment in preview production; do
  printf '%s' "$azure_token" | gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN \
    --repo "$REPOSITORY" --env "$environment"
done
unset azure_token

printf 'AWS: conta %s, role configurada em aws-staging.\n' "$account_id"
printf 'Azure: https://%s conectado a preview e production.\n' "$azure_hostname"
printf 'Conexões concluídas sem credenciais permanentes no repositório.\n'
