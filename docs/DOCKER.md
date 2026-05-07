# Docker Guide

## Development

Start the full dev stack:

```bash
cp .env.example .env
docker compose up --build
```

Services:

- `mongo`: MongoDB 7 on `localhost:27017`
- `server`: API watch mode on `localhost:4000`
- `client`: Vite dev server on `localhost:5173`
- `dev-tunnel`: public Cloudflare quick tunnel to the Vite app
- `dev-tunnel-named`: optional named Cloudflare tunnel, reserved for the VPS
  hosted domain workflow

Get the public dev URL:

```bash
docker compose logs -f dev-tunnel
```

Use the `https://....trycloudflare.com` URL shown by Cloudflare. The tunnel points at the Vite container, and Vite proxies `/api` to the API container.

### Stable Cloudflare Subdomain

Keep `asel.saleheddinetouil.tech` for the VPS-hosted version. The local stack
should normally use the random `trycloudflare.com` URL shown by `dev-tunnel`.
When you intentionally work on the named-domain deployment, create a named
Cloudflare Tunnel in the Cloudflare Zero Trust dashboard:

- Tunnel name: `asel-dev`
- Public hostname: `asel.saleheddinetouil.tech`
- Service type: `HTTP`
- Service URL: `http://client:5173`

Then set the token Cloudflare gives for the Docker connector:

```bash
CLOUDFLARED_TOKEN=eyJ...
```

Start only the named tunnel service:

```bash
docker compose --profile cloudflare-named up -d dev-tunnel-named
docker compose logs -f dev-tunnel-named
```

The named-domain app is served at `https://asel.saleheddinetouil.tech`; `/api`
is routed by Vite to the API container.

For Expo/mobile testing against the random local tunnel:

```bash
cd mobile
EXPO_PUBLIC_API_BASE_URL=https://your-random-name.trycloudflare.com/api npm start
```

Seed the dev database:

```bash
docker compose exec server npm run seed
```

Stop the stack:

```bash
docker compose down
```

Reset dev data and dependencies:

```bash
docker compose down -v
```

## Production

Prepare production environment values:

```bash
cp .env.production.example .env.production
```

Edit `.env.production`, then start the production stack:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Production services:

- `mongo`: persistent MongoDB
- `server`: compiled Node API
- `web`: Nginx serving the built React app and proxying `/api`
- `caddy`: public HTTPS reverse proxy

Seed once after first boot:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec server npm run seed
```

View production logs:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f
```

Production requires a real domain in `APP_DOMAIN`, DNS pointed at the server, and ports `80` and `443` open.
