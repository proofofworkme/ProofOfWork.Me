#!/usr/bin/env python3
"""Exact one-time Pay failed-preparation -> prepared operator transition.

No UI publication, payload retirement, gate activation, or wallet action occurs.
Application requires a separately reviewed source-bound plan. Every incomplete
journal or config/state switch refuses; there is no implicit retry.
"""
import argparse
import base64
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent

def load(name, path, **bindings):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); module.__dict__.update(bindings)
    sys.modules[name] = module; spec.loader.exec_module(module); return module

I = load('failed_prepare_installer', HERE/'install_lifecycle.py')
R = load('failed_prepare_runtime', HERE/'lifecycle_remote.py')
Q = load('failed_prepare_review', HERE/'failed_prepare_review.py')
F = load('failed_prepare_proof', HERE/'failed_prepare_repair.py')
PIN = F.PIN
JOURNAL = Path(I.EVIDENCE) / ('ui-lifecycle-failed-prepare-' + PIN['release'])
CYCLE = 'repair-' + PIN['release']
require, encoded, sha = I.require, I.encoded, I.sha

@contextlib.contextmanager
def locked(runtime):
    fd = runtime.S.lock(runtime.layout)
    try:
        runtime.lock_fd = fd
        yield fd
    finally:
        runtime.lock_fd = None
        os.close(fd)

def stopped_services():
    units = ['pay-collect-verify-c22e585-v1.service',
             'proofofwork-ui-lifecycle-release-' + PIN['release'] + '.service']
    result = []
    for unit in units:
        fields = ('MainPID','ActiveState','SubState','Result','ExecMainStatus','LoadState','ControlGroup')
        raw = subprocess.check_output(['systemctl','show',unit,'--property='+','.join(fields)],text=True,timeout=15)
        values = dict(line.split('=',1) for line in raw.splitlines())
        require(set(values)==set(fields) and values['LoadState']=='loaded', 'Original service identity unavailable')
        group = values.pop('ControlGroup'); values.pop('LoadState')
        require(group in ('', '/system.slice/'+unit), 'Unexpected original service cgroup')
        if group:
            root = Path('/sys/fs/cgroup') / group.lstrip('/')
            if root.exists():
                require(root.resolve()==root, 'Cgroup alias changed')
                paths = list(root.rglob('cgroup.procs'))
                require(len(paths)<=128 and all(not x.read_text().strip() for x in paths),
                        'Original operation retains live cgroup descendants')
        require(values=={'MainPID':'0','ActiveState':'failed','SubState':'failed',
                         'Result':'exit-code','ExecMainStatus':'1'},
                'Original operation is not terminal failed')
        result.append(values)
    return result

def preserve_retirement(payload, original):
    """Carry only the authenticated old binding; never assert completed C."""
    value = json.loads(encoded(payload))
    for key in ('payloadRetirement','payloadRetirementSourceConfig'):
        require(key in original.config, 'Original retirement anchor unavailable')
        value['config'][key] = original.config[key]
    value['configSha256'] = sha(encoded(value['config']))
    I.validate_payload(value)
    return value

def candidate_runtime(payload, original):
    I.validate_payload(payload)
    old_manifest = json.loads(I.read_bound(Path(original.config['package']['path'])/'package.json',
                                          original.config['package']['sha256']))
    allowed = {'deploy/audit30/ui-storage.py','deploy/audit30/ui-release-policy.py',
               'deploy/ui-retention/lifecycle_remote.py','deploy/ui-retention/install_lifecycle.py',
               'deploy/ui-retention/retirement_receipt.py','deploy/ui-retention/lifecycle.py'}
    require(set(payload['files'])-set(old_manifest['files']) == {'deploy/ui-retention/failed_prepare_repair.py',
                'deploy/ui-retention/failed_prepare_review.py','deploy/ui-retention/reconcile_failed_prepare.py'},
            'Unexpected added operator source')
    for relative, previous in old_manifest['files'].items():
        require(relative in allowed or payload['manifest']['files'][relative]==previous,
                'Unrelated operator dependency changed')
    for relative, record in payload['files'].items():
        raw=I.read_bound(I.ROOT/relative,record['sha256'])
        require(len(raw)==record['bytes'],'Candidate source size differs')
    for key in ('payloadRetirement','payloadRetirementSourceConfig'):
        require(payload['config'].get(key)==original.config.get(key),'Historical retirement authority changed')
    storage=load('failed_prepare_candidate_storage',HERE.parent/'audit30/ui-storage.py')
    retirement=load('failed_prepare_candidate_retirement',HERE/'retirement_receipt.py')
    policy=load('failed_prepare_candidate_policy',HERE.parent/'audit30/ui-release-policy.py',
                _BOUND_STORAGE=storage,_BOUND_RETIREMENT=retirement)
    authority=retirement.load_verified_retirement(payload['config']['payloadRetirement'],original.layout,
                lambda layout: storage.protected_pair(layout,{}))
    require(authority.proof==original.retirement.proof,'Candidate changed historical retirement proof')
    return R.Runtime(payload['config'],payload['configSha256'],storage,policy,original.C,
                     layout=original.layout,retirement=authority)

