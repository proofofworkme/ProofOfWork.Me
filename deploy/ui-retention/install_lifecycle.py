#!/usr/bin/env python3
"""Plan/install one exact committed private UI lifecycle package.

The install is creation-only. Existing helpers, packages, holds, monitor bytes
and timers are fenced and preserved. A partial installation is never retried.
"""
import argparse
import base64
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SSH = ['ssh', '-i', '/home/sixer/.ssh/proofofwork_me_ed25519', '-o', 'BatchMode=yes',
       '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
       'root@77.42.91.106']
CONFIG = '/etc/proofofwork-retention/ui-lifecycle.json'
STATE = '/var/lib/proofofwork-ui-retention/state.json'
CUSTODY = '/home/sixer/ProofOfWork.Me.release-custody-ui-retention'
EVIDENCE = '/var/backups/proofofwork-ui/cleanup-evidence'
APPROVAL = 'df166edb2d9817dd4f8af24819880b6bf08b396b6aa483adaa141415fc709379'
FILES = (
    'audits/2026-10-16-ui-retention-repair-approval.json',
    'audits/2026-10-16-ui-retention-repair-proposal.json',
    'deploy/audit30/ui-storage.py', 'deploy/audit30/ui-release-policy.py',
    'deploy/proofofwork-ui-verified-retention.py',
    'deploy/ui-retention/custody.py', 'deploy/ui-retention/inventory.py',
    'deploy/ui-retention/removal.py', 'deploy/ui-retention/lifecycle_remote.py',
    'deploy/ui-retention/install_lifecycle.py', 'deploy/ui-retention/lifecycle.py',
)


def require(ok, message):
    if not ok:
        raise ValueError(message)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def safe(path, directory=False):
    path = Path(path)
    info = path.lstat()
    require(path.resolve() == path and info.st_uid == os.geteuid() and not info.st_mode & 0o7022
            and (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)),
            'Unsafe installation path: ' + str(path))
    return info


def file_record(path):
    path = Path(path)
    before = safe(path)
    require(before.st_size <= 2 * 1024**2 and before.st_nlink == 1, 'Oversized or linked guard file')
    raw = path.read_bytes()
    require(path.lstat() == before, 'Guard file changed')
    return dict(sha256=sha(raw), bytes=len(raw), mode=stat.S_IMODE(before.st_mode),
                uid=before.st_uid, gid=before.st_gid, inode=before.st_ino,
                device=before.st_dev, mtimeNs=before.st_mtime_ns, ctimeNs=before.st_ctime_ns)


