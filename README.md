# DSH Companion

DSH Companion is a mobile-first web and native companion for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It lets a person monitor running sessions, answer questions, review approvals, steer work, and continue a conversation away from the computer where Harness runs.

The project is currently in the architecture stage. The first deliverable is a host-served responsive web app that can be inspected in a desktop browser at mobile viewport sizes. Native iOS and Android packaging follows after the interaction and connection contracts are stable.

## Product direction

- Harness remains the source of truth for agents, sessions, tools, workspaces, permissions, and durable events.
- Companion is a client surface, not another agent runtime or session database.
- Human attention is the primary mobile workflow: pending approvals, questions, plan reviews, failures, and completed work come before a general chat screen.
- Host capabilities and client features compose as plugins.
- Remote access requires device authentication and explicit authorization; network reachability is not authentication.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the system boundaries, plugin model, wire requirements, security model, and delivery phases.

## Planned delivery

1. Responsive fixture-driven web shell and interaction walkthrough.
2. Authenticated direct connection to Harness over LAN or a private network such as Tailscale.
3. Installable PWA with foreground resynchronization and Web Push where available.
4. Capacitor packaging for iOS and Android with secure storage, QR scanning, camera attachments, and native push.
5. Optional end-to-end encrypted relay for hosts that cannot accept inbound connections.

## Status

No production connection or authentication implementation exists in this repository yet. Do not expose a Harness HTTP endpoint to an untrusted network to test this project.
