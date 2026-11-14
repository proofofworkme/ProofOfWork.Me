#!/usr/bin/env python3
"""Portable synthetic authority fixtures; production pins never parameterized."""
import copy
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('receipt_context',
    Path(__file__).with_name('retirement_receipt.py'))
R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
H='1'*64

class Fixture:
    def __enter__(self):
        self.files={}
        self.layout=SimpleNamespace(live=Path('/var/www'),evidence=Path(R.BASE+'/cleanup-evidence'))
        self.pair={k:{'fields':{'release_id':v}} for k,v in R.PAIR.items()}
        self.source={'admissions':[{'path':R.BASE+'/cleanup-evidence/source-admission.json','sha256':H}],
                     'completedRetirements':[]}
        self.source_ref={'path':R.SOURCE_INDEX['path'],'sha256':R.digest(R.encoded(self.source))}
        prior_config=R.encoded({'fixture':'prior-config'})
        prior={'schema':'pow-ui-retention-lifecycle-state-v1','revision':258,
               'configSha256':R.digest(prior_config),'index':self.source_ref,
               'lastUpgrade':{'historical':'preserve'},'status':'complete','pending':None,
               'activePhase':None,'completedContext':{'pair':R.PAIR,'guards':{}},
               'lastCompleted':{'retainedPair':R.PAIR}}
        inv={'pair':R.PAIR,'allHistoricalEntriesHaveRetainedEquivalent':True,
             'inventories':[],'historicalEquivalentCopies':[]}
        restore={'uiInventoryBeforeAfterEqual':True,'staticReferencePass':True,
                 'restoredEntries':2839,
                 'scope':'isolated static archive restoration; NOT production rollback'}
        sides=[]
        for p in (R.PATHS[0],R.PATHS[2]):
            for suffix in ('.sha256','.provenance'):
                raw=('fixture'+p+suffix).encode();self.files[p+suffix]=raw
                sides.append({'path':p+suffix,'sha256':R.digest(raw)})
        proposal={'status':'PROPOSAL_ONLY_NOT_AUTHORIZED_FOR_EXECUTION',
            'selected':[{'path':p} for p in R.PATHS],'pair':R.PAIR,
            'inventorySha256':R.digest(R.encoded(inv)),
            'rehearsalReceipt':{'sha256':R.digest(R.encoded(restore))},
            'allHistoricalEntriesHaveRetainedEquivalent':True,
            'historicalUnequalCount':0,'sidecarsKeep':sides,
            'stateSha256':R.digest(R.encoded(prior))}
        pins={'PROPOSAL_SHA':R.digest(R.encoded(proposal)),
              'INVENTORY_SHA':R.digest(R.encoded(inv)),
              'RESTORE_SHA':R.digest(R.encoded(restore)),
              'PRIOR_CONFIG_SHA':R.digest(prior_config),'SOURCE_INDEX':self.source_ref}
        self.patches=[patch.object(R,k,v) for k,v in pins.items()]
        for p in self.patches:p.start()
        for name,value in [('proposal.json',proposal),('inventory.json',inv),
                           ('static-restore.json',restore),('prior-state.json',prior)]:
            self.put(name,value)
        self.files[R.EVIDENCE_DIR+'/prior-config.json']=prior_config
        self.files[self.source_ref['path']]=R.encoded(self.source)
        self.prior=prior
        self.approval_sha=self.put('owner-approval.json',{
            'schema':'pow-owner-exact-payload-retirement-approval-v1',
            'proposalSha256':R.PROPOSAL_SHA,'retiredPayloadPaths':list(R.PATHS),
            'retainedPair':R.PAIR,'permanent':True,
            'sourceMessageId':'synthetic-test-only','approvedAtUtc':'synthetic-test-only'})
        records=[]
        def event(name,data):
            records.append({'sequence':len(records),
                'previousSha256':R.digest(R.encoded(records[-1])) if records else None,
                'event':name,'data':data})
        initial=self.put('guard-initial-0.json',{'synthetic':True})
        event('prepared',{'proposalSha256':R.PROPOSAL_SHA,'inventorySha256':R.INVENTORY_SHA,
            'restoreSha256':R.RESTORE_SHA,'approvalSha256':self.approval_sha,'preflightSha256':initial,'pair':R.PAIR})
        for i,p in enumerate(R.PATHS):
            g=self.put('guard-admit-%d.json'%i,{'proposalSha256':R.PROPOSAL_SHA,
                'approvalSha256':self.approval_sha,'retainedPair':R.PAIR,'actionIndex':i,'phase':'admit'})
            f=self.put('action-%d-inventory.json'%i,{'synthetic':True})
            event('action-started',{'path':p,'index':i,'freshFenceSha256':g,'frozenInventorySha256':f})
            after=self.put('guard-after-%d.json'%i,{'synthetic':True})
            log=self.put('action-%d-removal.jsonl'%i,{'synthetic':True})
            absence=self.put('action-%d-absence.json'%i,{'path':p,'index':i,'absent':True,
                'guardSha256':after,'perEntryJournalSha256':log})
            event('action-reconciled',{'path':p,'index':i,'absenceProofSha256':absence,
                                      'preservationProofSha256':after})
        witness_pair=self.put('initial-protected-pair.json',{'synthetic':'pair'})
        witness_archives=self.put('initial-archive-proofs.json',{'synthetic':'archives'})
        protected={'completedContext':prior['completedContext'],
            'fullProtectedPairSha256':witness_pair,'fullArchiveProofsSha256':witness_archives,
            'fullProtectedPairEvidence':{'path':R.EVIDENCE_DIR+'/initial-protected-pair.json',
                                        'sha256':witness_pair},
            'fullArchiveProofsEvidence':{'path':R.EVIDENCE_DIR+'/initial-archive-proofs.json',
                                        'sha256':witness_archives}}
        final={}
        for k,n in [('finalFenceSha256','final-fence.json'),
                    ('retainedPairProofSha256','retained-pair-proof.json'),
                    ('sidecarsProofSha256','sidecars-proof.json'),
                    ('historicalEvidenceProofSha256','historical-evidence-proof.json')]:
            final[k]=self.put(n,protected if n=='retained-pair-proof.json' else {'synthetic':True})
        final['successorPolicyCodeSha256']=H
        event('completed',final)
        self.receipt={'schema':'pow-exact-payload-retirement-completed-v1',
            'proposalSha256':R.PROPOSAL_SHA,'inventorySha256':R.INVENTORY_SHA,
            'restoreSha256':R.RESTORE_SHA,'approvalSha256':self.approval_sha,'journal':records,
            'journalHeadSha256':R.digest(R.encoded(records[-1])),
            'retiredPayloadPaths':list(R.PATHS),'retirementRetainedPair':R.PAIR,
            'sourceIndex':self.source_ref,'preservedSidecars':sides,
            'preservedHistoricalEvidenceSha256':final['historicalEvidenceProofSha256'],
            'priorConfigSha256':R.PRIOR_CONFIG_SHA,'policyCodeSha256':H}
        self.binding={'mode':'complete','proposalSha256':R.PROPOSAL_SHA,
            'receipt':{'path':R.TERMINAL_PATH,'sha256':self.put('completed.json',self.receipt)},
            'priorConfigSha256':R.PRIOR_CONFIG_SHA,'sourceIndex':self.source_ref,
            'policyCodeSha256':H}
        self.patches += [patch.object(R,'read_raw_bound',self.read)]
        self.patches[-1].start()
        return self
    def put(self,name,value):
        raw=R.encoded(value);self.files[R.EVIDENCE_DIR+'/'+name]=raw;return R.digest(raw)
    def read(self,path,limit=16*1024**2):
        if str(path) not in self.files:raise FileNotFoundError(str(path))
        raw=self.files[str(path)];assert len(raw)<=limit;return raw
    def load(self):
        return R.load_verified_retirement(self.binding,self.layout,lambda layout:copy.deepcopy(self.pair))
    def replace_receipt(self):
        self.binding['receipt']['sha256']=self.put('completed.json',self.receipt)
    def transition(self,context):
        idx=copy.deepcopy(self.source);idx['payloadRetirement']=context.proof
        path=R.BASE+'/cleanup-evidence/audit30-policy-admission-index-payload-retirement-6fd05dc1e04e.json'
        self.files[path]=R.encoded(idx);binding={'path':path,'sha256':R.digest(self.files[path])}
        patchdata={'configSha256':'c'*64,'index':binding,'revision':260,
                   'lastUpgrade':{},'completedContext':self.prior['completedContext']}
        t={'schema':'pow-exact-payload-retirement-state-transition-v1',
           'priorState':{'path':R.EVIDENCE_DIR+'/prior-state.json',
                         'sha256':R.digest(R.encoded(self.prior))},
           'priorConfig':{'path':R.EVIDENCE_DIR+'/prior-config.json','sha256':R.PRIOR_CONFIG_SHA},
           'successorConfigSha256':'c'*64,'terminalReceipt':self.binding['receipt'],
           'successorIndex':binding,'statePatch':patchdata,
           'preservedLastUpgrade':self.prior['lastUpgrade']}
        b={'path':R.EVIDENCE_DIR+'/transition-completed.json',
           'sha256':self.put('transition-completed.json',t)}
        return dict(self.prior,**patchdata,lastPayloadRetirement=b)
    def __exit__(self,*unused):
        for p in reversed(self.patches):p.stop()

