#!/usr/bin/python3 -I
"""SOURCE-ONLY candidate: exact read-only custody sampling, never retirement authority.

root-census reads metadata/known unit properties and /proc pointers only.  content
requires a freshly bound canonical plan and an independently observed PG-owned
read-only managed unit.  Neither mode opens a database, creates evidence, takes a
backup lock, starts/stops a unit, changes a pin, or deletes anything.
"""
import datetime, hashlib, json, os, re, signal, stat, subprocess, sys, time
from pathlib import Path

HOST = 'pow-bitcoin-01'
PG_UID = 108
PG_GID = 112
APPROVAL = '6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
JOBS = (
    '/data/proofofwork-audit30-restore-20261002T234651Z',
    '/data/proofofwork-audit30-inspect-20261003T005512Z',
    '/data/proofofwork-audit30-inspect-20261003T014100Z',
)
TARGETS = tuple(j + '/cluster' for j in JOBS) + (
    '/data/proofofwork-postgres-backups/logical/proof_indexer-20260929T031853Z.dumpset',
)
PRIVATE_UNITS = (
    'proofofwork-audit30-logical-restore-20261002T234651Z.service',
    'proofofwork-audit30-snapshot-inspect-20261003T005512Z.service',
    'proofofwork-audit30-snapshot-inspect-20261003T014100Z.service',
)
LIVE = ('bitcoind.service', 'electrs.service', 'postgresql@16-main.service',
        'proofofwork-api.service', 'proofofwork-indexer-worker.service')
STATE = ('LoadState', 'ActiveState', 'SubState', 'MainPID', 'InvocationID')
DENIED = ('/var/lib/postgresql', '/run/postgresql',
          '/data/proofofwork-postgres-tablespaces', '/etc/proofofwork-api', '/data/bitcoin')
MEMBERS = {
    'proof_indexer.dump': (19363782935, '6bb26e725f1178f25720eadc46801975b987587578fbf7018203cddc65601031'),
    'globals.sql': (1137, 'ec6fe5b2e0b460e873739e4d0d31e103e38e8142d3695fc2cfb5c2600d1ae7f8'),
    'SHA256SUMS': (163, '645bc0ced92fcb7383f8dafda3a54d00f960ab24a29021cd8b938b6dd2a74031'),
}
MAX_ENTRIES = 6000
MAX_PROCESSES = 10000
MAX_FDS = 100000
MAX_PROC_FILE = 1024**2
MAX_PROC_BYTES = 64 * 1024**2
MAX_PLAN = 1024**2
MAX_OUTPUT = 16 * 1024**2
MAX_RETAINED_EVIDENCE_BYTES = 256 * 1024**2
DEADLINE = float('inf')
LAST_CHECK = 0


class Refused(RuntimeError):
    pass


def need(value, reason):
    if not value:
        raise Refused(reason)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def unique_pairs(rows):
    out = {}
    for key, value in rows:
        need(key not in out, 'Duplicate JSON key')
        out[key] = value
    return out


def parse(raw):
    return json.loads(raw, object_pairs_hook=unique_pairs)


def tick():
    need(time.monotonic() < DEADLINE, 'Read-only custody deadline')


def metadata(path, allow_root=False):
    s = path.lstat()
    kind = 'file' if stat.S_ISREG(s.st_mode) else 'directory' if stat.S_ISDIR(s.st_mode) else 'other'
    need(path.resolve(strict=True) == path and kind in ('file', 'directory'), 'Alias or unsupported member')
    owner_ok = (s.st_uid, s.st_gid) == (PG_UID, PG_GID) or (allow_root and s.st_uid == 0 and s.st_gid in (0, PG_GID))
    need(owner_ok and not s.st_mode & 0o022, 'PG/root member ownership/mode')
    need(not os.listxattr(path, follow_symlinks=False), 'Unreviewed xattrs')
    need((kind == 'file' and s.st_nlink == 1) or (kind == 'directory' and s.st_nlink >= 2), 'Shared member identity')
    return {'path': str(path), 'kind': kind, 'device': s.st_dev, 'inode': s.st_ino,
            'uid': s.st_uid, 'gid': s.st_gid, 'mode': stat.S_IMODE(s.st_mode),
            'nlink': s.st_nlink, 'bytes': s.st_size, 'allocatedBytes': s.st_blocks * 512,
            'mtimeNs': s.st_mtime_ns, 'ctimeNs': s.st_ctime_ns, 'xattrs': []}


