#!/usr/bin/env python3
"""Prepare a bounded helper frame and install or restore its exact approved inode pair."""
import argparse
import base64
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import sys


BASE = 'ace27010a8e44886c0c22cf9fe5c98509d28f1bb'
PAIR = {'current': '2084747c3f8c-20261118T181547Z', 'previous': '9f18a0ce7032-20261118T004519Z'}
PRIOR_CONFIG_SHA = 'bbce6be80e95047760f526550c30ba78f1515a4fd84eba3f7afb39970ebd15d6'
PRIOR_STATE_SHA = '5a494c50278949e3b44efd25ac96eacfb071c437a36d47b2bb36f4367beb7a1b'
PACKAGE_FILES_SHA = '5ce810d1fd6c661442d32a51e4f5d51a1de187e17b835661e6846c0a5683a2f2'
PACKAGE_DIRECTORY = Path('/var/backups/proofofwork-ui/cleanup-evidence')
CONTROLLER = 'deploy/ui-retention/lifecycle_remote.py'
CAPACITY_SHA = 'd38a524da2d9ba5c035dc62acf4880d7235f32d49e7a4c0d7c1a77f6715aae99'
SCRATCH_APPROVAL = '512d190246031cbaa5ff8ceec32955ddfa742a4c893e0777d03f6af0967459a8'
SCRATCH_INTENT = Path('/var/lib/proofofwork-ui-scratch-capacity') / SCRATCH_APPROVAL / 'intent.json'
PREVIOUS = {'stager': '87ab4269461a91cf89ed50d6ddb81d116a35eb78f7cbcb6b4536946b5bbeb314',
            'publisher': '9aaba2b7378c1ddd38ad88a0d20322dd467d5dbd2393737ad1308349b350e22a'}
SOURCE = {'stager': 'deploy/proofofwork-ui-release-stage.py', 'publisher': 'deploy/proofofwork-ui-release-publish.sh'}
BINARY = {'stager': Path('/usr/local/sbin/proofofwork-ui-release-stage'), 'publisher': Path('/usr/local/sbin/proofofwork-ui-release-publish')}
STORE = Path('/var/lib/proofofwork-ui-amo-stage')
CONFIG = Path('/etc/proofofwork-retention/ui-lifecycle.json')
STATE = Path('/var/lib/proofofwork-ui-retention/state.json')
CAPACITY = Path('/usr/local/sbin/proofofwork-ui-capacity')
SELF = 'deploy/publish/amo_stage_installer.py'
HASH = re.compile('[a-f0-9]{64}')
MAX = 1024 * 1024
ENV = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_OPTIONAL_LOCKS': '0',
       'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_NO_LAZY_FETCH': '1'}


def need(value, message):
    if not value:
        raise ValueError(message)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def checked_approval(a):
    fields = {'schema', 'commit', 'tree', 'releaseId', 'publicationAttempt', 'sourceSha256', 'surfacesSha256',
              'buildReceiptSha256', 'inventorySha256', 'helperHashes', 'pair', 'configSha256', 'stateSha256'}
    need(type(a) is dict and set(a) == fields and a['schema'] == 'pow-ui-amo-direct-stage-approval-v1',
         'Unexpected approval schema')
    need(all(isinstance(a[k], str) and re.fullmatch('[a-f0-9]{40}', a[k]) for k in ('commit', 'tree'))
         and a['commit'] != BASE and re.fullmatch(a['commit'][:12] + '-[0-9]{8}T[0-9]{6}Z', a['releaseId'])
         and re.fullmatch('[a-z0-9][a-z0-9-]{0,30}', a['publicationAttempt']), 'Invalid successor identity')
    need(a['configSha256'] != PRIOR_CONFIG_SHA and a['stateSha256'] != PRIOR_STATE_SHA and a['pair'] == PAIR,
         'Protected baseline differs')
    need(set(a['helperHashes']) == set(SOURCE) and all(isinstance(h, str) and HASH.fullmatch(h)
         for h in [*(a[k] for k in fields if k.endswith('Sha256')), *a['helperHashes'].values()]),
         'Missing exact input digest')
    need(all(a['helperHashes'][k] != PREVIOUS[k] for k in SOURCE), 'Both changed helpers must be reviewed')


