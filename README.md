# ASEL Mobile — Stock Management (React + Node + MongoDB)

Secure, multi-franchise stock management for ASEL Mobile. A production-ready
rewrite of the legacy PHP/MySQL app to a modern React + Node + MongoDB stack
with proper RBAC, audit logging, franchise-scoped data isolation, and
containerised deployment.

## Stack

- **Backend** — Node 20, Express, TypeScript, Mongoose (MongoDB 7), Zod, JWT
- **Frontend** — React 18, Vite, TypeScript, React Router, TanStack Query,
  React Hook Form + Zod, Tailwind CSS
- **Ops** — Docker Compose, nginx, GitHub Actions CI, integration tests
  (vitest + supertest + `mongodb-memory-server`)

## Repository layout

```
server/        Node + Express + Mongoose API (Dockerfile, tests)
client/        React + Vite SPA (Dockerfile, nginx config)
legacy/        Frozen legacy PHP + Streamlit code (not deployed)
.github/       CI workflow
docker-compose.yml
SECURITY.md    Production security checklist
```

## Quick start — Docker (recommended)

```bash
# 1. Create an .env at the repo root — JWT_SECRET is required
cp .env.example .env
# Generate a strong secret:
echo "JWT_SECRET=$(openssl rand -base64 48)" >> .env

# 2. Bring up the whole stack (mongo + server + client)
docker compose up --build -d

# 3. Seed initial admin + demo data (one-off, idempotent)
docker compose exec server node dist/seed.js

# App available at http://localhost:8080
# Default admin: "admin" / "ChangeMeNow!2024" — change immediately after login.
```

Logs: `docker compose logs -f`. Tear down: `docker compose down`.

For local tools that need direct Mongo access, enable the `dev` profile:
`docker compose --profile dev up -d` exposes port 27017 on the host loopback.

## Quick start — local dev (no Docker)

```bash
# Root convenience scripts run per-package installs/builds.
npm run install:all

# In one terminal:
cd server && cp .env.example .env && npm run seed && npm run dev
# In another:
cd client && cp .env.example .env && npm run dev
# http://localhost:5173 (proxies /api to http://localhost:4000)
```

You'll still need a MongoDB; start one with `docker compose up -d mongo` if
you don't have one locally.

## Roles

| Role        | Scope            | Permissions |
|-------------|------------------|-------------|
| `admin`     | All franchises   | Full CRUD, user management, audit, settings |
| `manager`   | All franchises   | Products, stock, sales, transfers, reports |
| `franchise` | One franchise    | Stock, sales, returns, local transfers, closings |
| `seller`    | One franchise    | POS / sales only |

Franchise- and seller-scoped users only ever see data from their own franchise,
enforced at the query level in every domain route.

## Feature coverage

Implemented:

- Authentication (bcrypt + JWT in httpOnly cookie) with change-password flow,
  enforced password policy (10+ chars, 3+ character classes), and account
  lockout after 8 failed attempts (15-minute cooldown)
- Users, franchises, categories, suppliers, products CRUD with RBAC
- Stock per franchise, stock entries, manual adjustments
- Sales / POS with guarded stock decrements and multi-line rollback
- Transfers with atomic pending → accepted stock swap
- Dashboard KPIs, low-stock watch, recent activity
- Audit log for every mutation (including failed logins), redacted in
  application logs
- Request ID propagation + structured logs (pino)
- Graceful shutdown, DB-aware `/api/health`
- Prometheus `/api/metrics` (http request counter + latency histogram +
  process / Node runtime defaults)
- OpenAPI 3 spec at `/api/openapi.json` + interactive Swagger UI at `/api/docs`
- Consistent API serialization (`id` on every document, `_id` and `__v`
  stripped, `passwordHash` never leaks)

Deferred (legacy features to re-implement as needed):

- Invoicing (`factures`), installments (`échéances` / `avances`), PDF receipts
- Monthly treasury closings beyond daily count
- SMS reminders / cron jobs
- OCR product import
- Map of franchise locations

## Development commands

From the repo root:

```bash
npm run typecheck       # server + client
npm test                # server integration suite
npm run build           # server + client production bundles
npm run seed            # run seed.ts against the configured MONGODB_URI
npm run docker:up       # build + start all containers
npm run docker:down     # stop + remove containers
npm run docker:seed     # idempotent one-off seed inside the server container
npm run docker:logs     # tail all container logs
```

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push to `main` and
every PR:

1. Server typecheck + full integration test suite (32 tests)
2. Client typecheck + production build
3. `npm audit --omit=dev --audit-level=high` on both apps
4. Docker build for both `server/` and `client/` images (cached)

See `SECURITY.md` for the production deployment checklist and the action
items on the legacy PHP credentials.