def under(text, root):
    return text == root or text.startswith(root.rstrip('/') + '/')


def mounted_descendants(root, mountinfo):
    return [m for m in mounts(mountinfo) if under(m['mountpoint'], root) and m['mountpoint'] != root]


def walk(root, mountinfo):
    need(not mounted_descendants(str(root), mountinfo), 'Nested mount in candidate')
    rows, pending = [], [root]
    while pending:
        tick()
        p = pending.pop()
        row = metadata(p)
        need(row['device'] == root.lstat().st_dev, 'Cross-device member')
        rows.append(row)
        need(len(rows) <= MAX_ENTRIES, 'Candidate entry bound')
        if row['kind'] == 'directory':
            pending.extend(sorted(p.iterdir(), key=lambda q: os.fsencode(q.name), reverse=True))
    rows.sort(key=lambda row: os.fsencode(row['path']))
    allocated = sum(row['allocatedBytes'] for row in rows)
    regular = sum(row['bytes'] for row in rows if row['kind'] == 'file')
    cap = 32 * 1024**3 if str(root) == TARGETS[-1] else 80 * 1024**3
    need(allocated <= cap and regular <= cap, 'Candidate allocation/read cap')
    if str(root) == TARGETS[-1]:
        need({Path(r['path']).name for r in rows[1:]} == set(MEMBERS) and len(rows) == 4,
             'Old dump complete member set')
        for row in rows[1:]:
            need(row['kind'] == 'file' and row['bytes'] == MEMBERS[Path(row['path']).name][0], 'Old member size')
    else:
        need(not os.path.lexists(root / 'postmaster.pid'), 'Private postmaster pid remains')
    return rows


def allocation(rows):
    return {'entries': len(rows), 'regularBytes': sum(r['bytes'] for r in rows if r['kind'] == 'file'),
            'allocatedBytes': sum(r['allocatedBytes'] for r in rows)}


def read_hash(path, expected, allow_root=False):
    need(metadata(path, allow_root) == expected and expected['kind'] == 'file', 'Before-hash identity changed')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
    h, count = hashlib.sha256(), 0
    try:
        need(fd_identity(os.fstat(fd)) == fd_identity(path.lstat()), 'Hash FD identity')
        while True:
            periodic()
            raw = os.read(fd, 1024**2)
            if not raw:
                break
            count += len(raw)
            need(count <= expected['bytes'], 'File grew during hash')
            h.update(raw)
        need(count == expected['bytes'] and metadata(path, allow_root) == expected and
             fd_identity(os.fstat(fd)) == fd_identity(path.lstat()), 'File changed during hash')
    finally:
        os.close(fd)
    return h.hexdigest()


