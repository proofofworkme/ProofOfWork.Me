#!/usr/bin/env python3
"""Conservative whole-release admission before the first uploaded byte.

Existing allocations are measured by the installed capacity guard (unique
inodes within each pool). Prospective copies receive no hardlink or promised
retirement credit. Pool membership and physical allocation are separate: moving
the live root into rollback storage still charges the backup pool.
"""
import json
import os
from pathlib import Path

# Paired with the native guard: finite transport-only calibration, no cleanup credit.
LIMITS = {'backupBudgetBytes': 18 * 1024**3, 'transportBudgetBytes': 9 * 1024**3 + 64 * 1024**2,
          'scratchBudgetBytes': 5 * 1024**3, 'rootReserveBytes': 10 * 1024**3,
          'growthReserveBytes': 64 * 1024**2, 'inodeReserve': 128}
POOLS = {'backup': '/var/backups/proofofwork-ui',
         'transport': '/var/backups/proofofwork-ui/transport-evidence',
         'scratch': '/var/tmp/proofofwork-deploy'}
EVIDENCE_BYTES = 64 * 1024**2


def integer(value):
    if type(value) is not int or value < 0:
        raise ValueError('Capacity values must be nonnegative integers')
    return value


def capture(native):
    """Caller owns the deployment lock and has verified native helper bytes."""
    if (native.ROOT_RESERVE_BYTES != LIMITS['rootReserveBytes'] or
            native.GROWTH_RESERVE_BYTES != LIMITS['growthReserveBytes'] or
            native.INODE_RESERVE != LIMITS['inodeReserve'] or
            native.MAX_DEPLOY_SCRATCH_BYTES != LIMITS['scratchBudgetBytes'] or
            [(str(p), n) for p, n in native.RETENTION_BUDGETS] !=
            [(POOLS['backup'], LIMITS['backupBudgetBytes']),
             (POOLS['transport'], LIMITS['transportBudgetBytes'])]):
        raise ValueError('Installed storage limits differ from approved fixed limits')
    device = Path('/').stat().st_dev
    for path in (*POOLS.values(), '/var/www'):
        if native.canonical_directory(Path(path)).st_dev != device:
            raise ValueError('Whole-release model requires the same verified filesystem')
    rows = native.check_retention(Path(POOLS['scratch']), 0, 'whole-release-measurement')
    scratch = native.check_deploy_scratch(Path(POOLS['scratch']), 0, 'whole-release-measurement')
    usage = {name: next(r['allocatedBytes'] for r in rows if r['path'] == path)
             for name, path in POOLS.items() if name != 'scratch'}
    usage['scratch'] = scratch['allocatedBytes']
    space = os.statvfs('/')
    return {'limits': dict(LIMITS), 'usage': usage,
            'availableBytes': space.f_bavail * space.f_frsize,
            'availableInodes': space.f_favail,
            'liveTree': native.tree_bound(Path('/var/www'), Path(POOLS['scratch']))}


def bound_stream_verification(plan):
    """A smaller charge applies only to the proven pair of installed streaming helpers."""
    evidence = plan['closedArchive']; request = evidence['request']; archive = evidence['archive']
    if (plan['inputStorage'] != 'deploy-scratch-v1' or plan.get('releaseFormat') != 'proofofwork-ui-release-v5' or
            request.get('model') != 'proof-ui-closed-input-v1' or
            any(request.get(k) != plan[k] for k in ('releaseId', 'commit', 'tree')) or
            request['surfacesSha256'] != plan['surfaces']['sha256'] or
            request['phaseSourceSha256'] != plan['phaseCapacity']['sha256'] or
            request['payloadFingerprint'] != plan['surfacesPayloadFingerprint'] or
            request['helperHashes'] != {k: plan['publicationHelpers'][k]['sha256'] for k in ('publisher', 'provenance', 'stager')} or
            evidence['liveManifestSha256'] != plan['oldLiveManifestSha256'] or
            evidence['liveTreeSha256'] != plan['oldFullRootTreeSha256'] or
            archive.get('model') != 'closed-managed-archive-tar-gzip-v1' or archive.get('hardDereference') is not True or
            sorted(archive['managedSurfaces']) != sorted(plan['managedSurfaces']) or
            not 0 < integer(archive['regularFiles']) < integer(archive['entries']) <= 10000 or
            not 0 < integer(archive['logicalBytes']) <= integer(archive['archiveUpperBoundBytes']) or
            archive['archiveUpperBoundBytes'] != plan['stageArchiveUpperBoundBytes']):
        raise ValueError('Streaming verifier charge is not bound to this release and its closed inputs')
    return 8 * 1024**2


