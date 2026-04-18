---
name: simplify
description: >-
  Simplifies and refines code for clarity, consistency, and
  maintainability without changing behavior. Use when the user asks to simplify,
  clean up, or polish recent changes, or after edits to UI components, features,
  hooks, or shared lib code in this Next.js repo.
---

# Simplify

## Scope

- Prefer **recently modified or session-touched files** unless the user asks for a wider pass.
- **Preserve behavior**: outputs, UX, API contracts, and tests must stay equivalent. Refactor structure and naming only.

## Project context

This repo is Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 3, Radix UI primitives, TanStack React Query, Zod, Supabase, Upstash Redis/Ratelimit, Farcaster Mini App SDK + wagmi/viem, and a `proxy.ts` for request handling. Follow the repo's existing architecture in `app/`, `components/`, `hooks/`, `lib/`, `contexts/`, and `supabase/`.

## Standards to apply

- **Imports**: ES modules; use the project's path aliases (e.g. `@/`) as elsewhere in the repo; match existing import grouping (no new style wars).
- **Functions**: Prefer the `function` keyword for top-level declarations and component bodies where the codebase already does. Inline arrows for small callbacks are fine.
- **React**: Server Components by default; `"use client"` only when hooks, browser APIs, or wallet/Farcaster SDKs are needed. Keep explicit prop types (inline or named) consistent with neighboring components.
- **Data / forms**: TanStack Query for server state; Zod for schema validation—simplify without changing query keys, cache updates, or validation rules unless fixing a bug.
- **UI**: Reuse components under `components/` and Radix primitives; use Tailwind tokens and `cn()` / `tailwind-merge` patterns already in the repo.
- **Supabase / env**: Don't alter auth, RLS assumptions, or `@t3-oss/env-nextjs` schemas while simplifying.
- **Errors**: Prefer clear early returns and small helpers; avoid extra `try/catch` when the project already surfaces errors via hooks or shared API utilities.

## Clarity refinements

- Reduce nesting; extract small helpers or early returns when it improves scanability.
- Remove redundant abstractions and duplicate logic; consolidate without changing public behavior.
- Prefer **switch or if/else** over **nested ternaries** for multiple branches.
- Remove comments that only restate the code; keep comments that explain non-obvious domain or API constraints.
- Favor **readable, explicit** code over fewer lines or clever one-liners.

## Avoid

- Drive-by changes outside the requested or recently touched scope.
- Over-merging unrelated concerns into one component or hook.
- Removing abstractions that keep features, hooks, or contexts organized.
- Behavior changes, shortcutting auth (Farcaster Quick Auth, Supabase), proxy (`proxy.ts`), or rate-limit assumptions.

## Process

1. Identify the diff or files in scope.
2. Check patterns in adjacent files in the same folder or feature.
3. Apply simplifications that match project conventions.
4. Run **`pnpm lint`** and **`pnpm typecheck`** when changes are non-trivial.

## Verification

- Behavior unchanged (including loading, empty, and error states).
- Types still align with `lib/supabase/types.ts` and API usage.
- No new unnecessary client boundaries or query-cache regressions.