def fd_identity(s):
    return (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_nlink,
            s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def unescape(text):
    return re.sub(r'\\(040|011|012|134)', lambda m: chr(int(m[1], 8)), text)


def mounts(raw):
    out = []
    for line in raw.decode('utf-8', 'strict').splitlines():
        fields = line.split()
        need(len(fields) >= 10 and '-' in fields and fields.index('-') >= 6,
             'Malformed mount metadata')
        need(re.fullmatch(r'\d+:\d+', fields[2]), 'Mount device shape')
        out.append({'device': fields[2], 'root': unescape(fields[3]),
                    'mountpoint': unescape(fields[4])})
    return out


def mount_aliases(host, other, roots):
    hits = []
    for root in roots:
        binding = [m for m in host if under(root, m['mountpoint'])]
        need(binding, 'No canonical host mount')
        origin = max(binding, key=lambda m: len(m['mountpoint']))
        fsroot = origin['root'].rstrip('/') + '/' + root[len(origin['mountpoint']):].lstrip('/')
        fsroot = os.path.normpath(fsroot)
        for m in other:
            if m['device'] != origin['device']:
                continue
            if under(fsroot, m['root']):
                alias = os.path.normpath(m['mountpoint'].rstrip('/') + '/' + fsroot[len(m['root']):].lstrip('/'))
                if alias != root:
                    hits.append({'candidate': root, 'aliasSha256': sha(alias.encode()), 'kind': 'ancestor-mount-alias'})
            elif under(m['root'], fsroot):
                hits.append({'candidate': root, 'aliasSha256': sha(m['mountpoint'].encode()), 'kind': 'subtree-mount-alias'})
    return hits


def pointer_hits(text, roots):
    clean = text[:-10] if text.endswith(' (deleted)') else text
    return [root for root in roots if under(clean, root)]


def bounded_read(path, cap):
    with path.open('rb') as f:
        raw = f.read(cap + 1)
    need(len(raw) <= cap, 'Process metadata byte bound')
    return raw


def proc_readers(records, proc=Path('/proc')):
    roots = list(TARGETS)
    inodes = {(r['device'], r['inode']): next(t for t in roots if under(r['path'], t))
              for row in records.values() for r in row}
    host_raw = bounded_read(proc / 'self/mountinfo', MAX_PROC_FILE)
    host = mounts(host_raw)
    rows, vanished, count, fds, consumed, namespaces, kernel_count, fd_close_races = [], [], 0, 0, len(host_raw), set(), 0, 0
    for p in sorted(proc.iterdir(), key=lambda q: q.name):
        if not p.name.isdecimal():
            continue
        tick(); count += 1
        need(count <= MAX_PROCESSES, 'Process count bound')
        try:
            start = bounded_read(p / 'stat', MAX_PROC_FILE)
            start_id = process_start(start)
            if process_flags(start) & 0x00200000:
                need(bounded_read(p / 'cmdline', MAX_PROC_FILE) == b'' and not list((p / 'fd').iterdir()),
                     'Kernel-thread qualification changed')
                need(process_start(bounded_read(p / 'stat', MAX_PROC_FILE)) == start_id, 'Kernel PID identity changed')
                kernel_count += 1
                continue
            for name in ('cwd', 'root', 'exe'):
                text = os.readlink(p / name)
                hits = pointer_hits(text, roots)
                if hits:
                    rows.append({'pid': int(p.name), 'surface': name, 'targets': hits, 'pointerSha256': sha(text.encode())})
            entries = list((p / 'fd').iterdir())
            for fd in entries:
                tick(); fds += 1; need(fds <= MAX_FDS, 'FD count bound')
                try:
                    text = os.readlink(fd); s = fd.stat()
                except FileNotFoundError:
                    fd_close_races += 1
                    continue  # fd close is an observed race, not an unreadable live process.
                hits = set(pointer_hits(text, roots))
                if (s.st_dev, s.st_ino) in inodes:
                    hits.add(inodes[(s.st_dev, s.st_ino)])
                if hits:
                    rows.append({'pid': int(p.name), 'surface': 'fd/' + fd.name,
                                 'targets': sorted(hits), 'pointerSha256': sha(text.encode()),
                                 'device': s.st_dev, 'inode': s.st_ino})
            for name in ('cmdline', 'maps'):
                raw = bounded_read(p / name, MAX_PROC_FILE); consumed += len(raw)
                need(consumed <= MAX_PROC_BYTES, 'Cumulative process metadata bound')
                hits = {root for root in roots if root.encode() in raw}
                if name == 'maps':
                    for line in raw.splitlines():
                        fields = line.split(None, 5)
                        need(len(fields) >= 5, 'Malformed process map')
                        major, minor = fields[3].split(b':')
                        identity = (os.makedev(int(major, 16), int(minor, 16)), int(fields[4]))
                        if identity in inodes:
                            hits.add(inodes[identity])
                if hits:
                    rows.append({'pid': int(p.name), 'surface': name, 'targets': sorted(hits), 'contentSha256': sha(raw)})
            ns = os.readlink(p / 'ns/mnt')
            if ns not in namespaces:
                raw = bounded_read(p / 'mountinfo', MAX_PROC_FILE); consumed += len(raw)
                need(consumed <= MAX_PROC_BYTES, 'Cumulative mount metadata bound')
                for hit in mount_aliases(host, mounts(raw), roots):
                    rows.append({'pid': int(p.name), 'surface': 'mountinfo', **hit})
                namespaces.add(ns)
            need(process_start(bounded_read(p / 'stat', MAX_PROC_FILE)) == start_id, 'Process PID reused during census')
        except FileNotFoundError:
            need(not p.exists(), 'Live process surface disappeared/inaccessible')
            vanished.append(int(p.name))
        except PermissionError as ex:
            raise Refused('Live process metadata unreadable') from ex
    return {'processes': count, 'fdEntries': fds, 'metadataBytes': consumed,
            'mountNamespaces': len(namespaces), 'matches': rows, 'vanishedProcesses': vanished,
            'fdCloseRaces': fd_close_races, 'qualifiedKernelThreads': kernel_count,
            'candidateReadersObserved': bool(rows), 'completeForObservedLiveProcesses': True,
            'qualification': 'Two endpoint snapshots detect observed readers/aliases; they cannot exclude intermittent or future access. No FD contents, environ, memory, bodies or private catalog read.'}


def process_start(raw):
    tail = raw[raw.rfind(b')') + 2:].split()
    need(len(tail) >= 20 and tail[19].isdigit(), 'Process start identity missing')
    return int(tail[19])


def process_flags(raw):
    tail = raw[raw.rfind(b')') + 2:].split()
    need(len(tail) >= 20 and tail[6].isdigit(), 'Process flags missing')
    return int(tail[6])


def command(argv, cap=65536):
    tick()
    p = subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True,
                       timeout=min(10, max(.01, DEADLINE - time.monotonic())),
                       env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'}, cwd='/')
    need(p.returncode == 0 and len(p.stdout) <= cap and not p.stderr, 'Fixed metadata command refused')
    return p.stdout


def properties(unit, fields=STATE):
    raw = command(['/usr/bin/systemctl', 'show', unit, '--no-pager', *['--property=' + k for k in fields]])
    result = {}
    for line in raw.decode().splitlines():
        key, sep, value = line.partition('=')
        need(sep and key not in result, 'Duplicate unit field')
        result[key] = value
    need(set(result) == set(fields), 'Unit fields incomplete')
    return result


def quiet(require_window=True):
    s = properties('proofofwork-postgres-logical-backup.service')
    need(s['LoadState'] == 'loaded' and s['ActiveState'] == 'inactive' and s['MainPID'] == '0', 'Backup is not quiet')
    timer = properties('proofofwork-postgres-logical-backup.timer', ('LoadState', 'ActiveState', 'NextElapseUSecRealtime'))
    need(timer['LoadState'] == 'loaded' and timer['ActiveState'] == 'active', 'Ordinary backup timer unavailable')
    next_time = datetime.datetime.strptime(timer['NextElapseUSecRealtime'], '%a %Y-%m-%d %H:%M:%S %Z').replace(tzinfo=datetime.timezone.utc)
    if require_window:
        need((next_time - datetime.datetime.now(datetime.timezone.utc)).total_seconds() > 1800, 'Less than30min clear backup window')
    return {'service': s, 'timer': timer}


def capacity():
    a = os.statvfs('/'); b = os.statvfs('/data')
    root, data = a.f_bavail * a.f_frsize, b.f_bavail * b.f_frsize
    need(root >= 10 * 1024**3 and data >= 100 * 1024**3, 'Unchanged root/data reserves')
    return {'rootAvailableBytes': root, 'dataAvailableBytes': data}


def periodic():
    global LAST_CHECK
    tick()
    if time.monotonic() - LAST_CHECK >= 5:
        quiet(False); capacity(); LAST_CHECK = time.monotonic()


def live():
    rows = {name: properties(name) for name in LIVE}
    for row in rows.values():
        need(row['LoadState'] == 'loaded' and row['ActiveState'] == 'active' and row['SubState'] == 'running' and
             re.fullmatch('[1-9][0-9]*', row['MainPID']) and re.fullmatch('[a-f0-9]{32}', row['InvocationID']), 'Live-five unavailable')
    return rows


def controls():
    out = []
    for target, unit in zip(TARGETS[:3], PRIVATE_UNITS):
        row = properties(unit)
        need(row['MainPID'] == '0' and row['ActiveState'] in ('inactive', 'failed') and
             row['LoadState'] in ('loaded', 'not-found'), 'Original private unit is not stopped')
        need((row['ActiveState'] == 'inactive' and row['SubState'] == 'dead') or
             (row['LoadState'] == 'loaded' and row['ActiveState'] == 'failed' and row['SubState'] == 'failed'), 'Exact private stopped unit state')
        need(row['LoadState'] != 'not-found' or
             (row['ActiveState'] == 'inactive' and row['SubState'] == 'dead' and not row['InvocationID']), 'Unqualified missing-unit shape')
        path = Path(target) / 'global/pg_control'; before = metadata(path)
        raw = command(['/usr/lib/postgresql/16/bin/pg_controldata', target])
        values = dict(line.split(':', 1) for line in raw.decode().splitlines() if ':' in line)
        fields = {name: values[name].strip() for name in ('pg_control version number', 'Catalog version number',
                  'Database system identifier', 'Database cluster state', 'Data page checksum version')}
        need(metadata(path) == before and fields['Database cluster state'] == 'shut down' and
             fields['Database system identifier'] == '7692221671691040144' and fields['Data page checksum version'] == '1', 'Private control/stopped identity mismatch')
        out.append({'target': target, 'unit': unit, 'properties': row, 'controlMetadata': before,
                    'controlFields': fields, 'missingUnitIsOnlyQualifiedTogetherWithControlAndProcessCensus': True})
    return out


def retained_evidence(job, mount_raw):
    """Hash every current non-cluster member without exporting its bytes or discarding it."""
    root = Path(job); excluded = str(root / 'cluster')
    need(not mounted_descendants(job, mount_raw), 'Nested mount in retained job')
    def inventory():
        result, pending = [], [root]
        while pending:
            tick(); p = pending.pop()
            if str(p) == excluded:
                continue
            row = metadata(p, True); result.append(row)
            need(len(result) <= MAX_ENTRIES, 'Retained evidence entry bound')
            need(row['device'] == root.lstat().st_dev, 'Retained evidence cross-device member')
            if row['kind'] == 'directory':
                pending.extend(sorted(p.iterdir(), key=lambda q: os.fsencode(q.name), reverse=True))
        result.sort(key=lambda row: os.fsencode(row['path']))
        need(sum(r['bytes'] for r in result if r['kind'] == 'file') <= MAX_RETAINED_EVIDENCE_BYTES,
             'Retained evidence hash byte bound')
        return result
    before = inventory(); hashes = []
    for row in before:
        if row['kind'] == 'file':
            hashes.append({'path': row['path'], 'sha256': read_hash(Path(row['path']), row, True),
                           'metadataSha256': sha(encoded(row))})
    need(inventory() == before, 'Retained evidence changed during hash')
    return {'jobRoot': job, 'excludedDeletionCandidate': excluded, **allocation(before),
            'metadataRecordsSha256': sha(encoded(before)), 'metadataRecords': before,
            'fullFileHashes': hashes, 'fullFileHashesSha256': sha(encoded(hashes)),
            'allThesePathsMustSurviveAnyClusterOnlyRetirement': True}


def root_census():
    need(os.geteuid() == os.getegid() == 0, 'Root metadata role required')
    before = live(); backup = quiet(); space = capacity()
    mount_raw = bounded_read(Path('/proc/self/mountinfo'), MAX_PROC_FILE)
    records = {target: walk(Path(target), mount_raw) for target in TARGETS}
    stopped = controls(); readers = proc_readers(records)
    retained = [retained_evidence(job, mount_raw) for job in JOBS]
    need({target: walk(Path(target), mount_raw) for target in TARGETS} == records, 'Metadata changed during root census')
    need(live() == before, 'Live-five changed during root census'); quiet()
    return {'schema': 'pow-audit30-retirement-root-custody-census-v1', 'atUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'targets': [{'path': target, 'metadataSha256': sha(encoded(rows)), **allocation(rows), 'records': rows}
                        for target, rows in records.items()], 'privateControls': stopped, 'processReaders': readers,
            'retainedNonClusterEvidence': retained,
            'liveFive': before, 'backup': backup, 'capacity': space, 'fullContentHashesVerifiedHere': False,
            'allDependenciesClosed': False, 'deletionAuthorized': False, 'productionMutation': False}


