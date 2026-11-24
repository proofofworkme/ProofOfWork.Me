#!/usr/bin/python3 -I
"""Authenticate the two AMO scratch exchanges and their historical inodes."""
from pathlib import Path
from types import SimpleNamespace


APPROVAL = '512d190246031cbaa5ff8ceec32955ddfa742a4c893e0777d03f6af0967459a8'
GRANT = 'audits/2026-11-24-amo-ui-scratch-capacity-scope.json'
DIRECTORY = Path('/var/lib/proofofwork-ui-scratch-capacity') / APPROVAL
CAPACITY_PATH = Path('/usr/local/sbin/proofofwork-ui-capacity')
PRIOR_SHA = 'dfcee2f385e84c42aa98529dd4926fc27c5c6fb4bd0c50b3905b3a3248141df3'
NEXT_SHA = 'd38a524da2d9ba5c035dc62acf4880d7235f32d49e7a4c0d7c1a77f6715aae99'
PRIOR_BYTES, NEXT_BYTES = 6 * 1024**3, 7 * 1024**3
PREDECESSOR_AUTHORITY = {
    'approvalSha256': 'fc9c1970f3c7866f75851972cbfa51e7464303f9200ba54182b937e80c3a8a3f',
    'installedSha256': '6b1d53966039692e477ebfe68f734ba7267e1945024e84291fb3571f3f5791f5',
    'intentSha256': '36275b015400e00567f61a8c83fc6b043ae412774e0b54d35eabf75bbe190027',
}
AMO_EDGE = SimpleNamespace(approval=APPROVAL, migration='ui-scratch-6-to-7-gib-20261124',
    prior_sha=PRIOR_SHA, next_sha=NEXT_SHA, prior_bytes=PRIOR_BYTES, next_bytes=NEXT_BYTES,
    predecessor=PREDECESSOR_AUTHORITY)
CATCHUP_APPROVAL = '2bde67832b5a80106d226c49081e89c3637ac7b8a21959706392a237f00c379f'
CATCHUP_EDGE = SimpleNamespace(
    approval=CATCHUP_APPROVAL, migration='ui-scratch-7-to-7-5-gib-20261124',
    directory=DIRECTORY.parent / CATCHUP_APPROVAL,
    grant='audits/2026-11-24-amo-catchup-ui-scratch-capacity-scope.json',
    prior_sha=NEXT_SHA, next_sha='9c546b3053414eb52306c1e4098dbf1de6dc119a7fce63fa642dcc6bc7fa78df',
    prior_bytes=NEXT_BYTES, next_bytes=15 * 1024**3 // 2,
    predecessor={'approvalSha256': APPROVAL,
        'installedSha256': '1efa5921893c7c1f1d1d5572e96447a6c0d3f2f099eccf1ea0c59481bcdacc9d',
        'intentSha256': '4faa7cc20b3304719ab6f5c9efa9f07cf21368d050ba614d6e11645f978723ee'})


def verify_position(layout, runtime, *, allow_pending=False, capacity_descriptor=None):
    boost = runtime.scratch_successor_module()
    package = (*boost.SUCCESSOR_PACKAGE_FILES, 'deploy/ui-retention/amo_scratch_successor.py', GRANT)
    return boost.verify_edge(layout, runtime, AMO_EDGE, package, allow_pending=allow_pending,
                             capacity_descriptor=capacity_descriptor)


def verify_catchup_position(layout, runtime, *, allow_pending=False):
    boost = runtime.scratch_successor_module()
    package = (*boost.SUCCESSOR_PACKAGE_FILES, 'deploy/ui-retention/amo_scratch_successor.py', GRANT, CATCHUP_EDGE.grant)
    return boost.verify_edge(layout, runtime, CATCHUP_EDGE, package, allow_pending=allow_pending)


def verify_predecessor(layout, runtime, capacity_descriptor):
    """Follow both saved predecessor inodes through to the protected physical floor."""
    boost = runtime.scratch_successor_module().verify_position(
        layout, runtime, capacity_descriptor=capacity_descriptor)
    runtime.require(boost and boost['position'] == 'after' and boost['authority']
                    and boost['authority']['scratchBudgetBytes'] == PRIOR_BYTES
                    and all(boost['authority'].get(k) == v for k, v in PREDECESSOR_AUTHORITY.items()),
                    'AMO scratch predecessor differs from the verified Boost installation')
    first = runtime._scratch_capacity_position_original(layout, capacity_descriptor=boost['predecessorDescriptor'])
    runtime.require(first and first['position'] == 'after', 'Boost scratch predecessor is unsealed')
    floor = runtime._capacity_floor_authority_original(layout, first['priorCapacity'])
    runtime.require(floor and floor['rootReserveBytes'] == 8 * 1024**3
                    and floor['growthReserveBytes'] == 64 * 1024**2, 'Original capacity floor is unverified')
    return {'boost': boost['authority'], 'original': first, 'floor': floor}


def verify_catchup_predecessor(layout, runtime, capacity_descriptor):
    seven = verify_position(layout, runtime, capacity_descriptor=capacity_descriptor)
    runtime.require(seven and seven['position'] == 'after' and seven['authority']
                    and seven['authority']['scratchBudgetBytes'] == CATCHUP_EDGE.prior_bytes
                    and all(seven['authority'].get(k) == v for k, v in CATCHUP_EDGE.predecessor.items()),
                    'Catch-up scratch predecessor differs from the verified AMO installation')
    historical = verify_predecessor(layout, runtime, seven['predecessorDescriptor'])
    return dict(historical, amo=seven['authority'])
