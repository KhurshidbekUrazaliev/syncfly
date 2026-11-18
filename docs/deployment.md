# Deployment

## Run on your Windows PC

For the standalone Windows app, use the [release downloads](https://github.com/KhurshidbekUrazaliev/syncfly/releases/tag/v0.2.2). See [desktop setup and build instructions](../desktop/README.md). This version bundles its runtime, opens in a dedicated window, and uses native local execution without Docker. The Docker deployment below remains available for isolated runners.

Install [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) with the **WSL 2 backend** and **Linux containers**, then start Docker Desktop. Docker Desktop is [free for personal use](https://docs.docker.com/subscription-billing/desktop-license/). Use a supported Windows version with hardware virtualization enabled and at least 8 GB of RAM. No Node or Python installation is required for this deployment.

Clone this repository or download and extract its ZIP. Open PowerShell in the project folder and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows.ps1 -Action Start
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows.ps1 -Action Invitation
```

`ExecutionPolicy Bypass` applies only to that PowerShell process; it does not change the machine's execution policy. Review the script before running it. The first build downloads the official agent CLIs and can take several minutes.

Open **http://localhost:4310** on that PC. Create your first Syncfly account using the private invitation code displayed by the second command. Keep that code private. Subsequent registrations are disabled until you enable them.

The launcher creates `.env.desktop` with a random invitation code and restricts file access to the current Windows user. This file is excluded from Git and image builds. User data, API keys, agent sign-ins, and repository checkouts live in the `syncfly_data` Docker volume. The launcher discovers the volume's Linux mount point so sibling agent containers can access the correct task directory; it does not mount your Windows home directory into agents. The desktop configuration allows **one running task across all users** by default. Increase `RELAY_MAX_ACTIVE_TASKS` in `.env.desktop` only if your PC has enough memory, then rerun `Start`.

### Private access for invited testers

For a personal, non-commercial pilot, [Tailscale's Personal plan](https://tailscale.com/docs/account/manage-plans/free-plans-discounts) includes six users. Install Tailscale on the Windows PC and each tester's device. Testers must be invited to your private Tailscale network as well as receive a Syncfly invitation code.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows.ps1 -Action Private
```

The first run displays a Tailscale device sign-in link. Complete sign-in in your browser, then run the same command again. If Tailscale asks you to enable HTTPS, follow its link and rerun the command. It prints the private `https://syncfly.<your-network>.ts.net` address and configures Syncfly to use it. Use that address after enabling private access; the localhost sign-in origin is replaced. This uses [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve), which is private to your network. It does not enable public Funnel access or open a router port.

Open registration while onboarding your trusted testers, then close it:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows.ps1 -Action OpenInvites
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows.ps1 -Action CloseInvites
```

Use `-Action Status` to check containers, `Logs` for backend output, `Stop` to stop Syncfly without deleting data, and `Local` to stop private access and restore localhost mode. Keep the Windows PC awake and Docker Desktop running while testers use it. Back up the data volume before resetting Docker Desktop or deleting volumes.

Free hosting does not include provider subscriptions or paid API usage. In **Connections**, sign in through supported official CLIs and add a Gemini API key for image generation. Verify one small task with each provider before inviting testers. Windows execution, private network access, and real provider sign-ins still require validation on your Windows PC.

## Guided cloud deployment

The production override includes Caddy HTTPS, persistent certificates, an agent-runner readiness check, bounded container logs, and invitation-protected registration. It requires a Linux server with Docker Engine and Compose, a domain pointing to that server, and inbound ports 80/443. Server access and DNS are not provisioned by this repository.

On that server, from this project folder:

```sh
python3 scripts/configure-cloud.py --domain syncfly.example.com --data-dir /opt/syncfly/data
sudo mkdir -p /opt/syncfly/data
./scripts/deploy.sh
```

The configuration script creates `.env` with mode 0600 and a random invitation code, and refuses to overwrite an existing configuration. Read the code privately from that file to create the first account. It is not printed in deployment logs. Keep registrations disabled after the first account; enable `RELAY_ALLOW_SIGNUP=true` temporarily to invite trusted testers who have the code. This is a shared pilot access code, not verified-email identity or a public signup system.

Validate `https://YOUR_DOMAIN/readyz`, sign in, connect one provider, and run a small task before opening the pilot. The app and API are served together on your own domain. The hosted Syncfly website provides downloads and setup instructions. Back up the host data directory and Caddy certificate volume before upgrades. No cloud deployment or real provider execution has yet been verified.

References: [Docker production overrides](https://docs.docker.com/compose/how-tos/production/), [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https).

## Cloud deployment (Linux Docker host)

Requirements: Docker Engine + Compose plugin, an HTTPS domain/reverse proxy, outbound access to AI providers and Git hosts, and adequate RAM for the desired concurrency (runner cap: 2 GB and 2 CPUs per container). This package is for a self-hosted, trusted team, not open public multi-tenant SaaS.

1. Copy this directory to your server. Copy `.env.example` to `.env`.
2. Set `RELAY_HOST_DATA_DIR` to an absolute path on that server, such as `/opt/relay/data`. Create that directory. Set `RELAY_PUBLIC_URL` to your exact HTTPS origin (no trailing slash).
3. Run:

   ```sh
   docker compose up -d --build
   ```

4. Proxy your domain to `127.0.0.1:4310`. For Caddy running on the host:

   ```caddy
   relay.example.com {
       reverse_proxy 127.0.0.1:4310
   }
   ```

5. Create the first account immediately. By default, subsequent registrations are disabled. To onboard a trusted team, temporarily set `RELAY_ALLOW_SIGNUP=true`, recreate the app container, then disable registrations again.
6. Add a project. Public HTTPS repositories from GitHub, GitLab, and Bitbucket are supported; a repository is optional for planning and images. The native desktop app also supports private GitHub repositories through GitHub CLI authentication.
7. Open Connections. Start each desired provider’s official sign-in flow, follow its link/code, and verify. For Gemini images, add your API key from Google AI Studio. Provider usage and API charges remain your responsibility.
8. Choose **Plan with AI**, select a connected lead, describe your goal, then review and accept its proposed tasks. Start ready tasks from their detail panels. Tasks can be reassigned before execution.

You may use `http://localhost:4310` as `RELAY_PUBLIC_URL` through an SSH tunnel during initial setup. Never expose account/password login over public plain HTTP.

### Runner architecture

The web service has Docker socket access so it can create sibling runner containers. This makes the web service a trusted administrative component. Never expose this deployment to untrusted public registrations. Provider containers do not receive the Docker socket, server data, or other users’ credentials. Each receives only its own provider HOME and task checkout, drops Linux capabilities, runs as UID 1000, uses a read-only root filesystem, and has resource limits.

Containers need outbound network access to providers; network access is not an SSRF/metadata sandbox. On a cloud VM, restrict runner access to instance metadata and private infrastructure using host/network firewall rules before using untrusted repositories. API keys and CLI credential files are stored in owner-restricted server files, not encrypted with a separate KMS. Protect and encrypt your data volume and backups. The server operator is trusted.

A cloud task uses an isolated standalone clone (rather than a linked worktree, whose Git metadata would cross the container boundary). The task’s checkout path and branch are shown in the review panel. Inspect new/untracked files in that checkout. Review and merge changes on the server or export a patch; approving a task does not merge or push it. Downstream agents receive prerequisite summaries, not automatically merged source changes. Merge prerequisite code into the project’s base repository before starting dependent coding tasks that need it.

On Windows, Claude Code Sonnet reviews native Claude/Cursor/Antigravity permission requests and Syncfly computer actions automatically. It uses the project’s named Claude orchestrator account when selected, otherwise the default Claude login. Decisions are recorded in worker logs. Denied, unavailable, or timed-out reviews do not execute the action; no manual approval dialog is opened. Computer access still must be enabled for the task and can be revoked. Codex retains its native workspace sandbox; OS and provider account restrictions still apply. Cloud runners retain their provider permission controls. Result/plan acceptance and publishing remain separate workflow actions. CLI authentication/version differences may require updating the adapter. Runner images install current vendor CLIs at build time; pin tested versions before a stable deployment.
