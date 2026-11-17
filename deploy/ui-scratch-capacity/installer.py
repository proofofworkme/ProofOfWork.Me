#!/usr/bin/python3 -I
"""Exact, journaled scratch-limit migration. No publication or payload deletion."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import stat
import subprocess
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
GRANT = 'audits/2026-11-17-ui-scratch-capacity-approval.json'
TOOLS = 'deploy/ui-stream-tools/installer.py'
INSTALL = 'deploy/ui-retention/install_lifecycle.py'
REMOTE = 'deploy/ui-retention/lifecycle_remote.py'
SHA = re.compile('[a-f0-9]{64}')
NAMES = {'approval.json', 'capacity', 'intent.json', 'qualified.json', 'installed.json',
         'verified.json', 'reversing.json', 'rolled-back.json', 'preverified-forward.json',
         'preverified-rollback.json', 'verification-failed.json'}
ENV = {'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent', 'LC_ALL': 'C',
       'GIT_CONFIG_SYSTEM': '/dev/null', 'GIT_CONFIG_GLOBAL': '/dev/null',
       'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_OPTIONAL_LOCKS': '0'}
sha = lambda raw: hashlib.sha256(raw).hexdigest()


def need(condition, message):
    if not condition:
        raise ValueError(message)


def git(*args):
    return subprocess.check_output(['/usr/bin/git', '-c', 'core.fsmonitor=false',
        '-c', 'core.untrackedCache=false', '-C', str(ROOT), *args], env=ENV, timeout=30)


def committed(commit, relative):
    path = ROOT / relative
    raw = git('show', commit + ':' + relative)
    need(path.resolve(strict=True) == path and path.is_file() and path.read_bytes() == raw,
         'Uncommitted migration input: ' + relative)
    return raw


def inputs(commit):
    need(os.geteuid() == os.getegid() == 0 and sys.flags.isolated and not sys.flags.optimize,
         'Require isolated root on the UI host')
    need(re.fullmatch('[a-f0-9]{40}', commit) and git('rev-parse', 'HEAD').decode().strip() == commit
         and not git('status', '--porcelain', '--untracked-files=all'), 'Require exact clean committed source')
    for relative in (str(Path(__file__).resolve().relative_to(ROOT)), TOOLS, INSTALL, REMOTE,
                     'deploy/ui-retention/lifecycle.py', GRANT):
        committed(commit, relative)
    ns = {key: SimpleNamespace(**runpy.run_path(str(ROOT / relative)))
          for key, relative in (('tools', TOOLS), ('old', INSTALL), ('floor', REMOTE))}
    runpy.run_path(str(ROOT / 'deploy/ui-retention/lifecycle.py'))['require_ui_host'](ROOT)
    raw = committed(commit, GRANT); grant = json.loads(raw); floor = ns['floor']
    need(sha(raw) == floor.SCRATCH_APPROVAL, 'Scratch approval differs')
    target = grant['target']; candidate = committed(commit, target['source'])
    need(target['path'] == str(floor.SCRATCH_CAPACITY_PATH)
         and target['beforeSha256'] == floor.SCRATCH_PRIOR_SHA
         and sha(candidate) == target['afterSha256'] == floor.SCRATCH_NEXT_SHA,
         'Scratch target differs from approval')
    compile(candidate, target['source'], 'exec')
    payload = ns['old'].committed_payload(ROOT)
    need(payload['manifest']['sourceCommit'] == commit, 'Package source differs')
    ns['manifest'] = payload['manifest']
    return ns, grant, raw, candidate


def protected(runtime, grant, commit, tree, ns):
    """Freeze actual immediate bridge state, never synthesize a successful baseline."""
    old = ns['old']; floor = ns['floor']; base = grant['preBridge']
    config_raw = old.read_bound(old.CONFIG, runtime.config_sha)
    state, state_sha = runtime.state(); state_raw = old.read_bound(runtime.state_path, state_sha)
    config = json.loads(config_raw); upgrade = state['lastUpgrade']
    need(config['sourceCommit'] == commit and config['sourceTree'] == tree
         and config['package']['sha256'] == sha(old.encoded(ns['manifest']))
         and state['revision'] == base['stateRevision'] + 2 and state['status'] == 'complete'
         and not state.get('pending') and not state.get('activePhase') and not runtime.unfinished_intents(),
         'Not the exact completed bridge package')
    need(upgrade['priorConfigSha256'] == base['configSha256']
         and upgrade['priorStateSha256'] == base['stateSha256'], 'Bridge predecessor differs')
    complete_raw = old.read_bound(upgrade['completionPath']); complete = json.loads(complete_raw)
    need(complete['ok'] is True and complete['retentionComplete'] is True
         and complete['priorConfig']['sha256'] == base['configSha256']
         and complete['priorState']['sha256'] == base['stateSha256']
         and complete['state']['sha256'] == state_sha
         and complete['config']['sha256'] == runtime.config_sha, 'Bridge completion receipt differs')
    prior = json.loads(old.read_bound(complete['priorState']['path'], base['stateSha256']))
    previous_config = json.loads(old.read_bound(complete['priorConfig']['path'], base['configSha256']))
    need(previous_config['package']['sha256'] == base['packageManifestSha256'], 'Pre-bridge package differs')
    for key in ('completedContext', 'lastCompleted', 'index', 'lastIntent'):
        need(state[key] == prior[key], 'Bridge changed completed history: ' + key)
    _, context = runtime.current()
    need(context['pair'] == base['pair'], 'Protected current/prior release changed')
    runtime.verify_vps_completion(state, context)
    guards = old.guard_inventory()
    guards['files'].pop(str(floor.SCRATCH_CAPACITY_PATH))
    return {'configSha256': runtime.config_sha, 'stateSha256': state_sha,
            'index': state['index'], 'lastCompleted': state['lastCompleted'],
            'completedContext': state['completedContext'], 'pair': context['pair'],
            'otherGuardsSha256': sha(old.encoded(guards)),
            'bridgeConfig': {'base64': base64.b64encode(config_raw).decode(), 'sha256': sha(config_raw)},
            'bridgeState': {'base64': base64.b64encode(state_raw).decode(), 'sha256': state_sha},
            'completedUpgrade': {'path': upgrade['completionPath'], 'sha256': sha(complete_raw)}}


def position(path, journal, intent, descriptor):
    pair = intent['files']['capacity']
    live, staged = descriptor(path), descriptor(journal / 'capacity')
    if live == pair['before'] and staged == pair['after']:
        return 'before'
    if live == pair['after'] and staged == pair['before']:
        return 'after'
    raise ValueError('Unrecognized scratch helper bytes, metadata or inode position')


def record(path, value, tools, checkpoint):
    if not os.path.lexists(path):
        tools.successor_record(path, value)
        checkpoint(path.name)
    need(tools.read_record(path) == value, 'Conflicting scratch receipt: ' + path.name)
    return tools.descriptor(path)['sha256']


def native_budget(path, evidence, grant):
    result = subprocess.check_output(['/usr/bin/python3', '-I', '-B', str(path), 'check',
        '--path', str(evidence), '--additional-bytes', str(1024**2), '--additional-inodes', '16',
        '--phase', 'ui-scratch-capacity-transition'], env=ENV, timeout=60)
    value = json.loads(result)
    for key in ('rootReserveBytes', 'growthReserveBytes'):
        need(value[key] == grant['unchangedLimits'][key], 'Native reserve differs: ' + key)


def rollback_budget(grant):
    """Rollback must refuse existing allocation above the old limit; never delete it."""
    path = Path('/var/tmp/proofofwork-deploy'); before = path.lstat()
    need(path.resolve(strict=True) == path and stat.S_ISDIR(before.st_mode), 'Unsafe scratch directory')
    output = subprocess.check_output(['/usr/bin/du', '--one-file-system', '--summarize',
        '--block-size=1', '--', str(path)], env=ENV, timeout=60).decode().strip().split('\t')
    need(len(output) == 2 and output[1] == str(path) and output[0].isascii() and output[0].isdecimal()
         and path.lstat() == before, 'Scratch allocation changed during measurement')
    need(int(output[0]) <= grant['priorScratchBytes'], 'Rollback refuses scratch above the old 5 GiB limit')


def operate(action, commit, tree, ns, grant, grant_raw, candidate, checkpoint=lambda name: None):
    need(action in ('prepare', 'apply', 'reconcile', 'rollback', 'status'), 'Unknown migration action')
    tools, old, floor = (ns[name] for name in ('tools', 'old', 'floor'))
    path, journal = floor.SCRATCH_CAPACITY_PATH, floor.SCRATCH_DIRECTORY
    need(sha(grant_raw) == floor.SCRATCH_APPROVAL and sha(candidate) == floor.SCRATCH_NEXT_SHA,
         'Unapproved migration input')
    runtime = old.existing_runtime(sha(old.read_bound(old.CONFIG)))
    lock = runtime.S.lock(runtime.layout)
    try:
        runtime.lock_fd = lock
        # A later completed publication may legitimately advance state. Status authenticates
        # the sealed historical baseline but must not require it to remain current forever.
        if action == 'status':
            authority = floor.scratch_capacity_position(runtime.layout)
            need(authority is not None, 'Scratch migration has no sealed journal')
            return {'ok': True, 'phase': action, 'authority': authority,
                    'status': runtime.status({'requireComplete': True})}
        snapshot = lambda: protected(runtime, grant, commit, tree, ns)
        baseline = snapshot()
        if not os.path.lexists(journal):
            need(action == 'prepare', 'Prepare the exact scratch migration first')
            runtime.status({'requireComplete': True})
            native_budget(path, runtime.layout.evidence, grant)
            tools.root_dir(journal.parent); checkpoint('journal-parent')
            tools.root_dir(journal); checkpoint('journal')
        tools.directory(journal, private=True)
        need(set(os.listdir(journal)) <= NAMES, 'Foreign scratch journal entry')
        approval_path = journal / 'approval.json'
        if not os.path.lexists(approval_path):
            need(action == 'prepare' and not os.listdir(journal), 'Missing scratch approval')
            tools.successor_create(approval_path, grant_raw, 0o600); checkpoint('approval.json')
        need(tools.descriptor(approval_path)['sha256'] == floor.SCRATCH_APPROVAL, 'Changed approval')
        intent_path = journal / 'intent.json'
        if not os.path.lexists(intent_path):
            need(action == 'prepare', 'Interrupted preparation requires prepare')
            before = floor.floor_descriptor(path)
            need(before['sha256'] == floor.SCRATCH_PRIOR_SHA and not before['xattrs'], 'Unexpected predecessor')
            mode = stat.S_IMODE(before['identity'][4])
            need(mode == 0o755 and before['identity'][2:4] == [0, 0] and before['identity'][5] == 1,
                 'Unsafe predecessor metadata')
            staged = journal / 'capacity'
            if not os.path.lexists(staged):
                tools.successor_create(staged, candidate, mode); checkpoint('capacity')
            after = floor.floor_descriptor(staged)
            need(after['sha256'] == floor.SCRATCH_NEXT_SHA and not after['xattrs']
                 and after['identity'][0] == before['identity'][0]
                 and after['identity'][2:6] == before['identity'][2:6], 'Unsafe staged helper')
            record(intent_path, {'schema': 'pow-ui-scratch-capacity-intent-v1',
                'approvalSha256': floor.SCRATCH_APPROVAL, 'commit': commit, 'tree': tree,
                'files': {'capacity': {'before': before, 'after': after}}, 'protected': baseline}, tools, checkpoint)
        intent = tools.read_record(intent_path); intent_sha = tools.descriptor(intent_path)['sha256']
        need(set(intent) == {'schema','approvalSha256','commit','tree','files','protected'}
             and intent['schema'] == 'pow-ui-scratch-capacity-intent-v1'
             and intent['approvalSha256'] == floor.SCRATCH_APPROVAL and intent['commit'] == commit
             and intent['tree'] == tree and intent['protected'] == baseline
             and set(intent['files']) == {'capacity'}, 'Changed scratch intent or bridge baseline')
        pair = intent['files']['capacity']
        need(set(pair) == {'before','after'} and pair['before']['sha256'] == floor.SCRATCH_PRIOR_SHA
             and pair['after']['sha256'] == floor.SCRATCH_NEXT_SHA, 'Intent helper digests differ')
        for entry in pair.values():
            need(set(entry) == {'sha256','identity','xattrs'} and not entry['xattrs']
                 and len(entry['identity']) == 8 and entry['identity'][2:4] == [0,0]
                 and stat.S_ISREG(entry['identity'][4]) and stat.S_IMODE(entry['identity'][4]) == 0o755
                 and entry['identity'][5] == 1, 'Intent helper metadata differs')
        need(pair['before']['identity'][0] == pair['after']['identity'][0]
             and pair['before']['identity'][1] != pair['after']['identity'][1], 'Intent inode identities differ')
        pos = lambda: position(path, journal, intent, floor.floor_descriptor)
        pos()
        def check():
            runtime.S.require_execution_lock(lock, runtime.layout)
            need(snapshot() == baseline, 'Protected migration baseline changed')
            floor._capacity_floor_authority_original(runtime.layout, intent['files']['capacity']['before'])
        qualification = {'schema': 'pow-ui-scratch-capacity-qualified-v1', 'intentSha256': intent_sha,
                         'authoritySha256': floor.SCRATCH_APPROVAL, 'protected': baseline}
        qualified = journal / 'qualified.json'
        if not os.path.lexists(qualified):
            need(action == 'prepare' and pos() == 'before', 'Incomplete qualification; resume prepare')
            native_budget(journal / 'capacity', runtime.layout.evidence, grant); check()
        qualified_sha = record(qualified, qualification, tools, checkpoint)
        floor.scratch_capacity_position(runtime.layout, allow_pending=True)
        installed = {'schema': 'pow-ui-scratch-capacity-installed-v1', 'intentSha256': intent_sha,
                     'qualificationSha256': qualified_sha, 'protected': baseline}
        reversal = {'schema': 'pow-ui-scratch-capacity-reversal-v1', 'intentSha256': intent_sha,
                    'qualificationSha256': qualified_sha, 'protected': baseline}
        reversing, rolled = journal / 'reversing.json', journal / 'rolled-back.json'
        def preverify(phase):
            try:
                status = runtime.scratch_migration_status(intent_sha)
                need(status['ok'] is True and status['stateSha256'] == baseline['stateSha256']
                     and status['configSha256'] == baseline['configSha256']
                     and status['pair'] == baseline['pair'] and status['context'] == baseline['completedContext']
                     and 'scratchCapacity' not in status['binding']
                     and status['publicationHealthy'] is True and status['retentionComplete'] is True
                     and status['unfinishedIntents'] == [] and 'verifiedScratchCapacity' not in status,
                     'Pending verification does not prove the exact completed baseline')
                check()
            except Exception as error:
                failure = {'schema':'pow-ui-scratch-capacity-verification-failed-v1',
                           'intentSha256':intent_sha,'phase':phase,'errorType':type(error).__name__}
                failure_path = journal/'verification-failed.json'
                if not os.path.lexists(failure_path):
                    record(failure_path, failure, tools, checkpoint)
                raise
            preverified = journal/('preverified-'+phase+'.json')
            value = {'schema':'pow-ui-scratch-capacity-preverified-v1','intentSha256':intent_sha,
                     'protected':baseline,'status':status}
            if os.path.lexists(preverified):
                # Re-run all current assertions, but preserve the first observation.
                # Free-space counters may legitimately change between retries.
                saved = tools.read_record(preverified)
                need(set(saved) == set(value) and all(saved[k] == value[k] for k in
                     ('schema','intentSha256','protected')) and saved['status']['stateSha256'] == baseline['stateSha256']
                     and saved['status']['publicationHealthy'] is True and saved['status']['retentionComplete'] is True
                     and saved['status']['unfinishedIntents'] == [] and 'verifiedScratchCapacity' not in saved['status'],
                     'Conflicting pending verification evidence')
                return tools.descriptor(preverified)['sha256']
            return record(preverified, value, tools, checkpoint)
        if action in ('apply', 'reconcile'):
            need(not os.path.lexists(journal/'verification-failed.json'),
                 'Prior verification failed; explicit rollback required')
            need(not os.path.lexists(reversing) and not os.path.lexists(rolled), 'Reversal already requested; resume rollback')
            if pos() != 'after':
                check(); tools.exchange(path, journal / 'capacity'); checkpoint('exchange-after')
            need(pos() == 'after', 'Exchange incomplete'); check()
            native_budget(path, runtime.layout.evidence, grant)
            installed_sha = record(journal / 'installed.json', installed, tools, checkpoint)
            pending_sha = preverify('forward')
            record(journal / 'verified.json', {'schema':'pow-ui-scratch-capacity-verified-v1',
                'intentSha256':intent_sha,'installedSha256':installed_sha,'protected':baseline,
                'pendingStatusSha256':pending_sha}, tools, checkpoint)
        elif action == 'rollback':
            rollback_budget(grant); check()
            record(reversing, reversal, tools, checkpoint)
            if pos() != 'before':
                rollback_budget(grant); check(); tools.exchange(path, journal / 'capacity'); checkpoint('exchange-before')
            need(pos() == 'before', 'Reverse exchange incomplete'); check()
            native_budget(path, runtime.layout.evidence, grant)
            pending_sha = preverify('rollback')
            record(rolled, dict(reversal,pendingStatusSha256=pending_sha), tools, checkpoint)
        return {'ok': True, 'phase': action, 'qualification': 'prepared' if action == 'prepare' else 'migration-sealed',
                'normalStatusRequired': True, 'position': pos(), 'intentSha256': intent_sha,
                'journal': str(journal), 'baselineStateSha256': baseline['stateSha256']}
    finally:
        runtime.lock_fd = None
        os.close(lock)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('prepare','apply','reconcile','rollback','status'))
    parser.add_argument('commit'); args = parser.parse_args(); os.umask(0o077)
    ns, grant, raw, candidate = inputs(args.commit)
    print(json.dumps(operate(args.action,args.commit,git('rev-parse','HEAD^{tree}').decode().strip(),
                             ns,grant,raw,candidate)))


if __name__ == '__main__':
    main()
