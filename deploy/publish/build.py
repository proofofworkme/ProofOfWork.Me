#!/usr/bin/env python3
"""Build all managed surfaces from a fresh exact committed checkout.

Artifacts and the build receipt stay outside source. No production work occurs.
"""
import argparse
import fcntl
import shutil
import stat
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile

SURFACES = {
    'landing': ('www', 'VITE_LANDING_ONLY'), 'id': ('id', 'VITE_ID_LAUNCH_ONLY'),
    'dns': ('dns', 'VITE_DNS_LAUNCH_ONLY'), 'computer': ('computer', None),
    'desktop': ('desktop', 'VITE_DESKTOP_ONLY'), 'browser': ('browser', 'VITE_BROWSER_ONLY'),
    'boost': ('boost', 'VITE_BOOST_ONLY'), 'publish': ('publish', 'VITE_PUBLISH_ONLY'),
    'search': ('search', 'VITE_SEARCH_ONLY'), 'code': ('code', 'VITE_CODE_ONLY'),
    'jobs': ('jobs', 'VITE_JOBS_ONLY'),
    'marketplace': ('amo', 'VITE_MARKETPLACE_ONLY'), 'token': ('credit', 'VITE_TOKEN_ONLY'),
    'wallet': ('wallet', 'VITE_WALLET_ONLY'), 'work': ('work', 'VITE_WORK_TOKEN_ONLY'),
    'infinity': ('infinity', 'VITE_INFINITY_ONLY'), 'inception': ('inception', 'VITE_INCEPTION_ONLY'),
    'activity': ('log', 'VITE_LOG_ONLY'), 'growth': ('growth', 'VITE_GROWTH_ONLY'),
}
PAGES_SURFACES = {**SURFACES, 'pages': ('pages', 'VITE_PAGES_ONLY')}
PERMISSION_SURFACES = {**PAGES_SURFACES, 'permission': ('permission', 'VITE_PERMISSION_ONLY')}


# Admission is not a filesystem quota. Keep failed runs for inspection; refuse
# another build when retained output exhausts this budget rather than age-delete.
BUILD_PARENT = Path('/data/proofofwork-ui-builds')
DATA_RESERVE = 100 * 1024**3
BUILD_BUDGET = 4 * 1024**3
RETAINED_BUDGET = 20 * 1024**3


def validate_build_root(root):
    if (not root.is_absolute() or root.parent != BUILD_PARENT
            or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', root.name)
            or root.resolve() != root or root.exists() or root.is_symlink()):
        raise ValueError('Build requires a new canonical /data/proofofwork-ui-builds child')
    parent = BUILD_PARENT
    if not parent.is_dir() or parent.resolve() != parent:
        raise ValueError('Provision canonical /data/proofofwork-ui-builds first')
    info = parent.stat()
    if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o7022:
        raise ValueError('Build parent must be owner-controlled without group/world write')
    if info.st_dev == Path('/').stat().st_dev:
        raise ValueError('Build parent must not use the root filesystem')


def check_build_capacity(root):
    free = shutil.disk_usage(BUILD_PARENT).free
    used = int(subprocess.check_output(
        ['du', '--summarize', '--block-size=1', '--one-file-system', str(BUILD_PARENT)],
        text=True).split()[0])
    current = 0 if not root.exists() else int(subprocess.check_output(
        ['du', '--summarize', '--block-size=1', '--one-file-system', str(root)],
        text=True).split()[0])
    remaining = max(0, BUILD_BUDGET - current)
    if free < DATA_RESERVE + remaining or used + remaining > RETAINED_BUDGET or current > BUILD_BUDGET:
        raise ValueError('Build storage admission refused; preserve evidence and review retained runs')


