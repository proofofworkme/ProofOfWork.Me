#!/usr/bin/python3 -I
"""Exact six-payload relocation control requiring approved manifest and real custody.

Production entry point has no path/layout override. Tests use synthetic local trees.
Do not dispatch until the owner directs release handoff after independent review.
"""
import argparse
import ctypes
import datetime
import uuid
from contextlib import contextmanager
import base64
import collections
from decimal import Decimal
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import shutil
import stat
import subprocess
import sys
import tarfile

BASE = Path('/var/backups/proofofwork-ui/transport-evidence')
RELEASES = ('38ac6e2bff2a-20261003T190512Z', 'd5a8493119ba-20261003T222517Z', '01ec4968caa9-20261007T150110Z')
TARGETS = tuple(name + '/proofofwork-ui-' + kind + '-' + name for name in RELEASES for kind in ('source', 'surfaces'))
FOREIGN = '7bad9495d118-20261006T180919Z'
HOLD = Path('/etc/proofofwork-retention/audit28.hold')
HOLD_HASH = 'e9aca6e22b1dc36b714ed663051f8bc20d9479efa4173474e0b6b771958ca6a4'
LOCK = Path('/run/proofofwork-ui/deploy.lock')
LOCAL_DESTINATION = '/home/sixer/ProofOfWork.Me/local/browser-dns-transport-custody/approval-20261008'
APPROVAL_HASH = 'cba4fa57c76b3e958df7120dd82224eb8c7f813513747973c66623c1abbbc1cb'
STATE_ROOT = BASE / 'browser-dns-relocation-state'
RESTORE_ARCHIVE = STATE_ROOT / APPROVAL_HASH / 'inbound-restore' / 'historical-ui-payloads.tgz'
MAX_ROWS = 100000
MAX_REQUEST = 32 * 1024 * 1024

def require(value, message):
    if not value:
        raise ValueError(message)

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()

def sha(value):
    return hashlib.sha256(value).hexdigest()

def digest_file(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        value = hashlib.file_digest(stream, 'sha256').hexdigest()
        require(os.fstat(stream.fileno()) == before, 'File descriptor changed while hashing')
    require(path.lstat() == before, 'File pathname changed while hashing')
    return value

def safe_relative(value):
    require(isinstance(value, str) and value and '\\' not in value and
            not any(ord(c) < 32 or ord(c) == 127 for c in value), 'Unsafe path text')
    path = PurePosixPath(value)
    require(not path.is_absolute() and path.as_posix() == value and
            all(part not in ('', '.', '..') for part in path.parts), 'Unsafe path traversal')
    return path

def target_for(value):
    safe_relative(value)
    return next((target for target in TARGETS if value == target or value.startswith(target + '/')), None)

def census(base, names, closed_symlinks=True):
    rows = []
    for name in names:
        safe_relative(name)
        root = base / name
        require(root.resolve(strict=True) == root and root.is_dir() and not root.is_symlink(), 'Unsafe target root')
        pending = [root]
        while pending:
            path = pending.pop()
            info = path.lstat()
            relative = path.relative_to(base).as_posix()
            safe_relative(relative)
            row = {'path': relative, 'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid,
                   'gid': info.st_gid, 'mtimeNs': info.st_mtime_ns, 'ctimeNs': info.st_ctime_ns,
                   'device': info.st_dev, 'inode': info.st_ino, 'links': info.st_nlink,
                   'allocatedBytes': info.st_blocks * 512,
                   'xattrs': {key: base64.b64encode(os.getxattr(path, key, follow_symlinks=False)).decode()
                              for key in sorted(os.listxattr(path, follow_symlinks=False))}}
            if stat.S_ISDIR(info.st_mode):
                row['kind'] = 'directory'
                fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NOATIME)
                try:
                    pending.extend(path / child for child in sorted(os.listdir(fd), reverse=True))
                finally:
                    os.close(fd)
            elif stat.S_ISREG(info.st_mode):
                row.update(kind='file', size=info.st_size, sha256=digest_file(path))
            elif stat.S_ISLNK(info.st_mode):
                link = os.readlink(path)
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(relative), link))
                if closed_symlinks:
                    require(not link.startswith('/') and (resolved == name or resolved.startswith(name + '/')), 'Escaping symlink')
                row.update(kind='symlink', target=link)
            else:
                raise ValueError('Special file')
            require(file_identity(path.lstat()) == file_identity(info), 'Path identity changed during census')
            rows.append(row)
            require(len(rows) <= MAX_ROWS, 'Census exceeds row bound')
    rows.sort(key=lambda row: row['path'])
    return rows

