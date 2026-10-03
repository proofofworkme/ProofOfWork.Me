#!/usr/bin/python3 -I -B
"""Exact local1414-row custody successor for four preserved public byte envelopes."""
import argparse,base64,hashlib,json,os,pathlib,re,stat,sys,types
R=pathlib.Path('/home/sixer/ProofOfWork.Me');T=pathlib.Path('/tmp');D='deploy/audit30/verification/'
LIB=T/'pow-audit30-item2-source-custody-append-v3.py';LIBSHA='ca2fd5cb416aa62c077b26426ac1243bb23f2e2839b0ec2a71fe2b6d4d5217c4'
FIXED={'pow-audit30-item2-ui-refusal-exact-receive-admission.log':(148,'651f59222a471759ecacf8e0a1d9035c179913e3a41e8df08bf391dce4b747ae'),'pow-audit30-item2-ui-refusal-exact-receiver.log':(349,'e5d4860608f45275ff4661893e81d2d623ab953da37985aab865905e8f519e40'),'pow-audit30-item2-ui-surfaces-stage-v1.log':(533,'80880387c742c85fa2642002ab6666d6139adc19f3b00baef24918cd156d4f8c'),'pow-audit30-production-v2-passive-read-v1.test.py':(6888,'8b6d8fce41a9b6c31a3e7351c959392f42b736b4147b35b2173052f213d7d7fc')}
def need(v,c):
 if not v:raise ValueError(c)
def library():
 raw=LIB.read_bytes();need(hashlib.sha256(raw).hexdigest()==LIBSHA,'FROZEN_LIBRARY_PIN')
 g=types.ModuleType('frozen_custody_v3');g.__file__=str(LIB);exec(compile(raw,str(LIB),'exec'),g.__dict__);return g