def requirements(plan, census):
    if census.get('limits') != LIMITS:
        raise ValueError('Whole-release census has different storage limits')
    storage = plan.get('inputStorage')
    if storage not in ('release-evidence-v1', 'deploy-scratch-v1'):
        raise ValueError('Whole-release model requires a known preserved input pool')
    if any(k in plan for k in ('resumeSurfaces', 'preservedStageResume', 'preservedCapacityResume')):
        raise ValueError('Interrupted releases require exact reconciliation, not fresh admission')
    incoming = integer(plan['admissions']['surfaces-receive']['bytes'])
    source = max(integer(plan['admissions']['source-receive']['bytes']),
                 integer(plan['sourceAllocatedBytes']))
    old = integer(census['liveTree']['additionalBytes'])
    archive = integer(plan['stageArchiveUpperBoundBytes']) + 65536
    candidate = old + incoming
    # Provenance verification extracts the managed archive while the candidate,
    # source and archive still exist. Bound that transient copy too.
    streaming = 'closedArchive' in plan
    verification = bound_stream_verification(plan) if streaming else candidate
    # Fresh release-evidence transport atomically moves the received surfaces
    # out of scratch, verifies their old path is absent, and only then stages.
    # These phases cannot overlap. Keep the full verification cushion charged
    # to staging even though the controlled provenance process uses /tmp.
    scratch_peak = max(incoming, candidate + verification)
    # Scratch inputs stay intact throughout source attestation and publication.
    # Charge all copies concurrently; no future deletion or deduplication credit.
    if storage == 'deploy-scratch-v1':
        scratch_peak = incoming + source + candidate + verification
    extra = {
        'root': incoming + source + candidate + archive + verification + EVIDENCE_BYTES,
        'backup': (incoming + source if storage == 'release-evidence-v1' else 0) + archive + old + EVIDENCE_BYTES,
        # New archive work is created directly in the releases pool, including
        # its temporary file and sidecar. It never occupies transport evidence.
        # Keep the complete archive charge in backup and physical root peaks.
        'transport': (incoming + source if storage == 'release-evidence-v1' else 0) + EVIDENCE_BYTES,
        'scratch': scratch_peak + EVIDENCE_BYTES,
    }
    phase_peaks = None
    if 'inputCompactor' in plan:
        staging = plan['closedArchive']['privateStaging']
        if (not streaming or storage != 'deploy-scratch-v1' or
                staging['model'] != 'private-release-stage-v1' or
                plan['inputCompactor']['sha256'] != plan['closedArchive']['request']['inputCompactorSha256']):
            raise ValueError('Unbound private release staging scope')
        compact = integer(staging['compactInputUpperBytes'])
        final = integer(staging['finalCandidateUpperBytes'])
        if min(compact, final, integer(staging['blockSize'])) <= 0:
            raise ValueError('Empty private storage bound')
        # Bounds correspond to actual, fenced checkpoints. Receive the entire
        # original input first. The source may only enter after the stage has
        # passed its complete candidate, archive, and input allocation checks.
        phase_peaks = {
            'surfaces-receive': {'root': incoming + 4 * 1024**2, 'scratch': incoming + 4 * 1024**2},
            'stage': {'root': compact + candidate, 'scratch': compact + candidate},
            'archive': {'root': compact + final + archive + verification, 'scratch': compact + final + verification},
            'source-and-publication': {'root': compact + final + archive + source + verification,
                                       'scratch': compact + final + source + verification},
        }
        for metric in ('root', 'scratch'):
            extra[metric] = max(step[metric] for step in phase_peaks.values()) + EVIDENCE_BYTES
    inodes = (integer(plan['admissions']['source-receive']['inodes']) +
              3 * integer(plan['admissions']['surfaces-receive']['inodes']) +
              2 * integer(census['liveTree']['additionalInodes']) + 512)
    return {'schema': 'pow-ui-whole-release-capacity-v1', 'limits': dict(LIMITS),
            **({'privatePhasePeaks': phase_peaks} if phase_peaks is not None else {}),
            'additionalBytes': extra, 'additionalInodes': inodes,
            'retirementCreditBytes': 0, 'futureHardlinkCreditBytes': 0,
            'charges': {'receivedSurfaces': incoming, 'preservedSource': source,
                        'candidateCopy': candidate, 'managedArchiveAndSidecars': archive,
                        ('provenanceStreamDisk' if streaming else 'provenanceExtraction'): verification, 'liveToRollbackPool': old,
                        'receiptDirectoryAndCompatibilityMargin': EVIDENCE_BYTES}}


def admit(required, census):
    if required.get('schema') != 'pow-ui-whole-release-capacity-v1' or required.get('limits') != LIMITS:
        raise ValueError('Unknown whole-release capacity contract')
    if census.get('limits') != LIMITS or required.get('retirementCreditBytes') != 0 or required.get('futureHardlinkCreditBytes') != 0:
        raise ValueError('Capacity cannot credit promised cleanup or future deduplication')
    deficits, headroom = {}, {}
    for name in ('backup', 'transport', 'scratch'):
        remaining = LIMITS[name + 'BudgetBytes'] - integer(census['usage'][name]) - integer(required['additionalBytes'][name])
        headroom[name] = remaining
        if remaining < 0:
            deficits[name] = -remaining
    headroom['root'] = integer(census['availableBytes']) - LIMITS['rootReserveBytes'] - LIMITS['growthReserveBytes'] - integer(required['additionalBytes']['root'])
    headroom['inodes'] = integer(census['availableInodes']) - LIMITS['inodeReserve'] - integer(required['additionalInodes'])
    for name in ('root', 'inodes'):
        if headroom[name] < 0:
            deficits[name] = -headroom[name]
    if deficits:
        raise ValueError('Whole-release capacity refused before upload; complete qualified retirement and remeasure: ' +
                         json.dumps({'deficits': deficits, 'limits': LIMITS}, sort_keys=True))
    return {'ok': True, 'requirements': required, 'measured': census,
            'headroom': headroom, 'cleanupCreditBytes': 0}