def validate_rows(rows, production=True):
    require(isinstance(rows, list) and 0 < len(rows) <= MAX_ROWS, 'Invalid census rows')
    require(rows == sorted(rows, key=lambda row: row['path']), 'Noncanonical census order')
    require(len({row['path'] for row in rows}) == len(rows), 'Duplicate row')
    counts = collections.Counter((row['device'], row['inode']) for row in rows if row['kind'] == 'file')
    devices = {row['device'] for row in rows}
    require(len(devices) == 1, 'Multiple filesystems')
    for row in rows:
        require(target_for(row['path']) is not None, 'Row outside exact six targets')
        require(row['kind'] in ('file', 'directory', 'symlink'), 'Unsupported row kind')
        if production:
            require(row['uid'] == row['gid'] == 0, 'Foreign owner')
            if row['kind'] != 'symlink':
                require(not row['mode'] & 0o7022, 'Unsafe writable or special mode')
        if row['kind'] == 'file':
            require(row['links'] == counts[(row['device'], row['inode'])] == 1, 'External or unexpected hardlink')
            require(re.fullmatch('[0-9a-f]{64}', row['sha256']), 'Invalid file SHA')
        for value in row['xattrs'].values():
            require(len(base64.b64decode(value, validate=True)) <= 65536, 'Oversized xattr')
    require(all(any(row['path'] == name and row['kind'] == 'directory' for row in rows) for name in TARGETS), 'Missing target root')

def validate_manifest(manifest, expected_hash):
    require(sha(canonical(manifest)) == expected_hash, 'Approval manifest hash mismatch')
    require(manifest['format'] == 'proof-of-work-browser-dns-six-payload-relocation-proposal-v1', 'Invalid manifest model')
    require(manifest['remoteBase'] == str(BASE) and tuple(manifest['targets']) == TARGETS, 'Target scope changed')
    require(manifest['excludedForeignTarget'] == str(BASE / FOREIGN), 'Foreign target fence changed')
    require(manifest['holdSha256'] == HOLD_HASH, 'Retention hold pin changed')
    require(manifest['localCustodyDestination'] == LOCAL_DESTINATION, 'Custody destination changed')
    require(manifest['actualCustodyExecuted'] is False and manifest['actualRemovalExecuted'] is False, 'Proposal status changed')
    validate_rows(manifest['rows'])
    require(sha(canonical(manifest['rows'])) == manifest['sourceRowsSha256'], 'Source census commitment mismatch')
    require(sum(row['allocatedBytes'] for row in manifest['rows']) == manifest['allocatedBytesRegained'], 'Allocation mismatch')

def require_custody(manifest, custody):
    require(custody.get('archiveVerified') is True and custody.get('restoreTestVerified') is True and
            custody.get('sourceStable') is True and custody.get('durableCopyVerified') is True, 'Actual verified durable custody/restore is required')
    require(custody.get('approvalManifestSha256') == APPROVAL_HASH, 'Custody approval changed')
    require(custody.get('actualCustodyExecuted') is True and custody.get('actualRestoreExecuted') is True, 'Actual custody execution required')
    require(custody.get('externalHardlinks') == [], 'Custody external links')
    require(custody.get('rows') == manifest['rows'], 'Custody rows changed')
    require(custody.get('sourceRowsSha256') == manifest['sourceRowsSha256'], 'Custody source identity changed')
    require(custody.get('archive') == LOCAL_DESTINATION + '/historical-ui-payloads.tgz', 'Unapproved archive destination')
    require(re.fullmatch('[0-9a-f]{64}', custody.get('archiveSha256', '')), 'Invalid custody archive pin')
    require(custody.get('ownershipRecordedInArchive') is True and custody.get('hardlinkTopologyVerified') is True and
            custody.get('xattrsVerified') is True and custody.get('membersVerified') is True, 'Incomplete custody restoration proof')

