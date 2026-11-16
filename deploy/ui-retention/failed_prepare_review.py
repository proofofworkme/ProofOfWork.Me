#!/usr/bin/env python3
"""Read-only evidence qualification for a stranded prepare-cycle.

This module does not clear, replace or advance state, install code, remove data,
or authorize a retry. A verified result is an input to a separately reviewed
operator transition, not a completed retention receipt.
"""
import base64
import hashlib
import json
from pathlib import Path

SCHEMA = 'pow-ui-failed-prepare-review-v1'

def require(ok, message):
    if not ok:
        raise ValueError(message)

def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def unique(pairs):
    out = {}
    for key, value in pairs:
        require(key not in out, 'Duplicate JSON key')
        out[key] = value
    return out

def parse(raw):
    require(isinstance(raw, bytes) and len(raw) <= 64 * 1024**2, 'Invalid or oversized evidence')
    return json.loads(raw, object_pairs_hook=unique)

def validate_phase(state_raw, intent_raw, intent_binding, config_sha, current_context,
                   unfinished, services):
    """Authenticate the exact begin() transformation without mutating anything.

The caller must read state/config through the installed runtime and bind all
raw inputs to a reviewed plan. Caller-supplied observations do not constitute
independent production verification; qualify() obtains them itself.
"""
    state = parse(state_raw)
    intent = parse(intent_raw)
    require(set(intent_binding) == {'path', 'sha256'} and sha(intent_raw) == intent_binding['sha256'],
            'Intent digest differs')
    require(intent.get('schema') == 'pow-ui-retention-phase-intent-v1'
            and intent.get('operation') == 'prepare-cycle'
            and intent.get('configSha256') == config_sha, 'Not an authenticated preparation intent')
    operation = intent['operationId']
    require(Path(intent_binding['path']).name == 'ui-lifecycle-' + operation + '-intent.json',
            'Intent namespace differs')
    require(state.get('schema') == 'pow-ui-retention-lifecycle-state-v1'
            and state.get('configSha256') == config_sha
            and state.get('status') == 'retention-incomplete'
            and state.get('pending') is None, 'Not a stranded preparation state')
    prior_raw = base64.b64decode(intent['priorStateBase64'], validate=True)
    require(sha(prior_raw) == intent['priorStateSha256'], 'Prior state digest differs')
    prior = parse(prior_raw)
    require(prior.get('configSha256') == config_sha and type(prior.get('revision')) is int
            and prior.get('index') and prior.get('pending') is None and not prior.get('activePhase'),
            'Prior state was not ready to prepare')
    expected = dict(prior, revision=prior['revision'] + 1, status='retention-incomplete',
                    activePhase={'operation': 'prepare-cycle', 'operationId': operation,
                                 'intent': intent_binding})
    require(state == expected, 'State differs from exact begin transformation')
    request = intent['request']
    require(request.get('expectedStateSha256') == intent['priorStateSha256']
            and request.get('operationId') == operation
            and request.get('expectedPair') == current_context['pair']
            and intent['context'] == current_context, 'Publication pair, guards or request changed')
    require(unfinished == [intent_binding['path']], 'Unrelated unfinished phase exists')
    required = {'MainPID': '0', 'ActiveState': 'failed', 'SubState': 'failed',
                'Result': 'exit-code', 'ExecMainStatus': '1'}
    require(len(services) == 2 and all(row == required for row in services),
            'Original phase is not terminal failed')
    return {'schema': SCHEMA, 'stateSha256': sha(state_raw), 'intent': intent_binding,
            'priorStateSha256': sha(prior_raw), 'priorState': prior,
            'operationId': operation, 'context': current_context,
            'retentionComplete': False, 'mutationAllowed': False}

def qualify(runtime, module, expected_state_sha, expected_intent, terminal_observer):
    """Read-only qualifier; caller must hold the installed deployment lock.

terminal_observer is fixed by the reviewed operator, never supplied by a wire
frame. It must inspect the two original systemd units, not replacement jobs.
"""
    runtime.S.require_execution_lock(runtime.lock_fd, runtime.layout)
    state, state_sha = runtime.state()
    require(state_sha == expected_state_sha, 'Reviewed failed state changed')
    binding = state.get('activePhase', {}).get('intent')
    require(binding == expected_intent, 'Reviewed failed intent changed')
    # Reuse installed strict readers, including owner/type/link/size checks.
    require(Path(binding['path']).parent == runtime.layout.evidence, 'Intent outside lifecycle evidence')
    state_raw, _ = module.read(runtime.state_path, expected_state_sha)
    intent_raw, _ = module.read(binding['path'], binding['sha256'])
    pair, context = runtime.current()
    proof = validate_phase(state_raw, intent_raw, binding, runtime.config_sha,
                           context, runtime.unfinished_intents(), terminal_observer())
    intent = parse(intent_raw)
    request = intent['request']
    https, https_raw = module.embedded(request['httpsReceipt'])
    publication = runtime.verify_publication(https, request['publicationReceipt'], pair, context)
    rule = runtime.private_stage_rule(publication)
    require(rule and rule['forecast']['stateSha256'] == proof['priorStateSha256']
            and rule['forecast']['index'] == proof['priorState']['index']
            and rule['forecast']['previousPair']['current'] == context['pair']['previous'],
            'Original publication forecast differs')
    prefix = runtime.layout.evidence / ('ui-lifecycle-' + proof['operationId'])
    for suffix in ('-ordinary-plan.json', '-completed.json'):
        require(not __import__('os').path.lexists(str(prefix) + suffix),
                'Preparation advanced beyond reviewed failure point')
    saved_https, _ = module.read(str(prefix) + '-https.json', request['httpsReceipt']['sha256'])
    require(saved_https == https_raw, 'Saved HTTPS evidence differs from original raw receipt')
    admission = runtime.layout.evidence / ('audit30-policy-admission-' + proof['operationId'] + '.json')
    index_path = runtime.layout.evidence / ('audit30-policy-admission-index-' + proof['operationId'] + '.json')
    admission_raw, admission_sha = module.read(admission)
    index_raw, index_sha = module.read(index_path)
    before = runtime.load_index(proof['priorState']['index']['path'], proof['priorState']['index']['sha256'])
    candidate = parse(index_raw)
    require(candidate == dict(before['index'], admissions=[*before['index']['admissions'],
                {'path': str(admission), 'sha256': admission_sha}]),
            'Prepared index is not the exact single admission extension')
    index = {'path': str(index_path), 'sha256': index_sha}
    verified = runtime.load_index(str(index_path), index_sha)
    require(verified['admissions'][-1]['retainedPair'] == context['pair'], 'Admission pair differs')
    scope = runtime.policy_scope(index)
    require(sorted(row['path'] for row in scope['eligible']) == rule['forecast']['wouldRetire'],
            'Retirement scope differs from published approval')
    runtime.S.compare_guards(runtime.layout, context['guards'], [])
    require(runtime.state()[1] == state_sha, 'State changed during qualification')
    runtime.S.require_execution_lock(runtime.lock_fd, runtime.layout)
    return dict(proof, publication=publication, publicationRule=rule, index=index,
                admission={'path': str(admission), 'sha256': admission_sha},
                noOrdinaryPlanObserved=True, terminalFailureObserved=True)
