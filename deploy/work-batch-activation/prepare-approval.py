#!/usr/bin/python3 -I
"""Read-only, reproducible activation approval from a reviewed successful dormant release."""
import argparse, hashlib, json, re, subprocess, sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
FIXED=frozenset({'server/proof-api.mjs','server/db/proof-index-reader.mjs','server/work-amo-v5-raw.mjs',
 'scripts/backfill-proof-indexer.mjs','server/work-batch-declaration.mjs','server/work-batch-runtime.mjs',
 'server/work-batch-selection.mjs','server/work-batch-transaction.mjs','server/db/work-batch-reader.mjs',
 'src/shared/protocol/workBatch.mjs'})
SHA=re.compile(r'[0-9a-f]{64}\Z')
def require(value,message):
    if not value:raise ValueError(message)
def sha(raw):return hashlib.sha256(raw).hexdigest()

def derive(manifest_raw,receipt_raw,source_commit,source_hashes,status_sha,node_path):
    m=json.loads(manifest_raw);r=json.loads(receipt_raw)
    require(m.get('format')=='proof-of-work-work-batch-sends-scoped-runtime-v1' and
        r.get('format')==m['format'],'Wrong dormant release evidence')
    require(m.get('sourceCommit')==source_commit and r.get('sourceCommit')==source_commit and
        r.get('manifestSha256')==sha(manifest_raw) and r.get('baselineHead')==m.get('baselineHead') and
        r.get('releaseId')==m.get('releaseId'),'Dormant release identity differs')
    require(r.get('installed') is True and r.get('rolledBack') is False and r.get('completedAt') and
        not any(r.get(key) for key in ('errorClass','recoveryIncomplete','recoveryErrorClass')),
        'Dormant release is not successfully complete')
    rows=m.get('sources',[])
    require(len(rows)==10 and {row['path'] for row in rows}==FIXED,'Wrong dormant mutation scope')
    require(SHA.fullmatch(status_sha) and re.fullmatch(r'/opt/node-[A-Za-z0-9._-]+/bin/node',node_path),
        'Reviewed runtime status and Node path required')
    runtime={}
    for name,value in m['dependencies'].items():
        metadata=m['dependencyMetadata'][name]
        runtime[name]={'sha256':value,**{key:metadata[key] for key in ('uid','gid','mode')}}
    for row in rows:
        metadata=m['sourceMetadata'][row['path']]
        runtime[row['path']]={'sha256':row['after'],**{key:metadata[key] for key in ('uid','gid','mode')}}
    require(all(SHA.fullmatch(row['sha256']) for row in runtime.values()),'Invalid runtime digest')
    require(set(source_hashes)=={'controllerSha256','probeSha256','dormantControllerSha256'} and
        all(SHA.fullmatch(value) for value in source_hashes.values()),'Incomplete reviewed controller source')
    return {'format':'work-batch-activation-approval-v1','sourceCommit':source_commit,
        'runtimeHead':m['baselineHead'],'runtimeStatusSha256':status_sha,
        'deploymentManifestSha256':sha(manifest_raw),'deploymentReceiptSha256':sha(receipt_raw),
        **source_hashes,'node':{'path':node_path,'sha256':m['nodeSha256']},'runtime':runtime}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--manifest',type=Path,required=True)
    parser.add_argument('--receipt',type=Path,required=True)
    parser.add_argument('--source-commit',required=True)
    parser.add_argument('--runtime-status-sha256',required=True)
    parser.add_argument('--node-path',required=True)
    args=parser.parse_args()
    require(re.fullmatch('[0-9a-f]{40}',args.source_commit),'Exact final source commit required')
    source_root=HERE.parent.parent
    hashes={}
    for key,name in {'controllerSha256':'deploy/work-batch-activation/controller.py',
        'probeSha256':'deploy/work-batch-activation/probe.mjs',
        'dormantControllerSha256':'deploy/work-batch-sends/scoped-node.py'}.items():
        raw=subprocess.check_output(['/usr/bin/git','-c','safe.directory='+str(source_root),
            '-C',str(source_root),'show',args.source_commit+':'+name],timeout=10)
        require(raw==(source_root/name).read_bytes(),'Controller differs from reviewed source commit')
        hashes[key]=sha(raw)
    print(json.dumps(derive(args.manifest.read_bytes(),args.receipt.read_bytes(),args.source_commit,
        hashes,args.runtime_status_sha256,args.node_path),sort_keys=True,indent=2))
if __name__=='__main__':main()
