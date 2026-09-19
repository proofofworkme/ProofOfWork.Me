#!/usr/bin/python3 -I
"""Continue the same confined PITR after the first controller's startup race."""
import pathlib,hashlib,json,subprocess,os,sys
assert sys.flags.isolated and os.geteuid()==0
j=pathlib.Path('/data/proofofwork-audit17-pitr-20260919T155550Z');c=j/'cluster'
p=json.loads((j/'plan.json').read_text());assert p['targetName']=='audit17_20260919T155128Z'
assert (j/'verifybackup.log').read_text().strip()=='backup successfully verified'
assert (j/'tablespace-wal.log').stat().st_size==0
# PostgreSQL consumes tablespace_map at recovery startup. Its original copy and
# the resulting private symlink remain independently inspectable.
if (c/'tablespace_map').exists():
 assert (c/'tablespace_map').read_text().strip()=='486390 '+str(j/'tablespaces/486390')
assert (j/'original-tablespace_map').read_text().strip()=='486390 /data/proofofwork-postgres-tablespaces/proof_indexer_large_state_v1'
assert (c/'pg_tblspc/486390').resolve()==j/'tablespaces/486390'
assert not (c/'postmaster.pid').exists() and (c/'recovery.signal').exists()
config=(c/'postgresql.conf').read_text()
assert "listen_addresses = ''" in config and 'include' not in config
assert "primary_conninfo = ''" in config
assert "restore_command = 'cp "+str(j)+"/wal/%f %p'" in config
assert (c/'postgresql.auto.conf').read_text()==''
receipt={'action':'resume same isolated PITR after controller readiness race','configSha256':hashlib.sha256(config.encode()).hexdigest(),'priorControllerLog':'/var/log/proofofwork-audit17-pitr-attempt3.log','job':str(j)}
with (j/'resume-evidence.json').open('x') as out: out.write(json.dumps(receipt,indent=2)+'\n')
args=['systemd-run','--unit=proofofwork-audit17-pitr-resume','--property=User=postgres','--property=Group=postgres','--property=Type=forking','--property=PIDFile='+str(c/'postmaster.pid'),'--property=RuntimeMaxSec=1800','--property=TimeoutStartSec=320','--property=MemoryMax=2G','--property=CPUQuota=100%','--property=IOWeight=10','--property=Nice=10','--property=TasksMax=64','--property=ProtectSystem=strict','--property=ProtectHome=yes','--property=PrivateTmp=yes','--property=PrivateNetwork=yes','--property=NoNewPrivileges=yes','--property=RestrictAddressFamilies=AF_UNIX','--property=ReadWritePaths='+str(j),'--property=InaccessiblePaths=/var/lib/postgresql/16/main /data/proofofwork-postgres-tablespaces /run/postgresql','--property=StandardOutput=append:/var/log/proofofwork-audit17-pitr-resume.log','--property=StandardError=inherit','/usr/lib/postgresql/16/bin/pg_ctl','-D',str(c),'-l',str(j/'postgres-resume.log'),'-w','-t','300','start']
subprocess.run(args,check=True);print(json.dumps(receipt))
