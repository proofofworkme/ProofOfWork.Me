#!/usr/bin/python3 -I
"""Audit30 exact UI retirement and byte-preserving source relocation.

Default operations only return plans/proofs. Apply requires an exact plan hash
and the separately recorded user scope approval hash. Never changes holds,
prune masks, thresholds, protocol data, source bytes or historical evidence.
"""
import argparse
import base64
import collections
import contextlib
import ctypes
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import struct
import subprocess
import sys
import tarfile
import time

SURFACES = 'activity boost browser computer desktop dns growth id inception infinity landing marketplace nft token wallet work'.split()
ROOT_IDS = '04927c291bf4-20261001T150448Z 527e4cbaa66f-20261001T062733Z 53b5b428e864-20261001T201028Z 835e30258d23-20261002T052338Z d2636f6fb3c5-20261002T023421Z d4d888757a1c-20261002T013828Z dbfa88b95819-20261001T134456Z df4d56da93ce-20261002T042258Z ed838d5c8691-20261001T210406Z f81ae55bf4b0-20261002T031600Z'.split()
ARCHIVE_IDS = '04927c291bf4-20261001T150448Z 527e4cbaa66f-20261001T062733Z 53b5b428e864-20261001T201028Z 9d46289661d5-20261001T023414Z d2636f6fb3c5-20261002T023421Z d4d888757a1c-20261002T013828Z dbfa88b95819-20261001T134456Z df4d56da93ce-20261002T042258Z ed838d5c8691-20261001T210406Z f81ae55bf4b0-20261002T031600Z'.split()
SOURCE_IDS = 'ed838d5c8691-20261001T210406Z d2636f6fb3c5-20261002T023421Z f81ae55bf4b0-20261002T031600Z'.split()
HELD_SHA = 'c3bd35740d7fcc135839274c8228e38f7a45c23e33567743e0d77151b32451d9'
HOLD_SHA = 'e9aca6e22b1dc36b714ed663051f8bc20d9479efa4173474e0b6b771958ca6a4'
APPROVAL_SHA = 'd99a40236b49b1735c794fb853c4f7f4f0724da8e3f83fab75c7464e0e8ee373'
SCOPE_SHA = 'f0027078971b7521fb2411e15bd8931b110a0f1815ea7e04bdaed3b5d4bdfdd0'
RELEASE_ID = re.compile(r'[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z\Z')
SHA = re.compile(r'[0-9a-f]{64}\Z')
MAX_JSON = 64 * 1024**2
# This is one reviewed continuation of the exact Audit30 run, never a generic
# dynamic-log exception or an automatic recovery from absent paths.
RECONCILIATION_PINS = dict(reviewManifest='3d09b077148cf471c1b9581e091a676ad7d4b25e799ba50b11561247b7f1f04b',originalPlan='17fd46d15d836d485e96fe0e25abf9bae0505cfee4d64728a895fd50b0e7e8b7',originalIntent='e2a6afa6f7da36ce4e9c5c7797409e5911d99bdcd5f448a2843e513d3a892df2',failedReceipt='4575ad6fee8475822c4db7db31da7843b26abd1053f052027ec4dc4cfcdf12a9',originalController='038a2315c4ba5d10e27335a69c400f6c09ec3c2b50b0f64fefb1f5f09d6a06c2',rotationEvidence='0550a89409c6176febf514278ee0ae70710e0b4b5788d2962e077dfe799b3bb9')
ROTATION_CONFIG_PINS={'/etc/logrotate.d/rsyslog':'b33b9a6126dfec23ec966cb43d18fbd90d053acc683f67d3c76aa49c0b1afc3b','/etc/logrotate.d/ufw':'03dedaa1de48c9b708363ef4ac2ebeb35b20e47ce1f8a5d650f1335a5f37a5d1'}

def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def encoded(value): return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
def digest(value): return hashlib.sha256(encoded(value)).hexdigest()
def unique_pairs(pairs):
    out = {}
    for k, v in pairs:
        if k in out: raise ValueError('Duplicate JSON key')
        out[k] = v
    return out

def identity(s):
    return (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink)

def safe(path, directory=None):
    path = Path(path); s = path.lstat()
    if not path.is_absolute() or path.resolve() != path or s.st_uid != os.geteuid() or s.st_mode & 0o7022:
        raise ValueError('Unsafe canonical path: ' + str(path))
    if directory is True and not stat.S_ISDIR(s.st_mode): raise ValueError('Expected real directory')
    if directory is False and not stat.S_ISREG(s.st_mode): raise ValueError('Expected regular file')
    return s

def hash_read(path, maximum=4*1024**3, retain=False):
    s = safe(path, False)
    if s.st_size > maximum: raise ValueError('Read size bound exceeded')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
    h = hashlib.sha256(); data = []
    try:
        if identity(os.fstat(fd)) != identity(s): raise ValueError('Opened file identity changed')
        count = 0
        while True:
            b = os.read(fd, 1024**2)
            if not b: break
            h.update(b); count += len(b)
            if count > maximum: raise ValueError('Read grew beyond bound')
            if retain: data.append(b)
        if identity(os.fstat(fd)) != identity(s) or identity(Path(path).lstat()) != identity(s):
            raise ValueError('File changed during read')
    finally: os.close(fd)
    return h.hexdigest(), b''.join(data) if retain else None

def read_json(path, expected=None):
    h, raw = hash_read(path, MAX_JSON, True)
    if expected and (not SHA.fullmatch(expected) or h != expected): raise ValueError('JSON receipt hash differs')
    return json.loads(raw, object_pairs_hook=unique_pairs), h

def attributes(path):
    # Include names and every value; do not discard ACLs, capabilities or labels.
    out = []
    for name in sorted(os.listxattr(path, follow_symlinks=False)):
        b = os.getxattr(path, name, follow_symlinks=False)
        if len(b) > 65536: raise ValueError('Attribute value bound exceeded')
        out.append([name, base64.b64encode(b).decode()])
    return out

def snapshot(path, links=False, deadline_seconds=120):
    """Complete bytes, types, modes, owners, links/xattrs and inode identities."""
    path = Path(path); root = safe(path); entries = []; fence = []
    deadline = time.monotonic() + deadline_seconds; regular = 0
    def walk(p, rel):
        nonlocal regular
        if time.monotonic() > deadline or len(entries) >= 250000: raise ValueError('Snapshot bound exceeded')
        s = p.lstat()
        if s.st_dev != root.st_dev or s.st_uid != os.geteuid(): raise ValueError('Foreign owner or nested filesystem')
        if not stat.S_ISLNK(s.st_mode) and s.st_mode & 0o7022: raise ValueError('Unsafe entry mode')
        r = dict(path=rel, mode=stat.S_IMODE(s.st_mode), uid=s.st_uid, gid=s.st_gid,
                 device=s.st_dev, inode=s.st_ino, size=s.st_size, mtimeNs=s.st_mtime_ns,
                 ctimeNs=s.st_ctime_ns, links=s.st_nlink, xattrs=attributes(p))
        if stat.S_ISDIR(s.st_mode):
            r['kind'] = 'directory'; entries.append(r)
            fd = os.open(p, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NOATIME)
            try: names = sorted((e.name for e in os.scandir(fd)), key=os.fsencode)
            finally: os.close(fd)
            for n in names:
                if '\\' in n or any(ord(c)<32 or ord(c)==127 for c in n): raise ValueError('Unsafe entry name')
                walk(p/n, n if rel=='.' else rel+'/'+n)
        elif stat.S_ISREG(s.st_mode):
            regular += s.st_size
            if regular > 4*1024**3: raise ValueError('Snapshot byte bound exceeded')
            r.update(kind='file', sha256=hash_read(p)[0]); entries.append(r)
        elif links and stat.S_ISLNK(s.st_mode):
            target = os.readlink(p)
            if not target or os.path.isabs(target) or not p.resolve(strict=True).is_relative_to(path):
                raise ValueError('Absolute, dangling or escaping source link')
            r.update(kind='symlink', target=target); entries.append(r)
        else: raise ValueError('Unsupported entry or forbidden symlink')
        if identity(p.lstat()) != identity(s): raise ValueError('Entry changed during snapshot')
        fence.append((p, identity(s), r['xattrs']))
    walk(path, '.')
    for p, expected, attrs in fence:
        if identity(p.lstat()) != expected or attributes(p) != attrs: raise ValueError('Snapshot fence changed')
    return dict(path=str(path), model='audit30-whole-bytes-inode-xattrs-v1', entries=entries,
                sha256=digest(entries), regularBytes=regular)

