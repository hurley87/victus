# Farcaster Mini App Template

This is a [Next.js](https://nextjs.org) starter kit to bootstrap your Farcaster Mini App

- [Farcaster Mini Apps](https://miniapps.xyz)
- [Tailwind CSS](https://tailwindcss.com)
- [Next.js](https://nextjs.org/docs)
- [Neynar](https://neynar.com)

## Getting Started

1. Install dependencies:

```bash
npm install
# or
yarn install
# or
pnpm install
# or
bun install
```

2. Verify environment variables:

The environment variables enable the following features:

- Frame metadata - Sets up the Frame Embed that will be shown when you cast your frame
- Account association - Allows users to add your frame to their account, enables notifications
- Redis API keys - Enable Webhooks and background notifications for your application by storing users notification details

```bash
# Required for Frame metadata
NEXT_PUBLIC_URL=

# Required to allow users to add your frame
NEXT_PUBLIC_FARCASTER_HEADER=
NEXT_PUBLIC_FARCASTER_PAYLOAD=
NEXT_PUBLIC_FARCASTER_SIGNATURE=

# Optional: Set to "production" to disable Eruda debugger
NEXT_PUBLIC_APP_ENV=development

# Required for user authentication
NEYNAR_API_KEY=
JWT_SECRET=

# Required for webhooks and background notifications
REDIS_URL=
REDIS_TOKEN=
```

3. Start the development server:

```bash
npm run dev
```

4. Run a local tunneling server

- [NGROK](https://ngrok.com)
- [Local Tunnel](https://theboroer.github.io/localtunnel-www/)

5. Generate your Farcaster Manifest variables

- Follow these [instructions](https://miniapps.farcaster.xyz/docs/guides/publishing)
- Visit [Manifest Tool](https://warpcast.com/~/developers/mini-apps/manifest)
- Paste your tunnel domain

## Template Features

### Providers Architecture

The app uses a layered provider architecture in `components/providers/index.tsx`:

- **EnvironmentProvider** - Detects if the app is running in a browser or Farcaster Mini App context
- **ErudaProvider** - Mobile debugging console (disabled in production via `NEXT_PUBLIC_APP_ENV`)
- **WagmiProvider** - Wallet connection with Farcaster Mini App connector and Coinbase Wallet support
- **QueryClientProvider** - React Query for data fetching
- **FarcasterProvider** - Mini App SDK initialization, context, and safe area insets
- **UserProvider** - User authentication state with auto sign-in support

### Context Hooks

Three custom context hooks are available:

- `useEnvironment()` - Access `isInBrowser`, `isInFarcasterMiniApp`, and `isLoading` states
- `useFarcaster()` - Access Mini App context, capabilities, safe area insets, and SDK state
- `useUser()` - Access user data, sign-in methods, and authentication state

### Authentication System

JWT-based authentication using Farcaster Quick Auth:

- **Sign-in flow** - Uses `@farcaster/quick-auth` to verify user identity
- **API routes** - `/api/auth/sign-in` for authentication, `/api/auth/check` for session validation
- **User data** - `/api/users/me` returns authenticated user profile from Neynar
- **Auto sign-in** - Configurable automatic authentication when Mini App loads

### API Hooks

Custom hooks for API interactions built on React Query:

- `useApiQuery` - For GET requests with caching, protected routes support
- `useApiMutation` - For POST/PUT/DELETE requests with optimistic updates

### Frame Configuration

- `.well-known/farcaster.json` endpoint configured for Frame metadata and account association
- Frame metadata automatically added to page headers in `layout.tsx`

### Background Notifications

- Redis-backed notification system using Upstash
- Ready-to-use notification endpoints in `api/notify` and `api/webhook`
- Notification client utilities in `lib/notification-client.ts`

### Environment Detection & Website Fallback

When accessed from a regular browser (not in Farcaster/Base), the app displays a landing page with:

- QR code for easy mobile access
- Direct launch buttons for Farcaster and Base (Coinbase Wallet)
- App information and branding

### Wallet Integration

Pre-configured Wagmi setup with:

- Farcaster Mini App connector (`@farcaster/miniapp-wagmi-connector`)
- Coinbase Wallet connector
- Base and Mainnet chain support

### Dynamic Preview Images

- `dynamic-image-example/[id]/page.tsx` shows how to create a Mini App URL resolving to a custom preview image
- `api/og/example/[id]/route.tsx` shows how to generate a custom preview image using `next/og`
- Utility functions in `lib/og-utils.ts` for loading Google Fonts and images

### Development Tools

- **Eruda** - Mobile debugging console, automatically disabled in production
- **Type-safe environment variables** - Using `@t3-oss/env-nextjs` with Zod validation
- **Secure headers** - CSP and security headers configured via `next-secure-headers`

## Commodus: Arena wallets & Privy setup

The Arena page (`/arena`) handles the gladiator mint ritual. A successful
mint lazily provisions a custodial **Privy server wallet** on Base that
Commodus signs from on the user's behalf (TEE-custodied, non-extractable).
See `docs/mvp.md` § Gladiator Mint for the full flow.

### Required env vars

```bash
# Privy server-wallet API credentials (https://dashboard.privy.io)
PRIVY_APP_ID=
PRIVY_APP_SECRET=

# Base EOA that receives fee-on-swap transfers from arena wallets.
# Configure the same wallet in the Privy dashboard as the
# gas-sponsorship top-up destination so fees self-refill the balance.
OPERATOR_TREASURY_ADDRESS=

# Base mainnet RPC for reading on-chain state (USDC +
# position balances). Defaults to the public endpoint.
BASE_RPC_URL=https://mainnet.base.org
```

### Privy dashboard checklist

1. Create a **server wallet policy** that limits signing authz to
   `sign_transaction` on Base mainnet. No `export`, no `transfer_out`,
   no `rotate`. The app server holds authorization, not key material.
2. Enable **gas sponsorship** on Base and fund the sponsorship balance
   (~$500 for launch week per `docs/mvp.md` § Launch Choreography).
3. Configure the operator treasury wallet as the top-up destination so
   the 0.5% fee-on-swap collected at execution time self-refills the
   sponsorship balance.

### Funding recheck

There is no cron and no dedicated recheck endpoint. The in-Mini-App
deposit button waits for the tx receipt client-side and nudges the
Arena page to refetch `/api/arena/me`; `getArenaProfile` reads the
arena wallet's live USDC balance and, if it clears the
`min_mint_deposit_usdc` threshold ($5), flips `gladiators.status` from
`pending_funding` to `alive` inline. The page keeps polling
`/api/arena/me` every 5s while `needs_funding` is true, so if the
server's RPC trails the client's preconf RPC (typically 2–30s), the
next poll catches up. For the rare support case, operators can flip
`gladiators.status` directly in Supabase.

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── auth/          # Authentication endpoints
│   │   ├── notify/        # Push notification endpoints
│   │   ├── og/            # Dynamic OG image generation
│   │   ├── users/         # User data endpoints
│   │   └── webhook/       # Webhook handlers
│   └── dynamic-image-example/  # Dynamic preview image example
├── components/
│   ├── pages/             # Page components (home, website)
│   ├── providers/         # Context providers
│   └── shared/            # Reusable UI components
├── contexts/              # React contexts
├── hooks/                 # Custom React hooks
└── lib/                   # Utilities and configurations
```

## Learn More

- [Farcaster Mini Apps](https://miniapps.xyz)
- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Neynar](https://neynar.com)
