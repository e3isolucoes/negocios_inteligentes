import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { deletionHandler, reconcileDeletions } from './deletion-worker.mjs';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const s3 = new S3Client({});
const dependencies = { ddb, s3, tableName: process.env.TABLE_NAME, bucket: process.env.FILES_BUCKET };

export const worker = deletionHandler(dependencies);
export const reconcile = () => reconcileDeletions(dependencies);
