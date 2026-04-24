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
old/      Legacy PHP reference source
```

## Quick start

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
