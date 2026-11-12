#!/usr/bin/env python3
"""One approved, receipt-bound adoption. Never retires data or republishes UI."""
import argparse
import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module
I = load('storage_adoption_installer', HERE / 'install_lifecycle.py')
R = load('storage_adoption_runtime', HERE / 'lifecycle_remote.py')
PIN = R.STORAGE_COMPLETION_ADOPTION
JOURNAL = Path(I.EVIDENCE) / ('ui-lifecycle-storage-adoption-' + PIN['release'])
require = I.require
encoded = I.encoded
sha = I.sha

def bound(binding):
    return json.loads(I.read_bound(binding['path'], binding['sha256']))

def new_runtime(payload, original):
    I.validate_payload(payload)
    require(payload['config'].get('retentionPolicy') == I.VPS_POLICY
            and payload['config'].get('offHostCustodyRoot') is None, 'New package policy changed')
    old_manifest=json.loads(I.read_bound(Path(original.config['package']['path'])/'package.json',
                                         original.config['package']['sha256']))
    changed={'deploy/ui-retention/lifecycle_remote.py','deploy/ui-retention/install_lifecycle.py',
             'deploy/audit30/ui-release-policy.py'}
    for relative,record in old_manifest['files'].items():
        if relative not in changed:
            require(payload['manifest']['files'][relative] == record, 'Unrelated package dependency changed')
    storage_path = 'deploy/audit30/ui-storage.py'
    require(payload['files'][storage_path]['sha256'] == PIN['writer'], 'Storage writer changed')
    storage = I.verifier_module(payload, 'adoption_storage', storage_path)
    policy = I.verifier_module(payload, 'adoption_policy', 'deploy/audit30/ui-release-policy.py', {'_BOUND_STORAGE': storage})
    module = I.verifier_module(payload, 'adoption_runtime', 'deploy/ui-retention/lifecycle_remote.py')
    require(module.STORAGE_COMPLETION_ADOPTION == PIN, 'Adoption authority changed')
    return module.Runtime(payload['config'], payload['configSha256'], storage, policy, layout=original.layout)

def service_stopped():
    unit = 'proofofwork-ui-lifecycle-ordinary-' + PIN['release'] + '.service'
    result = subprocess.check_output(['systemctl', 'show', unit, '-p', 'MainPID', '-p', 'ActiveState',
                                      '-p', 'SubState', '-p', 'Result', '-p', 'ExecMainStatus'], text=True, timeout=15)
    values = dict(line.split('=', 1) for line in result.splitlines())
    require(values == {'MainPID':'0', 'ActiveState':'failed', 'SubState':'failed',
                       'Result':'exit-code', 'ExecMainStatus':'1'}, 'Failed phase still active or outcome changed')
    return values

