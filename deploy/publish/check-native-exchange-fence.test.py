#!/usr/bin/python3 -I
"""Synthetic native exchange boundary rehearsal. Run only in the dedicated node workspace."""
import ctypes
import hashlib
import importlib.util
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import types
import unittest
from fcntl import flock, LOCK_EX, LOCK_NB
from pathlib import Path
import shlex

ROOT=Path(__file__).resolve().parents[2]
TMP=Path(os.environ.get('TMPDIR','/tmp')).resolve()
os.umask(0o022)
os.environ.update(TMPDIR=str(TMP),GIT_CONFIG_GLOBAL='/dev/null',GIT_CONFIG_NOSYSTEM='1')
tempfile.tempdir=str(TMP)
def load(name,path,bindings=None):
    spec=importlib.util.spec_from_file_location(name,path); m=importlib.util.module_from_spec(spec)
    if bindings: m.__dict__.update(bindings)
    spec.loader.exec_module(m); return m
def sha(data):return hashlib.sha256(data).hexdigest()
def encoded(value):return (json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def put(path,raw,mode=0o600):
    if not isinstance(raw,bytes):raw=encoded(raw)
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(raw);path.chmod(mode)
    return sha(raw)
def run(args,env=None,cwd=None,pass_fds=()):
    return subprocess.run(args,env=env,cwd=cwd,pass_fds=pass_fds,capture_output=True,text=True,timeout=180)
pages=load('native_fixture_pages',ROOT/'scripts/check-ui-pages-release.py')
S=load('native_fixture_storage',ROOT/'deploy/audit30/ui-storage.py')
P=load('native_fixture_policy',ROOT/'deploy/audit30/ui-release-policy.py',{'_BOUND_STORAGE':S})
libc=ctypes.CDLL(None,use_errno=True)
def watched(parent_paths):
    fd=libc.inotify_init1(os.O_CLOEXEC|os.O_NONBLOCK)
    if fd<0:raise OSError(ctypes.get_errno(),'inotify_init')
    mapping={}
    for parent in parent_paths:
        wd=libc.inotify_add_watch(fd,os.fsencode(parent),0x40|0x80)
        if wd<0:raise OSError(ctypes.get_errno(),'inotify_add_watch')
        mapping[wd]=parent
    return fd,mapping
def moves(fd,mapping,targets):
    items=[]
    while True:
        try:data=os.read(fd,65536)
        except BlockingIOError:break
        at=0
        while at<len(data):
            w,mask,cookie,n=struct.unpack_from('=iIII',data,at)
            if mask&0x4000:raise ValueError('inotify overflow')
            name=os.fsdecode(data[at+16:at+16+n].split(b'\0')[0]);at+=16+n
            if (w in mapping and mapping[w]/name in targets):
                items.append((str(mapping[w]/name),mask,cookie))
    return items
class Native(unittest.TestCase):
    populate,archive,record,run_command=(getattr(pages.PagesRelease,n) for n in ('populate','archive','record','run_command'))
    stage=pages.PagesRelease.stage
    def setUp(self):
        tmp=tempfile.TemporaryDirectory(prefix='native-final-',dir=TMP)
        self.addCleanup(tmp.cleanup)
        self.base=Path(tmp.name)
        self.www=self.base/'var/www';self.staging=self.base/'var/tmp/proofofwork-deploy'
        self.archives=self.base/'var/backups/proofofwork-ui/releases'
        self.rollbacks=self.base/'var/backups/proofofwork-ui/rollback-roots';self.helpers=self.base/'helpers'
        self.lock=self.base/'run/proofofwork-ui/deploy.lock'
        self.cfg=self.base/'etc/proofofwork-retention/ui-lifecycle.json'
        self.evidence=self.archives.parent/'cleanup-evidence'
        self.state=self.base/'var/lib/proofofwork-ui-retention/state.json'
        for path in (self.base/'var',self.www,self.staging,self.archives,self.rollbacks,self.helpers,self.evidence,self.cfg.parent,
                     self.state.parent,self.lock.parent,self.archives.parent/'transport-evidence'):
            path.mkdir(mode=0o700,parents=True,exist_ok=True)
        self.lock.touch(mode=0o600)
        self.env={**os.environ,'POW_UI_ALLOW_TEST_ROOTS':'1','POW_UI_PUBLISH_WWW_ROOT':str(self.www),
                  'POW_UI_PUBLISH_STAGING_ROOT':str(self.staging),'POW_UI_RELEASE_ARCHIVE_ROOT':str(self.archives),
                  'POW_UI_PUBLISH_ROLLBACK_ROOT':str(self.rollbacks),'POW_UI_DEPLOY_LOCK':str(self.lock),
                  'POW_UI_STAGE_WWW_ROOT':str(self.www),'POW_UI_STAGE_STAGING_ROOT':str(self.staging),
                  'POW_UI_WWW_ROOT':str(self.www),'POW_UI_RETAINED_ROOT_SCRIPT':str(self.helpers/'retained'),
                  'POW_UI_PUBLISH_PROVENANCE_SCRIPT':str(self.helpers/'wrapped-provenance'),
                  'POW_UI_CAPACITY_SCRIPT':str(self.helpers/'capacity'),'TMPDIR':str(TMP)}
        for orig,n in [('proofofwork-ui-release-provenance.sh','real-provenance'),('proofofwork-ui-retained-root.py','retained')]:
            put(self.helpers/n,(ROOT/'deploy'/orig).read_bytes(),0o700)
        cap=(ROOT/'deploy/proofofwork-ui-capacity.py').read_text()
        # Real limits, actual statvfs/du; make fixture pool roots mirror the host.
        for before,after in [('/var/backups/proofofwork-ui',self.archives.parent),('/var/tmp/proofofwork-deploy',self.staging),
                             ('/var/www',self.www),('/run/proofofwork-ui',self.lock.parent)]:
            cap=cap.replace('"'+before,'"'+str(after))
        put(self.helpers/'capacity',cap.encode(),0o700)
        self.provenance=str(self.helpers/'real-provenance')
        self.shell=self.base/'usr/local/sbin/proofofwork-ui-release-publish'
        put(self.shell,(ROOT/'deploy/proofofwork-ui-release-publish.sh').read_bytes(),0o700)
        self.shipped={'publisherSha256':sha(self.shell.read_bytes()),'fenceSha256':sha((ROOT/'deploy/publish/native_exchange_fence.py').read_bytes())}
        self.source=self.base/'build-src';self.source.mkdir(mode=0o700)
        put(self.source/'.gitignore',b'node_modules/\n',0o644)
        for name,path in [('deploy/proofofwork-ui-release-publish.sh',self.shell),
                          ('deploy/publish/native_exchange_fence.py',ROOT/'deploy/publish/native_exchange_fence.py'),
                          ('deploy/publish/publish.py',ROOT/'deploy/publish/publish.py'),
                          ('deploy/ui-retention/lifecycle_remote.py',ROOT/'deploy/publish/test-fixtures/native_fence_controller.py'),
                          ('deploy/audit30/ui-storage.py',ROOT/'deploy/audit30/ui-storage.py'),
                          ('deploy/audit30/ui-release-policy.py',ROOT/'deploy/audit30/ui-release-policy.py')]:
            put(self.source/name,path.read_bytes(),0o644)
        def git(*args):
            return self.run_command(['git','-C',str(self.source),'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',
                                     '-c','commit.gpgsign=false',*args]).stdout.strip()
        git('init','-q');git('add','.');git('commit','-qm','native fence fixture')
        self.commit=git('rev-parse','HEAD');self.tree=git('rev-parse','HEAD^{tree}');git('checkout','--detach',self.commit)
        put(self.source/'node_modules/fixture.js',b'fixture only\n',0o644)
        self.prehold=self._testMethodName=='test_ordinary_prehold_witness_and_boundaries'
        self.rid=self.commit[:12]+'-20261104T020000Z';self.attempt='fixture'
        self.src=self.staging/('proofofwork-ui-source-'+self.rid);shutil.copytree(self.source,self.src)
        # Give the synthetic historical releases real retained Git identities; production constants are untouched.
        S.PRESERVED_FALLBACK_PREDECESSOR=self.commit[:12]+'-20261101T051206Z'
        S.PRESERVED_FALLBACK_INTRODUCER=self.commit[:12]+('-20261102T020000Z' if self.prehold else '-20261103T032112Z')
        self.layout=S.Layout(self.base)
        held_paths=[Path(p) for p in S.preserved_fallback_paths(self.layout)]
        self.held=held_paths[2]
        self.held_root=held_paths[0]
        self.populate(held_paths[0],pages.stage.PERMISSION_SURFACES,managed=True,tag='historical')
        historical_archive=self.archive(held_paths[0],pages.stage.PERMISSION_SURFACES,S.PRESERVED_FALLBACK_PREDECESSOR)
        self.run_command([self.provenance,'record','--release-id',S.PRESERVED_FALLBACK_PREDECESSOR,'--commit',self.commit,
                          '--source-checkout',str(self.source),'--archive',str(historical_archive)],{'POW_UI_WWW_ROOT':str(held_paths[0])})
        self.populate(self.www,pages.stage.PERMISSION_SURFACES,managed=True,tag='prior')
        self.record(S.PRESERVED_FALLBACK_INTRODUCER,self.archive(self.www,pages.stage.PERMISSION_SURFACES,S.PRESERVED_FALLBACK_INTRODUCER))
        self.candidate,_=self.stage(self.rid,pages.stage.PERMISSION_SURFACES)
        self.new_archive=self.archive(self.candidate,pages.stage.PERMISSION_SURFACES,self.rid)
        self.pkg_files={'deploy/ui-retention/lifecycle_remote.py':(ROOT/'deploy/publish/test-fixtures/native_fence_controller.py').read_bytes(),
                        'deploy/audit30/ui-storage.py':(ROOT/'deploy/audit30/ui-storage.py').read_bytes(),
                        'deploy/audit30/ui-release-policy.py':(ROOT/'deploy/audit30/ui-release-policy.py').read_bytes()}
        manifest={'schema':'pow-ui-retention-package-v1','sourceCommit':self.commit,'sourceTree':self.tree,
                  'files':{k:{'bytes':len(v),'sha256':sha(v)} for k,v in self.pkg_files.items()}}
        package_sha=sha(encoded(manifest)); pkg=self.evidence/('ui-lifecycle-tools-'+package_sha)
        for name,raw in self.pkg_files.items():put(pkg/name,raw)
        put(pkg/'package.json',manifest)
        p=pkg/'deploy/ui-retention/lifecycle_remote.py'
        config={'schema':'pow-ui-retention-lifecycle-config-v1','sourceCommit':self.commit,'sourceTree':self.tree,
                 'controller':{'path':str(p),'sha256':sha(p.read_bytes())},
                 'package':{'path':str(pkg),'sha256':package_sha},'statePath':str(self.state),'retentionPolicy':{'model':'vps-current-and-one-prior-v1'}}
        cfg_sha=put(self.cfg,config)
        cache={}; root=S.release_proof(held_paths[0],self.layout,cache); archive=cache[str(held_paths[1])]
        snapshots=[root['snapshot'],archive['snapshot'],*archive['sidecars']]
        self.assertEqual([s['path'] for s in snapshots],[str(p) for p in held_paths])
        admission_refs=[]
        admission_hashes={}
        for role,release,record in [('archive',S.PRESERVED_FALLBACK_PREDECESSOR,{'archives':[{'snapshot':archive['snapshot'],'sidecars':archive['sidecars'],'payloadSha256':archive['payloadSha256']}]}),
                                    ('root',S.PRESERVED_FALLBACK_INTRODUCER,{'roots':[{'snapshot':root['snapshot']} ]})]:
            record['retainedPair']={'current':release,'previous':self.commit[:12]+'-20261031T020000Z' if role=='archive' else S.PRESERVED_FALLBACK_PREDECESSOR}
            ap=self.evidence/('audit30-policy-admission-release-'+release+'.json')
            admission_hashes[role]=put(ap,record);admission_refs.append({'path':str(ap),'sha256':admission_hashes[role]})
        hold={'model':'verified-fallback-in-place-v1','releaseId':S.PRESERVED_FALLBACK_PREDECESSOR,'introducedBy':S.PRESERVED_FALLBACK_INTRODUCER,
              'admissions':admission_hashes,'manifestSha256':root['manifestSha256'],'archivePayloadSha256':archive['payloadSha256'],
              'snapshotSha256':{s['path']:s['sha256'] for s in snapshots}}
        indexp=self.evidence/'fixture-admission-index.json';idx_sha=put(indexp,{'admissions':admission_refs,'admittedPaths':[str(self.www),*[str(p) for p in held_paths]]})
        pair={'current':S.PRESERVED_FALLBACK_INTRODUCER,'previous':S.PRESERVED_FALLBACK_PREDECESSOR}
        put(self.state,{'status':'complete','activePhase':None,'pending':None,'hold':None if self.prehold else hold,'pair':pair,'completedContext':{'pair':pair},'index':{'path':str(indexp),'sha256':idx_sha}})
        controller=load('native_fixture_controller',p)
        self.runtime=controller.installed_runtime(self.cfg,cfg_sha)
        self.lockfd=os.open(self.lock,os.O_RDONLY);self.addCleanup(os.close,self.lockfd)
        flock(self.lockfd,LOCK_EX|LOCK_NB)
        self.env['POW_UI_DEPLOY_LOCK_FD']=str(self.lockfd)
        prior=self.runtime.status({'requireComplete':True,'prospectiveRelease':self.rid})
        self.plan={'releaseId':self.rid,'commit':self.commit,'tree':self.tree,'publicationAttempt':self.attempt,
                   'retentionLifecycle':prior['binding'],'privateStageRetention':prior['privateStageRetention'],
                   'publicationHelpers':{'publisher':{'path':str(self.shell),'sha256':sha(self.shell.read_bytes())}},
                   'wrapperSourceSha256':{'publish.py':sha((self.src/'deploy/publish/publish.py').read_bytes())},
                   'inputStorage':'deploy-scratch-v1', 'preservedSourceCheckout':str(self.src),
                   'closedArchive':{'privateStaging':{'model':'private-release-stage-v1'}},'inputCompactor':{},'retentionDeferred':True,'frontendOnly':True}
        self.planpath=self.staging/('recovery-plan-'+self.rid+'-'+self.attempt+'.json')
        if self.prehold:
            for key in ['inputCompactor','privateStageRetention','closedArchive']:self.plan.pop(key)
        self.install_context()

    def install_context(self):
        self.plan_sha=put(self.planpath,self.plan)
        stage_receipt={'ok':True,'phase':'surfaces-stage','releaseId':self.rid,'commit':self.commit,'tree':self.tree,
                      'planSha256':self.plan_sha,'managedArchive':str(self.new_archive),'archiveSha256':sha(self.new_archive.read_bytes()),
                      'productionPublished':False,'historicalDeletion':False,'compactInput':{},'privateStageAllocation':{}}
        stage_sha=put(self.staging/f'recovery-transport-{self.rid}-surfaces-stage-{self.attempt}/receipt.json',stage_receipt)
        self.sourcereceipt=self.staging/f'recovery-transport-{self.rid}-source-{self.attempt}/receipt.json'
        src_sha=put(self.sourcereceipt,{'ok':True,'phase':'source','releaseId':self.rid,'commit':self.commit,'tree':self.tree,
                                'planSha256':self.plan_sha,'verifiedStageReceiptSha256':stage_sha,'sourceCheckout':str(self.src),
                                'candidateProvenanceVerified':True,'detachedSourceClean':True,'productionPublished':False,
                                'historicalDeletion':False,'archiveSha256':sha(self.new_archive.read_bytes())})
        self.out=self.staging/f'recovery-publish-{self.rid}-{self.attempt}'
        self.intent=self.out/'intent.json'
        put(self.intent,{'attempt':self.attempt,'releaseId':self.rid,'commit':self.commit,'tree':self.tree,
                         'planSha256':self.plan_sha,'verifiedSourceReceiptSha256':src_sha,'verifiedStageReceiptSha256':stage_sha,'lockHolderPid':os.getpid(),'lockFd':self.lockfd,'retentionDeferred':True})

    def install_hook(self,tamper):
        wrapper='#!/bin/bash\nset -euo pipefail\n'+shlex.quote(self.provenance)+' "$@"\n'
        marker=self.base/'candidate-verified-by-provenance'
        wrapper+='if [[ "$1" == verify-candidate ]]; then\n touch -- '+shlex.quote(str(marker))+'\n'
        if tamper:
            # New inode, same bytes/mode/times. The original proof remains in this synthetic fixture only.
            wrapper+=' cp --preserve=all -- '+shlex.quote(str(self.held))+' '+shlex.quote(str(self.held)+'.swapped')+'\n'
            wrapper+=' mv -T -- '+shlex.quote(str(self.held)+'.swapped')+' '+shlex.quote(str(self.held))+'\n'
        wrapper+='fi\n'
        put(self.helpers/'wrapped-provenance',wrapper.encode(),0o700)
        return marker

    def invoke(self,plan_sha=None,environment=None,managed=True):
        proof=load('fixture_retained',ROOT/'deploy/proofofwork-ui-retained-root.py').fingerprint(self.held_root)
        retained=self.held_root.name+':'+proof['manifestSha256']+':'+proof['treeSha256']
        cmd=[str(self.shell),'--retain-rollback-root',retained,'--release-id',self.rid,'--commit',self.commit,'--source-checkout',str(self.src),
             '--archive',str(self.new_archive),'--defer-verified-retention','--publication-attempt',self.attempt,
             '--publication-plan-sha256',plan_sha or self.plan_sha]
        if not managed:cmd=cmd[:-4]
        return run(cmd,{**self.env,**(environment or {})},pass_fds=(self.lockfd,))

    def test_clean_and_bad_context(self):
        marker=self.install_hook(False)
        before=(self.www.stat().st_ino,self.candidate.stat().st_ino)
        bad=self.invoke('0'*64);self.assertNotEqual(bad.returncode,0);self.assertIn('SHA differs',bad.stderr)
        self.assertFalse((self.rollbacks/('proofofwork-www-pre-'+self.rid)).exists())
        missing=self.invoke(managed=False);self.assertNotEqual(missing.returncode,0);self.assertIn('requires authenticated',missing.stderr)
        fake=self.base/'looks-like-a-dir';fake.symlink_to(self.www)
        for unsafe in [{'POW_UI_PUBLISH_WWW_ROOT':'/var/www'},{'POW_UI_DEPLOY_LOCK':'/run/proofofwork-ui/deploy.lock'},
                       {'POW_UI_PUBLISH_WWW_ROOT':str(fake)}]:
            rejected=self.invoke(environment=unsafe);self.assertNotEqual(rejected.returncode,0)
            self.assertIn('Test roots cannot include or alias a production destination',rejected.stdout+rejected.stderr)
        self.assertEqual((self.www.stat().st_ino,self.candidate.stat().st_ino),before)
        original=self.intent.read_bytes();d=json.loads(original);d['commit']='1'*40;put(self.intent,d)
        refused=self.invoke();self.assertNotEqual(refused.returncode,0);self.assertIn('identity differs',refused.stdout+refused.stderr)
        put(self.intent,original)
        self.assertEqual((self.www.stat().st_ino,self.candidate.stat().st_ino),before)
        fd,mapping=watched([self.www.parent,self.staging])
        try:
            result=self.invoke(); observed=moves(fd,mapping,{self.www,self.candidate})
        finally:os.close(fd)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertTrue(marker.is_file());self.assertTrue(observed)
        self.assertEqual(self.www.stat().st_ino,before[1])
        self.assertEqual((self.rollbacks/('proofofwork-www-pre-'+self.rid)).stat().st_ino,before[0])
        self.assertFalse(self.candidate.exists())
        self.assertIn(self.rid,(self.www/'.proofofwork-ui-release').read_text())
        print(json.dumps({**self.shipped,'case':'positive','swapped':True,'renameEvents':len(observed),'badPlanRefused':True,'badIntentRefused':True}))

    def test_swap_after_forecast_refused_before_any_root_rename(self):
        marker=self.install_hook(True)
        before=(self.www.stat().st_ino,self.candidate.stat().st_ino)
        held_id=self.held.stat().st_ino;held_bytes=sha(self.held.read_bytes())
        fd,mapping=watched([self.www.parent,self.staging])
        try:
            result=self.invoke(); observed=moves(fd,mapping,{self.www,self.candidate})
        finally:os.close(fd)
        self.assertTrue(marker.is_file(),result.stdout+result.stderr)
        self.assertNotEqual(self.held.stat().st_ino,held_id)
        self.assertEqual(sha(self.held.read_bytes()),held_bytes)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Preserved fallback',result.stdout+result.stderr)
        self.assertEqual(observed,[])
        self.assertEqual((self.www.stat().st_ino,self.candidate.stat().st_ino),before)
        self.assertFalse((self.rollbacks/('proofofwork-www-pre-'+self.rid)).exists())
        self.assertFalse((self.out/'receipt.json').exists())
        self.assertFalse((self.candidate/'.proofofwork-ui-release').exists())
        print(json.dumps({**self.shipped,'case':'late-inode-swap','mutationProven':True,'bytesUnchanged':True,'renameEvents':observed,'exit':result.returncode}))

    def test_swap_after_full_native_status_refused_by_last_inode_fence(self):
        marker=self.install_hook(False)
        original=(self.www.stat().st_ino,self.candidate.stat().st_ino)
        before=(self.held.stat().st_ino,sha(self.held.read_bytes()))
        put(self.base/'inject-after-native-status',b'inject one race')
        fd,mapping=watched([self.www.parent,self.staging])
        try:
            result=self.invoke();observed=moves(fd,mapping,{self.www,self.candidate})
        finally:os.close(fd)
        self.assertTrue(marker.is_file(),result.stdout+result.stderr)
        self.assertTrue((self.base/'injected-after-native-status').is_file(),result.stdout+result.stderr)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('physical fallback entry changed',result.stdout+result.stderr)
        self.assertNotEqual(before[0],self.held.stat().st_ino)
        self.assertEqual(before[1],sha(self.held.read_bytes()))
        self.assertEqual(original,(self.www.stat().st_ino,self.candidate.stat().st_ino))
        self.assertEqual(observed,[])
        self.assertFalse((self.rollbacks/('proofofwork-www-pre-'+self.rid)).exists())
        self.assertFalse((self.out/'receipt.json').exists())
        print(json.dumps({**self.shipped,'case':'swap-after-full-native-recheck','bytesUnchanged':True,'renameEvents':observed,'exit':result.returncode}))

    def test_ordinary_prehold_witness_and_boundaries(self):
        module=load('fixture_current_native_fence',ROOT/'deploy/publish/native_exchange_fence.py')
        observed=self.runtime.status({'requireComplete':True,'prospectiveRelease':self.rid})
        self.assertIsNone(observed['verifiedPreservedFallback']);state=json.loads(self.state.read_bytes());scope=observed['binding']
        module.require_pre_fallback_index(observed,state,scope,self.base,self.rid)
        for altered in [None,dict(observed['index'],sha256='f'*64),dict(observed['index'],path=str(self.base/'wrong-index'))]:
            with self.assertRaisesRegex(ValueError,'affirmative pre-fallback index'):
                module.require_pre_fallback_index(dict(observed,verifiedPreFallbackIndex=altered),state,scope,self.base,self.rid)
        with self.assertRaisesRegex(ValueError,'backdated'):
            module.require_pre_fallback_index(observed,state,scope,self.base,scope['pair']['previous'])
        marker=self.install_hook(False);before=self.www.stat().st_ino,self.candidate.stat().st_ino
        fd,mapping=watched([self.www.parent,self.staging])
        try:
            result=self.invoke();observed=moves(fd,mapping,{self.www,self.candidate})
        finally:os.close(fd)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr);self.assertTrue(marker.is_file());self.assertTrue(observed)
        self.assertEqual(self.www.stat().st_ino,before[1]);self.assertEqual((self.rollbacks/('proofofwork-www-pre-'+self.rid)).stat().st_ino,before[0])
        print(json.dumps({**self.shipped,'case':'ordinary-prehold','staleIndexRefused':True,'missingIndexRefused':True,'backdatedRefused':True,'renameEvents':len(observed)}))

if __name__=='__main__':unittest.main()