def match_snapshot(actual, expected, removed=None, relocation=False):
    removed = removed or {}; a = actual['entries']; b = expected['entries']
    if len(a) != len(b): raise ValueError('Snapshot entry count changed')
    for current, before in zip(a, b):
        if {k:v for k,v in current.items() if k not in ('ctimeNs','links')} != {k:v for k,v in before.items() if k not in ('ctimeNs','links')}:
            raise ValueError('Snapshot bytes, metadata or inode changed: '+before['path'])
        unlink_count = removed.get((before['device'], before['inode']), 0) if before['kind']=='file' else 0
        if current['links'] != before['links']-unlink_count: raise ValueError('Unexplained hardlink count change')
        if current['ctimeNs'] != before['ctimeNs'] and not (unlink_count or relocation and before['path']=='.'):
            raise ValueError('Unexplained ctime change')

class Layout:
    def __init__(self, prefix=Path('/')):
        self.prefix = Path(prefix)
        def at(p): return self.prefix/p.lstrip('/')
        self.live=at('/var/www'); self.base=at('/var/backups/proofofwork-ui')
        self.roots=self.base/'rollback-roots'; self.archives=self.base/'releases'
        self.scratch=at('/var/tmp/proofofwork-deploy'); self.evidence=self.base/'cleanup-evidence'
        self.target=self.base/'transport-evidence'/'audit30-preserved-sources'
        self.lock=at('/run/proofofwork-ui/deploy.lock'); self.held=at('/etc/proofofwork-retention/audit28-held-review.json')
        self.hold=at('/etc/proofofwork-retention/audit28.hold'); self.units=at('/etc/systemd/system')
        self.capacity=at('/usr/local/sbin/proofofwork-ui-capacity')
        self.refs=[at(p) for p in ('/etc','/usr/local/sbin','/usr/local/bin','/var/spool/cron','/var/www')]
    def exact(self):
        out=[dict(path=str(self.roots/('proofofwork-www-pre-'+rid)), kind='rollback-root') for rid in ROOT_IDS]
        for rid in ARCHIVE_IDS:
            p=self.archives/('proofofwork-ui-release-'+rid+'.tgz')
            out.extend(dict(path=str(q),kind=k) for q,k in ((p,'managed-release-archive'),(Path(str(p)+'.sha256'),'archive-sidecar'),(Path(str(p)+'.provenance'),'archive-sidecar')))
        return out
    def moves(self):
        return [dict(source=str(self.scratch/('proofofwork-ui-source-'+rid)), target=str(self.target/('proofofwork-ui-source-'+rid))) for rid in SOURCE_IDS]

def manifest(root):
    h, b = hash_read(Path(root)/'.proofofwork-ui-release', 65536, True); out={}
    for line in b.decode().splitlines():
        k, sep, v=line.partition('=')
        if not sep or k in out: raise ValueError('Malformed release manifest')
        out[k]=v
    if out.get('format')!='proofofwork-ui-release-v3' or not RELEASE_ID.fullmatch(out.get('release_id','')):
        raise ValueError('Unsupported ordinary release manifest')
    if not re.fullmatch('[0-9a-f]{40}',out.get('commit','')) or not re.fullmatch('[0-9a-f]{40}',out.get('source_tree','')) or not out['commit'].startswith(out['release_id'].split('-')[0]):raise ValueError('Release commit/tree identity differs')
    if {k.split('.')[1] for k in out if k.startswith('surface.') and k.endswith('.sha256')} != set(SURFACES):
        raise ValueError('Incomplete 16-surface manifest')
    return out,h,b

def verify_surface_rows(rows, fields):
    for surface in SURFACES:
        part=[r for r in rows if r['path'].startswith('proofofwork-'+surface+'/') and r['kind']=='file']
        h=hashlib.sha256()
        for r in sorted(part,key=lambda r:os.fsencode(r['path'])):
            rel=r['path'].split('/',1)[1]
            h.update(rel.encode()+b'\0'+format(r['mode'],'o').encode()+b'\0'+r['sha256'].encode()+b'\n')
        if h.hexdigest()!=fields['surface.'+surface+'.sha256'] or len(part)!=int(fields['surface.'+surface+'.file_count']):
            raise ValueError('Surface content/count differs: '+surface)

def archive_proof(path, fields, manifest_bytes):
    path=Path(path); safe(path,False); fp=snapshot(path); expected='proofofwork-ui-release-'+fields['release_id']+'.tgz'
    if path.name!=expected or fp['entries'][0]['sha256']!=fields['archive_sha256']: raise ValueError('Archive checksum/name differs')
    _, checksum=hash_read(Path(str(path)+'.sha256'),65536,True)
    if checksum.decode().split()!=[fields['archive_sha256'],expected]: raise ValueError('Archive checksum sidecar differs')
    _, provenance=hash_read(Path(str(path)+'.provenance'),65536,True)
    if provenance!=manifest_bytes: raise ValueError('Archive provenance differs from root manifest')
    # A checksum alone does not establish that the archive contains these 16 surfaces.
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME); before=identity(path.lstat()); rows=[]; seen=set(); total=0; deadline=time.monotonic()+120
    with os.fdopen(fd,'rb') as stream,tarfile.open(fileobj=stream,mode='r|gz') as archive:
        for m in archive:
            if time.monotonic()>deadline or len(seen)>25000: raise ValueError('Archive entry/time bound')
            name=m.name.rstrip('/')
            if name in seen or name.startswith('/') or any(z in ('','..','.') for z in name.split('/')): raise ValueError('Unsafe/duplicate archive member')
            seen.add(name)
            if name=='surfaces':
                # The canonical publisher uses a private temporary wrapper (0700).
                # Only its rendered child directories must be world-readable 0755.
                if not m.isdir() or m.mode not in (0o700,0o755) or m.uid!=os.geteuid() or m.gid!=os.getegid(): raise ValueError('Unsafe surfaces archive root')
                continue
            parts=name.split('/')
            if len(parts)<2 or parts[0]!='surfaces' or parts[1] not in SURFACES: raise ValueError('Unexpected archive member')
            if m.uid!=os.geteuid():raise ValueError('Archive member has foreign ownership')
            r=dict(path='proofofwork-'+parts[1]+('/'+'/'.join(parts[2:]) if len(parts)>2 else ''),mode=m.mode,uid=m.uid,gid=m.gid)
            if m.isdir():
                if m.mode!=0o755:raise ValueError('Unsafe archive directory mode')
                r['kind']='directory'
            elif m.isfile():
                total+=m.size
                if total>2*1024**3 or m.mode & 0o7022: raise ValueError('Unsafe/oversize archive payload')
                f=archive.extractfile(m); h=hashlib.sha256()
                for chunk in iter(lambda:f.read(1024**2),b''):h.update(chunk)
                r.update(kind='file',sha256=h.hexdigest())
            else: raise ValueError('Linked or special archive member')
            rows.append(r)
    if before!=identity(path.lstat()): raise ValueError('Archive changed during verification')
    if 'surfaces' not in seen or {r['path'] for r in rows if r['kind']=='directory' and '/' not in r['path']}!={'proofofwork-'+s for s in SURFACES}: raise ValueError('Archive lacks surface directories')
    verify_surface_rows(rows,fields)
    rows.sort(key=lambda r:os.fsencode(r['path']))
    names={r['path'] for r in rows if r['kind']=='directory'}
    for r in rows:
        parent=Path(r['path']).parent.as_posix()
        if parent!='.' and parent not in names:raise ValueError('Archive file lacks a real parent directory')
    return dict(path=str(path),snapshot=fp,sidecars=[snapshot(Path(str(path)+s)) for s in ('.sha256','.provenance')],payloadSha256=digest(rows),payloadRows=rows,payloadBytes=total)

def release_proof(root, layout, archive_cache):
    fields,mh,mb=manifest(root); fp=snapshot(root); verify_surface_rows(fp['entries'],fields)
    name=fields.get('archive_name','')
    if name!='proofofwork-ui-release-'+fields['release_id']+'.tgz': raise ValueError('Manifest archive name differs')
    p=layout.archives/name
    if str(p) not in archive_cache: archive_cache[str(p)]=archive_proof(p,fields,mb)
    elif archive_cache[str(p)]['snapshot']['entries'][0]['sha256']!=fields['archive_sha256']: raise ValueError('Conflicting archive binding')
    managed=[{k:r[k] for k in ('path','kind','mode','uid','gid','sha256') if k in r} for r in fp['entries'] if r['path'].split('/')[0] in {'proofofwork-'+s for s in SURFACES}]
    managed.sort(key=lambda r:os.fsencode(r['path']))
    if managed!=archive_cache[str(p)]['payloadRows']:raise ValueError('Archive directory/file inventory differs from verified root')
    passthrough=[r for r in fp['entries'] if r['path']!='.' and r['path']!='.proofofwork-ui-release' and r['path'].split('/')[0] not in {'proofofwork-'+s for s in SURFACES}]
    logical=[{k:r[k] for k in ('path','kind','mode','uid','gid','xattrs','sha256') if k in r} for r in passthrough]
    return dict(path=str(root),fields=fields,manifestSha256=mh,snapshot=fp,passthroughSha256=digest(logical))