def validate_plan(plan):
    need(set(plan) == {'schema', 'approvalSha256', 'host', 'unit', 'rootBeforeSha256', 'liveFive', 'targets'}, 'Exact content plan keys')
    need(plan['schema'] == 'pow-audit30-retirement-content-readonly-plan-v1' and plan['approvalSha256'] == APPROVAL and
         plan['host'] == HOST and re.fullmatch(r'proofofwork-audit30-retirement-content-\d{8}T\d{6}Z\.service', plan['unit']) and
         re.fullmatch('[a-f0-9]{64}', plan['rootBeforeSha256']), 'Content plan authority/identity')
    stamp = plan['unit'].split('retirement-content-', 1)[1][:-8]
    need(datetime.datetime.strptime(stamp, '%Y%m%dT%H%M%SZ').strftime('%Y%m%dT%H%M%SZ') == stamp, 'Calendar content unit')
    need(isinstance(plan['targets'], list) and len(plan['targets']) == 4 and
         [row.get('path') for row in plan['targets']] == list(TARGETS), 'Exact ordered four-target scope')
    for row in plan['targets']:
        need(set(row) == {'path', 'metadataSha256'} and re.fullmatch('[a-f0-9]{64}', row['metadataSha256']), 'Bound metadata target')
    need(set(plan['liveFive']) == set(LIVE), 'Exact live-five plan scope')


