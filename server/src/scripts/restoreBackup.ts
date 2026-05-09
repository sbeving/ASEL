import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { connectDb } from '../db/connect.js';
import { uploadRoot } from '../config/uploads.js';
import { BACKUP_COLLECTIONS } from '../utils/backupCollections.js';
import { readZipEntries } from '../utils/zipReader.js';

const backupPath = process.argv[2];

if (!backupPath) {
  console.error('Usage: RESTORE_CONFIRM=YES npm run backup:restore -- /path/to/asel-backup.zip');
  process.exit(1);
}

if (process.env.RESTORE_CONFIRM !== 'YES') {
  console.error('Refusing destructive restore. Re-run with RESTORE_CONFIRM=YES.');
  process.exit(1);
}

function safeUploadTarget(relativePath: string) {
  const root = path.resolve(uploadRoot);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Unsafe upload path in backup: ${relativePath}`);
  }
  return target;
}

const entries = readZipEntries(await fs.readFile(backupPath));
const byName = new Map(entries.map((entry) => [entry.name, entry]));
const metadata = byName.get('metadata.json');
if (!metadata) throw new Error('Backup is missing metadata.json');

const requiredCollections = [...BACKUP_COLLECTIONS, 'audit_logs'];
const missing = requiredCollections.filter((collection) => !byName.has(`collections/${collection}.json`));
if (missing.length > 0) {
  throw new Error(`Backup is missing collections: ${missing.join(', ')}`);
}

await connectDb();
const db = mongoose.connection.db;
if (!db) throw new Error('MongoDB connection is not ready');

let restoredDocuments = 0;
for (const collection of requiredCollections) {
  const entry = byName.get(`collections/${collection}.json`)!;
  const docs = mongoose.mongo.BSON.EJSON.parse(entry.data.toString('utf8'));
  if (!Array.isArray(docs)) throw new Error(`Collection ${collection} is not an array`);
  await db.collection(collection).deleteMany({});
  if (docs.length > 0) {
    await db.collection(collection).insertMany(docs, { ordered: false });
  }
  restoredDocuments += docs.length;
}

const uploadEntries = entries.filter((entry) => entry.name.startsWith('uploads/') && !entry.name.endsWith('/'));
if (process.env.RESTORE_CLEAN_UPLOADS !== 'false') {
  await fs.rm(uploadRoot, { recursive: true, force: true });
}
await fs.mkdir(uploadRoot, { recursive: true });
for (const entry of uploadEntries) {
  const relative = entry.name.slice('uploads/'.length);
  const target = safeUploadTarget(relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, entry.data, { mode: 0o600 });
}

await mongoose.disconnect();

console.log(JSON.stringify({
  ok: true,
  file: path.resolve(backupPath),
  collections: requiredCollections.length,
  documents: restoredDocuments,
  uploads: uploadEntries.length,
}, null, 2));