def verify_tar(path, rows):
    by_path = {row['path']: row for row in rows}
    observed = set()
    with (tarfile.open(fileobj=path,mode='r:gz') if hasattr(path,'read') else tarfile.open(path,'r:gz')) as archive:
        for member in archive:
            name = member.name.rstrip('/')
            safe_relative(name)
            require(name in by_path and name not in observed, 'Unknown or duplicate tar member')
            observed.add(name)
            row = by_path[name]
            require((member.mode, member.uid, member.gid) == (row['mode'], row['uid'], row['gid']), 'Tar ownership/mode mismatch')
            require(int(Decimal(str(member.pax_headers.get('mtime', member.mtime))) * 1000000000) == row['mtimeNs'], 'Tar modification time mismatch')
            archive_xattrs = {key.removeprefix('SCHILY.xattr.'): base64.b64encode(value.encode('utf-8', 'surrogateescape')).decode()
                              for key, value in member.pax_headers.items() if key.startswith('SCHILY.xattr.')}
            require(archive_xattrs == row['xattrs'], 'Tar xattrs mismatch')
            if row['kind'] == 'file':
                require(member.isfile() and not member.islnk(), 'Unexpected tar hardlink/special member')
                require(member.size == row['size'], 'Tar size mismatch')
                with archive.extractfile(member) as stream:
                    require(hashlib.file_digest(stream, 'sha256').hexdigest() == row['sha256'], 'Tar content mismatch')
            elif row['kind'] == 'directory':
                require(member.isdir(), 'Tar directory mismatch')
            else:
                require(member.issym() and member.linkname == row['target'], 'Tar symlink mismatch')
                target = posixpath.normpath(posixpath.join(posixpath.dirname(name), member.linkname))
                require(not member.linkname.startswith('/') and target_for(target) == target_for(name), 'Tar link escape')
    require(observed == set(by_path), 'Tar member omitted')

def compare_restored(base, expected):
    actual = census(base, TARGETS)
    fields = ('path', 'kind', 'mode', 'mtimeNs', 'size', 'sha256', 'target', 'xattrs')
    require([{key: row[key] for key in fields if key in row} for row in actual] ==
            [{key: row[key] for key in fields if key in row} for row in expected], 'Restored bytes/metadata diverge')
    require(all(row['links'] == 1 for row in actual if row['kind'] == 'file'), 'Restored hardlink topology changed')

def refuse_references(paths):
    def check(value):
        require(not any(value == path or value.startswith(path + '/') for path in paths), 'Process/config/mount reference')
    for proc in Path('/proc').glob('[0-9]*'):
        for link in [proc / 'cwd', proc / 'root', proc / 'exe', *list((proc / 'fd').glob('*'))]:
            try:
                check(os.readlink(link).removesuffix(' (deleted)'))
            except OSError:
                pass
        for name in ('cmdline', 'maps'):
            try:
                data = (proc / name).read_bytes()
                require(not any(path.encode() in data for path in paths), 'Process candidate reference')
            except OSError:
                pass
    for root in (Path('/etc/systemd/system'), Path('/etc/caddy'), Path('/var/www')):
        for path in root.rglob('*'):
            if path.is_symlink():
                check(str(path.resolve()))
            elif root != Path('/var/www') and path.is_file() and path.stat().st_size < 1048576:
                require(not any(value.encode() in path.read_bytes() for value in paths), 'Configuration candidate reference')
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        check(line.split()[4])

def protected_snapshot():
    # Fresh closure permits a legitimate Permission release before this action.
    # The closure is captured under the same lock and fenced before every removal.
    roots = [Path('/var/www'), *sorted(Path('/var/backups/proofofwork-ui/rollback-roots').iterdir()),
             Path('/var/backups/proofofwork-ui/releases'), Path('/etc/caddy'), Path('/etc/systemd/system')]
    out = {}
    for root in roots:
        if not root.is_dir():
            continue
        out[str(root)] = sha(canonical(census(root.parent, (root.name,), closed_symlinks=False)))
    require(digest_file(HOLD) == HOLD_HASH, 'Persistent retention hold changed')
    out['hold'] = HOLD_HASH
    for unit in ('proofofwork-ui-release-prune.timer', 'proofofwork-ui-storage-prune.timer'):
        result = subprocess.check_output(['/usr/bin/systemctl', 'show', unit, '--property=LoadState,ActiveState,UnitFileState'], text=True)
        require('LoadState=masked' in result and 'ActiveState=inactive' in result and 'UnitFileState=masked' in result, 'Prune timer pin changed')
        out[unit] = result
    return out

def parent_snapshot():
    output = {}
    for release in RELEASES:
        parent = BASE / release
        for path in sorted(parent.iterdir()):
            relative = path.relative_to(BASE).as_posix()
            if relative in TARGETS:
                continue
            output[relative] = sha(canonical(census(BASE, (relative,)))) if path.is_dir() else digest_file(path)
    return output

