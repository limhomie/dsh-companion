# DSH Companion

English | [中文](README.zh.md)

DSH Companion is a mobile-first companion surface for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Harness serves it from `/companion/` on the same origin. The computer's loopback page retains its interactive controls; an approved phone can connect through private Tailscale HTTPS and read real sessions with the fixed `session:read` scope.

The Harness backend still listens only on `127.0.0.1`. Tailscale Serve supplies private-network reachability, while Harness owns one-time pairing, the HttpOnly device credential, authorization, and revocation. The phone cannot submit prompts, answer interactions, run commands, browse files, or change Host settings in this phase.

## Implemented

- Loads Harness Typert Registry, Client Connection, API Remotes, and Client Runtime directly instead of owning a second session or interaction protocol.
- Registers Harness's standard Conversation definitions and renders the Runtime-owned read-only history, including messages, tool activity, partial output, and failures.
- Derives the inbox, session list, and pending state from `ctx.sessions`.
- Responds through Harness `PendingWait.respond()`; only a Host resolved frame removes pending work.
- Composes Inbox, Session, and Settings as independent Cordis UI plugins.
- Runs a Chinese pre-runtime pairing page that keeps its claim secret only in page memory, receives the credential through an HttpOnly Cookie, and then starts the standard Harness Client Runtime.
- Lets the local Settings page create a QR offer, compare and approve a six-digit code, list paired devices, and revoke one after explicit confirmation.
- Hides question and approval controls on a paired remote device; Harness independently rejects every remote mutation and unknown API target.
- Mounts the production build at `/companion` through a Host plugin that rejects non-loopback binds and mismatched Harness package versions.
- Runs keyless browser coverage against the official Harness Fixture at 390x844, 430x932, and 1280x800.

See the [architecture](docs/architecture.md), the [trusted Host-served PWA decision](.agents/notes/implemented/architecture/2026-08-16-trusted-host-served-pwa.md), the [read-only Conversation decision](.agents/notes/implemented/feature/2026-08-15-read-only-conversation-history.md), [AGENTS.md](AGENTS.md), and the [Chinese design workflow](docs/design-workflow.zh.md).

## Setup

The prerelease development setup expects sibling checkouts:

```text
workspace/
  deepseek-harness/
  dsh-companion/
```

Companion pins DeepSeek Harness `0.1.0-rc.5` at commit `cccabc6c2378bdbc7850fb8f27a68f018810af03`. Node.js 22.19 or newer, pnpm 10, and Chrome are required.

Prepare Harness once:

```sh
cd deepseek-harness
pnpm install --frozen-lockfile
pnpm run build
```

Install and start Companion:

```sh
cd ../dsh-companion
pnpm install
pnpm host
```

Open [http://127.0.0.1:3080/companion/](http://127.0.0.1:3080/companion/). It reads sessions from that `dsh web` process; the existing Harness app remains at `/`.

## Trusted phone connection

Install Tailscale on the computer and phone, sign both into the same tailnet, and keep Harness stopped while discovering the private HTTPS address. In an Administrator PowerShell on Windows, from the Companion checkout run:

```powershell
tailscale serve --bg 3080
```

The command prints an address such as `https://computer-name.tailnet-name.ts.net`. Start Companion with that exact origin in a normal PowerShell:

```powershell
$env:DSH_COMPANION_PUBLIC_ORIGIN = 'https://computer-name.tailnet-name.ts.net'
pnpm host
```

Open the local Settings page at [http://127.0.0.1:3080/companion/](http://127.0.0.1:3080/companion/), create a pairing code, and scan its QR code from the phone. Compare the six-digit code on both screens before approving. Do not use Tailscale Funnel or expose port 3080 directly to the LAN or internet. Stop private sharing with `tailscale serve off`.

## Fixture preview

To inspect the workflow without a real Host:

```sh
pnpm dev
```

Open [http://127.0.0.1:5173/companion/?fixture](http://127.0.0.1:5173/companion/?fixture). A standalone Vite page without `?fixture` has no same-origin Harness API and is not a real connection entry.

## Verification

```sh
pnpm run check
pnpm run test:web
```

`check` verifies the pinned Harness checkout, types, lint, unit tests, and the production build. `test:web` runs the official Fixture through the real Client Runtime in all three target viewports.

## Next stage

The next stage first implements authenticated [mobile question and approval handling](.agents/notes/proposed/feature/2026-08-16-trusted-interaction-answering.md): the computer grants `interaction:answer` to one device, with durable actor provenance, idempotency, multi-device races, and revocation ordering. Prompts, queues, steering, interruption, installable PWA support, background notifications, Capacitor packaging with key-bound credentials, and an optional end-to-end encrypted relay follow that work.
