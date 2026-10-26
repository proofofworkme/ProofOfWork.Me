#!/usr/bin/python3 -I
"""Exact one-file canonical reader hotfix acceptance; unchanged canonical archive engine."""
import argparse
import base64
import copy
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
ENGINE = ROOT/'deploy/monitoring-reconciliation/runtime_archive.py'
ENGINE_SHA = '8ad039e14bf6b85f4c18bf0912676975111087ce90b300d0001e1629739663ae'
HELD_SHA = 'c3bd35740d7fcc135839274c8228e38f7a45c23e33567743e0d77151b32451d9'
HELD = Path('/etc/proofofwork-retention/audit28-held-review.json')
NEW = frozenset()
TARGETS = frozenset(('server/db/proof-index-reader.mjs',))
FAMILY = 'proof-of-work-work-batch-reader-fix-scoped-runtime-v1'
SHA = re.compile('[0-9a-f]{64}')

def need(value, message):
    if not value: raise ValueError(message)

def sha(raw): return hashlib.sha256(raw).hexdigest()

def strict_json(raw):
    def pairs(values):
        result = {}
        for key,value in values:
            need(key not in result,'Duplicate JSON key')
            result[key]=value
        return result
    return json.loads(raw,object_pairs_hook=pairs)

def read_initial(path, expected):
    need(path.is_absolute() and path.resolve(strict=True)==path,'Noncanonical input')
    before=path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_uid==0 and before.st_nlink==1
        and not before.st_mode & 0o7022 and before.st_size<=32*1024**2,'Unsafe input')
    with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME),'rb') as stream:
        need(os.fstat(stream.fileno())==before,'Input changed on open')
        raw=stream.read()
        need(os.fstat(stream.fileno())==before,'Input changed during read')
    need(path.lstat()==before and SHA.fullmatch(expected or '') and sha(raw)==expected,'Input digest changed')
    return raw

def validate_approval(a):
    need(set(a)=={'format','sourceCommit','sourceTree','releaseId','plan','inner',
        'acceptedSha256','previousCompletion','heldSha256'},'Unexpected approval fields')
    need(a['format']=='work-batch-reader-fix-runtime-archive-approval-v1'
        and all(re.fullmatch('[0-9a-f]{40}',a[k] or '') for k in ('sourceCommit','sourceTree'))
        and re.fullmatch(re.escape(a['sourceCommit'][:12])+r'-[0-9]{8}T[0-9]{6}Z',a['releaseId'] or ''),
        'Invalid source identity')
    for key in ('plan','previousCompletion'):
        row=a[key]
        need(type(row)is dict and set(row)==({'path','sha256'} if key=='plan'
            else {'path','sha256','archiveSha256'}),'Invalid evidence reference')
        need(Path(row['path']).is_absolute() and SHA.fullmatch(row['sha256'] or ''),'Invalid evidence pin')
    need(set(a['inner'])=={'path','manifestSha256','receiptSha256'}
        and Path(a['inner']['path']).is_absolute()
        and all(SHA.fullmatch(a['inner'][key] or '') for key in ('manifestSha256','receiptSha256'))
        and SHA.fullmatch(a['acceptedSha256'] or '')
        and SHA.fullmatch(a['previousCompletion']['archiveSha256'] or '')
        and a['heldSha256']==HELD_SHA,'Missing lifecycle pins')

def committed_sources(a, engine_raw):
    git=['/usr/bin/git','-c','safe.directory='+str(ROOT),'-C',str(ROOT)]
    need(subprocess.check_output(git+['rev-parse','HEAD'],timeout=10).decode().strip()==a['sourceCommit']
        and subprocess.check_output(git+['rev-parse','HEAD^{tree}'],timeout=10).decode().strip()==a['sourceTree']
        and not subprocess.check_output(git+['status','--porcelain=v1','--untracked-files=all'],timeout=20),
        'Archive source checkout differs')
    paths={'deploy/work-batch-reader-fix/runtime-archive.py':Path(__file__),
        'deploy/work-batch-reader-fix/scoped-node.py':ROOT/'deploy/work-batch-reader-fix/scoped-node.py',
        'deploy/monitoring-reconciliation/runtime_archive.py':ENGINE}
    raw={}
    for name,path in paths.items():
        expected=subprocess.check_output(git+['show',a['sourceCommit']+':'+name],timeout=10)
        raw[name]=read_initial(path,sha(expected))
    need(raw['deploy/monitoring-reconciliation/runtime_archive.py']==engine_raw,'Archive engine changed')
    return raw['deploy/work-batch-reader-fix/scoped-node.py']

