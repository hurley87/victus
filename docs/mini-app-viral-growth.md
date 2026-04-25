# Mini App Viral Growth Notes

Source: [How to Build Viral Farcaster Mini-Apps](https://paragraph.com/@builders-garden/viral-farcaster-mini-apps)

## Summary

The main lesson is simple: Farcaster Mini Apps spread through feed-native social loops, not product complexity.

Victus already has the right foundation:

- a mobile-first Mini App shell
- a public trading game
- cast-based trade commands
- monthly standings
- Commodus as a visible boss benchmark

The next growth layer should make every meaningful action easier to share, easier to discover in the feed, and easier to re-enter from a cast.

Core loop:

1. play
2. score
3. share
4. invite
5. return

This doc is planning guidance, not a commitment to build every item below.

## Lessons To Apply

### Make Sharing A First-Class Action

Victus should add share prompts at moments players naturally want to flex:

- wallet funded
- first trade placed
- first scored trade
- rank changed
- top 10 reached
- top 3 reached
- Commodus passed
- best trade or biggest score event

Each share action should open the Farcaster composer with short Victus-native copy and the Mini App URL. Avoid auto-tagging other users in prefilled text; the share should feel earned, not spammy.

### Upgrade Feed Previews

The feed is the discovery surface. Static metadata is useful, but Victus should eventually support dynamic preview images for high-signal moments:

- rank cards: `@alice is #4 in the arena`
- trade cards: `+12 pts on $AERO`
- boss cards: `Commodus has been beaten`
- standings cards with top players and Commodus
- month-reset cards for a fresh season

These should be legible at small size, visually tied to the imperial arena brand, and useful even before someone opens the app.

This overlaps with the future roadmap's shareable scorecard ideas in `docs/future.md`.

### Add More Social Proof In The App

Standings should feel alive, not just like a table. Useful additions:

- recent public trades
- players active today
- players who scored this month
- Commodus's latest move
- how many points the viewer needs to pass Commodus
- how many points the viewer needs to pass the next ranked player

This reinforces the future product principle that the feed and public competition are part of the game.

### Use Deep Links As Entry Points

Shared casts should open into the right state, not just the default wallet tab.

Good v1 deep-link targets:

- `?tab=standings` for rank and leaderboard shares
- `?tab=trade` for challenge shares
- `?tab=wallet` for funding or onboarding shares

Future challenge links could carry a suggested token, amount, or context such as "try to beat this score," as long as execution still uses the normal trade composer and existing policy rules.

### Make Notifications Victus-Native

The repo already has notification plumbing, but notifications should only be used once the copy and triggers are clearly Victus-specific.

Good notification triggers:

- your trade scored
- your rank changed
- someone passed you
- Commodus passed you
- you passed Commodus
- you still have trades left today
- a new month or event started

Notifications should deliver real game value and avoid noisy reminders. This aligns with the notification ideas already captured in `docs/future.md`.

### Launch Around A Challenge

The strongest launch frame is not "the app is live." It is a timed arena challenge.

Recommended launch framing:

- launch a short "Beat Commodus" event
- make Commodus's rank and score visible
- let users share rank cards and boss-card moments
- use standings as the public proof of progress
- bring users back when ranks change or a new scoring window opens

The product already has the ingredients for this: public commands, scoring, standings, Commodus, and a mobile app shell.

## Prioritized Actions

1. ✅ Replace remaining notification template copy with Victus-native copy. — Done in `app/api/webhook/route.ts`: `frame_added` and `notifications_enabled` now use game-status copy ("Welcome to the arena", "Notifications armed").
2. 🟡 Add share buttons to Standings and post-trade/status moments. — Standings shares now embed the dynamic rank OG card via `sdk.actions.composeCast({ embeds })` so the cast shows a visual preview in feed. Post-trade/status share moments still pending (the trade itself is already a public cast; the open gap is sharing once a trade scores).
3. 🟡 Add dynamic OG score, rank, trade, and boss cards. — Rank card shipped at `app/api/og/rank/[fid]/route.tsx`, used as the embed for Standings share buttons. Trade, boss, and standings-snapshot cards still pending.
4. ⬜ Add recent activity and social proof to Standings. — Standings still shows only the leaderboard table and Commodus benchmark. No recent-trades feed, active-today count, or scored-this-month signal.
5. ✅ Add challenge and deep-link URLs for shareable entry points. — `miniAppTabDeepLink` now accepts optional `{ token, amount, mode }` params (`lib/commodus/deep-links.ts`). Trade page reads `?token`, `?amount`, `?mode` to pre-populate the composer (`components/pages/trade/index.tsx`). Commodus "Challenge a friend" share now points to `?tab=trade&mode=buy&amount=5` so a tap lands on a pre-filled trade composer.

Status key: ✅ done · 🟡 partial · ⬜ not started.

## Product Guardrails

- Keep the Mini App simple, fast, and mobile-first.
- Treat Farcaster as the arena, not just an auth provider.
- Make sharing opt-in and earned.
- Do not create growth loops that spam mentions or pressure users into low-quality casts.
- Keep financial actions on the existing policy and execution rails.
- Prefer game-status language over financial-advice language.

## Related Docs

- [Future roadmap](./future.md) covers the broader future roadmap, including shareable scorecards, notifications, leaderboard dynamics, and the long-term social game vision.
- [MVP PRD](./mvp.md) remains the source of truth for the current MVP scope and non-goals.
- [Beat Commodus event plan](./beat-commodus-event-plan.md) captures the Monday, April 27, 2026 launch challenge.
