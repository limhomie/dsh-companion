# DSH Companion

English | [中文](README.zh.md)

DSH Companion is a mobile-first companion surface for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Harness now serves it from `/companion/` on the same origin. The current slice reads real sessions and responds to Harness questions and approvals from a desktop browser using the responsive mobile layout.

This build is intentionally loopback-only. It validates the real Harness data path and the mobile workflow, but it is not an authenticated remote phone client. LAN, Tailscale, and public access remain blocked until device pairing, authorization, and revocation exist.

## Implemented

- Loads Harness Typert Registry, Client Connection, API Remotes, and Client Runtime directly instead of owning a second session or interaction protocol.
- Registers Harness's standard Conversation definitions and renders the Runtime-owned read-only history, including messages, tool activity, partial output, and failures.
- Derives the inbox, session list, and pending state from `ctx.sessions`.
- Responds through Harness `PendingWait.respond()`; only a Host resolved frame removes pending work.
- Composes Inbox, Session, and Settings as independent Cordis UI plugins.
- Mounts the production build at `/companion` through a Host plugin that rejects non-loopback binds and mismatched Harness package versions.
- Runs keyless browser coverage against the official Harness Fixture at 390x844, 430x932, and 1280x800.

See the [architecture](docs/architecture.md), the [implemented real-Harness slice](.agents/notes/implemented/architecture/2026-08-15-host-served-real-harness-slice.md), the [read-only Conversation decision](.agents/notes/implemented/feature/2026-08-15-read-only-conversation-history.md), [AGENTS.md](AGENTS.md), and the [Chinese design workflow](docs/design-workflow.zh.md).

## Setup

The prerelease development setup expects sibling checkouts:

```text
workspace/
  deepseek-harness/
  dsh-companion/
```

Companion pins DeepSeek Harness `0.1.0-rc.5` at commit `47f943859bef60e4160492346772ded9b24f765a`. Node.js 22.19 or newer, pnpm 10, and Chrome are required.

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

The next stage adds device identity, QR pairing, scopes, revocation, and explicit protocol compatibility in Harness before non-loopback access is enabled. Installable PWA support, background notifications, Capacitor packaging, and an optional end-to-end encrypted relay follow that security foundation.
