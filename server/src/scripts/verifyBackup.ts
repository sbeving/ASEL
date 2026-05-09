import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { BACKUP_COLLECTIONS } from '../utils/backupCollections.js';
import { readZipEntries } from '../utils/zipReader.js';

const backupPath = process.argv[2];

if (!backupPath) {
  console.error('Usage: npm run backup:verify -- /path/to/asel-backup.zip');
  process.exit(1);
}

const entries = readZipEntries(await fs.readFile(backupPath));
const byName = new Map(entries.map((entry) => [entry.name, entry]));
const metadataEntry = byName.get('metadata.json');
if (!metadataEntry) throw new Error('Backup is missing metadata.json');

const metadata = JSON.parse(metadataEntry.data.toString('utf8')) as {
  app?: string;
  createdAt?: string;
  format?: string;
  collections?: string[];
  uploadFiles?: number;
};

if (metadata.app !== 'ASEL') throw new Error('Backup metadata app is not ASEL');
if (!metadata.createdAt || Number.isNaN(Date.parse(metadata.createdAt))) {
  throw new Error('Backup metadata createdAt is invalid');
}

const requiredCollections = [...BACKUP_COLLECTIONS, 'audit_logs'];
const missing = requiredCollections.filter((collection) => !byName.has(`collections/${collection}.json`));
if (missing.length > 0) {
  throw new Error(`Backup is missing collections: ${missing.join(', ')}`);
}

let documentCount = 0;
for (const collection of requiredCollections) {
  const entry = byName.get(`collections/${collection}.json`)!;
  const docs = mongoose.mongo.BSON.EJSON.parse(entry.data.toString('utf8'));
  if (!Array.isArray(docs)) throw new Error(`Collection ${collection} is not an array`);
  documentCount += docs.length;
}

const uploadCount = entries.filter((entry) => entry.name.startsWith('uploads/')).length;
if (typeof metadata.uploadFiles === 'number' && metadata.uploadFiles !== uploadCount) {
  throw new Error(`Upload count mismatch: metadata=${metadata.uploadFiles}, archive=${uploadCount}`);
}

console.log(JSON.stringify({
  ok: true,
  file: path.resolve(backupPath),
  createdAt: metadata.createdAt,
  format: metadata.format ?? 'legacy-json',
  collections: requiredCollections.length,
  documents: documentCount,
  uploads: uploadCount,
}, null, 2));
