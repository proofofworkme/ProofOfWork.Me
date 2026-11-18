#!/usr/bin/env python3
"""Pure, exact publication-upgrade state-equivalence review; no mutation or I/O.

The caller MUST first authenticate `edge` with the installed, hash-verified
retirement_receipt.verify_publication_upgrade_edge(..., verify_seal=True).
This second review narrows that proof to one original native retirement plan.
It never rewrites that plan, its forecast, a receipt, or lifecycle state.
"""
import base64
import hashlib
import json

BASE = '/var/backups/proofofwork-ui'
CONFIG_PATH = '/etc/proofofwork-retention/ui-lifecycle.json'
PIN = {
    'config': '9fd09bb78089af16d1c9a9b27d07e13806aa0fc3607c03bc7452d9332de0177c',
    'package': 'f63b31e37ed986c042aad4afd74f876107d636ce4ef667b462b6159867686270',
    'controller': '842f05ac5d79029d53672753e4f83d13558ffb4d3bb3b574bd7aa9f7176bb5c3',
    'priorConfig': '7d03f9aebd4b4af32844b16644e00da90e4d1241e0fc4ee28a0a8e48079cc910',
    'priorState': 'e5e51655c12761857aabc62c329c53451976ad83fc32f22de74a0c4cefc9a844',
    'priorRevision': 315,
    'release': '9f18a0ce7032-20261118T004519Z',
    'previous': 'a4d2d88cd0b0-20261117T045327Z',
    'third': '1996225ce530-20261116T190348Z',
    'publication': 'c6b08ed6b7218dcf227150beec34c72fd387ca1be79650f79cb107b237a62116',
    'https': 'd543bba962d5ec3997aadd468c44e66625f992f9c89fe8fc75d407a202a1c5e4',
}

def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def require(ok, message):
    if not ok:
        raise ValueError(message)

def unique(pairs):
    out = {}
    for key, value in pairs:
        require(key not in out, 'Duplicate JSON key')
        out[key] = value
    return out

def parse(raw):
    require(isinstance(raw, bytes) and 0 < len(raw) <= 2 * 1024**2, 'Invalid evidence size')
    return json.loads(raw, object_pairs_hook=unique)

def approved_paths():
    archive = BASE + '/releases/proofofwork-ui-release-' + PIN['third'] + '.tgz'
    return sorted([archive + suffix for suffix in ('', '.sha256', '.provenance')] +
                  [BASE + '/rollback-roots/proofofwork-www-pre-' + PIN['previous']])

