#!/usr/bin/env bash
set -euo pipefail
release_sha="${1:?Pass verified Git SHA}"
archive="${2:?Pass release archive path}"
[[ "$release_sha" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid commit SHA' >&2; exit 1; }
project=/opt/tradingview-personal
release="$project/releases/$release_sha"
backup="/root/tradingview-personal-backup-$(date -u +%Y%m%dT%H%M%SZ)"
vhost=/etc/nginx/sites-available/tmeet.ru
test -f "$archive"
test -f "$vhost"
test -s /etc/letsencrypt/live/tmeet.ru/fullchain.pem
test ! -e "$release"
mkdir -p "$backup" "$release" "$project/certs"
cp -p "$vhost" "$backup/tmeet.ru.before"
if test -L "$project/current"; then readlink "$project/current" > "$backup/previous-release"; fi
if test -e /etc/systemd/system/tradingview-personal.service; then cp -p /etc/systemd/system/tradingview-personal.service "$backup/service.before"; fi
if test -e /etc/nginx/snippets/tradingview-personal.conf; then cp -p /etc/nginx/snippets/tradingview-personal.conf "$backup/snippet.before"; fi
tar -xzf "$archive" -C "$release" --no-same-owner
test -s "$release/public/vendor/klinecharts.js"
test -s "$release/public/vendor/lightweight-charts.js"
test ! -e "$release/.secrets"
if ! id tradingview-personal >/dev/null 2>&1; then useradd --system --home-dir /var/lib/tradingview-personal --shell /usr/sbin/nologin tradingview-personal; fi
install -d -m 700 -o tradingview-personal -g tradingview-personal /var/lib/tradingview-personal

# Service-scoped trust only; no global OS certificate installation.
curl --fail --silent --show-error --proto '=https' --tlsv1.2 --max-time 30 \
  https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt \
  -o "$project/certs/russian-trusted-root.pem.tmp"
openssl x509 -in "$project/certs/russian-trusted-root.pem.tmp" -noout -subject | grep -Eq 'CN *= *Russian Trusted Root CA'
mv "$project/certs/russian-trusted-root.pem.tmp" "$project/certs/russian-trusted-root.pem"
chmod 644 "$project/certs/russian-trusted-root.pem"
NODE_EXTRA_CA_CERTS="$project/certs/russian-trusted-root.pem" node --use-system-ca --input-type=module -e \
  "const r=await fetch('https://invest-public-api.tbank.ru/rest/',{signal:AbortSignal.timeout(15000)});console.log('Bank TLS verified, HTTP '+r.status)"

ln -sfn "$release" "$project/current"
printf 'RELEASE_SHA=%s\n' "$release_sha" > "$project/release.env"
chmod 644 "$project/release.env"
install -m 644 "$release/deploy/tradingview-personal.service" /etc/systemd/system/tradingview-personal.service
systemctl daemon-reload
systemctl enable --now tradingview-personal.service
systemctl restart tradingview-personal.service
for attempt in $(seq 1 30); do
  if curl --fail --silent -H 'Host: tmeet.ru' http://127.0.0.1:5210/quotes/api/health > "$backup/health.json"; then break; fi
  sleep 1
done
python3 - "$backup/health.json" "$release_sha" <<'PY'
import json,sys
data=json.load(open(sys.argv[1]))
assert data['ok'] is True and data['commit']==sys.argv[2]
PY
install -m 644 "$release/deploy/tradingview-personal.nginx.conf" /etc/nginx/snippets/tradingview-personal.conf
python3 - "$vhost" <<'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1]);text=p.read_text()
line='    include /etc/nginx/snippets/tradingview-personal.conf;\n'
if line not in text:
    marker='    include /etc/nginx/snippets/meet-conference.conf;\n'
    if text.count(marker)!=1: raise SystemExit('Expected conference include not found exactly once')
    p.write_text(text.replace(marker,marker+line))
PY
if ! nginx -t; then
  cp -p "$backup/tmeet.ru.before" "$vhost"
  echo "Nginx validation failed; previous vhost restored. Backup: $backup" >&2
  exit 1
fi
systemctl reload nginx
printf 'Deployed commit: %s\nURL: https://tmeet.ru/quotes/\nBackup: %s\n' "$release_sha" "$backup"
