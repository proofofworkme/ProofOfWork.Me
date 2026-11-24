#!/usr/bin/env python3
"""Synthetic native 18-state ancestry, exact-scope matching and terminal/restore refusals."""
import base64
from contextlib import ExitStack
import copy
import importlib.util
import json
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name+'.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


F = load('check-retirement-package-upgrade.test')
R, L = F.R, F.L
A = load('amo_341_recovery')
W = load('reconcile_completed_341')
X = load('recovery_exchange')
enc, sha = A.encoded, A.sha
H = lambda value: sha(enc(value))
b64 = lambda value: base64.b64encode(enc(value)).decode()
APPROVAL = 'audits/fixture-approval.json'
CONTROLLER = 'deploy/ui-retention/lifecycle_remote.py'
POLICY = 'deploy/audit30/ui-release-policy.py'
NEW_FILES = ('amo_341_recovery.py','reconcile_completed_341.py','recovery_exchange.py')


class Rehearsal(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.f = self.stack.enter_context(F.Ancestry())
        f = self.f
        self.files = f.fixture.files
        self.stack.enter_context(patch.object(R, 'amo_341_recovery_module', lambda: A))
        self.stack.enter_context(patch.object(L, 'amo_341_recovery_module', lambda: A))
        self.stack.enter_context(patch.object(A, '_BOUND_AMO_341_EXCHANGE_SOURCE', (HERE/'recovery_exchange.py').read_bytes(), create=True))
        self.stack.enter_context(patch.object(R.os.path,'lexists',lambda p: str(p) in self.files))
        f.state['revision'] = 307
        self.rows=[]
        self.remember()
        for i in range(1,16):
            f.upgrade(i)
            if i == 13:
                # A later ordinary cycle is complete in the same config, so
                # its completion walk stops independently of retirement history.
                f.state = copy.deepcopy(f.state)
                f.state['revision'] += 2
                f.state['lastCompleted']['cycleId'] = 'later-ordinary-cycle'
            self.remember()
        self.old_state=copy.deepcopy(f.state)
        self.old_files={APPROVAL:b'retained authority',CONTROLLER:b'old controller',POLICY:b'unchanged policy'}
        self.reversal={'pinnedPriorTerminal':'synthetic'}
        self.failed=self.append(341,self.old_files,{'priorStageReversal':self.reversal},None,seal=False)
        self.remember()
        old=self.failed; cfg=old['config']; st=old['state']
        self.fail={'error':A.FAILURE,'manualReconciliationRequired':True,'config':old['completed']['config'],'state':old['completed']['state']}
        self.put(old['journal']/'verification-failed.json',self.fail)
        pins=dict(configSha256=H(cfg),stateSha256=H(st),packageSha256=cfg['package']['sha256'],
                  intentSha256=H(old['intent']),completedSha256=H(old['completed']),failureSha256=H(self.fail),
                  planSha256=H(old['intent']['plan']),originConfigSha256=f.origin_sha,historySha256=H(self.rows[::-1]),
                  commit=cfg['sourceCommit'],tree=cfg['sourceTree'])
        self.stack.enter_context(patch.dict(A.AUTHORITY,pins))
        self.stack.enter_context(patch.object(A,'FAILED_JOURNAL',old['journal']))
        new_files=dict(self.old_files)
        new_files[CONTROLLER]=b'reviewed successor'
        for name in NEW_FILES:
            new_files['deploy/ui-retention/'+name]=name.encode()
        self.descriptors={role:{'sha256':H(old[role])} for role in ('config','state')}
        before={'amo341Failure':A.failed_binding(),'priorStageReversal':self.reversal,'originalFiles':self.descriptors}
        self.new=self.append(343,new_files,before,A.request(),seal=True)
        self.exchange_records()

    def put(self,path,value):
        self.files[str(path)]=enc(value)

    def remember(self):
        f=self.f
        self.rows.append([f.config_sha,H(f.state),f.state['revision'],f.config['package']['sha256']])

    def append(self,revision,files,extra,request,seal):
        f=self.f;old=f.state;prior=f.config
        manifest={'schema':'pow-ui-retention-package-v1','sourceCommit':format(revision,'040x'),
                  'sourceTree':format(revision+100,'040x'),'files':{k:{'sha256':sha(v),'bytes':len(v)} for k,v in files.items()}}
        pkg=H(manifest);root=A.ROOT/('ui-lifecycle-tools-'+pkg)
        config=dict(prior,sourceCommit=manifest['sourceCommit'],sourceTree=manifest['sourceTree'],
                    package={'path':str(root),'sha256':pkg},controller={'path':str(root/CONTROLLER),'sha256':sha(files[CONTROLLER])},
                    approval={'path':str(root/APPROVAL),'sha256':sha(files[APPROVAL])})
        payload={'config':config,'configSha256':H(config),'manifest':manifest}
        req=request or {'mode':'completed-cycle','configSha256':H(prior),'stateSha256':H(old)}
        proof={'fullCompletionVerified':True,'verifiedRetiredPayloads':f.context.proof,'index':old['index'],
               'context':old['completedContext'],'lastCompleted':old['lastCompleted']}
        before=dict(extra,configBase64=b64(prior),stateBase64=b64(old),completionVerification=proof)
        plan={'schema':'pow-ui-retention-upgrade-plan-v1','scopeApprovalSha256':config['scopeApprovalSha256'],
              'request':req,'payload':payload,'before':before}
        p=W.projection(plan)
        if revision==341:
            # The normal failed predecessor uses its own real revision and hashes.
            t=p['intent']['stateTemplate'];t['revision']=revision
            p['intent']['stateTemplateSha256']=H(t)
            p['state']=dict(t,lastUpgrade=dict(t['lastUpgrade'],intentSha256=H(p['intent'])))
            p['completed']['stateRevision']=revision
            p['completed']['intent']['sha256']=H(p['intent']);p['completed']['state']['sha256']=H(p['state'])
        self.put(root/'package.json',manifest)
        for k,v in files.items():
            self.files[str(root/k)]=v
        for name,key in [('prior-state','priorState'),('prior-config','priorConfig'),('intent','intent'),('completed','completed')]:
            self.put(p['journal']/(name+'.json'),p[key])
        if seal:
            self.put(p['journal']/'verified.json',p['verified'])
        f.config,f.state,f.config_sha=config,p['state'],H(config)
        return p

    def exchange_records(self):
        p=self.new;j=p['journal']/'exchange';plan=p['intent']['plan'];seal=H(p['verified'])
        manifest={'schema':X.SCHEMA,'directories':{'custody':'fixture'},'planSha256':H(plan),'files':{}}
        for role in ('state','config'):
            manifest['files'][role]={'before':self.descriptors[role],'after':{'sha256':p['completed'][role]['sha256']}}
            self.put(j/role,self.failed[role])
        self.put(j/'prepared.json',manifest)
        prefix={'schema':X.SCHEMA,'planSha256':H(plan),'preparedSha256':H(manifest)}
        for phase in ('forward','checking','verified','accepted'):
            record=dict(prefix,phase=phase)
            if phase=='verified':
                record['verificationSha256']=seal
            if phase=='accepted':
                record.update(verificationSha256=A.acceptance_digest(p['config'],p['completed'],seal),
                              verifiedSha256=sha(self.files[str(j/'verified.json')]))
            self.put(j/(phase+'.json'),record)
        self.j=j

    def test_failed_review_and_direct_18_state_normal_success(self):
        f=self.f;old=self.failed
        self.assertEqual(f.context.verify_failed_amo_341(old['state'],old['config'])['visitedConfigurations'],17)
        with self.assertRaisesRegex(ValueError,'exceeds bound'):
            f.context.verify_lifecycle_state(old['state'],H(old['config']),config=old['config'],verify_current_seal=False)
        self.assertEqual(f.runtime_state()[0],self.new['state'])
        self.assertNotIn(str(old['journal']/'verified.json'),self.files)
        # Later ordinary work at the same package does not rebase its 343 proof.
        f.state=copy.deepcopy(f.state);f.state['revision']+=4
        self.assertEqual(f.runtime_state()[0],f.state)

    def test_prospective_does_not_issue_normal_authority(self):
        f=self.f
        for path in [self.j/'accepted.json', self.j/'verified.json',self.new['journal']/'verified.json']:
            del self.files[str(path)]
        self.assertEqual(f.context.verify_prospective_amo_341(f.state,f.config)['configSha256'],f.origin_sha)
        with self.assertRaises(FileNotFoundError): f.runtime_state()
        f.context._recovery_candidate_state(f.state,f.config,False,'checking')
        self.put(self.new['journal']/'verified.json',self.new['verified'])
        f.context._recovery_candidate_state(f.state,f.config,True,'checking')
        with self.assertRaisesRegex(ValueError,'exchange'): f.runtime_state()

    def test_stale_terminal_and_reversal_refuse_even_with_normal_seal(self):
        f=self.f
        real=self.files.pop(str(self.j/'accepted.json'))
        f.context._recovery_candidate_state(f.state,f.config,True,'provisional')
        with self.assertRaisesRegex(ValueError,'exchange'): f.runtime_state()
        self.files[str(self.j/'accepted.json')]=real
        accept=json.loads(real);accept['verificationSha256']='0'*64
        self.put(self.j/'accepted.json',accept)
        with self.assertRaisesRegex(ValueError,'ordinary verification'): f.runtime_state()
        self.files[str(self.j/'accepted.json')]=real
        rev=json.loads(self.files[str(self.j/'forward.json')])
        rev.update(phase='reversing',failure={'type':'ValueError','messageSha256':'a'*64})
        self.put(self.j/'reversing.json',rev)
        with self.assertRaisesRegex(ValueError,'Conflicting'): f.runtime_state()

    def test_renumbered_or_missing_history_and_unreviewed_descendant_refused(self):
        f=self.f
        with patch.dict(A.AUTHORITY,{'historySha256':'1'*64}):
            with self.assertRaisesRegex(ValueError,'recovery request|ancestry differs'): f.verify()
        historical=f.edges[4]['upgrade']['statusVerificationPath']
        original=self.files.pop(historical)
        with self.assertRaises(FileNotFoundError): f.verify()
        self.files[historical]=original
        f.upgrade(18)
        with self.assertRaisesRegex(ValueError,'direct package successor'): f.verify()

    def test_wrong_origin_missing_link_and_repeated_configuration_refused(self):
        f=self.f
        anchor=f.config['payloadRetirementSourceConfig']
        with patch.dict(anchor,sha256='d'*64):
            with self.assertRaisesRegex(ValueError,'Evidence bytes differ'):
                f.verify()
        missing=f.edges[2]['upgrade']['intentPath']
        original=self.files.pop(missing)
        with self.assertRaises(FileNotFoundError):
            f.verify()
        self.files[missing]=original
        # A parser returning a link to a previously visited config must fail
        # even if the loop does not yet reach the ordinary depth ceiling.
        repeated={'priorConfig':f.config,'priorConfigSha256':f.config_sha,'priorState':f.state}
        with patch.object(R,'verify_publication_upgrade_edge',return_value=repeated):
            with self.assertRaisesRegex(ValueError,'config chain differs'):
                f.verify()
        rows=self.rows[::-1]
        A.check_history(rows)
        rows[2],rows[3]=rows[3],rows[2]
        with self.assertRaisesRegex(ValueError,'historical ancestry differs'):
            A.check_history(rows)

    def test_installer_only_check_requires_real_lock_and_resets_private_mode(self):
        f=self.f
        lock_calls=[]
        def fail_lock(fd,layout):
            raise ValueError('No fixture lock')
        S=SimpleNamespace(require_execution_lock=fail_lock)
        rt=L.Runtime(f.config,f.config_sha,S,SimpleNamespace(retirement_module=lambda:R),
                     layout=f.fixture.layout,retirement=f.context)
        with self.assertRaisesRegex(ValueError,'No fixture lock'):
            rt.recovery_switch_status(require_current_seal=False)
        def verify_lock(fd,layout):
            lock_calls.append((fd,layout))
        S.require_execution_lock=verify_lock
        with patch.object(rt,'status',side_effect=ValueError('other guard refused')):
            with self.assertRaisesRegex(ValueError,'other guard refused'):
                rt.recovery_switch_status(require_current_seal=True,provisional=True)
        self.assertFalse(rt.verify_upgrade)
        self.assertFalse(rt._amo_341_checking)
        with patch.object(rt,'status',return_value={'complete':True}) as status:
            self.assertEqual(rt.recovery_switch_status(require_current_seal=True,provisional=True),{'complete':True})
            status.assert_called_once_with({'requireComplete':True})
        self.assertEqual(len(lock_calls),3)

    def test_prior_failure_substitute_seal_and_altered_source_refused(self):
        old=self.failed
        self.put(old['journal']/'verified.json',{'ok':True})
        with self.assertRaisesRegex(ValueError,'historical seal'): self.f.verify()
        del self.files[str(old['journal']/'verified.json')]
        failure=str(old['journal']/'verification-failed.json')
        self.files[failure]+=b' '
        with self.assertRaisesRegex(ValueError,'Evidence bytes differ'): self.f.verify()
        self.files[failure]=enc(self.fail)
        self.files[str(Path(self.f.config['package']['path'])/POLICY)]+=b' '
        with self.assertRaisesRegex(ValueError,'Evidence bytes differ'): self.f.verify()

    def test_different_package_scope_and_approval_refuse(self):
        plan=copy.deepcopy(self.new['intent']['plan']);cfg=plan['payload']['config'];old=self.failed
        man=plan['payload']['manifest'];man['files']['unrelated.py']={'sha256':'a'*64,'bytes':1}
        package=H(man);root=A.ROOT/('ui-lifecycle-tools-'+package)
        cfg['package']={'path':str(root),'sha256':package};cfg['controller']['path']=str(root/CONTROLLER)
        cfg['approval']['path']=str(root/APPROVAL)
        self.put(root/'package.json',man)
        with self.assertRaisesRegex(ValueError,'file scope'):
            A.verify_edge(plan,cfg,old['config'],old['state'],R.read_bound)
        actual=self.new['intent']['plan'];wrong=copy.deepcopy(actual['payload']['config'])
        wrong['approval']['sha256']='f'*64
        with self.assertRaisesRegex(ValueError,'original approval'):
            A.verify_edge(actual,wrong,old['config'],old['state'],R.read_bound)

    def test_transitive_sources_must_match_reviewed_bytes(self):
        for name in ('lifecycle_remote','retirement_receipt'):
            native = load(name)
            with patch.object(native, '_BOUND_AMO_341_SOURCE', b'# wrong reader', create=True):
                with self.assertRaisesRegex(ValueError, 'verifier source'):
                    native.amo_341_recovery_module()
        with patch.object(A, '_BOUND_AMO_341_EXCHANGE_SOURCE', b'# wrong exchange', create=True):
            with self.assertRaisesRegex(ValueError, 'exchange verifier source'):
                A.exchange_module(R.read_bound)

    def test_same_cycle_native_walk_authenticates_failed_341_and_terminal_343(self):
        f=self.f
        rt=L.Runtime(f.config, f.config_sha, SimpleNamespace(), SimpleNamespace(retirement_module=lambda:R),
                     layout=f.fixture.layout, retirement=f.context)
        def read(path,expected=None,maximum=L.MAX_FRAME):
            raw=f.fixture.read(path,maximum)
            if expected is not None and expected!=sha(raw): raise ValueError('Wrong fixture digest')
            return raw,sha(raw)
        with patch.object(L,'read',read):
            self.assertEqual(len(rt.completion_transitions(f.state)),4)
            del self.files[str(self.j/'accepted.json')]
            with self.assertRaisesRegex(ValueError,'exchange'):
                rt.completion_transitions(f.state)



if __name__=='__main__':
    unittest.main()
