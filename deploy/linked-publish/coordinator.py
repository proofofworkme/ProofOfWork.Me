"""Plan-bound linked Search prebuild and runtime cutover under one Search hold."""
import copy,hashlib,json,os,sys,time,runpy
from pathlib import Path
HERE=Path(__file__).resolve().parent
execute_phases=runpy.run_path(str(HERE/'phases.py'))['execute_phases']
_stage=runpy.run_path(str(HERE/'stage.py'))
stage_sources,run_stage,need=(_stage[k] for k in ('stage_sources','run_stage','need'))
def coordinate(release,plan,plan_sha):
 need(os.geteuid()==0 and sys.flags.isolated,'Use isolated root coordinator on node')
 engine=release['engine'];code=release['controller']()
 need(plan['controllerSha256']==hashlib.sha256(code).hexdigest(),'Controller changed')
 supervisor=engine['namespace'](engine['pinned']('amo-browse/rollout-node.py'))
 holder=supervisor['decoded'](plan,'searchHoldController')
 need(holder==engine['pinned']('search/hold-node-timer.py'),'Search holder changed')
 ns=engine['namespace'](code);manifest=copy.deepcopy(plan['runtimeManifestTemplate'])
 ns['validate_manifest'](manifest)
 need(manifest['sourceCommit']==plan['sourceCommit'] and manifest['releaseId']==plan['releaseId'],'Plan binding mismatch')
 path=stage_sources(release,plan,plan_sha)
 manifest['linkedStage']={'path':str(path),'sha256':hashlib.sha256((path/'stage.json').read_bytes()).hexdigest()}
 files=manifest['searchHold']['bindings']['files']
 hold_args=['--release-id',plan['releaseId'],'--attempt','initial','--service-sha256',files[ns['SEARCH'][0]],'--timer-sha256',files[ns['SEARCH'][1]]]
 outcome={'format':'linked-publish-prebuild-rollout-v1','releaseId':plan['releaseId'],'sourceCommit':plan['sourceCommit'],'planSha256':plan_sha,'stage':str(path),'writerEnabled':False}
 class Operations:
  sequence=0
  marker=None
  def hold(self):
   result=supervisor['invoke'](holder,['--phase','hold',*hold_args])
   self.marker=ns['safe_read'](ns['HOLD'],65536)
   manifest['searchHold']['markerSha256']=ns['sha'](self.marker)
   ns['validate_manifest'](manifest);self.check_hold()
   return result
  def check_hold(self):
   need(self.marker is not None and ns['safe_read'](ns['HOLD'],65536)==self.marker,'Search hold changed')
   need(all(json.loads(self.marker).get(k)==v for k,v in manifest['searchHold']['bindings'].items()),'Wrong Search hold')
   ns['require_search_held'](ns['states'](ns['SEARCH']))
  def stage(self,mode,run_id=None):
   self.sequence+=1
   return run_stage(path,mode,plan['releaseId'],plan_sha,self.sequence,self.check_hold,run_id)
  def prebuild(self):
   started=time.monotonic();last=None;attempts=0
   while time.monotonic()-started<1200 and attempts<100:
    attempts+=1;last=self.stage('build')
    if last.get('ready') is True:
     result=self.stage('check');result['buildAttempts']=attempts;result['elapsedSeconds']=round(time.monotonic()-started,3);return result
   raise RuntimeError('Bounded v6 prebuild incomplete; leave writes off')
  def install(self):
   self.check_hold()
   # No config changes here: reject any existing enabled writer in a future
   # postactivation rerun. This initial cutover is preactivation-only.
   source=Path('/proc')/ns['states'](ns['UNITS'])[ns['UNITS'][0]]['MainPID']/'environ'
   env=source.read_bytes().split(b'\0')
   need(b'PUBLISH_LINKED_WRITES_ENABLED=1' not in env,'Initial overlay cannot run after writer activation')
   return supervisor['invoke'](code,payload=(json.dumps(manifest)+'\n').encode(),require_recovery_receipt=True)
  def baseline(self):
   self.check_hold();ns['fence'](ns['ROOT'],manifest,ns['validate_manifest'](manifest),'rollback');ns['metadata_fence'](ns['ROOT'],manifest['sourceMetadata'],'rollback')
  def restore(self):return supervisor['invoke'](holder,['--phase','restore',*hold_args])
 try:return execute_phases(Operations(),supervisor['ControllerRolledBack'],outcome,_stage['StageUncertain'])
 finally:print(json.dumps(outcome),flush=True)
