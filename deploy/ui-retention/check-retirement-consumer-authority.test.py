#!/usr/bin/env python3
"""Opt-in read-only interoperability check of a retained SYNTHETIC authority run.

No production namespace or authorization is accepted. Explicit substitutions are
fixture namespaces, exact authority pins, restored-entry count and ancestor
boundary. Git/SSH branded transport is not exercised; real generated Git blobs,
protected filesystem readers, installed Runtime.status and pure validation are.
"""
import ast,base64,copy,hashlib,importlib.util,json,os,re,subprocess,sys
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
def adapt_fixture_repair_source(program,source_copy,committed_repair,entry):
 # Derive bytes from reviewed local source and the SHA-bound synthetic report,
 # never by substituting arbitrary installed-package bytes into the reader.
 name='deploy/ui-retention/failed_prepare_repair.py'
 original=(ROOT/name).read_bytes()
 assert 0<len(original)<=256*1024
 mapping=source_copy['releaseIdToRealGitCommit'];templates=source_copy['gitTemplates']
 assert isinstance(mapping,dict) and 0<len(mapping)<=256 and isinstance(templates,dict)
 release=r'[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z'
 assert len(set(mapping.values()))==len(mapping) and set(mapping).isdisjoint(mapping.values())
 for old,new in mapping.items():
  assert re.fullmatch(release,old) and re.fullmatch(release,new) and old[12:]==new[12:]
  item=templates[new]
  assert set(item)=={'head','tree'} and re.fullmatch(r'[0-9a-f]{40}',item['head']) and re.fullmatch(r'[0-9a-f]{40}',item['tree'])
  assert new[:12]==item['head'][:12]
 used=set(re.findall(release,original.decode()))
 assert used and used<=set(mapping)
 derived=original
 for old in sorted(used):derived=derived.replace(old.encode(),mapping[old].encode())
 assert derived==committed_repair,'Derived fixture repair source differs from authenticated Git blob'
 assert entry=={'bytes':len(derived),'sha256':sha(derived)},'Fixture repair source manifest differs'
 matches=[n for n in ast.walk(ast.parse(program)) if isinstance(n,ast.Assign)
  and any(isinstance(t,ast.Name) and t.id=='repair_source' for t in n.targets)]
 assert len(matches)==1,'Fixture repair bootstrap is not unique'
 value=matches[0].value
 assert isinstance(value,ast.Call) and isinstance(value.func,ast.Attribute)
 assert isinstance(value.func.value,ast.Name) and value.func.value.id=='base64' and value.func.attr=='b64decode'
 assert len(value.args)==1 and not value.keywords
 arg=value.args[0]
 assert isinstance(arg,ast.Constant) and isinstance(arg.value,str)
 assert base64.b64decode(arg.value,validate=True)==original,'Original repair bootstrap source differs'
 literal=ast.get_source_segment(program,arg);assert literal and program.count(literal)==1
 adapted=program.replace(literal,json.dumps(base64.b64encode(derived).decode()),1)
 return adapted,{'sourceSha256':sha(original),'derivedSha256':sha(derived),
  'committedGitBlobSha256':sha(committed_repair),'releaseIds':{old:mapping[old] for old in sorted(used)}}

def fixture_repair_loader(base,committed_repair,derivation):
 # The preceding bootstrap adaptation independently derives these exact bytes.
 assert sha(committed_repair)==derivation['derivedSha256']==derivation['committedGitBlobSha256']
 assert base.is_absolute() and '..' not in base.parts
 assert str(base).startswith('/tmp/') or '.retirement-test-tmp' in base.parts
 path=ROOT/'deploy/ui-retention/failed_prepare_repair.py'
 original=committed_repair.decode()
 source=original
 substitutions={}
 for prefix in ('/var/backups/proofofwork-ui','/etc/proofofwork-retention','/var/lib/proofofwork-ui-retention'):
  assert prefix in source
  replacement=str(base/prefix.lstrip('/'))
  assert replacement not in original
  substitutions[prefix]=replacement
  source=source.replace(prefix,replacement)
 def fixture_load(name,requested):
  assert name=='retirement_repair_paths' and requested==path,'Unexpected fixture helper load'
  spec=importlib.util.spec_from_file_location(name,path)
  module=importlib.util.module_from_spec(spec)
  exec(compile(source,str(path),'exec'),module.__dict__)
  assert module.BASE==str(base/'var/backups/proofofwork-ui/cleanup-evidence')
  return module
 return fixture_load,{'sourceSha256':sha(committed_repair),'adaptedSha256':sha(source.encode()),'namespace':substitutions}

