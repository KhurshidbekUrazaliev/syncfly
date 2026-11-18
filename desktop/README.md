# Syncfly for Windows

Run `Syncfly-Setup-0.2.3.exe` to install Syncfly for your Windows user and create shortcuts, or run `Syncfly-Portable-0.2.3.exe` without installing. These packages are for Windows x64 and include the Node runtime and browser. Docker is not required.

Create your local account on first launch using your name, email, and a password of at least 12 characters. No invitation is needed. New accounts start with an empty workspace. Your workspace is saved under `%APPDATA%/Syncfly/workspace`, separately from the application, and survives upgrades. Existing browser-development data is not automatically migrated. Closing the app stops its backend and running agent processes; finish tasks before closing.

For coding tasks, install Git and the desired official provider CLI and sign in through its terminal command. API image generation and planning require a Gemini API key in Connections. Provider usage may incur charges. This desktop build runs agents as your Windows user and is for personal local use.

The installer is unsigned; Windows may display an unknown-publisher prompt. No automatic updater is configured.

## Build from source

Use Node 22 or later on Windows:

```powershell
npm ci
npm run desktop
npm run package:win
```

Installers are written to `release/`. Build configuration follows the [electron-builder Windows packaging documentation](https://www.electron.build/docs/win/). The renderer uses [Electron sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox), with Node integration disabled.

## Desktop checks

`npm run test:desktop` tests registration, validation, project/task creation, a fixture CLI run, diff review, approval, account controls, sign-out/sign-in, restart persistence, and account isolation in temporary test workspaces. It makes no paid provider calls. Set `SYNCFLY_TEST_EXE` to an unpacked release executable to run the same checks against the bundled application.

## Antigravity

The coding integration uses Google Antigravity CLI (`agy`), including its standard Windows installation at `%LOCALAPPDATA%/agy/bin/agy.exe`. Run `agy` in PowerShell and finish Google sign-in, then choose **Connections → Antigravity → Enable Antigravity**. Enabling checks installation; the CLI checks credentials on the first real run. Syncfly uses `--mode accept-edits` for coding and `--mode plan` for planning. It does not bypass provider permissions.

Older Gemini CLI task assignments migrate to Antigravity; enable the new connection before running them. Gemini API remains a separate image/planning integration. See [Google’s headless CLI documentation](https://antigravity.google/docs/cli/headless/) and [installation guide](https://antigravity.google/docs/cli/tutorial/).

## Cursor on Windows

Syncfly detects Cursor’s official Windows CLI installation under `%LOCALAPPDATA%/cursor-agent`, including its versioned `node.exe` and `index.js`. Existing PowerShell sign-ins are reused. No separate login or copied credentials are needed.

## Parallel agents

The desktop app supports up to ten starting or running tasks across local accounts. Start independent tasks to run different agents concurrently. AI plans create independent work sections. Only explicitly chosen prerequisites block a worker. An eleventh task stays queued until you start it after a slot becomes available.

## Accounts and orchestration

Version 0.2.3 plans substantial independent sections instead of sequential micro-tasks. Every coding worker can edit and test its own branch. Existing tasks identifiable as AI-generated assignments are upgraded so their old suggested ordering is advisory, including reassigned workers. Explicit prerequisites set through the new UI remain enforced. Use **Run settings → Make independent** to remove an unnecessary prerequisite, or change the account, model, or read-only setting. **Start ready workers** starts/retries eligible queued/failed workers concurrently, up to ten total slots. Cancelled tasks require an individual retry.

Claude defaults to Sonnet; an explicitly selected model overrides it. Credits and billing are provider-side requirements, shown as actionable errors rather than generic exit codes. Windows child agents use system certificate trust and do not inherit Codex desktop's private command-launcher environment.

In Connections, choose **Add AI account**, name the profile (for example Claude Max or Codex Personal), sign in, and verify it. Each Claude/Codex/Cursor profile has a separate configuration directory. Select a profile when creating a task or starting orchestration. Antigravity currently uses its system account.

Choose **Review, combine & fix** to select completed worker results. Claude Code is the default orchestrator. Syncfly snapshots the workers without changing their working copies, merges the snapshots into a new integration branch, and asks the orchestrator to resolve conflicts, review the combined implementation, and test it. Project settings can enable automatic orchestration when active workers finish. The orchestrator occupies one of the ten slots. Check its output and diff before publishing; test execution depends on the agent and project tooling.

## Private GitHub repositories and publishing

Install GitHub CLI, then use **Connections → Sign in to GitHub → Verify GitHub connection**. Existing `gh` sign-ins work too. Enter a public or private GitHub HTTPS URL in Project settings; your GitHub account must have repository access. Use **Check GitHub repository** to inspect the selected repository and access level. Private GitLab/Bitbucket authentication is not provided by this integration.

Completed orchestrator runs offer **Commit & push**, **Create pull request**, and **Publish & merge PR**. These act on the integration branch and honor GitHub branch protection. Merging uses an exact head-commit check and never forces or overrides protected branches. No remote write occurs just by connecting a repository or completing a task.

## Computer and PC file actions

Enable computer actions when creating a task or starting the orchestrator. The agent receives a Syncfly MCP bridge for screenshots, clicking, typing, shortcuts, scrolling, opening Chrome, and file operations. Claude Code Sonnet reviews each requested action against the project and task context. It uses the project's named Claude orchestrator account when selected, otherwise the default Claude login.

Decisions are recorded in the task log. Denied, unavailable, or timed-out reviews do not execute the action. No manual approval dialog is opened in this version. Overwriting a file requires its current SHA-256 from a prior read. Desktop actions execute one at a time even when multiple agents are running. Use **Revoke computer access** to stop further bridge requests from a run.

Native Claude, Cursor, and Antigravity permission requests use the same orchestrator review. Codex retains its workspace sandbox. This app is not an operating-system sandbox; provider and OS restrictions still apply. Result acceptance and GitHub publishing remain separate actions.

## Shared context uploads

Open **Shared context → Upload files or images / Upload folder**. Folder structure is preserved; empty folders are omitted. Limits are 25 MB per file, 100 MB and 1,000 files per project. Uploads are stored in the local workspace and are available to project agents on subsequent runs. Removing an upload does not change its original PC file. Coding agents receive a temporary reference folder that is removed after the run and excluded from integration snapshots. Gemini API runs accept supported text, images, and PDF references up to 16 MB total; unsupported references produce an explicit error. Provider requests may send reference content to the selected AI provider.