def identity_matches(info, row, directory=False):
    fields = [('st_dev', 'device'), ('st_ino', 'inode'), ('st_uid', 'uid'), ('st_gid', 'gid')]
    if not directory:
        fields.extend([('st_nlink', 'links'), ('st_mtime_ns', 'mtimeNs'), ('st_ctime_ns', 'ctimeNs')])
    return stat.S_IMODE(info.st_mode) == row['mode'] and all(getattr(info, key) == row[value] for key, value in fields)

def descriptor_parent(root_fd, parts, known, base=None):
    fd = os.dup(root_fd)
    prefix = []
    try:
        for part in parts:
            prefix.append(part)
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
            key = '/'.join(prefix)
            if key in known:
                require(identity_matches(os.fstat(fd), known[key], directory=True), 'Directory descriptor drift')
                if base is not None:require(identity_matches((base/key).lstat(),known[key],directory=True),'Directory pathname drift')
        return fd
    except BaseException:
        os.close(fd)
        raise

def remove_verified_targets(base, expected_rows, check_protected, receipt=lambda target, stage, count: None):
    # Proposal code: invoked only by the approved production entry point or tests.
    require(census(base, TARGETS) == expected_rows, 'Source drift before removal')
    require(base.resolve(strict=True) == base, 'Base path is not canonical')
    root_fd = os.open(base, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    base_info = os.fstat(root_fd)
    require(base.lstat() == base_info, 'Base descriptor drift')
    known = {row['path']: row for row in expected_rows}
    for release in RELEASES:
        info = (base / release).lstat()
        require(stat.S_ISDIR(info.st_mode), 'Parent type drift')
        known[release] = {'device':info.st_dev,'inode':info.st_ino,'uid':info.st_uid,'gid':info.st_gid,'mode':stat.S_IMODE(info.st_mode)}
    try:
        for target in TARGETS:
            require((base.lstat().st_dev, base.lstat().st_ino) == (base_info.st_dev, base_info.st_ino), 'Base pathname changed')
            check_protected()
            rows = [row for row in expected_rows if row['path'] == target or row['path'].startswith(target + '/')]
            require(census(base, (target,)) == rows, 'Source drift at removal boundary')
            receipt(target, 'before', 0)
            removed = 0
            # Delete only frozen rows. New/unreviewed entries survive and cause
            # rmdir to refuse rather than becoming recursive deletion scope.
            for row in sorted(rows, key=lambda value: (len(PurePosixPath(value['path']).parts), value['path']), reverse=True):
                parts = PurePosixPath(row['path']).parts
                current_base=base.lstat()
                require((current_base.st_dev,current_base.st_ino,current_base.st_uid,current_base.st_gid,stat.S_IMODE(current_base.st_mode))==(base_info.st_dev,base_info.st_ino,base_info.st_uid,base_info.st_gid,stat.S_IMODE(base_info.st_mode)),'Base pathname changed during removal')
                parent_fd = descriptor_parent(root_fd, parts[:-1], known, base)
                try:
                    info = os.stat(parts[-1], dir_fd=parent_fd, follow_symlinks=False)
                    require(identity_matches(info, row, directory=row['kind'] == 'directory'), 'Frozen row identity drift')
                    if row['kind'] == 'directory':
                        require(stat.S_ISDIR(info.st_mode), 'Directory type drift')
                        xattrs={key:base64.b64encode(os.getxattr(base/row['path'],key,follow_symlinks=False)).decode() for key in sorted(os.listxattr(base/row['path'],follow_symlinks=False))}
                        require(xattrs==row['xattrs'],'Frozen directory xattrs drift')
                        os.rmdir(parts[-1], dir_fd=parent_fd)
                    else:
                        if row['kind'] == 'file':
                            fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME, dir_fd=parent_fd)
                            with os.fdopen(fd, 'rb') as source:
                                require(identity_matches(os.fstat(source.fileno()), row), 'File descriptor drift')
                                require(hashlib.file_digest(source, 'sha256').hexdigest() == row['sha256'], 'Frozen content drift')
                                require(identity_matches(os.fstat(source.fileno()), row), 'File changed before unlink')
                        else:
                            require(stat.S_ISLNK(info.st_mode) and os.readlink(parts[-1], dir_fd=parent_fd) == row['target'], 'Symlink drift')
                        require(identity_matches(os.stat(parts[-1], dir_fd=parent_fd, follow_symlinks=False), row), 'Path changed before unlink')
                        xattrs={key:base64.b64encode(os.getxattr(base/row['path'],key,follow_symlinks=False)).decode() for key in sorted(os.listxattr(base/row['path'],follow_symlinks=False))}
                        require(xattrs == row['xattrs'], 'Frozen xattrs drift')
                        os.unlink(parts[-1], dir_fd=parent_fd)
                    os.fsync(parent_fd)
                    removed += 1
                finally:
                    os.close(parent_fd)
            require(not os.path.lexists(base / target), 'Target survived removal')
            check_protected()
            receipt(target, 'after', removed)
    finally:
        os.close(root_fd)