def rows_by_path(rows):
    need(type(rows)is list and len(rows)==len(TARGETS),'Wrong one-file scope')
    result={}
    for row in rows:
        need(type(row)is dict and row.get('path') not in result,'Duplicate source')
        result[row.get('path')]=row
    need(set(result)==TARGETS,'Expanded source scope')
    return result

def validate_bundle(a,plan,m,r,controller):
    need(plan.get('format')=='proof-of-work-work-batch-reader-fix-rollout-plan-v1'
        and plan.get('sourceCommit')==a['sourceCommit'] and plan.get('releaseId')==a['releaseId']
        and plan.get('controllerSha256')==sha(controller['raw']),'Wrong reviewed plan')
    raw=base64.b64decode(plan.get('controllerBase64',''),validate=True)
    need(raw==controller['raw'],'Plan controller bytes differ')
    expected=copy.deepcopy(plan['runtimeManifestTemplate'])
    marker=m.get('searchHold',{}).get('markerSha256')
    need(type(marker)is str and SHA.fullmatch(marker),'Missing Search hold pin')
    expected['searchHold']['markerSha256']=marker
    need(m==expected,'Completed manifest differs from plan')
    controller['validate_manifest'](m)
    need(m['sourceCommit']==a['sourceCommit']
        and m['releaseId']==a['releaseId'] and m['format']==FAMILY,'Source binding differs')
    need(r.get('format')==FAMILY and r.get('manifestSha256')==a['inner']['manifestSha256']
        and r.get('rollbackRoot')==a['inner']['path'] and r.get('installed')is True
        and r.get('rolledBack')is False and r.get('sourceWritesStarted')is True
        and r.get('stopRequested')is True
        and not any(key in r for key in ('errorClass','recoveryIncomplete','recoveryErrorClass',
            'servicesAfterRollback','forwardRecoveryRequired','sourceRollbackProhibited')),
        'Incomplete reader hotfix release')
    need(datetime.datetime.fromisoformat(r.get('completedAt','')).tzinfo is not None,'Invalid completion')
    for key in ('sourceCommit','releaseId','baselineHead','baseSourceCommit',
        'sourceMetadata','dependencyMetadata','restartConfigurationSha256','gateway','protectedServices'):
        need(r.get(key)==m[key],'Receipt metadata differs: '+key)
    need(r.get('dependencyCount')==len(m['dependencies']),'Dependency receipt differs')
    services=r.get('servicesAfter')
    need(type(services)is dict and set(services)==set(m['services']),'Missing restored services')
    for value in services.values():
        need(value.get('ActiveState')=='active' and value.get('WorkingDirectory')=='/opt/proofofwork-api'
            and str(value.get('MainPID','')).isdigit() and int(value['MainPID'])>0,'Services not restored')
    rows=rows_by_path(m['sources']); completed=rows_by_path(r.get('sources'))
    journal=r.get('createdHelpers')
    need(type(journal)is dict and set(journal)==TARGETS,'Incomplete installed source ownership')
    for name,row in rows.items():
        need((row.get('before') is None if name in NEW else type(row.get('before'))is str and SHA.fullmatch(row['before']))
            and type(row.get('after'))is str and SHA.fullmatch(row['after'])
            and completed[name]=={key:value for key,value in row.items() if key!='base64'},
            'Existing source receipt differs')
        need(sha(base64.b64decode(row['base64'],validate=True))==row['after']
            and journal[name].get('published')is True
            and journal[name].get('candidateSha256')==row['after'],'Installed source journal differs')
    controller['validate_postflight'](r.get('postflight'),m['batchAuthority'])
    need(m['acceptedInventorySha256']==a['acceptedSha256'],'Accepted inventory differs from captured baseline')
    return rows

def extend_inventory(m,r,accepted,evidence,actual_reader,baseline_reader):
    need(accepted.get('format')=='pow-accepted-node-source-overlays-v1'
        and accepted.get('baselineHead')==m['baselineHead']
        and re.fullmatch('[0-9a-f]{40}',accepted.get('baselineTree','')),'Accepted baseline differs')
    overlays={}
    for row in accepted['overlays']:
        need(row['path'] not in overlays,'Duplicate accepted overlay')
        overlays[row['path']]=copy.deepcopy(row)
    actual={}
    for name,row in rows_by_path(m['sources']).items():
        mode=m['sourceMetadata'][name]['mode']
        git_mode='100755' if mode&0o111 else '100644'
        if name in NEW:
            need(name not in overlays and baseline_reader(name) is None and row['before'] is None,
                'Creation-only source existed in accepted inventory or baseline Git')
        elif name in overlays:
            need(overlays[name].get('sha256')==row['before'] and
                overlays[name].get('gitMode')==git_mode,'Accepted before hash or mode differs')
        else:
            baseline=baseline_reader(name)
            need(baseline is not None and baseline['sha256']==row['before'] and
                baseline['gitMode']==git_mode,'Unaccepted existing source differs from baseline Git')
        actual[name]=actual_reader(name)
        need(actual[name]['sha256']==row['after'] and actual[name]['metadata']==m['sourceMetadata'][name]
            and actual[name]['identity']==r['createdHelpers'][name]['candidateIdentity'],
            'Actual installed source ownership differs')
        overlays[name]={'path':name,'sha256':row['after'],'gitMode':git_mode,'evidence':copy.deepcopy(evidence)}
    result=copy.deepcopy(accepted);result['overlays']=[overlays[name] for name in sorted(overlays)]
    return result,actual

