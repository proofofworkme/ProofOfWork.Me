"""Verify the installed UI retention obligation before accepting publication input."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat

CONFIG = '/etc/proofofwork-retention/ui-lifecycle.json'
STATE = '/var/lib/proofofwork-ui-retention/state.json'
PACKAGE = '/var/backups/proofofwork-ui/cleanup-evidence/ui-lifecycle-tools-'
MODEL = 'private-stage-zero-retirement-v1'



def reviewed_forecast(rule):
    if not isinstance(rule, dict):
        return False
    if rule.get('model') == 'private-stage-zero-retirement-v1':
        return rule.get('wouldRetire') == []
    # Exact user-reviewed transitions only; never infer authority for the next pair.
    pair = rule.get('previousPair')
    approved = (
        ('69c31f4e1dcd-20261109T051556Z', '54088ca155bc-20261103T032112Z'),
        ('d4eeffaf28f1-20261109T160000Z', '69c31f4e1dcd-20261109T051556Z'),
        ('d9fa69d9e1e4-20261110T210615Z', 'd4eeffaf28f1-20261109T160000Z'),
        ('037f8db7edcc-20261111T182211Z', 'd9fa69d9e1e4-20261110T210615Z'),
    )
    match = next(((current, previous) for current, previous in approved
                  if pair == {'current': current, 'previous': previous}), None)
    if match is None:
        return False
    outgoing, predecessor = match
    archive = '/var/backups/proofofwork-ui/releases/proofofwork-ui-release-' + predecessor + '.tgz'
    paths = sorted([archive, archive + '.sha256', archive + '.provenance',
                    '/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-' + outgoing])
    hold = rule.get('preservedFallback') or {}
    return (rule.get('model') == 'private-stage-reviewed-retirement-v1'
            and rule.get('previousPair') == {'current': outgoing, 'previous': predecessor}
            and rule.get('wouldRetire') == paths and bool(hold.get('snapshotSha256'))
            and set(paths).isdisjoint(hold['snapshotSha256']))


def require_obligation(observed, private, release=None):
    if 'verifiedPreservedFallback' not in observed:
        raise ValueError('Installed lifecycle lacks a verified preservation result')
    hold = observed['verifiedPreservedFallback']
    if hold is None:
        index = observed.get('verifiedPreFallbackIndex')
        if (not isinstance(index, dict) or set(index) != {'path','sha256'} or not index.get('path')
                or not re.fullmatch('[a-f0-9]{64}', index.get('sha256', '')) or index != observed.get('index')):
            raise ValueError('No verified pre-fallback admission index')
        pair = observed['binding']['pair']
        introducer_time = '20261103T032112Z'
        if set(pair) != {'current','previous'} or any(
                not isinstance(release, str) or not re.fullmatch('[a-f0-9]{12}-[0-9]{8}T[0-9]{6}Z', release)
                or release[13:] >= introducer_time for release in pair.values()):
            raise ValueError('Missing verified preserved fallback on or after its introduction')
    elif not private:
        raise ValueError('Verified preserved fallback requires private zero-retirement publication')
    if release is not None and (not re.fullmatch('[a-f0-9]{12}-[0-9]{8}T[0-9]{6}Z', release)
            or any(release[13:] <= prior[13:] for prior in observed['binding']['pair'].values())):
        raise ValueError('Proposed release must follow its authenticated predecessor pair')
    return hold


def check_observation(observed, private, rule=None, *, release=None, compare=False):
    hold = require_obligation(observed, private, release)
    if not private:
        if rule is not None:
            raise ValueError('Ordinary publication carries a private witness')
        return
    forecast = observed['privateStageRetention']
    if not reviewed_forecast(forecast):
        raise ValueError('Private staging would retire previously admitted data: ' + str(forecast['wouldRetire']))
    if (forecast.get('preservedFallback') != hold
            or (compare and forecast != rule)):
        raise ValueError('Private publication forecast differs from installed retention evidence')


def plan_gate(plan):
    private = 'inputCompactor' in plan
    closed = plan.get('closedArchive', {})
    request = closed.get('request', {})
    if (('privateStageRetention' in plan) != private
            or ('privateStaging' in closed) != private or ('inputCompactorSha256' in request) != private):
        raise ValueError('Incomplete private publication plan')
    if private and (plan.get('inputStorage') != 'deploy-scratch-v1'
            or any(key in plan for key in ('preservedStageResume','resumeSurfaces','preservedCapacityResume'))
            or plan['inputCompactor']['sha256'] != request['inputCompactorSha256']
            or plan['wrapperSourceSha256']['input_compaction.py'] != request['inputCompactorSha256']):
        raise ValueError('Private staging requires its exact fresh input and compactor')
    return [plan['retentionLifecycle'], plan['releaseId'], private, plan.get('privateStageRetention')]


def pinned_file(path, expected, limit):
    path = Path(path)
    st = path.lstat()
    if (not re.fullmatch('[0-9a-f]{64}', expected) or path.resolve(strict=True) != path
            or not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or st.st_gid != 0
            or st.st_nlink != 1 or st.st_mode & 0o7022 or not 0 < st.st_size <= limit):
        raise ValueError('Unsafe installed publication policy file')
    def identity(info):
        return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid, info.st_nlink,
                info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
    with os.fdopen(fd, 'rb') as source:
        if identity(os.fstat(fd)) != identity(st):
            raise ValueError('Installed policy file changed when opened')
        raw = source.read(limit+1)
        if (identity(os.fstat(fd)) != identity(st) or identity(path.lstat()) != identity(st)
                or len(raw) != st.st_size or hashlib.sha256(raw).hexdigest() != expected):
            raise ValueError('Installed publication policy hash or identity differs')
    return raw


def installed_admission(binding, release, private, rule, lock_fd):
    # Bootstrap solely from the fixed, root-owned installed config. A stale plan
    # pin may refuse these reads but cannot select another controller or state.
    config_ref = binding['config']
    if config_ref['path'] != CONFIG or binding['state']['path'] != STATE:
        raise ValueError('Unexpected publication retention binding')
    config = json.loads(pinned_file(CONFIG, config_ref['sha256'], 65536))
    package = config['package']
    controller = config['controller']
    if (not re.fullmatch('[0-9a-f]{64}', package['sha256']) or package['path'] != PACKAGE+package['sha256']
            or controller != binding['controller']
            or controller['path'] != package['path']+'/deploy/ui-retention/lifecycle_remote.py'):
        raise ValueError('Installed lifecycle controller differs from the bound package')
    namespace = {'__name__':'_publication_admission', '__file__':controller['path']}
    raw = pinned_file(controller['path'], controller['sha256'], 2*1024**2)
    exec(compile(raw, controller['path'], 'exec'), namespace)
    # installed_runtime authenticates the package manifest, SHA-pinned policy
    # and approval. Runtime.status then verifies the admission chain and all
    # four physical fallback snapshots before returning the obligation.
    runtime = namespace['installed_runtime'](CONFIG, config_ref['sha256'])
    if not callable(getattr(runtime.P, 'verify_fallback_hold', None)):
        raise ValueError('Installed lifecycle lacks preserved fallback verification')
    held = runtime.S.require_execution_lock(lock_fd, runtime.layout)
    request = {'requireComplete':True}
    if private:
        request['prospectiveRelease'] = release
    observed = runtime.status(request)
    runtime.S.require_execution_lock(lock_fd, runtime.layout, held)
    if observed['binding'] != binding:
        raise ValueError('Installed lifecycle binding changed since preflight')
    check_observation(observed, private, rule, release=release, compare=True)
    return {'verifiedPreservedFallback':observed['verifiedPreservedFallback'], 'retentionIndex':observed['index'],
            **({'verifiedPreFallbackIndex':observed['verifiedPreFallbackIndex']}
               if observed['verifiedPreservedFallback'] is None else {})}
