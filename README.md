# ASEL Mobile - Stock Management (React + Node + MongoDB)

Secure, multi-franchise stock and operations management for ASEL Mobile.
This repo is the modern rewrite of the legacy PHP/MySQL platform.

## Stack

- Backend: Node 20, Express, TypeScript, Mongoose (MongoDB), Zod, JWT
- Frontend: React 18, Vite, TypeScript, React Router, TanStack Query, Tailwind
- Security: bcrypt password hashing, httpOnly cookies, Helmet, CORS allowlist,
  rate limiting, RBAC + franchise scoping, and audit logging

## Repository layout

```text
server/   Node + Express + MongoDB API
client/   React + Vite SPA
mobile/   Expo React Native pointage app
old/      Legacy PHP reference source
```

## Quick start with Docker

The default Compose file is the development stack:

- MongoDB
- API with TypeScript watch mode
- Vite client with hot reload
- Cloudflare quick tunnel for a random public dev URL

```bash
cp .env.example .env
docker compose up --build
```

Open the local app:

```text
http://localhost:5173
```

Find the public dev link:

```bash
docker compose logs -f dev-tunnel
```

Look for the `https://....trycloudflare.com` URL in the logs. Anyone with that URL can reach the dev app while the tunnel is running.

### Stable Cloudflare URL

Keep `https://asel.saleheddinetouil.tech` for the VPS-hosted version. For local
development, prefer the random `trycloudflare.com` URL printed by `dev-tunnel`.

1. In Cloudflare Zero Trust, create a Cloudflared tunnel named `asel-dev`.
2. Add a public hostname:
   - Subdomain: `asel`
   - Domain: `saleheddinetouil.tech`
   - Type: `HTTP`
   - URL: `http://client:5173`
3. Paste the tunnel Docker token into `.env`:

```bash
CLOUDFLARED_TOKEN=eyJ...
```

4. Start the named tunnel:

```bash
docker compose --profile cloudflare-named up -d dev-tunnel-named
docker compose logs -f dev-tunnel-named
```

The app will be available at `https://asel.saleheddinetouil.tech`, and the API
will be available through the same domain at
`https://asel.saleheddinetouil.tech/api`.

Seed demo data from another terminal:

```bash
docker compose exec server npm run seed
```

More Docker details are in `docs/DOCKER.md`.

## Local quick start without Docker

```bash
# 1. Start MongoDB
cp .env.example .env
docker compose up -d mongo

# 2. Server
cd server
cp .env.example .env
npm install
npm run seed
npm run dev

# 3. Client (new terminal)
cd client
cp .env.example .env
npm install
npm run dev
```

## Mobile pointage app

The Expo app is intentionally limited:

- `siege_employee`: pointage, GPS capture, monthly worked-hours total
- `commercial`: pointage, 5-minute location pings, assigned map zones, activation/recharge points, and lead creation from current GPS

```bash
cd mobile
npm install
npm start
```

For local mobile testing, point Expo at the random Cloudflare API URL from the
local tunnel:

```bash
EXPO_PUBLIC_API_BASE_URL=https://your-random-name.trycloudflare.com/api npm start
```

The app falls back to `http://localhost:4000/api` for local simulators. Override
with `EXPO_PUBLIC_API_BASE_URL` for iPhone testing and later for OVH production.

## Production deployment

OVH VPS deployment assets are included:

- `docker-compose.prod.yml`
- `server/Dockerfile`
- `client/Dockerfile`
- `client/nginx.conf`
- `deploy/ovh/Caddyfile`
- `deploy/ovh/README.md`

Start with `deploy/ovh/README.md` and `.env.production.example`.

## Seed behavior

`npm run seed` now bootstraps a full, cross-module dataset:

- Users / roles
- Franchises, categories, suppliers, products
- Stock + movements
- Sales, transfers, receptions, returns
- Installments, closings, monthly inventories
- Cashflow, demands, services + prestations
- Time logs, network points, notifications, audit logs

Default mode resets seeded collections, then inserts fresh data.

```bash
npm run seed
```

To skip reset (only seed if DB is empty):

```bash
npm run seed -- --no-reset
```

## Seed credentials

- Admin username: from `SEED_ADMIN_USERNAME`
- Admin password: from `SEED_ADMIN_PASSWORD`
- Other seeded users share password: from `SEED_SHARED_PASSWORD`

Change all passwords after first bootstrap.

## Feature coverage

Implemented modules include:

- Authentication + RBAC
- Products/catalog
- Stock and stock movements
- POS sales and installments
- Transfers and receptions
- Returns and clients
- Closings and monthly inventories
- Treasury/cashflow
- Time logs (pointage)
- Demands workflow
- Services + prestations
- Network points
- Notifications
- Audit logging

OCR-assisted reception parsing and Multer-based file uploads are also integrated.