def held_boundary(paths, review, layout):
    allowed={str(layout.roots),str(layout.archives)}; records=[]
    for p in paths:
        for row in review['retain']:
            if row.get('role')!='ui': continue
            q=row['path'] if layout.prefix==Path('/') else str(layout.prefix/row['path'].lstrip('/'))
            if p==q or q.startswith(p+'/'): raise ValueError('Individually held candidate or descendant')
            if p.startswith(q+'/'):
                if q not in allowed or row.get('retentionClass')!='managed-ui-recovery-container' or row.get('decision')!='retain':
                    raise ValueError('Unapproved held ancestor')
                records.append(dict(candidate=p,ancestor=q,releaseGate=row['releaseGate']))
    return records

def safeguards(layout):
    review,h=read_json(layout.held,HELD_SHA); hold=hash_read(layout.hold,65536)[0]
    if hold!=HOLD_SHA: raise ValueError('Generic hold changed')
    masks=[]
    for name in ('proofofwork-ui-release-prune.timer','proofofwork-ui-storage-prune.timer'):
        p=layout.units/name; s=p.lstat()
        if not stat.S_ISLNK(s.st_mode) or s.st_uid!=os.geteuid() or os.readlink(p)!='/dev/null': raise ValueError('Persistent prune mask changed')
        masks.append(dict(path=str(p),device=s.st_dev,inode=s.st_ino,target='/dev/null'))
    census=[]
    for r in review['retain']:
        if r.get('role')!='ui':continue
        p=Path(r['path']) if layout.prefix==Path('/') else layout.prefix/r['path'].lstrip('/')
        row=dict(path=str(p),exists=os.path.lexists(p))
        if row['exists']:
            s=p.lstat();row.update(device=s.st_dev,inode=s.st_ino,mode=s.st_mode,uid=s.st_uid,gid=s.st_gid)
        census.append(row)
    return dict(heldSha256=h,holdSha256=hold,masks=masks,heldCensus=census,missingHeldPaths=[r['path'] for r in census if not r['exists']]),review

def path_occurrences(raw,paths):
    out=[]
    for target in paths:
        token=os.fsencode(target);start=0
        while True:
            offset=raw.find(token,start)
            if offset<0:break
            out.append((target,offset));start=offset+1
    return sorted(out)

def references(paths, roots, proc=Path('/proc'), byte_limit=1024**3, reviewed_files=None):
    """Bounded live pointer search; a limit/error refuses instead of implying absence."""
    if not isinstance(byte_limit,int) or byte_limit<1:raise ValueError('Invalid reference byte bound')
    paths=[str(p) for p in paths]; matches=[]; historical=[]; entries=0; bytes_read=0; per_root=[];reviewed_files=reviewed_files or {}
    pattern=re.compile(b'|'.join(re.escape(os.fsencode(p)) for p in paths)) if paths else None
    document_pattern=re.compile(b'|'.join(re.escape(os.fsencode(p)) for p in reviewed_files)) if reviewed_files else None
    def row(root):
        value=dict(root=str(root),exists=os.path.lexists(root),entries=0,bytesRead=0,regularFilesRead=0,pointerLinksChecked=0,skippedLargeFiles=0,skippedPayloadDirectories=0,skippedSpecialEntries=0)
        per_root.append(value);return value
    def count_entry(stats):
        nonlocal entries
        entries+=1;stats['entries']+=1
        if entries>100000:raise ValueError('Reference scan entry bound: limit=100000 consumed='+str(entries)+' root='+stats['root'])
    def read_bounded(p,stats,expected=None):
        nonlocal bytes_read
        fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
        with os.fdopen(fd,'rb') as f:
            if expected is not None and identity(os.fstat(f.fileno()))!=identity(expected):raise ValueError('Reference file identity changed')
            raw=f.read(1024**2+1)
            if expected is not None and (identity(os.fstat(f.fileno()))!=identity(expected) or identity(p.lstat())!=identity(expected)):raise ValueError('Reference file changed during scan')
        if len(raw)>1024**2:raise ValueError('Reference per-file byte bound exceeded')
        bytes_read+=len(raw);stats['bytesRead']+=len(raw);stats['regularFilesRead']+=1
        if bytes_read>byte_limit:raise ValueError('Reference scan byte bound: limit='+str(byte_limit)+' consumed='+str(bytes_read)+' root='+stats['root'])
        return raw
    def target(value, source):
        if any(value==p or value.startswith(p+'/') for p in paths): matches.append(dict(reference=str(source),kind='path-pointer'))
        # A live/configuration alias can make an otherwise historical document
        # operational. A process root '/' is not an alias to a source checkout.
        if any(value==p or value.startswith(p+'/') or (value==r['sourcePath'] or value.startswith(r['sourcePath']+'/')) and p.startswith(value+'/') for p,r in reviewed_files.items()):matches.append(dict(reference=str(source),kind='active-reviewed-document-pointer'))
    def contents(raw,source,scan_root=None):
        admitted=reviewed_files.get(str(source));qualified_location=admitted and scan_root==admitted['sourcePath']
        if not qualified_location and document_pattern is not None and document_pattern.search(raw):matches.append(dict(reference=str(source),kind='active-reviewed-document-content-pointer'))
        if pattern is None or not pattern.search(raw):return
        # A reviewed source document is never an exception for process/config/
        # operator/live-root data, nor for any symlink pointer to that document.
        if qualified_location:
            if hashlib.sha256(raw).hexdigest()!=admitted['sha256'] or len(raw)!=admitted['bytes']:raise ValueError('Reviewed citation document changed during scan')
            observed=path_occurrences(raw,paths);allowed={(r['target'],r['byteOffset']):r for r in admitted['citations']}
            if any(r not in allowed for r in observed):raise ValueError('Unreviewed historical citation occurrence')
            historical.append(dict(reference=str(source),kind='qualified-historical-citation',sha256=admitted['sha256'],sourceHead=admitted['sourceHead'],sourceTree=admitted['sourceTree'],citations=[allowed[r] for r in observed]))
        else:matches.append(dict(reference=str(source),kind='content-pointer'))
    proc_stats=row(proc)
    for p in proc.glob('[0-9]*'):
        if p.name==str(os.getpid()):continue
        for q in [p/'cwd',p/'root',p/'exe',*list((p/'fd').glob('*'))]:
            count_entry(proc_stats)
            try:
                value=os.readlink(q).removesuffix(' (deleted)');proc_stats['pointerLinksChecked']+=1;target(value,q)
                if reviewed_files:
                    resolved=str(q.resolve(strict=False)).removesuffix(' (deleted)')
                    if resolved!=value:target(resolved,q)
            except (FileNotFoundError,ProcessLookupError):continue
            except PermissionError:raise ValueError('Cannot inspect a live process pointer')
        for name in ('cmdline','maps','mountinfo'):
            count_entry(proc_stats)
            try:raw=read_bounded(p/name,proc_stats)
            except (FileNotFoundError,ProcessLookupError):continue
            except PermissionError:raise ValueError('Cannot inspect live process mapping')
            contents(raw,p/name)
    def walk(p,stats):
        count_entry(stats)
        s=p.lstat()
        if stat.S_ISLNK(s.st_mode):
            stats['pointerLinksChecked']+=1;raw_target=os.path.normpath(os.path.join(str(p.parent),os.readlink(p)));target(raw_target,p)
            # Keep the default/raw dangling-retirement checks, and additionally
            # resolve complete alias chains only when document qualification exists.
            if reviewed_files:
                resolved=str(p.resolve(strict=False))
                if resolved!=raw_target:target(resolved,p)
            return
        if stat.S_ISDIR(s.st_mode):
            if p.name in ('node_modules','objects'):stats['skippedPayloadDirectories']+=1;return
            for n in sorted(os.listdir(p)):walk(p/n,stats)
        elif stat.S_ISREG(s.st_mode):
            if s.st_size>1024**2:stats['skippedLargeFiles']+=1;return  # Existing textual-scan scope; reported explicitly.
            contents(read_bounded(p,stats,s),p,stats['root'])
        else:stats['skippedSpecialEntries']+=1
    for root in roots:
        stats=row(root)
        if stats['exists']:walk(root,stats)
    if matches:raise ValueError('Active/configuration/inbound references: '+json.dumps(matches))
    return dict(matches=[],qualifiedHistoricalMatches=historical,entries=entries,bytesRead=bytes_read,roots=[str(p) for p in roots],perRoot=per_root,byteLimit=byte_limit,entryLimit=100000,perFileByteLimit=1024**2,excludedSelfPid=os.getpid(),contentLookup='one compiled escaped-literal bytes regex; same substring semantics',qualification='Process pointers/mappings/mounts and enumerated configuration/operator/symlink roots; regular files above 1 MiB and object/dependency payloads are outside textual scan. Only explicit hash-bound committed protected-source citations may qualify; all other matches refuse. Git pointer files are checked separately. All reads are bounded; limits and unresolved read errors refuse.')

