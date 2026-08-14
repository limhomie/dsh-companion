# DSH Companion

English | [中文](README.zh.md)

DSH Companion is a mobile-first web and native companion for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It lets a person monitor running sessions, answer questions, review approvals, steer work, and continue a conversation away from the computer where Harness runs.

The repository now contains a fixture-driven Stage 0 responsive web app that runs in a desktop browser at mobile viewport sizes and completes the attention workflow. It does not connect to a real Harness. Authenticated direct access and native packaging follow after the interaction and connection contracts are stable.

## Product direction

- Harness remains the source of truth for agents, sessions, tools, workspaces, permissions, and durable events.
- Companion is a client surface, not another agent runtime or session database.
- Human attention is the primary mobile workflow: pending approvals, questions, plan reviews, failures, and completed work come before a general chat screen.
- Host capabilities and client features compose as plugins.
- Remote access requires device authentication and explicit authorization; network reachability is not authentication.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the system boundaries, plugin model, wire requirements, security model, and delivery phases.

Engineering changes follow [AGENTS.md](AGENTS.md) and the current [Chinese design workflow](docs/design-workflow.zh.md). The first implemented vertical slice is the [attention-centered mobile workflow](.agents/notes/implemented/feature/2026-08-15-attention-workflow-first-slice.md).

## Local preview

Use Node.js 22.19 or newer, pnpm, and a modern browser:

```sh
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173/`. `pnpm run check` runs types, lint, unit tests, and the production build. `pnpm run test:web` runs the three target viewports with an installed Chrome.

## Planned delivery

1. Responsive fixture-driven web shell and interaction walkthrough.
2. Authenticated direct connection to Harness over LAN or a private network such as Tailscale.
3. Installable PWA with foreground resynchronization and Web Push where available.
4. Capacitor packaging for iOS and Android with secure storage, QR scanning, camera attachments, and native push.
5. Optional end-to-end encrypted relay for hosts that cannot accept inbound connections.

## Status

Only the Fixture Web preview is implemented. No production Harness connection or authentication exists yet. Do not expose a Harness HTTP endpoint to an untrusted network to test this project.
