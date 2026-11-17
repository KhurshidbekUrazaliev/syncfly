#!/usr/bin/env python3
"""Build desktop launcher archives from an explicit source allowlist."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib

root = Path(__file__).resolve().parent.parent
out = root / 'release'
out.mkdir(exist_ok=True)
common = ['server.mjs', 'cloud.mjs', 'package.json', 'Dockerfile', 'Dockerfile.runner',
          'compose.desktop.yaml', '.dockerignore', 'README.md', 'docs/deployment.md',
          'docs/architecture.md']
common += [str(p.relative_to(root)) for p in (root / 'dist').rglob('*') if p.is_file()]
checksums = []
for platform, launchers in {
    'Windows': ['Start Syncfly.cmd', 'Stop Syncfly.cmd', 'scripts/windows.ps1'],
    'macOS': ['Start Syncfly.command', 'Stop Syncfly.command', 'scripts/macos.sh'],
}.items():
    archive = out / f'Syncfly-{platform}.zip'
    with ZipFile(archive, 'w', ZIP_DEFLATED) as z:
        for name in sorted(common + launchers):
            info = ZipInfo.from_file(root / name, arcname=f'Syncfly/{name}')
            info.create_system = 3
            info.external_attr = (0o100755 if name.endswith(('.command', '.sh')) else 0o100644) << 16
            info.compress_type = ZIP_DEFLATED
            z.writestr(info, (root / name).read_bytes())
        z.writestr('Syncfly/START HERE.txt', f'''SYNCFLY — {platform}

1. Install and start Docker Desktop for your computer.
2. Extract this entire ZIP. Do not run the launcher inside the ZIP viewer.
3. Open Start Syncfly.{"cmd" if platform == "Windows" else "command"}.
4. Wait for the first build. Your browser opens with the setup code supplied.
5. Create your Syncfly account, then create a project and connect an AI provider.

Stop Syncfly stops the containers and keeps your data.
On macOS, if the launcher cannot be opened, use Terminal in this folder:
    bash scripts/macos.sh Start
On Windows, if double-clicking is blocked, use PowerShell in this folder:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\windows.ps1

UPGRADING
Stop the old copy first. Extract this release to a new folder, then copy your
existing .env.desktop into it if present. Open the new Start Syncfly launcher.
The existing syncfly_data Docker volume is reused; accounts and projects stay.
Do not delete that volume. Sign in with your existing account if you made one.

This is a Docker-backed browser application, not a standalone native installer.
Docker Desktop must stay running. AI provider subscriptions/billing are separate.
Data stays on the computer running Syncfly; it does not sync between computers.
See README.md and docs/deployment.md for more details.
''')
    checksums.append(f'{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}')
    print(archive.name)
(out / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n')