def qualify(payload):
    """Read-only qualification under the deployment lock; no mutable hash overrides."""
    require(not os.path.lexists(JOURNAL), 'Prior adoption requires explicit reconciliation')
    original = I.existing_runtime(PIN['config'])
    state, state_sha = original.state()
    require(state_sha == PIN['state'] and state['revision'] == 220
            and state['status'] == 'retention-incomplete' and state['activePhase'] is None
            and state['pending']['stage'] == 'applying', 'Unexpected interrupted state')
    require(original.config.get('retentionPolicy') == I.VPS_POLICY
            and original.config.get('offHostCustodyRoot') is None, 'VPS-only policy changed')
    phase = service_stopped()
    pending = state['pending']
    require(state['lastIntent'] == PIN['phaseIntent']
            and original.unfinished_intents() == [PIN['phaseIntent']['path']]
            and pending['ordinaryPlan'] == PIN['ordinaryPlan']
            and pending['cycleId'] == 'release-' + PIN['release'], 'Unrelated or changed unfinished phase')
    intent = bound(PIN['phaseIntent']); plan = bound(PIN['ordinaryPlan'])
    done = bound(PIN['completion']); index = bound(PIN['index'])
    storage_intent = bound(PIN['storageIntent'])
    require(intent['operation'] == 'apply-vps-retention'
            and intent['operationId'] == 'ordinary-' + PIN['release']
            and intent['configSha256'] == PIN['config']
            and intent['request']['cycleId'] == pending['cycleId']
            and intent['request']['pendingToken'] == pending['token']
            and intent['context'] == pending['context'], 'Lifecycle intent binding changed')
    require(storage_intent['plan'] == plan and storage_intent['planSha256'] == PIN['ordinaryPlan']['sha256']
            and done['intentPath'] == PIN['storageIntent']['path']
            and done['intentSha256'] == PIN['storageIntent']['sha256']
            and done['planSha256'] == done['guardBaselinePlanSha256'] == PIN['ordinaryPlan']['sha256']
            and plan['controllerSha256'] == PIN['writer'], 'Storage completion binding changed')
    require(sorted(row['path'] for row in plan['delete']) == PIN['retiredPaths']
            and sorted(row['path'] for row in done['completed']) == PIN['retiredPaths']
            and all(not os.path.lexists(path) for path in PIN['retiredPaths'])
            and plan['moves'] == [], 'Retirement outcome differs from exact approved paths')
    previous = bound(state['index'])
    require(index == dict(previous, completedRetirements=[*previous['completedRetirements'], PIN['completion']]),
            'New index is not the single exact completion extension')
    runtime = new_runtime(payload, original)
    pair, context = runtime.current()
    require(context == pending['context'] == intent['context'], 'Protected pair or guards changed after retirement')
    require(context['pair'] == PIN['pair'], 'Protected release pair changed')
    https = bound(pending['httpsReceipt'])
    runtime.verify_publication(https, pending['publicationReceipt'], pair, context)
    require(pending['publicationReceipt'] == PIN['publication'], 'Publication binding changed')
    runtime.P.load_index(PIN['index']['path'], PIN['index']['sha256'], runtime.layout, I.APPROVAL)
    scope = runtime.P.policy_scope(PIN['index'], runtime.layout, I.APPROVAL)
    require(not scope['eligible'] and scope.get('preservedFallback'), 'Ordinary eligibility or fallback changed')
    completed = {'cycleId': pending['cycleId'], 'retentionPolicy': I.VPS_POLICY,
                 'retainedPair': context['pair'], 'ordinaryPlan': PIN['ordinaryPlan'],
                 'ordinaryReceipt': PIN['completion']}
    candidate = dict(state, index=PIN['index'], lastCompleted=completed)
    verification = runtime.verify_vps_completion(candidate, context)
    runtime.S.compare_guards(runtime.layout, context['guards'], [])
    pools = runtime.capacity()
    return {'state': state, 'stateSha256': state_sha, 'configBase64': base64.b64encode(I.read_bound(I.CONFIG, PIN['config'])).decode(),
            'stateBase64': base64.b64encode(I.read_bound(I.STATE, PIN['state'])).decode(),
            'context': context, 'lastCompleted': completed, 'completionVerification': verification,
            'fallback': scope['preservedFallback'], 'service': phase, 'pools': pools,
            'guards': I.guard_inventory(), 'evidence': I.evidence_inventory(Path(I.EVIDENCE))}

def source_payload():
    root = I.ROOT
    own = Path(__file__).relative_to(root).as_posix()
    raw = subprocess.check_output(['git', '-C', str(root), 'show', 'HEAD:' + own])
    require(raw == Path(__file__).read_bytes(), 'Reconciler differs from committed source')
    return I.committed_payload()

def exported_payload(binding):
    envelope=bound(binding)
    require(set(envelope)=={'schema','reconcilerSha256','payload'}
            and envelope['schema']=='pow-ui-storage-adoption-source-v1'
            and envelope['reconcilerSha256']==sha(Path(__file__).read_bytes()),
            'Exported reconciler source differs')
    I.validate_payload(envelope['payload'])
    for relative,module in [('deploy/ui-retention/install_lifecycle.py',I),
                            ('deploy/ui-retention/lifecycle_remote.py',R)]:
        require(sha(Path(module.__file__).read_bytes()) == envelope['payload']['files'][relative]['sha256'],
                'Loaded reconciliation helper differs from committed payload')
    return envelope['payload']

