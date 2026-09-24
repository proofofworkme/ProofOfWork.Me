#!/usr/bin/python3 -I
"""Run the unchanged, hash-pinned production publisher's read-only attestation."""
import sys

if __name__ == '__main__' and not sys.flags.isolated:
    raise SystemExit('Invoke the attestor with isolated Python (-I).')

import ctypes
import hashlib
import os
import pwd
import re
import stat
import subprocess
from pathlib import Path

PIN = '42ad099555cee0257572dd348a85a9f684005aba4f9c8f8077ea9aa67d68df78'
PUBLISHER = Path('/usr/local/sbin/proofofwork-node-release-publish')
START = b'attest_checkout() {\n  local target="$1"\n  /usr/bin/python3 -I - "${target}" <<\'PY\'\n'
END = b'\nPY\n}'

def attestation_body(source):
    if hashlib.sha256(source).hexdigest() != PIN:
        raise ValueError('Production publisher changed; review before using this audit-specific helper.')
    if source.count(START) != 1:
        raise ValueError('Publisher attestation boundary differs.')
    body = source.split(START, 1)[1].split(END, 1)[0]
    compile(body, '<verified-node-attestation>', 'exec')
    return body

def read_attestation_body():
    fd = os.open(PUBLISHER, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_mode & 0o7022 or before.st_size > 1048576:
            raise ValueError('Unsafe publisher.')
        source = os.read(fd, 1048577)
        after = os.fstat(fd)
        if (before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns) != (after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns):
            raise ValueError('Publisher changed while reading.')
    finally:
        os.close(fd)
    return attestation_body(source)


def enable_no_new_privileges():
    # Set on this single-purpose parent so the child inherits it before exec.
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(38, 1, 0, 0, 0) != 0:  # PR_SET_NO_NEW_PRIVS
        raise OSError(ctypes.get_errno(), 'Unable to disable privilege acquisition.')


def main():
    if not sys.flags.isolated or os.geteuid() != 0:
        raise ValueError('Attestation requires root and isolated Python (-I).')
    if len(sys.argv) != 2 or not re.fullmatch(r'/opt/proofofwork-api(?:-stage-[0-9a-f]{7,64}-[0-9]{8}T[0-9]{6}Z)?', sys.argv[1]):
        raise ValueError('Only the live or exact audit candidate checkout is permitted.')
    target = sys.argv[1]
    account = pwd.getpwnam('powadmin')
    details = os.lstat(target)
    if (account.pw_uid == 0 or account.pw_gid == 0 or
            not stat.S_ISDIR(details.st_mode) or details.st_mode & 0o7022 or
            (details.st_uid, details.st_gid) != (account.pw_uid, account.pw_gid) or
            os.path.realpath(target) != target):
        raise ValueError('Checkout must be a canonical, safe powadmin-owned directory.')
    # Root verifies the installed publisher; Git only ever runs as powadmin.
    body = read_attestation_body()
    enable_no_new_privileges()
    result = subprocess.run(['/usr/bin/python3', '-I', '-', target], input=body,
        env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C','GIT_OPTIONAL_LOCKS':'0',
             'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'},
        user=account.pw_uid, group=account.pw_gid, extra_groups=[],
        cwd='/', close_fds=True, timeout=180)
    return result.returncode

if __name__ == '__main__':
    sys.exit(main())