def restore_verified_targets(base, archive, expected_rows, check_protected):
    # Review helper: archive was validated before extraction. The caller owns a
    # private empty destination; restoration never replaces any existing target.
    verify_tar(archive, expected_rows)
    require(base.resolve(strict=True) == base and base.is_dir() and not base.is_symlink(), 'Unsafe restore destination')
    info = base.lstat()
    require(info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) == 0o700, 'Restore destination must be private and caller-owned')
    require(not any(base.iterdir()), 'Restore destination must be empty')
    require(not any(os.path.lexists(base / name) for name in TARGETS), 'Restore target already exists')
    check_protected()
    subprocess.run(['/usr/bin/tar', '--xattrs', '--acls', '--same-permissions', '--no-same-owner',
                    '-xzf', str(archive), '-C', str(base)], check=True)
    compare_restored(base, expected_rows)
    check_protected()


def original_parent_objects(manifest):
    """Approved retained objects; parent mtime changes caused by target removal are excluded."""
    output={}
    for release in RELEASES:
        parent=BASE/release
        require(parent.resolve(strict=True)==parent and parent.is_dir() and not parent.is_symlink(), 'Unsafe historical parent')
        for path in sorted(parent.rglob('*')):
            relative=path.relative_to(BASE).as_posix()
            if target_for(relative):
                continue
            info=path.lstat()
            identity=[info.st_dev,info.st_ino,info.st_mode,info.st_nlink,info.st_uid,info.st_gid,info.st_size,info.st_mtime_ns,info.st_ctime_ns]
            output[str(path)]={'identity':identity,'sha256':digest_file(path) if stat.S_ISREG(info.st_mode) else None}
    require(output==manifest['preservedParentObjects'],'Approved retained parent object drift')
    return output


def fresh_protected_closure():
    """All current production/rollback/archive bytes and configuration, without following symlinks."""
    output=protected_snapshot()
    transport_names=sorted(p.name for p in BASE.iterdir() if p.name not in RELEASES and p!=STATE_ROOT)
    output['transportOtherNames']=transport_names
    for name in transport_names:
        output['transportOther:'+name]=sha(canonical(census(BASE,(name,),closed_symlinks=False)))
    # Content hashes and identities for live symlink referents outside the enumerated tree.
    for path in Path('/var/www').rglob('*'):
        if path.is_symlink():
            resolved=path.resolve(strict=True)
            require(not any(resolved==BASE/name or str(resolved).startswith(str(BASE/name)+'/') for name in TARGETS),'Protected live overlap')
            if resolved.is_dir():
                output['resolved:'+str(resolved)]=sha(canonical(census(resolved.parent,(resolved.name,),closed_symlinks=False)))
            elif resolved.is_file():
                output['resolved:'+str(resolved)]=digest_file(resolved)
    for unit in ('caddy.service','proofofwork-ui-backup.timer','proofofwork-ui-release-prune.timer','proofofwork-ui-storage-prune.timer'):
        output['service:'+unit]=subprocess.check_output(['/usr/bin/systemctl','show',unit,'--property=ActiveState,SubState,MainPID,UnitFileState,FragmentPath,DropInPaths'],text=True)
    output['mountsSha256']=sha(Path('/proc/self/mountinfo').read_bytes())
    return output


def private_directory(path, uid=0, gid=0):
    require(path.resolve(strict=True)==path,'Noncanonical private directory')
    info=path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid==uid and info.st_gid==gid and stat.S_IMODE(info.st_mode)==0o700,'Unsafe private directory')
    return info


def make_private_directory(path):
    require(path.parent.resolve(strict=True)==path.parent,'Unsafe private parent')
    path.mkdir(mode=0o700)
    private_directory(path)
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)


