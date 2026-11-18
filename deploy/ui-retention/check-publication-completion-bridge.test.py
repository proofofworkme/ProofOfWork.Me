#!/usr/bin/env python3
"""Synthetic pure proof tests, not production or native filesystem qualification."""
import base64
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('bridge_tested', Path(__file__).with_name('publication_completion_bridge.py'))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)

class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.original = copy.deepcopy(B.PIN)
        pkg = B.BASE + '/cleanup-evidence/ui-lifecycle-tools-' + B.PIN['package']
        prior_config = {'controller': {'path': '/original/controller.py', 'sha256': 'a'*64}, 'policy': 'unchanged'}
        B.PIN['priorConfig'] = B.sha(B.encoded(prior_config))
        prior_pair = {'current': B.PIN['previous'], 'previous': B.PIN['third']}
        old = {'revision': B.PIN['priorRevision'], 'configSha256': B.PIN['priorConfig'],
               'status': 'complete', 'pending': None, 'activePhase': None,
               'completedContext': {'pair': prior_pair}, 'index': {'path': '/original/index', 'sha256': 'b'*64},
               'lastIntent': {'path': '/original/intent'}, 'lastCompleted': {'cycleId': 'original'},
               'lastUpgrade': {'prior': 'preserved'}, 'lastPayloadRetirement': {'proof': 'preserved'}}
        B.PIN['priorState'] = B.sha(B.encoded(old))
        config = {'package': {'path': pkg, 'sha256': B.PIN['package']},
                  'controller': {'path': pkg + '/deploy/ui-retention/lifecycle_remote.py', 'sha256': B.PIN['controller']},
                  'policy': 'unchanged'}
        B.PIN['config'] = B.sha(B.encoded(config))
        journal = B.BASE + '/cleanup-evidence/ui-lifecycle-upgrade-' + B.PIN['package']
        upgrade = {'preservedPublication': B.PIN['release'], 'priorConfigSha256': B.PIN['priorConfig'],
                   'priorStateSha256': B.PIN['priorState'], 'supersededCycleId': None,
                   'intentPath': journal+'/intent.json', 'completionPath': journal+'/completed.json',
                   'statusVerificationPath': journal+'/verified.json', 'intentSha256': 'c'*64}
        state = dict(old, configSha256=B.PIN['config'], revision=317, status='retention-incomplete', lastUpgrade=upgrade)
        forecast = {'releaseId': B.PIN['release'], 'previousPair': prior_pair, 'stateSha256': B.PIN['priorState'],
                    'index': old['index'], 'wouldRetire': B.approved_paths()}
        native = {'releaseId': B.PIN['release'], 'publicationAttempt': 'initial', 'commit': 'd'*40, 'tree': 'e'*40,
                  'retentionLifecycle': {'config': {'path': B.CONFIG_PATH, 'sha256': B.PIN['priorConfig']},
                                         'controller': prior_config['controller'], 'pair': prior_pair},
                  'privateStageRetention': forecast}
        terminal = {'releaseId': B.PIN['release'], 'attempt': 'initial', 'commit': 'd'*40, 'tree': 'e'*40,
                    'exitCode': 0, 'failure': None, 'planSha256': B.sha(B.encoded(native)), 'privateStageRetention': forecast}
        https = {'releaseId': B.PIN['release'], 'ok': True}
        def envelope(value, path):
            raw = B.encoded(value)
            return {'base64': base64.b64encode(raw).decode(), 'path': path, 'sha256': B.sha(raw)}
        pub = envelope(terminal, '/var/tmp/proofofwork-deploy/recovery-publish-'+B.PIN['release']+'-initial/receipt.json')
        hp = envelope(https, B.BASE+'/cleanup-evidence/ui-https-'+B.PIN['release']+'.json')
        B.PIN['publication'], B.PIN['https'] = pub['sha256'], hp['sha256']
        edge = {'priorConfig': prior_config, 'priorConfigSha256': B.PIN['priorConfig'], 'priorState': old,
                'proof': {'publication': pub, 'https': hp, 'context': {'pair': {'current': B.PIN['release'], 'previous': B.PIN['previous']}},
                          'retentionComplete': False, 'deletionPerformed': False, 'publicationPerformed': False}}
        self.args = {'state': state, 'state_sha': B.sha(B.encoded(state)), 'config': config, 'config_sha': B.PIN['config'],
                     'native_plan': native, 'rule': {'releasePlanSha256': terminal['planSha256'],
                                                    'publicationReceiptSha256': B.PIN['publication'], 'forecast': forecast}, 'edge': edge}
    def tearDown(self):
        B.PIN.clear(); B.PIN.update(self.original)
    def verify(self, args=None):
        return B.verify_bridge(**(args or self.args))
    def reject(self, mutation, update_state_hash=False):
        args = copy.deepcopy(self.args); mutation(args)
        if update_state_hash: args['state_sha'] = B.sha(B.encoded(args['state']))
        with self.assertRaises((ValueError, KeyError, TypeError)):
            self.verify(args)
    def test_exact_sealed_edge_preserves_all_inputs(self):
        before = copy.deepcopy(self.args); result = self.verify()
        self.assertEqual(self.args, before)
        self.assertTrue(result['stateEquivalenceVerified'])
        self.assertTrue(result['originalForecastPreserved'])
        self.assertFalse(result['deletionPerformed'])
        self.assertEqual(result['approvedPaths'], B.approved_paths())
    def test_config_package_controller_mismatch_refused(self):
        self.reject(lambda a: a.update(config_sha='f'*64))
        self.reject(lambda a: a['config']['package'].update(sha256='f'*64))
        self.reject(lambda a: a['config']['controller'].update(sha256='f'*64))
        self.reject(lambda a: a['native_plan']['retentionLifecycle']['config'].update(sha256='f'*64))
    def test_evolved_or_rebound_state_refused(self):
        self.reject(lambda a: a.update(state_sha='f'*64))
        for field, value in [('revision',318),('pending',{}),('activePhase',{}),('status','complete'),
                             ('lastIntent',{}),('lastPayloadRetirement',{}),('lastCompleted',{}),('unexpected',True)]:
            self.reject(lambda a, f=field,v=value: a['state'].__setitem__(f,v), True)
        self.reject(lambda a: a['state']['lastUpgrade'].update(priorStateSha256='f'*64), True)
        self.reject(lambda a: a['state']['lastUpgrade'].update(preservedPublication='other'), True)
    def test_receipt_bytes_bindings_and_native_plan_hash_refused(self):
        for key in ['publication','https']:
            self.reject(lambda a,k=key: a['edge']['proof'][k].update(base64=base64.b64encode(b'{}').decode()))
            self.reject(lambda a,k=key: a['edge']['proof'][k].update(path='/wrong/receipt'))
            self.reject(lambda a,k=key: a['edge']['proof'][k].update(sha256='f'*64))
        self.reject(lambda a: a['rule'].update(releasePlanSha256='f'*64))
        self.reject(lambda a: a['rule'].update(publicationReceiptSha256='f'*64))
        self.reject(lambda a: a['native_plan'].update(commit='f'*40))
    def test_missing_extra_reordered_or_different_paths_refused(self):
        for paths in [B.approved_paths()[:-1],B.approved_paths()+['/extra'],list(reversed(B.approved_paths())),['/wrong']]:
            self.reject(lambda a,p=paths: a['native_plan']['privateStageRetention'].update(wouldRetire=p))
    def test_index_and_original_evidence_refused(self):
        self.reject(lambda a: a['state'].update(index={'path':'/wrong'}), True)
        self.reject(lambda a: a['edge']['priorState'].update(index={'path':'/wrong'}))
        self.reject(lambda a: a['native_plan']['privateStageRetention'].update(index={'path':'/wrong'}))
        self.reject(lambda a: a['edge']['priorConfig'].update(policy='changed'))
        self.reject(lambda a: a['edge']['proof']['context'].update(pair={'current':'other','previous':'other'}))
        self.reject(lambda a: a['edge']['proof'].update(deletionPerformed=True))