def test_fixture_repair_source():
 original=(ROOT/'deploy/ui-retention/failed_prepare_repair.py').read_bytes()
 ids=set(re.findall(r'[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z',original.decode()))
 heads={old:sha(old.encode())[:40] for old in ids}
 mapping={old:heads[old][:12]+old[12:] for old in ids}
 source={'releaseIdToRealGitCommit':mapping,'gitTemplates':{
  mapping[old]:{'head':heads[old],'tree':'b'*40} for old in ids}}
 derived=original
 for old in sorted(ids):derived=derived.replace(old.encode(),mapping[old].encode())
 entry={'bytes':len(derived),'sha256':sha(derived)}
 program='\n'.join(['import base64,hashlib',
  'repair_source=base64.b64decode('+json.dumps(base64.b64encode(original).decode())+')',
  'assert len(repair_source)==repair_entry["bytes"] and hashlib.sha256(repair_source).hexdigest()==repair_entry["sha256"]',''])
 adapted,derivation=adapt_fixture_repair_source(program,source,derived,entry)
 assert adapted.splitlines()[-1]==program.splitlines()[-1]
 exec(compile(adapted,'<fixture-repair-self-test>','exec'),{'repair_entry':entry})
 rejected=0
 def rejects(p=program,s=source,b=derived,e=entry):
  nonlocal rejected
  try:adapt_fixture_repair_source(p,s,b,e)
  except (AssertionError,KeyError,ValueError,TypeError):rejected+=1;return
  raise AssertionError('Fixture source tamper accepted')
 rejects(b=derived+b'\n# altered')
 rejects(e=dict(entry,bytes=entry['bytes']+1));rejects(e=dict(entry,sha256='f'*64))
 rejects(p=program.replace(base64.b64encode(original).decode(),base64.b64encode(original+b'\n# altered').decode()))
 rejects(p=program+program.splitlines()[1]+'\n')
 rejects(p=program.replace('base64.b64decode','base64.b64encode'))
 missing=copy.deepcopy(source);missing['releaseIdToRealGitCommit'].pop(next(iter(ids)));rejects(s=missing)
 altered=copy.deepcopy(source);old=next(iter(ids));new='f'*12+old[12:]
 altered['releaseIdToRealGitCommit'][old]=new;altered['gitTemplates'][new]={'head':'f'*40,'tree':'b'*40};rejects(s=altered)
 malformed=copy.deepcopy(source);old=next(iter(ids));malformed['releaseIdToRealGitCommit'][old]='not-a-release';rejects(s=malformed)
 # Exercise the actual unchanged closed reader with only a fixture helper loader.
 base=Path('/tmp/retirement-consumer-namespace-self-test')
 fixture_load,namespace_proof=fixture_repair_loader(base,derived,derivation)
 successor=load('consumer_namespace_self_test',ROOT/'scripts/retirement-current-evidence.py')
 successor.load_module=fixture_load
 successor.RET_EVIDENCE_DIR=str(base/'var/backups/proofofwork-ui/cleanup-evidence/exact-retirement')
 class Rules:_REPAIR_PUBLICATION_FILES={}
 valid=str(base/('var/backups/proofofwork-ui/cleanup-evidence/ui-lifecycle-upgrade-'+('a'*64)+'/verified.json'))
 # Path joining above must remain explicit and absolute.
 raw,bound,publication,consumed=successor.lifecycle_readers(Rules,{valid:b'{}'},[],{})
 assert raw(valid)==b'{}';consumed()
 namespace_rejections=0
 def reject_namespace(call):
  nonlocal namespace_rejections
  try:call()
  except (AssertionError,ValueError,KeyError):namespace_rejections+=1;return
  raise AssertionError('Fixture namespace tamper accepted')
 reject_namespace(lambda:fixture_load('unrelated',ROOT/'deploy/ui-retention/failed_prepare_repair.py'))
 reject_namespace(lambda:fixture_load('retirement_repair_paths',ROOT/'scripts/retirement-current-evidence.py'))
 reject_namespace(lambda:fixture_repair_loader(base,derived+b'# forged',derivation))
 reject_namespace(lambda:fixture_repair_loader(Path('/var/backups/forged'),derived,derivation))
 for wrong in (valid.replace(str(base),''),valid.replace(str(base),str(base)+'-sibling'),
               valid.replace('/verified.json','/unexpected.json'),valid.replace('a'*64,'z'*64),
               valid.replace('/cleanup-evidence/','/cleanup-evidence/../')):
  reject_namespace(lambda wrong=wrong:successor.lifecycle_readers(Rules,{wrong:b'{}'},[],{}))
 reject_namespace(lambda:successor.lifecycle_readers(Rules,{},[valid],{}))
 _,_,_,unconsumed=successor.lifecycle_readers(Rules,{valid:b'{}'},[],{})
 reject_namespace(unconsumed)
 print(json.dumps({'ok':True,'fixtureRepairSourceTamperCasesRejected':rejected,
  'fixtureNamespaceTamperCasesRejected':namespace_rejections,'namespaceDerivation':namespace_proof,'productionActions':False}))


