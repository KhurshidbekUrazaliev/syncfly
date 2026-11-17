<img src="dist/syncfly-sync-wings.png" alt="Syncfly logo" width="64" height="64">

# Syncfly

Self-hosted project management for coding agents. Assign tasks to Claude Code, Codex, Gemini, or Cursor, share project context, and review their output in one workspace.

[![Checks](https://github.com/KhurshidbekUrazaliev/syncfly/actions/workflows/checks.yml/badge.svg)](https://github.com/KhurshidbekUrazaliev/syncfly/actions/workflows/checks.yml)

[Windows setup](#run-on-your-windows-pc) · [Deployment](docs/deployment.md) · [Architecture](docs/architecture.md)

## Features

- Task board, dependencies, activity logs, and code review.
- Project plans proposed by a lead agent and approved before execution.
- Separate Docker containers and repository checkouts for coding tasks.
- Provider sign-in through official CLIs.
- Gemini API integration for image generation and planning.

## Run on your Windows PC

Install [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) with the WSL 2 backend and Linux containers, then start it. Use a supported Windows version with virtualization enabled and at least 8 GB of RAM.

Clone the repository, or download and extract the ZIP from **Code → Download ZIP**:

```powershell
git clone https://github.com/KhurshidbekUrazaliev/syncfly.git
cd syncfly
```

In PowerShell, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows.ps1 -Action Start
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows.ps1 -Action Invitation
```

The first command builds and starts the containers. The second displays the invitation code for creating your account. Open [localhost:4310](http://localhost:4310), register, and connect a provider in **Connections**.

The launcher stores configuration in `.env.desktop` and application data in a Docker volume. See the [deployment guide](docs/deployment.md) for private remote access, registration controls, storage, and Linux hosting.

## Providers

| Provider | Connection | Tasks |
| --- | --- | --- |
| Claude Code | Official CLI sign-in | Coding and planning |
| Codex | Official CLI sign-in | Coding and planning |
| Gemini CLI | Official CLI sign-in | Coding and planning |
| Cursor | Official CLI sign-in | Coding and planning |
| Gemini API | API key from Google AI Studio | Images and planning |

Each user can connect one account per provider. Provider subscriptions, API billing, and usage limits apply separately. CLI sign-in support depends on the provider's current authentication flow.

## Project status

Syncfly is in early development and intended for trusted users on a single host. Projects are scoped to individual users; shared team projects are not supported yet.

Tasks must be started manually. Approval marks a task complete; code changes must be reviewed and merged separately. Private Git repositories, automatic scheduling, password recovery, and spending limits are not implemented.

CI covers backend tests, Compose configuration, and Windows launcher syntax. End-to-end Windows deployment and live provider sign-ins still need verification. See [execution and security](docs/architecture.md#execution-and-security) before deploying.

## Development

The web service requires Node.js 20 or later and has no npm dependencies.

```sh
npm test
npm run check
```

See the [architecture guide](docs/architecture.md) for source layout, local development, and provider adapters.