def allocation_bound(plan):
    core={k:v for k,v in plan.items() if k!='allocationBytes'}
    return max(16*1024**2, (len(encoded(core))+len(encoded(plan['before']['state']))+262144)*3
               +sum(v['bytes'] for v in plan['payload']['files'].values())*4)

def make_plan(binding):
    payload=exported_payload(binding)
    with I.deploy_lock(Path('/')):
        before = qualify(payload)
        plan={'schema':'pow-ui-storage-completion-adoption-plan-v1', 'authority':PIN,
              'reconcilerSha256':sha(Path(__file__).read_bytes()), 'payloadBinding':binding,
              'payload':payload, 'before':before}
        plan['allocationBytes']=allocation_bound(plan)
        I.existing_runtime(PIN['config']).capacity(plan['allocationBytes'])
        return plan

def apply(plan):
    require(os.geteuid() == 0, 'Production reconciliation requires root')
    require(plan.get('schema') == 'pow-ui-storage-completion-adoption-plan-v1'
            and plan.get('authority') == PIN and plan.get('reconcilerSha256') == sha(Path(__file__).read_bytes()),
            'Adoption plan authority changed')
    payload = plan['payload']; I.validate_payload(payload)
    require(payload == exported_payload(plan['payloadBinding']), 'Exported source changed after review')
    with I.deploy_lock(Path('/')):
        before = qualify(payload)
        # Available bytes can vary harmlessly; all measured guards and evidence stay exact.
        require({k:v for k,v in before.items() if k!='pools'} ==
                {k:v for k,v in plan['before'].items() if k!='pools'}, 'Adoption review changed')
        package = Path(payload['config']['package']['path'])
        require(not os.path.lexists(package), 'Adoption package already exists')
        old = before['state']
        adoption = {'intentPath':str(JOURNAL/'intent.json'), 'completionPath':str(JOURNAL/'adopted.json')}
        planned = dict(old, revision=222, configSha256=payload['configSha256'], status='complete',
                       pending=None, activePhase=None, index=PIN['index'], completedContext=before['context'],
                       lastCompleted=before['lastCompleted'], lastUpgrade={}, lastStorageAdoption=adoption)
        intent = {'schema':'pow-ui-storage-completion-adoption-intent-v1', 'plan':plan,
                  'stateTemplate':planned, 'stateTemplateSha256':sha(encoded(planned)),
                  'disposition':'completed-storage-adopted-without-replay', 'deletionAllowed':False, 'publicationAllowed':False}
        require(len(encoded(intent)) <= R.MAX_FRAME, 'Adoption intent exceeds native record bound')
        intent_sha=sha(encoded(intent))
        planned=dict(planned,lastStorageAdoption=dict(adoption,intentSha256=intent_sha))
        allocation=allocation_bound(plan)
        require(plan.get('allocationBytes') == allocation
                and allocation >= len(encoded(intent))*2+sum(v['bytes'] for v in payload['files'].values())*4,
                'Reviewed journal capacity bound changed')
        original=I.existing_runtime(PIN['config']); original.capacity(allocation)
        JOURNAL.mkdir(mode=0o700); I.sync(JOURNAL.parent)
        I.save(JOURNAL/'intent.json',encoded(intent))
        I.save(JOURNAL/'prior-config.json',base64.b64decode(before['configBase64']))
        I.save(JOURNAL/'prior-state.json',base64.b64decode(before['stateBase64']))
        active=dict(old,revision=221,activePhase={'operation':'adopt-storage-completion',
                     'intent':{'path':str(JOURNAL/'intent.json'),'sha256':intent_sha}})
        active_next=Path(I.STATE).with_name('state-storage-adoption-intent.next.json')
        I.save(active_next,encoded(active))
        I.read_bound(I.CONFIG,PIN['config']); I.read_bound(I.STATE,PIN['state'])
        os.replace(active_next,I.STATE); I.sync(Path(I.STATE).parent)
        package.mkdir(mode=0o700); I.sync(package.parent)
        for relative,value in payload['files'].items():
            path=package/relative; path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            I.save(path,base64.b64decode(value['base64'],validate=True))
            I.read_bound(path,value['sha256'])
        I.save(package/'package.json',encoded(payload['manifest']))
        runtime=new_runtime(payload,original)
        _,context=runtime.current()
        require(context==before['context'],'Protected context changed during adoption')
        runtime.verify_vps_completion(planned,context)
        runtime.S.compare_guards(runtime.layout,context['guards'],[])
        after=I.guard_inventory(); after['existingPackages']=[n for n in after['existingPackages'] if n!=package.name]
        require(after==before['guards'],'Existing helpers or protected manifests changed')
        evidence=I.evidence_inventory(Path(I.EVIDENCE))
        for name in (package.name,JOURNAL.name):evidence.pop(name)
        require(evidence==before['evidence'],'Prior evidence changed')
        state_next=Path(I.STATE).with_name('state-storage-adoption.next.json')
        config_next=Path(I.CONFIG).with_name('ui-lifecycle-storage-adoption.next.json')
        I.save(state_next,encoded(planned));I.save(config_next,encoded(payload['config']))
        I.read_bound(I.CONFIG,PIN['config']);I.read_bound(I.STATE,sha(encoded(active)))
        # Each partial switch is refused by config/state or adoption terminal binding.
        os.replace(state_next,I.STATE);I.sync(Path(I.STATE).parent)
        os.replace(config_next,I.CONFIG);I.sync(Path(I.CONFIG).parent)
        result={'schema':'pow-ui-storage-completion-adopted-v1','ok':True,'authority':PIN,
                'intent':{'path':str(JOURNAL/'intent.json'),'sha256':intent_sha},
                'config':{'path':I.CONFIG,'sha256':payload['configSha256']},
                'state':{'path':I.STATE,'sha256':sha(encoded(planned))},'stateRevision':222,
                'retentionComplete':True,'originalPhaseEvidencePreserved':True,
                'deletionPerformed':False,'publicationPerformed':False}
        I.save(JOURNAL/'adopted.json',encoded(result))
        installed=I.existing_runtime(payload['configSha256'])
        installed.verify_adoption=True
        status=installed.status({'requireComplete':True})
        require(status['stateSha256']==result['state']['sha256'] and status['retentionComplete'] is True,
                'Adoption post-switch status failed')
        verified={'schema':'pow-ui-storage-adoption-verified-v1','adoptionReceipt':{'path':str(JOURNAL/'adopted.json'),
                  'sha256':sha(encoded(result))},'state':result['state'],'config':result['config'],
                  'contextSha256':sha(encoded(status['context']))}
        I.save(JOURNAL/'verified.json',encoded(verified))
        installed.verify_adoption=False
        installed.status({'requireComplete':True})
        return result

