# ASEL Backup And Restore Playbook

ASEL backups must include the Mongo database and every uploaded file/PDF. The API now creates restore-grade ZIP archives with:

- `metadata.json`
- Mongo collections in `collections/*.json` using Mongo Extended JSON, preserving ObjectIds and dates
- all uploads under `uploads/`, including treasury docs, receipts, reception OCR files, network point documents, product images, and avatars

## Automatic Backups

Production runs the daily scheduler from the API container when `BACKUP_ENABLED=true`.

Recommended production env:

```bash
BACKUP_ENABLED=true
BACKUP_DIR=/app/backups
BACKUP_HOUR=3
BACKUP_RETENTION_DAYS=14
BACKUP_MAX_FILES=30
BACKUP_MAX_TOTAL_MB=512
BACKUP_OFFSITE_DIR=/app/offsite-backups
BACKUP_OFFSITE_HOST_DIR=/srv/asel-offsite-backups
```

`docker-compose.prod.yml` mounts:

- `backups-data:/app/backups`
- `${BACKUP_OFFSITE_HOST_DIR:-./offsite-backups}:/app/offsite-backups`

For real offsite protection, sync `/srv/asel-offsite-backups` to another machine or cloud storage with the hosting provider's backup job, `rclone`, `restic`, or an encrypted storage bucket.

## Manual Backup

From the VPS project folder:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec server node -e "import('./dist/services/backup.service.js').then(m => m.createOperationalBackup()).then(console.log)"
```

Then verify the newest archive:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec server npm run backup:verify -- /app/backups/asel-backup-YYYY-MM-DDTHH-MM-SS-ZZZZ.zip
```

## Restore Test

Run this on a staging copy first, not on production:

```bash
RESTORE_CONFIRM=YES docker compose --env-file .env.production -f docker-compose.prod.yml exec server npm run backup:restore -- /app/backups/asel-backup-YYYY-MM-DDTHH-MM-SS-ZZZZ.zip
```

The restore command:

- deletes and reinserts all ASEL collections from the archive
- replaces uploads by default
- preserves ObjectIds, dates, sequence counters, receipt numbers, ledger rows, pointage, notifications, and system settings

To keep existing uploads while restoring database data:

```bash
RESTORE_CONFIRM=YES RESTORE_CLEAN_UPLOADS=false docker compose --env-file .env.production -f docker-compose.prod.yml exec server npm run backup:restore -- /app/backups/asel-backup-YYYY-MM-DDTHH-MM-SS-ZZZZ.zip
```

## Acceptance Checklist

- Backup archive verifies with `npm run backup:verify`.
- Restore on staging starts without schema errors.
- Login works with an admin account.
- Product images, point documents, treasury receipts, installment receipts, and OCR files open through protected upload URLs.
- `/api/health` returns OK after restore.
- New sale, pointage, treasury receipt, and network point document upload work after restore.
