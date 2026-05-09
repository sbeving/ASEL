# OVH Deployment Guide

This stack is prepared for a standard OVH Linux VPS using Docker Compose.

## Topology

- `mongo`: MongoDB 7 with persistent volume
- `server`: Node 20 API container
- `web`: Nginx container serving the React build and proxying `/api` to the API
- `caddy`: public reverse proxy with automatic HTTPS via Let's Encrypt

## Prerequisites

1. Ubuntu 22.04 or newer on OVH VPS
2. A DNS `A` record pointing `APP_DOMAIN` to the VPS public IP
3. Ports `80` and `443` open in OVH firewall / security group
4. Docker Engine + Docker Compose plugin installed

## Files to prepare

1. Copy `.env.production.example` to `.env.production`
2. Replace all secret values
3. Set `APP_DOMAIN` to the real public hostname
4. Set `ACME_EMAIL` to the mailbox used for TLS notifications

Important:

- Keep `COOKIE_SECURE=true`
- Set `CORS_ORIGINS` to the exact public app origin, for example `https://app.example.tn`
- If your Mongo password contains reserved URI characters, URL-encode it inside `MONGODB_URI`

## First deployment

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

## Seed initial data

Run this once after the first boot:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec server npm run seed
```

## Health checks

API:

```bash
curl https://YOUR_DOMAIN/api/health
```

App entry:

```bash
curl -I https://YOUR_DOMAIN
```

## Common operations

View logs:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f
```

Restart only the API:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml restart server
```

Rebuild after code changes:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

## Backup notes

The API creates daily restore-grade ZIP backups when `BACKUP_ENABLED=true`.
Backups include Mongo Extended JSON collections plus uploaded files/PDFs.

Recommended env:

```bash
BACKUP_DIR=/app/backups
BACKUP_OFFSITE_DIR=/app/offsite-backups
BACKUP_OFFSITE_HOST_DIR=/srv/asel-offsite-backups
```

Verify an archive:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec server npm run backup:verify -- /app/backups/asel-backup-YYYY-MM-DDTHH-MM-SS-ZZZZ.zip
```

See `docs/BACKUP_RESTORE.md` for restore testing and offsite sync guidance.

## Production recommendations

1. Put OVH monitoring on `https://YOUR_DOMAIN/api/health`
2. Rotate seeded passwords immediately after bootstrap
3. Restrict SSH to key-based access only
4. Enable automatic security updates on the VPS
5. Configure encrypted offsite sync for `/srv/asel-offsite-backups`
