# Hostinger VPS — Backend Deployment Guide

> Runs the StimuliiQ **API + BullMQ worker + Redis** on one Hostinger KVM VPS, behind Nginx
> with TLS. Database is **Supabase** (already migrated + seeded). Frontends are on **Vercel**
> (`web`, `lms`) and **Cloudflare Pages** (`crm`). Companion to
> [`production-go-live.md`](production-go-live.md).
>
> Replace every `<...>` placeholder. Run as a non-root sudo user unless noted.

Architecture on the box:
```
Internet ──HTTPS──> Nginx (:443, TLS) ──proxy──> API (127.0.0.1:4000, PM2)
                                                   │
                                        Redis ──── Upstash (remote, TLS)
                                        Postgres ── Supabase (remote)
```
Nothing but Nginx + the API process runs on this box. There is **no local Redis** and **no
worker process at launch** (`QUEUE_DRIVER=sync` — see §3).

---

## 0. Before you SSH in

1. Create the VPS in Hostinger: **Ubuntu 24.04 LTS**, nearest region to India. Note its **public IP**.
2. **DNS**: at your domain registrar, add an **A record** `api.stimuliiq.com → <VPS_IP>` (proxy OFF /
   "DNS only" if using Cloudflare, so Certbot can issue certs and webhooks reach you directly).
3. Have ready: the `prod-secrets/` (JWT keypair + secrets I generated) and your vendor keys
   (Resend, WhatsApp, Razorpay, R2, MSG91).

---

## 1. First login + harden

> **Shortcut:** [`infra/scripts/vps-bootstrap.sh`](../../infra/scripts/vps-bootstrap.sh) does
> all of §1, §2 and the package installs for §7–§8 in one idempotent run:
> ```bash
> scp infra/scripts/vps-bootstrap.sh root@<VPS_IP>:/root/
> ssh root@<VPS_IP> 'bash /root/vps-bootstrap.sh'
> ```
> The manual steps below are the same thing, spelled out.

```bash
ssh root@<VPS_IP>
adduser deploy && usermod -aG sudo deploy         # non-root user
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # copy your SSH key
# (log out, back in as deploy)
ssh deploy@<VPS_IP>

sudo apt update && sudo apt -y upgrade
sudo apt -y install ufw fail2ban git curl
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443
sudo ufw --force enable
```

## 2. Node 22 + pnpm 9.15 + build tools

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs build-essential
sudo corepack enable
corepack prepare pnpm@9.15.0 --activate
node -v && pnpm -v      # expect v22.x and 9.15.0
```

## 3. Redis — managed (Upstash), nothing to install

Redis is **Upstash** (managed, TLS), already provisioned and tested. There is **no Redis to
install or run on the VPS** — the API just needs `REDIS_URL` in its `.env`:
```
REDIS_URL=rediss://default:<token>@<your-db>.upstash.io:6379
QUEUE_DRIVER=sync
```
> Keep `QUEUE_DRIVER=sync` at launch — Upstash bills per command and BullMQ's blocking queue
> polls would burn the free tier. Move to `bullmq` + the worker process only when scaling.
> Eviction is OFF on the Upstash DB (rate-limit / OTP keys must never be evicted).

## 4. Get the code + build

```bash
sudo mkdir -p /srv && sudo chown deploy:deploy /srv
cd /srv
git clone <YOUR_REPO_URL> stimuliiq && cd stimuliiq
pnpm install --frozen-lockfile
pnpm --filter @stimuliiq/api... run build     # builds api -> apps/api/dist (main.js + worker.js)
```
> If `@stimuliiq/api` isn't the exact package name, use `pnpm -r run build` (builds everything)
> or check `apps/api/package.json` `"name"`.

## 5. Production secrets on the box

```bash
# JWT keypair — copy the PROD keys (generated earlier), NOT the dev ones:
mkdir -p /srv/stimuliiq/keys
#   scp from your laptop:  scp prod-secrets/jwt-*.pem deploy@<VPS_IP>:/srv/stimuliiq/keys/
chmod 600 /srv/stimuliiq/keys/jwt-private.pem

# Create the production env file the API loads (node --env-file=../../.env):
nano /srv/stimuliiq/.env
```
Fill `/srv/stimuliiq/.env` from [`.env.production.template`](../../.env.production.template). Key
values for THIS box:
```
NODE_ENV=production
APP_ENV=production
API_PORT=4000
WEB_APP_URL=https://stimuliiq.com
LMS_APP_URL=https://learn.stimuliiq.com
CRM_APP_URL=https://admin.stimuliiq.com