def identity(s):
    return [s.st_dev, s.st_ino, s.st_uid, s.st_gid, s.st_mode, s.st_nlink, s.st_size, s.st_mtime_ns]


def safe_directory(p, private=False):
    s = p.lstat()
    need(p.is_absolute() and p.resolve(strict=True) == p and stat.S_ISDIR(s.st_mode)
         and (s.st_uid, s.st_gid) == (os.geteuid(), os.getegid()) and not s.st_mode & 0o7022
         and (not private or stat.S_IMODE(s.st_mode) == 0o700), 'Unsafe journal or helper directory')


def readinfo(path, limit=MAX, mode=None):
    first = path.lstat()
    need(path.is_absolute() and path.resolve(strict=True) == path and stat.S_ISREG(first.st_mode)
         and first.st_uid == os.geteuid() and first.st_gid == os.getegid() and first.st_nlink == 1
         and not first.st_mode & 0o7022 and first.st_size <= limit
         and (mode is None or stat.S_IMODE(first.st_mode) == mode), 'Unsafe helper or receipt')
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME | os.O_NONBLOCK), 'rb') as f:
        need(os.fstat(f.fileno()) == first, 'File changed on open')
        raw = f.read(limit + 1)
        attrs = {k: os.getxattr(f.fileno(), k) for k in os.listxattr(f.fileno())}
        need(len(raw) == first.st_size and identity(os.fstat(f.fileno())) == identity(first)
             and path.lstat().st_ctime_ns == first.st_ctime_ns and identity(path.lstat()) == identity(first),
             'File changed during inspection')
    return raw, {'sha256': sha(raw), 'identity': identity(first), 'xattrs': {k: sha(v) for k,v in attrs.items()}}, attrs