def source_pointers(path):
    safe(path,True); safe(path/'.git',True)
    for name in ('objects/info/alternates','objects/info/http-alternates','info/grafts','shallow','commondir','worktrees'):
        if os.path.lexists(path/'.git'/name):raise ValueError('Source has external/shallow/worktree pointer: '+name)
    if any((path/'.git'/'objects'/'pack').glob('*.promisor')):raise ValueError('Source has external promisor objects')
    git=['/usr/bin/git','-c','safe.directory='+str(path),'-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','core.trustctime=true','-c','core.ignoreStat=false','-C',str(path)]
    env={'PATH':'/usr/bin:/bin','GIT_OPTIONAL_LOCKS':'0','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_SYSTEM':'/dev/null'}
    config=subprocess.run(git+['config','--local','--name-only','--get-regexp',r'^(include\.|includeif\.|filter\.|diff\..*\.(command|textconv)$|core\.(worktree|fsmonitor|hookspath|sshcommand|gitproxy)$|extensions\.(worktreeconfig|partialclone)$|remote\..*\.(promisor|partialclonefilter)$)'],env=env,text=True,capture_output=True,timeout=30)
    if config.returncode not in (0,1) or config.stdout:raise ValueError('Source has absolute/include/fsmonitor configuration pointer')
    pointers=subprocess.check_output(git+['rev-parse','--path-format=absolute','--show-toplevel','--absolute-git-dir','--git-common-dir'],env=env,text=True,timeout=30).splitlines()
    if pointers!=[str(path),str(path/'.git'),str(path/'.git')]:raise ValueError('Git workingtree/common directory is external')
    flags=subprocess.check_output(git+['ls-files','-v','-z'],env=env,timeout=30).split(b'\0')
    if any(row and not row.startswith(b'H ') for row in flags):raise ValueError('Skip-worktree, assumed-clean or unresolved index flags')
    identity_out=subprocess.check_output(git+['rev-parse','HEAD','HEAD^{tree}'],env=env,text=True,timeout=30).splitlines()
    status=subprocess.check_output(git+['status','--porcelain','--untracked-files=all','--ignored'],env=env,text=True,timeout=30).splitlines()
    if not all(l=='!! node_modules/' or l.startswith('!! node_modules/') for l in status):raise ValueError('Source has non-runtime local changes')
    return dict(head=identity_out[0],tree=identity_out[1],ignoredNodeModulesLines=len(status),statusSha256=digest(status))

def approval(path, expected, operation):
    value,h=read_json(path,expected)
    if (h!=APPROVAL_SHA or value.get('schema')!='proof-of-work-audit30-human-first-batch-approval-v1'
            or value.get('scopeFileSha256')!=SCOPE_SHA or value.get('approvedItems')!=[1,2,3]
            or value.get('userStatement')!='Approve batch 1-3 as scoped.'
            or operation not in ('cleanup','preserve-sources','inverse-preservation','future-retention','admit-bootstrap','admit-release')):
        raise ValueError('Missing exact user scope approval')
    return value,h

def protected_pair(layout, cache):
    current=release_proof(layout.live,layout,cache)
    previous=release_proof(layout.roots/('proofofwork-www-pre-'+current['fields']['release_id']),layout,cache)
    sources=[]
    for r in (current,previous):
        p=layout.scratch/('proofofwork-ui-source-'+r['fields']['release_id']); meta=source_pointers(p)
        if meta['head']!=r['fields']['commit'] or meta['tree']!=r['fields']['source_tree']:raise ValueError('Retained source differs from release')
        fp=snapshot(p,links=True);dependency=dependency_fingerprint(fp)
        fields=r['fields']
        if (fields.get('source_dependency_model')!='node-modules-recursive-v1' or fields.get('source_dependency_sha256')!=dependency['sha256']
                or fields.get('source_dependency_entry_count')!=str(dependency['entryCount']) or fields.get('source_dependency_bytes')!=str(dependency['regularBytes'])):
            raise ValueError('Retained runtime dependencies differ from release provenance')
        sources.append(dict(path=str(p),git=meta,snapshot=fp,dependencyFingerprint=dependency))
    return dict(current=current,previous=previous,sources=sources)

def dependency_fingerprint(fp):
    """Same node-modules-recursive-v1 byte model as installed UI provenance."""
    h=hashlib.sha256();count=total=0
    for r in fp['entries']:
        path=r['path']
        if path!='node_modules' and not path.startswith('node_modules/'):continue
        relative='.' if path=='node_modules' else path[len('node_modules/'):]
        evidence=bytes.fromhex(r['sha256']) if r['kind']=='file' else os.fsencode(r['target']) if r['kind']=='symlink' else b''
        for value in (os.fsencode(relative),r['kind'].encode(),format(r['mode'],'04o').encode(),str(r['uid']).encode(),str(r['gid']).encode(),evidence):
            h.update(struct.pack('>Q',len(value))+value)
        count+=1;total+=r['size'] if r['kind']=='file' else 0
    if count<2 or not total:raise ValueError('Empty runtime dependency tree')
    return dict(model='node-modules-recursive-v1',entryCount=count,regularBytes=total,sha256=h.hexdigest())

def git_document_blob(source,relative,head):
    env={'PATH':'/usr/bin:/bin','GIT_OPTIONAL_LOCKS':'0','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_SYSTEM':'/dev/null'}
    out=subprocess.check_output(['/usr/bin/git','-c','safe.directory='+str(source),'-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-C',str(source),'ls-tree','-z','--full-tree',head,'--',relative],env=env,timeout=30).split(b'\0')
    if len(out)!=2 or out[1]:raise ValueError('Reviewed document does not have one committed Git blob')
    metadata,separator,name=out[0].partition(b'\t');parts=metadata.split()
    if not separator or name!=os.fsencode(relative) or len(parts)!=3 or parts[:2]!=[b'100644',b'blob'] or not re.fullmatch(b'[0-9a-f]{40}',parts[2]):raise ValueError('Reviewed citation is not a regular committed document')
    return parts[2].decode()