def create_receipt(directory,name,value):
    safe_relative(name)
    require('/' not in name,'Receipt is not a basename')
    private_directory(directory,os.geteuid(),os.getegid())
    data=canonical(value)+b'\n'
    fd=os.open(directory/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(fd,'wb',closefd=False) as out:
            out.write(data);out.flush();os.fsync(fd)
    finally:os.close(fd)
    fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
    return sha(data)


@contextmanager
def deployment_lock():
    info=LOCK.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid==info.st_gid==0 and info.st_nlink==1 and not stat.S_IMODE(info.st_mode)&0o7022,'Unsafe deployment lock')
    fd=os.open(LOCK,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        require(os.fstat(fd)==info,'Lock identity changed')
        # Never wait behind a foreign publisher; root coordinates the handoff.
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        require((LOCK.lstat().st_dev,LOCK.lstat().st_ino)==(info.st_dev,info.st_ino),'Lock replaced')
        yield
    finally:os.close(fd)


def rename_no_replace(source_fd,source_name,target_fd,target_name):
    require('/' not in source_name and '/' not in target_name,'Rename only a bound basename')
    libc=ctypes.CDLL(None,use_errno=True)
    fn=libc.renameat2
    fn.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
    fn.restype=ctypes.c_int
    result=fn(source_fd,os.fsencode(source_name),target_fd,os.fsencode(target_name),1)
    if result!=0:
        error=ctypes.get_errno()
        raise OSError(error,os.strerror(error),target_name)
    os.fsync(source_fd);os.fsync(target_fd)


def file_identity(info):
    return (info.st_dev,info.st_ino,info.st_mode,info.st_nlink,info.st_uid,info.st_gid,info.st_size,info.st_mtime_ns,info.st_ctime_ns)


def restore_capacity(base,rows,archive_bytes=0,fs=None):
    fs=fs if fs is not None else os.statvfs(base)
    unit=fs.f_frsize
    rounded=lambda n:((n+unit-1)//unit)*unit
    copy_bytes=sum(max(row['allocatedBytes'],rounded(row.get('size',unit)))+unit for row in rows)+4*unit
    inbound_bytes=rounded(archive_bytes)
    reserve=10*1024**3+64*1024**2
    needed_inodes=len(rows)+4+4096+(1 if archive_bytes else 0)
    require(fs.f_bavail*unit>=reserve+copy_bytes+inbound_bytes,'Restore capacity reserve would be breached')
    require(fs.f_favail>=needed_inodes,'Restore inode reserve would be breached')
    return {'availableBytes':fs.f_bavail*unit,'copyBoundBytes':copy_bytes,'inboundArchiveBoundBytes':inbound_bytes,'reserveBytes':reserve,'availableInodes':fs.f_favail,'neededInodes':needed_inodes}


def fsync_restored_tree(base,rows):
    for row in rows:
        if row['kind']=='file':
            fd=os.open(base/row['path'],os.O_RDONLY|os.O_NOFOLLOW)
            try:os.fsync(fd)
            finally:os.close(fd)
    directories={base,*[base/row['path'] for row in rows if row['kind']=='directory'],*[base/release for release in RELEASES]}
    for path in sorted(directories,key=lambda p:len(p.parts),reverse=True):
        fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(fd)
        finally:os.close(fd)


def dispatch_restore(base,stage,archive,rows,check_protected,receipt,original_owner=True,capacity_admission=True):
    """Private verified staging, then descriptor-bound atomic no-replace moves of six roots."""
    private_directory(stage,os.geteuid(),os.getegid())
    require(not any(stage.iterdir()),'Restore stage must be empty')
    if capacity_admission:restore_capacity(base,rows)
    require(base.resolve(strict=True)==base,'Unsafe transport base')
    require(not any(os.path.lexists(base/name) for name in TARGETS),'Restore target already exists')
    archive_fd=os.open(archive,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
    archive_info=os.fstat(archive_fd)
    with os.fdopen(os.dup(archive_fd),'rb') as stream:verify_tar(stream,rows)
    os.lseek(archive_fd,0,os.SEEK_SET)
    check_protected()
    require(file_identity(os.fstat(archive_fd))==file_identity(archive_info),'Restore archive descriptor drift')
    flags=['--same-owner'] if original_owner else ['--no-same-owner']
    try:
        subprocess.run(['/usr/bin/tar','--xattrs','--acls','--same-permissions',*flags,'-xzf','/proc/self/fd/'+str(archive_fd),'-C',str(stage)],pass_fds=(archive_fd,),check=True)
        require(file_identity(os.fstat(archive_fd))==file_identity(archive_info),'Restore archive changed during extraction')
    finally:os.close(archive_fd)
    compare_restored(stage,rows)
    fsync_restored_tree(stage,rows)
    if original_owner:
        actual=census(stage,TARGETS)
        require([(r['uid'],r['gid']) for r in actual]==[(r['uid'],r['gid']) for r in rows],'Restored original owner mismatch')
    base_fd=os.open(base,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    stage_fd=os.open(stage,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    base_info=os.fstat(base_fd)
    parents={release:(base/release).lstat() for release in RELEASES}
    try:
        for target in TARGETS:
            check_protected()
            require((base.lstat().st_dev,base.lstat().st_ino)==(base_info.st_dev,base_info.st_ino),'Restore base drift')
            release,name=target.split('/')
            parent_fd=os.open(release,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=base_fd)
            source_parent_fd=os.open(release,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=stage_fd)
            try:
                current=os.fstat(parent_fd);before=parents[release]
                require((current.st_dev,current.st_ino,current.st_uid,current.st_gid,stat.S_IMODE(current.st_mode))==(before.st_dev,before.st_ino,before.st_uid,before.st_gid,stat.S_IMODE(before.st_mode)),'Restore retained parent drift')
                actual=census(stage,(target,));expected=[r for r in rows if r['path']==target or r['path'].startswith(target+'/')]
                fields=('path','kind','mode','mtimeNs','size','sha256','target','xattrs')
                require([{k:r[k] for k in fields if k in r} for r in actual]==[{k:r[k] for k in fields if k in r} for r in expected],'Restore staged target drift')
                receipt(target,'before',len(expected))
                after=census(stage,(target,))
                require(after==actual,'Restore staged target drift at rename boundary')
                current_base=base.lstat()
                require((current_base.st_dev,current_base.st_ino,current_base.st_uid,current_base.st_gid,stat.S_IMODE(current_base.st_mode))==(base_info.st_dev,base_info.st_ino,base_info.st_uid,base_info.st_gid,stat.S_IMODE(base_info.st_mode)),'Restore base pathname drift at rename boundary')
                current_parent=(base/release).lstat()
                require((current_parent.st_dev,current_parent.st_ino,current_parent.st_uid,current_parent.st_gid,stat.S_IMODE(current_parent.st_mode))==(before.st_dev,before.st_ino,before.st_uid,before.st_gid,stat.S_IMODE(before.st_mode)),'Restore parent pathname drift at rename boundary')
                source_parent=(stage/release).lstat();source_bound=os.fstat(source_parent_fd)
                require(file_identity(source_parent)==file_identity(source_bound),'Restore source parent pathname drift')
                check_protected()
                rename_no_replace(source_parent_fd,name,parent_fd,name)
                check_protected()
                receipt(target,'after',len(expected))
            finally:
                os.close(parent_fd);os.close(source_parent_fd)
        compare_restored(base,rows)
    finally:
        os.close(base_fd);os.close(stage_fd)


def request_binding(request,options):
    manifest=request['manifest'];custody=request.get('custody',{})
    require(options.manifest_sha256==APPROVAL_HASH,'Unapproved manifest identity')
    validate_manifest(manifest,options.manifest_sha256)
    require(options.approve_exact_manifest==APPROVAL_HASH,'Exact human approval required')
    require_custody(manifest,custody)
    require(sha(canonical(custody))==options.custody_sha256,'Actual custody receipt commitment changed')
    require(custody['archiveSha256']==options.archive_sha256,'Actual archive commitment changed')
    return manifest,custody


def new_execution_directory():
    if not os.path.lexists(STATE_ROOT):make_private_directory(STATE_ROOT)
    private_directory(STATE_ROOT)
    approved=STATE_ROOT/APPROVAL_HASH
    if not os.path.lexists(approved):make_private_directory(approved)
    private_directory(approved)
    name=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')+'-'+uuid.uuid4().hex
    directory=approved/name
    make_private_directory(directory)
    return directory


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest-sha256',required=True)
    parser.add_argument('--mode',choices=('review','remove','restore','prepare-restore'),default='review')
    parser.add_argument('--approve-exact-manifest')
    parser.add_argument('--custody-sha256')
    parser.add_argument('--archive-sha256')
    parser.add_argument('--controller-sha256')
    options=parser.parse_args()
    raw=sys.stdin.buffer.read(MAX_REQUEST+1)
    require(len(raw)<=MAX_REQUEST,'Request byte bound')
    request=json.loads(raw)
    if options.mode=='review':
        validate_manifest(request['manifest'],options.manifest_sha256)
        print(json.dumps({'mode':'review','targets':list(TARGETS),'remoteMutation':False,'dispatchExecuted':False}))
        return
    require(sys.flags.isolated and os.geteuid()==os.getegid()==0,'Production writer requires isolated root')
    manifest,custody=request_binding(request,options)
    controller_path=Path(__file__).resolve(strict=True)
    require(digest_file(controller_path)==options.controller_sha256,'Controller bytes changed')
    require(not stat.S_IMODE(controller_path.lstat().st_mode)&0o7022 and controller_path.lstat().st_uid==0,'Unsafe controller permissions')
    with deployment_lock():
        original_parent_objects(manifest)
        paths=[str(BASE/name) for name in TARGETS]
        refuse_references(paths)
        closure=fresh_protected_closure()
        require(fresh_protected_closure()==closure,'Protected closure unstable before action')
        directory=new_execution_directory()
        details={'format':'proof-of-work-exact-six-payload-operation-v2','operation':options.mode,'approvalManifestSha256':APPROVAL_HASH,'custodySha256':options.custody_sha256,'archiveSha256':options.archive_sha256,'controllerSha256':options.controller_sha256,'sourceRowsSha256':manifest['sourceRowsSha256'],'targets':list(TARGETS),'protectedClosure':closure,'preservedParentObjects':manifest['preservedParentObjects'],'holdSha256':HOLD_HASH,'deploymentLockHeld':True,'requestSha256':sha(raw)}
        create_receipt(directory,'000-preflight.json',details)
        sequence=0
        def check():
            require(fresh_protected_closure()==closure,'Current protected closure drift')
            original_parent_objects(manifest)
            refuse_references(paths)
        def receipt(target,stage,count):
            nonlocal sequence
            sequence+=1
            create_receipt(directory,'%03d-target-%s.json'%(sequence,stage),{**details,'target':target,'stage':stage,'rowsRemovedOrRestored':count})
        try:
            if options.mode=='prepare-restore':
                admission=restore_capacity(BASE,manifest['rows'],custody['archiveBytes'])
                inbound=RESTORE_ARCHIVE.parent
                if not os.path.lexists(inbound):make_private_directory(inbound)
                private_directory(inbound)
                require(not any(inbound.iterdir()),'Inbound restore destination must be empty')
                create_receipt(directory,'100-inbound-capacity.json',admission)
            elif options.mode=='remove':
                remove_verified_targets(BASE,manifest['rows'],check,receipt)
            else:
                require(RESTORE_ARCHIVE.resolve(strict=True)==RESTORE_ARCHIVE,'Unsafe restore archive pathname')
                private_directory(RESTORE_ARCHIVE.parent)
                info=RESTORE_ARCHIVE.lstat()
                require(stat.S_ISREG(info.st_mode) and info.st_uid==info.st_gid==0 and stat.S_IMODE(info.st_mode)==0o600 and info.st_nlink==1,'Unsafe inbound original archive')
                require(digest_file(RESTORE_ARCHIVE)==custody['archiveSha256'],'Restore archive bytes changed')
                admission=restore_capacity(BASE,manifest['rows'])
                create_receipt(directory,'100-extraction-capacity.json',admission)
                stage=directory/'restore-stage';make_private_directory(stage)
                dispatch_restore(BASE,stage,RESTORE_ARCHIVE,manifest['rows'],check,receipt)
            check()
            result={**details,'completed':True,'receiptDirectory':str(directory),'allocatedBytesRegained':manifest['allocatedBytesRegained'] if options.mode=='remove' else 0,'remainingTargetPaths':[name for name in TARGETS if os.path.lexists(BASE/name)]}
            create_receipt(directory,'999-complete.json',result)
            print(json.dumps({key:result[key] for key in ('operation','completed','receiptDirectory','approvalManifestSha256','archiveSha256','controllerSha256','allocatedBytesRegained','remainingTargetPaths')}))
        except BaseException as error:
            create_receipt(directory,'999-refusal-or-partial.json',{**details,'completed':False,'errorType':type(error).__name__,'error':str(error),'completedTargetReceipts':sequence,'remainingTargetPaths':[name for name in TARGETS if os.path.lexists(BASE/name)],'restoreCustodyPreserved':True})
            raise

if __name__=='__main__':main()
