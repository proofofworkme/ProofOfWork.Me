#!/usr/bin/python3 -I -B
"""Schedule one unchanged approved RUN; never retry a writer or invoke inverse."""
import base64, datetime, hashlib, json, os, re, subprocess, sys, time, types

ROOT_SHA = 'b989a3f2395e7cbf13cb2d3dbd2d258a3fd21867131e41644c094772aba11168'
REQUEST_SHA = 'cbc06a7966022acd2a8b07b66a96c3ccdca79b257fd6dbad45f70a5bfaaa2577'
PREPARED_SHA = '8c45911181ecb6ab5e7054250984aa4ff3d33fea96f228253ef90fec77b01f7e'
EXPECTED = [{'kind': 'confirmed', 'sources': ['block-scan']}, {'kind': 'best-effort-pending', 'sources': ['mempool-scan']}]
ENV = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C', 'TZ': 'UTC'}
SQL = "BEGIN TRANSACTION READ ONLY; SELECT jsonb_build_object('state',value->>'state','finishedAt',value->>'finishedAt','backfillPhases',CASE WHEN jsonb_typeof(value->'backfillPhases')='array' THEN (SELECT jsonb_agg(jsonb_build_object('kind',phase->>'kind','sources',phase->'sources') ORDER BY ordinal) FROM jsonb_array_elements(value->'backfillPhases') WITH ORDINALITY p(phase,ordinal)) ELSE NULL END) FROM proof_indexer.meta WHERE key='worker:lastRun'; ROLLBACK;"

def main():
    assert sys.flags.isolated and os.getuid() == os.geteuid() == os.getgid() == os.getegid() == 0
    assert os.uname().nodename == 'pow-bitcoin-01'
    raw = sys.stdin.buffer.read(393217)
    assert len(raw) <= 393216 and hashlib.sha256(raw).hexdigest() == REQUEST_SHA
    envelope = json.loads(raw)
    source = base64.b64decode(envelope['rootControlBase64'], validate=True)
    assert hashlib.sha256(source).hexdigest() == ROOT_SHA
    request = envelope['request']
    assert request['mode'] == 'run' and request['operation'] == 'apply' and request['runId'] == '20261003T160000Z' and request['priorApply'] is None
    from pathlib import Path
    package = Path('/usr/local/lib/proofofwork-audit30-production-sixteen/20261003T160000Z')
    assert hashlib.sha256((package/'prepared-request.json').read_bytes()).hexdigest() == PREPARED_SHA
    assert not any((package/name).exists() for name in ('root-intent.json','root-failed.json','root-completed.json','root-worker-before.json'))
    # Only a scheduling hint. The unchanged root controller repeats all actual guards.
    deadline = time.monotonic() + 180
    samples = 0
    while time.monotonic() < deadline:
        result = subprocess.run(['/usr/bin/sudo','-n','-u','postgres','/usr/bin/env','-i','PATH=/usr/bin:/bin','LC_ALL=C','PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000','/usr/lib/postgresql/16/bin/psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-d','proof_indexer'],input=SQL.encode(),env=ENV,capture_output=True,timeout=8,check=True)
        assert not result.stderr and len(result.stdout) <= 65536
        row = json.loads(result.stdout)
        samples += 1
        if row['state'] == 'idle' and row['backfillPhases'] == EXPECTED and isinstance(row['finishedAt'], str):
            age = (datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(row['finishedAt'].replace('Z','+00:00'))).total_seconds()
            if 0 <= age <= 10 and time.monotonic() < deadline:
                break
        time.sleep(1)
    else:
        raise RuntimeError('READONLY_IDLE_WINDOW_UNAVAILABLE_WRITER_NOT_INVOKED')
    print(json.dumps({'schema':'audit30-mail16-idle-scheduling-v1','atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'samples':samples,'finishedAgeSeconds':age,'writerInvocationsSoFar':0}),flush=True)
    # Invoke the byte-identical approved root controller once; never retry main().
    module = types.ModuleType('approved_root_control')
    module.__file__ = '/reviewed/production-sixteen-root-control.py'
    exec(compile(source,module.__file__,'exec'),module.__dict__)
    module.ROOT_SOURCE_SHA256 = ROOT_SHA
    import io, signal
    class Input:
        buffer = io.BytesIO(json.dumps(request,sort_keys=True,separators=(',',':')).encode())
    sys.stdin = Input()
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, lambda *_: (_ for _ in ()).throw(module.Interrupted('Root production control interrupted')))
    module.main()

if __name__ == '__main__':
    try:
        main()
    except BaseException as exc:
        code = str(exc) if re.fullmatch('[A-Z0-9_]{1,160}', str(exc)) else None
        print(json.dumps({'schema':'audit30-mail16-resume-refused-v1','errorClass':type(exc).__name__,'code':code,'reasonSHA256':hashlib.sha256(str(exc).encode()).hexdigest(),'automaticRetry':False,'automaticInverse':False,'outcomeRequiresReceiptReconciliation':True}),file=sys.stderr,flush=True)
        sys.exit(1)
