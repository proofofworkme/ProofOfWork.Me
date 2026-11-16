#!/usr/bin/env python3
"""Synthetic evidence validation only; does not establish live qualification."""
import base64
import copy
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('failed_prepare_review_tested', HERE / 'failed_prepare_review.py')
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)

class PhaseTests(unittest.TestCase):
    def setUp(self):
        self.prior = {'schema': 'pow-ui-retention-lifecycle-state-v1', 'configSha256': 'a' * 64,
            'revision': 284, 'status': 'complete', 'pending': None, 'activePhase': None,
            'index': {'path': '/evidence/old-index.json', 'sha256': 'b' * 64},
            'lastCompleted': {'cycleId': 'prior-completed'}, 'lastIntent': {'path': 'untouched'}}
        self.context = {'pair': {'current': 'C', 'previous': 'B'},
                        'manifests': {'current': 'c' * 64, 'previous': 'd' * 64},
                        'guards': {'guard': 'unchanged'}}
        self.intent = {'schema': 'pow-ui-retention-phase-intent-v1', 'operation': 'prepare-cycle',
            'operationId': 'release-candidate', 'configSha256': 'a' * 64,
            'priorStateSha256': R.sha(R.encoded(self.prior)),
            'priorStateBase64': base64.b64encode(R.encoded(self.prior)).decode(),
            'context': self.context,
            'request': {'operationId': 'release-candidate',
                'expectedStateSha256': R.sha(R.encoded(self.prior)), 'expectedPair': self.context['pair']}}
        self.bind = {'path': '/evidence/ui-lifecycle-release-candidate-intent.json',
                     'sha256': R.sha(R.encoded(self.intent))}
        self.state = dict(self.prior, revision=285, status='retention-incomplete',
            activePhase={'operation': 'prepare-cycle', 'operationId': 'release-candidate', 'intent': self.bind})
        self.services = [{'MainPID': '0', 'ActiveState': 'failed', 'SubState': 'failed',
                         'Result': 'exit-code', 'ExecMainStatus': '1'} for _ in range(2)]
    def call(self, **overrides):
        args = dict(state_raw=R.encoded(self.state), intent_raw=R.encoded(self.intent),
            intent_binding=self.bind, config_sha='a' * 64, current_context=self.context,
            unfinished=[self.bind['path']], services=self.services)
        args.update(overrides)
        return R.validate_phase(**args)
    def reseal(self):
        self.bind['sha256'] = R.sha(R.encoded(self.intent))
    def test_exact_begin_transformation_is_readonly_review(self):
        before = R.encoded(self.state)
        proof = self.call()
        self.assertEqual(proof['priorState'], self.prior)
        self.assertFalse(proof['retentionComplete'])
        self.assertFalse(proof['mutationAllowed'])
        self.assertEqual(R.encoded(self.state), before)
    def test_mutation_of_any_preserved_state_field_refuses(self):
        for key in ('index', 'lastCompleted', 'lastIntent'):
            with self.subTest(key=key):
                state=copy.deepcopy(self.state);state[key]={'tampered': True}
                with self.assertRaises(ValueError): self.call(state_raw=R.encoded(state))
    def test_revisions_cannot_be_restamped(self):
        self.state['revision']=286
        with self.assertRaises(ValueError): self.call()
    def test_pending_or_success_state_refuses(self):
        for values in ({'pending': {'stage': 'prepared'}}, {'status': 'complete'}, {'activePhase': None}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                self.call(state_raw=R.encoded(dict(self.state, **values)))
    def test_active_or_unknown_process_refuses(self):
        for field,value in [('MainPID','20'),('ActiveState','active'),('ExecMainStatus','0'),('Result','timeout')]:
            with self.subTest(field=field):
                services=copy.deepcopy(self.services);services[1][field]=value
                with self.assertRaises(ValueError):self.call(services=services)
    def test_exact_two_failed_units_required(self):
        for services in ([], self.services[:1], self.services + self.services[:1]):
            with self.assertRaises(ValueError):self.call(services=services)
    def test_unknown_unit_fields_refuse(self):
        self.services[0]['unexpected']='x'
        with self.assertRaises(ValueError):self.call()
    def test_unrelated_or_missing_unfinished_intent_refuses(self):
        for value in ([], ['other'], [self.bind['path'], 'other']):
            with self.assertRaises(ValueError):self.call(unfinished=value)
    def test_wrong_intent_hash_refuses(self):
        self.bind['sha256']='0'*64
        with self.assertRaises(ValueError):self.call()
    def test_prior_raw_must_match_original_digest(self):
        self.intent['priorStateBase64']=base64.b64encode(b'{}').decode();self.reseal()
        with self.assertRaises(ValueError):self.call()
    def test_prior_active_or_pending_refuses(self):
        for values in ({'activePhase': {'operation': 'other'}}, {'pending': {'stage':'prepared'}}, {'revision':True}):
            prior=dict(self.prior, **values);self.intent['priorStateBase64']=base64.b64encode(R.encoded(prior)).decode()
            self.intent['priorStateSha256']=R.sha(R.encoded(prior));self.reseal()
            with self.assertRaises(ValueError):self.call()
    def test_request_and_guard_drift_refuses(self):
        context=copy.deepcopy(self.context);context['guards']['guard']='changed'
        with self.assertRaises(ValueError):self.call(current_context=context)
        context=copy.deepcopy(self.context);context['pair']['current']='D'
        with self.assertRaises(ValueError):self.call(current_context=context)
    def test_wrong_operation_and_config_refuses(self):
        for key,value in [('operation','apply-vps-retention'),('configSha256','e'*64)]:
            self.setUp();self.intent[key]=value;self.reseal()
            with self.assertRaises(ValueError):self.call()
    def test_wrong_request_state_refuses(self):
        self.intent['request']['expectedStateSha256']='0'*64;self.reseal()
        with self.assertRaises(ValueError):self.call()
    def test_wrong_request_operation_refuses(self):
        self.intent['request']['operationId']='blind-retry';self.reseal()
        with self.assertRaises(ValueError):self.call()
    def test_duplicate_json_key_refuses(self):
        with self.assertRaisesRegex(ValueError,'Duplicate'):self.call(state_raw=b'{"x":1,"x":2}')
    def test_wrong_intent_namespace_refuses(self):
        self.bind['path']='/evidence/another-intent.json'
        with self.assertRaises(ValueError):self.call()
    def test_normal_prepare_does_not_accept_caller_citation(self):
        import ast
        tree=ast.parse((HERE/'lifecycle_remote.py').read_text())
        method=next(n for c in tree.body if isinstance(c,ast.ClassDef) and c.name=='Runtime'
                    for n in c.body if isinstance(n,ast.FunctionDef) and n.name=='prepare_cycle')
        calls=[n for n in ast.walk(method) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute)
               and n.func.attr=='create_plan']
        self.assertEqual(len(calls),1)
        self.assertEqual([(k.arg,ast.unparse(k.value)) for k in calls[0].keywords],
                         [])

if __name__ == '__main__': unittest.main()
