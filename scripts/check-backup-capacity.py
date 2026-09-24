#!/usr/bin/env python3
"""Execute the actual backup controller with private filesystem/process fixtures."""
import pathlib,tempfile,subprocess,os,time,hashlib
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
  old=backup/f'proof_indexer-202001{day:02d}T000000Z.dumpset';old.mkdir(mode=0o700);(old/'evidence').write_text('retain')
 verified_old=backup/'proof_indexer-20200109T000000Z.dumpset';verified_old.mkdir(mode=0o700)
 old_files={'proof_indexer.dump':b'verified previous dump','globals.sql':b'verified previous globals'}
 for name,payload in old_files.items():
  path=verified_old/name;path.write_bytes(payload);path.chmod(0o600)
 manifest=verified_old/'SHA256SUMS';manifest.write_text(''.join(f'{hashlib.sha256(payload).hexdigest()}  {name}\n' for name,payload in old_files.items()));manifest.chmod(0o600)
 external=p/'external-reference';external.write_bytes(b'outside the backup set')
 unsafe=backup/'proof_indexer-20200112T000000Z.dumpset';unsafe.mkdir(mode=0o700)
 for name,payload in old_files.items():
  path=unsafe/name;path.write_bytes(payload);path.chmod(0o600)
 unsafe_manifest=unsafe/'SHA256SUMS'
 unsafe_manifest.write_text(hashlib.sha256(external.read_bytes()).hexdigest()+'  ../external-reference'+chr(10));unsafe_manifest.chmod(0o600)
 stale=backup/'.proof_indexer-20200101T000000Z.dumpset.tmp';stale.mkdir();os.utime(stale,(1,1))
 result=subprocess.run(['bash',str(script)],env=env,text=True,capture_output=True,timeout=15)
 assert result.returncode==0,result.stderr
 assert (p/'called').exists() and all((backup/f'proof_indexer-202001{day:02d}T000000Z.dumpset/evidence').read_text()=='retain' for day in range(1,9)) and stale.is_dir()
 assert 'reason=verification-failed predicate=' in result.stdout, result.stdout+'\n'+result.stderr
 assert 'backup_retention_deleted candidate='+str(verified_old) in result.stdout
 assert not verified_old.exists(), 'a verified older complete backup was not retired'
 assert unsafe.is_dir(), 'retention removed a set whose checksum manifest referenced an external path'
 assert 'backup_retention_review candidate='+str(unsafe)+' reason=verification-failed predicate=checksum-manifest-line-count action=preserve' in result.stdout
 assert len(list(backup.glob('proof_indexer-*.dumpset')))==10
 # Explicit retention can keep the already-restore-proven set without starting a new dump.
 def complete_set(name):
  target=backup/name;target.mkdir(mode=0o700)
  files={'proof_indexer.dump':b'fixture restore catalog','globals.sql':b'fixture globals'}
  for filename,payload in files.items():
   path=target/filename;path.write_bytes(payload);path.chmod(0o600)
  checksums=target/'SHA256SUMS'
  checksums.write_text(''.join(f'{hashlib.sha256(payload).hexdigest()}  {filename}\n' for filename,payload in files.items()))
  checksums.chmod(0o600)
  return target
 keeper=complete_set('proof_indexer-20200110T000000Z.dumpset')
 removable=complete_set('proof_indexer-20200111T000000Z.dumpset')
 (p/'called').unlink()
 result=subprocess.run(['bash',str(script),'--retain-existing',keeper.name],env=env,text=True,capture_output=True,timeout=15)
 assert result.returncode==0,result.stderr
 assert keeper.is_dir() and not removable.exists(),result.stdout+'\n'+result.stderr
 assert not (p/'called').exists(), 'retention-only mode unexpectedly created a new dump'
 assert 'backup_retention_kept candidate='+str(keeper) in result.stdout
 assert 'backup_retention_deleted candidate='+str(removable) in result.stdout
 # A growing failed dump remains inspectable, while the process is terminated.
 command('pg_dump', '''for arg in "$@"; do case "$arg" in --file=*) output="${arg#--file=}";; esac; done
truncate -s 2000000000 "${output}"
exec sleep 30''')
 time.sleep(1.1)
 result=subprocess.run(['bash',str(script)],env=env,text=True,capture_output=True,timeout=12)
 assert result.returncode!=0 and 'capacity bound reached' in result.stderr,result.stderr
 assert len(list(backup.glob('.proof_indexer-*.dumpset.tmp')))==2
 print('Backup capacity guards, creation, verified one-set retention, and incomplete-evidence preservation passed')