def hash_runtime(plan):
    need(os.geteuid() == PG_UID and os.getegid() == PG_GID, 'Native postgres hash role required')
    need('/system.slice/' + plan['unit'] in [line.split(':', 2)[-1] for line in Path('/proc/self/cgroup').read_text().splitlines()], 'Managed content cgroup')
    expected = {'Type': 'exec', 'User': 'postgres', 'Group': 'postgres', 'CPUQuotaPerSecUSec': '250ms',
                'MemoryMax': str(128 * 1024**2), 'MemorySwapMax': '0', 'TasksMax': '16', 'RuntimeMaxUSec': '15min',
                'Nice': '15', 'IOWeight': '10', 'NoNewPrivileges': 'yes', 'ProtectSystem': 'strict',
                'ProtectHome': 'yes', 'PrivateTmp': 'yes', 'PrivateNetwork': 'yes',
                'CapabilityBoundingSet': '', 'AmbientCapabilities': '', 'ReadWritePaths': '',
                'ReadOnlyPaths': ' '.join(TARGETS), 'InaccessiblePaths': ' '.join(DENIED)}
    actual = properties(plan['unit'], tuple(expected))
    need(actual == expected, 'Actual managed resource/namespace drift')
    need(all(os.statvfs(path).f_flag & os.ST_RDONLY for path in TARGETS), 'Candidate mounts are not read-only')
    for text in DENIED:
        try:
            os.listdir(text)
        except (PermissionError, FileNotFoundError):
            continue
        raise Refused('Live namespace accessible')
    return actual


