#!/usr/bin/env bash
# StimuliiQ — Hostinger VPS bootstrap (Ubuntu 24.04 LTS).
#
# Automates §1–§2 + the package installs of §7–§8 of docs/deploy/hostinger-vps-setup.md.
# Run ONCE as root on a fresh box; safe to re-run (every step is idempotent).
#
#   scp infra/scripts/vps-bootstrap.sh root@<VPS_IP>:/root/
#   ssh root@<VPS_IP> 'bash /root/vps-bootstrap.sh'
#
# It does NOT clone the repo, write .env, or start the API — those need secrets and are
# steps §4–§9 of the guide, done as the `deploy` user afterwards.
#
# Optional env:
#   DEPLOY_USER=deploy      # non-root account that owns /srv and runs PM2
#   HARDEN_SSH=1            # also disable SSH password auth + root login (see WARNING below)

set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
HARDEN_SSH="${HARDEN_SSH:-0}"
NODE_MAJOR=22
PNPM_VERSION=9.15.0

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }

log "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get -y -qq upgrade
apt-get -y -qq install \
  ufw fail2ban git curl ca-certificates gnupg rsync jq unattended-upgrades \
  build-essential nginx certbot python3-certbot-nginx

log "Non-root sudo user: ${DEPLOY_USER}"
if id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "user exists, skipping create"
else
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG sudo "$DEPLOY_USER"

# Carry root's SSH keys over so you can log in as ${DEPLOY_USER} immediately.
if [ -f /root/.ssh/authorized_keys ]; then
  install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/${DEPLOY_USER}/.ssh"
  install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" \
    /root/.ssh/authorized_keys "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  echo "copied root's authorized_keys -> ${DEPLOY_USER}"
else
  warn "/root/.ssh/authorized_keys not found — ${DEPLOY_USER} has NO key and NO password yet."
  warn "Add one before you lose the root session:  ssh-copy-id ${DEPLOY_USER}@<VPS_IP>"
fi

log "Firewall (ufw) — SSH, HTTP, HTTPS only"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable
ufw status verbose

log "fail2ban + unattended security upgrades"
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

log "Node ${NODE_MAJOR} + pnpm ${PNPM_VERSION}"
# Add NodeSource's apt repo EXPLICITLY (keyring + .list) rather than piping their
# setup_${NODE_MAJOR}.x script to bash. On a Hostinger Ubuntu 24.04 image (2026-08-22) that
# piped script exited 0 WITHOUT registering the repo, so the `apt-get install nodejs` below
# silently fell through to Ubuntu's own nodejs 18, which ships no `corepack`, killing this
# script two lines later. Doing it by hand is deterministic and fails loudly.
if ! node -v 2>/dev/null | grep -q "^v${NODE_MAJOR}\."; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  chmod a+r /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get -y -qq install nodejs
fi
# Assert, don't assume: a wrong-major node here produces a confusing failure much later.
if ! node -v | grep -q "^v${NODE_MAJOR}\."; then
  echo "FATAL: expected Node ${NODE_MAJOR}.x, got $(node -v). NodeSource repo not in effect:"
  apt-cache policy nodejs | head -8
  exit 1
fi
corepack enable
# corepack's shims are per-user; activate for root AND the deploy user.
corepack prepare "pnpm@${PNPM_VERSION}" --activate >/dev/null
sudo -u "$DEPLOY_USER" -H bash -lc "corepack prepare pnpm@${PNPM_VERSION} --activate" >/dev/null

log "PM2 (process manager)"
npm i -g pm2 >/dev/null
# Make PM2 resurrect the API after a reboot, running as ${DEPLOY_USER}.
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$DEPLOY_USER" --hp "/home/${DEPLOY_USER}" >/dev/null

log "App directory /srv/stimuliiq"
mkdir -p /srv
chown "${DEPLOY_USER}:${DEPLOY_USER}" /srv

if [ "$HARDEN_SSH" = "1" ]; then
  log "Hardening sshd (password auth OFF, root login OFF)"
  if [ ! -s "/home/${DEPLOY_USER}/.ssh/authorized_keys" ]; then
    warn "REFUSING: ${DEPLOY_USER} has no authorized_keys — this would lock you out. Skipped."
  else
    cat >/etc/ssh/sshd_config.d/99-stimuliiq.conf <<'EOF'
PasswordAuthentication no
PermitRootLogin no
KbdInteractiveAuthentication no
EOF
    sshd -t && systemctl reload ssh
    warn "Keep this root session OPEN until you've confirmed key login as ${DEPLOY_USER}."
  fi
fi

log "Done — versions"
node -v
# Run the deploy-user pnpm check from a dir it can read: corepack walks up from CWD
# looking for a package.json, and /root is mode 700 (EACCES) when CWD is left there.
sudo -u "$DEPLOY_USER" -H bash -lc 'cd /srv && pnpm -v' || warn "deploy pnpm version check skipped (non-fatal)"
nginx -v
pm2 -v

cat <<EOF

Next (as ${DEPLOY_USER}, per docs/deploy/hostinger-vps-setup.md):
  §4  git clone the repo into /srv/stimuliiq, pnpm install, build @stimuliiq/api
  §5  scp the PROD jwt-*.pem into /srv/stimuliiq/keys/ and write /srv/stimuliiq/.env (chmod 600)
  §7  pm2 start "node --env-file=/srv/stimuliiq/.env dist/main.js" --name stq-api && pm2 save
  §8  nginx site for api.<domain> + certbot --nginx
Requires first: an A record api.<domain> -> this box's IP (DNS-only, not proxied).
EOF
