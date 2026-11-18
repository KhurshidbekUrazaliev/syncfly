Syncfly 0.2.2 is a standalone Windows x64 application. Docker is not required.

- **Syncfly-Setup-0.2.2.exe** installs Syncfly for your Windows user and creates shortcuts.
- **Syncfly-Portable-0.2.2.exe** runs without installation.
- **SHA256SUMS.txt** contains the download checksums.

This release includes the updated Windows project: named AI account profiles, up to ten independent workers, combined-result orchestration, private GitHub integration, shared reference uploads, and orchestrator-reviewed computer actions. It also fixes false usage-limit errors caused by rate-limit text in repository output.

Create a local account on first launch. Install Git and the desired provider CLI, sign in, and verify it in Connections. Gemini API image generation requires your API key. Provider usage and billing remain separate.

Close Syncfly before upgrading. Existing native desktop workspace data under `%APPDATA%/Syncfly/workspace` is retained. Docker/browser workspaces are not automatically migrated. The packages are unsigned and do not configure an automatic updater.

The Windows desktop tests use fixture agents and temporary data; they do not verify the availability of your live provider accounts. The release is rebuilt from the imported source and tested in GitHub Actions before publication.

macOS users can continue using the separate [v0.2.0 Docker package](https://github.com/KhurshidbekUrazaliev/syncfly/releases/download/v0.2.0/Syncfly-macOS.zip). This release does not include a native macOS app.
