# Syncfly

A project workspace for coordinating coding agents. Assign work, share context, run independent tasks, and review their combined output.

[![Checks](https://github.com/KhurshidbekUrazaliev/syncfly/actions/workflows/checks.yml/badge.svg)](https://github.com/KhurshidbekUrazaliev/syncfly/actions/workflows/checks.yml)

## Downloads

Syncfly 0.2.2 targets **Windows x64** and includes its own runtime. Docker is not required for the Windows desktop app.

- [Windows installer](https://github.com/KhurshidbekUrazaliev/syncfly/releases/download/v0.2.2/Syncfly-Setup-0.2.2.exe)
- [Windows portable app](https://github.com/KhurshidbekUrazaliev/syncfly/releases/download/v0.2.2/Syncfly-Portable-0.2.2.exe)
- [Release notes and checksums](https://github.com/KhurshidbekUrazaliev/syncfly/releases/tag/v0.2.2)

The earlier [macOS Docker package, version 0.2.0](https://github.com/KhurshidbekUrazaliev/syncfly/releases/download/v0.2.0/Syncfly-macOS.zip), remains available. It does not include the new Windows desktop integrations.

Install or open Syncfly, then create your local account. New accounts start with an empty workspace. Install Git and your chosen provider's official CLI for coding tasks, sign in, and verify the connection in **Connections**. Gemini image generation uses your own API key.

The Windows packages are unsigned. Workspace data is stored in `%APPDATA%/Syncfly/workspace` and survives app upgrades. Close Syncfly before upgrading. Accounts, API keys, and task history are not included in the repository or downloads.

## Features

- Claude Code, Codex, Antigravity, and Cursor integrations, plus Gemini API for images and planning.
- Named Claude, Codex, and Cursor account profiles with separate configuration directories.
- Task assignments, explicit prerequisites, live output, diffs, and result review.
- Up to ten concurrent workers, with separate repository checkouts.
- An orchestrator that combines worker snapshots and reviews the integrated result.
- Shared context files, images, and folders.
- Private GitHub repositories through GitHub CLI, with explicit push and pull-request actions.
- Optional computer and file actions reviewed by a Claude Sonnet orchestrator.

The native app runs agents as your Windows user. Computer access is enabled per task and can be revoked. The orchestrator reviews native permission requests and computer actions automatically; unavailable or denied reviews do not execute the action. Provider limits and billing apply separately.

## Documentation

- [Desktop setup, accounts, orchestration, and publishing](desktop/README.md)
- [Docker and server deployment](docs/deployment.md)

The hosted Syncfly website provides downloads and setup instructions. Accounts and agent execution run in your installed app or self-hosted backend.

## Build and test

Use Node.js 22 or later and Git. Build the desktop app on Windows:

```powershell
npm ci
npm test
npm run check
npm run desktop
npm run package:win
```

Installers are written to `release/`. `npm run test:desktop` runs the Windows desktop tests with fixture agents and temporary workspaces. These tests do not call paid AI providers. `desktop/live-providers.mjs` is a separate, opt-in test that uses real signed-in accounts and consumes provider usage.

Backend tests cover authentication, user isolation, task validation, provider adapters, context uploads, permission reviews, and integration workflows. Release builds run packaged Windows desktop tests before publication.

## Current scope

Syncfly is intended for personal use and trusted self-hosted deployments. Projects belong to individual accounts; shared team projects, password recovery, and spending limits are not implemented. Desktop-only features are described in the desktop guide. The source and release history for earlier Docker versions remain available in GitHub.
