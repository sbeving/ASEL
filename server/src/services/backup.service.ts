import fs from 'node:fs/promises';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { auditSystem } from './audit.service.js';
import { logger } from '../utils/logger.js';

const COLLECTIONS = [
  'franchises',
  'users',
  'categories',
  'suppliers',
  'products',
  'stocks',
  'movements',
  'sales',
  'installments',
  'clients',
  'cashflows',
  'closings',
  'returns',
  'transfers',
  'demands',
  'receptions',
  'monthly_inventories',
  'services',
  'prestations',
  'network_points',
  'network_point_allocations',
  'commercial_zones',
  'location_pings',
  'leave_requests',
] as const;

const AUDIT_LOG_RETENTION_DAYS = 90;

interface ZipEntry {
  name: string;
  data: Buffer;
  mtime: Date;
}

interface BackupFile {
  name: string;
  path: string;
  size: number;
  mtime: Date;
}

let backupRunning = false;

function backupDirectory(): string {
  return path.isAbsolute(env.BACKUP_DIR) ? env.BACKUP_DIR : path.resolve(process.cwd(), env.BACKUP_DIR);
}

function dateStamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function dosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = buildCrcTable();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const centralDirectory: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const fileName = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);
    const { dosDate, dosTime } = dosDateTime(entry.mtime);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);

    chunks.push(localHeader, fileName, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralDirectory.push(centralHeader, fileName);

    offset += localHeader.length + fileName.length + compressed.length;
  }

  const centralOffset = offset;
  const centralSize = centralDirectory.reduce((sum, chunk) => sum + chunk.length, 0);
  chunks.push(...centralDirectory);

  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(entries.length, 8);
  footer.writeUInt16LE(entries.length, 10);
  footer.writeUInt32LE(centralSize, 12);
  footer.writeUInt32LE(centralOffset, 16);
  chunks.push(footer);

  return Buffer.concat(chunks);
}

async function collectionDocuments(collectionName: string, now: Date) {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not ready');

  if (collectionName === 'audit_logs') {
    const since = new Date(now.getTime() - AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    return db.collection(collectionName).find({ createdAt: { $gte: since } }).sort({ createdAt: 1 }).toArray();
  }

  return db.collection(collectionName).find({}).toArray();
}

export async function createOperationalBackup(now = new Date()) {
  if (backupRunning) return { skipped: true, reason: 'already_running' as const };
  backupRunning = true;

  try {
    const dir = backupDirectory();
    await fs.mkdir(dir, { recursive: true });

    const metadata = {
      app: 'ASEL',
      createdAt: now.toISOString(),
      database: mongoose.connection.db?.databaseName ?? 'unknown',
      collections: [...COLLECTIONS, 'audit_logs'],
      excludes: ['uploads', 'product-images', 'user-avatars', 'treasury-docs', 'reception-ocr'],
      retention: {
        days: env.BACKUP_RETENTION_DAYS,
        maxFiles: env.BACKUP_MAX_FILES,
        maxTotalMb: env.BACKUP_MAX_TOTAL_MB,
      },
    };

    const entries: ZipEntry[] = [
      {
        name: 'metadata.json',
        data: Buffer.from(JSON.stringify(metadata, null, 2)),
        mtime: now,
      },
    ];

    for (const collection of [...COLLECTIONS, 'audit_logs']) {
      const docs = await collectionDocuments(collection, now);
      entries.push({
        name: `collections/${collection}.json`,
        data: Buffer.from(JSON.stringify(docs, null, 2)),
        mtime: now,
      });
    }

    const filename = `asel-backup-${dateStamp(now)}.zip`;
    const filePath = path.join(dir, filename);
    const archive = zip(entries);
    await fs.writeFile(filePath, archive, { mode: 0o644 });

    await cleanupBackups(dir);

    await auditSystem({
      action: 'backup.create',
      entity: 'Backup',
      entityId: filename,
      details: { filename, sizeBytes: archive.length, collections: metadata.collections },
    });

    return {
      skipped: false as const,
      filename,
      path: filePath,
      sizeBytes: archive.length,
      collections: metadata.collections.length,
    };
  } finally {
    backupRunning = false;
  }
}

export async function listBackups(): Promise<BackupFile[]> {
  const dir = backupDirectory();
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^asel-backup-.+\.zip$/.test(entry.name))
      .map(async (entry) => {
        const filePath = path.join(dir, entry.name);
        const stat = await fs.stat(filePath);
        return { name: entry.name, path: filePath, size: stat.size, mtime: stat.mtime };
      }),
  );
  return files.sort((left, right) => right.mtime.getTime() - left.mtime.getTime());
}

async function cleanupBackups(dir: string) {
  const files = await listBackups();
  const cutoff = Date.now() - env.BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const keep = new Set(files.slice(0, env.BACKUP_MAX_FILES).map((file) => file.path));
  const maxTotalBytes = env.BACKUP_MAX_TOTAL_MB * 1024 * 1024;
  let totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  for (const file of [...files].reverse()) {
    const expired = file.mtime.getTime() < cutoff;
    const tooMany = !keep.has(file.path);
    const tooLarge = totalBytes > maxTotalBytes;
    if (!expired && !tooMany && !tooLarge) continue;
    try {
      await fs.unlink(file.path);
      totalBytes -= file.size;
    } catch (err) {
      logger.warn({ err, file: file.path }, 'Backup cleanup failed');
    }
  }
}

function msUntilNextBackup(now = new Date()) {
  const next = new Date(now);
  next.setHours(env.BACKUP_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function scheduleDailyBackups() {
  if (!env.BACKUP_ENABLED) {
    logger.info('Daily backup scheduler disabled');
    return;
  }

  const runAndReschedule = () => {
    void createOperationalBackup()
      .then((result) => logger.info({ result }, 'Daily operational backup completed'))
      .catch((err) => logger.warn({ err }, 'Daily operational backup failed'))
      .finally(() => {
        const timer = setTimeout(runAndReschedule, msUntilNextBackup());
        timer.unref?.();
      });
  };

  const timer = setTimeout(runAndReschedule, msUntilNextBackup());
  timer.unref?.();
  logger.info({ hour: env.BACKUP_HOUR, dir: backupDirectory() }, 'Daily backup scheduler armed');
}
