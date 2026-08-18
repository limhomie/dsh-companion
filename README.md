# DSH Companion

English | [中文](README.zh.md)

DSH Companion is a mobile-first companion surface for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Harness serves it from `/companion/` on the same origin. The computer's loopback page retains local administration; an approved phone connects through private Tailscale HTTPS as a read-only viewer or an explicitly promoted owner.

The Harness backend still listens only on `127.0.0.1`. Tailscale Serve supplies private-network reachability, while Harness owns one-time pairing, the HttpOnly device credential, authorization, and revocation. Viewers use the bounded read-only Companion UI. Owners start the official Harness Web client and receive its remote browser capabilities; native dialogs and document-opening operations remain local-only.

## Implemented

- Loads Harness Typert Registry, Client Connection, API Remotes, and Client Runtime directly instead of owning a second session or interaction protocol.
- Registers Harness's standard Conversation definitions and renders the Runtime-owned read-only history, including messages, tool activity, partial output, and failures.
- Derives the inbox, session list, and pending state from `ctx.sessions`.
- Responds through Harness `PendingWait.respond()`; only a Host resolved frame removes pending work.
- Composes Inbox, Session, and Settings as independent Cordis UI plugins.
- Runs a Chinese pre-runtime pairing page that keeps its claim secret only in page memory, receives the credential through an HttpOnly Cookie, and then starts the standard Harness Client Runtime.
- Lets the local Settings page create a QR offer, compare and approve a six-digit code, list paired devices, and revoke one after explicit confirmation.
- Gives every newly paired device viewer access and lets the loopback Settings page explicitly promote it to owner after a complete-control warning.
- Starts the official Harness Web client for authenticated owners; viewers remain in Companion, and unknown or Host-native API targets fail closed as local-only.
- Mounts the production build at `/companion` through a Host plugin that rejects non-loopback binds and mismatched Harness package versions.
- Publishes an installable manifest, home-screen icons, and a Service Worker that precaches only versioned static assets; `/companion/?install=1` gives viewers and owners a stable installation entry that does not start Harness, and API and WebSocket data are never cached.
- Includes a Capacitor 8 Android project that reuses the same React/Vite entry and remains outside Harness until native device identity exists.
- Lets a native owner choose an existing Host workspace, create or reuse its blank session, send the first prompt, and stop a running turn without copying Harness session state.
- Runs keyless browser coverage against the official Harness Fixture at 390x844, 430x932, and 1280x800.

See the [architecture](docs/architecture.md), the [Chinese mobile and Android guide](docs/mobile.zh.md), the [trusted Host-served PWA decision](.agents/notes/implemented/architecture/2026-08-16-trusted-host-served-pwa.md), the [installable PWA and Capacitor decision](.agents/notes/implemented/architecture/2026-08-17-installable-pwa-and-capacitor-android.md), [AGENTS.md](AGENTS.md), and the [Chinese design workflow](docs/design-workflow.zh.md).

## Setup

The prerelease development setup expects sibling checkouts:

```text
workspace/
  deepseek-harness/
  dsh-companion/
```

Companion pins DeepSeek Harness `0.1.0-rc.5` at commit `f652a3263943a26ebfa3f0945230c1f40884637d`. Node.js 22.19 or newer, pnpm 10, and Chrome are required.

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

## PWA and Android

The browser surface is installable as a PWA from `/companion/?install=1`. The [Chinese mobile and Android guide](docs/mobile.zh.md) documents Capacitor sync, Debug APK builds, Android Studio, and the future GitHub Releases path. The current APK proves packaging and the fail-closed native entry; real connections still use the PWA. Native QR scanning, notifications, background reconnect, and Keystore-backed device identity follow through platform plugins. Harness execution and model credentials remain on the computer.
