#!/usr/bin/python3
"""Plan or retire four exact archive-equivalent sources for the Pay successor.

This is a separate scope from the earlier three-source retirement. Apply needs
explicit operator approval and the fresh hash-bound plan. No archive, receipt,
surface, live/prior tree or held fallback is a deletion target.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import types

BASE_SHA256 = '287de00cf84907a2d93d5781e2f8f9f117942cda6dfcdf748a28231239a04c7f'
path = Path(__file__).resolve().with_name('retire-build-sources.py')
info = path.lstat()
if (path.resolve() != path or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
        or info.st_uid not in (0, 1000) or info.st_mode & 0o022 or info.st_size > 65536):
    raise ValueError('Unsafe original source-equivalence controller')
fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
with os.fdopen(fd, 'rb') as stream:
    raw = stream.read(65537)
    if os.fstat(stream.fileno()) != info or path.lstat() != info:
        raise ValueError('Original source-equivalence controller changed')
if hashlib.sha256(raw).hexdigest() != BASE_SHA256:
    raise ValueError('Original source-equivalence controller differs')
B = types.ModuleType('pay_source_equivalence')
B.__file__ = str(path)
exec(compile(raw, str(path), 'exec'), B.__dict__)

TARGETS = (
    ('pay-a3cf496-20261114', 'proofofwork-ui-source-a3cf4963bc04-20261114T233017Z',
     'c601329bef436fa759acc837daa2b6d748370c0db12136f0738d4e2d76b764f0',
     '1fbb50f9ac9cc59c2e28cac0109e3670e8b6760c8bfb918160944bce4017d5ca', 32902863),
    ('ui-three-fixes-ca8954b-20261112', 'proofofwork-ui-source-ca8954ba9e28-20261112T145113Z',
     '88b1fba4751e1324a57c8b1b3dce7aa9b5d10f201f6fab4aa910bbfb8c10e4a1',
     '8c06a692ec7c6748852eb06142c698d51342a69264088cdb49c31dc4d16ca55e', 32127251),
    ('ui-three-fixes-a04684f-20261112', 'proofofwork-ui-source-a04684f8f042-20261112T151628Z',
     '3e374f338ab13258793e35efe57e3d8e27222294040852b39755c4e381d5030e',
     '846f0d53dfc193c4f95f8c7bf1cb489311bbb68bf75c749505d79a6f8a824d0c', 32139379),
    ('linked-publish-1f677f6-20261112', 'proofofwork-ui-source-1f677f6fdf15-20261112T210006Z',
     'd9bd2c18c62008a2a7ede5996a84e13095f00a341e793656751ff67312512418',
     '88c24404933026c89fb64bf2bb49db7bddf951270ea47f070bd52d29af357695', 32258338),
)
FORMAT = 'pay-exact-four-successor-build-source-retirement-v1'
APPROVAL = 'retire-only-four-reviewed-pay-successor-build-source-trees'


def verify_targets():
    rows, roots = [], []
    for run, name, archive_sha, receipt_sha, inode in TARGETS:
        root = B.BUILD / run / name
        archive, receipt = root.with_name(name + '.tgz'), root.parent / 'build-receipt.json'
        B.safe_ancestry(root)
        B.require(root.stat().st_dev == 64514 and root.stat().st_ino == inode,
                  'Reviewed successor source identity changed')
        B.require(B.digest_file(archive) == archive_sha and B.digest_file(receipt) == receipt_sha,
                  'Retained successor archive or receipt changed')
        bundle = json.loads(receipt.read_bytes())['bundles']['source']
        B.require(bundle['path'] == str(archive) and bundle['sha256'] == archive_sha
                  and bundle['bytes'] == archive.stat().st_size, 'Build receipt no longer binds source archive')
        rows.append({'path': str(root), 'archive': str(archive), 'archiveSha256': archive_sha,
                     'receiptSha256': receipt_sha, **B.archive_equivalence(root, archive)})
        roots.append(root)
    B.assert_unreferenced(roots)
    return rows


def reviewed_plan(rows):
    return {'format': FORMAT, 'controllerSha256': B.digest_file(Path(__file__).resolve()),
            'verificationControllerSha256': BASE_SHA256, 'targets': rows,
            'archivesRetained': True, 'receiptsRetained': True, 'productionUntouched': True}


def apply(plan, args):
    B.require(args.approval == APPROVAL, 'Explicit exact-four successor approval required')
    B.require(args.plan and args.plan.parent == B.RESULTS and not args.plan.is_symlink(),
              'Reviewed VPS successor plan required')
    B.require(B.digest_file(args.plan) == args.plan_sha256, 'Reviewed successor plan hash differs')
    B.require(json.loads(args.plan.read_bytes()) == plan, 'Successor sources differ from reviewed plan')
    B.save_exclusive(args.receipt, {'format': FORMAT, 'planSha256': args.plan_sha256,
                     'phase': 'verified-before-removal', 'targets': plan['targets']})
    for row in plan['targets']:
        root = Path(row['path'])
        B.require(B.identity(root.lstat()) == row['rootIdentity'], 'Source changed before removal')
        shutil.rmtree(root)
        B.require(not os.path.lexists(root), 'Successor source removal incomplete')
        B.require(B.digest_file(Path(row['archive'])) == row['archiveSha256'], 'Retained archive changed')
        B.require(B.digest_file(root.parent / 'build-receipt.json') == row['receiptSha256'],
                  'Build receipt changed')
    result = {'format': FORMAT, 'phase': 'complete', 'planSha256': args.plan_sha256,
              'removed': [row['path'] for row in plan['targets']], 'archivesRetained': True,
              'receiptsRetained': True, 'productionUntouched': True}
    completion = args.receipt.with_name(args.receipt.stem + '-complete.json')
    result['receiptSha256'] = B.save_exclusive(completion, result)
    return dict(result, receipt=str(completion))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('plan', 'apply'))
    parser.add_argument('--receipt', type=Path, required=True)
    parser.add_argument('--plan', type=Path)
    parser.add_argument('--plan-sha256')
    parser.add_argument('--approval')
    args = parser.parse_args()
    B.require(os.geteuid() == 0 and shutil.rmtree.avoids_symlink_attacks,
              'Root reference census and FD-safe removal required')
    B.safe_ancestry(B.BUILD)
    lock = B.BUILD / '.build.lock'
    before = lock.lstat()
    fd = os.open(lock, os.O_RDONLY | os.O_NOFOLLOW)
    info = os.fstat(fd)
    B.require(info == before and lock.resolve() == lock and stat.S_ISREG(info.st_mode)
              and info.st_nlink == 1 and info.st_uid in (0, 1000)
              and not info.st_mode & 0o077, 'Unsafe build lock')
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        B.require(lock.lstat() == info, 'Build lock changed while acquiring')
        plan = reviewed_plan(verify_targets())
        B.require(lock.lstat() == info and os.fstat(fd) == info, 'Build lock changed during verification')
        if args.mode == 'plan':
            result = {'receipt': str(args.receipt), 'sha256': B.save_exclusive(args.receipt, plan),
                      'allocatedBytes': sum(row['allocatedBytes'] for row in plan['targets']),
                      'targets': [row['path'] for row in plan['targets']]}
        else:
            result = apply(plan, args)
        print(json.dumps(result), flush=True)
    finally:
        os.close(fd)


if __name__ == '__main__':
    main()
