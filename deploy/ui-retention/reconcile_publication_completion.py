#!/usr/bin/env python3
"""One exact publication-upgrade reconciliation. Original records remain immutable.

Only prepare-cycle's original-state comparison is extended by an authenticated
one-edge verifier. All admission/planning, deletion and completion logic remains
native. Apply is creation-only; never retry an incomplete attempt automatically.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path

PACKAGE = '/var/backups/proofofwork-ui/cleanup-evidence/ui-lifecycle-tools-f63b31e37ed986c042aad4afd74f876107d636ce4ef667b462b6159867686270'
CONFIG_SHA = '9fd09bb78089af16d1c9a9b27d07e13806aa0fc3607c03bc7452d9332de0177c'
RUNTIME_SHA = '842f05ac5d79029d53672753e4f83d13558ffb4d3bb3b574bd7aa9f7176bb5c3'
RELEASE = '9f18a0ce7032-20261118T004519Z'
PLAN = '/var/tmp/proofofwork-deploy/recovery-plan-'+RELEASE+'-initial.json'
PUBLICATION = '/var/tmp/proofofwork-deploy/recovery-publish-'+RELEASE+'-initial/receipt.json'
HTTPS = '/var/backups/proofofwork-ui/cleanup-evidence/ui-https-'+RELEASE+'.json'

def load(name, path, expected=None):
    p=Path(path); info=p.lstat()
    if p.resolve()!=p or p.is_symlink() or info.st_uid!=os.geteuid() or info.st_mode & 0o7022:
        raise ValueError('Unsafe adapter dependency')
    if expected and hashlib.sha256(p.read_bytes()).hexdigest()!=expected:
        raise ValueError('Installed adapter dependency changed')
    spec=importlib.util.spec_from_file_location(name,p)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def adapter_type(R, B):
    require,embedded,read_json=R.require,R.embedded,R.read_json
    APPROVAL_SHA,write_new,sha,encoded=R.APPROVAL_SHA,R.write_new,R.sha,R.encoded
    VPS_POLICY=R.VPS_POLICY
    class ReconciledRuntime(R.Runtime):
        def bridge_proof(self,state,state_sha,rule):
            native,_=read_json(PLAN,rule['releasePlanSha256'])
            edge=self.P.retirement_module().verify_publication_upgrade_edge(
                state,self.config_sha,self.config,lambda path,expected:R.read(path,expected)[0])
            proof=B.verify_bridge(state,state_sha,self.config,self.config_sha,native,rule,edge)
            return {**proof,'adapterSha256':sha(Path(__file__).read_bytes()),
                'verifierSha256':sha(Path(B.__file__).read_bytes()),'runtimeSha256':RUNTIME_SHA}
        def prepare_cycle(self, frame):
            state, state_sha = self.state()
            require(state is not None and state.get('index') and state.get('pending') is None
                    and not state.get('activePhase'), 'Initialize or reconcile the pending lifecycle first')
            pair, context = self.current()
            https, _ = embedded(frame['httpsReceipt'])
            publication = self.verify_publication(https, frame['publicationReceipt'], pair, context)
            rule = self.private_stage_rule(publication) if self.config.get('retentionPolicy') == VPS_POLICY else None
            proof = self.bridge_proof(state, state_sha, rule)
            require(context['pair'] == proof['retainedPair'], 'Reconciliation live pair changed')
            index = state['index']
            data = self.load_index(index['path'], index['sha256'])
            existing_hold = (self.P.fallback_hold(self.layout,data['index']['admissions'],data['admissions'])
                             if self.retirement is None else None)
            if existing_hold or (rule and rule['forecast'].get('preservedFallback')):
                require(rule and rule['forecast'].get('preservedFallback') == existing_hold,
                        'Published plan lacks the admitted in-place fallback hold')
                self.P.verify_fallback_hold(existing_hold,self.layout,pair,{})
            existing_1042 = (self.P.preserved_1042_hold(self.layout,data['index']['admissions'],data['admissions'])
                             if self.retirement is None else None)
            if existing_1042:
                require(rule and rule['forecast'].get('preservedRelease1042') == existing_1042,
                        'Published plan lacks the exact 1042 hold')
                self.P.verify_1042_hold(existing_1042,self.layout,pair,{})
            self.capacity(65536)
            self.evidence('publication-completion-bridge-9f18-v1.json', proof)
            operation_id, intent, active_sha = self.begin('prepare-cycle', frame, state, state_sha, context)
            _, https_binding = self.store('ui-lifecycle-' + operation_id + '-https.json', frame['httpsReceipt'])
            if context['pair']['current'] not in data['releaseIds']:
                admission = self.P.admission(self.layout, APPROVAL_SHA, False, index,
                                             **({'retirement': self.retirement} if self.retirement is not None else {}))
                admission_binding = self.evidence('audit30-policy-admission-' + operation_id + '.json', admission)
                index_value = dict(data['index'], admissions=[*data['index']['admissions'], admission_binding])
                index = self.evidence('audit30-policy-admission-index-' + operation_id + '.json', index_value)
            else:
                require(data['admissions'][-1]['retainedPair'] == context['pair'], 'Latest admission does not bind live pair')
            scope = self.policy_scope(index)
            if scope.get('verifiedRetiredPayloads'):
                require(rule and rule['forecast'].get('verifiedRetiredPayloads') == scope['verifiedRetiredPayloads'],
                        'Publication lost authenticated retired-payload proof')
            if scope.get('preservedFallback'):
                require(rule and rule['forecast'].get('preservedFallback') == scope['preservedFallback']
                        and sorted(r['path'] for r in scope['eligible']) == rule['forecast']['wouldRetire'], 'Publication requires the same fallback hold and reviewed retirement paths')
            if scope.get('preservedRelease1042'):
                require(rule and rule['forecast'].get('preservedRelease1042') == scope['preservedRelease1042'],
                        'Publication changed exact 1042 hold')
            plan = self.S.create_plan(self.layout, 'future-retention', APPROVAL_SHA, scope)
            if rule:
                plan['privateStageRetention'] = rule
                self.verify_private_retirement(plan)
                self.S.validate_plan(plan, self.layout, 'future-retention', APPROVAL_SHA)
            plan_raw = self.S.encoded(plan)
            self.capacity(len(plan_raw) + 65536)
            plan_binding = write_new(self.layout.evidence / ('ui-lifecycle-' + operation_id + '-ordinary-plan.json'), plan_raw)
            token = sha(encoded({'intent': intent, 'plan': plan_binding, 'context': context}))
            pending = {'cycleId': operation_id, 'token': token, 'stage': 'prepared', 'context': context,
                       'ordinaryPlan': plan_binding, 'httpsReceipt': https_binding,
                       'publicationReceipt': publication, 'index': index}
            new = dict(state, revision=state['revision'] + 2, status='retention-incomplete', index=index,
                       pending=pending, lastIntent=intent)
            return self.finish(operation_id, intent, active_sha, new,
                               {'cycleId': operation_id, 'pendingToken': token, 'index': index,
                                'ordinaryPlan': plan_binding if self.config.get('retentionPolicy') == VPS_POLICY else dict(plan_binding, value=plan),
                                **({('privateStageReviewedRetirement' if rule['forecast']['wouldRetire'] else 'privateStageZeroRetirement'): {'ordinaryPlanSha256':plan_binding['sha256'],
                                    'releasePlanSha256':rule['releasePlanSha256'],'delete':len(plan['delete']),'moves':0,'eligible':len(scope['eligible'])}} if rule else {}),
                                'lifecycleBinding': self.lifecycle(index), 'retentionComplete': False})

    return ReconciledRuntime

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation',choices=['qualify','apply'])
    args=parser.parse_args();os.umask(0o077)
    if not (os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0 and sys.flags.isolated and not sys.flags.optimize): raise ValueError('Production reconciliation requires isolated root')
    R=load('installed_completion_runtime',PACKAGE+'/deploy/ui-retention/lifecycle_remote.py',RUNTIME_SHA)
    B=load('publication_completion_bridge',Path(__file__).with_name('publication_completion_bridge.py'))
    original=R.installed_runtime('/etc/proofofwork-retention/ui-lifecycle.json',CONFIG_SHA)
    runtime=adapter_type(R,B)(original.config,original.config_sha,original.S,original.P,
        original.C,layout=original.layout,retirement=original.retirement)
    runtime.require_no_pending_payload_retirement()
    lock=runtime.S.lock(runtime.layout)
    try:
        runtime.lock_fd=lock
        state,state_sha=runtime.state();pair,context=runtime.current()
        raw,_=R.read(HTTPS)
        https=json.loads(raw,object_pairs_hook=R.unique)
        publication=runtime.verify_publication(https,{'path':PUBLICATION,'sha256':B.PIN['publication']},pair,context)
        rule=runtime.private_stage_rule(publication)
        proof=runtime.bridge_proof(state,state_sha,rule)
        R.require(context['pair']==proof['retainedPair'],'Reconciliation pair differs')
        frame={'expectedStateSha256':state_sha,'expectedPair':context['pair'],
            'operationId':'release-'+RELEASE+'-bridge',
            'httpsReceipt':{'sha256':R.sha(raw),'base64':R.base64.b64encode(raw).decode()},
            'publicationReceipt':publication}
        print(json.dumps({'qualified':True,'proof':proof}),flush=True)
        if args.operation=='qualify':return
    finally:
        runtime.lock_fd=None;os.close(lock)
    prepared=runtime.dispatch('prepare-cycle',frame)
    print(json.dumps({'prepared':prepared}),flush=True)
    mutation={'expectedStateSha256':prepared['stateSha256'],'expectedPair':proof['retainedPair'],
        'operationId':'ordinary-'+RELEASE+'-bridge','cycleId':prepared['cycleId'],
        'pendingToken':prepared['pendingToken']}
    applied=runtime.dispatch('apply-vps-retention',mutation)
    print(json.dumps({'applied':applied}),flush=True)
    final=runtime.dispatch('complete-vps-cycle',{**mutation,
        'expectedStateSha256':applied['stateSha256'],'operationId':'complete-'+RELEASE+'-bridge'})
    print(json.dumps({'completed':final}),flush=True)

if __name__=='__main__':main()