def main():
    os.umask(0o077)
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='operation',required=True)
    s=sub.add_parser('export-payload');s.add_argument('--output',type=Path,required=True)
    s=sub.add_parser('plan');s.add_argument('--output',type=Path,required=True)
    s.add_argument('--payload',type=Path,required=True);s.add_argument('--payload-sha256',required=True)
    s=sub.add_parser('apply');s.add_argument('--plan',type=Path,required=True);s.add_argument('--plan-sha256',required=True)
    a=p.parse_args()
    if a.operation=='export-payload':
        envelope={'schema':'pow-ui-storage-adoption-source-v1','reconcilerSha256':sha(Path(__file__).read_bytes()),
                  'payload':source_payload()}
        I.save(a.output.absolute(),encoded(envelope))
        print(json.dumps({'payload':str(a.output),'sha256':sha(encoded(envelope)),
                          'sourceCommit':envelope['payload']['manifest']['sourceCommit']}))
    elif a.operation=='plan':
        plan=make_plan({'path':str(a.payload.absolute()),'sha256':a.payload_sha256})
        require(len(encoded(plan))<=R.MAX_FRAME,'Adoption plan exceeds native record bound')
        I.save(a.output.absolute(),encoded(plan))
        print(json.dumps({'plan':str(a.output),'sha256':sha(encoded(plan))}))
    else:print(json.dumps(apply(json.loads(I.read_bound(a.plan,a.plan_sha256)))))
if __name__=='__main__':main()
