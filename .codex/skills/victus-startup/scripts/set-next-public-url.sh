#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <env-file> <url>" >&2
  exit 2
fi

env_file="$1"
url="$2"

if [[ ! "$url" =~ ^https://[A-Za-z0-9-]+\.trycloudflare\.com$ ]]; then
  echo "error: expected a https://*.trycloudflare.com URL" >&2
  exit 2
fi

if [ ! -f "$env_file" ]; then
  touch "$env_file"
fi

tmp_file="$(mktemp)"
if grep -q '^NEXT_PUBLIC_URL=' "$env_file"; then
  awk -v url="$url" 'BEGIN{done=0} /^NEXT_PUBLIC_URL=/ && !done {print "NEXT_PUBLIC_URL=" url; done=1; next} {print}' "$env_file" > "$tmp_file"
else
  cp "$env_file" "$tmp_file"
  if [ -s "$tmp_file" ] && [ "$(tail -c 1 "$tmp_file")" != "" ]; then
    printf '\n' >> "$tmp_file"
  fi
  printf 'NEXT_PUBLIC_URL=%s\n' "$url" >> "$tmp_file"
fi

mv "$tmp_file" "$env_file"
