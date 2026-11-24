"""Durable, creation-only config/state exchange for the exact failed-341 recovery.

The caller owns the native deployment lock and validates the approved recovery
plan, package and retained roots. The original files stay on their original
filesystem. A journaled reversal can only restore those exact original inodes.
"""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import stat


ROLES = ('state', 'config')
TARGETS = {'state': 'var/lib/proofofwork-ui-retention/state.json',
           'config': 'etc/proofofwork-retention/ui-lifecycle.json'}
FAILED = {'config': '40fc1e2d6e145fe0b4864bb45aa807fffc0b30e78c2cb60c0a1aeb1184759da6',
          'state': '191fa3f48f4bad423f7d326865a8bb2eca5d0df50a49fabf72dd34f27837f95f'}
PINS = re.compile('[a-f0-9]{64}')
LIMIT = 64 * 1024**2
PREPARED = 'prepared.json'
PHASES = ('forward', 'checking', 'verified', 'accepted', 'reversing', 'restored')
SCHEMA = 'pow-ui-failed-341-exchange-v1'
PRIVATE = os.O_RDONLY | os.O_NOATIME | os.O_NOFOLLOW | os.O_NONBLOCK


class Restored(ValueError):
    """Application failed. Both original inodes and the failure evidence were verified."""
    def __init__(self, result):
        super().__init__('Recovery refused; original failed-341 config and state restored')
        self.result = result


def require(value, reason):
    if not value:
        raise ValueError(reason)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def directory(path, private=False):
    st = path.lstat()
    require(path.is_absolute() and path.resolve(strict=True) == path and stat.S_ISDIR(st.st_mode)
            and (st.st_uid, st.st_gid) == (os.geteuid(), os.getegid()) and not st.st_mode & 0o7022
            and (not private or stat.S_IMODE(st.st_mode) == 0o700), 'Unsafe recovery directory')
    return [st.st_dev, st.st_ino, st.st_uid, st.st_gid, st.st_mode]


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def identity(st):
    # Exchanging names necessarily changes ctime. Guard it across every read.
    return [st.st_dev, st.st_ino, st.st_uid, st.st_gid, st.st_mode, st.st_nlink, st.st_size, st.st_mtime_ns]


def read(path, limit=LIMIT):
    st = path.lstat()
    require(path.resolve(strict=True) == path and stat.S_ISREG(st.st_mode) and st.st_nlink == 1
            and (st.st_uid, st.st_gid) == (os.geteuid(), os.getegid())
            and stat.S_IMODE(st.st_mode) == 0o600 and 0 < st.st_size <= limit, 'Unsafe recovery file')
    with os.fdopen(os.open(path, PRIVATE), 'rb') as f:
        fd = f.fileno()
        start = os.fstat(fd)
        require(identity(start) == identity(st) and start.st_ctime_ns == st.st_ctime_ns, 'Recovery input changed on open')
        attrs = {name: os.getxattr(fd, name) for name in os.listxattr(fd)}
        raw = f.read(st.st_size + 1)
        end, named = os.fstat(fd), path.lstat()
        require(len(raw) == st.st_size and identity(end) == identity(named) == identity(st)
                and end.st_ctime_ns == named.st_ctime_ns == st.st_ctime_ns, 'Recovery input changed on read')
    return raw, {'identity': identity(st), 'sha256': sha(raw),
                 'xattrs': {name: sha(value) for name, value in attrs.items()}}, attrs


def create(path, raw, attrs=None):
    """Attach a fully flushed inode once. A partial file has no visible name."""
    directory(path.parent, private=True)
    parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        with os.fdopen(os.open('.', os.O_RDWR | os.O_TMPFILE, 0o600, dir_fd=parent), 'wb') as f:
            fd = f.fileno()
            f.write(raw)
            f.flush()
            os.fchmod(fd, 0o600)
            if attrs is not None:
                for key in set(os.listxattr(fd)) - attrs.keys():
                    os.removexattr(fd, key)
                for key, value in attrs.items():
                    os.setxattr(fd, key, value)
            os.fsync(fd)
            os.link('/proc/self/fd/' + str(fd), path.name, dst_dir_fd=parent, follow_symlinks=True)
            os.fsync(parent)
    finally:
        os.close(parent)


def document(path):
    raw, _, _ = read(path, 65536)
    val = json.loads(raw)
    require(isinstance(val, dict) and raw == encoded(val), 'Noncanonical recovery evidence')
    return val, sha(raw)


