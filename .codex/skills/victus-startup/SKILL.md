---
name: victus-startup
description: Start the Victus project in /Users/davidhurley/Desktop/victus for local mini-app testing. Use when the user asks to run Victus, start up Victus, create or refresh the Cloudflare tunnel, run pnpm dev plus pnpm tunnel, or update NEXT_PUBLIC_URL in .env.local from the tunnel URL.
---

# Victus Startup

## Workflow

Run this workflow from `/Users/davidhurley/Desktop/victus`.

1. Check `package.json` for the `dev` and `tunnel` scripts if the repo may have changed.
2. Start `pnpm dev` in a TTY session with `exec_command`.
3. Wait until Next reports `Ready` and confirms it loaded `.env.local`.
4. Start `pnpm tunnel` in a separate TTY session.
5. Read the tunnel output until a `https://*.trycloudflare.com` URL appears.
6. Update `.env.local` so `NEXT_PUBLIC_URL=<tunnel-url>`.
7. Restart only the `pnpm dev` session after editing `.env.local`; keep the tunnel session running.
8. Confirm `pnpm dev` is ready again and the tunnel session is still running.
9. Return the tunnel URL to the user.

## Commands

Use separate long-running sessions:

```bash
pnpm dev
pnpm tunnel
```

The current tunnel script is expected to point to `http://localhost:3000`.

## Updating .env.local

Prefer the bundled helper when available:

```bash
scripts/set-next-public-url.sh /Users/davidhurley/Desktop/victus/.env.local https://example.trycloudflare.com
```

If the helper is not suitable, edit `.env.local` directly and preserve the rest of the file. Replace an existing `NEXT_PUBLIC_URL=` line; append one only if it is missing.

## Notes

- Do not stop the tunnel after returning the URL unless the user asks.
- If `pnpm dev` was already running from this skill, restart it after changing `NEXT_PUBLIC_URL` so Next sees the new environment value.
- If port 3000 is already occupied by an unrelated process, report the blocker instead of changing the tunnel target silently.