def acceptance(engine,controller,a,plan,approval_reference):
    def accept(args,custody,verify):
        directory=Path(a['inner']['path']);info=directory.lstat()
        need(directory.parent==engine['BASE'] and directory.resolve(strict=True)==directory
            and stat.S_ISDIR(info.st_mode) and info.st_uid==info.st_gid==0
            and stat.S_IMODE(info.st_mode)==0o700
            and re.fullmatch(re.escape('work-batch-reader-fix-'+a['releaseId']+'-')+r'[0-9]{8}T[0-9]{6}Z',directory.name),
            'Unsafe completed receipt directory')
        need(custody.parent==engine['BASE'] and custody.resolve(strict=True)==custody,
            'Acceptance custody escapes retained release root')
        evidence=[];origins=[];retained=[]
        def pinned(path,digest,retain_name=None):
            raw=engine['read'](path,digest)
            need(len(raw)<=32*1024**2,'Acceptance evidence exceeds compact limit')
            origin={'path':str(path),'sha256':digest};origins.append(origin)
            if retain_name is not None:
                destination=custody/retain_name
                engine['save'](destination,raw)
                need(engine['read'](destination,digest)==raw,'Retained evidence differs')
                reference={'path':str(destination),'sha256':digest}
                retained.append({'origin':origin,'retained':reference})
            else:
                need(engine['BASE'] in path.parents,'Evidence escapes retained release custody')
                reference=origin
            evidence.append(reference)
            return strict_json(raw)
        need(pinned(Path(approval_reference['path']),approval_reference['sha256'],
            'archive-approval.json')==a,'Approval changed')
        need(pinned(Path(a['plan']['path']),a['plan']['sha256'],
            'reviewed-plan.json')==plan,'Reviewed plan changed')
        m=pinned(directory/'manifest.json',a['inner']['manifestSha256'])
        r=pinned(directory/'receipt.json',a['inner']['receiptSha256'])
        origins_raw=engine['encode']({'format':'work-batch-reader-fix-retained-evidence-v1','copies':retained})
        origins_path=custody/'evidence-origins.json'
        engine['save'](origins_path,origins_raw)
        evidence.append({'path':str(origins_path),'sha256':sha(origins_raw)})
        engine['sync_dir'](custody)
        validate_bundle(a,plan,m,r,controller)
        controller['installed_source_fence'](engine['ROOT'],m,r['createdHelpers'])
        controller['require_restart_configuration'](m['restartConfigurationSha256'])
        controller['require_postflight'](m['batchAuthority'])
        previous=engine['read'](engine['ACCEPTED'],a['acceptedSha256']);accepted=strict_json(previous)
        def actual_reader(name):
            p=engine['ROOT']/name;old=p.lstat()
            raw=engine['read'](p,owner=engine['ROOT'].stat().st_uid);new=p.lstat()
            need(engine['identity'](old)==engine['identity'](new),'Source changed on read')
            return {'sha256':sha(raw),'metadata':{'uid':new.st_uid,'gid':new.st_gid,'mode':stat.S_IMODE(new.st_mode)},
                'identity':controller['creation_identity'](new)}
        def baseline_reader(name):
            git=['/usr/bin/git','-c','safe.directory='+str(engine['ROOT']),'-C',str(engine['ROOT'])]
            entry=subprocess.check_output([*git,'ls-tree','-z',accepted['baselineHead'],'--',name],timeout=10)
            if not entry:return None
            need(entry.endswith(b'\0') and entry.count(b'\0')==1,'Ambiguous baseline source')
            header,path=entry[:-1].split(b'\t',1);mode,kind,oid=header.decode().split(' ')
            need(path.decode()==name and kind=='blob' and mode in ('100644','100755'),'Unsafe baseline source')
            raw=subprocess.check_output([*git,'cat-file','blob',oid],timeout=10)
            return {'sha256':sha(raw),'gitMode':mode}
        candidate,identities=extend_inventory(m,r,accepted,evidence,actual_reader,baseline_reader)
        old=engine['previous_archive'](a['previousCompletion']['path'],a['previousCompletion']['sha256'])
        need(old['archiveSha256']==a['previousCompletion']['archiveSha256'],'Prior archive pin differs')
        engine['inventory'](strict_json(engine['read'](HELD,a['heldSha256'])),candidate,old)
        candidate_raw=engine['encode'](candidate);candidate_path=custody/'source-overlays-candidate.json'
        engine['save'](candidate_path,candidate_raw);verified=verify(manifest=candidate_path)
        need(verified.get('ok')is True and all(verified.get(key)==accepted[key]
            for key in ('baselineHead','baselineTree')),'Whole candidate verification failed')
        for item in origins+evidence:engine['read'](Path(item['path']),item['sha256'])
        for name in sorted(TARGETS):need(actual_reader(name)==identities[name],'Source changed after verification')
        controller['installed_source_fence'](engine['ROOT'],m,r['createdHelpers'])
        controller['require_restart_configuration'](m['restartConfigurationSha256'])
        controller['require_postflight'](m['batchAuthority'])
        engine['read'](engine['ACCEPTED'],a['acceptedSha256'])
        engine['save'](custody/'source-overlays-before.json',previous)
        parent=engine['ACCEPTED'].parent;info=parent.lstat()
        need(parent.resolve(strict=True)==parent and stat.S_ISDIR(info.st_mode)
            and info.st_uid==info.st_gid==0 and not info.st_mode&0o7022,'Unsafe acceptance parent')
        temporary=parent/('.work-batch-reader-fix-overlays-'+secrets.token_hex(12)+'.tmp')
        engine['save'](temporary,candidate_raw);os.chmod(temporary,0o644)
        engine['read'](engine['ACCEPTED'],a['acceptedSha256'])
        os.replace(temporary,engine['ACCEPTED']);engine['sync_dir'](parent)
        try:
            result=verify();need(result.get('ok')is True,'Published source verification failed')
        except BaseException:
            engine['read'](engine['ACCEPTED'],sha(candidate_raw))
            engine['save'](temporary,previous);os.chmod(temporary,0o644)
            os.replace(temporary,engine['ACCEPTED']);engine['sync_dir'](parent)
            raise
        engine['save'](custody/'source-acceptance.json',engine['encode']({
            'verified':result,'sourceCommit':a['sourceCommit'],'sourceTree':a['sourceTree'],
            'reviewedPlanSha256':a['plan']['sha256'],'approval':approval_reference,
            'retainedEvidence':evidence,'evidenceOrigins':{'path':str(origins_path),'sha256':sha(origins_raw)},
            'manifestSha256':a['inner']['manifestSha256'],
            'receiptSha256':a['inner']['receiptSha256'],'beforeSha256':a['acceptedSha256'],
            'afterSha256':sha(candidate_raw),'existingSourcesVerified':sorted(TARGETS-NEW),
            'createdSourcesVerified':sorted(NEW),
            'modifiedRuntimeSource':False,'archiveEngineSha256':ENGINE_SHA,
            'previousCompletionSha256':a['previousCompletion']['sha256']}))
        return result
    return accept

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--approval',type=Path,required=True);p.add_argument('--approval-sha256',required=True)
    p.add_argument('--create-and-retain-latest',action='store_true',required=True);args=p.parse_args()
    need(os.geteuid()==0 and sys.flags.isolated,'Root isolated invocation required')
    a=strict_json(read_initial(args.approval,args.approval_sha256));validate_approval(a)
    engine_raw=read_initial(ENGINE,ENGINE_SHA);controller_raw=committed_sources(a,engine_raw)
    engine={'__name__':'reviewed_archive_engine','__file__':str(ENGINE)}
    exec(compile(engine_raw,str(ENGINE),'exec'),engine)
    controller={'__name__':'reviewed_replay_controller','__file__':str(ROOT/'deploy/work-batch-reader-fix/scoped-node.py')}
    exec(compile(controller_raw,controller['__file__'],'exec'),controller);controller['raw']=controller_raw
    plan=strict_json(engine['read'](Path(a['plan']['path']),a['plan']['sha256']))
    engine['accept_source']=acceptance(engine,controller,a,plan,
        {'path':str(args.approval),'sha256':args.approval_sha256})
    sys.argv=[str(ENGINE),'--receipt-dir',a['inner']['path'],'--manifest-sha256',a['inner']['manifestSha256'],
        '--source-commit',a['sourceCommit'],'--previous-completion',a['previousCompletion']['path'],
        '--previous-completion-sha256',a['previousCompletion']['sha256'],'--create-and-retain-latest']
    engine['main']()

if __name__=='__main__':main()