def load_citation_review(binding,layout,protected,kind,candidates,approval_sha):
    if binding is None:return {}
    if kind not in ('cleanup','future-retention'):raise ValueError('Citation review cannot qualify source-preservation references')
    path=Path(binding['path'])
    if path.parent!=layout.evidence or not path.name.startswith('audit30-citation-review-') or path.suffix!='.json':raise ValueError('Citation review outside durable Audit30 evidence')
    value,h=read_json(path,binding['sha256'])
    expected_sources=[dict(path=r['path'],head=r['git']['head'],tree=r['git']['tree']) for r in protected['sources']]
    if value.get('schema')!='pow-audit30-historical-citation-review-v1' or value.get('host')!='77.42.91.106' or value.get('scopeApprovalSha256')!=approval_sha or value.get('operationKind')!=kind or value.get('candidatePaths')!=candidates or value.get('protectedSources')!=expected_sources:raise ValueError('Citation review scope/source/approval binding differs')
    evidence=value.get('reviewEvidence',[])
    if not evidence or len(evidence)>8 or len({r['path'] for r in evidence})!=len(evidence):raise ValueError('Citation semantic-review evidence missing/duplicated')
    for r in evidence:
        p=Path(r['path'])
        if p.parent!=layout.evidence or not p.name.startswith('audit30-') or p==path or hash_read(p,MAX_JSON)[0]!=r['sha256']:raise ValueError('Citation semantic-review evidence binding differs')
    sources={r['path']:r for r in expected_sources}
    for r in expected_sources:
        actual=source_pointers(Path(r['path']))
        if actual['head']!=r['head'] or actual['tree']!=r['tree']:raise ValueError('Reviewed protected source HEAD/tree changed')
    files=value.get('files',[])
    if not files or len(files)>64:raise ValueError('Citation review must enumerate bounded exact documents')
    out={}
    for r in files:
        source=sources.get(r.get('sourcePath'));relative=r.get('relativePath','');parts=relative.split('/')
        allowed=relative=='OP_RETURN_INFRASTRUCTURE.md' or len(parts)==2 and parts[0]=='audits' and re.fullmatch(r'[A-Za-z0-9._-]+\.(md|json)',parts[1])
        if source is None or not allowed:raise ValueError('Citation review file is not an allowed protected-source document')
        p=Path(source['path'])/relative
        if str(p) in out:raise ValueError('Duplicate reviewed citation document')
        sha,raw=hash_read(p,1024**2,True)
        blob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
        if sha!=r.get('sha256') or type(r.get('bytes')) is not int or len(raw)!=r['bytes'] or blob!=r.get('gitBlobSha1') or git_document_blob(Path(source['path']),relative,source['head'])!=blob:raise ValueError('Reviewed document bytes/Git blob differ')
        citations=r.get('citations',[])
        if not citations or len(citations)>1024:raise ValueError('Exact historical citation occurrences required')
        observed=path_occurrences(raw,candidates);declared=[]
        for c in citations:
            target=c.get('target');offset=c.get('byteOffset')
            if target not in candidates or type(offset) is not int or offset<0 or c.get('classification')!='historical-release-evidence':raise ValueError('Unreviewed citation target/offset/classification')
            start=raw.rfind(b'\n',0,offset)+1;end=raw.find(b'\n',offset);end=len(raw) if end<0 else end+1
            if raw[offset:offset+len(os.fsencode(target))]!=os.fsencode(target) or c.get('line')!=raw.count(b'\n',0,offset)+1 or c.get('lineSha256')!=hashlib.sha256(raw[start:end]).hexdigest():raise ValueError('Citation occurrence/context differs')
            declared.append((target,offset))
        if len(set(declared))!=len(declared) or sorted(declared)!=observed:raise ValueError('Citation review does not cover every exact occurrence')
        out[str(p)]=dict(r,sourceHead=source['head'],sourceTree=source['tree'])
    return out

def cleanup_prerequisite(path, expected, layout, approval_sha):
    value,h=read_json(path,expected)
    if value.get('schema')!='pow-audit30-ui-storage-progress-v1' or value.get('status')!='completed':raise ValueError('Completed Audit30 cleanup receipt required')
    intent,_=read_json(Path(value['intentPath']),value['intentSha256']);plan=intent.get('plan',{})
    validate_plan(plan,layout,'cleanup',approval_sha)
    if intent.get('planSha256')!=value.get('planSha256'):raise ValueError('Cleanup intent/result binding differs')
    wanted={r['path'] for r in layout.exact()}; rows=value.get('completed',[])
    if value.get('holdsAndMasksUnchanged') is not True or len(rows)!=40 or any(r.get('path')!=p['path'] or r.get('outcome')!='retired' or r.get('snapshotSha256')!=p['snapshot']['sha256'] for r,p in zip(rows,plan['delete'])):raise ValueError('Incomplete, reordered or unfenced cleanup progress cannot admit preservation')
    if any(os.path.lexists(p) for p in wanted):raise ValueError('A completed cleanup candidate reappeared')
    return dict(path=str(path),sha256=h,planSha256=value['planSha256'])

def reconciliation_state(layout,binding,approval_sha):
    if binding.get('sha256')!=RECONCILIATION_PINS['reviewManifest']:raise ValueError('Reconciliation review version pin differs')
    path=Path(binding['path'])
    if path.parent!=layout.evidence or not path.name.startswith('audit30-cleanup-reconciliation-review-') or path.suffix!='.json':raise ValueError('Reconciliation review outside durable evidence')
    review,_=read_json(path,binding['sha256'])
    if review.get('schema')!='pow-audit30-cleanup-reconciliation-review-v1' or review.get('host')!='77.42.91.106' or review.get('scopeApprovalSha256')!=approval_sha or review.get('classification')!='configured-logrotate-inode-replacement':raise ValueError('Wrong reconciliation authority')
    values={}
    for key in ('originalPlan','originalIntent','failedReceipt','originalController'):
        row=review.get(key,{})
        if set(row)!= {'path','sha256'} or row['sha256']!=RECONCILIATION_PINS[key]:raise ValueError('Reconciliation original version pin differs')
        p=Path(row['path'])
        if key=='originalController':
            if not p.is_relative_to(layout.evidence) or p.name!='ui-storage.py':raise ValueError('Original controller outside immutable private package')
            if hash_read(p,1024**2)[0]!=row['sha256']:raise ValueError('Original controller bytes differ')
        else:
            if p.parent!=layout.evidence or not p.name.startswith('audit30-'):raise ValueError('Original receipt outside durable evidence')
            values[key]=read_json(p,row['sha256'])[0]
    original=values['originalPlan'];intent=values['originalIntent'];failed=values['failedReceipt']
    validate_plan(original,layout,'cleanup',approval_sha)
    if 'reconciliation' in original or original['controllerSha256']!=RECONCILIATION_PINS['originalController'] or intent.get('schema')!='pow-audit30-ui-storage-intent-v1' or intent.get('status')!='approved-intent' or intent.get('plan')!=original or intent.get('planSha256')!=RECONCILIATION_PINS['originalPlan']:raise ValueError('Original intent/plan binding differs')
    prefix=failed.get('completed',[])
    if failed.get('schema')!='pow-audit30-ui-storage-progress-v1' or failed.get('status')!='failed' or failed.get('planSha256')!=RECONCILIATION_PINS['originalPlan'] or failed.get('intentPath')!=review['originalIntent']['path'] or failed.get('intentSha256')!=RECONCILIATION_PINS['originalIntent'] or failed.get('phase')!='immediate-before-retirement' or failed.get('currentPath')!=original['delete'][38]['path'] or failed.get('holdsAndMasksUnchanged') is not False or failed.get('missingHeldPaths')!=original['safeguards']['missingHeldPaths'] or len(prefix)!=38:raise ValueError('Original failed prefix authority differs')
    removed=collections.Counter()
    for completed,row in zip(prefix,original['delete']):
        if completed.get('path')!=row['path'] or completed.get('outcome')!='retired' or completed.get('snapshotSha256')!=row['snapshot']['sha256'] or not isinstance(completed.get('atUtc'),str) or os.path.lexists(row['path']):raise ValueError('Retired original prefix is unproven or reappeared')
        for entry in row['snapshot']['entries']:
            if entry['kind']=='file':removed[(entry['device'],entry['inode'])]+=1
    before=original['safeguards'];after=review.get('afterGuards',{})
    if set(after)!=set(before) or any(after[k]!=before[k] for k in before if k!='heldCensus') or len(after['heldCensus'])!=len(before['heldCensus']):raise ValueError('Hold/mask/missing/non-census reconciliation expansion')
    differences=[]
    for left,right in zip(before['heldCensus'],after['heldCensus']):
        if left==right:continue
        if not left.get('exists') or not right.get('exists') or {k:v for k,v in left.items() if k!='inode'}!={k:v for k,v in right.items() if k!='inode'} or type(right.get('inode')) is not int or right['inode']<=0:raise ValueError('Reconciliation is not an inode-only present-log rotation')
        differences.append(dict(guard='heldCensus',path=left['path'],expected=left,actual=right))
    def at(p):return str(layout.prefix/p.lstrip('/'))
    families=['auth.log','kern.log','syslog','ufw.log'];wanted={at('/var/log/'+family+suffix) for family in families for suffix in ['','.1',*['.'+str(n)+'.gz' for n in range(2,49)]]}
    if len(differences)!=196 or {r['path'] for r in differences}!=wanted or review.get('approvedDifference')!=differences:raise ValueError('Reconciliation must be exactly the reviewed 196/four-family delta')
    old={r['path']:r for r in before['heldCensus']};new={r['path']:r for r in after['heldCensus']}
    for family in families:
        base=at('/var/log/'+family)
        if old[base]['inode']!=new[base+'.1']['inode'] or any(old[base+'.'+str(n)+'.gz']['inode']!=new[base+'.'+str(n+1)+'.gz']['inode'] for n in range(2,48)):raise ValueError('Rotation inode chain differs')
    evidence=review.get('rotationEvidence',[])
    if len(evidence)!=1 or set(evidence[0])!= {'path','sha256'} or evidence[0]['sha256']!=RECONCILIATION_PINS['rotationEvidence']:raise ValueError('Configured rotation evidence pin differs')
    ep=Path(evidence[0]['path'])
    if ep.parent!=layout.evidence or not ep.name.startswith('audit30-') or ep==path or hash_read(ep,MAX_JSON)[0]!=evidence[0]['sha256']:raise ValueError('Configured rotation evidence bytes differ')
    configs=[dict(path=at(p),sha256=h) for p,h in ROTATION_CONFIG_PINS.items()]
    if review.get('rotationConfigFiles')!=configs or any(hash_read(Path(r['path']),1024**2)[0]!=r['sha256'] for r in configs):raise ValueError('Configured rotation authority changed')
    compare_guards(layout,after,[])
    return original,failed,review,removed