def main():
 need(sys.flags.isolated,'ISOLATED_LOCAL');g=library();p=argparse.ArgumentParser(description=__doc__);p.add_argument('--manifest',required=True);p.add_argument('--manifest-sha256',required=True);p.add_argument('--preview');p.add_argument('--apply',action='store_true');p.add_argument('--reviewed-preview');p.add_argument('--reviewed-preview-sha256');p.add_argument('--root-reviewed',action='store_true');a=p.parse_args()
 need(bool(a.preview)!=a.apply and re.fullmatch('[0-9a-f]{64}',a.manifest_sha256),'EXACT_PREVIEW_OR_APPLY')
 mp=pathlib.Path(a.manifest);need(mp.parent==T,'LOCAL_MANIFEST_ONLY');mr=g.read(mp);need(g.sha(mr)==a.manifest_sha256,'MANIFEST_PIN');m=g.parse(mr)
 need(set(m)=={'schema','custodyPreimage','atUtc','files','additionalQualification','publicReviewed','privateDataIncluded','storedRepresentationAdditions'}and m['schema']=='pow-audit30-item2-custody-hygiene-representations-v1','FIXED_MANIFEST_SHAPE')
 oldraw=g.read(g.CUSTODY);need(len(oldraw)==g.BASE_BYTES and g.sha(oldraw)==g.BASE_SHA and g.BASE_ROWS==1414,'EXACT_1414_PREIMAGE');old=g.parse(oldraw);g.validate_prior(old)
 need(len(m['files'])==4 and set(m['storedRepresentationAdditions'])=={D+n for n in FIXED},'EXACT_FOUR_SCOPE')
 prior={r['repositoryPath']:r for r in old['files']};files={r['repositoryPath']:r for r in m['files']};need(set(files)=={D+n+'.evidence.json'for n in FIXED},'FOUR_ENVELOPE_PATHS')
 for name,(count,digest)in FIXED.items():
  rawpath=D+name;envpath=rawpath+'.evidence.json';row=prior[rawpath];need(row['bytes']==count and row['sha256']==digest and row['originalPath']==str(T/name),'EXACT_PRIOR_RAW_IDENTITY')
  original=g.read(T/name);retained=g.read(R/rawpath);need(original==retained and len(original)==count and g.sha(original)==digest,'ORIGINAL_RETAINED_RAW_UNCHANGED')
  erow=files[envpath];need(erow['originalPath']==str(T/name)and erow['representation']=='closed-base64-envelope-preserves-exact-raw-input'and erow['rawBytes']==count and erow['rawSha256']==digest,'EXACT_NEW_ENVELOPE_ROW')
  env=g.read(R/envpath);need(g.envelope(env,str(T/name),count,digest)==original,'EXACT_ENVELOPE_DECODE')
  expected={'repositoryPath':envpath,'storedBytes':len(env),'storedSha256':g.sha(env),'encoding':'base64','rawBytes':count,'rawSha256':digest,'originalInputRetainedUnchanged':True,'rawWorkspaceRetainedUnchanged':True,'rawRepositoryTracking':'retained-untracked-local','decodedIdentity':{'originalInput':str(T/name),'rawBytes':count,'rawSha256':digest,'byteEqualToOriginalInput':True,'byteEqualToRetainedRawRepositoryFile':True}}
  need(m['storedRepresentationAdditions'][rawpath]==expected and rawpath not in old['storedRepresentations'],'EXACT_NEW_MAPPING')
 base={k:v for k,v in m.items()if k!='storedRepresentationAdditions'};base['schema']='pow-audit30-item2-source-custody-append-manifest-v1';new=g.parse(g.build(old,base));new['storedRepresentations'].update(m['storedRepresentationAdditions'])
 need(new['files'][:1414]==old['files']and len(new['files'])==1418 and len(new['storedRepresentations'])==8 and all(new['storedRepresentations'][k]==v for k,v in old['storedRepresentations'].items()),'ORIGINAL_PREFIX_OR_FOUR_MAPS_CHANGED')
 for k in old:
  if k not in ('files','atUtc','qualification','storedRepresentations'):need(new[k]==old[k],'OLD_FIELD_CHANGED')
 out=(json.dumps(new,indent=2,sort_keys=True)+'\n').encode()
 if a.apply:
  need(a.root_reviewed and a.reviewed_preview and a.reviewed_preview_sha256 and re.fullmatch('[0-9a-f]{64}',a.reviewed_preview_sha256),'SEPARATE_ROOT_REVIEW_REQUIRED');pp=pathlib.Path(a.reviewed_preview);need(pp.parent==T,'REVIEWED_PREVIEW_LOCAL');pr=g.read(pp);need(g.sha(pr)==a.reviewed_preview_sha256 and pr==out,'EXACT_REVIEWED_POSTIMAGE')
  mode=stat.S_IMODE(g.CUSTODY.lstat().st_mode);need(g.CUSTODY.lstat().st_uid==os.getuid()and g.read(g.CUSTODY)==oldraw,'OLD_OWNER_OR_PREIMAGE_DRIFT');temp=g.CUSTODY.with_name('source-custody.item2-hygiene-envelope-v1.tmp');g.exclusive(temp,out,mode);need(g.read(g.CUSTODY)==oldraw,'PRE_REPLACE_DRIFT');os.replace(temp,g.CUSTODY);g.sync_directory(g.CUSTODY.parent);need(g.read(g.CUSTODY)==out,'POSTIMAGE_DRIFT');target=g.CUSTODY;operation='applied'
 else:
  need(not a.root_reviewed and not a.reviewed_preview and not a.reviewed_preview_sha256,'PREVIEW_ONLY');target=pathlib.Path(a.preview);need(target.parent==T and target.resolve(strict=False)==target,'PREVIEW_LOCAL');g.exclusive(target,out);operation='previewed'
 print(json.dumps({'schema':'pow-audit30-item2-custody-hygiene-representations-result-v1','operation':operation,'path':str(target),'bytes':len(out),'sha256':g.sha(out),'historicalRowsPreserved':1414,'newEnvelopeRows':4,'totalRows':1418,'historicalMappingsPreserved':4,'newMappings':4,'totalStoredMappings':8,'rawOriginalsRetainedUnchanged':True,'noGitOrRemoteCalls':True},sort_keys=True))
if __name__=='__main__':main()
