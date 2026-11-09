#!/usr/bin/python3 -I
"""Install the separately approved native publisher floor after the complete package upgrade."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import runpy
import stat
import subprocess
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
APPROVAL = '006e5293a28f0f925d09b74abf01ad0d87cca77cfb9d7ed3c95581ac514cbfae'
GRANT = 'audits/2026-11-08-ui-publisher-capacity-floor-approval.json'
TOOLS = 'deploy/ui-stream-tools/installer.py'
LIFECYCLE = 'deploy/ui-retention/install_lifecycle.py'
FLOOR = 'deploy/ui-retention/lifecycle_remote.py'
OPER = {'tools': TOOLS, 'old': LIFECYCLE, 'floor': FLOOR}
DEVICE = 2049
OLD_INODES = {'capacity': (2586, 0o755), 'receiver': (510995, 0o600)}
FAEC = Path('/var/lib/proofofwork-ui-publisher-successor-tools/faec76840970b8e9128210d156c00e14d4195cd5')
EXISTING = Path('/var/tmp/proofofwork-deploy')
FAILED_ID = '4779af7b984e-20261109T030351Z'
sha = lambda data: hashlib.sha256(data).hexdigest()


def need(condition, message):
    if not condition:
        raise ValueError(message)


def git(*args):
    return subprocess.check_output(['/usr/bin/git', '-C', str(ROOT), *args],
        env={'PATH': '/usr/bin:/bin', 'HOME': '/root', 'LC_ALL': 'C', 'GIT_OPTIONAL_LOCKS': '0'}, timeout=30)


def committed(commit, relative):
    path = ROOT / relative
    raw = git('show', commit + ':' + relative)
    need(path.resolve(strict=True) == path and path.read_bytes() == raw, 'Uncommitted capacity control: ' + relative)
    return raw


def inputs(commit):
    need(os.geteuid() == os.getegid() == 0 and sys.flags.isolated and not sys.flags.optimize, 'Require isolated root on UI')
    need(len(commit) == 40 and git('rev-parse', 'HEAD').decode().strip() == commit
         and not git('status', '--porcelain', '--untracked-files=all'), 'Require exact clean release checkout')
    git('merge-base','--is-ancestor','4779af7b984eb25903a8aae3be0f36fbce200f13',commit)
    committed(commit, str(Path(__file__).resolve().relative_to(ROOT)))
    for relative in (*OPER.values(), 'deploy/ui-retention/lifecycle.py'):
        committed(commit, relative)
    ns = {key: SimpleNamespace(**runpy.run_path(str(ROOT / relative))) for key, relative in OPER.items()}
    runpy.run_path(str(ROOT / 'deploy/ui-retention/lifecycle.py'))['require_ui_host'](ROOT)
    grant_raw = committed(commit, GRANT)
    need(sha(grant_raw) == APPROVAL == ns['floor'].FLOOR_APPROVAL, 'Wrong capacity floor approval')
    grant = json.loads(grant_raw)
    candidates = {}
    for name, (path, previous, target) in ns['floor'].FLOOR_FILES.items():
        spec = grant['targets'][str(path)]
        raw = committed(commit, spec['source'])
        need(spec['before'] == previous and sha(raw) == spec['after'] == target, 'Unapproved capacity helper: ' + name)
        compile(raw, spec['source'], 'exec')
        candidates[name] = raw
    package = ns['old'].committed_payload(ROOT)
    need(package['manifest']['sourceCommit'] == commit, 'Installed package candidate is not from the reviewed commit')
    ns['expectedConfigSha256'] = package['configSha256']
    return ns, grant, grant_raw, candidates


def protected(runtime, grant, commit, tools, old, floor):
    base = grant['baseline']
    old.read_bound(old.CONFIG, runtime.config_sha)
    state, state_sha = runtime.state()
    upgrade = state['lastUpgrade']
    need(runtime.config['sourceCommit'] == commit and state['status'] == 'complete' and state['revision'] == 187
         and not state.get('pending') and not state.get('activePhase') and not runtime.unfinished_intents()
         and upgrade['priorConfigSha256'] == base['configSha256'] and upgrade['priorStateSha256'] == base['stateSha256']
         and state['index']['sha256'] == base['indexSha256'], 'Not the approved immediate completed package successor')
    complete_raw = old.read_bound(upgrade['completionPath'])
    complete = json.loads(complete_raw)
    need(complete['ok'] and complete['retentionComplete'] and complete['priorState']['sha256'] == base['stateSha256']
         and complete['priorConfig']['sha256'] == base['configSha256'] and complete['state']['sha256'] == state_sha,
         'Completed package receipt differs from current state')
    prior = json.loads(old.read_bound(complete['priorState']['path'], base['stateSha256']))
    need(state['completedContext'] == prior['completedContext'] and state['lastCompleted'] == prior['lastCompleted']
         and state['index'] == prior['index'] and state['lastIntent'] == prior['lastIntent'], 'Completed history changed')
    old.read_bound(prior['lastUpgrade']['completionPath'], base['completedUpgradeSha256'])
    _, ctx = runtime.current()
    need(ctx['pair'] == {'current': base['releaseId'], 'previous': base['previousReleaseId']}
         and (state['completedContext'] == ctx or runtime.completed_boot_rotation(state, state_sha, ctx)),
         'Protected pair or completed guard context differs')
    runtime.verify_vps_completion(state, ctx)
    scope = runtime.P.policy_scope(state['index'], runtime.layout, runtime.config['approval']['sha256'])
    hold = scope['preservedFallback']
    need(not scope['eligible'] and hold['snapshotSha256'] == {str(p): h for p,h in tools.SUCCESSOR_FALLBACK.items()}
         and hold['admissions'] == {k: v[1] for k,v in tools.SUCCESSOR_ADMISSIONS.items()},
         'The four physical fallback proofs or admissions changed')
    old.read_bound(FAEC / 'installed.json', base['publisherInstallSha256'])
    old.read_bound(FAEC / 'intent.json', 'a45a261cfdb19961fda5ac7c9eb6bd1caebdde2669cee39fbc15852dab20772b')
    old.read_bound(FAEC / 'qualified.json', '4a2811a871abd779ef88f8eb52bc723fbeb2d43c8eeacc168d52f0fb2cfa42cd')
    stage = EXISTING / ('recovery-transport-' + FAILED_ID + '-surfaces-stage-initial/receipt.json')
    failure = EXISTING / ('recovery-transport-' + FAILED_ID + '-source-initial/intent.json')
    old.read_bound(stage, base['preservedStageReceiptSha256']); old.read_bound(failure, base['failedSourceIntentSha256'])
    for name, inode, digest in (('stage', 141749, '0874f8689fbcd062c44a54745a049cfc44f71a54f6404fdcc65f10e80f1994ee'),
                                ('publish', 143066, tools.SUCCESSOR_AFTER)):
        helper = floor.floor_descriptor(Path('/usr/local/sbin/proofofwork-ui-release-' + name))
        need(helper['identity'][:2] == [DEVICE, inode] and helper['sha256'] == digest, 'Installed publication helper changed')
    held_aliases = {}
    for name, inode, digest in (
        ('ui-capacity.py', 549299, '50497185cc3a21016716fee71fa9888374805282015ded8bcffa8390e12d8451'),
        ('stream-ui-bundle.py', 549300, '2ed410286d6081a2b82e7ff26d9ffb9f202b0a7f0ea41d91db1ac2751f4b5914'),
    ):
        alias = floor.floor_descriptor(EXISTING / name)
        need(alias['identity'][:2] == [DEVICE, inode] and alias['sha256'] == digest, 'Held alias changed')
        held_aliases[name] = alias
    retained_guards = old.guard_inventory()
    retained_guards['files'].pop(str(floor.FLOOR_FILES['capacity'][0]))
    return {'configSha256': runtime.config_sha, 'stateSha256': state_sha, 'index': state['index'],
            'completionReceiptSha256': sha(complete_raw), 'pair': ctx['pair'], 'fallback': hold,
            'otherHelperHoldMaskInventorySha256': sha(old.encoded(retained_guards)), 'heldAliases': held_aliases,
            'publisherReceiptSha256': base['publisherInstallSha256'], 'preservedStageSha256': base['preservedStageReceiptSha256'],
            'failedIntentSha256': base['failedSourceIntentSha256']}


def position(files, intent, journal, descriptor):
    observed = {}
    for name, (path, _, _) in files.items():
        pair = intent['files'][name]
        live, saved = descriptor(path), descriptor(journal / name)
        if live == pair['before'] and saved == pair['after']:
            observed[name] = 'before'
        elif live == pair['after'] and saved == pair['before']:
            observed[name] = 'after'
        else:
            raise ValueError('Unrecognized capacity helper bytes/inodes: ' + name)
    return observed


def transition(files, intent, journal, target, tools, check):
    order = list(files) if target == 'after' else list(reversed(files))
    for name in order:
        if position(files, intent, journal, tools.descriptor)[name] != target:
            check()
            tools.exchange(files[name][0], journal / name)
            need(position(files, intent, journal, tools.descriptor)[name] == target, 'Incomplete capacity helper exchange')


def ensure_record(path, value, tools):
    if not os.path.lexists(path):
        tools.successor_record(path, value)
    need(tools.read_record(path) == value, 'Conflicting capacity migration receipt: ' + path.name)
    return tools.descriptor(path)['sha256']


def native_budget(path, evidence, floor_bytes):
    cmd = ['/usr/bin/python3', '-I', '-B', str(path), 'check', '--path', str(evidence), '--additional-bytes',
           str(1024**2), '--additional-inodes', '16', '--phase', 'ui-capacity-floor-transition']
    data = json.loads(subprocess.check_output(cmd, timeout=60))
    need(data['rootReserveBytes'] == floor_bytes and data['growthReserveBytes'] == 64*1024**2, 'Native capacity policy differs')


def operate(action, commit, tree, ns, grant, grant_raw, candidates):
    tools, old, floor = (ns[name] for name in ('tools', 'old', 'floor'))
    files, journal = floor.FLOOR_FILES, floor.FLOOR_DIRECTORY
    cfg_sha = sha(old.read_bound(old.CONFIG))
    need(cfg_sha == ns['expectedConfigSha256'], 'Upgrade to the reviewed complete lifecycle package before migration')
    runtime = old.existing_runtime(cfg_sha)
    lock = runtime.S.lock(runtime.layout)
    try:
        need(sha(old.read_bound(old.CONFIG)) == cfg_sha, 'Lifecycle config changed before locking')
        snapshot = lambda: protected(runtime, grant, commit, tools, old, floor)
        before = snapshot()
        if not os.path.lexists(journal):
            need(action == 'prepare', 'No prepared capacity migration')
            status = runtime.status({'requireComplete': True})
            need(status['stateSha256'] == before['stateSha256'] and status['verifiedPreservedFallback'] == before['fallback']
                 and 'verifiedCapacityFloor' not in status, 'Original complete status differs')
            native_budget(files['capacity'][0], runtime.layout.evidence, grant['priorRootReserveBytes'])
            tools.root_dir(journal.parent);tools.root_dir(journal)
        tools.directory(journal, private=True)
        names = set(os.listdir(journal))
        need(names <= set(files) | {'approval.json','intent.json','qualified.json','installed.json','verified.json',
                                    'reversing.json','rolled-back.json'}, 'Unexpected capacity journal entry')
        approval_file = journal / 'approval.json'
        if not os.path.lexists(approval_file):
            need(action == 'prepare' and not names, 'Missing capacity floor approval')
            tools.successor_create(approval_file, grant_raw, 0o600)
        need(tools.descriptor(approval_file)['sha256'] == APPROVAL, 'Changed capacity grant')
        intent_path = journal / 'intent.json'
        if not os.path.lexists(intent_path):
            need(action == 'prepare', 'Interrupted capacity preparation requires prepare')
            descriptors = {}
            for name, (path, old_sha, new_sha) in files.items():
                tools.directory(path.parent)
                previous = tools.descriptor(path)
                inode, mode = OLD_INODES[name]
                need(previous['sha256'] == old_sha and previous['identity'][0:2] == [DEVICE, inode]
                     and stat.S_IMODE(previous['identity'][4]) == mode and not previous['xattrs']
                     and path.stat().st_dev == journal.stat().st_dev, 'Wrong capacity predecessor: ' + name)
                staged = journal / name
                if not os.path.lexists(staged):
                    tools.successor_create(staged, candidates[name], mode)
                after = tools.descriptor(staged)
                need(after['sha256'] == new_sha and stat.S_IMODE(after['identity'][4]) == mode and not after['xattrs'],
                     'Invalid retained capacity candidate')
                descriptors[name] = {'before': previous, 'after': after}
            tools.successor_record(intent_path, {'schema': 'pow-ui-capacity-floor-intent-v1', 'approvalSha256': APPROVAL,
                'commit': commit, 'tree': tree, 'files': descriptors, 'protected': before})
        intent = tools.read_record(intent_path); intent_sha = tools.descriptor(intent_path)['sha256']
        need(intent['commit'] == commit and intent['tree'] == tree and intent['approvalSha256'] == APPROVAL
             and intent['protected'] == before and set(intent['files']) == set(files), 'Capacity intent or protected state changed')
        pos = position(files, intent, journal, tools.descriptor)
        qualify = {'schema':'pow-ui-capacity-floor-qualified-v1', 'intentSha256':intent_sha,
                   'authoritySha256': APPROVAL, 'protected': before}
        qualified = journal / 'qualified.json'
        if not os.path.lexists(qualified):
            need(action == 'prepare' and all(v == 'before' for v in pos.values()), 'Incomplete capacity qualification')
            native_budget(journal / 'capacity', runtime.layout.evidence, grant['rootReserveBytes'])
            need(snapshot() == before, 'Protected completion changed before qualification')
        qualified_sha = ensure_record(qualified, qualify, tools)
        terminal = {'schema':'pow-ui-capacity-floor-installed-v1','intentSha256':intent_sha,
                    'qualificationSha256':qualified_sha,'protected':before}
        def check():
            need(snapshot() == before, 'Protected completion changed during capacity exchange')
        installed, reversed_path = journal/'installed.json', journal/'rolled-back.json'
        reversing = journal/'reversing.json'
        if action == 'apply':
            need(not os.path.lexists(reversing) and not os.path.lexists(reversed_path), 'Capacity migration has a rollback intent')
            transition(files, intent, journal, 'after', tools, check)
            check()
            native_budget(files['capacity'][0], runtime.layout.evidence, grant['rootReserveBytes'])
            ensure_record(installed, terminal, tools)
            status = runtime.status({'requireComplete': True})
            need(status['verifiedCapacityFloor']['approvalSha256'] == APPROVAL and status['stateSha256'] == before['stateSha256']
                 and status['verifiedPreservedFallback'] == before['fallback'], 'Installed lifecycle capacity verification failed')
            ensure_record(journal/'verified.json', {'installedSha256': tools.descriptor(installed)['sha256'],
                          'capacityFloor': status['verifiedCapacityFloor'], 'protected': before}, tools)
        elif action == 'rollback':
            reversal = {'intentSha256':intent_sha,'qualificationSha256':qualified_sha}
            ensure_record(reversing, reversal, tools)
            transition(files, intent, journal, 'before', tools, check)
            check()
            native_budget(files['capacity'][0], runtime.layout.evidence, grant['priorRootReserveBytes'])
            ensure_record(reversed_path, reversal, tools)
            status = runtime.status({'requireComplete': True})
            need('verifiedCapacityFloor' not in status and status['verifiedPreservedFallback'] == before['fallback'],
                 'Original capacity floor was not restored')
        if action == 'status':
            need(os.path.lexists(installed) or os.path.lexists(reversed_path),
                 'Capacity transition is not sealed; resume apply or rollback')
            status = runtime.status({'requireComplete':True})
            need(status['verifiedPreservedFallback'] == before['fallback'], 'Fallback changed since qualification')
            if os.path.lexists(reversed_path):
                need('verifiedCapacityFloor' not in status, 'Capacity rollback authority differs')
            else:
                need(status['verifiedCapacityFloor']['approvalSha256'] == APPROVAL and os.path.lexists(journal/'verified.json'),
                     'Capacity normal verification is incomplete; resume apply')
        return {'ok': True, 'phase':action, 'commit':commit,'journal':str(journal),
                'positions': position(files, intent, journal, tools.descriptor), 'intentSha256':intent_sha,
                'qualificationSha256':qualified_sha,'installed':os.path.lexists(installed), 'rolledBack':os.path.lexists(reversed_path),
                'completeStateSha256':before['stateSha256'],'protectedFallback':before['fallback']['snapshotSha256']}
    finally:
        os.close(lock)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=('prepare','apply','status','rollback'));p.add_argument('commit')
    args=p.parse_args();os.umask(0o077)
    ns, grant, raw, candidates = inputs(args.commit)
    print(json.dumps(operate(args.action,args.commit,git('rev-parse','HEAD^{tree}').decode().strip(),ns,grant,raw,candidates)))


if __name__ == '__main__':
    main()
