# Deployment

Syncfly serves the frontend and API together. Use Docker Desktop on Windows or macOS, or Docker Engine on a Linux server. A static host displays download instructions because it cannot run the backend.

## Windows and macOS

Follow the [desktop quickstart](../README.md#download-and-run). Windows uses Linux containers through Docker Desktop's WSL 2 backend; macOS uses Docker Desktop's Linux VM. Node.js and Python are not required on the host for this setup.

`-ExecutionPolicy Bypass` applies to the PowerShell process running the launcher. It does not change the system policy. The initial build downloads the provider CLIs and may take several minutes.

### Configuration and storage

The launcher creates `.env.desktop` with a random invitation code. Windows restricts it to the current user; macOS sets file permissions to `0600`. Start opens a setup URL with the code in the fragment. The browser removes the fragment immediately and uses the code only for registration; it is not sent in page requests. This file is excluded from Git and Docker builds.

| Setting | Purpose |
| --- | --- |
| `RELAY_PUBLIC_URL` | Exact browser origin, without a trailing slash. |
| `RELAY_HOST_DATA_DIR` | Linux mount point of the data volume; set by the launcher. |
| `RELAY_INVITE_CODE` | Required when creating an account, including the first account. |
| `RELAY_ALLOW_SIGNUP` | Controls registration after the first account; defaults to `false`. |
| `RELAY_MAX_ACTIVE_TASKS` | Host-wide task limit; defaults to `1` in the desktop configuration. |

User data, provider credentials, images, and repository checkouts are stored in the `syncfly_data` Docker volume. Agent containers receive their own provider directory and task checkout. Increase the task limit only when the host has sufficient memory; each runner has a 2 GB memory limit and a 2 CPU limit. Rerun `Start` after editing configuration.

### Management commands

Run the launcher with the desired action:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows.ps1 -Action Status
```

| Action | Result |
| --- | --- |
| `Start` | Build and start Syncfly, then open account setup or sign-in. |
| `Status` | Show container status. |
| `Logs` | Show recent backend logs. |
| `Stop` | Stop containers and retain stored data. |
| `Invitation` | Display the signup code. |
| `OpenInvites` | Allow registrations with the signup code. |
| `CloseInvites` | Disable further registrations. |
| `Private` | Configure private HTTPS access through Tailscale. |
| `Local` | Stop remote access and restore the localhost origin. |

On macOS, the same local management actions use:

```sh
bash scripts/macos.sh Status
bash scripts/macos.sh OpenInvites
bash scripts/macos.sh Invitation
bash scripts/macos.sh CloseInvites
```

`Private` and `Local` are currently Windows launcher actions. The macOS package provides local access only; a server or separately configured private network is needed for remote use.

### Account setup troubleshooting

- **Invitation code required:** open the new Start Syncfly launcher instead of typing localhost manually. It supplies the code automatically. If you use a manually opened tab, use the `Invitation` action to retrieve the code.
- **Registration closed:** an account already exists. Sign in with it, or ask the owner to run `OpenInvites` before creating another account.
- **Still seeing the old example board:** stop the older copy, run Start from the new release folder, and reload the browser. No example projects or tasks are included in current releases. Old browser-only example data is discarded; server projects are preserved.
- **Backend unavailable:** check Docker Desktop is running. Run `Status` or `Logs` for details, then run `Start` again.
- **Wrong address:** use the URL printed by the launcher. If private access was enabled, sign in through its HTTPS address.

### Private remote access

Install [Tailscale](https://tailscale.com/download) on the host PC and each client device. Invite users to your Tailscale network, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows.ps1 -Action Private
```

The first run displays a Tailscale device sign-in link. Complete sign-in, then run the command again. If prompted, enable HTTPS using the link Tailscale provides and rerun the command.

Use the printed `https://syncfly.<your-network>.ts.net` address to access Syncfly. The launcher replaces the localhost sign-in origin with this address. [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) restricts access to your private network; the configuration does not enable public Funnel access.

To onboard users, run `OpenInvites`, share the Syncfly invitation code privately, and run `CloseInvites` once they have registered. Existing users can continue signing in after registration closes. The host PC must remain awake with Docker Desktop running.

## Linux server

Requirements:

- Docker Engine and the Compose plugin.
- Python 3 for the configuration script.
- A hostname pointing to the server and inbound ports 80 and 443.
- Outbound access to provider APIs and supported Git hosts.

Clone the repository on the server. From its root directory, run:

```sh
python3 scripts/configure-cloud.py --domain syncfly.example.com --data-dir /opt/syncfly/data
sudo mkdir -p /opt/syncfly/data
./scripts/deploy.sh
```

Replace `syncfly.example.com` with your hostname. Run the deployment script as a user with Docker access.

The configuration script creates `.env` with mode `0600` and refuses to overwrite an existing file. The deployment script combines `compose.yaml` and `compose.production.yaml` to start the app and Caddy. Caddy manages HTTPS certificates; the app port is bound to the host's loopback interface.

Open your HTTPS URL and create the first account using the invitation code in `.env`. To register additional users, temporarily set `RELAY_ALLOW_SIGNUP=true` and recreate the app container:

```sh
docker compose -f compose.yaml -f compose.production.yaml up -d
```

Set the value back to `false` and repeat the command after onboarding. The invitation code is shared between invited users; email verification is not implemented.

For an existing reverse proxy, `compose.yaml` provides the base service on `127.0.0.1:4310`. Supply the exact HTTPS origin through `RELAY_PUBLIC_URL`. The production override adds invitation enforcement, health checks, and bounded logs; include equivalent settings when replacing it.

## Connect providers and run tasks

1. Open **Connections** and follow the provider's CLI sign-in flow. For images, add a Gemini API key from Google AI Studio.
2. Create a project. Coding tasks require a public HTTPS repository on GitHub, GitLab, or Bitbucket. Planning and image tasks can run without a repository.
3. Create tasks directly or use **Plan with AI** to request proposed assignments and dependencies.
4. Review the plan, start tasks, and inspect their output. Approve prerequisites before starting dependent tasks.
5. Review and merge code changes separately. Task approval does not merge a branch.

Provider billing and usage limits apply independently of Syncfly. Run a small task with each provider to validate sign-in and permissions on the deployment host.

## Health and backups

`/healthz` checks that the web service is responding. `/readyz` also checks whether the Docker runner image is available and returns `503` when it is unavailable. Neither endpoint verifies provider credentials.

Back up configuration and application data before upgrades or host resets:

- Desktop: `.env.desktop`, `syncfly_data`, and the Tailscale state volume.
- Linux: `.env`, the configured host data directory, and Caddy's certificate volume.

Backups contain provider credentials and should be encrypted and access-controlled. Stopping the containers retains their data; deleting Docker volumes removes it. Review the [execution and security model](architecture.md#execution-and-security) before adding users.