def syncdir(p):
    fd = os.open(p, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def ensure_dir(p):
    if not os.path.lexists(p):
        p.mkdir(mode=0o700)
        syncdir(p.parent)
    safe_directory(p, private=True)


def create(p, raw, mode=0o600, source=None):
    # Link only the complete, flushed inode. A partial write has no pathname.
    safe_directory(p.parent, private=True)
    fd = os.open(p.parent, os.O_RDWR | os.O_TMPFILE, mode)
    with os.fdopen(fd, 'wb') as f:
        f.write(raw)
        f.flush()
        os.fchmod(fd, mode)
        if source is not None:
            _, observed, attrs = readinfo(source, mode=mode)
            for k in set(os.listxattr(fd)) - set(attrs):
                os.removexattr(fd, k)
            for k, v in attrs.items():
                os.setxattr(fd, k, v)
            os.utime(fd, ns=(source.stat().st_atime_ns, observed['identity'][-1]))
            need(os.fstat(fd).st_mode == observed['identity'][4], 'Replacement mode differs')
        os.fsync(fd)
        parent = os.open(p.parent, os.O_DIRECTORY | os.O_NOFOLLOW | os.O_RDONLY)
        try:
            os.link('/proc/self/fd/' + str(fd), p.name, dst_dir_fd=parent, follow_symlinks=True)
            os.fsync(parent)
        finally:
            os.close(parent)


def exchange(a, b):
    if ctypes.CDLL(None, use_errno=True).renameat2(-100, os.fsencode(a), -100, os.fsencode(b), 2):
        raise OSError(ctypes.get_errno(), 'Atomic helper exchange failed')
    syncdir(a.parent)
    syncdir(b.parent)


def operate(action, store, binaries, approval, payloads, protected, capacity, checkpoint=lambda name: None,
            verify_complete=None):
    """Execute only under the caller's verified native deployment lock."""
    need(action in ('prepare', 'apply', 'rollback', 'status'), 'Unexpected action')
    checked_approval(approval)
    need(set(payloads) == set(binaries) == set(SOURCE) and
         all(0 < len(v) <= MAX and sha(v) == approval['helperHashes'][k] for k,v in payloads.items()),
         'Replacement helper bytes differ from approval')
    verify_complete = protected if verify_complete is None else verify_complete
    verify_complete()
    for path in binaries.values():
        safe_directory(path.parent)
    safe_directory(store.parent)
    digest = sha(encoded(approval))
    journal = store / digest
    names = {'approval.json', 'intent.json', 'qualified.json', 'installed.json', 'reversing.json', 'rolled-back.json', *SOURCE}
    if action != 'status':
        capacity()
    if action == 'prepare':
        ensure_dir(store)
        ensure_dir(journal)
    safe_directory(store, True)
    safe_directory(journal, True)
    need(set(os.listdir(journal)) <= names, 'Foreign journal entry')

    def seal(filename, value, may_create=True):
        path = journal/filename
        raw = encoded(value)
        if not os.path.lexists(path):
            need(may_create and action != 'status', 'Missing prerequisite ' + filename)
            create(path, raw)
            checkpoint(filename)
        need(readinfo(path, mode=0o600)[0] == raw, 'Conflicting receipt ' + filename)
        return sha(raw)

    intentpath = journal/'intent.json'
    if not os.path.lexists(journal/'approval.json'):
        need(action == 'prepare' and not os.listdir(journal), 'Missing journal approval')
    seal('approval.json', approval, action == 'prepare')
    if not os.path.lexists(intentpath):
        need(action == 'prepare' and set(os.listdir(journal)) <= {'approval.json', *SOURCE}, 'Incomplete intent')
        files = {}
        for name,p in binaries.items():
            before = readinfo(p, mode=0o755)[1]
            need(before['sha256'] == PREVIOUS[name], 'Installed helper differs from the accepted predecessor')
            staged = journal/name
            if not os.path.lexists(staged):
                create(staged, payloads[name], 0o755, p)
                checkpoint(name)
            after = readinfo(staged, mode=0o755)[1]
            need(after['sha256'] == approval['helperHashes'][name]
                 and before['identity'][0] == after['identity'][0]
                 and before['identity'][1] != after['identity'][1]
                 and before['identity'][2:6] == after['identity'][2:6]
                 and before['identity'][-1] == after['identity'][-1]
                 and after['xattrs'] == before['xattrs'], 'Unmatched replacement metadata or content')
            files[name] = {'before': before, 'after': after}
        seal('intent.json', {'schema':'pow-ui-amo-stage-intent-v1','approvalSha256':digest,'files':files})
    intent_raw = readinfo(intentpath, mode=0o600)[0]
    intent = json.loads(intent_raw)
    need(intent_raw == encoded(intent) and set(intent) == {'schema','approvalSha256','files'}
         and intent['schema'] == 'pow-ui-amo-stage-intent-v1' and intent['approvalSha256'] == digest
         and set(intent['files']) == set(SOURCE), 'Invalid intent')
    prefix = {'approvalSha256': digest, 'intentSha256': sha(intent_raw)}

    def positions():
        result = {}
        for k,path in binaries.items():
            pair = intent['files'][k]
            need(set(pair)=={'before','after'} and pair['before']['sha256']==PREVIOUS[k] and
                 pair['after']['sha256']==approval['helperHashes'][k], 'Intent pin differs')
            side, spare = readinfo(path, mode=0o755)[1], readinfo(journal/k, mode=0o755)[1]
            a, b = side['identity'], spare['identity']
            need(a[0] == b[0] and a[1] != b[1] and a[2:6] == b[2:6] and a[-1] == b[-1]
                 and side['xattrs'] == spare['xattrs'], 'Unrecognized helper inode metadata')
            if (side, spare) == (pair['before'],pair['after']):
                result[k] = 'before'
            elif (side, spare) == (pair['after'],pair['before']):
                result[k] = 'after'
            else:
                raise ValueError('Unrecognized helper inode or contents')
        return result

    pos = positions()
    qualified = {'schema':'pow-ui-amo-stage-qualified-v1', **prefix}
    qsha = seal('qualified.json', qualified, action == 'prepare' and set(pos.values()) == {'before'})
    end = {**prefix,'qualificationSha256':qsha}
    installed = {'schema':'pow-ui-amo-stage-installed-v1', **end}
    reversing = {'schema':'pow-ui-amo-stage-reversing-v1', **end}
    rolled = {'schema':'pow-ui-amo-stage-rolled-back-v1', **end}
    exists = lambda filename: os.path.lexists(journal/filename)
    for name,value in [('installed.json',installed),('reversing.json',reversing),('rolled-back.json',rolled)]:
        if exists(name):
            seal(name,value,False)
    need(not exists('rolled-back.json') or (exists('reversing.json') and set(pos.values()) == {'before'}),
         'Invalid closed reversal')
    need(not exists('installed.json') or exists('reversing.json') or set(pos.values()) == {'after'},
         'Installed receipt differs from helper positions')
    if action == 'apply':
        need(not exists('reversing.json'), 'Reversal already requested')
    if action in ('apply','rollback'):
        if action == 'rollback':
            seal('reversing.json',reversing)
        wanted = 'after' if action == 'apply' else 'before'
        order = list(SOURCE) if action == 'apply' else list(reversed(SOURCE))
        for k in order:
            if positions()[k] != wanted:
                protected()
                need(positions()[k] != wanted,'Helper moved during final check')
                exchange(binaries[k],journal/k)
                checkpoint('exchange-'+k+'-'+wanted)
                need(positions()[k] == wanted,'Helper exchange incomplete')
        verify_complete()
        need(set(positions().values()) == {wanted},'Unexpected final helper positions')
        if action == 'apply':
            seal('installed.json',installed)
        else:
            seal('rolled-back.json',rolled)
    active = exists('installed.json') and not exists('reversing.json')
    protected()
    return {'phase':action, 'active':active, 'positions':positions(), 'approvalSha256':digest,
            'intentSha256':sha(intent_raw),'rollbackComplete':exists('rolled-back.json')}


def sealed_approval(path, expected):
    raw = readinfo(path.absolute(), 16384)[0]
    need(HASH.fullmatch(expected) and len(raw) <= 16384 and sha(raw) == expected, 'Wrong approval digest')
    a = json.loads(raw)
    need(raw == encoded(a), 'Approval requires canonical JSON')
    checked_approval(a)
    return a


def pack(approval, receipt_path, request_path, destination, root=None):
    checked_approval(approval)
    root = Path(__file__).resolve().parents[2] if root is None else root
    def git(*args):
        return subprocess.check_output(['/usr/bin/git','-c','core.fsmonitor=false','-c','core.untrackedCache=false',
                                        '-C',str(root),*args],env=ENV,timeout=60)
    commit, tree = approval['commit'],approval['tree']
    need(git('rev-parse','HEAD','HEAD^{tree}').decode().splitlines()==[commit,tree]
         and not git('status','--porcelain','--untracked-files=all'), 'Exact clean successor checkout required')
    git('merge-base','--is-ancestor',BASE,commit)
    receipt_raw=readinfo(receipt_path.absolute(),65536)[0]
    need(len(receipt_raw)<=65536 and sha(receipt_raw)==approval['buildReceiptSha256'], 'Wrong build receipt')
    receipt=json.loads(receipt_raw)
    need(all(receipt[k]==approval[k] for k in ('commit','tree','releaseId')) and
         receipt['releaseFormat']=='proofofwork-ui-release-v6' and
         all(receipt['bundles'][k]['sha256']==approval[k+'Sha256'] for k in ('source','surfaces')),
         'Wrong build inputs')
    request=json.loads(readinfo(request_path.absolute(),65536)[0])
    inventory=readinfo(Path(str(request_path.absolute())+'.zlib'),8*MAX)[0]
    need(all(request[k]==approval[k] for k in ('commit','tree','releaseId','surfacesSha256'))
         and request['model']=='proof-ui-closed-input-v1' and 'inputCompactorSha256' in request
         and request['inventorySha256']==sha(inventory)==approval['inventorySha256']
         and all(request['helperHashes'][k]==h for k,h in approval['helperHashes'].items()),
         'Closed input does not match the approved build or inventory')
    payload={}
    for k,relative in SOURCE.items():
        raw=git('show',commit+':'+relative)
        need(0<len(raw)<=MAX and raw==(root/relative).read_bytes() and sha(raw)==approval['helperHashes'][k],
             'Helper differs from approved committed bytes')
        payload[k]=base64.b64encode(raw).decode()
    need(git('show',commit+':'+SELF)==Path(__file__).resolve().read_bytes(), 'Installer differs from reviewed source')
    create(destination.absolute(),encoded({'approvalSha256':sha(encoded(approval)),'helpers':payload}))


def migrated_controller(approval):
    # The full manifest includes its own release commit and tree. Pin the reviewed
    # file map first, then bind that map to this build's observed package/config.
    raw = readinfo(CONFIG)[0]
    need(sha(raw) == approval['configSha256'], 'Unexpected lifecycle configuration')
    config = json.loads(raw)
    need(config['sourceCommit'] == approval['commit'] and config['sourceTree'] == approval['tree'],
         'Wrong lifecycle package source')
    pin = config['package']['sha256']
    need(isinstance(pin, str) and HASH.fullmatch(pin), 'Invalid lifecycle package pin')
    path = PACKAGE_DIRECTORY / ('ui-lifecycle-tools-' + pin)
    need(config['package']['path'] == str(path), 'Unexpected lifecycle package path')
    raw = readinfo(path/'package.json')[0]
    need(sha(raw) == pin, 'Wrong lifecycle package digest')
    manifest = json.loads(raw)
    need(manifest['schema'] == 'pow-ui-retention-package-v1' and manifest['sourceCommit'] == approval['commit']
         and manifest['sourceTree'] == approval['tree'] and sha(encoded(manifest['files'])) == PACKAGE_FILES_SHA,
         'Lifecycle package differs from reviewed committed files')
    controller = path/CONTROLLER
    pin = manifest['files'][CONTROLLER]
    need(config['controller'] == {'path': str(controller), 'sha256': pin['sha256']}, 'Wrong lifecycle controller')
    code = readinfo(controller, 2*MAX)[0]
    need(sha(code) == pin['sha256'] and len(code) == pin['bytes'], 'Wrong installed lifecycle controller')
    return controller, code


def require_completed_migration(status, approval):
    scratch = status.get('verifiedScratchCapacity')
    need(status['ok'] is True and status['pair'] == PAIR and status['stateSha256'] == approval['stateSha256']
         and status['configSha256'] == approval['configSha256'] and status['publicationHealthy'] is True
         and status['retentionComplete'] is True and status['unfinishedIntents'] == [],
         'Unhealthy or changed baseline')
    need(isinstance(scratch, dict) and scratch == status['binding'].get('scratchCapacity')
         and scratch['model'] == 'verified-ui-scratch-successor-v1' and scratch['scratchBudgetBytes'] == 7*1024**3
         and scratch['approvalSha256'] == SCRATCH_APPROVAL
         and all(isinstance(scratch.get(k), str) and HASH.fullmatch(scratch[k])
                 for k in ('intentSha256', 'installedSha256')),
         'Missing verified 7 GiB scratch migration')
    raw = readinfo(SCRATCH_INTENT, 64*MAX)[0]
    need(sha(raw) == scratch['intentSha256'], 'Capacity migration intent differs')
    intent = json.loads(raw)
    protected = intent['protected']
    need(intent['commit'] == approval['commit'] and intent['tree'] == approval['tree']
         and protected['configSha256'] == approval['configSha256'] and protected['stateSha256'] == approval['stateSha256']
         and protected['pair'] == PAIR, 'Grant does not bind the exact migrated completion')


def installed(action, approval, frame_path, installer_sha):
    need(sys.flags.isolated and not sys.flags.optimize and os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0
         and socket.gethostname()=='ubuntu-4gb-hel1-1','Require isolated root on the UI receiver')
    interfaces=json.loads(subprocess.check_output(['/usr/sbin/ip','-j','-4','address','show'],env=ENV,timeout=10))
    need(any(addr.get('local')=='77.42.91.106' for interface in interfaces for addr in interface.get('addr_info',[])),
         'UI receiver interface differs from the native release host')
    need(readinfo(Path(__file__).resolve())[1]['sha256']==installer_sha and HASH.fullmatch(installer_sha),
         'Installer differs from the approved digest')
    frame_raw=readinfo(frame_path.absolute(),4*MAX)[0]
    frame=json.loads(frame_raw)
    need(frame_raw==encoded(frame) and set(frame)=={'approvalSha256','helpers'} and
         frame['approvalSha256']==sha(encoded(approval)) and set(frame['helpers'])==set(SOURCE),'Wrong helper frame')
    payloads={k:base64.b64decode(raw, validate=True) for k,raw in frame['helpers'].items()}
    controller, controller_bytes = migrated_controller(approval)
    ns={'__name__':'_verified_amo_lifecycle','__file__':str(controller)}
    exec(compile(controller_bytes, str(controller), 'exec'), ns)
    runtime=ns['installed_runtime'](CONFIG,approval['configSha256'])
    fd=runtime.S.lock(runtime.layout)
    try:
        runtime.lock_fd=fd
        def check():
            runtime.S.require_execution_lock(fd,runtime.layout)
            need(readinfo(CONFIG)[1]['sha256']==approval['configSha256'] and
                 readinfo(STATE,64*MAX)[1]['sha256']==approval['stateSha256'] and
                 readinfo(CAPACITY)[1]['sha256']==CAPACITY_SHA,
                 'Protected configuration/state differs')
            manifests = [(Path('/var/www'), '6109f2e61afcc8fbcb9a15e68e133550194c816726f5fca9537d21973ebeb8e0'),
                         (Path('/var/backups/proofofwork-ui/rollback-roots')/('proofofwork-www-pre-'+PAIR['current']),
                          '38504f8cf4be8e277c613f84f4cb34837ae441c288125931e431b17b43882a15')]
            for root, expected in manifests:
                need(readinfo(root/'.proofofwork-ui-release',65536)[1]['sha256']==expected,'Changed protected manifest')
        def complete():
            check()
            status=runtime.status({'requireComplete':True})
            require_completed_migration(status,approval)
            runtime.S.require_execution_lock(fd,runtime.layout)
        def budget():
            runtime.S.capacity(runtime.layout,'amo-direct-stage-helper-install',additional_bytes=8*MAX)
        return operate(action,STORE,BINARY,approval,payloads,check,budget,verify_complete=complete)
    finally:
        runtime.lock_fd=None
        os.close(fd)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('pack','prepare','apply','status','rollback'))
    parser.add_argument('--approval',required=True,type=Path)
    parser.add_argument('--approval-sha256',required=True)
    parser.add_argument('--build-receipt',type=Path)
    parser.add_argument('--closed-request',type=Path)
    parser.add_argument('--frame',required=True,type=Path)
    parser.add_argument('--installer-sha256')
    a=parser.parse_args()
    os.umask(0o077)
    approval=sealed_approval(a.approval,a.approval_sha256)
    if a.action=='pack':
        need(a.build_receipt and a.closed_request and not a.installer_sha256,'Pack requires a build receipt and closed request')
        pack(approval,a.build_receipt,a.closed_request,a.frame)
    else:
        need(a.installer_sha256 and not a.build_receipt and not a.closed_request,'Installation requires independently reviewed installer digest')
        print(json.dumps(installed(a.action,approval,a.frame,a.installer_sha256),sort_keys=True))


if __name__=='__main__':
    main()
