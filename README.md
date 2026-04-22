# ASEL Mobile — Stock Management (React + Node + MongoDB)

Secure, multi-franchise stock management for ASEL Mobile. Rewritten from the
legacy PHP/MySQL app to a modern React + Node + MongoDB stack with proper
RBAC, audit logging, and franchise-scoped data isolation.

## Stack

- **Backend** — Node 20, Express, TypeScript, Mongoose (MongoDB 7), Zod, JWT
- **Frontend** — React 18, Vite, TypeScript, React Router, TanStack Query,
  React Hook Form, Tailwind CSS
- **Security** — bcrypt password hashing, httpOnly SameSite=strict cookies,
  Helmet headers, CORS allow-list, rate-limited auth, input validation on every
  route, role-based + franchise-scoped authorization, audit trail for mutations

## Repository layout

```
server/     Node + Express + Mongoose API
client/     React + Vite SPA
docker-compose.yml   MongoDB service
```

Legacy PHP and Streamlit files remain at the repo root for reference until the
new stack reaches feature parity. They are not wired into the new app.

## Quick start

```bash
# 1. Start MongoDB
cp .env.example .env
docker compose up -d mongo

# 2. Server
cd server
cp .env.example .env           # edit JWT_SECRET at minimum
npm install
npm run seed                   # creates initial admin + demo data
npm run dev                    # http://localhost:4000

# 3. Client (in another terminal)
cd client
cp .env.example .env
npm install
npm run dev                    # http://localhost:5173
```

Default admin credentials created by the seed are printed to stdout — change
the password immediately after first login.

## Roles

| Role       | Scope            | Permissions |
|------------|------------------|-------------|
| `admin`    | All franchises   | Full CRUD, user management, audit, settings |
| `manager`  | All franchises   | Products, stock, sales, transfers, reports |
| `franchise`| One franchise    | Stock, sales, returns, local transfers, closings |
| `seller`   | One franchise    | POS / sales only |

Franchise- and seller-scoped users only ever see data from their own franchise,
enforced at the query level in every domain route.

## Feature coverage (first cut)

Implemented:

- Authentication with bcrypt + JWT in httpOnly cookie
- Users, franchises, categories, suppliers, products CRUD
- Stock per franchise, stock entries (IN) and adjustments (OUT)
- Sales (creates movement, decrements stock atomically)
- Transfers (pending → accepted / rejected with atomic stock swap)
- Dashboard KPIs (totals, low stock, recent activity)
- Audit log for every mutation

Deferred (legacy features that need domain follow-up before rebuilding):

- Invoicing (`factures`), installments (`échéances` / `avances`), PDF receipts
- Monthly treasury / closings beyond the daily count
- SMS reminders / cron
- OCR product import
- Map of franchise locations

See `server/src/routes/` for the route boundaries — each deferred feature has a
clean place to slot in.
