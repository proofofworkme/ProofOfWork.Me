#!/usr/bin/env python3
"""Prepare, transfer or dispatch a fixed Publish renderer package.

capture reads production; build creates only a new local directory. transfer
creates only the exact private package; install is the explicit activation step.
"""
import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tarfile

HERE = Path(__file__).resolve().parent
SSH = ['ssh', '-i', '/home/sixer/.ssh/proofofwork_me_ed25519', '-o', 'BatchMode=yes',
       '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15',
       '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=8', 'root@77.42.91.106']


def controller():
    spec = importlib.util.spec_from_file_location('publish_render_install', HERE/'install.py')
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, indent=2)+'\n').encode()


def save(path, raw):
    fd = os.open(path, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as out:
        out.write(raw); out.flush(); os.fsync(out.fileno())


def output_path(path):
    if not path.is_absolute() or path.resolve() != path or not str(path).startswith('/tmp/') or os.path.lexists(path):
        raise ValueError('Use a new canonical local /tmp output')


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])


def capture(args):
    output_path(args.output)
    code = (HERE/'install.py').read_bytes()
    result = subprocess.run([*SSH, shlex.join(['/usr/bin/python3', '-I', '-B', '-', '--capture'])],
        input=code, capture_output=True, timeout=180, check=True)
    value = json.loads(result.stdout)
    value['captureControllerSha256'] = sha(code)
    save(args.output, encoded(value))
    print(json.dumps({'capture': str(args.output), 'sha256': sha(encoded(value))}))


def build(args):
    c = controller(); output_path(args.output)
    if not re.fullmatch('[0-9a-f]{40}', args.commit) or git(args.repo, 'rev-parse', 'HEAD').decode().strip() != args.commit:
        raise ValueError('Full current source commit required')
    if git(args.repo, 'status', '--porcelain', '--untracked-files=no').strip():
        raise ValueError('Build requires clean committed source')
    if not re.fullmatch('[a-z0-9][a-z0-9-]{0,30}', args.attempt):
        raise ValueError('Invalid fresh attempt name')
    names = [*c.SOURCE_FILES, c.UNIT_TEMPLATE, 'deploy/publish-render/install.py']
    blobs = {}
    for name in [*names, 'deploy/publish-render/package.py']:
        raw = git(args.repo, 'show', args.commit+':'+name)
        if raw != (args.repo/name).read_bytes(): raise ValueError('Working source differs: '+name)
        if name in names: blobs[name] = raw
    if blobs['deploy/publish-render/install.py'] != (HERE/'install.py').read_bytes():
        raise ValueError('Run exact committed package controller')
    before = json.loads(args.capture.read_bytes())
    if before.pop('captureControllerSha256') != sha(blobs['deploy/publish-render/install.py']):
        raise ValueError('Capture controller differs from committed installer')
    node = args.node_archive.read_bytes()
    c.archive_inventory(node)
    source = {'format': 'proof-of-work-publish-render-source-v1', 'commit': args.commit,
              'tree': git(args.repo, 'rev-parse', args.commit+'^{tree}').decode().strip(),
              'files': {name: sha(blobs[name]) for name in c.SOURCE_FILES}}
    plan = {'format': 'proof-of-work-publish-render-install-v1', 'source': source,
            'attempt': args.attempt, 'before': before, 'nodeArchiveSha256': c.NODE_SHA,
            'installerSha256': sha(blobs['deploy/publish-render/install.py']),
            'unitTemplateSha256': sha(blobs[c.UNIT_TEMPLATE])}
    blobs[c.NODE_NAME+'.tar.xz'] = node
    blobs['plan.json'] = encoded(plan)
    args.output.mkdir(mode=0o700)
    for name, raw in blobs.items():
        dest = args.output/name; dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700); save(dest, raw)
    receipt = {'format': 'proof-of-work-publish-render-package-v1', 'commit': args.commit,
               'planSha256': sha(blobs['plan.json']), 'files': {name: sha(raw) for name,raw in blobs.items()},
               'remotePackage': str(c.BASE/('publish-render-'+args.commit[:12]+'-'+args.attempt))}
    save(args.output/'package.json', encoded(receipt))
    print(json.dumps(receipt, sort_keys=True))


TRANSFER = r'''
import fcntl,hashlib,io,json,os,pathlib,stat,subprocess,sys,tarfile
expected=json.loads(sys.argv[1]); maximum=160*1024**2
raw=sys.stdin.buffer.read(maximum+1)
assert len(raw)<=maximum and hashlib.sha256(raw).hexdigest()==expected['payloadSha256']
blobs={}
with tarfile.open(fileobj=io.BytesIO(raw),mode='r:') as archive:
 for member in archive:
  assert member.isfile() and member.name in expected['files'] and member.name not in blobs
  body=archive.extractfile(member).read(member.size+1)
  assert len(body)==member.size and hashlib.sha256(body).hexdigest()==expected['files'][member.name]
  blobs[member.name]=body
assert set(blobs)==set(expected['files'])
ns={'__name__':'publish_render_transfer_guard','__file__':'<verified-package>'}
exec(compile(blobs['deploy/publish-render/install.py'],'<verified-package>','exec'),ns)
plan=json.loads(blobs['plan.json']); assert ns['digest'](blobs['plan.json'])==expected['planSha256']
base=ns['BASE']; target=pathlib.Path(expected['remotePackage'])
assert target==base/('publish-render-'+plan['source']['commit'][:12]+'-'+plan['attempt'])
ns['directory'](base); ns['read_safe'](ns['LOCK'],0)
fd=os.open(ns['LOCK'],os.O_RDONLY|os.O_NOFOLLOW); fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
assert ns['capture']()==plan['before']
assert not os.path.lexists(target)
amount=sum(((len(v)+4095)//4096)*4096+16384 for v in blobs.values())+1024**2
ns['admit'](fd,base,amount,256,'publish-render-package-transfer')
ns['run'](['/usr/bin/python3','-I','-B',str(ns['CAPACITY']),'check-scratch','--path',str(base),
 '--additional-bytes',str(amount),'--phase','publish-render-package-transfer'],fd)
ns['mkdir'](target,0o700)
for name,body in blobs.items():
 path=target/name
 assert path.is_relative_to(target) and '..' not in pathlib.Path(name).parts
 for parent in reversed(path.parent.parents):
  if parent==target or parent.is_relative_to(target):
   if not parent.exists(): ns['mkdir'](parent,0o700)
 if not path.parent.exists(): ns['mkdir'](path.parent,0o700)
 ns['save'](path,body)
ns['save'](target/'transfer.json',ns['encoded']({'ok':True,'payloadSha256':expected['payloadSha256'],
 'files':expected['files'],'admittedBytes':amount,'historicalDeletion':False}))
print(json.dumps({'ok':True,'package':str(target),'planSha256':expected['planSha256']}))
'''


