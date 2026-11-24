"""Receipt authority for the failed AMO revision 341 and its immediate, sealed successor."""
import base64
import hashlib
from types import ModuleType
import json
import os
from pathlib import Path
import re


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


AUTHORITY = {
    'schema': 'pow-ui-amo-341-recovery-authority-v1',
    'releaseId': '133a4afe34ac-20261124T103507Z',
    'commit': '133a4afe34ac4f9bc1636d50bdad1acbd876c645',
    'tree': '4d004ce564c4f8303d3cf977daaf77fa8d775250',
    'configSha256': '40fc1e2d6e145fe0b4864bb45aa807fffc0b30e78c2cb60c0a1aeb1184759da6',
    'stateSha256': '191fa3f48f4bad423f7d326865a8bb2eca5d0df50a49fabf72dd34f27837f95f',
    'packageSha256': '943beedd3d353a4503316d5af80dc516e64870da8f628bcd25aebfdaf7c6a855',
    'intentSha256': '87e3ff85f48ca52a21449267a0e721052216b0f6617e01aa693bb0edfe4ff660',
    'completedSha256': '7782caa309ed327aa17c878cd7031acde3f630bec20223910306e0ad6c4483c3',
    'failureSha256': 'c911989a917c2bf3b497e46ad9f0e0a02f3791ff8d5e0fd2d22258e3d4f01571',
    'planSha256': '1715a3d2f235a19012e903e99f9f295cc5bfeaff8cfbc5d0b1aaa1053dbaf830',
    'originConfigSha256': '201dbcf57f4f14890c1743dbf42251aec47c7f4cfdf48b62054d4466a6da2cf2',
    'historySha256': '8e6d45ff3383e5b03853ed633a75e3528c02c19a9aa0db93899046406dea720f',
    'historicalStates': 17,
    'scratchApprovalSha256': '2bde67832b5a80106d226c49081e89c3637ac7b8a21959706392a237f00c379f',
}
ROOT = Path('/var/backups/proofofwork-ui/cleanup-evidence')
FAILED_JOURNAL = ROOT / ('ui-lifecycle-upgrade-' + AUTHORITY['packageSha256'])
FAILURE = 'Retirement package upgrade chain exceeds bound'


def request():
    return {'mode': 'completed-cycle', 'configSha256': AUTHORITY['configSha256'],
            'stateSha256': AUTHORITY['stateSha256'], 'amo341Recovery': sha(encoded(AUTHORITY))}


def failed_binding():
    return {key: AUTHORITY[key] for key in ('configSha256', 'stateSha256', 'packageSha256',
            'intentSha256', 'completedSha256', 'failureSha256', 'originConfigSha256')}


def verify_failed_evidence(config, state, read_bound, lexists=None):
    """Check the exact failed terminal without issuing or deferring an ordinary status seal."""
    present = os.path.lexists if lexists is None else lexists
    require(sha(encoded(config)) == AUTHORITY['configSha256']
            and sha(encoded(state)) == AUTHORITY['stateSha256']
            and config['sourceCommit'] == AUTHORITY['commit'] and config['sourceTree'] == AUTHORITY['tree']
            and config['package']['sha256'] == AUTHORITY['packageSha256']
            and config['payloadRetirementSourceConfig']['sha256'] == AUTHORITY['originConfigSha256']
            and state['configSha256'] == AUTHORITY['configSha256'] and state['revision'] == 341,
            'Failed AMO 341 config, state or retirement origin differs')
    intent = json.loads(read_bound(FAILED_JOURNAL / 'intent.json', AUTHORITY['intentSha256']))
    done = json.loads(read_bound(FAILED_JOURNAL / 'completed.json', AUTHORITY['completedSha256']))
    failure = json.loads(read_bound(FAILED_JOURNAL / 'verification-failed.json', AUTHORITY['failureSha256']))
    require(sha(encoded(intent['plan'])) == AUTHORITY['planSha256']
            and done['intent'] == {'path': str(FAILED_JOURNAL / 'intent.json'), 'sha256': AUTHORITY['intentSha256']}
            and done['config'] == {'path': '/etc/proofofwork-retention/ui-lifecycle.json', 'sha256': AUTHORITY['configSha256']}
            and done['state'] == {'path': config['statePath'], 'sha256': AUTHORITY['stateSha256']}
            and failure == {'config': done['config'], 'state': done['state'], 'error': FAILURE,
                            'manualReconciliationRequired': True}
            and not present(FAILED_JOURNAL / 'verified.json'),
            'Failed AMO 341 receipt set differs or a historical seal appeared')
    return failed_binding()


