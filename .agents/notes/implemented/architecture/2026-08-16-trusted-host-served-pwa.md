# Agent Note: Trusted Host-served read-only PWA

Status: implemented

## Problem

Companion can read real Harness sessions from the computer's loopback page, but network reachability alone does not identify a phone or limit what it may call. Exposing the existing Host through LAN or Tailscale without device authentication would make sensitive session content available to every caller that can reach the allowed authority.

## Decision

The first phone connection uses Harness device trust while Companion remains served by the same Host origin. The computer Settings page creates an expiring offer and renders its QR URL. A phone opens a pre-runtime pairing page, submits a device label, and shows the returned six-digit verification code. After the computer approves that claim, polling receives an HttpOnly device Cookie and reloads the normal Harness Client Runtime.

Companion never reads, persists, or logs the credential. The claim secret exists only in React memory during pairing. The pairing page runs before Cordis Connection startup, preventing unauthenticated WebSocket retries from obscuring the flow. A lost polling response can be retried with the same claim secret while the offer remains valid.

The main remote entry resolves device trust before loading the Client Runtime. A `401 device-unauthorized` response is an unauthenticated browser state: Companion renders pairing guidance and does not start session transports. Network failures, incompatible responses, and other authorization failures still reject plugin loading so deployment faults remain visible.

The initial device receives only `session:read`. A paired phone can rebuild the inbox, session list, conversation history, and live read projections through the existing Harness client packages. Remote question and approval controls are hidden, while Harness authorization remains the enforcing layer. The computer's loopback page retains local interaction authority.

The Settings plugin creates offers, refreshes pending claims, approves a matching code, lists paired devices, and requires a second confirmation before revocation. When no public origin is configured it reports that phone pairing is unavailable rather than generating a loopback QR code.

Production reachability uses Tailscale Serve. Harness still listens on `127.0.0.1`; Serve publishes a private HTTPS origin and forwards it to port 3080. `DSH_COMPANION_PUBLIC_ORIGIN` supplies the QR origin, and the start script passes the same authority to Harness `trustedHosts` after validating that it is a canonical HTTPS origin. Fixture mode remains a local visual preview and does not claim device trust.

## Alternatives considered

**Serve the phone from an independent Vite origin.** This creates cross-origin Cookie and WebSocket handling and does not represent the production deployment. Real data remains Host-served and same-origin.

**Persist a token in Companion and implement another Connection client.** This would expose a long-lived credential to UI JavaScript and duplicate Harness HTTP, WebSocket, reconnection, and Session behavior.

**Open prompts and approvals in the first slice.** Remote writes require durable actor provenance, idempotency, cancellation, and more precise scopes. The first trusted connection stays read-only until those properties are implemented together.

## Verification

Unit tests cover the credentialed same-origin HTTP client, cancellation, and the explicit unauthenticated state. Production-build Playwright tests cover the Chinese pairing flow and unpaired remote landing at 390x844, 430x932, and 1280x800, including claim, verification code, approval polling, reload, remote read-only controls, revocation confirmation, and horizontal overflow. Harness owns focused tests for the credential, authorization, and revocation behavior.

## Consequences

- A phone can inspect real Harness conversations without receiving filesystem, process, interaction, or prompt authority.
- The real mobile path requires Tailscale installation, Tailnet access, a configured HTTPS origin, and a Harness checkout containing the device-trust packages.
- Browser-visible sessions can contain sensitive prompts, model output, tool arguments, and paths. Pair only devices and browser profiles that should read that data, and do not expose the origin through Tailscale Funnel or the public internet.
- Installable PWA support, native key storage, notifications, remote writes, and relay transport remain later capabilities.
