#!/usr/bin/env python3
"""Generate private deployment configuration without printing its invitation code."""
import argparse
import os
from pathlib import Path
import re
import secrets

parser = argparse.ArgumentParser(description='Configure a Syncfly pilot on a Linux Docker host.')
parser.add_argument('--domain', required=True, help='Public hostname with DNS pointing to this server')
parser.add_argument('--data-dir', default='/opt/syncfly/data', help='Absolute directory on this Docker host')
args = parser.parse_args()
domain = args.domain.lower().strip()
if not re.fullmatch(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', domain):
    parser.error('Use a hostname such as app.example.com, without https:// or a path.')
data = Path(args.data_dir)
if not data.is_absolute() or not re.fullmatch(r'/[a-zA-Z0-9_./-]+', str(data)) or '..' in data.parts:
    parser.error('Use an absolute data path without spaces or parent-directory segments.')
root = Path(__file__).resolve().parent.parent
# Refuse overwriting existing credentials or deployment identity.
config = root / '.env'
content = '\n'.join([
    'SYNCFLY_DOMAIN=' + domain,
    'RELAY_HOST_DATA_DIR=' + str(data),
    'RELAY_PUBLIC_URL=https://' + domain,
    'RELAY_ALLOW_SIGNUP=false',
    'RELAY_INVITE_CODE=' + secrets.token_urlsafe(32),
    '',
])
try:
    fd = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    parser.error('.env already exists; edit it deliberately instead of replacing credentials.')
with os.fdopen(fd, 'w') as file:
    file.write(content)
print('Wrote private configuration to ' + str(config))
print('Keep the invitation code in that file private. It is required for initial account creation.')
print('Create the host data directory, then run scripts/deploy.sh on the Linux Docker host.')