def read_package(path):
    c = controller()
    if not path.is_absolute() or path.resolve() != path: raise ValueError('Canonical package path required')
    receipt = json.loads((path/'package.json').read_bytes())
    allowed = {*c.SOURCE_FILES, c.UNIT_TEMPLATE, 'deploy/publish-render/install.py', c.NODE_NAME+'.tar.xz', 'plan.json'}
    if set(receipt['files']) != allowed: raise ValueError('Package scope differs')
    blobs = {}
    for name, expected in receipt['files'].items():
        p = path/name
        if p.resolve() != p or not p.is_file(): raise ValueError('Unsafe package file')
        raw = p.read_bytes()
        if sha(raw) != expected: raise ValueError('Package checksum differs: '+name)
        blobs[name] = raw
    if sha(blobs['plan.json']) != receipt['planSha256']: raise ValueError('Plan checksum differs')
    if blobs['deploy/publish-render/install.py'] != (HERE/'install.py').read_bytes():
        raise ValueError('Local installer differs from package')
    return receipt, blobs


def transfer(args):
    receipt, blobs = read_package(args.package)
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode='w') as archive:
        for name, raw in blobs.items():
            item = tarfile.TarInfo(name); item.size = len(raw); item.mode = 0o600
            archive.addfile(item, io.BytesIO(raw))
    raw = data.getvalue(); expected = {**receipt, 'payloadSha256': sha(raw)}
    command = shlex.join(['/usr/bin/python3', '-I', '-B', '-c', TRANSFER, json.dumps(expected)])
    result = subprocess.run([*SSH, command], input=raw, capture_output=True, timeout=300)
    print(result.stdout.decode(), end='')
    if result.returncode:
        raise RuntimeError('Transfer failed or uncertain; preserve remote package and inspect before retry: '+result.stderr.decode()[-3000:])


def dispatch(args):
    receipt, blobs = read_package(args.package)
    plan = json.loads(blobs['plan.json'])
    unit = 'proofofwork-publish-render-install-'+plan['source']['commit'][:12]+'-'+plan['attempt']
    path = receipt['remotePackage']+'/deploy/publish-render/install.py'
    guard = "import hashlib,os,pathlib,stat,sys; p=pathlib.Path(sys.argv[1]); s=p.lstat(); assert p.resolve()==p and stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and not s.st_mode & 0o7022 and s.st_size<1048576; assert hashlib.sha256(p.read_bytes()).hexdigest()==sys.argv[2]; os.execv('/usr/bin/systemd-run',sys.argv[3:])"
    argv = ['/usr/bin/systemd-run', '--unit='+unit, '--service-type=exec', '--wait', '--pipe',
        '--property=User=root', '--property=Group=root', '--property=RuntimeMaxSec=600',
        '/usr/bin/python3', '-I', '-B', path, '--package', receipt['remotePackage'],
        '--plan-sha256', receipt['planSha256']]
    output_path(args.log)
    with args.log.open('xb') as log:
        result = subprocess.run([*SSH, shlex.join(['/usr/bin/python3','-I','-B','-c',guard,path,
            plan['installerSha256'],*argv])], stdin=subprocess.DEVNULL, stdout=log,
            stderr=subprocess.STDOUT, timeout=660)
    if result.returncode:
        raise RuntimeError('Installation failed or uncertain; inspect exact remote receipt/unit before retry. Log: '+str(args.log))
    print(json.dumps({'ok':True,'log':str(args.log),'unit':unit}))


def main():
    parser=argparse.ArgumentParser(description=__doc__); sub=parser.add_subparsers(dest='action',required=True)
    p=sub.add_parser('capture'); p.add_argument('output',type=Path)
    p=sub.add_parser('build'); p.add_argument('--repo',required=True,type=Path); p.add_argument('--commit',required=True)
    p.add_argument('--capture',required=True,type=Path); p.add_argument('--node-archive',required=True,type=Path)
    p.add_argument('--output',required=True,type=Path); p.add_argument('--attempt',default='initial')
    p=sub.add_parser('transfer'); p.add_argument('package',type=Path)
    p=sub.add_parser('install'); p.add_argument('package',type=Path); p.add_argument('log',type=Path)
    args=parser.parse_args(); {'capture':capture,'build':build,'transfer':transfer,'install':dispatch}[args.action](args)


if __name__=='__main__': main()
