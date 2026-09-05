#!/usr/bin/python3 -I
"""Capture one stopped-writer phase and run the pinned exact repair checks."""
import sys
if not sys.flags.isolated:
    raise SystemExit('Invoke with python3 -I')
sys.dont_write_bytecode = True
import datetime, hashlib, json, os, pathlib, stat, subprocess

APP = '2ddefac163d5-20260905T180603Z'
OPS = '0b63c8604456-20260905T205150Z'
ROOT = pathlib.Path('/run/proofofwork-audit5-' + APP)
TOOLS = pathlib.Path('/run/proofofwork-audit5-window-tools-' + OPS)
SOURCE = pathlib.Path('/var/tmp/proofofwork-audit5-ops-source-' + OPS)
NODE = '/opt/node-v24.18.0-linux-x64/bin/node'
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}
PINS = {
    'window-quiescence.py': '710dbbe0fce1189b735e8e4795bdbef632040a36558fb4b0004a44d98204fb63',
    'aux-fields.sql': '2b83631a2f7495357ba1445948a525877b6cd6239043f5e5462aab376b18eccc',
    'check-exact-aux.py': '3f2fc89dbd22d77253ebc698d78b37699bebb214dc842c90625b7eb761ea60d3',
    'check-audit5-data-repair.mjs': '4af49f042d8ece901f31e09362e53c1f6df954f2b3baa43385b0fc4a8b9d476e',
}
SQL_PIN = 'c0d6a3aed9d55e071a324789857963a72705c363ef6313700dbde0875fd6bf2e'
PHASES = ['before', 'intermediate', 'after']
ATTEMPT_STARTED = False

def read(path, pin=None):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        assert stat.S_ISREG(before.st_mode) and before.st_uid == before.st_gid == 0
        assert before.st_nlink == 1 and stat.S_IMODE(before.st_mode) == 0o600
        assert before.st_size <= 32 * 1024 * 1024
        with os.fdopen(os.dup(fd), 'rb') as stream:
            body = stream.read(32 * 1024 * 1024 + 1)
        after = os.fstat(fd)
        assert (before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) == (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
        assert len(body) == before.st_size
        if pin is not None:
            assert hashlib.sha256(body).hexdigest() == pin
        return body
    finally:
        os.close(fd)

def write(path, body):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(body); stream.flush(); os.fsync(stream.fileno())
    fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    os.fsync(fd); os.close(fd)

def main():
    global ATTEMPT_STARTED
    assert os.geteuid() == 0 and len(sys.argv) == 2 and sys.argv[1] in PHASES
    phase = sys.argv[1]
    for directory in (ROOT, TOOLS):
        info = directory.lstat()
        assert directory.resolve() == directory and stat.S_ISDIR(info.st_mode)
        assert info.st_uid == info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o700
    verified = {name: read(TOOLS / name, pin) for name, pin in PINS.items()}
    sql = read(SOURCE / 'deploy/proofofwork-audit5-data-repair-check.sql', SQL_PIN)
    core = read(ROOT / 'window-core-approved-before.json')
    assert json.loads(core)['ok'] is True
    for suffix in ('.json', '-aux.json', '-verification.json', '-attempt.json', '-failure.json', '-sql-error.txt', '-aux-sql-error.txt', '-standard-error.txt'):
        name = f'repair-{phase}' + suffix
        assert not os.path.lexists(ROOT / name), 'Phase already captured; inspect instead of retrying'
    for earlier in PHASES[:PHASES.index(phase)]:
        for suffix in ('.json', '-aux.json', '-verification.json'):
            read(ROOT / ('repair-' + earlier + suffix))
    guard = {'__file__': str(TOOLS / 'window-quiescence.py'), '__name__': 'stopped_capture_guard'}
    exec(compile(verified['window-quiescence.py'], guard['__file__'], 'exec'), guard)
    argv = sys.argv
    try:
        sys.argv = [guard['__file__'], 'verify-stopped']; guard['main']()
    finally:
        sys.argv = argv
    write(ROOT / f'repair-{phase}-attempt.json', (json.dumps({'phase': phase, 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'pins': PINS, 'coreEvidenceSha256': hashlib.sha256(core).hexdigest(), 'status': 'attempt-started-inspect-before-any-retry'}) + '\n').encode())
    ATTEMPT_STARTED = True
    for suffix, query in (('', sql), ('-aux', verified['aux-fields.sql'])):
        result = subprocess.run(['/usr/bin/sudo', '-n', '-u', 'postgres', '/usr/bin/psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', 'proof_indexer'], input=query, capture_output=True, env=ENV, timeout=65)
        if result.returncode:
            write(ROOT / f'repair-{phase}{suffix}-sql-error.txt', result.stderr)
            raise RuntimeError('Read-only SQL refused; private error evidence preserved')
        assert len(result.stdout) <= 32 * 1024 * 1024
        value = json.loads(result.stdout)
        assert value['database'] == 'proof_indexer' and value['otherDatabaseSessions'] == 0
        write(ROOT / f'repair-{phase}{suffix}.json', result.stdout)
    # The intermediate phase precedes metadata repair; its invariants and exact
    # auxiliary fields are checked by the independent three-phase validator.
    command = [NODE, str(TOOLS / 'check-audit5-data-repair.mjs'), str(ROOT / 'repair-before.json')]
    if phase == 'after':
        command.append(str(ROOT / 'repair-after.json'))
    standard = subprocess.run(command, env=ENV, capture_output=True, timeout=30)
    if standard.returncode:
        write(ROOT / f'repair-{phase}-standard-error.txt', standard.stderr)
        raise RuntimeError('Standard comparator refused; preserve captured phase')
    exact = {'__file__': str(TOOLS / 'check-exact-aux.py'), '__name__': 'exact_captured_phase'}
    exec(compile(verified['check-exact-aux.py'], exact['__file__'], 'exec'), exact)
    def evidence(name):
        return json.loads(read(ROOT / name), parse_float=exact['D'])
    pairs = [(evidence(f'repair-{item}.json'), evidence(f'repair-{item}-aux.json')) for item in PHASES[:PHASES.index(phase) + 1]]
    result = exact['validate'](json.loads(core, parse_float=exact['D']), pairs)
    receipt = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'phase': phase, 'standard': json.loads(standard.stdout), 'exact': result, 'pins': PINS, 'evidenceHashes': {name: hashlib.sha256(read(ROOT / name)).hexdigest() for item in PHASES[:PHASES.index(phase) + 1] for name in (f'repair-{item}.json', f'repair-{item}-aux.json')}}
    write(ROOT / f'repair-{phase}-verification.json', (json.dumps(receipt, indent=2) + '\n').encode())
    print(json.dumps(receipt, indent=2))

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        if ATTEMPT_STARTED:
            write(ROOT / f'repair-{sys.argv[1]}-failure.json', (json.dumps({'phase': sys.argv[1], 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'errorType': type(error).__name__, 'detail': str(error)[:8192], 'action': 'Preserve the attempt and all captures; inspect rather than retry.'}) + '\n').encode())
        raise