def qualified(original, payload, citation):
    require(not os.path.lexists(JOURNAL),'Prior repair journal requires explicit reconciliation')
    require(original.config_sha==PIN['config'],'Unexpected original config')
    proof=Q.qualify(original,R,PIN['state'],PIN['phaseIntent'],stopped_services)
    state,state_sha=original.state()
    require(state['revision']==285 and proof['context']['pair']==PIN['pair'],'Unexpected failed release or revision')
    for binding in (PIN['httpsReceipt'],PIN['admission'],PIN['index'],PIN['phaseIntent']):
        I.read_bound(binding['path'],binding['sha256'])
    require(proof['index']==PIN['index'] and proof['admission']==PIN['admission'], 'Original admission changed')
    expected={'ui-lifecycle-release-'+PIN['release']+'-intent.json',
              'ui-lifecycle-release-'+PIN['release']+'-https.json',
              'audit30-policy-admission-release-'+PIN['release']+'.json',
              'audit30-policy-admission-index-release-'+PIN['release']+'.json'}
    actual={p.name for p in original.layout.evidence.iterdir()
            if ('release-'+PIN['release']) in p.name}
    require(actual==expected,'Unexpected partial preparation evidence')
    candidate=candidate_runtime(payload,original)
    pair,context=candidate.current();require(context==proof['context'],'Candidate changed live C/B context')
    scope=candidate.policy_scope(proof['index'])
    require(sorted(x['path'] for x in scope['eligible'])==proof['publicationRule']['forecast']['wouldRetire'],
            'Candidate eligibility differs from original published scope')
    candidate.S.load_citation_review(citation,candidate.layout,pair,'future-retention',
                                    [x['path'] for x in scope['eligible']],I.APPROVAL)
    return dict(proof,state=state,httpsReceipt=PIN['httpsReceipt'],
                configBase64=base64.b64encode(I.read_bound(I.CONFIG,PIN['config'])).decode(),
                stateBase64=base64.b64encode(I.read_bound(I.STATE,PIN['state'])).decode(),
                guards=I.guard_inventory(),evidence=I.evidence_inventory(Path(I.EVIDENCE))), candidate, scope

def allocation(plan):
    return max(16*1024**2, len(encoded(plan))*4+sum(v['bytes'] for v in plan['payload']['files'].values())*4)

def make_plan(payload, citation):
    original=I.existing_runtime(PIN['config'])
    with locked(original):
        before,candidate,scope=qualified(original,payload,citation)
        ordinary=candidate.S.create_plan(candidate.layout,'future-retention',I.APPROVAL,scope,citation_review=citation)
        ordinary['privateStageRetention']=before['publicationRule']
        candidate.verify_private_retirement(ordinary)
        candidate.S.validate_plan(ordinary,candidate.layout,'future-retention',I.APPROVAL)
        candidate.S.verify_plan(ordinary,candidate.layout)
        binding={'path':str(JOURNAL/'ordinary-plan.json'),'sha256':sha(candidate.S.encoded(ordinary))}
        plan={'schema':'pow-ui-failed-prepare-repair-plan-v1','authority':PIN,
              'reconcilerSha256':sha(Path(__file__).read_bytes()),'payload':payload,'citationReview':citation,
              'before':before,'ordinaryPlan':binding,'ordinaryPlanValue':ordinary}
        original.capacity(allocation(plan))
        return plan

def prepared_state(plan):
    before=plan['before'];old=before['state'];config_sha=plan['payload']['configSha256']
    marker={'intentPath':str(JOURNAL/'intent.json'),'completionPath':str(JOURNAL/'repaired.json')}
    token=sha(encoded({'originalIntent':PIN['phaseIntent'],'ordinaryPlan':plan['ordinaryPlan'],
          'configSha256':config_sha,'cycleId':CYCLE,'context':before['context']}))
    pending={'cycleId':CYCLE,'token':token,'stage':'prepared','context':before['context'],
             'ordinaryPlan':plan['ordinaryPlan'],'httpsReceipt':before['httpsReceipt'],
             'publicationReceipt':before['publication'],'index':before['index']}
    return dict(old,configSha256=config_sha,revision=old['revision']+2,activePhase=None,
                pending=pending,index=before['index'],lastUpgrade={},lastFailedPreparationRepair=marker)

