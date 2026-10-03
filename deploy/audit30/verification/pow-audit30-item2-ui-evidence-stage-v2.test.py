#!/usr/bin/python3 -I -B
import ast,copy,hashlib,os,pathlib,subprocess,types,unittest
R='38ac6e2bff2a-20261003T190512Z';P=pathlib.Path('/var/backups/proofofwork-ui/transport-evidence')/R;ST=P/('proofofwork-www-stage-'+R);SRC=P/('proofofwork-ui-source-'+R)
FILES={k:pathlib.Path('/tmp/pow-audit30-item2-ui-evidence-stage-'+k+'-v2.'+('py'if k=='stager'else'sh'))for k in ('stager','provenance','publisher')}
OLD={k:pathlib.Path('/tmp/pow-audit30-item2-ui-preserved-'+k+'-v1.'+('py'if k=='stager'else'sh'))for k in FILES}
PINS={'stager':'4158d7898c4a90d3adfc9bb7e8160054f7c6b4e1f4b36cc42b2504faef0f6beb','provenance':'ac22cacbfcb94311efc05e9e4e10edd18a54216b617f4b33f952a3c645b26af1','publisher':'e5a1f4782954ba83cd4c128c14541061dc1f74c5d8ec289c6154a44e086bb043'}
def stage_predicate():
 for n in ast.walk(ast.parse(FILES['stager'].read_bytes())):
  if isinstance(n,ast.If)and isinstance(n.test,ast.BoolOp)and isinstance(n.test.values[0],ast.Compare)and isinstance(n.test.values[0].left,ast.Name)and n.test.values[0].left.id=='stage_root':return n.test
 raise AssertionError('unique stage predicate')
def stage_rejected(release,path):
 return eval(compile(ast.fix_missing_locations(ast.Expression(copy.deepcopy(stage_predicate()))),'fixture','eval'),{'Path':pathlib.Path,'arguments':types.SimpleNamespace(release_id=release),'stage_root':path,'expected_stage_root':pathlib.Path('/var/tmp/proofofwork-deploy')/('proofofwork-www-stage-'+release)})
