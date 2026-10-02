#!/usr/bin/python3 -I
"""Install the two exact Audit30 retention-monitor files; preserve rollback bytes."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys

ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'}
APPROVAL_SHA256 = 'd99a40236b49b1735c794fb853c4f7f4f0724da8e3f83fab75c7464e0e8ee373'
SCOPE_SHA256 = 'f0027078971b7521fb2411e15bd8931b110a0f1815ea7e04bdaed3b5d4bdfdd0'
UI_DEADLINE_APPROVAL_SHA256 = 'b630bcb42bea4af4ad3fe3ac7cce0bb64b0dbb4acdc6bf58b22f1f6d16d4bdf2'
UI_60_SECOND_UNIT_SHA256 = '14426a6092ca97ab3c3e05e2030cc99912ed03afbbc899a03cafb33960622ea5'
UI_20_SECOND_UNIT_SHA256 = '60776c973e416ed2dbd7eff744e02ddb90bbbdd353d4fbc9c18fbd707cd9bca4'
NODE_20_SECOND_UNIT_SHA256 = '8f9c54b522961e26d8f02ed33ad065af70906f1e95ca2ad65edd322c8f758448'
HEX = re.compile(r'[0-9a-f]{64}')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def identity(row):
    return (row.st_dev, row.st_ino, row.st_mode, row.st_uid, row.st_gid,
            row.st_size, row.st_mtime_ns, row.st_ctime_ns)


def read_safe(path, limit=2 * 1024**2):
    before = path.lstat()
    assert stat.S_ISREG(before.st_mode) and before.st_uid == before.st_gid == 0
    assert not before.st_mode & 0o7022 and path.resolve() == path and before.st_size <= limit
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
    with os.fdopen(descriptor, 'rb') as stream:
        opened = os.fstat(stream.fileno())
        raw = stream.read(limit + 1)
        final = os.fstat(stream.fileno())
    assert identity(before) == identity(opened) == identity(final) == identity(path.lstat())
    assert len(raw) == before.st_size
    return raw, before


def directory(path):
    for part in (path, *path.parents):
        row = part.lstat()
        assert stat.S_ISDIR(row.st_mode) and row.st_uid == row.st_gid == 0
        assert not row.st_mode & 0o7022 and part.resolve() == part


def run(args):
    result = subprocess.run(args, env=ENV, stdin=subprocess.DEVNULL,
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, 'Reviewed operation failed: ' + args[0]
    return result.stdout.strip()


def states(names):
    return {name: dict(line.split('=', 1) for line in run(
        ['systemctl', 'show', name, '-p', 'LoadState', '-p', 'ActiveState',
         '-p', 'MainPID', '-p', 'UnitFileState']).splitlines() if '=' in line)
        for name in names}


def exclusive(path, raw, mode=0o600):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(path, mode)
    parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def replace(path, raw, mode, token):
    temporary = path.parent / ('.' + path.name + '.audit30-' + token)
    exclusive(temporary, raw, mode)
    os.replace(temporary, path)
    parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def mapping(role):
    return {
        'scripts/check-retention-protection.py': '/usr/local/sbin/proofofwork-retention-protection',
        'deploy/proofofwork-retention-protection-' + role + '.service':
            '/etc/systemd/system/proofofwork-retention-protection.service',
    }


def validate_manifest(manifest, role):
    assert manifest.get('schema') == 'proof-of-work-audit30-retention-install-v1'
    assert manifest.get('role') == role
    assert manifest.get('approvalSha256') == APPROVAL_SHA256
    assert manifest.get('scopeSha256') == SCOPE_SHA256
    assert set(manifest.get('files', {})) == set(mapping(role)), 'Installation scope expanded'
    assert HEX.fullmatch(manifest.get('holdSha256', ''))
    for row in manifest['files'].values():
        assert set(row) == {'sha256', 'previousSha256', 'previousMode'}
        assert HEX.fullmatch(row['sha256']) and HEX.fullmatch(row['previousSha256'])
        assert isinstance(row['previousMode'], int) and not row['previousMode'] & 0o7022


def reconcile(installed, before, new, token):
    for destination in reversed(installed):
        target = Path(destination)
        raw, details = read_safe(target)
        old = before[destination]
        if raw == old['bytes'] and stat.S_IMODE(details.st_mode) == old['mode']:
            continue
        assert raw == new[destination]['bytes'], 'Unknown installed bytes require review'
        replace(target, old['bytes'], old['mode'], token + '-restore')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--role', choices=('ui', 'node'), required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--approval', type=Path, required=True)
    parser.add_argument('--scope', type=Path, required=True)
    parser.add_argument('--ui-deadline-approval', type=Path)
    parser.add_argument('--receipt-root', type=Path, required=True)
    args = parser.parse_args()
    assert sys.flags.isolated and os.geteuid() == 0 and HEX.fullmatch(args.manifest_sha256)
    directory(args.source)
    directory(args.receipt_root)
    approval, _ = read_safe(args.approval)
    scope, _ = read_safe(args.scope)
    assert digest(approval) == APPROVAL_SHA256 and digest(scope) == SCOPE_SHA256
    raw, _ = read_safe(args.manifest)
    assert digest(raw) == args.manifest_sha256
    manifest = json.loads(raw)
    validate_manifest(manifest, args.role)
    hold = Path('/etc/proofofwork-retention/audit28.hold')
    hold_raw, hold_info = read_safe(hold)
    assert digest(hold_raw) == manifest['holdSha256']
    prune = ['proofofwork-ui-release-prune.timer', 'proofofwork-ui-storage-prune.timer'] if args.role == 'ui' else ['proofofwork-node-release-prune.timer']
    authorities = ['caddy.service'] if args.role == 'ui' else [
        'bitcoind.service', 'electrs.service', 'postgresql@16-main.service',
        'proofofwork-api.service', 'proofofwork-indexer-worker.service']
    # Preserve the established backup scheduler and inactive template too;
    # an inactive WAL receiver template is not a running authority daemon.
    protected = authorities + ([] if args.role == 'ui' else [
        'pg_receivewal@16-main.service', 'proofofwork-postgres-logical-backup.timer'])
    baseline = states(protected + prune)
    assert all(baseline[name]['LoadState'] == 'loaded' and baseline[name]['ActiveState'] == 'active'
               and int(baseline[name].get('MainPID', '0')) > 0 for name in authorities), 'Protected service is unhealthy'
    assert all(baseline[name]['LoadState'] == 'masked' and baseline[name]['ActiveState'] == 'inactive' for name in prune)
    lock = Path('/run/proofofwork-ui/deploy.lock') if args.role == 'ui' else Path('/run/proofofwork-audit29-ops.lock')
    read_safe(lock)
    descriptor = os.open(lock, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        monitor = states(['proofofwork-retention-protection.service'])['proofofwork-retention-protection.service']
        assert monitor['MainPID'] == '0' and monitor['ActiveState'] in ('inactive', 'failed'), 'Monitor running; retry after it finishes'
        before, new = {}, {}
        for source, destination in mapping(args.role).items():
            blob, _ = read_safe(args.source / source)
            pinned = manifest['files'][source]
            assert digest(blob) == pinned['sha256']
            if source.endswith('.service'):
                if source == 'deploy/proofofwork-retention-protection-ui.service':
                    assert digest(blob) in (UI_20_SECOND_UNIT_SHA256, UI_60_SECOND_UNIT_SHA256), 'UI unit differs from exact approved bytes'
                elif source == 'deploy/proofofwork-retention-protection-node.service':
                    assert digest(blob) == NODE_20_SECOND_UNIT_SHA256, 'Node unit differs from exact approved bytes'
                if source == 'deploy/proofofwork-retention-protection-ui.service' and digest(blob) == UI_60_SECOND_UNIT_SHA256:
                    assert digest(blob) == UI_60_SECOND_UNIT_SHA256, 'UI deadline unit differs from exact approval'
                    assert manifest.get('uiDeadlineApprovalSha256') == UI_DEADLINE_APPROVAL_SHA256
                    assert args.ui_deadline_approval, 'Separate UI deadline approval is required'
                    deadline_approval, _ = read_safe(args.ui_deadline_approval)
                    assert digest(deadline_approval) == UI_DEADLINE_APPROVAL_SHA256
                else:
                    assert not manifest.get('uiDeadlineApprovalSha256') and args.ui_deadline_approval is None
            target = Path(destination)
            directory(target.parent)
            old, details = read_safe(target)
            assert digest(old) == pinned['previousSha256'] and stat.S_IMODE(details.st_mode) == pinned['previousMode'], 'Installed baseline changed'
            before[destination] = {'bytes': old, 'mode': stat.S_IMODE(details.st_mode), 'identity': identity(details)}
            new[destination] = {'bytes': blob, 'mode': 0o755 if destination.startswith('/usr/local/sbin/') else 0o644}
        receipt = args.receipt_root / ('retention-' + args.role + '-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ'))
        receipt.mkdir(mode=0o700)
        previous = []
        for index, (destination, row) in enumerate(before.items()):
            filename = str(index) + '.previous'
            exclusive(receipt / filename, row['bytes'])
            previous.append({'path': destination, 'backup': filename, 'sha256': digest(row['bytes']), 'mode': row['mode'], 'identity': row['identity']})
        def save(name, value):
            exclusive(receipt / (name + '.json'), (json.dumps(value, indent=2, sort_keys=True) + '\n').encode())
        save('intent', {'status': 'prepared', 'manifestSha256': args.manifest_sha256,
                        'approvalSha256': APPROVAL_SHA256, 'previous': previous, 'baseline': baseline,
                        'uiDeadlineApprovalSha256': manifest.get('uiDeadlineApprovalSha256'),
                        'holdSha256': digest(hold_raw), 'productionDataChanges': False})
        installed = []
        def interrupted(signum, _frame):
            raise InterruptedError('Retention installation interrupted by signal ' + str(signum))
        old_handlers = {number: signal.getsignal(number) for number in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
        for number in old_handlers:
            signal.signal(number, interrupted)
        try:
            for destination, row in new.items():
                current, details = read_safe(Path(destination))
                assert current == before[destination]['bytes'] and identity(details) == before[destination]['identity']
                installed.append(destination)  # Armed before rename, including post-rename fsync failure.
                replace(Path(destination), row['bytes'], row['mode'], receipt.name)
                assert read_safe(Path(destination))[0] == row['bytes']
            run(['systemctl', 'daemon-reload'])
            assert states(protected + prune) == baseline, 'Authority or prune state changed'
            after_hold, after_info = read_safe(hold)
            assert after_hold == hold_raw and identity(after_info) == identity(hold_info)
            save('completed', {'status': 'completed', 'manifestSha256': args.manifest_sha256,
                               'installed': [{'path': path, 'sha256': digest(row['bytes'])} for path, row in new.items()],
                               'authorityAndHoldUnchanged': True, 'monitorRunPerformed': False})
        except BaseException as error:
            for number in old_handlers:
                signal.signal(number, signal.SIG_IGN)
            # Evidence-write failure must never bypass rollback after a rename.
            try:
                save('failure', {'status': 'failed', 'errorClass': type(error).__name__, 'installed': installed})
            except OSError:
                pass
            try:
                reconcile(installed, before, new, receipt.name)
            finally:
                run(['systemctl', 'daemon-reload'])
            raise
        finally:
            for number, handler in old_handlers.items():
                signal.signal(number, handler)
        print(json.dumps({'status': 'completed', 'role': args.role, 'receipt': str(receipt)}))
    finally:
        os.close(descriptor)


if __name__ == '__main__':
    main()