def exchange(left, right, dirs, pair):
    parents = []
    try:
        for p in (left, right):
            parents.append(os.open(p.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW))
        for path, fd, expected_dir, expected_file in zip((left, right), parents, dirs, pair, strict=True):
            st = os.fstat(fd)
            require([st.st_dev, st.st_ino, st.st_uid, st.st_gid, st.st_mode] == expected_dir
                    and identity(os.stat(path.name, dir_fd=fd, follow_symlinks=False)) == expected_file['identity'],
                    'Recovery inode or directory changed before syscall')
        if ctypes.CDLL(None, use_errno=True).renameat2(parents[0], os.fsencode(left.name),
                                                       parents[1], os.fsencode(right.name), 2):
            raise OSError(ctypes.get_errno(), 'Atomic recovery exchange failed')
        for fd in parents:
            os.fsync(fd)
    finally:
        for fd in parents:
            os.close(fd)


def review_receipts(journal, plan_sha, read_bound, lexists):
    """Read and authenticate the exchange receipt chain without changing custody.

    The caller binds journal/plan to the installed package. Native readers also
    verify the role-file identities and their own expected native status proofs.
    The returned phase set distinguishes an installer-only provisional check
    from acceptance and historical failed/restored attempts.
    """
    require(isinstance(plan_sha, str) and PINS.fullmatch(plan_sha), 'Invalid receipt plan binding')
    def record(name):
        raw = read_bound(journal / (name + '.json'), None)
        require(isinstance(raw, bytes) and 0 < len(raw) <= 65536, 'Invalid recovery receipt size')
        data = json.loads(raw)
        require(isinstance(data, dict) and raw == encoded(data), 'Noncanonical recovery receipt')
        return data, sha(raw)

    prepared, prepared_sha = record('prepared')
    require(set(prepared) == {'schema', 'planSha256', 'directories', 'files'}
            and prepared['schema'] == SCHEMA and prepared['planSha256'] == plan_sha,
            'Incorrect prepared receipt binding')
    prefix = {'schema': SCHEMA, 'planSha256': plan_sha, 'preparedSha256': prepared_sha}
    digests, records = {}, {}
    for phase in PHASES:
        if not lexists(journal / (phase + '.json')):
            continue
        val, digest = record(phase)
        fields = dict(prefix, phase=phase)
        if phase == 'reversing':
            error = val.get('failure')
            require(isinstance(error, dict) and set(error) == {'type', 'messageSha256'}
                    and isinstance(error['type'], str) and re.fullmatch('[A-Za-z_][A-Za-z_0-9]{0,127}', error['type'])
                    and isinstance(error['messageSha256'], str) and PINS.fullmatch(error['messageSha256']),
                    'Malformed recovery failure binding')
            fields['failure'] = error
        if phase in ('verified', 'accepted', 'restored'):
            proof = val.get('verificationSha256')
            require(isinstance(proof, str) and PINS.fullmatch(proof), 'Unverified recovery phase')
            fields['verificationSha256'] = proof
        if phase == 'accepted':
            require('verified' in digests, 'Accepted without provisional verification')
            fields['verifiedSha256'] = digests['verified']
        require(val == fields, 'Incorrect recovery phase binding')
        digests[phase], records[phase] = digest, val
    require(('checking' not in records or 'forward' in records)
            and ('verified' not in records or 'checking' in records)
            and ('reversing' not in records or 'forward' in records and 'accepted' not in records)
            and ('restored' not in records or 'reversing' in records), 'Conflicting recovery phase receipts')
    return {'prepared': prepared, 'preparedSha256': prepared_sha, 'receipts': digests, 'records': records}