def create_reconciliation_plan(layout,approval_sha,binding):
    original,failed,review,removed=reconciliation_state(layout,binding,approval_sha)
    plan=json.loads(encoded(original));plan.update(atUtc=utc(),safeguards=review['afterGuards'],controllerSha256=hash_read(Path(__file__).resolve(),1024**2)[0],reconciliation=binding)
    verify_plan(plan,layout,removed,full=False)
    for row in plan['delete'][38:]:match_snapshot(snapshot(Path(row['path'])),row['snapshot'],removed)
    capacity(layout,'audit30-reconciliation-plan')
    admitted=load_citation_review(plan.get('citationReview'),layout,plan['protected'],'cleanup',[r['path'] for r in plan['delete']],approval_sha)
    plan['references']=references([r['path'] for r in plan['delete'][38:]],layout.refs+[Path(r['path']) for r in plan['protected']['sources']],reviewed_files=admitted)
    plan['limits']='Explicit reviewed original38-prefix reconciliation; only original two remaining sidecars may retire. Exact old/new log inode census and pinned configured rotation evidence are retained. No automatic resume, dynamic guard exemption, generic hold/mask or capacity change.'
    return plan

def create_plan(layout, kind, approval_sha, policy_scope=None, prerequisite=None, inverse_receipt=None,citation_review=None):
    cache={}; protected=protected_pair(layout,cache); guards,review=safeguards(layout)
    plan=dict(schema='pow-audit30-exact-ui-storage-plan-v1',kind=kind,host='77.42.91.106',atUtc=utc(),scopeApprovalSha256=approval_sha,safeguards=guards,protected=protected,delete=[],moves=[],policyScope=policy_scope,capacityHelperSha256=hash_read(layout.capacity,1024**2)[0],controllerSha256=hash_read(Path(__file__).resolve(),1024**2)[0])
    if kind in ('cleanup','future-retention'):
        rows=layout.exact() if kind=='cleanup' else policy_scope['eligible']
        keep={protected[k]['path'] for k in ('current','previous')}|{r['path'] for r in protected['sources']}|{str(layout.archives/protected[k]['fields']['archive_name'])+s for k in ('current','previous') for s in ('','.sha256','.provenance')}
        if any(r['path'] in keep for r in rows):raise ValueError('Cleanup includes retained current/prior dependency')
        plan['heldBoundaries']=held_boundary([r['path'] for r in rows],review,layout)
        passed={protected[k]['passthroughSha256'] for k in ('current','previous')}
        for row in rows:
            p=Path(row['path']); r=dict(row)
            if row['kind']=='rollback-root':
                proof=release_proof(p,layout,cache)
                if proof['passthroughSha256'] not in passed:raise ValueError('Unique non-release rollback content')
                r['release']=proof; r['snapshot']=proof['snapshot']
            else:r['snapshot']=snapshot(p)
            plan['delete'].append(r)
        for row in rows:
            if row['kind']!='managed-release-archive':continue
            p=Path(row['path'])
            if str(p) not in cache:raise ValueError('No verified retained/candidate root proves archive recovery equivalence')
    elif kind in ('preserve-sources','inverse-preservation'):
        if kind=='preserve-sources':
            if not prerequisite:raise ValueError('Completed exact cleanup prerequisite required')
            plan['cleanupPrerequisite']=cleanup_prerequisite(Path(prerequisite['path']),prerequisite['sha256'],layout,approval_sha)
        else:
            if not inverse_receipt:raise ValueError('Preservation receipt required for inverse plan')
            value,h=read_json(Path(inverse_receipt['path']),inverse_receipt['sha256'])
            if value.get('schema')!='pow-audit30-ui-storage-progress-v1' or value.get('status') not in ('partial','failed','completed'):raise ValueError('Invalid preservation receipt')
            intent,_=read_json(Path(value['intentPath']),value['intentSha256']);original=intent['plan']
            validate_plan(original,layout,'preserve-sources',approval_sha)
            if intent['planSha256']!=value['planSha256']:raise ValueError('Inverse intent/result binding differs')
            plan['inverseReceipt']=dict(path=inverse_receipt['path'],sha256=h)
        keep={r['path'] for r in protected['sources']}
        mappings=layout.moves() if kind=='preserve-sources' else [dict(source=r['target'],target=r['source']) for r in layout.moves()]
        for row in mappings:
            p=Path(row['source']); q=Path(row['target'])
            if kind=='inverse-preservation' and not os.path.lexists(p):
                if not os.path.lexists(q):raise ValueError('Inverse mapping has neither source nor target')
                continue  # A partial preservation may leave later originals untouched.
            if str(p) in keep or os.path.lexists(q):raise ValueError('Protected source or existing preservation target')
            held_boundary([str(p),str(q)],review,layout)
            # Internal relative symlinks remain valid after a whole-directory rename.
            meta=source_pointers(p)
            if not meta['head'].startswith(p.name.split('-')[3]):raise ValueError('Source commit/name differs')
            fp=snapshot(p,links=True)
            if kind=='inverse-preservation':
                before=next(r['snapshot'] for r in original['moves'] if r['target']==str(p));match_snapshot(fp,before,relocation=True)
            plan['moves'].append(dict(row,git=meta,snapshot=fp,allocatedBytes=int(subprocess.check_output(['/usr/bin/du','-x','-s','-B1',str(p)],timeout=30).split()[0])))
    else:raise ValueError('Unsupported operation')
    paths=[r['path'] for r in plan['delete']]+[r['source'] for r in plan['moves']]
    plan['citationReview']=citation_review
    admitted=load_citation_review(citation_review,layout,protected,kind,[r['path'] for r in plan['delete']],approval_sha)
    plan['references']=references(paths,layout.refs+[Path(r['path']) for r in protected['sources']],reviewed_files=admitted)
    plan['archives']=list(cache.values())
    plan['limits']='Exact snapshots and bounded pointer scan; unresolved held absences remain reported, never exempted. Existing capacities/hold/masks must stay unchanged.'
    return plan

def validate_plan(plan,layout,kind,approval_sha):
    if plan.get('schema')!='pow-audit30-exact-ui-storage-plan-v1' or plan.get('host')!='77.42.91.106' or plan.get('kind')!=kind or plan.get('scopeApprovalSha256')!=approval_sha:raise ValueError('Wrong or forged operation plan')
    protected=plan['protected'];current=protected['current'];previous=protected['previous']
    if current['path']!=str(layout.live) or previous['path']!=str(layout.roots/('proofofwork-www-pre-'+current['fields']['release_id'])) or current['fields']['release_id']==previous['fields']['release_id']:raise ValueError('Protected live/immediate-prior paths differ')
    wanted_sources=[str(layout.scratch/('proofofwork-ui-source-'+r['fields']['release_id'])) for r in (current,previous)]
    if [r['path'] for r in protected['sources']]!=wanted_sources:raise ValueError('Protected source dependency paths differ')
    for r in [current,previous,*protected['sources']]:
        if r['snapshot']['path']!=r['path'] or digest(r['snapshot']['entries'])!=r['snapshot']['sha256']:raise ValueError('Malformed protected snapshot')
    if kind=='cleanup':
        observed=[{k:r[k] for k in ('path','kind')} for r in plan['delete']]
        if observed!=layout.exact() or plan['moves']:raise ValueError('Expanded, reordered or partial 40-path scope')
        if 'reconciliation' in plan:
            binding=plan['reconciliation']
            if not isinstance(binding,dict) or set(binding)!= {'path','sha256'} or not SHA.fullmatch(binding['sha256']):raise ValueError('Invalid explicit reconciliation binding')
    elif kind=='preserve-sources':
        if [{k:r[k] for k in ('source','target')} for r in plan['moves']]!=layout.moves() or plan['delete']:raise ValueError('Expanded/partial preservation scope')
    elif kind=='inverse-preservation':
        permitted=[dict(source=r['target'],target=r['source']) for r in layout.moves()]
        observed=[{k:r[k] for k in ('source','target')} for r in plan['moves']]
        if plan['delete'] or not observed or len({r['source'] for r in observed})!=len(observed) or any(r not in permitted for r in observed):raise ValueError('Expanded inverse preservation scope')
    elif kind=='future-retention':
        if plan['delete']!=[] and [{k:r[k] for k in ('path','kind')} for r in plan['delete']]!=plan['policyScope']['eligible']:raise ValueError('Future admission scope differs')
        if plan['moves']:raise ValueError('Future policy cannot relocate sources')
    else:raise ValueError('Unsupported plan kind')
    if len({r['path'] for r in plan['delete']})!=len(plan['delete']):raise ValueError('Duplicate deletion path')
    citation=plan.get('citationReview')
    if citation is not None and (kind not in ('cleanup','future-retention') or not isinstance(citation,dict) or set(citation)!= {'path','sha256'} or not SHA.fullmatch(citation['sha256'])):raise ValueError('Invalid citation-review plan binding')
    for row in plan['delete']+plan['moves']:
        fp=row['snapshot']
        if fp['path']!=row.get('path',row.get('source')) or digest(fp['entries'])!=fp['sha256']:raise ValueError('Malformed candidate snapshot')


