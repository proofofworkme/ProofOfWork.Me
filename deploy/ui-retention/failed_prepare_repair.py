#!/usr/bin/env python3
"""Authenticate one failed Pay preparation recovery edge. No mutations.

The original failed intent is never relabelled completed. This proof seals only
its reconciliation to a prepared, still-incomplete cycle. It does not authorize
or report deletion, publication, activation, or later ordinary completion.
"""
import base64
import hashlib
import json
from pathlib import Path
import re

BASE = '/var/backups/proofofwork-ui/cleanup-evidence'
RELEASE = 'c22e585baa9d-20261116T013245Z'
JOURNAL = BASE + '/ui-lifecycle-failed-prepare-' + RELEASE
CYCLE = 'repair-' + RELEASE
CONFIG_PATH = '/etc/proofofwork-retention/ui-lifecycle.json'
STATE_PATH = '/var/lib/proofofwork-ui-retention/state.json'
PIN = {
    'release': RELEASE,
    'state': '16b67d705aa79b47c9c2691c0aea76aae395f8c8d5a56cb93db287e8ebb7d912',
    'config': '26a4bfaecd1351807e8e81dd3822de67f21aaf5435b0f1e46c7024ff02d0fa36',
    'priorState': 'fdc77f4911b21a76977a06b6fa84f0bc14f142aab0b6f7365d25d45a771b557e',
    'phaseIntent': {
        'path': BASE + '/ui-lifecycle-release-' + RELEASE + '-intent.json',
        'sha256': 'aeeb0af9d57b6ef3e588d38fd88f349e8fa848c25522d1f32c3bebd5a03d4a52'},
    'httpsReceipt': {
        'path': BASE + '/ui-lifecycle-release-' + RELEASE + '-https.json',
        'sha256': '2e210b58dc3b5aa9164965ecf0db177dee7aba3d093667529bd51bf22b1c76be'},
    'admission': {
        'path': BASE + '/audit30-policy-admission-release-' + RELEASE + '.json',
        'sha256': '3dd556e8b8de9a71495349413dc086f6b9f3d3edbff755daff654ede6d983ccf'},
    'index': {
        'path': BASE + '/audit30-policy-admission-index-release-' + RELEASE + '.json',
        'sha256': 'cbf1cd495bda62b881d2cd2a2d886f5e8ded5bf28d93e61ad6293b0226f7b40c'},
    'pair': {'current': RELEASE, 'previous': 'd5075ab88cdc-20261115T185350Z'},
    'manifest': 'f986be47dbfd0a5fc2e3ffb44f2afdaf05c5db6312b1e10304f56883127cb800',
    'outgoing': [
        '/var/backups/proofofwork-ui/releases/proofofwork-ui-release-a2a7be66bf49-20261115T031513Z.tgz',
        '/var/backups/proofofwork-ui/releases/proofofwork-ui-release-a2a7be66bf49-20261115T031513Z.tgz.provenance',
        '/var/backups/proofofwork-ui/releases/proofofwork-ui-release-a2a7be66bf49-20261115T031513Z.tgz.sha256',
        '/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-d5075ab88cdc-20261115T185350Z']}


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(ok, message):
    if not ok:
        raise ValueError(message)


def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate repair JSON key')
        result[key] = value
    return result


def canonical_read(reader, path, expected=None):
    value, digest = reader(path, expected)
    # The strict reader hashes original bytes before parsing. Historical native
    # publication JSON is pretty-printed; storage plans omit LF. Reserializing
    # either would falsely reject genuine immutable evidence.
    require(isinstance(value, dict) and isinstance(digest, str)
            and re.fullmatch('[0-9a-f]{64}', digest)
            and (expected is None or digest == expected), 'Repair evidence digest differs')
    return value, digest