def operate(action, journal, plan_sha, prior, replacements, fence, verify_after, verify_restored, *,
            verify_ordinary, root=Path('/'), prior_descriptors=None):
    """Run one explicit phase under fence(). Verifiers return their independently checked SHA-256.

    A terminal success is read-only on subsequent inspection. An explicit
    reconcile may continue an interrupted durable direction. Partial initial
    preparation without an inode manifest cannot move either live file.
    """
    root, journal = Path(root), Path(journal)
    require(action in ('prepare', 'apply', 'status', 'reconcile') and PINS.fullmatch(plan_sha)
            and callable(verify_ordinary) and set(prior) == set(replacements) == set(ROLES)
            and all(PINS.fullmatch(h) for h in prior.values()),
            'Invalid recovery exchange binding')
    require(root.is_absolute() and root.resolve(strict=True) == root
            and journal.parent.parent == root / 'var/backups/proofofwork-ui/cleanup-evidence'
            and re.fullmatch('ui-lifecycle-upgrade-[a-f0-9]{64}', journal.parent.name)
            and journal.name == 'exchange', 'Wrong recovery exchange journal')
    if root == Path('/'):
        require(os.geteuid() == os.getegid() == 0 and prior == FAILED and prior_descriptors is not None,
                'Wrong production 341 input or missing planned inode binding')
    if prior_descriptors is not None:
        require(set(prior_descriptors) == set(ROLES)
                and all(prior_descriptors[k].get('sha256') == prior[k] for k in ROLES), 'Wrong planned original files')
    require(all(isinstance(raw, bytes) and 0 < len(raw) <= LIMIT and sha(raw) != prior[k]
                for k, raw in replacements.items()), 'Invalid replacement bytes')
    local = {k: root / TARGETS[k] for k in ROLES}
    def parents():
        return {k: directory(path.parent) for k, path in local.items()} | {'custody': directory(journal, private=True)}

    fence()
    package_dir = directory(journal.parent, private=True)
    for path in local.values():
        require(directory(path.parent)[0] == package_dir[0], 'Cross-filesystem recovery cannot retain original inode')
    for parent in {ancestor for path in (journal, *local.values())
                   for ancestor in path.parents if ancestor == root or root in ancestor.parents}:
        directory(parent)
    present = os.path.lexists(journal)
    if not present:
        observed = {k: read(local[k])[1] for k in ROLES}
        require((prior_descriptors is None or observed == prior_descriptors) and
                all(v['sha256'] == prior[k] and v['identity'][0] == package_dir[0]
                    for k, v in observed.items()), 'Original failed-341 input differs')
        if action == 'status':
            fence()
            return {'disposition': 'absent', 'planSha256': plan_sha}
        require(action == 'prepare', 'Prepare recovery before exchanging files')
        journal.mkdir(mode=0o700)
        sync(journal.parent)
        parents()
        files = {}
        for k in ROLES:
            fence()
            _, source, attrs = read(local[k])
            require(source == observed[k], 'Prior recovery inode changed during preparation')
            create(journal / k, replacements[k], attrs)
            _, candidate, _ = read(journal / k)
            a, b = source['identity'], candidate['identity']
            require(a[0] == b[0] and a[1] != b[1] and a[2:6] == b[2:6]
                    and candidate['sha256'] == sha(replacements[k]) and source['xattrs'] == candidate['xattrs'],
                    'Replacement metadata or contents differ')
            files[k] = {'before': source, 'after': candidate}
        fence()
        require(all(read(local[k])[1] == observed[k] for k in ROLES), 'Original changed before sealing custody')
        create(journal / PREPARED, encoded({'schema': SCHEMA, 'planSha256': plan_sha,
               'directories': parents(), 'files': files}))
    else:
        require(action != 'prepare', 'Recovery custody already exists; inspect before retry')

    directory(journal, private=True)
    expected_names = {PREPARED, *ROLES, *(key + '.json' for key in PHASES)}
    names = set(os.listdir(journal))
    require({PREPARED, *ROLES} <= names <= expected_names, 'Unsealed or foreign recovery custody; explicit review required')
    manifest, prepared_sha = document(journal / PREPARED)
    require(set(manifest) == {'schema', 'planSha256', 'directories', 'files'} and manifest['schema'] == SCHEMA
            and manifest['planSha256'] == plan_sha and manifest['directories'] == parents()
            and set(manifest['files']) == set(ROLES), 'Recovery custody or plan differs')
    files = manifest['files']
    for k in ROLES:
        pair = files[k]
        require(set(pair) == {'before', 'after'} and pair['before']['sha256'] == prior[k]
                and (prior_descriptors is None or pair['before'] == prior_descriptors[k])
                and pair['after']['sha256'] == sha(replacements[k]), 'Custody does not bind approved inputs')
    prefix = {'schema': SCHEMA, 'planSha256': plan_sha, 'preparedSha256': prepared_sha}

    def positions():
        fence()
        require(parents() == manifest['directories'] and document(journal / PREPARED)[1] == prepared_sha,
                'Recovery custody identity changed')
        pos = {}
        for k in ROLES:
            current, spare = read(local[k])[1], read(journal / k)[1]
            if (current, spare) == (files[k]['before'], files[k]['after']):
                pos[k] = 'before'
            elif (current, spare) == (files[k]['after'], files[k]['before']):
                pos[k] = 'after'
            else:
                raise ValueError('Unowned recovery inode, metadata or bytes')
        require(list(pos.values()) != ['before', 'after'], 'Unexpected recovery exchange order')
        fence()
        return pos

    def read_phases():
        entries = set(os.listdir(journal))
        require({PREPARED, *ROLES} <= entries <= expected_names, 'Foreign recovery journal entry')
        checked = review_receipts(journal, plan_sha, lambda path, pin: read(path, 65536)[0], os.path.lexists)
        require(checked['preparedSha256'] == prepared_sha and entries == set(os.listdir(journal)),
                'Recovery evidence changed while reading')
        return checked['receipts']

    def mark(phase, proof=None, failure=None, verified_sha=None):
        fence()
        val = dict(prefix, phase=phase)
        if failure is not None:
            val['failure'] = {'type': type(failure).__name__, 'messageSha256': sha(str(failure).encode('utf-8', 'replace'))}
        if proof is not None:
            require(isinstance(proof, str) and PINS.fullmatch(proof), 'Verifier did not supply a terminal digest')
            val['verificationSha256'] = proof
        if phase == 'accepted':
            val['verifiedSha256'] = verified_sha
        create(journal / (phase + '.json'), encoded(val))

    def status():
        pos, records = positions(), read_phases()
        state = next((p for p in ('restored', 'reversing', 'accepted', 'verified', 'checking', 'forward') if p in records), 'prepared')
        if state in ('prepared', 'restored'):
            require(set(pos.values()) == {'before'}, 'Terminal original position differs')
        elif state in ('accepted', 'verified', 'checking'):
            require(set(pos.values()) == {'after'}, 'Terminal replacement position differs')
        return {'disposition': state, 'positions': pos, 'planSha256': plan_sha,
                'preparedSha256': prepared_sha, 'receipts': records}

    def move(keys, wanted):
        for k in keys:
            pos = positions()
            if pos[k] != wanted:
                exchange(local[k], journal / k, (manifest['directories'][k], manifest['directories']['custody']),
                         (files[k][pos[k]], files[k][wanted]))
                require(positions()[k] == wanted, 'Recovery exchange did not reach its owned position')
        # An interrupted rename may have preceded one or both directory fsyncs.
        # Flush both directories again even when the names are already correct.
        for path in (*local.values(), journal / 'state'):
            sync(path.parent)
        require(set(positions().values()) == {wanted}, 'Recovery exchange has incomplete positions')

    result = status()
    if action in ('status', 'prepare'):
        return result
    if result['disposition'] in ('accepted', 'restored'):
        require(action == 'reconcile', 'Recovery already terminal; inspect prior result')
        # A prior process may have stopped between link and directory fsync.
        sync(journal)
        if result['disposition'] == 'restored':
            raise Restored(result)
        return result
    if action == 'apply':
        require(result['disposition'] == 'prepared', 'Prior switch started; explicit reconciliation required')
    else:
        require(result['disposition'] != 'prepared', 'A prepared recovery needs explicit apply')
    if result['disposition'] == 'prepared':
        mark('forward')
    def reversal(failure):
        # Never restore over unrelated data, or after durable acceptance.
        current = status()
        require(current['disposition'] in ('forward', 'checking', 'verified'), 'Invalid recovery reversal point')
        mark('reversing', failure=failure)

    if result['disposition'] not in ('verified', 'reversing'):
        try:
            move(ROLES, 'after')
            if 'checking' not in read_phases():
                mark('checking')
            proof = verify_after()
            require(isinstance(proof, str) and PINS.fullmatch(proof), 'Unverified replacement state')
        except Exception as failure:
            reversal(failure)
        else:
            require(status()['disposition'] == 'checking', 'Recovery changed across native verification')
            mark('verified', proof)
    provisional = status()
    if provisional['disposition'] == 'verified':
        # Normal acquisition of this candidate remains closed. This final
        # native ordinary read is explicitly scoped to the held deployment lock.
        try:
            proof = verify_ordinary()
            require(isinstance(proof, str) and PINS.fullmatch(proof), 'Unverified ordinary recovery status')
        except Exception as failure:
            reversal(failure)
        else:
            require(status() == provisional, 'Recovery changed across ordinary verification')
            mark('accepted', proof, verified_sha=provisional['receipts']['verified'])
            return status()
    require(status()['disposition'] == 'reversing', 'No durable recovery reversal')
    move(reversed(ROLES), 'before')
    proof = verify_restored()
    require(set(positions().values()) == {'before'}, 'Restored 341 identity changed across verification')
    mark('restored', proof)
    raise Restored(status())
