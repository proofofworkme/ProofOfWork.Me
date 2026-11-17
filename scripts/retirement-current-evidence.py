#!/usr/bin/env python3
"""Current-release retirement consistency, separate from fixed historical qualification.

The historical terminal/index checks intentionally retain the frozen validator's
rules. Current config/state bytes are never relabeled as historical bytes. Package
identity must be independently attested before this pure reader is called.
"""
import importlib.util,json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
def load_module(name,path):
 spec=importlib.util.spec_from_file_location(name,path)
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
H=load_module('retirement_historical_rules',ROOT/'deploy/linked-publish/qualification.py')
for name in dir(H):
 if name.startswith('RET_') or name in ('need','dual_json'):globals()[name]=getattr(H,name)
def load_receipt_module():return load_module('retirement_current_rules',ROOT/'deploy/ui-retention/retirement_receipt.py')

def lifecycle_readers(R,rows,absent,external):
 """Closed evidence readers. Missing bytes never fall back to the filesystem."""
 repair=load_module('retirement_repair_paths',ROOT/'deploy/ui-retention/failed_prepare_repair.py')
 allowed={RET_EVIDENCE_DIR+'/'+name for name in ('successor-config.json','transition-completed.json','prior-config.json','prior-state.json')}
 allowed.update(ref['path'] for ref in repair.PIN.values() if isinstance(ref,dict) and set(ref)=={'path','sha256'})
 allowed.update(R._REPAIR_PUBLICATION_FILES)
 for directory,names in ((repair.JOURNAL,('intent.json','repaired.json','verified.json','prior-config.json','prior-state.json','ordinary-plan.json')),
                         (repair.READER_JOURNAL,('intent.json','installed.json','verified.json','prior-config.json','prior-state.json'))):
  allowed.update(directory+'/'+name for name in names)
 absence_allowed={repair.BASE+'/ui-lifecycle-release-'+repair.RELEASE+suffix for suffix in ('-ordinary-plan.json','-completed.json')}
 absence_allowed.add(repair.JOURNAL+'/verified.json')
 need(isinstance(absent,list) and all(isinstance(p,str) for p in absent) and len(absent)==len(set(absent)) and set(absent)<=absence_allowed,'Unexpected lifecycle absence inventory')
 need(not set(absent).intersection(rows),'Lifecycle evidence also declared absent')
 for path in rows:
  if path in allowed:continue
  p=Path(path)
  upgrade=(p.parent.parent==Path(repair.BASE) and re.fullmatch(r'ui-lifecycle-upgrade-[a-f0-9]{64}',p.parent.name) and p.name in ('intent.json','completed.json','verified.json','prior-config.json','prior-state.json'))
  package=(p.parent.parent==Path(repair.BASE) and re.fullmatch(r'ui-lifecycle-tools-[a-f0-9]{64}',p.parent.name) and p.name=='package.json')
  index=(p.parent==Path(repair.BASE) and re.fullmatch(r'audit30-policy-admission-index-[A-Za-z0-9-]{1,160}\.json',p.name))
  need(upgrade or package or index,'Unexpected lifecycle evidence path')
 used=set();used_absent=set()
 def raw_bound(path,limit=16*1024**2):
  path=str(path)
  if path in absent:
   used_absent.add(path);raise FileNotFoundError(path)
  if path in external:raw=external[path]()
  else:
   need(path in rows,'Missing lifecycle evidence')
   raw=rows[path];used.add(path)
  need(len(raw)<=limit,'Lifecycle evidence exceeds read bound');return raw
 def bound(path,digest,limit=16*1024**2):
  raw=raw_bound(path,limit);need(RET_digest(raw)==digest,'Lifecycle evidence digest differs');return raw
 def publication(path,expected):
  pin=R._REPAIR_PUBLICATION_FILES.get(str(path))
  need(pin is not None and pin[0]==expected,'Repair publication binding differs')
  raw=bound(path,expected,pin[1]);need(len(raw)==pin[1],'Repair publication size differs');return raw
 def consumed():
  need(used==set(rows) and used_absent==set(absent),'Unconsumed lifecycle evidence or absence')
 return raw_bound,bound,publication,consumed