class Scope(unittest.TestCase):
 def test_sources_match_frozen_pins(self):
  for k,p in FILES.items():self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),PINS[k])
 def test_stager_inverse_is_entire_v1_bytes(self):
  s=FILES['stager'].read_text();new='    if stage_root != expected_stage_root and not (\n        arguments.release_id == '+repr(R)+'\n        and stage_root == Path('+repr(str(ST))+')\n    ):\n        fail(f"Stage root must use the exact release-bound path: {expected_stage_root}")\n    if arguments.release_id == '+repr(R)+' and stage_root == Path('+repr(str(ST))+'):\n        staging_root = Path('+repr(str(P))+')\n';old='    if stage_root != expected_stage_root:\n        fail(f"Stage root must use the exact release-bound path: {expected_stage_root}")\n';self.assertEqual(s.count(new),1);self.assertEqual(s.replace(new,old).encode(),OLD['stager'].read_bytes())
 def test_exact_and_default_stage_paths_are_admitted(self):
  self.assertFalse(stage_rejected(R,ST));self.assertFalse(stage_rejected(R,pathlib.Path('/var/tmp/proofofwork-deploy')/('proofofwork-www-stage-'+R)))
 def test_wrong_release_parent_and_siblings_refuse(self):
  for release,p in [('other',ST),(R,ST.with_name('other')),(R,P),(R,P.parent/('proofofwork-www-stage-'+R))]:self.assertTrue(stage_rejected(release,p))
 def test_default_production_env_guard_precedes_exact_parent_and_all_copy_guards_retained(self):
  s=FILES['stager'].read_text();self.assertLess(s.index('Non-production UI staging paths require POW_UI_ALLOW_TEST_ROOTS=1.'),s.index("staging_root = Path("+repr(str(P))))
  for line in ['copy_capacity_guard(www_root, staging_root, "stage-private-root", extra_entries=2, scratch_budget=True)','dir=staging_root,','if www_details.st_dev != staging_details.st_dev:','reject_nested_mounts(www_root, mountinfo)','reject_nested_mounts(surfaces_root, mountinfo)','if os.path.lexists(stage_root):']:self.assertIn(line,s)
 def test_provenance_inverse_is_entire_v1_bytes(self):
  s=FILES['provenance'].read_text();new='    ( ! "${ui_root}" =~ ^/var/tmp/proofofwork-deploy/proofofwork-www-stage-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ &&\n      "${ui_root}" != "'+str(ST)+'" ) ]]; then\n';old='    ! "${ui_root}" =~ ^/var/tmp/proofofwork-deploy/proofofwork-www-stage-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]]; then\n';self.assertEqual(s.count(new),1);self.assertEqual(s.replace(new,old).encode(),OLD['provenance'].read_bytes())
 def provenance(self,path,staged='1',archive='/var/backups/proofofwork-ui/releases'):
  s=FILES['provenance'].read_text();start=s.index('if [[ "${ui_root}" != "/var/www"');end=s.index('for root in "${ui_root}"',start);env={'PATH':'/usr/bin:/bin','LC_ALL':'C','ui_root':str(path),'archive_root':archive,'command':'verify-candidate','POW_UI_STAGED_ROOT':staged}
  return subprocess.run(['/usr/bin/bash','-c',s[start:end]],env=env,capture_output=True,timeout=5).returncode
 def test_provenance_exact_stage_and_canonical_default_allowed(self):
  self.assertEqual(self.provenance(ST),0);self.assertEqual(self.provenance('/var/tmp/proofofwork-deploy/proofofwork-www-stage-original'),0)
 def test_provenance_other_stage_or_missing_flag_or_wrong_archive_refused(self):
  for p,f,a in [(ST.with_name('other'),'1','/var/backups/proofofwork-ui/releases'),(ST,'0','/var/backups/proofofwork-ui/releases'),(ST,'1','/tmp/archive')]:self.assertEqual(self.provenance(p,f,a),64)
 def test_publisher_inverse_is_entire_v1_bytes(self):
  s=FILES['publisher'].read_text();block='if [[ "${release_id}" == "'+R+'" &&\n  "${source_checkout}" == "'+str(SRC)+'" ]]; then\n  staging_root="'+str(P)+'"\nfi\n';self.assertEqual(s.count(block),1);s=s.replace(block,'').replace('/usr/local/lib/proofofwork-audit30-item2-ui-evidence-stage-v2/'+R+'/provenance.sh','/usr/local/lib/proofofwork-audit30-item2-ui-preserved-paths/'+R+'/provenance.sh');self.assertEqual(s.encode(),OLD['publisher'].read_bytes())
 def test_publisher_selects_exact_parent_only_with_fixed_release_and_source(self):
  s=FILES['publisher'].read_text();start=s.index('if [[ "${release_id}" == "'+R);end=s.index('stage_root="${staging_root}',start);block=s[start:end]
  for release,source,want in [(R,str(SRC),str(P)),('other',str(SRC),'/var/tmp/proofofwork-deploy'),(R,str(SRC)+'-other','/var/tmp/proofofwork-deploy')]:
   r=subprocess.run(['/usr/bin/bash','-c',block+'printf "%s" "$staging_root"'],env={'PATH':'/usr/bin:/bin','release_id':release,'source_checkout':source,'staging_root':'/var/tmp/proofofwork-deploy'},capture_output=True,timeout=5);self.assertEqual(r.returncode,0);self.assertEqual(r.stdout.decode(),want)
 def test_shell_syntax_and_original_readonly_retention_exchange_bodies_preserved(self):
  for k in ('provenance','publisher'):self.assertEqual(subprocess.run(['/usr/bin/bash','-n',str(FILES[k])],capture_output=True,timeout=5).returncode,0)
  p=FILES['publisher'].read_text();self.assertIn('exchange_directories "${www_root}" "${stage_root}"',p);self.assertIn('verify_directory_identity "${stage_root}" "${prior_www_identity}"',p);self.assertIn('defer_verified_retention=1',p);self.assertLess(p.index('Non-production UI publisher paths require POW_UI_ALLOW_TEST_ROOTS=1.'),p.index('if [[ "${release_id}" == "'+R))
if __name__=='__main__':unittest.main()
