#!/usr/bin/env bash
# StimuliiQ: move the API box to a new VPS with (near) zero downtime.
#
# Written for and proven by the 2026-08-22 move off KVM1/Manchester onto KVM2/Mumbai, which
# cut /health/ready from ~1010ms to ~28ms. The win was the REGION (co-locating with the
# ap-south-1 Supabase + Upstash), not the extra vCPU: measure before assuming a bigger plan
# helps. TCP RTT to the Supabase pooler was 183ms from Manchester and 8ms from Mumbai.
#
# Why this is easy at all: the box is STATELESS. Postgres is Supabase, Redis is Upstash,
# files are R2, mail is Resend. The only things on disk worth carrying are /srv/stimuliiq/.env
# and keys/jwt-*.pem. There is no data migration here, only a rebuild plus a DNS flip.
#
#   OLD_HOST=srv-old.hstgr.cloud NEW_HOST=1.2.3.4 ./infra/scripts/vps-migrate.sh <stage>
#
# Stages, in order. Nothing user-visible changes before the DNS flip:
#   bootstrap  root@new : vps-bootstrap.sh (packages, deploy user, ufw, node/pnpm/pm2, nginx)
#   secrets    old->new : .env, keys/, AND /etc/letsencrypt  (streamed; never hits local disk)
#   code       new      : git init/fetch/reset + pnpm install + build api
#   serve      new      : nginx site + pm2 start, parked with cron DISABLED (see note 2)
#   verify     new      : health + real public routes, hitting the new IP without touching DNS
#   ---- flip the api A record to the new IP here, then confirm via nginx access logs ----
#   handover   both     : release cron on old, take cron on new (STRICTLY in that order)
#   standdown  old      : stop the old API for good. Do this days later, not at cutover.
#
# --- The two things that are easy to get wrong -----------------------------------------
#
# 1. CERTS BEFORE DNS. `secrets` copies /etc/letsencrypt across, so the new box already
#    serves valid TLS for the domain before a single user is routed to it. The cutover is
#    then pure DNS propagation instead of a scramble to issue a cert while the API is dark.
#    Verify ahead of the flip with: curl --resolve <domain>:443:<NEW_IP> https://<domain>/...
#
# 2. CRON MUST HAVE EXACTLY ONE OWNER. Both boxes point at the SAME production database, so
#    two running copies means two sets of scheduled jobs. report-schedules survives that
#    (claimDueSchedule is an optimistic `updateMany ... where nextRunAt = observed`), but
#    DeadlineRemindersScheduler does NOT: it dedups by time bucket with no persisted flag,
#    and its own header names duplicate reminders as the failure mode. So `serve` parks the
#    new box with SCHEDULER_ENABLED=false and `handover` moves ownership one way only.
#    Mercifully every scheduler is a plain setInterval with no immediate run, so a
#    short-lived process never ticks the 1h/6h jobs.
#
set -euo pipefail

STAGE="${1:?usage: OLD_HOST=... NEW_HOST=... vps-migrate.sh <stage>}"
OLD="${OLD_HOST:?set OLD_HOST}"
NEW="${NEW_HOST:?set NEW_HOST}"
DOMAIN="${API_DOMAIN:-api.stimuliiq.com}"
KEY="${SSH_KEY:-$HOME/.ssh/stimuliiq_vps}"
APPDIR=/srv/stimuliiq
REPO="${REPO_URL:-https://github.com/stimuliIQ/stimuliIQ-app}"

SSH="ssh -i $KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new"
old_root() { $SSH "root@$OLD" "$@"; }
old_dep()  { $SSH "deploy@$OLD" "$@"; }
new_root() { $SSH "root@$NEW" "$@"; }
new_dep()  { $SSH "deploy@$NEW" "$@"; }
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# Count of requests a box's nginx served in the last 5 minutes. The only honest way to tell
# which box traffic is actually on; response timing is a guess, this is not.
recent_hits() {
  "$1" 'awk -v d="$(date -u -d "5 minutes ago" +%d/%b/%Y:%H:%M)" "\$4 > \"[\"d" /var/log/nginx/access.log | wc -l'
}

case "$STAGE" in

bootstrap)
  scp -i "$KEY" -o StrictHostKeyChecking=accept-new infra/scripts/vps-bootstrap.sh "root@$NEW:/root/"
  new_root 'bash /root/vps-bootstrap.sh'
  ;;

secrets)
  log ".env"
  old_root "cat $APPDIR/.env" \
    | new_root "install -d -o deploy -g deploy $APPDIR && cat > $APPDIR/.env \
        && chown deploy:deploy $APPDIR/.env && chmod 600 $APPDIR/.env"

  log "JWT keypair"
  old_root "tar -C $APPDIR -cf - keys" \
    | new_root "tar -C $APPDIR -xf - && chown -R deploy:deploy $APPDIR/keys \
        && chmod 600 $APPDIR/keys/jwt-private.pem"

  log "TLS certs (so the new box has valid TLS BEFORE the DNS flip)"
  old_root "tar -C /etc -cf - letsencrypt" | new_root "tar -C /etc -xf -"

  log "Integrity: these md5s MUST match"
  old_root "md5sum $APPDIR/.env $APPDIR/keys/jwt-private.pem"
  new_root "md5sum $APPDIR/.env $APPDIR/keys/jwt-private.pem; ls -1 /etc/letsencrypt/live/"
  ;;