def build_focused_surfaces(source, payload, surfaces, environment, log):
    """TypeScript source is shared; each focused Vite bundle has its own flags."""
    node = environment.get('POW_UI_BUILD_NODE', '/usr/bin/node')
    subprocess.run([node, str(source / 'node_modules/typescript/bin/tsc')],
                   cwd=source, env=environment, stdout=log, stderr=subprocess.STDOUT, check=True)
    for name, (host, switch) in surfaces.items():
        if environment.get('TMPDIR'):
            check_build_capacity(payload.parent)
        build_env = {**environment, 'VITE_POW_API_BASE': 'https://' + host + '.proofofwork.me'}
        if switch:
            build_env[switch] = '1'
        subprocess.run([node, str(source / 'node_modules/vite/bin/vite.js'), 'build',
                        '--outDir', str(payload / 'surfaces' / name), '--emptyOutDir'],
                       cwd=source, env=build_env, stdout=log, stderr=subprocess.STDOUT, check=True)
        print(json.dumps({'surface': name, 'status': 'built'}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repository', type=Path)
    parser.add_argument('commit')
    parser.add_argument('build_root', type=Path)
    parser.add_argument('--release-id')
    parser.add_argument('--node-executable', type=Path, default=Path('/usr/bin/node'),
                        help='Supported Node runtime on the build VPS')
    parser.add_argument('--release-format', choices=['v3', 'v4', 'v5'], default='v5')
    args = parser.parse_args()
    surfaces = PERMISSION_SURFACES if args.release_format == 'v5' else PAGES_SURFACES if args.release_format == 'v4' else SURFACES
    os.umask(0o077)
    repo = args.repository.resolve(strict=True)
    assert re.fullmatch('[0-9a-f]{40}', args.commit)
    root = args.build_root
    validate_build_root(root)
    # One builder at a time; retain this descriptor for the entire run.
    lock = os.open(BUILD_PARENT / '.build.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    check_build_capacity(root)
    release = args.release_id or args.commit[:12] + '-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    assert re.fullmatch('[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', release) and release.startswith(args.commit[:12] + '-')
    subprocess.run(['git', '-C', str(repo), 'cat-file', '-e', args.commit + '^{commit}'], check=True)
    root.mkdir(mode=0o700)
    source = root / ('proofofwork-ui-source-' + release)
    payload = root / ('proofofwork-ui-surfaces-' + release)
    (payload / 'surfaces').mkdir(parents=True, mode=0o755)
    home = root / 'build-home'; home.mkdir(mode=0o700)
    temporary = root / 'tmp'; temporary.mkdir(mode=0o700)
    node = args.node_executable.resolve(strict=True)
    assert node.is_file() and os.access(node, os.X_OK) and not node.stat().st_mode & 0o7022
    version = subprocess.check_output([str(node), '--version'], text=True).strip()
    match = re.fullmatch(r'v(\d+)\.(\d+)\.(\d+)', version)
    assert match, 'Unrecognized Node version'
    major, minor, patch = map(int, match.groups())
    assert major == 20 and minor >= 19 or major == 22 and minor >= 12 or major > 22, 'Unsupported build Node version'
    env = {'HOME': str(home), 'PATH': str(node.parent) + ':/usr/bin:/bin',
           'LANG': 'C.UTF-8', 'POW_UI_BUILD_NODE': str(node), 'TMPDIR': str(temporary)}
    subprocess.run(['git', 'clone', '--quiet', '--no-hardlinks', '--no-local', str(repo), str(source)], check=True, env=env)
    subprocess.run(['git', '-C', str(source), 'checkout', '--quiet', '--detach', args.commit], check=True, env=env)
    def git(*arguments):
        return subprocess.check_output(['git', '-C', str(source), *arguments], env=env, text=True).strip()
    assert git('rev-parse', 'HEAD') == args.commit
    tree = git('rev-parse', 'HEAD^{tree}')
    check_build_capacity(root)
    with (root / 'build.log').open('xb') as log:
        subprocess.run(['/usr/bin/npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
        assert not git('status', '--porcelain', '--untracked-files=all')
        check_build_capacity(root)
        build_focused_surfaces(source, payload, surfaces, env, log)
        check_build_capacity(root)
    subprocess.run(['cp', '--archive', str(payload / 'surfaces/computer'), str(payload / 'surfaces/nft')], check=True)
    for path in [payload, *payload.rglob('*')]:
        assert not path.is_symlink()
        path.chmod(0o755 if path.is_dir() else 0o644)
    subprocess.run(['chmod', '--recursive', 'go-w', str(source)], check=True)
    assert git('rev-parse', 'HEAD') == args.commit and git('rev-parse', 'HEAD^{tree}') == tree
    assert not git('status', '--porcelain', '--untracked-files=all')
    allocated = int(subprocess.check_output(['du', '--summarize', '--block-size=1', str(source)], text=True).split()[0])
    assert 0 < allocated <= 1024**3
    bundles = {}
    for kind, directory in [('source', source), ('surfaces', payload)]:
        check_build_capacity(root)
        archive = root / (directory.name + '.tgz')
        with tarfile.open(archive, 'x:gz', dereference=False) as output:
            output.add(directory, arcname=directory.name)
        with archive.open('rb') as data: sha = hashlib.file_digest(data, 'sha256').hexdigest()
        bundles[kind] = {'path': str(archive), 'bytes': archive.stat().st_size, 'sha256': sha}
    check_build_capacity(root)
    receipt = {'releaseId': release, 'commit': args.commit, 'tree': tree,
               'sourceAllocatedBytes': allocated, 'bundles': bundles,
               'sourceCheckout': str(source), 'surfaces': [*surfaces, 'nft'],
               'releaseFormat': 'proofofwork-ui-release-' + args.release_format}
    with (root / 'build-receipt.json').open('xb') as output:
        output.write((json.dumps(receipt, indent=2) + '\n').encode()); output.flush(); os.fsync(output.fileno())
    print(json.dumps(receipt), flush=True)


if __name__ == '__main__':
    main()