def bound(reader, binding):
    require(isinstance(binding, dict) and set(binding) == {'path', 'sha256'}
            and isinstance(binding['path'], str) and isinstance(binding['sha256'], str)
            and re.fullmatch('[0-9a-f]{64}', binding['sha256']), 'Repair evidence binding differs')
    return canonical_read(reader, binding['path'], binding['sha256'])[0]


def must_be_absent(reader, path):
    try:
        reader(path)
    except FileNotFoundError:
        return
    raise ValueError('Original failed preparation acquired a fabricated result')


def pending_token(config_sha, ordinary_plan, context):
    return sha(encoded({'originalIntent': PIN['phaseIntent'], 'ordinaryPlan': ordinary_plan,
                        'configSha256': config_sha, 'cycleId': CYCLE, 'context': context}))


def verify_marker(state, read_json, *, verify_seal=True):
    """Validate the permanent marker, also after subsequent package upgrades.

read_json must be the caller's strict owner/type/link/bounded SHA reader. Missing
or malformed evidence fails; only an absent marker returns None.
"""
    marker = state.get('lastFailedPreparationRepair')
    if marker is None:
        return None
    require(isinstance(marker, dict) and set(marker) == {'intentPath', 'intentSha256', 'completionPath'}
            and marker['intentPath'] == JOURNAL + '/intent.json'
            and marker['completionPath'] == JOURNAL + '/repaired.json', 'Repair marker namespace differs')
    intent, intent_sha = canonical_read(read_json, marker['intentPath'], marker['intentSha256'])
    done, done_sha = canonical_read(read_json, marker['completionPath'])
    require(intent.get('schema') == 'pow-ui-failed-prepare-repair-intent-v1'
            and intent.get('authority') == PIN, 'Repair intent authority differs')
    plan = intent['plan']
    require(plan.get('schema') == 'pow-ui-failed-prepare-repair-plan-v1'
            and plan.get('authority') == PIN, 'Repair plan authority differs')
    prior_state, _ = canonical_read(read_json, JOURNAL + '/prior-state.json', PIN['state'])
    prior_config, _ = canonical_read(read_json, JOURNAL + '/prior-config.json', PIN['config'])
    phase = bound(read_json, PIN['phaseIntent'])
    require(phase.get('schema') == 'pow-ui-retention-phase-intent-v1'
            and phase.get('operation') == 'prepare-cycle'
            and phase.get('operationId') == 'release-' + RELEASE
            and phase.get('configSha256') == PIN['config']
            and phase.get('priorStateSha256') == PIN['priorState'], 'Original preparation intent differs')
    raw = base64.b64decode(phase['priorStateBase64'], validate=True)
    require(sha(raw) == PIN['priorState'], 'Original pre-prepare state differs')
    before_prepare = json.loads(raw, object_pairs_hook=unique)
    require(before_prepare.get('schema') == 'pow-ui-retention-lifecycle-state-v1'
            and before_prepare.get('configSha256') == PIN['config']
            and before_prepare.get('revision') == 284 and type(before_prepare['revision']) is int
            and before_prepare.get('pending') is None and not before_prepare.get('activePhase'),
            'Original preparation had pending work')
    expected_failed = dict(before_prepare, revision=285, status='retention-incomplete',
        activePhase={'operation': 'prepare-cycle', 'operationId': 'release-' + RELEASE,
                     'intent': PIN['phaseIntent']})
    require(prior_state == expected_failed, 'Failed state is not exact original begin transformation')
    before = plan['before']; context = before['context']
    require(before.get('stateSha256') == PIN['state']
            and ('state' not in before or before['state'] == prior_state)
            and before.get('index') == PIN['index']
            and before.get('httpsReceipt') == PIN['httpsReceipt']
            and context == phase['context'] and context['pair'] == PIN['pair']
            and context['manifests']['current'] == PIN['manifest'], 'Repair context differs')
    request = phase['request']
    require(request.get('expectedStateSha256') == PIN['priorState']
            and request.get('expectedPair') == PIN['pair']
            and request.get('operationId') == phase['operationId'], 'Original publication request differs')
    https = bound(read_json, PIN['httpsReceipt'])
    https_raw = base64.b64decode(request['httpsReceipt']['base64'], validate=True)
    require(sha(https_raw) == request['httpsReceipt']['sha256'] == PIN['httpsReceipt']['sha256']
            and json.loads(https_raw, object_pairs_hook=unique) == https
            and https.get('ok') is True and https.get('releaseId') == RELEASE
            and https.get('manifestSha256') == PIN['manifest'], 'Original HTTPS proof differs')
    publication = before['publication']; terminal = bound(read_json, publication)
    requested_publication = request['publicationReceipt']
    require(publication['path'] == requested_publication['path']
            and ('sha256' not in requested_publication or publication['sha256'] == requested_publication['sha256'])
            and ('value' not in requested_publication or terminal == requested_publication['value'])
            and terminal.get('releaseId') == RELEASE and terminal.get('exitCode') == 0
            and terminal.get('failure') is None, 'Original publication proof differs')
    original_index = bound(read_json, before_prepare['index'])
    index = bound(read_json, PIN['index']); admission = bound(read_json, PIN['admission'])
    require(index == dict(original_index, admissions=[*original_index['admissions'], PIN['admission']])
            and admission.get('retainedPair') == PIN['pair'], 'Original partial admission differs')
    ordinary = bound(read_json, plan['ordinaryPlan'])
    require(plan['ordinaryPlan']['path'] == JOURNAL + '/ordinary-plan.json'
            and ('ordinaryPlanValue' not in plan or plan['ordinaryPlanValue'] == ordinary)
            and ordinary.get('kind') == 'future-retention' and ordinary.get('moves') == []
            and sorted(row['path'] for row in ordinary['delete']) == PIN['outgoing']
            and sorted(row['path'] for row in ordinary['policyScope']['eligible']) == PIN['outgoing']
            and ordinary['policyScope']['admissionIndex'] == PIN['index']
            and ordinary['safeguards'] == context['guards']
            and ordinary.get('citationReview'), 'Recovered ordinary plan differs')
    rule = ordinary['privateStageRetention']; forecast = rule['forecast']
    require(rule['publicationReceiptSha256'] == publication['sha256']
            and rule['releasePlanSha256'] == terminal['planSha256']
            and forecast == terminal['privateStageRetention']
            and forecast['releaseId'] == RELEASE and forecast['wouldRetire'] == PIN['outgoing']
            and forecast['stateSha256'] == PIN['priorState']
            and forecast['index'] == before_prepare['index']
            and forecast['previousPair']['current'] == PIN['pair']['previous'],
            'Original private publication forecast differs')
    native_path = str(Path(publication['path']).parent.parent / (
        'recovery-plan-' + RELEASE + '-' + terminal['attempt'] + '.json'))
    native, _ = canonical_read(read_json, native_path, terminal['planSha256'])
    require(native.get('releaseId') == RELEASE and native.get('privateStageRetention') == forecast
            and native.get('retentionLifecycle', {}).get('config', {}).get('sha256') == PIN['config'],
            'Original native publication plan differs')
    payload = plan['payload']; config = payload['config']; config_sha = payload['configSha256']
    require(sha(encoded(config)) == config_sha and config_sha != PIN['config'], 'Successor config differs')
    mutable = {'approval', 'controller', 'package', 'sourceCommit', 'sourceTree'}
    require(set(config) == set(prior_config) and all(config[k] == prior_config[k]
            for k in prior_config if k not in mutable)
            and config['statePath'] == STATE_PATH
            and config['approval']['sha256'] == prior_config['approval']['sha256']
            and config['package']['path'] == BASE + '/ui-lifecycle-tools-' + config['package']['sha256']
            and config['controller']['path'] == config['package']['path'] + '/deploy/ui-retention/lifecycle_remote.py'
            and config['approval']['path'] == config['package']['path'] + '/audits/2026-10-16-ui-retention-repair-approval.json'
            and re.fullmatch('[0-9a-f]{40}', config['sourceCommit'])
            and re.fullmatch('[0-9a-f]{40}', config['sourceTree']), 'Successor config expands authority')
    pending = {'cycleId': CYCLE, 'token': pending_token(config_sha, plan['ordinaryPlan'], context),
        'stage': 'prepared', 'context': context, 'ordinaryPlan': plan['ordinaryPlan'],
        'httpsReceipt': PIN['httpsReceipt'], 'publicationReceipt': publication, 'index': PIN['index']}
    base_marker = {k: marker[k] for k in ('intentPath', 'completionPath')}
    expected_template = dict(prior_state, configSha256=config_sha, revision=287,
        status='retention-incomplete', pending=pending, activePhase=None, index=PIN['index'],
        lastUpgrade={}, lastFailedPreparationRepair=base_marker)
    template = intent['stateTemplate']
    require(template == expected_template and intent['stateTemplateSha256'] == sha(encoded(template)),
            'Repair prepared-state template differs')
    prepared = dict(template, lastFailedPreparationRepair=marker)
    require(done.get('schema') == 'pow-ui-failed-prepare-repaired-v1' and done.get('ok') is True
            and done.get('prepared') is True and done.get('retentionComplete') is False
            and done.get('deletionPerformed') is False and done.get('publicationPerformed') is False
            and done.get('originalPhaseEvidencePreserved') is True
            and done.get('intent') == {'path': marker['intentPath'], 'sha256': intent_sha}
            and done.get('config') == {'path': CONFIG_PATH, 'sha256': config_sha}
            and done.get('state') == {'path': STATE_PATH, 'sha256': sha(encoded(prepared))}
            and done.get('stateRevision') == 287, 'Repair terminal proof differs')
    require(type(state.get('revision')) is int and state['revision'] >= 287
            and state.get('lastPayloadRetirement') == prior_state.get('lastPayloadRetirement'),
            'Repair descendant state or retirement proof differs')
    if state['revision'] == 287:
        require(state == prepared, 'Initial repaired state differs')
    for suffix in ('-ordinary-plan.json', '-completed.json'):
        must_be_absent(read_json, BASE + '/ui-lifecycle-release-' + RELEASE + suffix)
    repair_binding = {'path': marker['completionPath'], 'sha256': done_sha}
    # Only the exact initial current-config state may use the installer's
    # internal post-switch window. Descendants/ancestors always require a seal.
    verify_seal = verify_seal or state.get('configSha256') != config_sha or state['revision'] != 287
    if verify_seal:
        verified, _ = canonical_read(read_json, JOURNAL + '/verified.json')
        require(verified == {'schema': 'pow-ui-failed-prepare-repair-verified-v1',
            'repairReceipt': repair_binding, 'config': done['config'], 'state': done['state'],
            'contextSha256': sha(encoded(context)), 'prepared': True, 'retentionComplete': False},
            'Repair post-switch prepared verification differs')
    return {'priorState': prior_state, 'priorConfig': prior_config, 'priorConfigSha256': PIN['config'],
        'sealedPhaseIntent': PIN['phaseIntent'], 'preparedState': prepared,
        'repairBinding': repair_binding, 'config': config, 'configSha256': config_sha,
        'context': context, 'ordinaryPlan': ordinary, 'plan': plan}


def verify_edge(state, config_sha, config, read_json, *, verify_seal=True):
    proof = verify_marker(state, read_json, verify_seal=verify_seal)
    if proof is None:
        return None
    if config_sha != proof['configSha256']:
        # A later independently sealed package edge must descend to this config;
        # the marker alone cannot authenticate that later edge.
        return None
    require(config == proof['config'] and state.get('configSha256') == config_sha,
            'Repair edge config differs')
    return proof