class TestContext(unittest.TestCase):
    def test_full_synthetic_terminal_load(self):
        with Fixture() as f:
            c=f.load();self.assertEqual(c.proof['retiredPayloadPaths'],list(R.PATHS))
            self.assertEqual(c.proof['policyCodeSha256'],H)
    def test_pending_blocks(self):
        with Fixture() as f:
            f.binding['mode']='pending'
            with self.assertRaises(ValueError):f.load()
    def test_wrong_terminal_path(self):
        with Fixture() as f:
            f.binding['receipt']['path']='/tmp/not-authority'
            with self.assertRaises(ValueError):f.load()
    def test_extra_payload_rejected(self):
        with Fixture() as f:
            f.receipt['retiredPayloadPaths'].append('/var/www');f.replace_receipt()
            with self.assertRaises(ValueError):f.load()
    def test_sidecar_omission_rejected(self):
        with Fixture() as f:
            f.receipt['preservedSidecars'].pop();f.replace_receipt()
            with self.assertRaises(ValueError):f.load()
    def test_policy_code_mismatch(self):
        with Fixture() as f:
            f.binding['policyCodeSha256']='f'*64
            with self.assertRaises(ValueError):f.load()
    def test_action_evidence_corruption_rejected(self):
        with Fixture() as f:
            f.files[R.EVIDENCE_DIR+'/action-0-inventory.json']+=b' '
            with self.assertRaises(ValueError):f.load()
    def test_missing_protected_metadata_witness_rejected(self):
        with Fixture() as f:
            del f.files[R.EVIDENCE_DIR+'/initial-protected-pair.json']
            with self.assertRaises(FileNotFoundError):f.load()
    def test_missing_owner_approval_rejected(self):
        with Fixture() as f:
            del f.files[R.EVIDENCE_DIR+'/owner-approval.json']
            with self.assertRaises(FileNotFoundError):f.load()
    def test_missing_removal_log_rejected(self):
        with Fixture() as f:
            del f.files[R.EVIDENCE_DIR+'/action-0-removal.jsonl']
            with self.assertRaises(FileNotFoundError):f.load()
    def test_partial_journal_rejected(self):
        with Fixture() as f:
            f.receipt['journal'].pop();f.replace_receipt()
            with self.assertRaises(ValueError):f.load()
    def test_source_index_corruption_rejected(self):
        with Fixture() as f:
            f.files[R.SOURCE_INDEX['path']]+=b' '
            with self.assertRaises(ValueError):f.load()
    def test_descendant_proof_remains_immutable(self):
        with Fixture() as f:
            c=f.load();old=c.proof
            index=copy.deepcopy(f.source);index['admissions'].append({'path':'new','sha256':H})
            pair={'current':'new-release','previous':R.PAIR['current']}
            c.verify_lineage(index,[{'retainedPair':R.PAIR},{'retainedPair':pair}])
            self.assertEqual(c.proof,old)
    def test_broken_descendant_rejected(self):
        with Fixture() as f:
            c=f.load();index=copy.deepcopy(f.source);index['admissions'].append({'path':'new','sha256':H})
            with self.assertRaises(ValueError):
                c.verify_lineage(index,[{'retainedPair':R.PAIR},
                    {'retainedPair':{'current':'new','previous':'wrong'}}])
    def test_source_prefix_changed_rejected(self):
        with Fixture() as f:
            c=f.load();index=copy.deepcopy(f.source);index['admissions'][0]['sha256']='f'*64
            with self.assertRaises(ValueError):c.verify_lineage(index,[{'retainedPair':R.PAIR}])
    def test_exact_initial_state_transition(self):
        with Fixture() as f:
            c=f.load();state=f.transition(c);c.verify_lifecycle_state(state,'c'*64)
    def test_historical_upgrade_not_silently_modified(self):
        with Fixture() as f:
            c=f.load();state=f.transition(c);state['lastUpgrade']={'forged':True}
            with self.assertRaises(ValueError):c.verify_lifecycle_state(state,'c'*64)
    def test_context_not_duck_typed(self):
        with self.assertRaises(ValueError):R.require_verified_retirement({'proof':True})

if __name__=='__main__':unittest.main()