def content(plan):
    validate_plan(plan); runtime = hash_runtime(plan); quiet(); capacity()
    need(live() == plan['liveFive'], 'Fresh live-five plan changed')
    raw_mounts = bounded_read(Path('/proc/self/mountinfo'), MAX_PROC_FILE)
    all_records, out = {}, []
    for item in plan['targets']:
        root = Path(item['path']); records = walk(root, raw_mounts)
        need(sha(encoded(records)) == item['metadataSha256'], 'Fresh candidate metadata plan mismatch')
        hashes = []
        for row in records:
            periodic()
            if row['kind'] != 'file':
                continue
            h = read_hash(Path(row['path']), row)
            if item['path'] == TARGETS[-1]:
                need(h == MEMBERS[Path(row['path']).name][1], 'Old exact member content changed')
            hashes.append({'path': row['path'], 'sha256': h, 'metadataSha256': sha(encoded(row))})
        need(walk(root, raw_mounts) == records, 'Full candidate metadata fence changed')
        all_records[item['path']] = records
        out.append({'path': item['path'], **allocation(records), 'metadataSha256': item['metadataSha256'],
                    'fullFileHashes': hashes, 'fullFileHashesSha256': sha(encoded(hashes)), 'allRegularBytesHashed': True})
    need({target: walk(Path(target), raw_mounts) for target in TARGETS} == all_records, 'Whole-run metadata fence changed')
    need(live() == plan['liveFive'], 'Live-five changed during full content read'); quiet(False); space = capacity()
    return {'schema': 'pow-audit30-retirement-content-custody-v1', 'atUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'rootBeforeSha256': plan['rootBeforeSha256'], 'planSha256': sha(encoded(plan)), 'targets': out,
            'actualResources': runtime, 'capacity': space, 'noAtime': True, 'backupLockAcquired': False,
            'restoreEquivalenceProven': False, 'allDependenciesClosed': False, 'deletionAuthorized': False,
            'productionMutation': False, 'qualification': 'Current full regular bytes and metadata fenced. This is custody, not logical recovery/unique-history equivalence, reader exclusion across the full interval, or deletion permission. Independent root before/after and dependency/history/evidence gates remain required.'}


