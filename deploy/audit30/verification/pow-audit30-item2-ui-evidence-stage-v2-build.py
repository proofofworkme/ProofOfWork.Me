from pathlib import Path
import hashlib,json
R='38ac6e2bff2a-20261003T190512Z'
P='/var/backups/proofofwork-ui/transport-evidence/'+R
ST=P+'/proofofwork-www-stage-'+R
SRC=P+'/proofofwork-ui-source-'+R
PACKAGE='/usr/local/lib/proofofwork-audit30-item2-ui-evidence-stage-v2/'+R
oldpins={'stager': 'ed73a1bd5cec051ed093c96fbf0fabc47042a7da4ad6c6e8cd8e1359c71d64e7','provenance':'9435b88c43e1a16313c3a90ccb2e142b110bae8e1642ceb655caf73c2e4a0522','publisher':'f92db85d8d134959b95132494a3888bdb33f29251751a1b46b66a85ea1aee98a'}
manifest={}
for kind in ('stager','provenance','publisher'):
 suffix='py'if kind=='stager'else'sh'
 prior=Path('/tmp/pow-audit30-item2-ui-preserved-'+kind+'-v1.'+suffix);raw=prior.read_bytes();assert hashlib.sha256(raw).hexdigest()==oldpins[kind]
 s=raw.decode()
 if kind=='stager':
  old='    if stage_root != expected_stage_root:\n        fail(f"Stage root must use the exact release-bound path: {expected_stage_root}")\n'
  new='    if stage_root != expected_stage_root and not (\n        arguments.release_id == '+repr(R)+'\n        and stage_root == Path('+repr(ST)+')\n    ):\n        fail(f"Stage root must use the exact release-bound path: {expected_stage_root}")\n    if arguments.release_id == '+repr(R)+' and stage_root == Path('+repr(ST)+'):\n        staging_root = Path('+repr(P)+')\n'
  assert s.count(old)==1;s=s.replace(old,new)
 elif kind=='provenance':
  old='    ! "${ui_root}" =~ ^/var/tmp/proofofwork-deploy/proofofwork-www-stage-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then\n'
  new='    ( ! "${ui_root}" =~ ^/var/tmp/proofofwork-deploy/proofofwork-www-stage-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ &&\n      "${ui_root}" != "'+ST+'" ) ]]; then\n'
  assert s.count(old)==1;s=s.replace(old,new)
 else:
  oldpackage='/usr/local/lib/proofofwork-audit30-item2-ui-preserved-paths/'+R+'/provenance.sh'
  assert s.count(oldpackage)==1;s=s.replace(oldpackage,PACKAGE+'/provenance.sh')
  old='stage_root="${staging_root}/proofofwork-www-stage-${release_id}"\n'
  new='if [[ "${release_id}" == "'+R+'" &&\n  "${source_checkout}" == "'+SRC+'" ]]; then\n  staging_root="'+P+'"\nfi\n'+old
  assert s.count(old)==1;s=s.replace(old,new)
 path=Path('/tmp/pow-audit30-item2-ui-evidence-stage-'+kind+'-v2.'+suffix);path.open('xb').write(s.encode());compile(s,str(path),'exec')if kind=='stager'else None
 manifest[kind]={'path':str(path),'bytes':len(path.read_bytes()),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'originalPath':str(prior),'originalSHA256':oldpins[kind]}
print(json.dumps(manifest,sort_keys=True,indent=2))