def validate_current_retirement_evidence(bundle,trusted):
 """Pure authenticated-byte consistency, NOT filesystem or permission validation.

 Trusted bindings must be supplied independently by fresh installed lifecycle
 verification (including installed policy code), never derived from this bundle.
 """
 import base64,binascii
 need(isinstance(trusted,dict) and set(trusted)=={'configSha256','stateSha256','currentIndexSha256','policyCodeSha256','verifiedCurrentPair','currentPackageSha256','retirementSourceConfig'},'Independent lifecycle retirement bindings required')
 for key in ('configSha256','stateSha256','currentIndexSha256','policyCodeSha256','currentPackageSha256'):RET_hash_value(trusted[key])
 need(isinstance(bundle,dict) and set(bundle)-{'lifecycleAbsentPaths'}=={'terminal','ownerApproval','config','state','sourceIndex','currentIndex','appendedAdmissions','sidecars','finalProofs','proposal','inventory','staticRestore','lifecycleEvidence'},'Exact raw retirement inventory required')
 total=0
 def read(row,path=None,digest=None):
  nonlocal total
  need(isinstance(row,dict) and set(row)=={'path','base64','sha256'},'Exact raw retirement reference required')
  p=row['path'];need(isinstance(p,str) and p.startswith('/') and str(Path(p))==p and '..' not in Path(p).parts,'Noncanonical evidence path')
  need(path is None or p==path,'Retirement evidence path differs')
  RET_hash_value(row['sha256']);need(digest is None or row['sha256']==digest,'Retirement expected digest differs')
  need(isinstance(row['base64'],str) and len(row['base64'])<=24*1024**2,'Oversized retirement encoding')
  try:raw=base64.b64decode(row['base64'],validate=True)
  except (ValueError,binascii.Error) as error:raise ValueError('Malformed retirement base64') from error
  total+=len(raw);need(0<len(raw)<=16*1024**2 and total<=48*1024**2 and base64.b64encode(raw).decode()==row['base64'],'Retirement bytes limit/encoding differs')
  need(RET_digest(raw)==row['sha256'],'Retirement raw digest differs')
  return raw
 def obj(row,path=None,digest=None):return dual_json(read(row,path,digest))
 config=obj(bundle['config'],RET_CONFIG_PATH,trusted['configSha256'])
 state=obj(bundle['state'],RET_STATE_PATH,trusted['stateSha256'])
 need(config.get('schema')=='pow-ui-retention-lifecycle-config-v1' and config.get('statePath')==RET_STATE_PATH,'Retirement config scope differs')
 need(config.get('package',{}).get('sha256')==trusted['currentPackageSha256'],'Verified current package manifest differs')
 need(config.get('payloadRetirementSourceConfig')==trusted['retirementSourceConfig'],'Verified retirement origin differs')
 need(state.get('schema')=='pow-ui-retention-lifecycle-state-v1' and state.get('configSha256')==trusted['configSha256'] and state.get('pending','missing') is None,'Retirement lifecycle state not stable')
 binding=config.get('payloadRetirement')
 need(isinstance(binding,dict) and set(binding)=={'mode','proposalSha256','receipt','priorConfigSha256','sourceIndex','policyCodeSha256'} and binding['mode']=='complete','Retirement config incomplete')
 need(binding['proposalSha256']==RET_PROPOSAL_SHA and binding['priorConfigSha256']==RET_PRIOR_CONFIG_SHA and binding['sourceIndex']==RET_SOURCE_INDEX and binding['policyCodeSha256']==trusted['policyCodeSha256'],'Retirement config authority differs')
 need(isinstance(binding['receipt'],dict) and set(binding['receipt'])=={'path','sha256'} and binding['receipt']['path']==RET_TERMINAL_PATH,'Wrong terminal reference')
 terminal_raw=read(bundle['terminal'],RET_TERMINAL_PATH,binding['receipt']['sha256'])
 terminal=dual_json(terminal_raw)
 need(RET_encoded(terminal)==terminal_raw,'Noncanonical terminal bytes')
 need(set(terminal)=={'schema','proposalSha256','inventorySha256','restoreSha256','approvalSha256','journal','journalHeadSha256','retiredPayloadPaths','retirementRetainedPair','sourceIndex','preservedSidecars','preservedHistoricalEvidenceSha256','priorConfigSha256','policyCodeSha256'},'Terminal receipt fields differ')
 need(terminal['schema']=='pow-exact-payload-retirement-completed-v1' and terminal['proposalSha256']==RET_PROPOSAL_SHA and terminal['inventorySha256']==RET_INVENTORY_SHA and terminal['restoreSha256']==RET_RESTORE_SHA and terminal['retiredPayloadPaths']==list(RET_PATHS) and terminal['retirementRetainedPair']==RET_PAIR and terminal['sourceIndex']==RET_SOURCE_INDEX and terminal['priorConfigSha256']==RET_PRIOR_CONFIG_SHA and terminal['policyCodeSha256']==trusted['policyCodeSha256'],'Terminal scope differs')
 approval=obj(bundle['ownerApproval'],RET_EVIDENCE_DIR+'/owner-approval.json',terminal['approvalSha256'])
 need(set(approval)=={'schema','proposalSha256','retiredPayloadPaths','retainedPair','permanent','sourceMessageId','approvedAtUtc'} and approval['schema']=='pow-owner-exact-payload-retirement-approval-v1' and approval['proposalSha256']==RET_PROPOSAL_SHA and approval['retiredPayloadPaths']==list(RET_PATHS) and approval['retainedPair']==RET_PAIR and approval['permanent'] is True and all(isinstance(approval[k],str) and approval[k].strip() for k in ('sourceMessageId','approvedAtUtc')),'Exact owner approval evidence differs')
 chain=RET_validate_chain(terminal['journal'])
 need(chain['status']=='complete' and chain['lastSha256']==terminal['journalHeadSha256'] and chain['approvalSha256']==terminal['approvalSha256'],'Unresolved or unauthenticated terminal journal')
 final=terminal['journal'][-1]['data'];need(final['successorPolicyCodeSha256']==trusted['policyCodeSha256'],'Terminal successor code differs')
 proof_names={'finalFenceSha256':'final-fence.json','retainedPairProofSha256':'retained-pair-proof.json','sidecarsProofSha256':'sidecars-proof.json','historicalEvidenceProofSha256':'historical-evidence-proof.json'}
 need(isinstance(bundle['finalProofs'],dict) and set(bundle['finalProofs'])==set(proof_names),'Missing final proof documents')
 for key,name in proof_names.items():
  raw=read(bundle['finalProofs'][key],RET_EVIDENCE_DIR+'/'+name,final[key])
  if key=='sidecarsProofSha256':
   # The installed controller emits the canonical exact sidecar list, not an
   # object. Bind its bytes to the terminal list (and below to the proposal).
   need(raw==RET_encoded(terminal['preservedSidecars']),'Final sidecar proof differs from exact terminal list')
  else:dual_json(raw)
 need(terminal['preservedHistoricalEvidenceSha256']==final['historicalEvidenceProofSha256'],'Historical proof binding differs')
 proposal_raw=read(bundle['proposal'],RET_EVIDENCE_DIR+'/proposal.json',RET_PROPOSAL_SHA)
 inventory_raw=read(bundle['inventory'],RET_EVIDENCE_DIR+'/inventory.json',RET_INVENTORY_SHA)
 restore_raw=read(bundle['staticRestore'],RET_EVIDENCE_DIR+'/static-restore.json',RET_RESTORE_SHA)
 # Duplicate-key refusal precedes authoritative exact pinned proposal parsing.
 for raw in (proposal_raw,inventory_raw,restore_raw):dual_json(raw)
 proposal=RET_authenticate_proposal(proposal_raw,inventory_raw,restore_raw)
 sidecars=[{'path':r['path'],'sha256':r['sha256']} for r in proposal['sidecarsKeep']]
 need(terminal['preservedSidecars']==sidecars and isinstance(bundle['sidecars'],list) and len(bundle['sidecars'])==len(sidecars),'Sidecar scope differs')
 for row,pin in zip(bundle['sidecars'],sidecars):read(row,pin['path'],pin['sha256'])
 source=obj(bundle['sourceIndex'],RET_SOURCE_INDEX['path'],RET_SOURCE_INDEX['sha256'])
 index_binding=state.get('index')
 need(isinstance(index_binding,dict) and set(index_binding)=={'path','sha256'} and index_binding['sha256']==trusted['currentIndexSha256'],'State/current index binding differs')
 def policy_path(path,prefix):
  p=Path(path);need(p.parent==Path(RET_BASE+'/cleanup-evidence') and p.name.startswith(prefix) and p.name.endswith('.json'),'Wrong policy evidence path')
 policy_path(index_binding['path'],'audit30-policy-admission-index-')
 current=obj(bundle['currentIndex'],index_binding['path'],index_binding['sha256'])
 need(source.get('schema') in ('pow-audit30-ui-admission-index-v1','pow-ui-retention-admission-index-v2') and current.get('schema')==source['schema'] and current.get('scopeApprovalSha256')==source.get('scopeApprovalSha256')==config.get('scopeApprovalSha256'),'Admission index authority differs')
 prefix=source.get('admissions');rows=current.get('admissions')
 need(isinstance(prefix,list) and prefix and isinstance(rows,list) and len(prefix)<=len(rows)<=256 and rows[:len(prefix)]==prefix,'Source admission prefix changed')
 need(isinstance(source.get('completedRetirements',[]),list) and isinstance(current.get('completedRetirements',[]),list) and current.get('completedRetirements',[])[:len(source.get('completedRetirements',[]))]==source.get('completedRetirements',[]),'Historical retirement prefix changed')
 need(current.get('migration')==source.get('migration'),'Migration authority changed')
 for row in rows:
  need(isinstance(row,dict) and set(row)=={'path','sha256'},'Invalid admission reference');policy_path(row['path'],'audit30-policy-admission-');RET_hash_value(row['sha256'])
 need(len({r['path'] for r in rows})==len(rows),'Duplicate admissions')
 appended=bundle['appendedAdmissions'];need(isinstance(appended,list) and len(appended)==len(rows)-len(prefix),'Missing appended admissions')
 pair=RET_PAIR.copy()
 for row,pin in zip(appended,rows[len(prefix):]):
  admission=obj(row,pin['path'],pin['sha256'])
  need(admission.get('schema')=='pow-audit30-ordinary-ui-release-admission-v1' and admission.get('host')=='77.42.91.106' and admission.get('scopeApprovalSha256')==source.get('scopeApprovalSha256') and admission.get('bootstrap') is False and admission.get('migrationAnchor') is None,'Appended admission authority differs')
  next_pair=admission.get('retainedPair')
  need(isinstance(next_pair,dict) and set(next_pair)=={'current','previous'} and all(isinstance(v,str) and re.fullmatch(r'[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z',v) for v in next_pair.values()) and next_pair['previous']==pair['current'] and next_pair['current'] not in pair.values() and admission.get('releaseIds')==[next_pair['current']],'Descendant lineage differs')
  pair=next_pair
 need(pair==trusted['verifiedCurrentPair'],'Fresh independently verified pair differs')
 proof={'model':'intentionally-retired-payloads-retained-evidence-v1','proposalSha256':RET_PROPOSAL_SHA,'receipt':binding['receipt'],'receiptSha256':binding['receipt']['sha256'],'journalHeadSha256':terminal['journalHeadSha256'],'policyCodeSha256':trusted['policyCodeSha256'],'retiredPayloadPaths':list(RET_PATHS),'retirementRetainedPair':RET_PAIR.copy(),'sourceIndex':RET_SOURCE_INDEX.copy(),'recoveryVerification':'isolated-static-only'}
 need(current.get('payloadRetirement')==proof,'Current index retirement proof differs')
 # The current package and original retirement package are distinct authorities.
 # Replay the current receipt module against the authenticated byte inventory.
 # This is pure consistency validation: it never claims filesystem verification.
 evidence=bundle['lifecycleEvidence']
 need(isinstance(evidence,list) and 1<=len(evidence)<=100,'Bounded lifecycle evidence required')
 rows={}
 for row in evidence:
  raw=read(row)
  need(row['path'] not in rows,'Duplicate lifecycle evidence path')
  rows[row['path']]=raw
 R=load_receipt_module()
 raw_bound,bound,publication,consumed=lifecycle_readers(R,rows,bundle.get('lifecycleAbsentPaths',[]),{
  RET_SOURCE_INDEX['path']:lambda:read(bundle['sourceIndex'],RET_SOURCE_INDEX['path'],RET_SOURCE_INDEX['sha256']),
  bundle['currentIndex']['path']:lambda:read(bundle['currentIndex'],bundle['currentIndex']['path'],trusted['currentIndexSha256'])})
 R.read_raw_bound=raw_bound;R.read_bound=bound;R.read_repair_publication_bound=publication
 context=R.VerifiedRetirement(R.TOKEN,binding,terminal,proposal,dual_json(inventory_raw),source,None,None)
 need(context.proof==proof,'Current retirement module disagrees with immutable proof')
 context.verify_lifecycle_state(state,trusted['configSha256'],config=config)
 if trusted['retirementSourceConfig'] is None:
  need(trusted['currentPackageSha256']==trusted['policyCodeSha256'],'Original package identity differs')
 else:
  need(R.source_config(config)==trusted['retirementSourceConfig'],'Original source config differs')
 # verify_lifecycle_state above authenticates every native upgrade/repair edge,
 # including its current seal. Do not reinterpret repair markers as lastUpgrade.
 consumed()
 return {'ok':True,'proof':proof,'verifiedCurrentPair':pair,'configSha256':trusted['configSha256'],'stateSha256':trusted['stateSha256'],'currentIndexSha256':trusted['currentIndexSha256'],'policyCodeSha256':trusted['policyCodeSha256'],'currentPackageSha256':trusted['currentPackageSha256'],'retirementSourceConfig':trusted['retirementSourceConfig'],'filesystemVerified':False,'activationAllowed':False}

if __name__=='__main__':
 raw=sys.stdin.buffer.read(64*1024**2+1)
 need(len(raw)<=64*1024**2,'Current retirement evidence exceeds bound')
 request=dual_json(raw)
 need(isinstance(request,dict) and set(request)=={'bundle','trusted'},'Exact validation request required')
 print(json.dumps(validate_current_retirement_evidence(request['bundle'],request['trusted'])))
