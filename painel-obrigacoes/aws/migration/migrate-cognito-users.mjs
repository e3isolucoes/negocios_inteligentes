import { randomBytes } from 'node:crypto';
import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminGetUserCommand, AdminSetUserPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { documentClient } from './shared.mjs';

const execute = process.argv.includes('--execute');
const table = process.env.DYNAMODB_TABLE;
const userPoolId = process.env.COGNITO_USER_POOL_ID;
if (!table || !userPoolId) throw new Error('DYNAMODB_TABLE e COGNITO_USER_POOL_ID são obrigatórios.');
const dynamo = await documentClient();
const cognito = new CognitoIdentityProviderClient({});
let ExclusiveStartKey; const profiles = [];
do {
  const page = await dynamo.send(new ScanCommand({ TableName: table, FilterExpression: 'entityType = :type AND attribute_exists(email)', ExpressionAttributeValues: { ':type': 'profiles' }, ExclusiveStartKey }));
  profiles.push(...(page.Items || [])); ExclusiveStartKey = page.LastEvaluatedKey;
} while (ExclusiveStartKey);

const unique = [...new Map(profiles.map((profile) => [String(profile.email).toLowerCase(), profile])).values()];
const report = { mode: execute ? 'execute' : 'dry-run', discovered: unique.length, created: 0, existing: 0, skipped: [] };
for (const profile of unique) {
  const email = String(profile.email || '').trim().toLowerCase();
  if (!email || !profile.id) { report.skipped.push({ id: profile.id, reason: 'email ou id ausente' }); continue; }
  if (!execute) continue;
  try {
    await cognito.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email })); report.existing += 1; continue;
  } catch (error) { if (error.name !== 'UserNotFoundException') throw error; }
  await cognito.send(new AdminCreateUserCommand({ UserPoolId: userPoolId, Username: email, MessageAction: 'SUPPRESS', UserAttributes: [
    { Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }, { Name: 'custom:legacy_user_id', Value: String(profile.id) },
  ] }));
  const randomPassword = `E3i-${randomBytes(24).toString('base64url')}9aA`;
  await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: userPoolId, Username: email, Password: randomPassword, Permanent: true }));
  report.created += 1;
}
console.log(JSON.stringify(report, null, 2));