code)
  # `secrets` already created $APPDIR, and git clone refuses a non-empty directory, so init
  # in place. .env and keys/ are gitignored, which is what makes reset --hard safe here.
  new_dep "set -e
    cd $APPDIR
    if [ ! -d .git ]; then git init -q && git remote add origin $REPO; fi
    git fetch -q origin main
    git reset --hard origin/main
    git log --oneline -1
    pnpm install --frozen-lockfile
    pnpm db:generate
    pnpm --filter @stimuliiq/api... run build
    ls -la $APPDIR/apps/api/dist/main.js"
  ;;

serve)
  log "Nginx site, copied verbatim from the old box (certbot stanzas included)"
  old_root "cat /etc/nginx/sites-available/stq-api" \
    | new_root "cat > /etc/nginx/sites-available/stq-api \
        && ln -sf /etc/nginx/sites-available/stq-api /etc/nginx/sites-enabled/stq-api \
        && nginx -t && systemctl reload nginx"

  log "PM2, parked with cron disabled until handover (see note 2 in the header)"
  new_dep "set -e
    cd $APPDIR
    grep -q '^SCHEDULER_ENABLED=' .env || printf '\nSCHEDULER_ENABLED=false\n' >> .env
    sed -i 's/^SCHEDULER_ENABLED=.*/SCHEDULER_ENABLED=false/' .env
    cd apps/api
    pm2 delete stq-api >/dev/null 2>&1 || true
    pm2 start 'node --env-file=$APPDIR/.env dist/main.js' --name stq-api
    pm2 save >/dev/null
    sleep 9
    pm2 list"
  new_dep "pm2 logs stq-api --lines 40 --nostream 2>/dev/null \
    | grep -iE 'successfully started|Redis connected|NOT registered'"
  ;;

verify)
  NEWIP=$(new_root "curl -s -4 ifconfig.me")
  log "Testing $DOMAIN against $NEWIP, bypassing DNS entirely"
  for p in /api/v1/health/ready /api/v1/public/site-settings /api/v1/public/faculty-bios; do
    printf '  %-40s' "$p"
    curl -sS --resolve "$DOMAIN:443:$NEWIP" "https://$DOMAIN$p" \
      -o /dev/null -w 'HTTP %{http_code}  %{time_total}s\n'
  done
  log "On-box latency, 5 samples (the point of the whole exercise)"
  new_dep "for i in 1 2 3 4 5; do curl -s -o /dev/null -w '%{time_total} ' http://127.0.0.1:4000/api/v1/health/ready; done; echo"
  log "Now flip the A record to $NEWIP, then run: $0 handover"
  ;;

handover)
  # Order is not negotiable: release before acquire, else both boxes run cron at once.
  log "1/2 OLD box releases cron (it keeps serving HTTP for stale-DNS stragglers)"
  old_dep "cd $APPDIR
    grep -q '^SCHEDULER_ENABLED=' .env || printf '\nSCHEDULER_ENABLED=false\n' >> .env
    sed -i 's/^SCHEDULER_ENABLED=.*/SCHEDULER_ENABLED=false/' .env
    pm2 restart stq-api --update-env >/dev/null
    sleep 9
    pm2 logs stq-api --lines 150 --nostream 2>/dev/null | grep -c 'NOT registered' \
      | xargs echo '  old box, schedulers NOT registered (want 5):'"

  log "2/2 NEW box takes cron"
  new_dep "cd $APPDIR
    sed -i '/migration standby/d; /^SCHEDULER_ENABLED=/d' .env
    pm2 restart stq-api --update-env >/dev/null
    sleep 10
    pm2 logs stq-api --lines 200 --nostream 2>/dev/null \
      | grep -oE '\[[A-Za-z]+Scheduler\] registered[^\"]*' | sort -u
    pm2 save >/dev/null
    grep -cE '^[A-Z]' .env | xargs echo '  new box .env var count:'"

  # Its HTTP-01 challenges now resolve to the new box, so renewal here can only fail.
  old_root "systemctl disable --now certbot.timer 2>/dev/null || true"

  log "Traffic check: want a positive number on the new box and 0 on the old"
  printf '  new: '; recent_hits new_root
  printf '  old: '; recent_hits old_root
  ;;

standdown)
  # Deliberately NOT part of cutover. Leave the old box serving for a few days as the
  # rollback: put the A record back and it is already warm. It owns no cron after handover.
  log "Stopping the old API for good"
  old_dep "pm2 stop stq-api && pm2 save"
  old_root "rm -f /etc/nginx/sites-enabled/stq-api && nginx -t && systemctl reload nginx"
  ;;

*) echo "unknown stage: $STAGE"; exit 1 ;;
esac

log "stage '$STAGE' complete"
