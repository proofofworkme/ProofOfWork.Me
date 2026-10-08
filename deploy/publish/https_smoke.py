#!/usr/bin/env python3
"""Compare the downloaded managed UI archive with off-host production HTTPS.

Creation-only receipt; at most eight independent static requests run at once.
Every response is bounded by its exact expected byte count plus one byte.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import stat
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request

HOSTS = {
    'activity':'log.proofofwork.me', 'browser':'browser.proofofwork.me',
    'boost':'boost.proofofwork.me', 'computer':'computer.proofofwork.me',
    'desktop':'desktop.proofofwork.me', 'dns':'dns.proofofwork.me',
    'growth':'growth.proofofwork.me', 'id':'id.proofofwork.me',
    'inception':'inception.proofofwork.me', 'infinity':'infinity.proofofwork.me',
    'landing':'www.proofofwork.me', 'marketplace':'amo.proofofwork.me',
    'publish':'publish.proofofwork.me', 'token':'credit.proofofwork.me', 'wallet':'wallet.proofofwork.me',
    'search':'search.proofofwork.me', 'code':'code.proofofwork.me',
    'jobs':'jobs.proofofwork.me',
    'work':'work.proofofwork.me',
}
PAGES_HOSTS = {**HOSTS, 'pages': 'pages.proofofwork.me'}
MAX_FILE_BYTES = 64*1024**2
MAX_ARCHIVE_BYTES = 2*1024**3
MAX_ENTRIES = 10000

def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')

def identity(info):
    return (info.st_dev,info.st_ino,info.st_mode,info.st_uid,info.st_gid,
            info.st_nlink,info.st_size,info.st_mtime_ns,info.st_ctime_ns)

def bounded_local(path, limit):
    path = Path(path); before = path.lstat()
    if path.resolve() != path or not stat.S_ISREG(before.st_mode) or before.st_size > limit:
        raise ValueError('Unsafe or oversized local artifact: '+str(path))
    fd = os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb') as source:
        if identity(os.fstat(source.fileno())) != identity(before):
            raise ValueError('Local artifact changed before reading')
        raw = source.read(limit+1)
        if len(raw) != before.st_size or identity(os.fstat(source.fileno())) != identity(before):
            raise ValueError('Local artifact changed while reading')
    if identity(path.lstat()) != identity(before):
        raise ValueError('Local artifact changed after reading')
    return raw

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None

def compare_https(url, expected, timeout, *, apex=False):
    if len(expected)>MAX_FILE_BYTES: raise ValueError('Expected HTTP file exceeds bound')
    request = urllib.request.Request(url,headers={'Accept-Encoding':'identity',
        'User-Agent':'ProofOfWork-Me-release-byte-verifier/1'})
    # Reject redirects for all byte reads. Inspect the apex's single permanent
    # redirect separately, then compare the canonical www root explicitly.
    opener = urllib.request.build_opener(NoRedirect())
    if apex:
        canonical = 'https://www.proofofwork.me/'
        try:
            response = opener.open(request,timeout=timeout)
        except urllib.error.HTTPError as response:
            with response:
                if response.code not in (301,308) or response.geturl()!=url or response.headers.get('Location')!=canonical:
                    raise ValueError('Apex permanent redirect differs from canonical www')
        else:
            with response:
                raise ValueError('Apex did not return a permanent redirect')
        return compare_https(canonical,expected,timeout)
    with opener.open(request,timeout=timeout) as response:
        if response.status != 200 or response.geturl() != url:
            raise ValueError('Unexpected HTTP status or destination: '+url)
        encoding = response.headers.get('Content-Encoding','identity').strip().lower()
        if encoding not in ('','identity'): raise ValueError('Unexpected encoded HTTP bytes: '+url)
        length = response.headers.get('Content-Length')
        if length is not None and (not length.isdigit() or int(length)!=len(expected)):
            raise ValueError('HTTP Content-Length differs from archive: '+url)
        actual = response.read(len(expected)+1)
    if actual != expected: raise ValueError('Served bytes differ: '+url)
    return len(expected)

def durable_receipt(path,value):
    path = Path(path)
    with path.open('x') as output:
        json.dump(value,output,indent=2); output.write('\n'); output.flush(); os.fsync(output.fileno())
    fd = os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

def check(args,receipt):
    archive_path = Path(args.archive)
    if not archive_path.is_absolute() or archive_path.resolve(strict=True)!=archive_path or archive_path.is_symlink():
        raise ValueError('Archive must be canonical')
    if not re.fullmatch('[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z',args.release_id): raise ValueError('Invalid release id')
    if not re.fullmatch('[0-9a-f]{40}',args.commit) or not re.fullmatch('[0-9a-f]{40}',args.tree):
        raise ValueError('Commit/tree must be full lowercase object ids')
    if not re.fullmatch('[0-9a-f]{64}',args.archive_sha256): raise ValueError('Invalid archive SHA256')
    if not args.release_id.startswith(args.commit[:12]+'-'): raise ValueError('Release id and commit differ')
    expected_name = 'proofofwork-ui-release-'+args.release_id+'.tgz'
    if archive_path.name != expected_name: raise ValueError('Managed archive filename differs')
    before = archive_path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_size>MAX_ARCHIVE_BYTES:
        raise ValueError('Unsafe/oversized archive')
    with archive_path.open('rb') as source: actual_hash = hashlib.file_digest(source,'sha256').hexdigest()
    if identity(archive_path.lstat()) != identity(before) or actual_hash != args.archive_sha256:
        raise ValueError('Managed archive changed or hash differs')
    active_path = archive_path.parent/'.proofofwork-ui-release'
    raw = bounded_local(active_path,65536)
    if raw != bounded_local(Path(str(archive_path)+'.provenance'),65536):
        raise ValueError('Active manifest and archive provenance differ')
    lines = raw.decode('utf-8').splitlines()
    fields = {}
    for line in lines:
        if '=' not in line: raise ValueError('Malformed active manifest line')
        key,value = line.split('=',1)
        if key in fields: raise ValueError('Duplicate active manifest key')
        fields[key] = value
    release_format = fields.get('format')
    if release_format not in ('proofofwork-ui-release-v3', 'proofofwork-ui-release-v4'):
        raise ValueError('Unsupported manifest format')
    hosts = PAGES_HOSTS if release_format == 'proofofwork-ui-release-v4' else HOSTS
    expected = {'format':release_format,'release_id':args.release_id,
                'commit':args.commit,'source_tree':args.tree,'archive_name':archive_path.name,
                'archive_sha256':args.archive_sha256}
    if any(fields.get(k)!=v for k,v in expected.items()): raise ValueError('Manifest identity differs')
    sidecar_path = Path(str(archive_path)+'.sha256')
    sidecar_raw = bounded_local(sidecar_path,4096)
    sidecar = sidecar_raw.decode('ascii').split()
    if sidecar != [args.archive_sha256,archive_path.name]: raise ValueError('Archive checksum sidecar differs')
    receipt.update({'manifestSha256':hashlib.sha256(raw).hexdigest(),'archiveBytes':before.st_size,
                    'sidecarAndProvenanceVerified':True})
    indices = {}; seen = set(); surface_set = set(); files = []; source_provenance = set()
    total_declared = 0
    with tarfile.open(archive_path,'r:gz') as archive:
        members = archive.getmembers()
        if len(members)>MAX_ENTRIES: raise ValueError('Archive entry bound exceeded')
        receipt['archiveEntries'] = len(members)
        for member in members:
            name = member.name.rstrip('/')
            path = PurePosixPath(name)
            if not name or path.is_absolute() or name!=str(path) or '..' in path.parts or '\\' in name or any(ord(c)<32 or ord(c)==127 for c in name):
                raise ValueError('Unsafe archive member name')
            if name in seen: raise ValueError('Duplicate archive member')
            seen.add(name)
            parts = path.parts
            if parts[0]!='surfaces': raise ValueError('Archive has an unexpected top-level member')
            if len(parts)==1:
                if not member.isdir(): raise ValueError('Archive surfaces root is not a directory')
                continue
            surface = parts[1]
            if surface not in set(hosts)|{'nft'}: raise ValueError('Unexpected archive surface: '+surface)
            surface_set.add(surface)
            if not member.isdir() and not member.isfile(): raise ValueError('Archive contains a link/special member')
            if member.isdir(): continue
            if len(parts)<3 or not 0<=member.size<=MAX_FILE_BYTES: raise ValueError('Invalid archive file')
            total_declared += member.size
            if total_declared>MAX_ARCHIVE_BYTES: raise ValueError('Uncompressed archive byte bound exceeded')
            if surface=='nft': continue
            if release_format == 'proofofwork-ui-release-v4' and parts[2:] == ('source-provenance.json',):
                if member.size > 65536: raise ValueError('Source provenance exceeds 64 KiB')
                with archive.extractfile(member) as source: provenance_raw = source.read(member.size + 1)
                if len(provenance_raw) != member.size: raise ValueError('Source provenance size differs')
                provenance = json.loads(provenance_raw)
                if (type(provenance) is not dict or provenance.get('format') != 'proof-of-work-ui-source-v1' or
                        provenance.get('commit') != args.commit or provenance.get('tree') != args.tree or
                        provenance.get('trackedDirty') is not False):
                    raise ValueError('Source provenance differs from exact clean release source: ' + surface)
                source_provenance.add(surface)
            files.append((member,surface,'/'.join(parts[2:])))
        if surface_set != set(hosts)|{'nft'}: raise ValueError('Archive surface set differs from the complete managed roots')
        if release_format == 'proofofwork-ui-release-v4':
            if source_provenance != set(hosts): raise ValueError('V4 source provenance is missing for one or more public surfaces')
            receipt['sourceProvenanceVerified'] = True
            receipt['sourceProvenanceSurfaces'] = len(source_provenance)
        receipt['archiveFilesSkippedNft'] = sum(1 for m in members if m.isfile() and PurePosixPath(m.name).parts[1]=='nft')
        receipt['expectedPublicFiles'] = len(files)
        # Extract on one thread, then keep only a bounded batch of <=8 expected
        # files in memory while independent HTTPS comparisons run in parallel.
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for offset in range(0,len(files),args.workers):
                batch = {}
                for member,surface,relative in files[offset:offset+args.workers]:
                    with archive.extractfile(member) as source: data = source.read(member.size+1)
                    if len(data)!=member.size: raise ValueError('Archived file size differs')
                    if relative=='index.html':
                        if surface in indices: raise ValueError('Duplicate surface index')
                        indices[surface] = data
                    url = 'https://'+hosts[surface]+'/'+urllib.parse.quote(relative,safe='/')
                    batch[pool.submit(compare_https,url,data,args.timeout)] = url
                errors = []
                for future in as_completed(batch):
                    try:
                        receipt['verifiedResponseBytes'] += future.result()
                        receipt['archivedFilesChecked'] += 1
                    except Exception as error: errors.append(error)
                if errors: raise errors[0]
    if identity(archive_path.lstat()) != identity(before): raise ValueError('Archive changed during smoke')
    if set(indices)!=set(hosts): raise ValueError('One or more public surface indices are missing')
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        batch = {pool.submit(compare_https,'https://'+host+'/',indices[surface],args.timeout):surface for surface,host in hosts.items()}
        errors = []
        for future in as_completed(batch):
            try:
                receipt['verifiedResponseBytes'] += future.result(); receipt['hostnameRootsChecked'] += 1
            except Exception as error: errors.append(error)
        if errors: raise errors[0]
    receipt['verifiedResponseBytes'] += compare_https('https://proofofwork.me/',indices['landing'],args.timeout,apex=True)
    receipt['apexRedirectVerified'] = True
    receipt['publicSurfaces'] = len(hosts)
    # Recheck adjacent local identity after network reads, without new authority.
    if raw != bounded_local(active_path,65536) or raw != bounded_local(Path(str(archive_path)+'.provenance'),65536):
        raise ValueError('Adjacent release evidence changed during smoke')
    if sidecar_raw != bounded_local(sidecar_path,4096) or identity(archive_path.lstat()) != identity(before):
        raise ValueError('Archive/checksum evidence changed during final HTTPS reads')
    with archive_path.open('rb') as source: final_hash = hashlib.file_digest(source,'sha256').hexdigest()
    if final_hash != args.archive_sha256 or identity(archive_path.lstat()) != identity(before):
        raise ValueError('Final managed archive hash or identity differs')
    receipt['finalLocalEvidenceReverified'] = True

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive'); parser.add_argument('release_id'); parser.add_argument('commit')
    parser.add_argument('tree'); parser.add_argument('archive_sha256')
    parser.add_argument('--receipt',required=True)
    parser.add_argument('--workers',type=int,default=8)
    parser.add_argument('--timeout',type=float,default=30)
    parser.add_argument('--overall-timeout',type=float,default=900)
    args = parser.parse_args()
    if not 1<=args.workers<=8 or not 0<args.timeout<=60 or not 0<args.overall_timeout<=1800:
        parser.error('Workers must be 1–8; socket timeout must be >0 and <=60; overall timeout must be >0 and <=1800 seconds')
    receipt_path = Path(args.receipt)
    if not receipt_path.is_absolute() or receipt_path.resolve()!=receipt_path or receipt_path.exists() or receipt_path.is_symlink():
        parser.error('Receipt must be a fresh canonical absolute path')
    os.umask(0o077); started = time.monotonic()
    receipt = {'format':'publish-ui-https-byte-smoke-v1','ok':False,
        'releaseId':args.release_id,'commit':args.commit,'tree':args.tree,
        'archiveSha256':args.archive_sha256,'startedAt':stamp(),'workers':args.workers,
        'perRequestSocketTimeoutSeconds':args.timeout,'overallTimeoutSeconds':args.overall_timeout,'archivedFilesChecked':0,
        'hostnameRootsChecked':0,'verifiedResponseBytes':0,'apexRedirectVerified':False}
    def deadline_expired(signum,frame):
        # A signal exception alone could wait for slow reader threads during
        # executor shutdown. Persist a failure receipt and end the process so
        # the deadline also bounds those threads; no production state is touched.
        signal.setitimer(signal.ITIMER_REAL,0)
        receipt.update({'ok':False,'errorClass':'TimeoutError',
            'error':'Overall HTTPS smoke deadline exceeded','finishedAt':stamp(),
            'durationSeconds':round(time.monotonic()-started,3)})
        try:
            durable_receipt(receipt_path,receipt)
            print(json.dumps(receipt,sort_keys=True),flush=True)
        finally:
            os._exit(1)
    signal.signal(signal.SIGALRM,deadline_expired)
    signal.setitimer(signal.ITIMER_REAL,args.overall_timeout)
    try:
        check(args,receipt); receipt['ok'] = True
    except Exception as error:
        receipt['errorClass'] = type(error).__name__; receipt['error'] = str(error)[:600]
    signal.setitimer(signal.ITIMER_REAL,0)
    receipt['finishedAt'] = stamp(); receipt['durationSeconds'] = round(time.monotonic()-started,3)
    durable_receipt(receipt_path,receipt)
    print(json.dumps(receipt,sort_keys=True))
    return 0 if receipt['ok'] else 1

if __name__=='__main__': sys.exit(main())
