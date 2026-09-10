#!/usr/bin/env python3
"""Launch the incident verifier with an explicitly pinned Node runtime."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys


def checked(path, digest, owner=0, limit=128 * 1024 * 1024):
    item = Path(path)
    value = item.lstat()
    if (not item.is_absolute() or item.resolve(strict=True) != item or
            not stat.S_ISREG(value.st_mode) or value.st_uid != owner or
            value.st_mode & 0o7022 or value.st_size > limit):
        raise ValueError('Unsafe verifier input path')
    raw = item.read_bytes()
    if hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError('Verifier input digest changed')
    return raw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--manifest-sha256', required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError('Production verifier requires root-owned inputs')
    manifest = json.loads(checked(args.manifest, args.manifest_sha256, limit=1024 * 1024))
    runtime = manifest['nodeBinary']
    module = manifest['verifierModule']
    checked(runtime['path'], runtime['sha256'], runtime['owner'])
    checked(module['path'], module['sha256'], limit=1024 * 1024)
    os.execv(runtime['path'], [runtime['path'], module['path'], '--manifest', args.manifest,
                              '--manifest-sha256', args.manifest_sha256])


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'passed': False, 'error': str(error)}))
        sys.exit(1)
