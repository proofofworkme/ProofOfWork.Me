#!/usr/bin/python3 -I
"""Prepare a VPS-only Pay gate approval from completed deployment evidence."""
import argparse, hashlib, importlib.util, json, os, re, subprocess
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('pay_gate_preparation',HERE/'write-gate.py')
gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)


def derive(manifest,receipt,capture,qualification,*,source_commit,status_sha256,hashes,bindings):
    gate.require(re.fullmatch('[0-9a-f]{40}',source_commit) and gate.SHA.fullmatch(status_sha256),
        'Exact source and reviewed runtime status required')
    expected={**manifest['dependencies'],**{row['path']:row['after'] for row in manifest['sources']}}
    gate.require(capture.get('format')=='proof-of-work-pay-runtime-capture-v1' and
        capture.get('root')=='/opt/proofofwork-api' and capture.get('baselineHead')==manifest['baselineHead'] and
        capture.get('controllerSha256')==hashes['dormantControllerSha256'] and
        capture.get('nodeSha256')==manifest['nodeSha256'], 'Wrong post-deployment capture')
    runtime={}
    for name,digest in expected.items():
        row=capture.get('sources',{}).get(name,{})
        gate.require(row.get('sha256')==digest and all(type(row.get(key)) is int for key in ('uid','gid','mode')) and
            row['uid']>=0 and row['gid']>=0 and 0<row['mode']<=0o777 and not row['mode']&0o022,
            'Captured runtime is not the completed deployment')
        runtime[name]={key:row[key] for key in ('sha256','uid','gid','mode')}
    approval={'format':'pay-activation-approval-v1','sourceCommit':source_commit,
        'runtimeHead':manifest['baselineHead'],'runtimeStatusSha256':status_sha256,
        'node':{'path':capture['nodePath'],'sha256':capture['nodeSha256']},'runtime':runtime,**hashes,
        **{key:value for key,value in bindings.items() if key!='_manifestBytes'}}
    # Validate source/receipt relationships without treating current file presence
    # or a passing flag as a substitute for completed deployment provenance.
    h={'__name__':'_pay_approval_scope'}
    exec(compile((HERE/'scoped-node.py').read_bytes(),'pay-scoped-node.py','exec'),h)
    gate.validate_deployment(manifest,bindings['_manifestBytes'],receipt,approval,h)
    gate.validate_qualification(qualification,approval)
    return approval


def main():
    gate.require(os.geteuid()==0 and gate.sys.flags.isolated and Path('/opt/proofofwork-api/server/proof-api.mjs').is_file(),
        'Prepare only on the node VPS with isolated root Python')
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('manifest','receipt','capture','qualification'):
        parser.add_argument('--'+name,type=Path,required=True);parser.add_argument('--'+name+'-sha256',required=True)
    parser.add_argument('--source-commit',required=True);parser.add_argument('--runtime-status-sha256',required=True)
    parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    repository=HERE.parent.parent
    def git(*argv):return subprocess.check_output(['/usr/bin/git','-c','safe.directory='+str(repository),'-C',str(repository),*argv],timeout=30)
    gate.require(git('rev-parse','HEAD').decode().strip()==args.source_commit and
        not git('status','--porcelain=v1','--untracked-files=all'), 'Require clean exact committed source')
    paths={'controllerSha256':HERE/'write-gate.py','probeSha256':HERE/'write-gate-probe.mjs',
        'dormantControllerSha256':HERE/'scoped-node.py','engineSha256':gate.ENGINE,'supportSha256':gate.SUPPORT,
        'checkerSha256':repository/'scripts/check-pay-live.mjs'}
    for path in [Path(__file__).resolve(),*paths.values()]:
        gate.require(path.read_bytes()==git('show',args.source_commit+':'+str(path.relative_to(repository))),
            'Preparation tools differ from committed source')
    hashes={name:gate.sha(path.read_bytes()) for name,path in paths.items()}
    bindings={};values={}
    for name in ('manifest','receipt','capture','qualification'):
        binding={'path':str(getattr(args,name)),'sha256':getattr(args,name+'_sha256')}
        values[name],raw=gate.bound_json(binding,90*1024**2 if name=='capture' else 32*1024**2)
        bindings[{'manifest':'deploymentManifest','receipt':'deploymentReceipt','capture':'capture','qualification':'qualification'}[name]]=binding
        if name=='manifest':bindings['_manifestBytes']=raw
    approval=derive(**values,source_commit=args.source_commit,status_sha256=args.runtime_status_sha256,
        hashes=hashes,bindings=bindings)
    helper=gate.load_helper(approval);gate.runtime_fence(helper,approval)
    gate.trusted_directory(args.output.parent)
    gate.require(str(args.output).startswith(('/tmp/','/data/')) and args.output.parent!=Path('/tmp') and
        args.output.parent.stat().st_mode&0o777==0o700 and not os.path.lexists(args.output), 'New private VPS output required')
    raw=gate.canonical(approval)+b'\n'
    fd=os.open(args.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
    helper['sync'](args.output.parent)
    print(json.dumps({'approval':str(args.output),'sha256':gate.sha(raw),'sourceCommit':args.source_commit,
        'runtimeFiles':len(approval['runtime']),'productionMutation':False}))


if __name__=='__main__':main()