def main():
    global DEADLINE
    need(sys.flags.isolated and os.uname().nodename == HOST and len(sys.argv) in (2, 3), 'Fixed isolated native scope')
    mode = sys.argv[1]
    need(mode in ('root-census', 'content'), 'Read-only mode only')
    DEADLINE = time.monotonic() + (120 if mode == 'root-census' else 900)
    def interrupted(signum, frame):
        raise Refused('Read-only collector signal/deadline')
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGALRM):
        signal.signal(sig, interrupted)
    signal.setitimer(signal.ITIMER_REAL, 120 if mode == 'root-census' else 900)
    if mode == 'root-census':
        need(len(sys.argv) == 2, 'Root census has no arbitrary path/plan arguments'); value = root_census()
    else:
        need(len(sys.argv) == 3 and re.fullmatch('[a-f0-9]{64}', sys.argv[2]), 'Bound raw content plan')
        raw = sys.stdin.buffer.read(MAX_PLAN + 1)
        need(len(raw) <= MAX_PLAN and sha(raw) == sys.argv[2], 'Raw content plan hash/bound')
        p = parse(raw); need(raw == encoded(p), 'Canonical no-LF content plan'); value = content(p)
    raw = encoded(value); need(len(raw) <= MAX_OUTPUT, 'Custody output bound'); sys.stdout.buffer.write(raw)


if __name__ == '__main__':
    try:
        main()
    except BaseException as ex:
        sys.stderr.write(json.dumps({'schema': 'pow-audit30-retirement-cluster-closure-refusal-v1',
                                    'errorClass': type(ex).__name__, 'reasonSha256': sha(str(ex).encode()),
                                    'productionMutation': False, 'deletionAuthorized': False}, sort_keys=True))
        raise SystemExit(1)