class NativeBodyTests(unittest.TestCase):
    def test_native_prepare_tail_and_read_guards_are_preserved(self):
        import ast
        here=Path(__file__).parent
        old=ast.parse((here/'lifecycle_remote.py').read_text())
        new=ast.parse((here/'reconcile_publication_completion.py').read_text())
        a=next(n for n in ast.walk(old) if isinstance(n,ast.FunctionDef) and n.name=='prepare_cycle')
        b=next(n for n in ast.walk(new) if isinstance(n,ast.FunctionDef) and n.name=='prepare_cycle')
        dump=lambda nodes:[ast.dump(n,include_attributes=False) for n in nodes]
        self.assertEqual(dump(a.body[:6]),dump(b.body[:6]))
        self.assertIn('self.bridge_proof(state, state_sha, rule)',ast.unparse(b.body[6]))
        self.assertIn("context['pair'] == proof['retainedPair']",ast.unparse(b.body[7]))
        def index(nodes):
            return next(i for i,n in enumerate(nodes) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='index' for t in n.targets))
        tail=b.body[index(b.body):]
        pos=next(i for i,n in enumerate(tail) if isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Attribute) and n.value.func.attr=='evidence')
        self.assertEqual(ast.unparse(tail[pos-1]),'self.capacity(65536)')
        self.assertEqual(ast.unparse(tail[pos]),"self.evidence('publication-completion-bridge-9f18-v1.json', proof)")
        self.assertEqual(dump(a.body[index(a.body):]),dump(tail[:pos-1]+tail[pos+1:]))

if __name__ == '__main__': unittest.main()
