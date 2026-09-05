#!/usr/bin/python3 -I
"""Keep window2 private evidence separate while reusing the pinned application release."""
import sys
if not sys.flags.isolated:
    raise SystemExit('Invoke with /usr/bin/python3 -I')
sys.dont_write_bytecode = True
import os
if os.getuid() != 0 or os.geteuid() != 0:
    raise SystemExit('Root required')
import hashlib
import pathlib
import stat

APP = '2ddefac163d5-20260905T180603Z'
EXEC = pathlib.Path('/run/proofofwork-audit5-exec-0b63c8604456-20260905T205150Z-window2')
CAPTURE = '/run/proofofwork-audit5-' + APP + '-window2'
ORIGINAL = EXEC / 'private-env.py'
ORIGINAL_SHA = '3785ce4ab40b21f5759a37e6170ad38949488ded6d1e1129710bc03d97dbc382'
ALLOWED_MODES = frozenset(('repair-canonical', 'repair-atoms', 'bootstrap-api', 'bootstrap-worker', 'gate'))


def fixed_private_read(path, pin=None):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        assert stat.S_ISREG(before.st_mode) and before.st_uid == before.st_gid == 0
        assert before.st_nlink == 1 and stat.S_IMODE(before.st_mode) == 0o600
        assert before.st_size <= 1048576
        with os.fdopen(os.dup(fd), 'rb') as stream:
            body = stream.read(1048577)
        after = os.fstat(fd)
        assert (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
        assert len(body) == before.st_size
        if pin is not None:
            assert hashlib.sha256(body).hexdigest() == pin
        return body
    finally:
        os.close(fd)


assert pathlib.Path(__file__) == EXEC / 'attempt-env.py'
info = EXEC.lstat()
assert EXEC.resolve() == EXEC and stat.S_ISDIR(info.st_mode)
assert info.st_uid == info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o700
fixed_private_read(EXEC / 'attempt-env.py')
_source = fixed_private_read(ORIGINAL, ORIGINAL_SHA)
_base = {'__file__': str(ORIGINAL), '__name__': 'audit5_window2_original_environment'}
exec(compile(_source, str(ORIGINAL), 'exec'), _base)
_original_runroot = _base['runroot']
_original_launch = _base['launch']
_original_launch_plan = _base['launch_plan']


def runroot(release):
    _original_runroot(release)
    _base['require'](release == APP)
    return CAPTURE


def launch_plan(mode, original, release, gate=None, api_port=18081):
    _base['require'](mode in ALLOWED_MODES)
    return _original_launch_plan(mode, original, release, gate, api_port)


def launch(args, account):
    _base['require'](args.mode in ALLOWED_MODES)
    return _original_launch(args, account)


_base.update(runroot=runroot, launch=launch, launch_plan=launch_plan)
# The controller needs only these original functions; their original globals
# retain the complete privacy, source, candidate and privilege-drop checks.
GATES = _base['GATES']
private_read = _base['private_read']
validate_repair_evidence = _base['validate_repair_evidence']
exclusive_write = _base['exclusive_write']
proc_identity = _base['proc_identity']


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ('capture', 'launch'):
        print('attempt_environment_helper status=refused (private details suppressed)', file=sys.stderr)
        return 1
    return _base['main']()


if __name__ == '__main__':
    sys.exit(main())
