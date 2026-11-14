#!/usr/bin/env python3
"""Opt-in read-only interoperability check of a retained SYNTHETIC authority run.

No production namespace or authorization is accepted. Explicit substitutions are
fixture namespaces, exact authority pins, restored-entry count and ancestor
boundary. Git/SSH branded transport is not exercised; real generated Git blobs,
protected filesystem readers, installed Runtime.status and pure validation are.
"""
import ast,base64,copy,hashlib,importlib.util,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
NODE='/opt/node-v24.18.0-linux-x64/bin/node'
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return (json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def run(program,value):
 return json.loads(subprocess.check_output(['/usr/bin/python3','-I','-B','-c',program],
  input=json.dumps(value).encode(),stderr=subprocess.PIPE,timeout=90))
def fail(program,value):
 try:run(program,value)
 except subprocess.CalledProcessError:return
 raise AssertionError('Tampered input accepted')
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def main(report_path,expected_sha):
 p=Path(report_path);raw=p.read_bytes();assert sha(raw)==expected_sha
 report=json.loads(raw);assert report['qualifiedTerminalRetirement'] is True and report['productionActions'] is False
 base=Path(report['fixtureBase']);assert base.resolve()==base and base.is_dir()
 assert base==p.parent and (str(base).startswith('/tmp/') or '.retirement-test-tmp' in base.parts)
 cfg=base/'etc/proofofwork-retention/ui-lifecycle.json'
 state=base/'var/lib/proofofwork-ui-retention/state.json'
 assert cfg.is_file() and state.is_file()
 exports=json.loads(subprocess.check_output([NODE,'--input-type=module','-e',
  'import {retirementReadProgram,installedRetentionProgram,retentionPackageFiles} from "./scripts/retirement-evidence.mjs";console.log(JSON.stringify({retirementReadProgram,installedRetentionProgram,retentionPackageFiles}));'],
  cwd=ROOT,timeout=30))
 package=Path(report['package']['path']);manifest=json.loads((package/'package.json').read_bytes())
 assert set(manifest['files'])==set(exports['retentionPackageFiles'])
 origins=[]
 for origin in base.glob('operator-source-*'):
  if subprocess.check_output(['git','-C',str(origin),'rev-parse','HEAD'],text=True).strip()==report['operator']['commit']:origins.append(origin)
 assert len(origins)==1;origin=origins[0]
 assert subprocess.check_output(['git','-C',str(origin),'rev-parse','HEAD^{tree}'],text=True).strip()==report['operator']['tree']
 files={}
 for name in exports['retentionPackageFiles']:
  entry=subprocess.check_output(['git','-C',str(origin),'ls-tree',report['operator']['commit'],'--',name],text=True)
  assert entry.startswith(('100644 blob ','100755 blob ')) and entry.endswith('\t'+name+'\n')
  data=subprocess.check_output(['git','-C',str(origin),'show',report['operator']['commit']+':'+name])
  files[name]={'bytes':len(data),'sha256':sha(data)}
 expected_manifest={'schema':'pow-ui-retention-package-v1','sourceCommit':report['operator']['commit'],'sourceTree':report['operator']['tree'],'files':files}
 assert expected_manifest==manifest
 expected={'path':str(package),'sha256':sha(encoded(manifest)),'manifest':manifest,'manifestRaw':encoded(manifest).decode()}
 assert expected['sha256']==report['package']['sha256']
 def namespace(program):
  for prefix in ('/var/backups/proofofwork-ui','/etc/proofofwork-retention','/var/lib/proofofwork-ui-retention'):
   program=program.replace(prefix,str(base/prefix.lstrip('/')))
  old='for parent in p.parents:'
  assert old in program
  program=program.replace(old,'for parent in (x for x in p.parents if x==pathlib.Path('+repr(str(base))+') or pathlib.Path('+repr(str(base))+') in x.parents):')
  return program
 installed=namespace(exports['installedRetentionProgram'])
 attestation=run(installed,{'expected':expected})
 assert attestation['mode']=='operator-retirement-package' and attestation['policyCodeSha256']==expected['sha256']
 bad=copy.deepcopy(expected);bad['sha256']='f'*64;fail(installed,{'expected':bad})
 # Execute actual installed policy only after authenticating package bytes.
 L=load('consumer_actual_installed_lifecycle',package/'deploy/ui-retention/lifecycle_remote.py')
 runtime=L.installed_runtime(cfg,attestation['configSha256'])
 fd=runtime.S.lock(runtime.layout);runtime.lock_fd=fd
 try:status=runtime.status({'requireComplete':True})
 finally:runtime.lock_fd=None;os.close(fd)
 assert status==report['status'],'Actual lifecycle changed from retained terminal report'
 assert status['verifiedRetirementPolicyCodeSha256']==attestation['policyCodeSha256']
 trusted={'configSha256':status['configSha256'],'stateSha256':status['stateSha256'],
  'currentIndexSha256':status['index']['sha256'],'policyCodeSha256':attestation['policyCodeSha256'],'verifiedCurrentPair':status['pair']}
 R=load('consumer_fixture_authority',package/'deploy/ui-retention/retirement_receipt.py')
 program=namespace(exports['retirementReadProgram'])
 replacements={
 '6fd05dc1e04e6fbcab293683c5a0d10d184ff0bd83039a66d7f2c7ec53161004':R.PROPOSAL_SHA,
 'dcf09bd3ec9453230ece39ce67ccf9f39716388ad26bc609ad09d1fe5c308107':R.INVENTORY_SHA,
 'd83a52bef8bb3bca179e970a41d2300a9b7e1f688e53ac27342e2a8273766278':R.RESTORE_SHA,
 '5a7b025d95cd55a2b40f2a69b0189b74d75484ff237bac327f920a6b2a231c54':R.SOURCE_INDEX['sha256'],
 'audit30-policy-admission-index-ordinary-064b6991ae2a-20261114T020148Z.json':Path(R.SOURCE_INDEX['path']).name,
 '1042efea2aa1-20261112T074918Z':Path(R.PATHS[0]).name.removeprefix('proofofwork-ui-release-').removesuffix('.tgz'),
 'c3969c39c2b2-20261101T051206Z':Path(R.PATHS[2]).name.removeprefix('proofofwork-ui-release-').removesuffix('.tgz')}
 for old,new in replacements.items():
  assert old in program,old
  program=program.replace(old,new)
 bundle=run(program,{'trusted':trusted,'index':status['index']})
 validator_path=ROOT/'deploy/linked-publish/qualification.py'
 validator=validator_path.read_text()
 old="r['restoredEntries'] == 2839";assert old in validator
 restored=json.loads((Path(R.EVIDENCE_DIR)/'static-restore.json').read_bytes())['restoredEntries']
 fixture_validator=validator.replace(old,"r['restoredEntries'] == "+str(restored))
 module={'__name__':'consumer_fixture_validator','__file__':str(validator_path)}
 exec(compile(fixture_validator,str(validator_path),'exec'),module)
 pins={'RET_'+name:getattr(R,name) for name in ('PROPOSAL_SHA','INVENTORY_SHA','RESTORE_SHA','PAIR','BASE','PATHS','SOURCE_INDEX','PRIOR_CONFIG_SHA','EVIDENCE_DIR','TERMINAL_PATH')}
 pins.update(RET_CONFIG_PATH=str(cfg),RET_STATE_PATH=str(state))
 module.update(pins)
 result=module['validate_dual_retirement_evidence'](bundle,trusted)
 assert result['proof']==status['verifiedRetiredPayloads'] and result['verifiedCurrentPair']==status['pair']
 assert result['filesystemVerified'] is False and result['activationAllowed'] is False
 for mutation in ('terminal','sidecars','finalProofs','state','currentIndex'):
  bad=copy.deepcopy(bundle)
  if mutation=='terminal':bad['terminal']['base64']='e30='
  elif mutation=='sidecars':bad['sidecars'].pop()
  elif mutation=='finalProofs':bad['finalProofs']={}
  elif mutation=='state':bad['state']['sha256']='f'*64
  else:bad['currentIndex']['path']='/tmp/forged.json'
  try:module['validate_dual_retirement_evidence'](bad,trusted)
  except (ValueError,AssertionError):pass
  else:raise AssertionError('Accepted '+mutation+' tamper')
 untouched=load('consumer_untouched_production_validator',validator_path)
 try:untouched.validate_dual_retirement_evidence(bundle,trusted)
 except (ValueError,AssertionError):pass
 else:raise AssertionError('Untouched production pins accepted synthetic fixture')
 print(json.dumps({'ok':True,'reportSha256':expected_sha,'report':str(p),'realInstalledStatus':True,
  'packageGitBlobAttestation':True,'rawReaderValidated':True,'pureConsumerValidated':True,
  'tamperCasesRejected':6,'productionPinsRejectFixture':True,'productionActions':False,
  'brandedGitAndSshTransportExercised':False,'boundaries':['synthetic namespace and exact authority pins',
   'ancestor trust anchored at protected fixture root rather than writable /tmp',
   'restored-entry cardinality is fixture-specific','no production authorization or activation proof'],
  'programHashes':{k:sha(exports[k].encode()) for k in ('retirementReadProgram','installedRetentionProgram')},
  'substitutions':{'namespace':str(base),'pins':{k:(list(v) if isinstance(v,tuple) else v) for k,v in pins.items()},'restoredEntries':restored}},sort_keys=True))
if __name__=='__main__':
 assert len(sys.argv)==3,'Supply retained SYNTHETIC report path and exact SHA'
 main(*sys.argv[1:])
