# Architecture

Syncfly is a Node.js HTTP service with a browser frontend and Docker-based task runners. The web service has no npm runtime dependencies. Project state, events, assets, and credentials are stored on disk.

## Source layout

| Path | Responsibility |
| --- | --- |
| `server.mjs` | HTTP routes, project and task operations, provider adapters, and Gemini API requests. |
| `cloud.mjs` | Accounts, sessions, per-user state, provider sign-in, and Docker runner management. |
| `dist/` | Browser interface and static assets. |
| `Dockerfile` | Web service image. |
| `Dockerfile.runner` | Provider CLIs and task dependencies. |
| `compose.desktop.yaml` | Docker Desktop deployment and optional Tailscale service. |
| `compose.yaml`, `compose.production.yaml` | Linux deployment and HTTPS proxy. |
| `scripts/` | Windows and macOS launchers, release packaging, and Linux deployment scripts. |
| `test/` | Backend, HTTP, browser, and launcher regression tests. |

## Task lifecycle

Users create tasks directly or request a plan from a connected provider. Plans include assignments and dependencies. Accepting a plan creates queued tasks; execution starts when the user starts each task.

Coding runs receive a separate repository clone and branch. The interface displays output, errors, and diffs for review. Successful runs enter review; the user can approve the result or retry a failed task. Runs time out after 30 minutes. API requests have shorter timeouts.

Dependent tasks require approval of their prerequisites. They receive text summaries from those tasks, but source changes are not merged automatically. Merge prerequisite code into the project's base repository before starting dependent coding tasks that require it.

## Execution and security

The Docker deployment is intended for trusted users. The web service has access to the Docker socket and is therefore a privileged host component. It is not suitable for unrestricted public registration.

Runner containers use UID 1000, a read-only root filesystem, temporary writable directories, dropped Linux capabilities, and CPU, memory, and process limits. Each runner mounts its own provider directory and task checkout. Runners do not receive the Docker socket or other users' directories.

Containers have outbound network access. Container separation does not prevent access to instance metadata or private network services; restrict those destinations at the host or network layer when running untrusted repositories.

Passwords use scrypt hashing. Sessions use HttpOnly, SameSite cookies, expire after 24 hours, and are invalidated when the server restarts. HTTPS origins also enable the Secure cookie flag. Provider credentials are stored in restricted files on the host, without separate application-level encryption. The server operator can access them. Protect the data volume and its backups.

Official CLI approval flows remain active. A task that requires interactive approval may need to be continued through the provider's CLI.

## Local development

Use Node.js 20 or later. Native mode runs CLIs installed and signed in on the host and is intended for one local developer; it does not isolate execution between users.

macOS or Linux:

```sh
RELAY_EXECUTION=native npm start
```

PowerShell:

```powershell
$env:RELAY_EXECUTION = 'native'
npm start
```

Open [127.0.0.1:4310](http://127.0.0.1:4310). Local state is stored in `.runtime/` unless `RELAY_DATA_DIR` is set.

## Tests

```sh
npm test
npm run check
```

Tests cover provider arguments, task validation, dependency constraints, shared task accounting, authentication, CSRF checks, user isolation, and mocked Gemini responses. CI checks signup, login, empty workspaces, and persistence in Chromium; tests launcher configuration and restart on Windows/macOS with a simulated Docker engine; and builds and starts the real Docker services on Linux. Live provider authentication and full Docker Desktop runs on Windows/macOS remain outside automated coverage. Browser tests use Playwright as a development dependency.

## Adding a provider

Extend the provider catalog and argument adapter in `server.mjs`, add the official CLI to `Dockerfile.runner`, and implement its authentication and status commands in `cloud.mjs`. Keep each provider's credentials in its user-specific directory.

Runner images currently install vendor CLI versions available at build time. Pin versions after validating their authentication and execution behavior for a deployment.
