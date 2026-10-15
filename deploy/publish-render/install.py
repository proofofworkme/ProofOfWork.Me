#!/usr/bin/python3 -I
"""Install only the hash-bound Publish renderer; preserve all old evidence.

The UI publication and Caddy reload are separate existing guarded phases.
No node-host, API, indexer, firewall, database, retention or Caddy mutation.
"""
import argparse
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import socket
import stat
import subprocess
import sys
import tarfile
import time
import urllib.request

SOURCE_FILES = (
    'server/publish-render/reader.mjs', 'server/publish-render/document.mjs',
    'server/publish-render/handler.mjs', 'server/publish-render/server.mjs',
    'src/app/seoMetadata.mjs', 'src/app/publishArticleSeo.mjs',
    'src/shared/protocol/publishArticle.mjs', 'src/shared/protocol/boostText.mjs',
)
SURFACES = set('activity boost browser code computer desktop dns growth id inception infinity jobs landing marketplace nft pages permission publish search token wallet work'.split())
UNIT_NAME = 'proofofwork-publish-render.service'
UNIT_TEMPLATE = 'deploy/publish-render/' + UNIT_NAME
NODE_NAME = 'node-v24.18.0-linux-x64'
NODE_SHA = '55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742'
NODE_ROOT = Path('/opt') / NODE_NAME
ROOT = Path('/opt/proofofwork-publish-render')
UNIT = Path('/etc/systemd/system') / UNIT_NAME
WANTED = Path('/etc/systemd/system/multi-user.target.wants') / UNIT_NAME
ACTIVE = ROOT / 'active.json'
BASE = Path('/var/tmp/proofofwork-deploy')
BACKUPS = Path('/var/backups/proofofwork-ui')
LOCK = Path('/run/proofofwork-ui/deploy.lock')
CAPACITY = Path('/usr/local/sbin/proofofwork-ui-capacity')
RETAINED = Path('/usr/local/sbin/proofofwork-ui-retained-root')
MANIFEST = Path('/var/www/.proofofwork-ui-release')
UI = Path('/var/www/proofofwork-publish')
PROTECTED = (
    CAPACITY, RETAINED, Path('/etc/caddy/Caddyfile'),
    Path('/usr/local/sbin/proofofwork-ui-release-stage'),
    Path('/usr/local/sbin/proofofwork-ui-release-provenance'),
    Path('/usr/local/sbin/proofofwork-ui-release-publish'),
    Path('/usr/local/sbin/proofofwork-ui-verified-retention'),
)
PRUNE = ('proofofwork-ui-release-prune.timer', 'proofofwork-ui-storage-prune.timer')
PROTECTED_UNITS = ('caddy.service', *PRUNE, 'proofofwork-ui-release-provenance.timer')
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'}
HEX40 = re.compile('[0-9a-f]{40}')
HEX64 = re.compile('[0-9a-f]{64}')
RECEIPT_BOUND = 16 * 1024**2


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()