def main(report_path,expected_sha):
 p=Path(report_path);raw=p.read_bytes();assert sha(raw)==expected_sha
 report=json.loads(raw);assert report['qualifiedTerminalRetirement'] is True and report['productionActions'] is False
 base=Path(report['fixtureBase']);assert base.resolve()==base and base.is_dir()
 assert base==p.parent and (str(base).startswith('/tmp/') or '.retirement-test-tmp' in base.parts)
 cfg=base/'etc/proofofwork-retention/ui-lifecycle.json'
 state=base/'var/lib/proofofwork-ui-retention/state.json'
 assert cfg.is_file() and state.is_file()
 exports=json.loads(subprocess.check_output([NODE,'--input-type=module','-e',
  'import {retirementReadProgram,retirementCurrentReadProgram,installedRetentionProgram,retentionPackageFiles} from "./scripts/retirement-evidence.mjs";console.log(JSON.stringify({retirementReadProgram,retirementCurrentReadProgram,installedRetentionProgram,retentionPackageFiles}));'],
  cwd=ROOT,timeout=30))
 package=Path(report['package']['path']);manifest=json.loads((package/'package.json').read_bytes())
 assert set(manifest['files'])==set(exports['retentionPackageFiles'])
 origins=[]
 for origin in base.glob('operator-source-*'):
  if subprocess.check_output(['git','-C',str(origin),'rev-parse','HEAD'],text=True).strip()==report['operator']['commit']:origins.append(origin)
 assert len(origins)==1;origin=origins[0]
 assert subprocess.check_output(['git','-C',str(origin),'rev-parse','HEAD^{tree}'],text=True).strip()==report['operator']['tree']
 files={};committed_repair=None
 for name in exports['retentionPackageFiles']:
  entry=subprocess.check_output(['git','-C',str(origin),'ls-tree',report['operator']['commit'],'--',name],text=True)
  assert entry.startswith(('100644 blob ','100755 blob ')) and entry.endswith('\t'+name+'\n')
  data=subprocess.check_output(['git','-C',str(origin),'show',report['operator']['commit']+':'+name])
  files[name]={'bytes':len(data),'sha256':sha(data)}
  if name=='deploy/ui-retention/failed_prepare_repair.py':committed_repair=data
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
 assert attestation['mode']=='operator-retirement-package' and attestation['currentPackageSha256']==expected['sha256']
 bad=copy.deepcopy(expected);bad['sha256']='f'*64;fail(installed,{'expected':bad})
 # Execute actual installed policy only after authenticating package bytes.
 L=load('consumer_actual_installed_lifecycle',package/'deploy/ui-retention/lifecycle_remote.py')
 runtime=L.installed_runtime(cfg,attestation['configSha256'])
 fd=runtime.S.lock(runtime.layout);runtime.lock_fd=fd
 try:status=runtime.status({'requireComplete':True})
 finally:runtime.lock_fd=None;os.close(fd)
 assert status==report['status'],'Actual lifecycle changed from retained terminal report'
 assert status['verifiedRetirementPolicyCodeSha256']==attestation['policyCodeSha256']
 assert status.get('verifiedCurrentPackageSha256',status['verifiedRetirementPolicyCodeSha256'])==attestation['currentPackageSha256']
 assert status.get('verifiedRetirementSourceConfig')==attestation['retirementSourceConfig']
 trusted={'configSha256':status['configSha256'],'stateSha256':status['stateSha256'],
  'currentIndexSha256':status['index']['sha256'],'policyCodeSha256':attestation['policyCodeSha256'],'verifiedCurrentPair':status['pair']}
 R=load('consumer_fixture_authority',package/'deploy/ui-retention/retirement_receipt.py')
 current=attestation['retirementSourceConfig'] is not None
 if current:trusted.update(currentPackageSha256=attestation['currentPackageSha256'],retirementSourceConfig=attestation['retirementSourceConfig'])
 program=namespace(exports['retirementCurrentReadProgram' if current else 'retirementReadProgram'])
 repair_derivation=None;repair_namespace=None
 if current:
  program,repair_derivation=adapt_fixture_repair_source(program,
   report['baseline']['substitutions']['sourceCopy'],committed_repair,
   manifest['files']['deploy/ui-retention/failed_prepare_repair.py'])
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
 validate=module['validate_dual_retirement_evidence']
 if current:
  successor=load('consumer_current_release_validator',ROOT/'scripts/retirement-current-evidence.py')
  # Only the fixture namespace/authority pins and fixture cardinality differ.
  # The production successor validator and real package ancestry checks execute.
  successor.__dict__.update({key:value for key,value in module.items() if key.startswith('RET_')})
  successor.load_receipt_module=lambda:R
  successor.load_module,repair_namespace=fixture_repair_loader(base,committed_repair,repair_derivation)
  validate=successor.validate_current_retirement_evidence
 result=validate(bundle,trusted)
 assert result['proof']==status['verifiedRetiredPayloads'] and result['verifiedCurrentPair']==status['pair']
 assert result['filesystemVerified'] is False and result['activationAllowed'] is False
 current_rejections=0
 if current:
  assert result['currentPackageSha256']==attestation['currentPackageSha256']
  assert result['policyCodeSha256']!=result['currentPackageSha256']
  upgrade_path=json.loads(base64.b64decode(bundle['state']['base64']))['lastUpgrade']['statusVerificationPath']
  for mutation in ('missing-current-seal','altered-current-seal','missing-origin','extra-evidence','wrong-current-package','retargeted-policy','altered-origin'):
   bad=copy.deepcopy(bundle);bad_trusted=copy.deepcopy(trusted)
   if mutation=='missing-current-seal':bad['lifecycleEvidence']=[r for r in bad['lifecycleEvidence'] if r['path']!=upgrade_path]
   elif mutation=='altered-current-seal':
    row=next(r for r in bad['lifecycleEvidence'] if r['path']==upgrade_path)
    data=json.loads(base64.b64decode(row['base64']));data['ok']=False;raw=encoded(data)
    row.update(base64=base64.b64encode(raw).decode(),sha256=sha(raw))
   elif mutation=='missing-origin':bad['lifecycleEvidence']=[r for r in bad['lifecycleEvidence'] if r['path']!=attestation['retirementSourceConfig']['path']]
   elif mutation=='extra-evidence':bad['lifecycleEvidence'].append(copy.deepcopy(bad['lifecycleEvidence'][0]))
   elif mutation=='wrong-current-package':bad_trusted['currentPackageSha256']=trusted['policyCodeSha256']
   elif mutation=='retargeted-policy':bad_trusted['policyCodeSha256']=trusted['currentPackageSha256']
   else:bad_trusted['retirementSourceConfig']['sha256']='f'*64
   try:validate(bad,bad_trusted)
   except (ValueError,AssertionError,KeyError):current_rejections+=1
   else:raise AssertionError('Accepted current '+mutation+' tamper')
 for mutation in ('terminal','sidecars','finalProofs','state','currentIndex'):
  bad=copy.deepcopy(bundle)
  if mutation=='terminal':bad['terminal']['base64']='e30='
  elif mutation=='sidecars':bad['sidecars'].pop()
  elif mutation=='finalProofs':bad['finalProofs']={}
  elif mutation=='state':bad['state']['sha256']='f'*64
  else:bad['currentIndex']['path']='/tmp/forged.json'
  try:validate(bad,trusted)
  except (ValueError,AssertionError):pass
  else:raise AssertionError('Accepted '+mutation+' tamper')
 untouched=load('consumer_untouched_production_validator',validator_path)
 try:untouched.validate_dual_retirement_evidence(bundle,trusted)
 except (ValueError,AssertionError):pass
 else:raise AssertionError('Untouched production pins accepted synthetic fixture')
 print(json.dumps({'ok':True,'reportSha256':expected_sha,'report':str(p),'realInstalledStatus':True,
  'packageGitBlobAttestation':True,'rawReaderValidated':True,'pureConsumerValidated':True,
  'tamperCasesRejected':6+current_rejections,'currentReleaseSuccessor':current,'productionPinsRejectFixture':True,'productionActions':False,
  'fixtureRepairSourceDerivation':repair_derivation,'fixtureRepairNamespace':repair_namespace,
  'brandedGitAndSshTransportExercised':False,'boundaries':['synthetic namespace and exact authority pins',
   'ancestor trust anchored at protected fixture root rather than writable /tmp',
   'restored-entry cardinality is fixture-specific','no production authorization or activation proof'],
  'programHashes':{k:sha(exports[k].encode()) for k in ('retirementReadProgram','retirementCurrentReadProgram','installedRetentionProgram')},
  'substitutions':{'namespace':str(base),'pins':{k:(list(v) if isinstance(v,tuple) else v) for k,v in pins.items()},'restoredEntries':restored}},sort_keys=True))
if __name__=='__main__':
 if sys.argv[1:]==['--self-test-repair-source']:test_fixture_repair_source()
 else:
  assert len(sys.argv)==3,'Supply retained SYNTHETIC report path and exact SHA'
  main(*sys.argv[1:])