def sync_dir(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)

def durable(path,value):
    safe(path.parent,True)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as f:f.write(encoded(value)+b'\n');f.flush();os.fsync(f.fileno())
    sync_dir(path.parent)

def rename_no_replace(source,target):
    """Linux atomic rename; never degrade to a check followed by overwriting rename."""
    libc=ctypes.CDLL(None,use_errno=True)
    if not hasattr(libc,'renameat2'):raise ValueError('Atomic no-replace rename unavailable')
    function=libc.renameat2;function.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];function.restype=ctypes.c_int
    left=os.open(source.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);right=os.open(target.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        if os.fstat(left).st_dev!=os.fstat(right).st_dev:raise ValueError('Cross-filesystem rename refused')
        if function(left,os.fsencode(source.name),right,os.fsencode(target.name),1)!=0:
            code=ctypes.get_errno();raise OSError(code,os.strerror(code))
        os.fsync(left);os.fsync(right)
    finally:os.close(left);os.close(right)

def capacity(layout,phase,additional_bytes=8*1024**2,scratch_bytes=0):
    # Preserve installed reserve/scratch/inode protections; no prospective recovery credit.
    safe(layout.capacity,False)
    subprocess.run(['/usr/bin/python3','-I','-B',str(layout.capacity),'check','--path',str(layout.scratch),'--additional-bytes',str(additional_bytes),'--additional-inodes','256','--phase',phase],check=True,timeout=60,capture_output=True)
    subprocess.run(['/usr/bin/python3','-I','-B',str(layout.capacity),'check-scratch','--path',str(layout.scratch),'--additional-bytes',str(scratch_bytes),'--phase',phase],check=True,timeout=60,capture_output=True)

def compare_guards(layout,expected,paths):
    actual,_=safeguards(layout)
    # Held parents survive; expected metadata intentionally omits directory timestamps/counts.
    if actual!=expected:raise ValueError('Hold bytes, masks or held-path census changed')

def resources(layout):
    v=os.statvfs(layout.scratch)
    allocated=int(subprocess.check_output(['/usr/bin/du','-x','-s','-B1',str(layout.scratch)],timeout=120).split()[0])
    return dict(atUtc=utc(),availableRootBytes=v.f_bavail*v.f_frsize,availableInodes=v.f_favail,scratchAllocatedBytes=allocated,scratchMaximumBytes=5*1024**3,scratchHeadroomBytes=5*1024**3-allocated,qualification='Observed filesystem endpoints include concurrent background writes and new durable evidence; retirement recovery is not the sum of hardlinked apparent sizes. Preservation reclassifies allocation and does not free root bytes.')

def verify_plan(plan,layout,removed=None,full=True):
    removed=removed or {}
    if 'reconciliation' in plan:
        original,failed,review,reconstructed=reconciliation_state(layout,plan['reconciliation'],plan['scopeApprovalSha256'])
        if plan['kind']!='cleanup' or any(plan[k]!=original[k] for k in ('delete','moves','protected','archives','heldBoundaries','citationReview','capacityHelperSha256','policyScope')) or plan['safeguards']!=review['afterGuards']:raise ValueError('Reconciliation expanded or rewrote original proof/scope')
        if not removed:removed=reconstructed
        if full:
            for row in plan['delete'][38:]:match_snapshot(snapshot(Path(row['path'])),row['snapshot'],removed)
        full=False  # Original retired prefix is proven by its exact immutable intent/result.
    compare_guards(layout,plan['safeguards'],[])
    if hash_read(layout.capacity,1024**2)[0]!=plan['capacityHelperSha256']:raise ValueError('Installed capacity helper changed')
    if hash_read(Path(__file__).resolve(),1024**2)[0]!=plan['controllerSha256']:raise ValueError('Controller version changed since exact plan')
    if plan['kind']=='preserve-sources':cleanup_prerequisite(Path(plan['cleanupPrerequisite']['path']),plan['cleanupPrerequisite']['sha256'],layout,plan['scopeApprovalSha256'])
    paths=[r['path'] for r in plan['delete'] if os.path.lexists(r['path'])]+[r['source'] for r in plan['moves'] if os.path.lexists(r['source'])]
    admitted=load_citation_review(plan.get('citationReview'),layout,plan['protected'],plan['kind'],[r['path'] for r in plan['delete']],plan['scopeApprovalSha256'])
    references(paths,layout.refs+[Path(r['path']) for r in plan['protected']['sources']],reviewed_files=admitted)
    protected=plan['protected']; cache={}
    for k in ('current','previous'):
        expected=protected[k]; actual=release_proof(Path(expected['path']),layout,cache)
        if actual['fields']!=expected['fields']:raise ValueError('Current/prior release changed')
        match_snapshot(actual['snapshot'],expected['snapshot'],removed)
        retained_archive=cache[str(layout.archives/expected['fields']['archive_name'])]
        archived=next((r for r in plan['archives'] if r['path']==retained_archive['path']),None)
        if archived is None:raise ValueError('Retained archive snapshot absent from frozen plan')
        match_snapshot(retained_archive['snapshot'],archived['snapshot'],removed)
        if [r['path'] for r in retained_archive['sidecars']]!=[r['path'] for r in archived['sidecars']]:raise ValueError('Retained archive sidecar scope differs')
        for observed,frozen in zip(retained_archive['sidecars'],archived['sidecars']):match_snapshot(observed,frozen,removed)
    for r in protected['sources']:match_snapshot(snapshot(Path(r['path']),links=True),r['snapshot'],removed)
    if full:
        for r in plan['delete']:
            match_snapshot(snapshot(Path(r['path'])),r['snapshot'],removed)
            if r['kind']=='rollback-root':
                proof=release_proof(Path(r['path']),layout,cache)
                if proof['fields']!=r['release']['fields']:raise ValueError('Candidate provenance changed')
        for r in plan['moves']:
            source_pointers(Path(r['source']));match_snapshot(snapshot(Path(r['source']),links=True),r['snapshot'])
        for r in plan['archives']:
            match_snapshot(snapshot(Path(r['path'])),r['snapshot'],removed)
            for s in r['sidecars']:match_snapshot(snapshot(Path(s['path'])),s,removed)

@contextlib.contextmanager
def graceful_termination():
    previous={}
    def interrupted(number,frame):raise InterruptedError('Graceful termination signal '+str(number))
    for number in (signal.SIGTERM,signal.SIGHUP,signal.SIGINT):
        previous[number]=signal.signal(number,interrupted)
    try:yield
    finally:
        for number,handler in previous.items():signal.signal(number,handler)

def execute(plan,plan_sha,layout,apply=False):
    if not apply:return execute_impl(plan,plan_sha,layout,False)
    with graceful_termination():return execute_impl(plan,plan_sha,layout,True)

def execute_impl(plan,plan_sha,layout,apply=False):
    verify_plan(plan,layout)
    if not apply:return dict(status='verified',planSha256=plan_sha,productionMutation=False,missingHeldPaths=plan['safeguards']['missingHeldPaths'])
    if not shutil.rmtree.avoids_symlink_attacks:raise ValueError('Descriptor-based rmtree unavailable')
    evidence_bound=max(8*1024**2,len(encoded(plan))*(4+2*len(plan['moves']))+len(plan['delete'])*4096)
    safe(layout.evidence,True);capacity(layout,'audit30-evidence',evidence_bound)
    completed=[]; removed=collections.Counter()
    if 'reconciliation' in plan:
        _,failed,_,removed=reconciliation_state(layout,plan['reconciliation'],plan['scopeApprovalSha256']);completed=list(failed['completed'])
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ');prefix=layout.evidence/('audit30-'+plan['kind']+'-'+stamp)
    before_capacity=resources(layout)
    intent=Path(str(prefix)+'-intent.json');phase='before-action';current=None
    def progress(status,error=None):
        p=Path(str(prefix)+'-'+str(len(completed)).zfill(3)+'-'+status+'.json')
        try:
            actual,_=safeguards(layout);guards_unchanged=actual==plan['safeguards'];missing=actual['missingHeldPaths']
        except (OSError,ValueError):guards_unchanged=False;missing=None
        if status=='completed' and not guards_unchanged:raise ValueError('Completion guard fence changed')
        after_capacity=resources(layout) if status in ('completed','failed') else None
        durable(p,dict(schema='pow-audit30-ui-storage-progress-v1',status=status,atUtc=utc(),planSha256=plan_sha,intentPath=str(intent),intentSha256=hash_read(intent,MAX_JSON)[0],completed=completed,currentPath=current,phase=phase,errorClass=error,missingHeldPaths=missing,holdsAndMasksUnchanged=guards_unchanged,guardBaselinePlanSha256=plan_sha,guardBaseline='fresh-explicitly-reconciled-plan' if 'reconciliation' in plan else 'original-plan',reconciliation=plan.get('reconciliation'),beforeCapacity=before_capacity,afterCapacity=after_capacity,observedAvailableRootBytesChange=after_capacity['availableRootBytes']-before_capacity['availableRootBytes'] if after_capacity else None))
        return p
    try:
        durable(intent,dict(schema='pow-audit30-ui-storage-intent-v1',plan=plan,planSha256=plan_sha,atUtc=utc(),status='approved-intent',beforeCapacity=before_capacity))
        for r in plan['delete'][len(completed):]:
            current=r['path'];phase='immediate-before-retirement'; verify_plan(plan,layout,removed,full=False)
            before=snapshot(Path(current));match_snapshot(before,r['snapshot'],removed);references([current],layout.refs)
            parent=Path(current).parent;fd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            try:
                expected=before['entries'][0];opened=os.stat(Path(current).name,dir_fd=fd,follow_symlinks=False)
                if (opened.st_dev,opened.st_ino)!=(expected['device'],expected['inode']):raise ValueError('Immediate deletion inode changed')
                phase='retirement'
                if r['kind']=='rollback-root':shutil.rmtree(Path(current).name,dir_fd=fd)
                else:os.unlink(Path(current).name,dir_fd=fd)
                os.fsync(fd)
            finally:os.close(fd)
            for entry in before['entries']:
                if entry['kind']=='file':removed[(entry['device'],entry['inode'])]+=1
            completed.append(dict(path=current,outcome='retired',snapshotSha256=before['sha256'],atUtc=utc()));progress('partial')
        if plan['moves']:
            capacity(layout,'audit30-source-preservation',scratch_bytes=sum(r['allocatedBytes'] for r in plan['moves']) if plan['kind']=='inverse-preservation' else 0)
            if plan['kind']=='preserve-sources':
                safe(layout.target.parent,True)
                if os.path.lexists(layout.target):safe(layout.target,True)
                else:layout.target.mkdir(mode=0o700);sync_dir(layout.target.parent)
            for r in plan['moves']:
                current=r['source'];phase='immediate-before-preservation';verify_plan(plan,layout,full=False)
                p=Path(current);q=Path(r['target']);source_pointers(p);before=snapshot(p,links=True);match_snapshot(before,r['snapshot']);references([p,q],layout.refs+[Path(x['path']) for x in plan['protected']['sources']])
                if os.path.lexists(q) or safe(p.parent,True).st_dev!=safe(q.parent,True).st_dev:raise ValueError('Target exists or cross-filesystem preservation')
                phase='atomic-preservation';rename_no_replace(p,q)
                after=snapshot(q,links=True);match_snapshot(after,before,relocation=True)
                completed.append(dict(source=str(p),target=str(q),outcome='preserved',beforeSnapshot=before,afterSnapshot=after,inverse=dict(source=str(q),target=str(p)),expectedChanges='root pathname/ctime and both parent directory metadata',rootDiskBytesRecovered=0,atUtc=utc()));progress('partial')
        phase='final-verification';verify_plan(plan,layout,removed,full=False)
        if any(os.path.lexists(r['path']) for r in plan['delete']):raise ValueError('Retired path remains')
        for r in plan['moves']:
            if os.path.lexists(r['source']):raise ValueError('Preserved original path remains')
            match_snapshot(snapshot(Path(r['target']),links=True),r['snapshot'],relocation=True)
        out=progress('completed');return dict(status='completed',receiptPath=str(out),receiptSha256=hash_read(out,MAX_JSON)[0],planSha256=plan_sha,completedCount=len(completed),optInPolicyApplied=plan['kind']=='future-retention',ordinaryPruneTimersActivated=False)
    except BaseException as e:
        progress('failed',type(e).__name__);raise


def lock(layout):
    s=safe(layout.lock,False)
    if s.st_nlink!=1:raise ValueError('Lock has multiple links')
    fd=os.open(layout.lock,os.O_RDONLY|os.O_NOFOLLOW)
    if identity(os.fstat(fd))!=identity(s):raise ValueError('Lock identity changed')
    try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BaseException:os.close(fd);raise
    return fd

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('command',choices=['plan-cleanup','plan-reconcile','plan-preservation','plan-inverse','verify','apply'])
    p.add_argument('--approval',type=Path,required=True);p.add_argument('--approval-sha256',required=True);p.add_argument('--plan',type=Path);p.add_argument('--plan-sha256')
    p.add_argument('--cleanup-receipt',type=Path);p.add_argument('--cleanup-receipt-sha256');p.add_argument('--preservation-receipt',type=Path);p.add_argument('--preservation-receipt-sha256')
    p.add_argument('--citation-review',type=Path);p.add_argument('--citation-review-sha256')
    p.add_argument('--reconciliation-review',type=Path);p.add_argument('--reconciliation-review-sha256')
    a=p.parse_args()
    if os.geteuid()!=0:raise ValueError('Production controller requires root')
    layout=Layout();fd=lock(layout);os.nice(15)
    try:
        if bool(a.citation_review)!=bool(a.citation_review_sha256) or a.citation_review and a.command!='plan-cleanup':raise ValueError('Citation path/SHA pair is admitted only by a cleanup plan')
        if bool(a.reconciliation_review)!=bool(a.reconciliation_review_sha256) or a.reconciliation_review and a.command!='plan-reconcile':raise ValueError('Reconciliation path/SHA pair is admitted only by explicit reconciliation planning')
        if a.command=='plan-reconcile':
            approval(a.approval,a.approval_sha256,'cleanup')
            if not a.reconciliation_review:raise ValueError('Explicit hash-bound reconciliation review required')
            plan=create_reconciliation_plan(layout,a.approval_sha256,dict(path=str(a.reconciliation_review),sha256=a.reconciliation_review_sha256));print(json.dumps(plan,sort_keys=True));return
        if a.command.startswith('plan-'):
            kind={'plan-cleanup':'cleanup','plan-preservation':'preserve-sources','plan-inverse':'inverse-preservation'}[a.command];approval(a.approval,a.approval_sha256,kind)
            prerequisite=dict(path=str(a.cleanup_receipt),sha256=a.cleanup_receipt_sha256) if a.cleanup_receipt and a.cleanup_receipt_sha256 else None
            inverse=dict(path=str(a.preservation_receipt),sha256=a.preservation_receipt_sha256) if a.preservation_receipt and a.preservation_receipt_sha256 else None
            citation=dict(path=str(a.citation_review),sha256=a.citation_review_sha256) if a.citation_review else None
            plan=create_plan(layout,kind,a.approval_sha256,prerequisite=prerequisite,inverse_receipt=inverse,citation_review=citation);print(json.dumps(plan,sort_keys=True));return
        if not a.plan or not a.plan_sha256:raise ValueError('Exact reviewed plan path and SHA required')
        plan,h=read_json(a.plan,a.plan_sha256)
        if plan.get('kind')=='future-retention':raise ValueError('Future plans require the per-release admission policy controller')
        approval(a.approval,a.approval_sha256,plan.get('kind'));validate_plan(plan,layout,plan.get('kind'),a.approval_sha256)
        print(json.dumps(execute(plan,h,layout,a.command=='apply'),sort_keys=True))
    finally:os.close(fd)

if __name__=='__main__':
    try:main()
    except (OSError,ValueError,subprocess.SubprocessError,tarfile.TarError) as error:
        print(json.dumps(dict(status='refused',errorClass=type(error).__name__,error=str(error))),file=sys.stderr);raise SystemExit(1)