def apply(plan):
    require(os.geteuid()==0,'Production repair requires root')
    require(plan.get('schema')=='pow-ui-failed-prepare-repair-plan-v1' and plan.get('authority')==PIN
            and plan.get('reconcilerSha256')==sha(Path(__file__).read_bytes()),'Repair source or authority changed')
    payload=plan['payload'];I.validate_payload(payload)
    original=I.existing_runtime(PIN['config'])
    with locked(original):
        before,candidate,scope=qualified(original,payload,plan['citationReview'])
        require(before==plan['before'],'Reviewed failure, source, pair or evidence changed')
        ordinary=plan['ordinaryPlanValue'];binding=plan['ordinaryPlan']
        require(binding=={'path':str(JOURNAL/'ordinary-plan.json'),'sha256':sha(candidate.S.encoded(ordinary))},
                'Ordinary plan bytes or namespace changed')
        require(ordinary['policyScope']==scope and ordinary['privateStageRetention']==before['publicationRule']
                and ordinary['citationReview']==plan['citationReview'], 'Plan scope/citations differ')
        candidate.S.validate_plan(ordinary,candidate.layout,'future-retention',I.APPROVAL)
        candidate.verify_private_retirement(ordinary);candidate.S.verify_plan(ordinary,candidate.layout)
        package=Path(payload['config']['package']['path'])
        require(not os.path.lexists(package),'Repair package already exists')
        template=prepared_state(plan)
        intent={'schema':'pow-ui-failed-prepare-repair-intent-v1','authority':PIN,'plan':plan,
                'stateTemplate':template,'stateTemplateSha256':sha(encoded(template)),
                'deletionAllowed':False,'publicationAllowed':False}
        require(len(encoded(intent))<=R.MAX_FRAME,'Repair intent exceeds native bound')
        intent_sha=sha(encoded(intent))
        planned=dict(template,lastFailedPreparationRepair=dict(template['lastFailedPreparationRepair'],intentSha256=intent_sha))
        original.capacity(allocation(plan))
        stopped_services()
        JOURNAL.mkdir(mode=0o700);I.sync(JOURNAL.parent)
        I.save(JOURNAL/'intent.json',encoded(intent));I.save(JOURNAL/'prior-config.json',base64.b64decode(before['configBase64']))
        I.save(JOURNAL/'prior-state.json',base64.b64decode(before['stateBase64']))
        I.save(JOURNAL/'ordinary-plan.json',candidate.S.encoded(ordinary))
        active=dict(before['state'],revision=286,activePhase={'operation':'repair-failed-prepare',
                    'intent':{'path':str(JOURNAL/'intent.json'),'sha256':intent_sha}})
        active_next=Path(I.STATE).with_name('state-failed-prepare-intent.next.json');I.save(active_next,encoded(active))
        I.read_bound(I.CONFIG,PIN['config']);I.read_bound(I.STATE,PIN['state'])
        os.replace(active_next,I.STATE);I.sync(Path(I.STATE).parent)
        package.mkdir(mode=0o700);I.sync(package.parent)
        for relative,value in payload['files'].items():
            path=package/relative;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            I.save(path,base64.b64decode(value['base64'],validate=True));I.read_bound(path,value['sha256'])
        I.save(package/'package.json',encoded(payload['manifest']))
        _,after=candidate.current();require(after==before['context'],'Protected context changed during repair')
        candidate.S.verify_plan(ordinary,candidate.layout)
        observed=I.guard_inventory();observed['existingPackages']=[n for n in observed['existingPackages'] if n!=package.name]
        require(observed==before['guards'],'Existing helpers or protected manifests changed')
        evidence=I.evidence_inventory(Path(I.EVIDENCE))
        for name in (package.name,JOURNAL.name):evidence.pop(name)
        require(evidence==before['evidence'],'Prior evidence changed during repair')
        state_next=Path(I.STATE).with_name('state-failed-prepare.next.json')
        config_next=Path(I.CONFIG).with_name('ui-lifecycle-failed-prepare.next.json')
        I.save(state_next,encoded(planned));I.save(config_next,encoded(payload['config']))
        I.read_bound(I.CONFIG,PIN['config']);I.read_bound(I.STATE,sha(encoded(active)))
        candidate.S.compare_guards(candidate.layout,before['context']['guards'],[])
        os.replace(state_next,I.STATE);I.sync(Path(I.STATE).parent)
        os.replace(config_next,I.CONFIG);I.sync(Path(I.CONFIG).parent)
        done={'schema':'pow-ui-failed-prepare-repaired-v1','ok':True,
              'intent':{'path':str(JOURNAL/'intent.json'),'sha256':intent_sha},
              'config':{'path':I.CONFIG,'sha256':payload['configSha256']},
              'state':{'path':I.STATE,'sha256':sha(encoded(planned))},'stateRevision':planned['revision'],
              'prepared':True,'retentionComplete':False,'deletionPerformed':False,'publicationPerformed':False,
              'originalPhaseEvidencePreserved':True}
        I.save(JOURNAL/'repaired.json',encoded(done))
        installed=I.existing_runtime(payload['configSha256']);installed.verify_prepare_repair=True
        state,state_sha=installed.state()
        installed.S.validate_plan(ordinary,installed.layout,'future-retention',I.APPROVAL)
        installed.verify_private_retirement(ordinary)
        installed.S.verify_plan(ordinary,installed.layout)
        status=installed.status({})
        require(state_sha==done['state']['sha256'] and state['pending']['stage']=='prepared'
                and status['retentionComplete'] is False,'Post-switch prepared verification failed')
        seal={'schema':'pow-ui-failed-prepare-repair-verified-v1',
              'repairReceipt':{'path':str(JOURNAL/'repaired.json'),'sha256':sha(encoded(done))},
              'state':done['state'],'config':done['config'],'contextSha256':sha(encoded(before['context'])),
              'prepared':True,'retentionComplete':False}
        I.save(JOURNAL/'verified.json',encoded(seal));installed.verify_prepare_repair=False
        require(installed.state()[1]==done['state']['sha256'],'Normal prepared state did not verify')
        installed.status({})
        return done

