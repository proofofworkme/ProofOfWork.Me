#!/usr/bin/python3 -I
"""Run fixed read-only API audits with a private verifier token, never shell-source env."""
import ctypes,hashlib,os,pathlib,pwd,runpy,subprocess,sys
assert sys.flags.isolated and os.geteuid()==0 and len(sys.argv)==2
GATES={'ids':'scripts/audit-id-registry.mjs','ledger':'scripts/audit-ledger-consistency.mjs','events':'scripts/audit-computer-events.mjs'}
assert sys.argv[1] in GATES
root='/run/proofofwork-audit17-events'
helper=pathlib.Path(root+'/private-env.py')
# Helper contents are the committed, previously reviewed release launcher.
assert helper.read_bytes()==pathlib.Path('/opt/proofofwork-api/deploy/audit5/private-env.py').read_bytes()
h=runpy.run_path(str(helper),run_name='helpers')
account=pwd.getpwnam('powadmin');identity=h['proc_identity']('api',account)
blob=pathlib.Path('/proc',str(identity['pid']),'environ').read_bytes()
assert h['proc_identity']('api',account)==identity
original=h['parse_env'](blob); token=original.get(b'POW_INTERNAL_VERIFIER_TOKEN',b'');assert len(token)>=32
commit=subprocess.check_output(['git','-c','safe.directory=/opt/proofofwork-api','-C','/opt/proofofwork-api','rev-parse','HEAD'],text=True).strip()
assert commit=='6eb4a1e07131fc0b27d381dda52986f9d1bf3398'
env={b'PATH':b'/opt/node-v24.18.0-linux-x64/bin:/usr/bin:/bin',b'LANG':b'C.UTF-8',b'NETWORK':b'livenet',b'POW_API_BASE':b'http://127.0.0.1:8081',b'POW_INTERNAL_VERIFIER_TOKEN':token,b'MAX_LEDGER_TIP_LAG_BLOCKS':b'0',b'POW_ID_AUDIT_API_BASE':b'http://127.0.0.1:8081',b'POW_ID_AUDIT_ADDRESS_API_BASE':b'http://127.0.0.1:8081',b'POW_ID_AUDIT_PRODUCTION':b'1',b'POW_ID_AUDIT_WRITE_REPORTS':b'0',b'POW_ID_AUDIT_TIMEOUT_MS':b'60000',b'POW_ID_AUDIT_COVERAGE_TIMEOUT_MS':b'300000'}
# Retry bounded read-only coverage when a new chain checkpoint invalidates a scan.
env[b'POW_ID_AUDIT_RETRIES']=b'3'
entry=None
if sys.argv[1]=='events':
    for key in (b'POW_INDEX_DATABASE_URL',b'PROOF_INDEX_DATABASE_URL',b'DATABASE_URL'):
        if original.get(key):env[b'POW_INDEX_DATABASE_URL']=original[key];break
    assert env.get(b'POW_INDEX_DATABASE_URL')
    env[b'POW_INDEX_DB_POOL_MAX']=b'1'
    env[b'POW_INDEX_DB_STATEMENT_TIMEOUT_MS']=b'30000'
    entry=pathlib.Path('/run/proofofwork-audit17-events/entry.mjs').read_text()
os.chdir('/opt/proofofwork-api');os.umask(0o077)
assert ctypes.CDLL(None,use_errno=True).prctl(38,1,0,0,0)==0
os.setgroups([]);os.setgid(account.pw_gid);os.setuid(account.pw_uid)
print('Starting pinned read-only '+sys.argv[1]+' audit at '+commit,flush=True)
os.execve('/opt/node-v24.18.0-linux-x64/bin/node',(['node','--max-old-space-size=2048','--input-type=module','-e',entry] if entry else ['node','--max-old-space-size=2048',GATES[sys.argv[1]]]),env)
