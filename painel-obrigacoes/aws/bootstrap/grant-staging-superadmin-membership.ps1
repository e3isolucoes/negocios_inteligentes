param(
  [string]$Region = 'sa-east-1',
  [string]$TableName = 'e3i-staging-painel-obrigacoes',
  [string]$RoleArn = 'arn:aws:iam::181215701228:role/e3i-staging-deployer',
  [string]$RoleName = 'e3i-staging-deployer',
  [string]$PolicyName = 'e3i-temporary-staging-membership-grant',
  [string]$PolicyDocument = "$PSScriptRoot\temporary-staging-access-refresh-policy.json",
  [string]$TargetWorkspaceName = 'GRA Comercio'
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$awsPath = 'C:\Program Files\Amazon\AWSCLIV2\aws.exe'
$capacityRaised = $false

if (-not (Test-Path -LiteralPath $awsPath)) {
  throw 'AWS CLI não encontrada.'
}

$session = & $awsPath sts assume-role `
  --role-arn $RoleArn `
  --role-session-name e3i-staging-membership-grant `
  --duration-seconds 900 `
  --output json | ConvertFrom-Json

$env:AWS_ACCESS_KEY_ID = $session.Credentials.AccessKeyId
$env:AWS_SECRET_ACCESS_KEY = $session.Credentials.SecretAccessKey
$env:AWS_SESSION_TOKEN = $session.Credentials.SessionToken

try {
  & $awsPath iam put-role-policy `
    --role-name $RoleName `
    --policy-name $PolicyName `
    --policy-document ("file://" + $PolicyDocument) | Out-Null

  Start-Sleep -Seconds 5

  # A tabela permanece em 1 RCU no uso normal. A descoberta administrativa
  # precisa ler metadados espalhados pelas partições; elevamos por poucos
  # minutos e restauramos no finally, inclusive em caso de erro.
  & $awsPath dynamodb update-table `
    --table-name $TableName `
    --region $Region `
    --provisioned-throughput ReadCapacityUnits=10,WriteCapacityUnits=1 | Out-Null
  $capacityRaised = $true
  & $awsPath dynamodb wait table-exists --table-name $TableName --region $Region
  Start-Sleep -Seconds 5

  $adminPk = 'TOOL#painel-obrigacoes#ENV#staging#ADMINISTRATION'
  $adminValues = @{ ':pk' = @{ S = $adminPk }; ':prefix' = @{ S = 'PROFILE#' } } | ConvertTo-Json -Compress
  $adminResult = & $awsPath dynamodb query `
    --table-name $TableName `
    --region $Region `
    --key-condition-expression 'PK = :pk AND begins_with(SK, :prefix)' `
    --expression-attribute-values $adminValues `
    --consistent-read `
    --output json | ConvertFrom-Json

  $administrator = @($adminResult.Items) | Where-Object { $_.role.S -eq 'super_admin' } | Select-Object -First 1
  if (-not $administrator) { throw 'Superadministrador global não encontrado.' }

  $workspaceValues = @{ ':prefix' = @{ S = 'WORKSPACE_META#' } } | ConvertTo-Json -Compress
  $workspaceResult = & $awsPath dynamodb scan `
    --table-name $TableName `
    --region $Region `
    --filter-expression 'begins_with(SK, :prefix)' `
    --expression-attribute-values $workspaceValues `
    --output json | ConvertFrom-Json

  $workspace = @($workspaceResult.Items) | Where-Object { $_.name.S -eq $TargetWorkspaceName } | Select-Object -First 1
  if (-not $workspace) { throw "Workspace '$TargetWorkspaceName' não encontrado." }

  $userId = $administrator.id.S
  $workspaceId = $workspace.id.S
  $pk = "TOOL#painel-obrigacoes#ENV#staging#USER#$userId"
  $sk = "MEMBERSHIP#$workspaceId"
  $key = @{ PK = @{ S = $pk }; SK = @{ S = $sk } } | ConvertTo-Json -Depth 5 -Compress
  $current = & $awsPath dynamodb get-item `
    --table-name $TableName `
    --region $Region `
    --key $key `
    --consistent-read `
    --output json | ConvertFrom-Json

  if (-not $current.Item) {
    $item = @{
      PK = @{ S = $pk }
      SK = @{ S = $sk }
      userId = @{ S = $userId }
      workspaceId = @{ S = $workspaceId }
      role = @{ S = 'super_admin' }
      active = @{ BOOL = $true }
      toolId = @{ S = 'painel-obrigacoes' }
      environment = @{ S = 'staging' }
      entityType = @{ S = 'membership' }
      schemaVersion = @{ N = '1' }
      grantedBy = @{ S = 'governed-bootstrap' }
      grantedAt = @{ S = (Get-Date).ToUniversalTime().ToString('o') }
    } | ConvertTo-Json -Depth 5 -Compress

    & $awsPath dynamodb put-item `
      --table-name $TableName `
      --region $Region `
      --item $item `
      --condition-expression 'attribute_not_exists(PK)' | Out-Null
  }

  $verified = & $awsPath dynamodb get-item `
    --table-name $TableName `
    --region $Region `
    --key $key `
    --consistent-read `
    --projection-expression 'workspaceId,#r,active,toolId,environment' `
    --expression-attribute-names '{"#r":"role"}' `
    --output json | ConvertFrom-Json

  if (-not $verified.Item -or $verified.Item.active.BOOL -ne $true) {
    throw 'A concessão não pôde ser verificada.'
  }

  [pscustomobject]@{
    granted = $true
    workspace = $TargetWorkspaceName
    role = $verified.Item.role.S
    active = $verified.Item.active.BOOL
  } | ConvertTo-Json -Compress
}
finally {
  try {
    try {
      if ($capacityRaised) {
        & $awsPath dynamodb update-table `
          --table-name $TableName `
          --region $Region `
          --provisioned-throughput ReadCapacityUnits=1,WriteCapacityUnits=1 | Out-Null
        & $awsPath dynamodb wait table-exists --table-name $TableName --region $Region
      }
    }
    finally {
      & $awsPath iam delete-role-policy --role-name $RoleName --policy-name $PolicyName | Out-Null
    }
  }
  finally {
    Remove-Item Env:AWS_ACCESS_KEY_ID -ErrorAction SilentlyContinue
    Remove-Item Env:AWS_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:AWS_SESSION_TOKEN -ErrorAction SilentlyContinue
  }
}