def verify_edge(plan, config, prior_config, prior_state, read_bound, lexists=None):
    """Only the real, immediate completed-cycle successor can enter the pinned historical walk."""
    require(plan['request'] == request(), 'Unknown AMO 341 recovery request')
    before = plan['before']
    failed = verify_failed_evidence(prior_config, prior_state, read_bound, lexists)
    old_intent = json.loads(read_bound(FAILED_JOURNAL / 'intent.json', AUTHORITY['intentSha256']))
    require(before['amo341Failure'] == failed
            and before['priorStageReversal'] == old_intent['plan']['before']['priorStageReversal']
            and sha(base64.b64decode(before['configBase64'], validate=True)) == AUTHORITY['configSha256']
            and sha(base64.b64decode(before['stateBase64'], validate=True)) == AUTHORITY['stateSha256'],
            'AMO recovery review differs from the failed package and prior stage reversal')
    manifest = plan['payload']['manifest']
    package = sha(encoded(manifest))
    mutable = {'sourceCommit', 'sourceTree', 'package', 'approval', 'controller'}
    require(set(config) == set(prior_config) and all(config[k] == prior_config[k] for k in config.keys()-mutable)
            and manifest['schema'] == 'pow-ui-retention-package-v1'
            and manifest['sourceCommit'] == config['sourceCommit'] != AUTHORITY['commit']
            and manifest['sourceTree'] == config['sourceTree'] != AUTHORITY['tree']
            and all(re.fullmatch('[0-9a-f]{40}', config[k]) for k in ('sourceCommit', 'sourceTree'))
            and config['package'] == {'path': str(ROOT / ('ui-lifecycle-tools-' + package)), 'sha256': package}
            and 'deploy/ui-retention/amo_341_recovery.py' in manifest['files']
            and config['controller'] == {'path': str(Path(config['package']['path']) / 'deploy/ui-retention/lifecycle_remote.py'),
                 'sha256': manifest['files']['deploy/ui-retention/lifecycle_remote.py']['sha256']},
            'AMO recovery successor changed policy or package identity')
    package_root = Path(config['package']['path'])
    require(read_bound(package_root / 'package.json', package) == encoded(manifest),
            'Installed AMO recovery manifest differs')
    old_root = Path(prior_config['package']['path'])
    old_manifest = json.loads(read_bound(old_root / 'package.json', AUTHORITY['packageSha256']))
    additions = {'deploy/ui-retention/' + name for name in (
        'amo_341_recovery.py', 'recovery_exchange.py', 'reconcile_completed_341.py')}
    changed = {'deploy/ui-retention/' + name for name in (
        'install_lifecycle.py', 'lifecycle_remote.py', 'retirement_receipt.py')}
    changed.add('deploy/ui-scratch-capacity/successor_installer.py')
    approval_path = Path(prior_config['approval']['path']).relative_to(old_root)
    require(set(manifest['files']) == set(old_manifest['files']) | additions
            and all(manifest['files'][name] == pin for name, pin in old_manifest['files'].items() if name not in changed)
            and config['approval'] == {'path': str(package_root / approval_path), 'sha256': prior_config['approval']['sha256']}
            and manifest['files'][str(approval_path)]['sha256'] == config['approval']['sha256'],
            'AMO recovery package file scope or original approval differs')
    for name, pin in manifest['files'].items():
        require(len(read_bound(package_root / name, pin['sha256'])) == pin['bytes'],
                'AMO recovery package file differs')


def check_history(rows):
    """Bind exact canonical config/state pairs, package identities, order and origin to the rehearsal."""
    require(len(rows) == AUTHORITY['historicalStates'] and rows[-1][0] == AUTHORITY['originConfigSha256']
            and sha(encoded(rows)) == AUTHORITY['historySha256'], 'AMO 341 historical ancestry differs')


