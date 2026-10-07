#!/usr/bin/env python3
"""Build all managed surfaces from a fresh exact committed checkout.

Artifacts and the build receipt stay outside source. No production work occurs.
"""
import argparse
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
    'marketplace': ('amo', 'VITE_MARKETPLACE_ONLY'), 'token': ('credit', 'VITE_TOKEN_ONLY'),
    'wallet': ('wallet', 'VITE_WALLET_ONLY'), 'work': ('work', 'VITE_WORK_TOKEN_ONLY'),
    'infinity': ('infinity', 'VITE_INFINITY_ONLY'), 'inception': ('inception', 'VITE_INCEPTION_ONLY'),
    'activity': ('log', 'VITE_LOG_ONLY'), 'growth': ('growth', 'VITE_GROWTH_ONLY'),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repository', type=Path)
    parser.add_argument('commit')
    parser.add_argument('build_root', type=Path)
    parser.add_argument('--release-id')
    args = parser.parse_args()
    os.umask(0o077)
    repo = args.repository.resolve(strict=True)
    assert re.fullmatch('[0-9a-f]{40}', args.commit)
    root = args.build_root
    assert root.is_absolute() and root.resolve() == root and str(root).startswith('/tmp/')
    assert not root.exists() and not root.is_symlink()
    release = args.release_id or args.commit[:12] + '-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    assert re.fullmatch('[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', release) and release.startswith(args.commit[:12] + '-')
    subprocess.run(['git', '-C', str(repo), 'cat-file', '-e', args.commit + '^{commit}'], check=True)
    root.mkdir(mode=0o700)
    source = root / ('proofofwork-ui-source-' + release)
    payload = root / ('proofofwork-ui-surfaces-' + release)
    (payload / 'surfaces').mkdir(parents=True, mode=0o755)
    home = root / 'build-home'; home.mkdir(mode=0o700)
    env = {'HOME': str(home), 'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}
    subprocess.run(['git', 'clone', '--quiet', '--no-hardlinks', '--no-local', str(repo), str(source)], check=True, env=env)
    subprocess.run(['git', '-C', str(source), 'checkout', '--quiet', '--detach', args.commit], check=True, env=env)
    def git(*arguments):
        return subprocess.check_output(['git', '-C', str(source), *arguments], env=env, text=True).strip()
    assert git('rev-parse', 'HEAD') == args.commit
    tree = git('rev-parse', 'HEAD^{tree}')
    with (root / 'build.log').open('xb') as log:
        subprocess.run(['/usr/bin/npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
        assert not git('status', '--porcelain', '--untracked-files=all')
        for name, (host, switch) in SURFACES.items():
            build_env = {**env, 'VITE_POW_API_BASE': 'https://' + host + '.proofofwork.me'}
            if switch: build_env[switch] = '1'
            subprocess.run(['/usr/bin/npm', 'run', 'build', '--', '--outDir', str(payload / 'surfaces' / name), '--emptyOutDir'], cwd=source, env=build_env, stdout=log, stderr=subprocess.STDOUT, check=True)
            print(json.dumps({'surface': name, 'status': 'built'}), flush=True)
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
        archive = root / (directory.name + '.tgz')
        with tarfile.open(archive, 'x:gz', dereference=False) as output:
            output.add(directory, arcname=directory.name)
        with archive.open('rb') as data: sha = hashlib.file_digest(data, 'sha256').hexdigest()
        bundles[kind] = {'path': str(archive), 'bytes': archive.stat().st_size, 'sha256': sha}
    receipt = {'releaseId': release, 'commit': args.commit, 'tree': tree,
               'sourceAllocatedBytes': allocated, 'bundles': bundles,
               'sourceCheckout': str(source), 'surfaces': [*SURFACES, 'nft']}
    with (root / 'build-receipt.json').open('xb') as output:
        output.write((json.dumps(receipt, indent=2) + '\n').encode()); output.flush(); os.fsync(output.fileno())
    print(json.dumps(receipt), flush=True)


if __name__ == '__main__':
    main()
