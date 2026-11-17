<img src="dist/syncfly-sync-wings.png" alt="Syncfly logo" width="64" height="64">

# Syncfly

Self-hosted project management for coding agents. Assign tasks to Claude Code, Codex, Gemini, or Cursor, share project context, and review their output in one workspace.

[![Checks](https://github.com/KhurshidbekUrazaliev/syncfly/actions/workflows/checks.yml/badge.svg)](https://github.com/KhurshidbekUrazaliev/syncfly/actions/workflows/checks.yml)

[Downloads and setup](#download-and-run) · [Deployment](docs/deployment.md) · [Architecture](docs/architecture.md)

## Features

- Task board, dependencies, activity logs, and code review.
- Project plans proposed by a lead agent and approved before execution.
- Separate Docker containers and repository checkouts for coding tasks.
- Provider sign-in through official CLIs.
- Gemini API integration for image generation and planning.

## Download and run

- [Windows download](https://github.com/KhurshidbekUrazaliev/syncfly/releases/latest/download/Syncfly-Windows.zip)
- [macOS download](https://github.com/KhurshidbekUrazaliev/syncfly/releases/latest/download/Syncfly-macOS.zip)
- [Release notes and checksums](https://github.com/KhurshidbekUrazaliev/syncfly/releases/latest)

These packages run the backend in Docker and open the interface in your browser. They are not standalone native installers. No Node.js, Python, or Git installation is needed on your computer.

1. Install and start Docker Desktop for [Windows](https://docs.docker.com/desktop/setup/install/windows-install/) or [Mac](https://docs.docker.com/desktop/setup/install/mac-install/). Windows needs the WSL 2 backend and Linux containers. Choose the Docker build for your Mac's processor.
2. Download and **extract the entire ZIP** for your system.
3. Open **Start Syncfly.cmd** on Windows or **Start Syncfly.command** on macOS. The first build downloads the agent tools and can take several minutes.
4. Your browser opens with the setup code already supplied. Create your Syncfly account, then create a project and connect a provider. New workspaces are empty.

Keep Docker Desktop running while using Syncfly. Open **Stop Syncfly** to stop the containers without deleting your data. If macOS does not open the launcher, open Terminal in the extracted folder and run `bash scripts/macos.sh Start`. Windows can run `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows.ps1` from the folder.

**Upgrading an earlier download:** stop the old copy, extract the new version, and copy your existing `.env.desktop` file into the new folder if present. Start the new launcher. It rebuilds the app and reuses the `syncfly_data` Docker volume. If you already created an account, sign in with it. Do not delete the volume.

Accounts and projects belong to the installation on that computer. Downloading Syncfly on a second computer does not transfer your data. See [deployment](docs/deployment.md) for storage, private access, and server hosting.

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

CI checks account setup in Chromium, workspace persistence, both launchers with a simulated Docker engine, and a real Docker deployment on Linux. Full Docker Desktop runs on Windows/macOS and live provider sign-ins still require verification on the target computer. See [execution and security](docs/architecture.md#execution-and-security) before deploying.

## Development

The web service requires Node.js 20 or later and has no npm dependencies.

```sh
npm test
npm run check
```

See the [architecture guide](docs/architecture.md) for source layout, local development, and provider adapters.