EXCHANGE_SOURCE_SHA = 'c79847a753c55d046b67c9897110cb4a8fc284a6b025bdcc58e57c69cb1df42d'


def exchange_module(read_bound):
    path = Path(__file__).with_name('recovery_exchange.py')
    raw = globals().get('_BOUND_AMO_341_EXCHANGE_SOURCE')
    if raw is None:
        raw = read_bound(path, EXCHANGE_SOURCE_SHA)
    require(isinstance(raw, bytes) and sha(raw) == EXCHANGE_SOURCE_SHA, 'AMO exchange verifier source differs')
    module = ModuleType('amo_341_exchange_receipts')
    module.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), module.__dict__)
    return module


def acceptance_digest(config, completed, native_seal_sha):
    # The writer creates this record only after installed lifecycle status has
    # checked the real pair, history, holds, capacity and native status seal.
    return sha(encoded({'schema': 'pow-ui-amo-341-ordinary-acceptance-v1',
                        'configSha256': sha(encoded(config)), 'stateSha256': completed['state']['sha256'],
                        'cycleId': completed['preservedCompletedCycleId'],
                        'contextSha256': sha(encoded(completed['completionVerification']['context'])),
                        'completedSha256': sha(encoded(completed)), 'nativeStatusSealSha256': native_seal_sha}))


def verify_exchange(config, completed, read_bound, *, checking=False, require_current_seal=True,
                    provisional=False, lexists=None):
    present = os.path.lexists if lexists is None else lexists
    mode = (checking, provisional)
    require(all(type(v) is bool for v in (checking, provisional, require_current_seal))
            and mode != (True, True) and (checking or require_current_seal), 'Invalid recovery receipt phase')
    journal = ROOT / ('ui-lifecycle-upgrade-' + config['package']['sha256'])
    custody = journal / 'exchange'
    intent = json.loads(read_bound(journal / 'intent.json', completed['intent']['sha256']))
    plan = intent['plan']
    require(plan['request'] == request() and completed['stateRevision'] == 343
            and completed['config']['sha256'] == sha(encoded(config))
            and read_bound(journal / 'completed.json', sha(encoded(completed))) == encoded(completed),
            'Recovery exchange differs from the completed package')
    accepted = exchange_module(read_bound).review_receipts(custody, sha(encoded(plan)), read_bound, present)
    phases = {'forward', 'checking'}
    if not checking:
        phases.add('verified')
    if not checking and not provisional:
        phases.add('accepted')
    require(set(accepted['receipts']) == phases, 'Recovery exchange is incomplete, conflicting or reversed')
    for role in ('config', 'state'):
        pair = accepted['prepared']['files'][role]
        require(pair['before'] == plan['before']['originalFiles'][role]
                and pair['before']['sha256'] == AUTHORITY[role + 'Sha256']
                and pair['after']['sha256'] == completed[role]['sha256'], 'Recovery custody digest differs')
        read_bound(custody / role, AUTHORITY[role + 'Sha256'])
    standard = {'schema': 'pow-ui-retention-upgrade-status-verified-v1', 'ok': True,
                'config': completed['config'], 'state': completed['state'],
                'upgradeReceipt': {'path': str(journal / 'completed.json'), 'sha256': sha(encoded(completed))},
                'preservedCompletedCycleId': completed['preservedCompletedCycleId'],
                'contextSha256': sha(encoded(intent['stateTemplate']['completedContext']))}
    seal_sha = sha(encoded(standard))
    if require_current_seal or present(journal / 'verified.json'):
        require(read_bound(journal / 'verified.json', seal_sha) == encoded(standard), 'Recovery native status seal differs')
    if 'verified' in phases:
        require(accepted['records']['verified']['verificationSha256'] == seal_sha,
                'Recovery exchange failed to bind native status')
    if 'accepted' in phases:
        require(accepted['records']['accepted']['verificationSha256'] == acceptance_digest(config, completed, seal_sha),
                'Recovery exchange ordinary verification differs')
    return accepted
