#!/usr/bin/env python3
"""Execute the actual backup controller with private filesystem/process fixtures."""
import pathlib,tempfile,subprocess,os,time
source=pathlib.Path('deploy/proofofwork-postgres-logical-backup.sh').read_text()
with tempfile.TemporaryDirectory() as root:
 p=pathlib.Path(root);backup=p/'backups';backup.mkdir(mode=0o700);commands=p/'commands';commands.mkdir()
 def command(name,body):
  f=commands/name;f.write_text('#!/bin/bash\nset -eu\n'+body+'\n');f.chmod(0o700);return str(f)
 df=command('df',"printf 'Avail\\n%s\\n' \"${TEST_AVAILABLE}\"")
 sql=command('psql',"echo 1000000")
 dump=command('pg_dump', '''for arg in "$@"; do case "$arg" in --file=*) output="${arg#--file=}";; esac; done
printf 'fixture dump' >"${output}"
printf 'called' >"${TEST_CALLED}"''')
 globals=command('pg_dumpall', '''for arg in "$@"; do case "$arg" in --file=*) printf 'fixture globals' >"${arg#--file=}";; esac; done''')
 restore=command('pg_restore','exit 0')
 text=source.replace('backup_root="/data/proofofwork-postgres-backups/logical"','backup_root="'+str(backup)+'"')
 for original,replacement in [('df',df),('psql',sql),('pg_dump',dump),('pg_dumpall',globals),('pg_restore',restore)]:
  text=text.replace('/usr/bin/'+original+' ',replacement+' ').replace('/usr/bin/'+original+' \\\n',replacement+' \\\n')
 script=p/'backup.sh';script.write_text(text)
 env={**os.environ,'TEST_AVAILABLE':'1000','TEST_CALLED':str(p/'called'),'POW_POSTGRES_BACKUP_MIN_FREE_BYTES':'10737418240'}
 result=subprocess.run(['bash',str(script)],env=env,text=True,capture_output=True,timeout=10)
 assert result.returncode==2 and not (p/'called').exists(),result.stderr
 env['TEST_AVAILABLE']='1000000000000'
 for day in range(1,9):
  old=backup/f'proof_indexer-202001{day:02d}T000000Z.dumpset';old.mkdir();(old/'evidence').write_text('retain')
 stale=backup/'.proof_indexer-20200101T000000Z.dumpset.tmp';stale.mkdir();os.utime(stale,(1,1))
 result=subprocess.run(['bash',str(script)],env=env,text=True,capture_output=True,timeout=15)
 assert result.returncode==0,result.stderr
 assert (p/'called').exists() and all((backup/f'proof_indexer-202001{day:02d}T000000Z.dumpset/evidence').read_text()=='retain' for day in range(1,9)) and stale.is_dir()
 assert 'action=preserve' in result.stdout
 assert len(list(backup.glob('proof_indexer-*.dumpset')))==9
 # A growing failed dump remains inspectable, while the process is terminated.
 (p/'called').unlink()
 command('pg_dump', '''for arg in "$@"; do case "$arg" in --file=*) output="${arg#--file=}";; esac; done
truncate -s 2000000000 "${output}"
exec sleep 30''')
 time.sleep(1.1)
 result=subprocess.run(['bash',str(script)],env=env,text=True,capture_output=True,timeout=12)
 assert result.returncode!=0 and 'capacity bound reached' in result.stderr,result.stderr
 assert len(list(backup.glob('.proof_indexer-*.dumpset.tmp')))==2
 print('Backup preflight/runtime capacity guards, creation and evidence-preserving retention checks passed')