def continue_prepared(config_sha, state_sha, intent_sha, destination):
    """Resume only this sealed repair through native phases. No implicit retry."""
    require(os.geteuid()==0, 'Continuation requires root')
    runtime=I.existing_runtime(config_sha)
    with locked(runtime):
        state,observed=runtime.state()
        require(observed==state_sha, 'Reviewed prepared state changed')
        require(runtime.failed_prepare_repair(state) is not None, 'Repair marker missing')
        intent,bound=R.read_json(JOURNAL/'intent.json',intent_sha)
        require(intent['plan']['reconcilerSha256']==sha(Path(__file__).read_bytes()),
                'Continuation source changed')
        require(state['lastFailedPreparationRepair']['intentSha256']==bound,
                'Reviewed repair identity changed')
        require(state['revision']==287 and state['pending']['stage']=='prepared'
                and state['pending']['cycleId']==CYCLE and not state['activePhase'],
                'Repair is not pristine prepared state')
        status=runtime.status({})
        require(status['retentionComplete'] is False and status['pair']==PIN['pair'],
                'Prepared public pair changed')
        pending=state['pending']
        require(not os.path.lexists(destination), 'Prior continuation needs reconciliation')
        destination.mkdir(mode=0o700);I.sync(destination.parent)
        I.save(destination/'prepared-status.json',encoded(status))
    frame={'expectedStateSha256':state_sha,'expectedPair':PIN['pair'],
           'operationId':'ordinary-'+CYCLE,'cycleId':CYCLE,'pendingToken':pending['token']}
    applied=runtime.dispatch('apply-vps-retention',frame)
    I.save(destination/'ordinary-applied.json',encoded(applied))
    frame=dict(frame,expectedStateSha256=applied['stateSha256'],operationId='complete-'+CYCLE)
    completed=runtime.dispatch('complete-vps-cycle',frame)
    I.save(destination/'completed.json',encoded(completed))
    final=runtime.dispatch('status',{'requireComplete':True})
    require(final['retentionComplete'] is True and final['pair']==PIN['pair'],
            'Final C/B retention not verified')
    I.save(destination/'status.json',encoded(final))
    return final


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='op',required=True)
    sub.add_parser('export-source')
    p=sub.add_parser('plan');p.add_argument('--payload',type=Path,required=True);p.add_argument('--payload-sha256',required=True)
    p.add_argument('--citation-review',type=Path,required=True);p.add_argument('--citation-review-sha256',required=True)
    p=sub.add_parser('apply');p.add_argument('--plan',type=Path,required=True);p.add_argument('--plan-sha256',required=True)
    p=sub.add_parser('continue-prepared')
    for name in ('config-sha256','state-sha256','intent-sha256'):p.add_argument('--'+name,required=True)
    p.add_argument('--destination',type=Path,required=True)
    args=parser.parse_args();os.umask(0o077)
    if args.op=='export-source':
        require(subprocess.check_output(['git','-C',str(I.ROOT),'show','HEAD:'+str(Path(__file__).relative_to(I.ROOT))])
                ==Path(__file__).read_bytes(),'Reconciler differs from committed source')
        result=preserve_retirement(I.committed_payload(),I.existing_runtime(PIN['config']))
    elif args.op=='plan':
        result=make_plan(json.loads(I.read_bound(args.payload,args.payload_sha256)),
                    {'path':str(args.citation_review),'sha256':args.citation_review_sha256})
    elif args.op=='apply':result=apply(json.loads(I.read_bound(args.plan,args.plan_sha256)))
    else:result=continue_prepared(args.config_sha256,args.state_sha256,args.intent_sha256,args.destination)
    print(encoded(result).decode(),end='')

if __name__=='__main__':main()
