#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/.env"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE" 2>/dev/null || true

current_user="$(grep -E '^AUTH_USERNAME=' "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
default_user="${current_user:-pascal}"

printf 'Gebruikersnaam [%s]: ' "$default_user"
IFS= read -r username
username="${username:-$default_user}"

if [[ ! "$username" =~ ^[A-Za-z0-9._-]{1,64}$ ]]; then
  echo 'Ongeldige gebruikersnaam. Gebruik alleen letters, cijfers, punt, _ of -.' >&2
  exit 1
fi

while :; do
  IFS= read -r -s -p 'Nieuw wachtwoord (minimaal 12 tekens): ' password
  echo
  if (( ${#password} < 12 )); then
    echo 'Wachtwoord is te kort.' >&2
    continue
  fi
  IFS= read -r -s -p 'Herhaal wachtwoord: ' password2
  echo
  if [[ "$password" != "$password2" ]]; then
    echo 'Wachtwoorden komen niet overeen.' >&2
    continue
  fi
  break
done

password_hash="$({ printf '%s' "$password"; } | python3 -c '
import sys, hashlib, secrets, base64
password = sys.stdin.buffer.read()
salt = secrets.token_bytes(16)
iterations = 310_000
digest = hashlib.pbkdf2_hmac("sha256", password, salt, iterations, dklen=32)
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")
print(f"pbkdf2:{iterations}:{b64(salt)}:{b64(digest)}")
')"
unset password password2

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

grep -Ev '^(AUTH_ENABLED|AUTH_USERNAME|AUTH_PASSWORD_HASH)=' "$ENV_FILE" > "$TMP" || true
{
  echo
  echo '# Security Center login'
  echo 'AUTH_ENABLED=1'
  printf 'AUTH_USERNAME=%s\n' "$username"
  printf 'AUTH_PASSWORD_HASH=%s\n' "$password_hash"
} >> "$TMP"

ensure_default() {
  local key="$1" value="$2"
  if ! grep -qE "^${key}=" "$TMP"; then
    printf '%s=%s\n' "$key" "$value" >> "$TMP"
  fi
}

ensure_default AUTH_SESSION_HOURS 168
ensure_default AUTH_COOKIE_SECURE 0
ensure_default AUTH_TRUST_PROXY 0
ensure_default SECURITY_INTERNAL_PORT 8095

mv "$TMP" "$ENV_FILE"
trap - EXIT
chmod 600 "$ENV_FILE" 2>/dev/null || true

echo
echo "Login ingesteld voor gebruiker: $username"
echo 'Container opnieuw bouwen en starten...'
docker compose up -d --build deurbel-viewer

echo
echo 'Klaar. Open het Security Center en log in met je nieuwe gegevens.'
echo 'Gebruik je later HTTPS via een reverse proxy? Zet dan AUTH_COOKIE_SECURE=1 in .env.'