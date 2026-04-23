# Security notes

## Deployment checklist

- **`JWT_SECRET`** must be a random 32+ char string per environment. Never
  reuse across environments. Rotate on suspected compromise (invalidates all
  active sessions — expected behavior).
- **`BCRYPT_ROUNDS`** stays at `12` in production. Lower values are only
  acceptable for tests and fast-iterating dev loops.
- **`COOKIE_SECURE=true`** is required in production (forces HTTPS-only
  cookies). `SameSite=strict` is hard-coded in the server.
- **`CORS_ORIGINS`** must be set to the exact production origin(s) — wildcard
  origins are not accepted.
- **Admin password** printed by `npm run seed` is a first-run bootstrap only.
  Change it immediately via `/api/auth/change-password`.
- **Reverse proxy** should enforce HTTPS and set `X-Forwarded-For` so the
  `trust proxy` setting produces correct rate-limit keys.

## Legacy PHP credentials

`config.php` in the repository root contains hard-coded credentials for the
legacy InfinityFree MySQL database. These predate this rewrite. They must be:

1. Rotated on the InfinityFree side.
2. Removed from the file before `main` is published anywhere public.
3. Kept out of `.env` for the Node stack — the Node app has its own
   `MONGODB_URI` in `server/.env` (gitignored).

The legacy PHP files remain in the repo only so the new stack can be
cross-checked against the old behavior while we reach feature parity. They
are not deployed with the new stack.

## Defenses in place

- bcrypt password hashing with timing-safe compare on login
- JWT in `httpOnly` + `SameSite=strict` + `Secure` cookie — no token access
  from JS, immune to XSS token theft and cross-site CSRF
- Helmet security headers, `x-powered-by` disabled
- Strict CORS allow-list with credentials
- Zod validation on every request body / query / params
- Mongoose `sanitizeFilter` blocks `$`-prefixed operator injection from
  user-controlled filter fragments
- JSON body size capped at 1 MB
- Rate limits: 10 login attempts / 15 min, 300 req / min global
- RBAC enforced at middleware level; franchise-scoped users cannot read or
  write another franchise's stock, sales, or transfers
- Atomic guarded stock updates (`$inc` with `$gte` precondition) refuse to
  push stock below zero; multi-line sales roll back on partial failure
- Audit log auto-written on every mutation, redacted in application logs

## Reporting issues

Open a private issue or email the repository owner. Please include
reproduction steps and the affected endpoint.
