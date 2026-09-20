#!/usr/bin/env python3
"""Exercise actual UI shell helpers with isolated statvfs providers and temp trees."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent.parent
PROVENANCE = ROOT / 'deploy/proofofwork-ui-release-provenance.sh'
PUBLISHER = ROOT / 'deploy/proofofwork-ui-release-publish.sh'
CAPACITY = ROOT / 'deploy/proofofwork-ui-capacity.py'
SURFACES = ('activity', 'browser', 'boost', 'computer', 'desktop', 'growth', 'id',
            'inception', 'infinity', 'landing', 'marketplace', 'nft', 'token', 'wallet', 'work')


def write(path, content, mode=0o644):
    path.write_text(content)
    path.chmod(mode)


def run(args, env=None, success=True):
    result = subprocess.run([str(arg) for arg in args], cwd=ROOT, env=env,
                            text=True, capture_output=True, timeout=120)
    if success:
        assert result.returncode == 0, result.stderr
    return result


def fingerprint(root):
    digest = hashlib.sha256()
    for path in sorted(root.rglob('*')):
        digest.update(str(path.relative_to(root)).encode() + b'\0')
        digest.update(str(path.stat().st_mode).encode() + b'\0')
        if path.is_file():
            digest.update(path.read_bytes())
    return digest.hexdigest()


def archive_for(root, archive):
    with tarfile.open(archive, 'w:gz') as target:
        for surface in SURFACES:
            target.add(root / ('proofofwork-' + surface), arcname='surfaces/' + surface)
    archive.chmod(0o644)
    write(Path(str(archive) + '.sha256'),
          hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')


with tempfile.TemporaryDirectory(prefix='pow-ui-capacity-boundaries-') as temporary:
    base = Path(temporary)
    www, archives, staging, rollback, scratch, runtime = [base / name for name in
        ('www', 'archives', 'staging', 'rollback', 'private-scratch', 'runtime')]
    for directory in (www, archives, staging, rollback, scratch, runtime):
        directory.mkdir(mode=0o755)
    for surface in SURFACES:
        directory = www / ('proofofwork-' + surface)
        directory.mkdir(mode=0o755)
        (directory / 'assets').mkdir(mode=0o755)
        write(directory / 'index.html', '<html><script src="/assets/live.js"></script></html>\n')
        write(directory / 'assets/live.js', 'const release = "retained";\n')
    write(www / 'passthrough.txt', 'Preserved non-release evidence.\n')

    # Injection exists only in this private test helper, never in production CLI.
    # All real guards and archive arithmetic still execute; only statvfs changes.
    helper = base / 'capacity-fixture.py'
    write(helper, f'''import os, runpy, sys
module = runpy.run_path({str(CAPACITY)!r})
main = module['main']
scope = main.__globals__
actual_os = scope['os']
original_check = scope['check_capacity']
fault = {{'active': False}}
class Provider:
    def __getattr__(self, name):
        return getattr(actual_os, name)
    def statvfs(self, path):
        original = actual_os.statvfs(path)
        available = 0 if fault['active'] else 1024**4
        return os.statvfs_result((original.f_bsize, 1, 2 * 1024**4,
            available, available, 10000000, 9000000, 9000000,
            original.f_flag, original.f_namemax))
scope['os'] = Provider()
def checked(path, additional_bytes, additional_inodes, phase):
    fault['active'] = phase == os.environ.get('POW_TEST_CAPACITY_REFUSE_PHASE')
    return original_check(path, additional_bytes, additional_inodes, phase)
scope['check_capacity'] = checked
try:
    raise SystemExit(main())
except module['CapacityError'] as error:
    print(str(error), file=sys.stderr)
    raise SystemExit(1)
''', 0o755)

    environment = {**os.environ, 'POW_UI_ALLOW_TEST_ROOTS': '1',
                   'POW_UI_CAPACITY_SCRIPT': str(helper),
                   'POW_UI_WWW_ROOT': str(www),
                   'POW_UI_RELEASE_ARCHIVE_ROOT': str(archives),
                   'POW_UI_DEPLOY_LOCK': str(runtime / 'deploy.lock'),
                   'TMPDIR': str(scratch)}
    old_archive = archives / 'proofofwork-ui-release-retained.tgz'
    archive_for(www, old_archive)
    before = fingerprint(www)
    denied = run([PROVENANCE, 'record-rollback-evidence', '--archive', old_archive],
                 {**environment, 'POW_TEST_CAPACITY_REFUSE_PHASE': 'provenance-archive-extract'}, False)
    assert denied.returncode != 0 and 'UI capacity refused' in denied.stderr, denied.stderr
    assert fingerprint(www) == before
    assert not Path(str(old_archive) + '.provenance').exists()
    assert list(scratch.iterdir()) == []
    assert not list(runtime.glob('.proofofwork-*'))
    print('PASS archive extraction refusal preserves live/evidence and cleans only private scratch')

    run([PROVENANCE, 'record-rollback-evidence', '--archive', old_archive], environment)
    original_live = fingerprint(www)
    original_archives = fingerprint(archives)
    source = staging / 'proofofwork-ui-source-capacity-test'
    source.mkdir(mode=0o755)
    write(source / 'source.txt', 'A detached release fixture.\n')
    write(source / '.gitignore', 'node_modules/\n')
    run(['/usr/bin/git', '-C', source, 'init', '--quiet'])
    run(['/usr/bin/git', '-C', source, 'add', 'source.txt', '.gitignore'])
    run(['/usr/bin/git', '-C', source, '-c', 'user.name=Capacity fixture',
         '-c', 'user.email=capacity-fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture'])
    commit = run(['/usr/bin/git', '-C', source, 'rev-parse', 'HEAD']).stdout.strip()
    run(['/usr/bin/git', '-C', source, 'checkout', '--quiet', '--detach', commit])
    (source / 'node_modules').mkdir(mode=0o755)
    write(source / 'node_modules/fixture.js', 'export const fixture = true;\n')
    stage = staging / 'proofofwork-www-stage-capacity-test'
    shutil.copytree(www, stage)
    (stage / '.proofofwork-ui-release').unlink()
    for surface in SURFACES:
        directory = stage / ('proofofwork-' + surface)
        write(directory / 'index.html', '<html><script src="/assets/next.js"></script></html>\n')
        write(directory / 'assets/next.js', 'const release = "candidate";\n')
    candidate_archive = archives / 'proofofwork-ui-release-capacity-test.tgz'
    archive_for(stage, candidate_archive)
    original_stage = fingerprint(stage)
    archives_with_candidate = fingerprint(archives)
    publish_environment = {**environment, 'POW_UI_PUBLISH_WWW_ROOT': str(www),
                           'POW_UI_PUBLISH_STAGING_ROOT': str(staging),
                           'POW_UI_PUBLISH_ROLLBACK_ROOT': str(rollback),
                           'POW_UI_PUBLISH_PROVENANCE_SCRIPT': str(PROVENANCE)}
    arguments = [PUBLISHER, '--release-id', 'capacity-test', '--commit', commit,
                 '--source-checkout', source, '--archive', candidate_archive]
    for phase in ('publisher-admission', 'publisher-exchange-probe', 'publisher-before-exchange',
                  'provenance-release-manifests'):
        denied = run(arguments, {**publish_environment, 'POW_TEST_CAPACITY_REFUSE_PHASE': phase}, False)
        assert denied.returncode != 0 and 'UI capacity refused' in denied.stderr, denied.stderr
        assert fingerprint(www) == original_live, phase
        assert fingerprint(stage) == original_stage, phase
        assert fingerprint(archives) == archives_with_candidate, phase
        assert list(rollback.iterdir()) == [], phase
        assert list(scratch.iterdir()) == [], phase
        assert not list(staging.glob('.proofofwork-exchange-probe-*')), phase
        if phase == 'provenance-release-manifests':
            assert 'complete prior /var/www root was atomically restored' in denied.stderr, denied.stderr
        print('PASS ' + phase + ' refusal preserves complete live/stage/archive/rollback state')

    result = run(arguments, publish_environment)
    assert 'status=published' in result.stdout
    assert fingerprint(rollback / 'proofofwork-www-pre-capacity-test') == original_live
    assert 'candidate' in (www / 'proofofwork-computer/assets/next.js').read_text()
    assert not stage.exists() and list(scratch.iterdir()) == []
    print('PASS sufficient-capacity publication retains exact previous root')

    # Actual bounded writer must stop before arbitrary inventory growth consumes
    # the reserve; this fixture writes only into its own temporary directory.
    text = PROVENANCE.read_text()
    start = text.index('write_bounded_inventory() {')
    end = text.index("\n}\n", start) + 3
    target = base / 'oversized-inventory'
    script = text[start:end] + '\ncd -- "$2"\nwrite_bounded_inventory "$1" /usr/bin/python3 -I -B -c \'import resource, sys; assert resource.getrlimit(resource.RLIMIT_CORE) == (0, 0); sys.stdout.buffer.write(b"x" * (17 * 1024 * 1024))\'\n'
    bounded = run(['/bin/bash', '-c', script, 'bounded-inventory-test', target, base], success=False)
    assert bounded.returncode != 0
    assert target.stat().st_size == 16 * 1024 * 1024
    assert not list(base.glob('core')) and not list(base.glob('core.*'))
    print('PASS actual inventory writer fails at the 16 MiB ceiling with core dumps disabled')

print(json.dumps({'checks': 7, 'productionAccess': False, 'productionMutation': False}))
