Download **Syncfly-Windows.zip** or **Syncfly-macOS.zip** below, then extract the entire archive.

1. Install and start Docker Desktop (Linux containers).
2. Open **Start Syncfly.cmd** on Windows or **Start Syncfly.command** on macOS.
3. Wait for the initial build. The browser opens with your private setup code already supplied.
4. Create your account, add a project, and connect an agent.

If macOS does not open the script, run `bash scripts/macos.sh Start` in Terminal from the extracted folder. Windows users can run `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows.ps1` from PowerShell.

Changes in this release:

- Account setup opens directly, supports Enter to submit, and displays actionable errors.
- The desktop launcher supplies the required invitation automatically.
- Fresh accounts start with an empty workspace; example projects, fake tasks, and simulated activity have been removed.
- Windows and macOS downloads include start and stop launchers.
- Registration and saved work are covered by backend and browser regression tests.

To upgrade, stop the old copy, extract this release, copy `.env.desktop` from the old folder if present, then open the new launcher. The existing `syncfly_data` Docker volume is reused. Sign in with your existing account; do not delete the volume.

These downloads are Docker-backed browser applications, not standalone native installers. Docker Desktop must remain running. Accounts and data stay on the host computer. Provider access and billing are separate. Live provider sign-ins and Docker Desktop execution should be verified on your machine; CI verifies the backend with Docker on Linux and tests launcher configuration on Windows and macOS.