def identity(s):
    return tuple(getattr(s, key) for key in ('st_dev', 'st_ino', 'st_mode', 'st_nlink',
        'st_uid', 'st_gid', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def read_safe(path, limit=2*1024**2, *, shared=False, owner=0):
    path = Path(path); before = path.lstat()
    require(path.is_absolute() and path.resolve(strict=True) == path and
        stat.S_ISREG(before.st_mode) and before.st_uid == before.st_gid == owner and
        (shared or before.st_nlink == 1) and not before.st_mode & 0o7022 and before.st_size <= limit,
        'Unsafe file: ' + str(path))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        require(identity(os.fstat(stream.fileno())) == identity(before), 'File changed before read')
        raw = stream.read(limit+1)
        require(identity(os.fstat(stream.fileno())) == identity(before), 'File changed during read')
    require(identity(path.lstat()) == identity(before) and len(raw) == before.st_size, 'File changed after read')
    return raw


def directory(path):
    s = path.lstat()
    require(path.is_absolute() and path.resolve(strict=True) == path and stat.S_ISDIR(s.st_mode)
        and s.st_uid == s.st_gid == 0 and not s.st_mode & 0o7022, 'Unsafe directory: ' + str(path))


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def mkdir(path, mode=0o755):
    directory(path.parent)
    path.mkdir(mode=mode); os.chmod(path, mode); sync(path); sync(path.parent)


def save(path, raw, mode=0o600):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as output:
        output.write(raw); output.flush(); os.fsync(output.fileno())
    os.chmod(path, mode); sync(path.parent)


def replace(path, raw, token):
    temporary = path.parent / ('.' + path.name + '.publish-render-' + token)
    save(temporary, raw, 0o644)
    os.replace(temporary, path); sync(path.parent)


def run(argv, lock=None, timeout=60):
    env = dict(ENV)
    if lock is not None:
        env['POW_UI_DEPLOY_LOCK_FD'] = str(lock)
    result = subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True, text=True,
        timeout=timeout, env=env, pass_fds=() if lock is None else (lock,))
    require(result.returncode == 0, 'Operation failed: ' + str(argv[0]) + ': ' + result.stderr[-1000:])
    return result.stdout.strip()


def state(name):
    output = run(['/usr/bin/systemctl', 'show', name, '-p', 'LoadState', '-p', 'ActiveState',
        '-p', 'SubState', '-p', 'MainPID', '-p', 'UnitFileState', '-p', 'FragmentPath'], timeout=15)
    return dict(line.split('=', 1) for line in output.splitlines() if '=' in line)


def optional_file(path):
    return None if not os.path.lexists(path) else digest(read_safe(path))


def wanted_target():
    if not os.path.lexists(WANTED):
        return None
    s = WANTED.lstat()
    require(stat.S_ISLNK(s.st_mode) and s.st_uid == s.st_gid == 0 and os.readlink(WANTED) == str(UNIT),
        'Renderer enablement differs')
    return str(UNIT)


def protected_snapshot():
    holds = sorted(Path('/etc/proofofwork-retention').glob('*.hold'))
    require(Path('/etc/proofofwork-retention/audit28.hold') in holds and len(holds) <= 32, 'Retention hold set differs')
    roots = sorted((BACKUPS/'rollback-roots').glob('proofofwork-www-pre-*'))
    require(len(roots) <= 16, 'Too many retained roots')
    files = [*PROTECTED, *holds, MANIFEST, UI/'app.html', UI/'source-provenance.json']
    for root in roots:
        directory(root); files.append(root/'.proofofwork-ui-release')
    result = {'files': {str(p): digest(read_safe(p, shared=True)) for p in files},
              'units': {name: state(name) for name in PROTECTED_UNITS}}
    require(result['units']['caddy.service']['ActiveState'] == 'active', 'Caddy must remain active')
    require(all(result['units'][name]['LoadState'] == 'masked' and
        result['units'][name]['ActiveState'] == 'inactive' for name in PRUNE), 'Prune holds differ')
    return result


def tree_inventory(root, *, max_bytes=512*1024**2, owner=0):
    directory(root)
    rows, total = {}, 0
    pending = [root]
    while pending:
        path = pending.pop(); s = path.lstat()
        require(s.st_uid == s.st_gid == owner and (stat.S_ISLNK(s.st_mode) or not s.st_mode & 0o7022), 'Runtime ownership/mode differs')
        name = str(path.relative_to(root))
        require(len(rows) < 15000 and s.st_dev == root.stat().st_dev, 'Runtime inventory exceeds bound')
        if stat.S_ISDIR(s.st_mode):
            require(path.resolve() == path, 'Runtime directory is a link')
            rows[name] = {'type': 'directory', 'mode': stat.S_IMODE(s.st_mode)}
            pending.extend(sorted(path.iterdir(), reverse=True))
        elif stat.S_ISREG(s.st_mode):
            total += s.st_size; require(total <= max_bytes, 'Runtime bytes exceed bound')
            rows[name] = {'type': 'file', 'mode': stat.S_IMODE(s.st_mode), 'size': s.st_size,
                          'sha256': digest(read_safe(path, max_bytes))}
        elif stat.S_ISLNK(s.st_mode):
            link = os.readlink(path)
            require(not link.startswith('/') and path.resolve().is_relative_to(root), 'Runtime link escapes root')
            rows[name] = {'type': 'symlink', 'target': link}
        else:
            raise ValueError('Unsupported runtime file')
    return rows


def capture():
    require(os.geteuid() == os.getegid() == 0, 'Root capture required')
    renderer = {'unit': optional_file(UNIT), 'active': optional_file(ACTIVE),
                'wanted': wanted_target(), 'state': state(UNIT_NAME)}
    if renderer['active'] is not None:
        manifest = json.loads(read_safe(ACTIVE, 65536)); validate_source_manifest(manifest)
        source = ROOT/'releases'/manifest['commit']
        verify_source(source, manifest)
        require(read_safe(source/'release.json', 65536) == read_safe(ACTIVE, 65536), 'Active manifest differs')
        renderer['manifest'] = manifest
    else:
        require(renderer['unit'] is None and renderer['wanted'] is None and
            renderer['state']['LoadState'] == 'not-found' and renderer['state']['ActiveState'] == 'inactive',
            'Unmanaged renderer already exists')
    return {'format': 'proof-of-work-publish-render-capture-v1',
        'protected': protected_snapshot(), 'renderer': renderer,
        'node': tree_inventory(NODE_ROOT) if os.path.lexists(NODE_ROOT) else None}


def validate_source_manifest(value):
    require(set(value) == {'format', 'commit', 'tree', 'files'} and
        value['format'] == 'proof-of-work-publish-render-source-v1' and
        HEX40.fullmatch(value['commit']) and HEX40.fullmatch(value['tree']) and
        set(value['files']) == set(SOURCE_FILES) and
        all(HEX64.fullmatch(v) for v in value['files'].values()), 'Invalid renderer source manifest')


def verify_source(root, manifest):
    directory(root)
    for name, expected in manifest['files'].items():
        require(digest(read_safe(root/name)) == expected, 'Renderer source differs: ' + name)


def archive_inventory(raw):
    require(digest(raw) == NODE_SHA, 'Official Node archive checksum differs')
    rows, total = {}, 0
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:xz') as archive:
        for member in archive:
            name = member.name.rstrip('/')
            p = PurePosixPath(name)
            require(not p.is_absolute() and p.parts[0] == NODE_NAME and '..' not in p.parts
                and p.as_posix() == name and name not in rows and len(rows) < 15000,
                'Invalid Node archive path')
            require(member.isdir() or member.isfile() or member.issym(), 'Unsupported Node archive member')
            require(member.issym() or not member.mode & 0o7022, 'Unsafe Node archive mode')
            if member.issym():
                target = posixpath.normpath(posixpath.join(posixpath.dirname(name), member.linkname))
                require(not member.linkname.startswith('/') and
                    (target == NODE_NAME or target.startswith(NODE_NAME+'/')), 'Node symlink escapes archive')
            total += member.size
            require(total <= 512*1024**2, 'Node archive too large')
            rows[name] = {'type': 'directory' if member.isdir() else 'file' if member.isfile() else 'symlink',
                'size': member.size, 'mode': member.mode, 'target': member.linkname if member.issym() else None}
            if member.isfile():
                stream = archive.extractfile(member)
                require(stream is not None, 'Missing Node archive content')
                content = stream.read(member.size+1)
                require(len(content) == member.size, 'Node archive content differs')
                rows[name]['sha256'] = digest(content)
    require(rows.get(NODE_NAME, {}).get('type') == 'directory' and
        rows.get(NODE_NAME+'/bin/node', {}).get('type') == 'file', 'Missing Node runtime')
    for name in rows:
        if name != NODE_NAME:
            require(rows.get(str(PurePosixPath(name).parent), {}).get('type') == 'directory',
                'Archive parent missing or symlink')
    allocation = sum(((row['size']+4095)//4096)*4096 + 16384 for row in rows.values())
    return rows, allocation


def expected_node_inventory(rows):
    expected = {}
    for name, row in rows.items():
        relative = '.' if name == NODE_NAME else name[len(NODE_NAME)+1:]
        if row['type'] == 'file':
            expected[relative] = {key: row[key] for key in ('type', 'mode', 'size', 'sha256')}
        elif row['type'] == 'directory':
            expected[relative] = {key: row[key] for key in ('type', 'mode')}
        else:
            expected[relative] = {key: row[key] for key in ('type', 'target')}
    return expected


def install_node(raw, staging, rows):
    mkdir(staging)
    # Precreate only the admitted directory graph. Read xz exactly once: seeking
    # backward for each sorted member would repeatedly decompress the archive.
    for name in sorted(rows, key=lambda name: (len(PurePosixPath(name).parts), name)):
        if rows[name]['type'] == 'directory':
            mkdir(staging/name, rows[name]['mode'])
    seen = set()
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r|xz') as archive:
        for member in archive:
            name = member.name.rstrip('/')
            require(name in rows and name not in seen, 'Node stream inventory differs')
            seen.add(name); row = rows[name]; path = staging/name
            if row['type'] == 'file':
                stream = archive.extractfile(member)
                require(stream is not None, 'Missing Node archive body')
                content = stream.read(row['size']+1)
                require(len(content) == row['size'] and digest(content) == row['sha256'],
                    'Node archive body differs from verified inventory')
                save(path, content, row['mode'])
            elif row['type'] == 'symlink':
                os.symlink(row['target'], path); sync(path.parent)
    require(seen == set(rows), 'Node stream is incomplete')
    require(run([str(staging/NODE_NAME/'bin/node'), '--version']) == 'v24.18.0', 'Node version differs')
    require(not os.path.lexists(NODE_ROOT), 'Node target appeared during install')
    os.rename(staging/NODE_NAME, NODE_ROOT); sync(staging); sync(NODE_ROOT.parent)


def health(expected, ui):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    last = None
    for _ in range(12):
        try:
            with opener.open('http://127.0.0.1:8084/healthz', timeout=2) as response:
                require(response.status == 200, 'Renderer health HTTP status differs')
                raw = response.read(131073)
            require(len(raw) <= 131072, 'Renderer health exceeds bound')
            value = json.loads(raw)
            require(value.get('ok') is True and value.get('commit') == expected['commit'] and
                value.get('tree') == expected['tree'] and value.get('files') == expected['files'] and
                value.get('ui') == ui, 'Renderer health identity differs')
            return value
        except Exception as error:
            last = error; time.sleep(1)
    raise ValueError('Renderer health failed: ' + str(last))


def admit(lock, path, size, inodes, phase):
    return json.loads(run(['/usr/bin/python3', '-I', '-B', str(CAPACITY), 'check', '--path', str(path),
        '--additional-bytes', str(size), '--additional-inodes', str(inodes), '--phase', phase], lock))


def prepare_rollback(before, token):
    prepared = {}
    for label, path in (('unit', UNIT), ('active', ACTIVE)):
        ready = path.parent / ('.'+path.name+'.rollback-'+token)
        failed = path.parent / ('.'+path.name+'.failed-'+token)
        if before[label] is not None:
            save(ready, before[label], 0o644)
        else:
            save(failed, b'', 0o600)
        prepared[label] = {'ready': ready, 'failed': failed}
    failed_wanted = WANTED.parent / ('.'+WANTED.name+'.failed-'+token)
    if before['wanted'] is None:
        save(failed_wanted, b'', 0o600)
    prepared['wanted'] = failed_wanted
    return prepared


def rollback(receipt, before, candidate_unit, candidate_active, prepared):
    """Restore preallocated bytes even after receipt/space failures; never start unknown code."""
    errors = []
    try:
        run(['/usr/bin/systemctl', 'stop', UNIT_NAME])
    except BaseException as error:
        errors.append('stop: ' + str(error))
    for path, previous, candidate, label in (
        (UNIT, before['unit'], candidate_unit, 'unit'),
        (ACTIVE, before['active'], candidate_active, 'active'),
    ):
        try:
            if os.path.lexists(path):
                current = read_safe(path)
                require(current == candidate or previous is not None and current == previous,
                    'Unknown current bytes; refusing rollback: ' + label)
                if current == candidate:
                    if previous is None:
                        require(read_safe(prepared[label]['failed']) == b'', 'Failure slot changed')
                        os.replace(path, prepared[label]['failed'])
                    else:
                        require(read_safe(prepared[label]['ready']) == previous, 'Rollback-ready bytes changed')
                        os.replace(prepared[label]['ready'], path)
                    sync(path.parent)
            elif previous is not None:
                require(read_safe(prepared[label]['ready']) == previous, 'Rollback-ready bytes changed')
                os.replace(prepared[label]['ready'], path); sync(path.parent)
        except BaseException as error:
            errors.append(label + ': ' + str(error))
    try:
        if before['wanted'] is None and os.path.lexists(WANTED):
            wanted_target()
            require(read_safe(prepared['wanted']) == b'', 'Enablement failure slot changed')
            os.replace(WANTED, prepared['wanted']); sync(WANTED.parent)
        require(optional_file(UNIT) == (digest(before['unit']) if before['unit'] else None) and
            optional_file(ACTIVE) == (digest(before['active']) if before['active'] else None) and
            wanted_target() == before['wanted'], 'Rollback bytes differ; service remains stopped')
        run(['/usr/bin/systemctl', 'daemon-reload'])
        if before['state']['ActiveState'] == 'active':
            run(['/usr/bin/systemctl', 'start', UNIT_NAME])
        require(state(UNIT_NAME)['ActiveState'] == before['state']['ActiveState'], 'Rollback service state differs')
    except BaseException as error:
        errors.append('restore state: ' + str(error))
    return errors


def install(package, plan_sha):
    require(sys.flags.isolated and os.geteuid() == os.getegid() == 0, 'Use isolated root Python')
    directory(package)
    raw = read_safe(package/'plan.json', 8*1024**2)
    require(HEX64.fullmatch(plan_sha) and digest(raw) == plan_sha, 'Plan checksum differs')
    plan = json.loads(raw)
    require(plan['format'] == 'proof-of-work-publish-render-install-v1' and
        re.fullmatch('[a-z0-9][a-z0-9-]{0,30}', plan['attempt']), 'Invalid install plan')
    manifest = plan['source']; validate_source_manifest(manifest)
    token = manifest['commit'][:12] + '-' + plan['attempt']
    require(package == BASE/('publish-render-'+token), 'Wrong private package namespace')
    require(digest(read_safe(package/'deploy/publish-render/install.py')) == plan['installerSha256'] and
        digest(read_safe(Path(__file__))) == plan['installerSha256'], 'Installer differs from plan')
    verify_source(package, manifest)
    template = read_safe(package/UNIT_TEMPLATE)
    require(digest(template) == plan['unitTemplateSha256'], 'Unit template differs')
    archive = read_safe(package/(NODE_NAME+'.tar.xz'), 128*1024**2)
    rows, node_allocation = archive_inventory(archive)
    require(plan['nodeArchiveSha256'] == NODE_SHA, 'Unexpected runtime pin')
    directory(LOCK.parent); read_safe(LOCK, 0)
    lock = os.open(LOCK, os.O_RDONLY | os.O_NOFOLLOW)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    try:
        current = capture()
        require(current == plan['before'], 'Production changed since capture')
        if current['node'] is not None:
            require(current['node'] == expected_node_inventory(rows), 'Existing runtime differs from official archive')
        ui = json.loads(read_safe(UI/'source-provenance.json', shared=True))
        expected_ui = {'commit': manifest['commit'], 'tree': manifest['tree'], 'trackedDirty': False}
        require(ui.get('format') == 'proof-of-work-ui-source-v1' and
            all(ui.get(k) == v for k,v in expected_ui.items()), 'Publish UI must serve exact candidate source')
        lines = read_safe(MANIFEST,65536,shared=True).decode().splitlines()
        require(all('=' in line for line in lines) and
            len({line.split('=',1)[0] for line in lines}) == len(lines), 'Malformed published manifest')
        fields = dict(line.split('=',1) for line in lines)
        surfaces = {k.split('.')[1] for k in fields if re.fullmatch(r'surface\.[^.]+\.sha256', k)}
        require(fields.get('commit') == manifest['commit'] and fields.get('source_tree') == manifest['tree']
            and fields.get('format') == 'proofofwork-ui-release-v5' and surfaces == SURFACES and
            all(HEX64.fullmatch(fields.get('surface.'+name+'.sha256', '')) and
                re.fullmatch('[1-9][0-9]*', fields.get('surface.'+name+'.file_count', '')) for name in SURFACES) and
            all(fields['surface.nft.'+key] == fields['surface.computer.'+key] for key in ('sha256','file_count')),
            'Renderer requires complete exact 22-root publication')
        before = {'unit': read_safe(UNIT) if current['renderer']['unit'] is not None else None,
                  'active': read_safe(ACTIVE) if current['renderer']['active'] is not None else None,
                  'wanted': current['renderer']['wanted'], 'state': current['renderer']['state']}
        if before['active'] is None:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.bind(('127.0.0.1', 8084))
        target = ROOT/'releases'/manifest['commit']
        require(not os.path.lexists(target), 'Versioned source already exists; preserve and review prior attempt')
        candidate_unit = template.decode().replace('@SOURCE_ROOT@', str(target)).encode()
        require(b'@SOURCE_ROOT@' not in candidate_unit, 'Unexpanded unit template')
        candidate_active = encoded(manifest)
        source_bytes = sum((package/name).stat().st_size + 16384 for name in SOURCE_FILES) + 1024**2
        source_bytes += 2*(len(candidate_unit)+len(candidate_active)) + sum(
            len(value)+16384 for value in (before['unit'], before['active']) if value is not None)
        total = source_bytes + RECEIPT_BOUND + (node_allocation if current['node'] is None else 0)
        admissions = [admit(lock, BASE, total, len(rows)+256, 'publish-render-install'),
                      admit(lock, NODE_ROOT.parent, total, len(rows)+256, 'publish-render-runtime'),
                      admit(lock, BACKUPS, RECEIPT_BOUND, 128, 'publish-render-receipt')]
        run(['/usr/bin/python3', '-I', '-B', str(CAPACITY), 'check-scratch', '--path', str(BASE),
             '--additional-bytes', '0', '--phase', 'publish-render-install'], lock)
        parent = BACKUPS/'publish-render'
        if not parent.exists(): mkdir(parent, 0o700)
        directory(parent); receipt = parent/token; mkdir(receipt, 0o700)
        save(receipt/'intent.json', encoded({'plan': plan, 'admissions': admissions, 'allocationBytes': total}))
        save(receipt/'candidate-unit', candidate_unit); save(receipt/'candidate-active.json', candidate_active)
        if before['unit'] is not None: save(receipt/'previous-unit', before['unit'])
        if before['active'] is not None: save(receipt/'previous-active.json', before['active'])
        promoted = False
        try:
            if current['node'] is None:
                install_node(archive, NODE_ROOT.parent/('.publish-render-node-'+token), rows)
            else:
                require(run([str(NODE_ROOT/'bin/node'), '--version']) == 'v24.18.0', 'Installed Node version differs')
            installed_node = tree_inventory(NODE_ROOT)
            require(installed_node == expected_node_inventory(rows), 'Installed runtime differs from official archive')
            save(receipt/'node-inventory.json', encoded(installed_node))
            if not ROOT.exists(): mkdir(ROOT)
            directory(ROOT)
            if not (ROOT/'releases').exists(): mkdir(ROOT/'releases')
            staging = ROOT/'releases'/('.candidate-'+token); mkdir(staging)
            for name in SOURCE_FILES:
                destination = staging/name
                for ancestor in reversed(destination.parent.parents):
                    if ancestor == staging or ancestor.is_relative_to(staging):
                        if not ancestor.exists(): mkdir(ancestor)
                if not destination.parent.exists(): mkdir(destination.parent)
                save(destination, read_safe(package/name), 0o644)
            save(staging/'release.json', candidate_active, 0o644)
            verify_source(staging, manifest)
            for name in SOURCE_FILES:
                run([str(NODE_ROOT/'bin/node'), '--check', str(staging/name)])
            os.rename(staging, target); sync(target.parent)
            save(receipt/UNIT_NAME, candidate_unit, 0o644)
            run(['/usr/bin/systemd-analyze', 'verify', str(receipt/UNIT_NAME)])
            require(protected_snapshot() == current['protected'], 'Protected state changed before promotion')
            require(optional_file(UNIT) == current['renderer']['unit'] and
                optional_file(ACTIVE) == current['renderer']['active'] and wanted_target() == before['wanted'],
                'Renderer changed before promotion')
            prepared = prepare_rollback(before, token)
            save(receipt/'rollback-locations.json', encoded({key: {k:str(v) for k,v in value.items()}
                if isinstance(value, dict) else str(value) for key,value in prepared.items()}))
            promoted = True
            replace(UNIT, candidate_unit, token); replace(ACTIVE, candidate_active, token)
            if before['wanted'] is None:
                directory(WANTED.parent); os.symlink(str(UNIT), WANTED); sync(WANTED.parent)
            run(['/usr/bin/systemctl', 'daemon-reload'])
            run(['/usr/bin/systemctl', 'restart' if before['state']['ActiveState'] == 'active' else 'start', UNIT_NAME])
            verified = health(manifest, ui)
            service_state = state(UNIT_NAME)
            require(service_state.get('ActiveState') == 'active' and
                re.fullmatch('[1-9][0-9]*', service_state.get('MainPID', '')) and
                service_state.get('FragmentPath') == str(UNIT), 'Renderer unit is not the active responder')
            require(protected_snapshot() == current['protected'], 'Protected state changed after install')
            require(read_safe(UNIT) == candidate_unit and read_safe(ACTIVE) == candidate_active,
                'Installed renderer bytes differ')
            save(receipt/'completed.json', encoded({'ok': True, 'source': manifest, 'health': verified,
                'nodeArchiveSha256': NODE_SHA, 'serviceState': service_state,
                'historicalDeletion': False, 'protectedUnchanged': True}))
            print(json.dumps({'ok': True, 'receipt': str(receipt), 'commit': manifest['commit']}))
        except BaseException as error:
            failures = []
            try:
                save(receipt/'failure.json', encoded({'error': str(error), 'promotionStarted': promoted}))
            except BaseException as record_error:
                failures.append('failure receipt: ' + str(record_error))
            if promoted:
                failures.extend(rollback(receipt, before, candidate_unit, candidate_active, prepared))
            try:
                require(protected_snapshot() == current['protected'], 'Protected state differs after failure')
                save(receipt/'recovery.json', encoded({'rollbackErrors': failures, 'originalError': str(error),
                    'historicalDeletion': False, 'candidateSourceAndRuntimePreserved': True}))
            except BaseException as record_error:
                failures.append('recovery receipt/guard: ' + str(record_error))
            raise RuntimeError(str(error) + '; recovery: ' + repr(failures)) from error
    finally:
        os.close(lock)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', action='store_true')
    parser.add_argument('--package', type=Path)
    parser.add_argument('--plan-sha256')
    args = parser.parse_args()
    require(sys.flags.isolated, 'Use python3 -I -B')
    if args.capture:
        require(args.package is None and args.plan_sha256 is None, 'Capture does not install')
        print(json.dumps(capture(), sort_keys=True))
    else:
        require(args.package is not None and args.plan_sha256 is not None, 'Package and exact plan hash required')
        install(args.package, args.plan_sha256)


if __name__ == '__main__':
    main()
