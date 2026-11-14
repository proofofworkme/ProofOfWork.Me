#!/usr/bin/env python3
"""Local temporary-filesystem tests; no production paths are ever invoked."""
import copy
import hashlib
import importlib.util
import json
import os
import stat
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('retirement_transition_tests',HERE/'retirement_transition.py')
M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)
def raw(v):return M.encoded(v)
def digest(b):return hashlib.sha256(b).hexdigest()
def write(p,b):
    p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b);p.chmod(0o600)
class Context:
    def __init__(self,case):
        self.case=case
        self.proof={'proposalSha256':case.R.PROPOSAL_SHA,'sourceIndex':case.R.SOURCE_INDEX,
                    'receipt':{'path':str(case.directory/'completed.json'),'sha256':'f'*64},
                    'retiredPayloadPaths':['fixed-old-payload'], 'receiptSha256':'f'*64,
                    'policyCodeSha256':case.package['sha256']}
    def verify_scope(self,layout):
        if not self.case.scope_ok:raise ValueError('Fixture scope changed')
    def verify_lifecycle_state(self,state,config_sha):
        assert state['configSha256']==config_sha
        binding=state['lastPayloadRetirement'];t=json.loads(M.read(binding['path'],binding['sha256']))
        assert t['successorConfigSha256']==config_sha
        expected=dict(self.case.state,**t['statePatch'],lastPayloadRetirement=binding)
        assert state==expected
class TransitionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup);self.base=Path(self.temp.name)
        self.config=self.base/'etc/config.json';self.state_path=self.base/'var/state.json'
        self.directory=self.base/'evidence/older-retirement';self.directory.mkdir(parents=True,mode=0o700)
        self.index=self.directory.parent/'successor-index.json'
        self.oldindex=self.directory.parent/'old-index.json'
        self.pair={'current':'current','previous':'previous'}
        self.layout=types.SimpleNamespace(live=self.base/'www',evidence=self.directory.parent)
        self.protected={}
        for k in self.pair:
            p=self.base/k
            write(p/'.proofofwork-ui-release',(k+' manifest').encode())
            self.protected[k]={'path':str(p),'fields':{'release_id':self.pair[k]}}
        self.guards={'masks':['unchanged'],'heldCensus':['unchanged']}
        self.context={'pair':self.pair.copy(),'manifests':{
            k:digest((Path(self.protected[k]['path'])/'.proofofwork-ui-release').read_bytes())
            for k in self.pair},'guards':copy.deepcopy(self.guards)}
        write(self.oldindex,raw({'schema':'fixture','admissions':[],'completedRetirements':[]}))
        oldconfig={'schema':'fixture','statePath':str(self.state_path),
                   'sourceCommit':'old','sourceTree':'old','package':{'path':'old','sha256':'old'},
                   'controller':{'path':'old','sha256':'old'},'approval':{'path':'old','sha256':'old'}}
        write(self.config,raw(oldconfig));self.config_sha=digest(raw(oldconfig))
        self.state={'configSha256':self.config_sha,'revision':258,'status':'complete',
                    'pending':None,'activePhase':None,'index':{'path':str(self.oldindex),'sha256':digest(self.oldindex.read_bytes())},
                    'lastCompleted':{'retainedPair':self.pair.copy()},'completedContext':self.context,
                    'lastUpgrade':{'old':'preserved'},'lastStorageAdoption':{'old':'preserved'}}
        write(self.state_path,raw(self.state))
        proposal={'stateSha256':digest(raw(self.state))}
        write(self.directory/'proposal.json',raw(proposal))
        self.R=types.SimpleNamespace(PRIOR_CONFIG_SHA=self.config_sha,PROPOSAL_SHA=digest(raw(proposal)),
            SOURCE_INDEX=self.state['index'],PAIR=self.pair,TERMINAL_PATH=str(self.directory/'completed.json'),
            require_verified_retirement=lambda c: None if isinstance(c,Context) else (_ for _ in ()).throw(ValueError('unverified')))
        self.scope_ok=True;self.lock_ok=True
        def locked(fd,layout):
            if fd!=42 or not self.lock_ok:raise ValueError('lock changed')
        self.S=types.SimpleNamespace(Layout=lambda:self.layout,require_execution_lock=locked,
            protected_pair=lambda layout,cache:copy.deepcopy(self.protected),
            safeguards=lambda layout,model: (copy.deepcopy(self.guards),{}),
            ROTATING_LOG_GUARD_MODEL='fixture',hash_read=lambda p:(digest(p.read_bytes()),p.read_bytes()))
        files={'approval.json':b'approved',
               'deploy/ui-retention/lifecycle_remote.py':b'# fixture lifecycle\n',
               'deploy/ui-retention/retirement_transition.py':(HERE/'retirement_transition.py').read_bytes()}
        self.L=types.SimpleNamespace(PACKAGE_FILES=tuple(files),APPROVAL_SHA=digest(files['approval.json']))
        manifest={'schema':'pow-ui-retention-package-v1','sourceCommit':'a'*40,'sourceTree':'b'*40,
                  'files':{k:{'bytes':len(v),'sha256':digest(v)} for k,v in files.items()}}
        package_sha=digest(raw(manifest));root=self.directory.parent/('ui-lifecycle-tools-'+package_sha)
        for k,v in files.items():write(root/k,v)
        write(root/'package.json',raw(manifest))
        self.package={'path':str(root),'sha256':package_sha}
        self.patches=patch.multiple(M,CONFIG=self.config,STATE=self.state_path,DIRECTORY=self.directory,
                                   INDEX=self.index,_BOUND_RETIREMENT=self.R,
                                   __file__=str(root/'deploy/ui-retention/retirement_transition.py'),create=True)
        self.patches.start();self.addCleanup(self.patches.stop)
        def fixture_ancestors(directory):
            directory=Path(directory)
            M.require(directory.is_relative_to(self.base),'Outside trusted fixture root')
            for parent in (directory,*directory.parents):
                if not parent.is_relative_to(self.base):break
                info=parent.lstat()
                M.require(parent.resolve()==parent and stat.S_ISDIR(info.st_mode)
                          and info.st_uid==0 and not info.st_mode&0o022,'Unsafe transition ancestor')
        self.ancestor_patch=patch.object(M,'ancestor_check',side_effect=fixture_ancestors)
        self.ancestor_patch.start();self.addCleanup(self.ancestor_patch.stop)
        self.preflight_patch=patch.object(M.Transition,'original_preflight',autospec=True)
        self.preflight=self.preflight_patch.start();self.addCleanup(self.preflight_patch.stop)
        self.t=M.Transition(self.S,self.L,42);self.c=Context(self)
    def prepared(self):
        return self.t.prepare_pending(self.package)
    def pending(self):
        self.prepared();self.t.install_pending()
    def terminal_prepared(self):
        self.pending();return self.t.prepare_terminal(self.c)
    def test_capture_preserves_original_bytes(self):
        self.prepared()
        self.assertEqual((self.directory/'prior-config.json').read_bytes(),self.config.read_bytes())
        self.assertEqual((self.directory/'prior-state.json').read_bytes(),self.state_path.read_bytes())
        self.assertEqual(self.t.positions()['config'],'original')
    def test_pending_blocks_via_explicit_mode(self):
        self.pending();config=json.loads(self.config.read_bytes())
        self.assertEqual(config['payloadRetirement']['mode'],'pending')
        self.assertEqual(self.state_path.read_bytes(),raw(self.state))
    def test_prepare_idempotent_before_install(self):
        first=self.prepared();self.assertEqual(first,self.prepared())
    def test_pending_install_idempotent(self):
        self.pending();before=self.config.lstat().st_ino
        self.t.install_pending();self.assertEqual(before,self.config.lstat().st_ino)
    def test_restart_requires_known_intent_hash(self):
        self.prepared()
        other=M.Transition(self.S,self.L,42)
        with self.assertRaisesRegex(ValueError,'intent digest'):other.positions()
    def test_wrong_intent_digest_rejected(self):
        self.prepared();other=M.Transition(self.S,self.L,42,intent_sha='f'*64)
        with self.assertRaisesRegex(ValueError,'hash differs'):other.positions()
    def test_state_change_before_pending_fails(self):
        self.prepared();write(self.state_path,raw(dict(self.state,revision=259)))
        with self.assertRaisesRegex(ValueError,'hash differs'):self.t.install_pending()
    def test_package_mutation_fails(self):
        self.prepared();p=Path(self.package['path'])/'deploy/ui-retention/lifecycle_remote.py';write(p,b'changed')
        with self.assertRaisesRegex(ValueError,'hash differs'):self.t.install_pending()
    def test_context_change_before_terminal_fails(self):
        self.pending();self.guards['heldCensus'].append('changed')
        with self.assertRaisesRegex(ValueError,'context changed'):self.t.prepare_terminal(self.c)
    def test_unverified_context_rejected(self):
        self.pending()
        with self.assertRaisesRegex(ValueError,'unverified'):self.t.prepare_terminal({})
    def test_terminal_state_exact_patch(self):
        result=self.terminal_prepared()
        out=json.loads((self.directory/'successor-state.json').read_bytes())
        self.assertEqual(out['revision'],260);self.assertEqual(out['lastUpgrade'],{})
        self.assertEqual(out['lastStorageAdoption'],self.state['lastStorageAdoption'])
        transition=json.loads((self.directory/'transition-completed.json').read_bytes())
        self.assertEqual(transition['preservedLastUpgrade'],self.state['lastUpgrade'])
        self.assertEqual(out['completedContext'],self.context)
        self.assertEqual(transition['successorConfigSha256'],result['config']['sha256'])
    def test_terminal_state_installed_before_config(self):
        self.terminal_prepared();observed=[];original=M.os.rename
        def replacing(src,dst,**kwargs):
            observed.append(dst);return original(src,dst,**kwargs)
        with patch.object(M.os,'rename',side_effect=replacing):out=self.t.install_terminal(self.c)
        self.assertEqual(observed,[self.state_path.name,self.config.name])
        self.assertEqual(out['config'],out['state']);self.assertEqual(out['state'],'terminal')
    def test_partial_terminal_requires_explicit_resume(self):
        self.terminal_prepared();original=M.os.rename
        def replacing(src,dst,**kwargs):
            if dst==self.config.name:raise OSError('fixture interruption')
            return original(src,dst,**kwargs)
        with patch.object(M.os,'rename',side_effect=replacing):
            with self.assertRaises(OSError):self.t.install_terminal(self.c)
        self.assertEqual(self.t.positions()['config'],'pending')
        self.assertEqual(self.t.positions()['state'],'terminal')
        with self.assertRaisesRegex(ValueError,'explicit reconciliation'):self.t.install_terminal(self.c)
        out=self.t.install_terminal(self.c,resume=True);self.assertEqual(out['config'],'terminal')
    def test_unknown_partial_temp_fails_closed(self):
        self.terminal_prepared()
        temp=self.state_path.with_name('.'+self.state_path.name+'.pow-retirement-terminal-state.tmp')
        write(temp,b'partial')
        with self.assertRaisesRegex(ValueError,'replacement temp'):self.t.install_terminal(self.c)
        self.assertEqual(self.t.positions()['state'],'original')
    def test_unknown_mixed_config_fails(self):
        self.terminal_prepared();write(self.config,b'unknown')
        with self.assertRaisesRegex(ValueError,'mixed lifecycle'):self.t.positions()
    def test_lost_lock_stops_writes(self):
        self.prepared();self.lock_ok=False
        with self.assertRaisesRegex(ValueError,'lock changed'):self.t.install_pending()
        self.assertEqual(digest(self.config.read_bytes()),self.config_sha)
    def test_terminal_scope_failure_stops_writes(self):
        self.terminal_prepared();self.scope_ok=False
        with self.assertRaisesRegex(ValueError,'scope changed'):self.t.install_terminal(self.c)
        self.assertEqual(self.t.positions()['state'],'original')
    def test_repeated_terminal_verifies_without_replace(self):
        self.terminal_prepared();self.t.install_terminal(self.c)
        with patch.object(M.os,'rename',side_effect=AssertionError('must not repeat')):
            self.assertEqual(self.t.install_terminal(self.c)['config'],'terminal')
    def test_context_package_mismatch_before_prepare(self):
        self.pending();self.c.proof['policyCodeSha256']='0'*64
        with self.assertRaisesRegex(ValueError,'planned pending package'):
            self.t.prepare_terminal(self.c)
        self.assertFalse(self.index.exists())
    def test_staged_config_tamper_before_activation(self):
        self.terminal_prepared()
        path=self.directory/'successor-config.json'
        value=json.loads(path.read_bytes());value['sourceCommit']='other'
        write(path,raw(value))
        with self.assertRaisesRegex(ValueError,'exact reconstruction'):
            self.t.install_terminal(self.c)
        self.assertEqual(self.state_path.read_bytes(),raw(self.state))
    def test_scope_mismatch_recovery_rejected(self):
        self.terminal_prepared();self.c.proof['policyCodeSha256']='0'*64
        with self.assertRaisesRegex(ValueError,'planned pending package'):
            self.t.install_terminal(self.c,resume=True)
    def test_original_preflight_failure_prevents_pending(self):
        self.preflight.side_effect=ValueError('old physical failure')
        with self.assertRaisesRegex(ValueError,'old physical failure'):self.prepared()
        self.assertEqual(digest(self.config.read_bytes()),self.config_sha)
        self.assertFalse((self.directory/'prior-state.json').exists())
    def test_original_preflight_rechecked_before_swap(self):
        self.prepared();self.preflight.side_effect=ValueError('old physical failure')
        with self.assertRaisesRegex(ValueError,'old physical failure'):self.t.install_pending()
        self.assertEqual(digest(self.config.read_bytes()),self.config_sha)
    def test_parent_replacement_cannot_redirect_activation(self):
        self.terminal_prepared();original=M.os.rename
        moved=self.base/'moved-etc'
        def replacing(src,dst,**kwargs):
            if dst==self.config.name:
                original(self.config.parent,moved)
                self.config.parent.mkdir(mode=0o700)
                write(self.config,b'replacement directory sentinel')
            return original(src,dst,**kwargs)
        with patch.object(M.os,'rename',side_effect=replacing):
            with self.assertRaisesRegex(ValueError,'parent directory changed'):
                self.t.install_terminal(self.c)
        self.assertEqual(self.config.read_bytes(),b'replacement directory sentinel')
    def test_writable_ancestor_rejected(self):
        self.config.parent.chmod(0o777)
        with self.assertRaisesRegex(ValueError,'Unsafe transition ancestor'):M.read(self.config)
    def old_helper(self,status):
        path=self.base/'old-package/deploy/ui-retention/lifecycle_remote.py'
        code=("class Runtime:\n"
              "    lock_fd=None\n"
              "    def status(self, frame):\n"
              "        assert frame == {'requireComplete': True}\n"
              "        assert self.lock_fd == 42\n"
              "        return "+repr(status)+"\n"
              "def installed_runtime(config, digest):\n"
              "    assert str(config) == "+repr(str(self.config))+"\n"
              "    assert digest == "+repr(self.config_sha)+"\n"
              "    return Runtime()\n").encode()
        write(path,code)
        return {'controller':{'path':str(path),'sha256':digest(code)},
                'package':{'path':str(self.base/'old-package')}}
    def test_real_old_preflight_loads_pinned_helper_under_existing_lock(self):
        self.preflight_patch.stop()
        status={'publicationHealthy':True,'retentionComplete':True,'pair':self.pair,
                'index':self.R.SOURCE_INDEX,'context':self.context}
        self.t.original_preflight(self.old_helper(status),self.state)
    def test_real_old_preflight_rejects_unhealthy_status(self):
        self.preflight_patch.stop()
        status={'publicationHealthy':True,'retentionComplete':False,'pair':self.pair,
                'index':self.R.SOURCE_INDEX,'context':self.context}
        with self.assertRaisesRegex(ValueError,'not freshly complete'):
            self.t.original_preflight(self.old_helper(status),self.state)
    def test_real_old_preflight_rejects_changed_helper_before_import(self):
        self.preflight_patch.stop()
        config=self.old_helper({})
        write(Path(config['controller']['path']),b'raise AssertionError("must not import")')
        with self.assertRaisesRegex(ValueError,'hash differs'):
            self.t.original_preflight(config,self.state)
if __name__=='__main__':unittest.main()