def verify_bridge(state, state_sha, config, config_sha, native_plan, rule, edge):
    """Return an explicit equivalence receipt, never alternate native inputs.

    `edge` is the output of the installed authenticated upgrade-edge verifier.
    `native_plan` and `rule` MUST be authenticated by the installed
    Runtime.private_stage_rule before this additional scope review.
    The caller must retain its deployment lock through the native preparation.
    """
    require(config_sha == PIN['config'] and sha(encoded(config)) == config_sha,
            'Current config differs')
    package_path = BASE + '/cleanup-evidence/ui-lifecycle-tools-' + PIN['package']
    require(config.get('package') == {'path': package_path, 'sha256': PIN['package']}
            and config.get('controller') == {'path': package_path + '/deploy/ui-retention/lifecycle_remote.py',
                                             'sha256': PIN['controller']}, 'Installed package differs')
    require(sha(encoded(state)) == state_sha, 'Current state hash differs')
    require(isinstance(edge, dict) and set(edge) == {'priorConfig', 'priorConfigSha256', 'priorState', 'proof'},
            'Authenticated edge result differs')
    old, old_config, proof = edge['priorState'], edge['priorConfig'], edge['proof']
    require(edge['priorConfigSha256'] == PIN['priorConfig']
            and sha(encoded(old_config)) == PIN['priorConfig']
            and sha(encoded(old)) == PIN['priorState']
            and old.get('revision') == PIN['priorRevision'], 'Original upgrade state differs')
    pair = {'current': PIN['release'], 'previous': PIN['previous']}
    prior_pair = {'current': PIN['previous'], 'previous': PIN['third']}
    require(old.get('status') == 'complete' and old.get('pending') is None
            and old.get('activePhase') is None and old.get('completedContext', {}).get('pair') == prior_pair,
            'Prior completion differs')
    upgrade = state.get('lastUpgrade', {})
    journal = BASE + '/cleanup-evidence/ui-lifecycle-upgrade-' + PIN['package']
    require(upgrade.get('preservedPublication') == PIN['release']
            and upgrade.get('priorConfigSha256') == PIN['priorConfig']
            and upgrade.get('priorStateSha256') == PIN['priorState']
            and upgrade.get('supersededCycleId') is None
            and upgrade.get('intentPath') == journal + '/intent.json'
            and upgrade.get('completionPath') == journal + '/completed.json'
            and upgrade.get('statusVerificationPath') == journal + '/verified.json',
            'Upgrade marker differs')
    expected = dict(old, configSha256=config_sha, revision=PIN['priorRevision'] + 2,
                    status='retention-incomplete', pending=None, activePhase=None, lastUpgrade=upgrade)
    require(state == expected, 'State changed beyond authenticated tooling upgrade')
    require(proof.get('context', {}).get('pair') == pair
            and proof.get('retentionComplete') is False and proof.get('deletionPerformed') is False
            and proof.get('publicationPerformed') is False, 'Upgrade publication proof differs')
    evidence = {}
    for key in ('publication', 'https'):
        raw = base64.b64decode(proof[key]['base64'], validate=True)
        require(sha(raw) == PIN[key], key + ' evidence differs')
        evidence[key] = parse(raw)
    native = native_plan
    require(isinstance(native, dict) and isinstance(rule, dict), 'Missing authenticated native rule')
    terminal, https = evidence['publication'], evidence['https']
    pub_path = '/var/tmp/proofofwork-deploy/recovery-publish-' + PIN['release'] + '-initial/receipt.json'
    https_path = BASE + '/cleanup-evidence/ui-https-' + PIN['release'] + '.json'
    publication_binding = {'path': pub_path, 'sha256': PIN['publication']}
    https_binding = {'path': https_path, 'sha256': PIN['https']}
    require(proof['publication'].get('path') == pub_path
            and proof['https'].get('path') == https_path
            and proof['publication'].get('sha256') == PIN['publication']
            and proof['https'].get('sha256') == PIN['https'], 'Receipt binding differs')
    require(native.get('releaseId') == terminal.get('releaseId') == https.get('releaseId') == PIN['release']
            and native.get('publicationAttempt') == terminal.get('attempt') == 'initial'
            and terminal.get('exitCode') == 0 and terminal.get('failure') is None and https.get('ok') is True
            and terminal.get('planSha256') == rule.get('releasePlanSha256')
            and rule.get('publicationReceiptSha256') == PIN['publication']
            and all(native.get(k) == terminal.get(k) for k in ('commit', 'tree')),
            'Native publication binding differs')
    binding = native.get('retentionLifecycle', {})
    require(binding.get('config') == {'path': CONFIG_PATH, 'sha256': PIN['priorConfig']}
            and binding.get('controller') == old_config.get('controller')
            and binding.get('pair') == prior_pair, 'Original lifecycle binding differs')
    forecast = native.get('privateStageRetention')
    require(isinstance(forecast, dict) and forecast == terminal.get('privateStageRetention') == rule.get('forecast')
            and forecast.get('releaseId') == PIN['release'] and forecast.get('previousPair') == prior_pair
            and forecast.get('stateSha256') == PIN['priorState']
            and forecast.get('index') == old.get('index') == state.get('index')
            and forecast.get('wouldRetire') == approved_paths(), 'Retirement forecast or index differs')
    return {'schema': 'pow-ui-publication-completion-equivalence-v1',
            'releaseId': PIN['release'], 'configSha256': config_sha, 'stateSha256': state_sha,
            'originalConfigSha256': PIN['priorConfig'], 'originalStateSha256': PIN['priorState'],
            'nativePlanSha256': rule['releasePlanSha256'], 'publication': publication_binding,
            'https': https_binding, 'retainedPair': pair, 'approvedPaths': approved_paths(),
            'originalForecastPreserved': True, 'stateEquivalenceVerified': True,
            'deletionPerformed': False, 'publicationPerformed': False}