# Supabase — RUNTIME uses the POOLER (6543). (Migrations use the direct 5432 URL.)
DATABASE_URL=postgresql://postgres.<ref>:<pw>@<pooler-host>:6543/postgres?sslmode=require&pgbouncer=true

# Redis is Upstash (remote, TLS) — note the double-s scheme. See §3.
REDIS_URL=rediss://default:<token>@<your-db>.upstash.io:6379
QUEUE_DRIVER=sync

JWT_PRIVATE_KEY_PATH=/srv/stimuliiq/keys/jwt-private.pem
JWT_PUBLIC_KEY_PATH=/srv/stimuliiq/keys/jwt-public.pem
COOKIE_DOMAIN=.stimuliiq.com
COOKIE_SECURE=true
# ...plus every signing secret + vendor key from the template.
```
> `.env` is gitignored; keep it only on the box. `chmod 600 /srv/stimuliiq/.env`.

## 6. Database migrations (already applied — for future deploys)

Your Supabase DB is already migrated + seeded. On future schema changes, run migrations against
the **direct 5432** URL (advisory locks / DDL need a non-pooled connection):
```bash
DATABASE_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres?sslmode=require" \
  pnpm db:migrate:deploy
```

## 7. Run API + worker with PM2

```bash
sudo npm i -g pm2
cd /srv/stimuliiq/apps/api
pm2 start "node --env-file=/srv/stimuliiq/.env dist/main.js"   --name stq-api
# Worker is ONLY needed when QUEUE_DRIVER=bullmq. With sync (launch default) skip it:
# pm2 start "node --env-file=/srv/stimuliiq/.env dist/worker.js" --name stq-worker
pm2 save
pm2 startup systemd   # run the printed sudo command to survive reboots
pm2 logs stq-api --lines 50   # confirm "Redis connected" + no boot-throw
```
> If the API **boot-throws**, read the message — a fail-closed guard found a missing/`noop`
> provider key. That's intended: fix the env var and `pm2 restart stq-api`.

## 8. Nginx reverse proxy + TLS

```bash
sudo apt -y install nginx certbot python3-certbot-nginx
sudo nano /etc/nginx/sites-available/stq-api
```
```nginx
server {
  listen 80;
  server_name api.stimuliiq.com;

  client_max_body_size 25m;                 # header room; large files go direct to R2

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;   # so secure cookies + HTTPS detection work
    proxy_read_timeout 60s;
  }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/stq-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.stimuliiq.com    # issues + auto-renews TLS, rewrites to :443
```

> **Trust-proxy: already correct.** `apps/api/src/main.ts:75` sets `trust proxy` to `1`, which
> matches exactly one Nginx hop — so `req.ip` resolves to the real client IP (rate-limiting works)
> and `X-Forwarded-Proto` makes secure cookies behave. Keep Nginx as the *single* proxy in front
> of the API. If you ever add Cloudflare's proxy in front of Nginx too, that's a second hop —
> tell me and we bump the value to `2`.

## 9. Verify

```bash
curl -s https://api.stimuliiq.com/api/v1/health/ready | jq
# expect 200 with postgres:"ok" AND redis:"ok"
```

## 10. Point the frontends at the API

- **Vercel** (`web`, `lms`): `NEXT_PUBLIC_API_URL=https://api.stimuliiq.com` +
  `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_WHATSAPP_NUMBER=919177748321`, Turnstile/GA public keys.
- **Cloudflare Pages** (`crm`): `VITE_API_URL=https://api.stimuliiq.com`,
  `VITE_WEB_APP_URL=https://stimuliiq.com`, `VITE_ASSET_BASE_URL`.
- The API's CORS allow-list = `WEB_APP_URL`/`LMS_APP_URL`/`CRM_APP_URL` — set to the real origins.

## 11. Redeploy (future)

```bash
cd /srv/stimuliiq && git pull
pnpm install --frozen-lockfile
pnpm --filter @stimuliiq/api... run build
pm2 restart stq-api          # + stq-worker only if you moved to QUEUE_DRIVER=bullmq
```
Later we can automate this with a GitHub Actions SSH deploy job (the repo already has a
Railway-shaped `deploy-api` job to adapt).

---

## Storage note (decide before go-live)

Your dev `.env` uses `STORAGE_PROVIDER=local` (files on disk, served by the API). On a single VPS
that *works* for launch, but: files live on the VPS disk (back them up; lost if the box dies; won't
scale past one instance). **Recommended: `STORAGE_PROVIDER=r2`** (Cloudflare R2 — see the runbook
§3.6). Local is an acceptable temporary MVP choice if you accept those caveats.
