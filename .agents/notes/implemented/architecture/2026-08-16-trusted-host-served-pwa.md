# Agent Note: Trusted Host-served read-only PWA

Status: implemented

## Problem

Companion can read real Harness sessions from the computer's loopback page, but network reachability alone does not identify a phone or limit what it may call. Exposing the existing Host through LAN or Tailscale without device authentication would make sensitive session content available to every caller that can reach the allowed authority.

## Decision

The first phone connection uses Harness device trust while Companion remains served by the same Host origin. The computer Settings page creates an expiring offer and renders its QR URL. A phone opens a pre-runtime pairing page, submits a device label, and shows the returned six-digit verification code. After the computer approves that claim, polling receives an HttpOnly device Cookie and reloads the normal Harness Client Runtime.

Companion never reads, persists, or logs the credential. The claim secret exists only in React memory during pairing. The pairing page runs before Cordis Connection startup, preventing unauthenticated WebSocket retries from obscuring the flow. A lost polling response can be retried with the same claim secret while the offer remains valid.

The main remote entry resolves device trust before loading the Client Runtime. A `401 device-unauthorized` response is an unauthenticated browser state: Companion renders pairing guidance and does not start session transports. Network failures, incompatible responses, and other authorization failures still reject plugin loading so deployment faults remain visible.

A newly paired device is a viewer. A viewer can rebuild the inbox, session list, conversation history, and bounded live read projections through the existing Harness client packages. Harness authorization remains the enforcing layer. An owner enters the official Harness client under the [owner-client decision](2026-08-16-official-owner-client.md); the computer's loopback page retains local authority.

The Settings plugin creates offers, refreshes pending claims, approves a matching code, lists paired devices, and requires a second confirmation before revocation. When no public origin is configured it reports that phone pairing is unavailable rather than generating a loopback QR code.

Production reachability uses Tailscale Serve. Harness still listens on `127.0.0.1`; Serve publishes a private HTTPS origin and forwards it to port 3080. `DSH_COMPANION_PUBLIC_ORIGIN` supplies the QR origin, and the start script passes the same authority to Harness `trustedHosts` after validating that it is a canonical HTTPS origin. Fixture mode remains a local visual preview and does not claim device trust.

## Alternatives considered

**Serve the phone from an independent Vite origin.** This creates cross-origin Cookie and WebSocket handling and does not represent the production deployment. Real data remains Host-served and same-origin.

**Persist a token in Companion and implement another Connection client.** This would expose a long-lived credential to UI JavaScript and duplicate Harness HTTP, WebSocket, reconnection, and Session behavior.

**Grant owner access during pairing.** Pairing establishes device identity. Keeping the new device as a viewer lets the local operator inspect and separately approve the higher-risk owner authority.

## Verification

Unit tests cover the credentialed same-origin HTTP client, cancellation, and the explicit unauthenticated state. Production-build Playwright tests cover the Chinese pairing flow and unpaired remote landing at 390x844, 430x932, and 1280x800, including claim, verification code, approval polling, reload, remote read-only controls, revocation confirmation, and horizontal overflow. Harness owns focused tests for the credential, authorization, and revocation behavior.

## Consequences

- A viewer phone can inspect real Harness conversations without mutation authority; an owner phone uses the official client.
- The real mobile path requires Tailscale installation, Tailnet access, a configured HTTPS origin, and a Harness checkout containing the device-trust packages.
- Browser-visible sessions can contain sensitive prompts, model output, tool arguments, and paths. Pair only devices and browser profiles that should read that data, and do not expose the origin through Tailscale Funnel or the public internet.
- Installability and the bounded static cache are owned by the [PWA and Capacitor decision](2026-08-17-installable-pwa-and-capacitor-android.md). Native key storage, notifications, mobile official-client layout, and relay transport remain later capabilities.
