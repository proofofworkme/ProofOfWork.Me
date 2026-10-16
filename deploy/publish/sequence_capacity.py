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

LIMITS = {'backupBudgetBytes': 18 * 1024**3, 'transportBudgetBytes': 9 * 1024**3,
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


def requirements(plan, census):
    if census.get('limits') != LIMITS:
        raise ValueError('Whole-release census has different storage limits')
    if plan.get('inputStorage') != 'release-evidence-v1':
        raise ValueError('Whole-release model requires preserved release inputs')
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
    verification = candidate
    extra = {
        'root': incoming + source + candidate + archive + verification + EVIDENCE_BYTES,
        'backup': incoming + source + archive + old + EVIDENCE_BYTES,
        'transport': incoming + source + archive + EVIDENCE_BYTES,
        'scratch': incoming + candidate + verification + EVIDENCE_BYTES,
    }
    inodes = (integer(plan['admissions']['source-receive']['inodes']) +
              3 * integer(plan['admissions']['surfaces-receive']['inodes']) +
              2 * integer(census['liveTree']['additionalInodes']) + 512)
    return {'schema': 'pow-ui-whole-release-capacity-v1', 'limits': dict(LIMITS),
            'additionalBytes': extra, 'additionalInodes': inodes,
            'retirementCreditBytes': 0, 'futureHardlinkCreditBytes': 0,
            'charges': {'receivedSurfaces': incoming, 'preservedSource': source,
                        'candidateCopy': candidate, 'managedArchiveAndSidecars': archive,
                        'provenanceExtraction': verification, 'liveToRollbackPool': old,
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