def guard_inventory(prefix=Path('/')):
    def at(path):
        return prefix / path.lstrip('/')
    names = set(at('/usr/local/sbin').glob('proofofwork-ui-*'))
    names.add(at('/usr/local/sbin/proofofwork-retention-protection'))
    names.update(at('/etc/proofofwork-retention').glob('*'))
    names.discard(at(CONFIG))
    files = {str(path): file_record(path) for path in sorted(names) if path.is_file() and not path.is_symlink()}
    require(str(at('/usr/local/sbin/proofofwork-ui-capacity')) in files, 'Installed capacity guard missing')
    units = {}
    for pattern in ('proofofwork-ui-*', 'proofofwork-retention-protection*'):
        for path in sorted(at('/etc/systemd/system').glob(pattern)):
            info = path.lstat()
            require(info.st_uid == os.geteuid(), 'Foreign systemd owner')
            if path.is_symlink():
                units[str(path)] = dict(target=os.readlink(path), inode=info.st_ino,
                                        device=info.st_dev, uid=info.st_uid, gid=info.st_gid,
                                        mtimeNs=info.st_mtime_ns, ctimeNs=info.st_ctime_ns)
            elif path.is_file():
                units[str(path)] = file_record(path)
            else:
                require(path.is_dir(), 'Unexpected systemd entry')
                for child in sorted(path.iterdir()):
                    units[str(child)] = file_record(child)
    for name in ('proofofwork-ui-release-prune.timer', 'proofofwork-ui-storage-prune.timer'):
        require(units.get(str(at('/etc/systemd/system') / name), {}).get('target') == '/dev/null',
                'Broad prune timer mask differs')
    manifest = at('/var/www/.proofofwork-ui-release')
    fields = dict(line.split('=', 1) for line in manifest.read_text().splitlines())
    require(re.fullmatch(r'[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z', fields.get('release_id', '')),
            'Malformed current release ID')
    prior = at('/var/backups/proofofwork-ui/rollback-roots') / ('proofofwork-www-pre-' + fields['release_id']) / '.proofofwork-ui-release'
    return {'files': files, 'units': units, 'currentManifest': file_record(manifest),
            'previousManifest': file_record(prior), 'releaseId': fields['release_id'],
            'existingPackages': sorted(p.name for p in at(EVIDENCE).glob('*tools-*') if p.is_dir()),
            'configAbsent': not os.path.lexists(at(CONFIG)), 'stateAbsent': not os.path.lexists(at(STATE))}


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def save(path, raw):
    safe(path.parent, True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    sync(path.parent)


def committed_payload(root=ROOT):
    def git(*args):
        return subprocess.check_output(['git', '-C', str(root), *args])
    require(not git('status', '--porcelain', '--untracked-files=no'), 'Commit reviewed tracked changes before packaging')
    commit = git('rev-parse', 'HEAD').decode().strip()
    tree = git('rev-parse', 'HEAD^{tree}').decode().strip()
    files = {}
    for path in FILES:
        raw = git('show', commit + ':' + path)
        require(raw == (root / path).read_bytes(), 'Package file differs from committed source: ' + path)
        files[path] = {'base64': base64.b64encode(raw).decode(), 'sha256': sha(raw), 'bytes': len(raw)}
    require(files[FILES[0]]['sha256'] == APPROVAL, 'Repair approval bytes differ')
    manifest = {'schema': 'pow-ui-retention-package-v1', 'sourceCommit': commit, 'sourceTree': tree,
                'files': {p: {'sha256': v['sha256'], 'bytes': v['bytes']} for p, v in files.items()}}
    package_sha = sha(encoded(manifest))
    package = EVIDENCE + '/ui-lifecycle-tools-' + package_sha
    config = {'schema': 'pow-ui-retention-lifecycle-config-v1', 'scopeApprovalSha256': APPROVAL,
              'sourceCommit': commit, 'sourceTree': tree, 'package': {'path': package, 'sha256': package_sha},
              'controller': {'path': package + '/deploy/ui-retention/lifecycle_remote.py',
                             'sha256': files['deploy/ui-retention/lifecycle_remote.py']['sha256']},
              'approval': {'path': package + '/' + FILES[0], 'sha256': APPROVAL},
              'statePath': STATE, 'offHostCustodyRoot': CUSTODY}
    return {'manifest': manifest, 'files': files, 'config': config, 'configSha256': sha(encoded(config))}


def validate_payload(payload):
    manifest = payload['manifest']
    require(set(payload['files']) == set(FILES) == set(manifest['files']), 'Expanded package file scope')
    require(manifest['schema'] == 'pow-ui-retention-package-v1'
            and re.fullmatch('[0-9a-f]{40}', manifest['sourceCommit'])
            and re.fullmatch('[0-9a-f]{40}', manifest['sourceTree']), 'Invalid package source identity')
    for relative, value in payload['files'].items():
        raw = base64.b64decode(value['base64'], validate=True)
        require(len(raw) <= 2 * 1024**2 and len(raw) == value['bytes']
                and sha(raw) == value['sha256'] and manifest['files'][relative] ==
                {'sha256': value['sha256'], 'bytes': value['bytes']}, 'Package file binding differs')
    config = payload['config']
    package_sha = sha(encoded(manifest))
    package = EVIDENCE + '/ui-lifecycle-tools-' + package_sha
    expected = {'schema': 'pow-ui-retention-lifecycle-config-v1', 'scopeApprovalSha256': APPROVAL,
                'sourceCommit': manifest['sourceCommit'], 'sourceTree': manifest['sourceTree'],
                'package': {'path': package, 'sha256': package_sha},
                'controller': {'path': package + '/deploy/ui-retention/lifecycle_remote.py',
                               'sha256': manifest['files']['deploy/ui-retention/lifecycle_remote.py']['sha256']},
                'approval': {'path': package + '/' + FILES[0], 'sha256': APPROVAL},
                'statePath': STATE, 'offHostCustodyRoot': CUSTODY}
    require(config == expected and sha(encoded(config)) == payload['configSha256']
            and payload['files'][FILES[0]]['sha256'] == APPROVAL, 'Expanded or unbound lifecycle configuration')


def install_remote(plan, prefix=Path('/')):
    require(os.geteuid() == 0 or prefix != Path('/'), 'Production installer requires root')
    require(plan.get('schema') == 'pow-ui-retention-install-plan-v1'
            and plan.get('scopeApprovalSha256') == APPROVAL, 'Install plan authority differs')
    os.umask(0o077)
    payload = plan['payload']
    validate_payload(payload)
    def at(path):
        return prefix / path.lstrip('/')
    lock = at('/run/proofofwork-ui/deploy.lock')
    before = safe(lock)
    require(before.st_nlink == 1, 'Linked deployment lock')
    fd = os.open(lock, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        require(os.fstat(fd) == before, 'Deployment lock changed')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(guard_inventory(prefix) == plan['before'], 'Installation guard/pair changed after review')
        require(plan['before']['configAbsent'] and plan['before']['stateAbsent'],
                'Existing lifecycle requires explicit upgrade reconciliation')
        package = at(payload['config']['package']['path'])
        receipt = at(EVIDENCE) / ('ui-lifecycle-install-' + payload['config']['package']['sha256'])
        require(not os.path.lexists(package) and not os.path.lexists(receipt),
                'Prior package or install intent requires explicit reconciliation')
        allocation = max(8 * 1024**2, sum(v['bytes'] for v in payload['files'].values()) * 4)
        subprocess.run(['/usr/bin/python3', '-I', '-B', str(at('/usr/local/sbin/proofofwork-ui-capacity')),
                        'check', '--path', str(at(EVIDENCE)), '--additional-bytes', str(allocation),
                        '--additional-inodes', '128', '--phase', 'ui-lifecycle-install'],
                       check=True, capture_output=True, timeout=60)
        receipt.mkdir(mode=0o700)
        sync(receipt.parent)
        save(receipt / 'intent.json', encoded(plan))
        package.mkdir(mode=0o700)
        sync(package.parent)
        for relative, value in payload['files'].items():
            path = package / relative
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            save(path, base64.b64decode(value['base64'], validate=True))
        save(package / 'package.json', encoded(payload['manifest']))
        for relative, value in payload['files'].items():
            require(file_record(package / relative)['sha256'] == value['sha256'], 'Installed package differs')
        current = guard_inventory(prefix)
        current['existingPackages'] = [p for p in current['existingPackages'] if p != package.name]
        require(current == plan['before'], 'Existing helpers/holds/timers changed during installation')
        state_parent = at(STATE).parent
        if not state_parent.exists():
            state_parent.mkdir(mode=0o700)
            sync(state_parent.parent)
        safe(state_parent, True)
        save(at(CONFIG), encoded(payload['config']))
        result = {'ok': True, 'sourceCommit': payload['manifest']['sourceCommit'],
                  'sourceTree': payload['manifest']['sourceTree'], 'package': payload['config']['package'],
                  'config': {'path': CONFIG, 'sha256': payload['configSha256']},
                  'controller': payload['config']['controller'], 'priorHelpersHoldsAndTimersPreserved': True,
                  'bootstrapRequired': True, 'retentionComplete': False}
        save(receipt / 'completed.json', encoded(result))
        return dict(result, receipt={'path': str(receipt / 'completed.json'), 'sha256': sha(encoded(result))})
    finally:
        os.close(fd)


def remote(operation, value=None):
    source = Path(__file__).read_text()
    # Only this reviewed committed module is executed. The request is decoded as
    # data; it is never interpolated as shell text or executable Python.
    code = source.rsplit("if __name__ == '__main__':", 1)[0]
    code += '\nvalue=json.loads(base64.b64decode(' + repr(base64.b64encode(encoded(value)).decode()) + '))\n'
    code += 'result=guard_inventory()\n' if operation == 'inventory' else 'result=install_remote(value)\n'
    code += 'sys.stdout.buffer.write(encoded(result))\n'
    # __file__ is not meaningful in a streamed installer; ROOT is unused remotely.
    code = "__file__='/tmp/ui-lifecycle-installer/deploy/ui-retention/install_lifecycle.py'\n" + code
    result = subprocess.run([*SSH, 'python3 -I -B -'], input=code.encode(), capture_output=True, timeout=180)
    if result.returncode:
        sys.stderr.buffer.write(result.stderr)
        raise ValueError('Remote lifecycle ' + operation + ' refused')
    return json.loads(result.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='operation', required=True)
    prepare = sub.add_parser('plan')
    prepare.add_argument('--output', type=Path, required=True)
    install = sub.add_parser('install')
    install.add_argument('--plan', type=Path, required=True)
    install.add_argument('--plan-sha256', required=True)
    args = parser.parse_args()
    if args.operation == 'plan':
        payload = committed_payload()
        plan = {'schema': 'pow-ui-retention-install-plan-v1', 'scopeApprovalSha256': APPROVAL,
                'payload': payload, 'before': remote('inventory')}
        require(plan['before']['configAbsent'] and plan['before']['stateAbsent'], 'Existing lifecycle configuration')
        with args.output.open('xb') as stream:
            stream.write(encoded(plan))
        print(json.dumps({'plan': str(args.output), 'sha256': sha(encoded(plan)),
                          'config': {'path': CONFIG, 'sha256': payload['configSha256']}}))
    else:
        raw = args.plan.read_bytes()
        require(sha(raw) == args.plan_sha256, 'Reviewed install plan SHA differs')
        plan = json.loads(raw)
        require(plan.get('schema') == 'pow-ui-retention-install-plan-v1'
                and plan.get('scopeApprovalSha256') == APPROVAL, 'Install plan authority differs')
        require(committed_payload() == plan['payload'], 'Committed package changed after review')
        print(json.dumps(remote('install', plan)))


if __name__ == '__main__':
    main()
