#!/usr/bin/python3 -I
import os,pathlib,pwd,runpy,sys,ctypes
assert sys.flags.isolated and os.geteuid()==0 and len(sys.argv)==1
h=runpy.run_path('/run/proofofwork-audit17-batch-exec/private-env.py',run_name='helpers')
original=h['parse_env'](h['private_read']('/run/proofofwork-audit5-005a4e582f58-20260919T165018Z/api.environ'))
env={key:original[key] for key in (b'BITCOIN_RPC_URL',b'BITCOIN_RPC_USER',b'BITCOIN_RPC_PASSWORD')}
env[b'PATH']=b'/usr/bin:/bin';entry=h['private_read']('/run/proofofwork-audit17-batch-exec/benchmark.mjs').decode()
account=pwd.getpwnam('powadmin');os.chdir('/opt/proofofwork-api-stage-005a4e582f58-20260919T165018Z')
assert ctypes.CDLL(None,use_errno=True).prctl(38,1,0,0,0)==0
os.setgroups([]);os.setgid(account.pw_gid);os.setuid(account.pw_uid)
os.execve('/opt/node-v24.18.0-linux-x64/bin/node',['node','--input-type=module','-e',entry],env)
