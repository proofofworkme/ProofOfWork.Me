#!/usr/bin/env python3
"""Rehearse both native AMO staging phases and guarded helper reversal in a networkless mount namespace."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

HERE = Path(__file__).resolve()
REPO = Path('/fixture/source') if HERE == Path('/fixture/rehearsal.py') else HERE.parents[2]
BASE = 'ace27010a8e44886c0c22cf9fe5c98509d28f1bb'
PRIOR_STAGES = (
    ('56da86069b0064a52ddc2880c2b3f00e3a651fd1', '25b9f4bcbcb980803efddc53766788c8d4c9daaf', '20261123T214728Z', 6),
    ('31d335e99ad8ffb4f22fa8a2aa18482919122ebb', '2e6335642d6a4051a3581295ff81f6c0f0e1dd09', '20261124T032904Z', 7),
)
BOX = Path('/fixture')
SCRATCH = Path('/var/tmp/proofofwork-deploy')
BACKUP = Path('/var/backups/proofofwork-ui')
SBIN = Path('/usr/local/sbin')
LOCK = Path('/run/proofofwork-ui/deploy.lock')
PAIR = {'current': '2084747c3f8c-20261118T181547Z', 'previous': '9f18a0ce7032-20261118T004519Z'}
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C', 'HOME': '/fixture',
       'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_OPTIONAL_LOCKS': '0'}


def load(path):
    spec = importlib.util.spec_from_file_location('fixture_' + path.stem, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, raw, mode=0o600):
    if not isinstance(raw, bytes):
        raw = (json.dumps(raw, sort_keys=True, separators=(',', ':')) + '\n').encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    path.chmod(mode)
    return digest(path)


def run(argv, *, cwd=None, data=None, stream=None, ok=True):
    r = subprocess.run(argv, cwd=cwd, env=ENV, input=data, stdin=stream, capture_output=True, timeout=360)
    if (r.returncode == 0) != ok:
        raise AssertionError((argv, r.returncode, r.stdout[-2000:], r.stderr[-3000:]))
    return r.stdout


def git(repo, *args, data=None):
    return run(['git', '-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid.example',
                '-c', 'commit.gpgSign=false', *args], data=data).decode().strip()


def archive(tree, target, top):
    with tarfile.open(target, 'w:gz', dereference=True) as tar:
        tar.add(tree, arcname=top)
    return {'path': str(target), 'sha256': digest(target), 'bytes': target.stat().st_size}


def host_fixture(root):
    """Copy only the release-tool sources and one ancestor commit object, never a repository backup."""
    repo = root / 'fixture/source'
    lifecycle = load(REPO / 'deploy/ui-retention/lifecycle.py')
    files = list(lifecycle.LOCAL_SOURCES)
    files.extend(str(p.relative_to(REPO)) for p in (REPO / 'deploy/publish').glob('*.py') if '.test.' not in p.name)
    files += ['deploy/proofofwork-ui-release-stage.py', 'deploy/proofofwork-ui-release-publish.sh',
              'deploy/proofofwork-ui-release-provenance.sh', 'deploy/proofofwork-ui-retained-root.py',
              'deploy/proofofwork-ui-capacity.py', 'deploy/audit29/release.py', 'deploy/audit29/ui-transport.py',
              'deploy/audit5/ui-stage-candidate.sh', 'deploy/audit5/stream-ui-bundle.py', 'deploy/audit5/ui-capacity.py']
    for name in sorted(set(files)):
        output = repo / name
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / name, output)
        output.chmod(0o755 if (REPO / name).stat().st_mode & 0o111 else 0o644)
    shutil.copy(HERE, root / 'fixture/rehearsal.py')
    (root / 'fixture').chmod(0o700)
    write(root / 'fixture/ancestor-commit', subprocess.check_output(['git', '-C', REPO, 'cat-file', 'commit', BASE]))
    sources = load(REPO/'deploy/publish/amo_stage_installer.py').SOURCE
    for commit, tree, _, _ in PRIOR_STAGES:
        assert subprocess.check_output(['git', '-C', REPO, 'rev-parse', commit+'^{tree}']).decode().strip() == tree
        history = root/'fixture'/commit
        for name, path in {'capacity.py':'deploy/proofofwork-ui-capacity.py',
                           'installer.py':'deploy/publish/amo_stage_installer.py', **sources}.items():
            write(history/name, subprocess.check_output(['git', '-C', REPO, 'show', commit+':'+path]))
    for key, path in sources.items():
        write(root/'usr/local/sbin'/('proofofwork-ui-release-' + ('stage' if key == 'stager' else 'publish')),
              subprocess.check_output(['git', '-C', REPO, 'show', BASE + ':' + path]), 0o755)
    for d in ('usr', 'proc', 'dev', 'tmp', 'run', 'etc', 'var/backups/proofofwork-ui/releases',
              'var/backups/proofofwork-ui/transport-evidence', 'var/tmp/proofofwork-deploy',
              'run/proofofwork-ui', 'var/www'):
        (root/d).mkdir(parents=True, exist_ok=True)
    for name in ('bin','sbin','lib','lib64','share'):
        (root/'usr'/name).mkdir(exist_ok=True)
    (root/'tmp').chmod(0o1777)
    (root/'var/tmp').chmod(0o1777)
    for link in ('bin','sbin','lib','lib64'):
        (root/link).symlink_to('usr/'+link)
    write(root/'fixture/namespace-marker', b'synthetic-ui-controller-fixture-v1\n')


class InstalledStaging(unittest.TestCase):
    def test_guarded_install_stage_source_reversal(self):
        self.addCleanup(os.umask, os.umask(0o022))
        with tempfile.TemporaryDirectory(prefix='amo-staging-namespace-') as temp:
            root = Path(temp)
            host_fixture(root)
            args = ['bwrap','--die-with-parent','--unshare-all','--uid','0','--gid','0',
                    '--hostname','ubuntu-4gb-hel1-1','--bind',str(root),'/',
                    *(part for name in ('bin','sbin','lib','lib64','share') for part in ('--ro-bind','/usr/'+name,'/usr/'+name)),
                    '--proc','/proc','--dev','/dev',
                    '--chdir','/fixture','/usr/bin/python3','-I','-B','/fixture/rehearsal.py','run-fixture']
            try:
                r = subprocess.run(args, env=ENV, capture_output=True, timeout=720)
                self.assertEqual(r.returncode, 0, (r.stdout[-2000:], r.stderr[-4000:]))
                print(r.stdout.decode().strip())
            except (AssertionError, subprocess.TimeoutExpired):
                for log in sorted((root / str(SCRATCH).lstrip('/')).glob('recovery-transport-*/*.log')):
                    if log.stat().st_size:
                        print(log.name, log.read_bytes()[-800:].decode(errors='replace'), file=sys.stderr)
                raise


def inside():
    # This function writes absolute production-shaped paths only inside the disposable namespace.
    assert os.geteuid() == 0 and HERE == BOX/'rehearsal.py'
    assert (BOX/'namespace-marker').read_bytes() == b'synthetic-ui-controller-fixture-v1\n'
    mapped=Path('/proc/self/uid_map').read_text().split()
    assert len(mapped)==3 and mapped[0]=='0' and int(mapped[1])>0 and mapped[2]=='1' and os.getpid() <= 5
    os.umask(0o022)
    root = BOX/'source'
    deploy = root/'deploy'
    release = load(deploy/'publish/release.py')
    stage = load(deploy/'proofofwork-ui-release-stage.py')
    phase = load(deploy/'publish/phase_capacity.py')
    sequence = load(deploy/'publish/sequence_capacity.py')
    native = load(deploy/'proofofwork-ui-capacity.py')
    fingerprint = load(deploy/'proofofwork-ui-retained-root.py').fingerprint
    install = load(deploy/'publish/amo_stage_installer.py')
    SCRATCH.chmod(0o700)
    LOCK.parent.chmod(0o700)
    write(LOCK,b'lock fixture\n')
    lock = LOCK.open('rb')
    fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB)
    live = Path('/var/www')
    rollback = BACKUP/'rollback-roots'/('proofofwork-www-pre-'+PAIR['current'])
    for directory, rid in ((live,PAIR['current']),(rollback,PAIR['previous'])):
        write(directory/'.proofofwork-ui-release', ('release_id='+rid+'\n').encode(), 0o644)
    payload = BOX/'payload'
    for n in stage.PAY_SURFACES:
        for parent,file in ((live/('proofofwork-'+n),'old.js'),(payload/'surfaces'/n,'new.js')):
            write(parent/'index.html', ('<script src="/assets/'+file+'"></script>\n').encode(), 0o644)
            write(parent/'assets'/file, file.encode()+b' repeated bytes\n', 0o644)
    write(live/'passthrough',b'old metadata and links',0o644)
    os.link(live/'passthrough', live/'passthrough-alias')
    os.setxattr(live/'passthrough','user.fixture',b'preserve')
    baseline=[fingerprint(p) for p in (live,rollback)]
    # A real shallow boundary links the synthetic commit to ace without copying its history or source tree.
    git(root,'init','-q','--template=')
    assert git(root,'hash-object','-t','commit','-w','--stdin',data=(BOX/'ancestor-commit').read_bytes()) == BASE
    write(root/'.git/shallow', (BASE+'\n').encode())
    write(root/'.gitignore',b'node_modules/\n',0o644); git(root,'add','.')
    tree=git(root,'write-tree');commit=git(root,'commit-tree',tree,'-p',BASE,'-m','Local AMO staging fixture')
    git(root,'checkout','-q','--detach',commit)
    write(root/'node_modules/fixture.js',b'export default 1;\n',0o644)
    rid=commit[:12]+'-20261123T235959Z'
    bundles={k:archive(p,BOX/(k+'.tgz'),'proofofwork-ui-'+k+'-'+rid)
             for k,p in [('source',root),('surfaces',payload)]}
    b={'releaseId':rid,'commit':commit,'tree':tree,'releaseFormat':'proofofwork-ui-release-v6',
       'sourceAllocatedBytes':int(subprocess.check_output(['du','-sB1',root]).split()[0]),
       'surfaces':list(stage.PAY_SURFACES),'bundles':bundles}
    receipt=BOX/'build.json';build_sha=write(receipt,b)
    helpers={}
    paths={'capacity':('proofofwork-ui-capacity.py',SBIN/'proofofwork-ui-capacity'),
           'retained':('proofofwork-ui-retained-root.py',SBIN/'proofofwork-ui-retained-root'),
           'provenance':('proofofwork-ui-release-provenance.sh',SBIN/'proofofwork-ui-release-provenance')}
    toolroot=SCRATCH/'audit29-tools'
    for key,name in [('controller','release.py'),('receiver','stream-ui-bundle.py'),('stage-shell','ui-stage-candidate.sh'),
                     ('phase-capacity','ui-capacity.py'),('transport','ui-transport.py')]:
        paths[key]=('audit29/'+name if key in ('transport','controller') else 'audit5/'+name,toolroot/name)
    for key,(source,target) in paths.items():
        helpers[key]={'path':str(target),'sha256':write(target,(deploy/source).read_bytes(),0o755)}
    next_bytes={k:(root/p).read_bytes() for k,p in install.SOURCE.items()}
    for k in next_bytes:
        helpers[k]={'path':str(install.BINARY[k]),'sha256':hashlib.sha256(next_bytes[k]).hexdigest()}
    config=install.CONFIG;state=install.STATE
    capacity_path=paths['capacity'][1]
    # Keep synthetic prior stage assets and live/rollback files, including true
    # inode identities, hardlink topology, metadata, xattrs and content hashes.
    def custody(roots):
        paths=set(roots)
        for directory in roots:
            if directory.is_dir():
                paths.update(directory.rglob('*'))
        return {p:(install.identity(p.lstat()),{k:os.getxattr(p,k) for k in os.listxattr(p)},
                   digest(p) if p.is_file() else None) for p in paths}

    held=[live,rollback]
    kept=custody(held)
    old_bindings=[]
    predecessors={k:install.readinfo(path,mode=0o755)[1] for k,path in install.BINARY.items()}
    for old_commit,old_tree,date,gib in PRIOR_STAGES:
        history=BOX/old_commit
        old_install=load(history/'installer.py')
        old_capacity=load(history/'capacity.py')
        assert write(capacity_path,(history/'capacity.py').read_bytes(),0o755)==old_install.CAPACITY_SHA
        assert old_capacity.MAX_DEPLOY_SCRATCH_BYTES==gib*1024**3
        old_rid=old_commit[:12]+'-'+date
        old_stage=SCRATCH/('proofofwork-www-stage-'+old_rid)
        old_source=SCRATCH/('proofofwork-ui-source-'+old_rid)
        old_surfaces=SCRATCH/('proofofwork-ui-surfaces-'+old_rid)
        old_archive=BACKUP/'releases'/('proofofwork-ui-release-'+old_rid+'.tgz')
        controls=[SCRATCH/('recovery-plan-'+old_rid+'-initial.json'),
                  SCRATCH/('recovery-control-'+old_rid+'-inventory-'+('a'*64)+'.zlib'),
                  old_archive,Path(str(old_archive)+'.sha256'),Path(str(old_archive)+'.provenance')]
        for phase_name in ('source','surfaces-stage'):
            controls.append(SCRATCH/('recovery-transport-'+old_rid+'-'+phase_name+'-initial')/'receipt.json')
        for path in controls:
            write(path,(old_rid+' '+path.name+'\n').encode())
        for n in stage.PAY_SURFACES:
            write(old_stage/('proofofwork-'+n)/'index.html',(old_rid+' private candidate\n').encode(),0o644)
            write(old_surfaces/'surfaces'/n/'index.html',(old_rid+' received input\n').encode(),0o644)
        write(old_source/'tracked.js',(old_rid+' prior source\n').encode())
        os.link(old_source/'tracked.js',old_source/'alias.js')
        os.setxattr(old_source/'tracked.js','user.fixture',old_rid.encode())
        assert custody(held)==kept
        held.extend([old_stage,old_source,old_surfaces,*controls])
        kept=custody(held)

        prior_config=write(config,{'fixture':'prior config','rid':old_rid})
        prior_state=write(state,{'fixture':'prior state','rid':old_rid})
        historical_bytes={k:(history/k).read_bytes() for k in old_install.SOURCE}
        prior={'schema':'pow-ui-amo-direct-stage-approval-v1','commit':old_commit,'tree':old_tree,
               'releaseId':old_rid,'publicationAttempt':'initial','sourceSha256':'1'*64,'surfacesSha256':'2'*64,
               'inventorySha256':'a'*64,'buildReceiptSha256':'3'*64,
               'helperHashes':{k:hashlib.sha256(v).hexdigest() for k,v in historical_bytes.items()},
               'pair':PAIR,'configSha256':prior_config,'stateSha256':prior_state}
        # Only the original installer's fixed historical config/state hashes are
        # substituted for the synthetic namespace files. Its actual journal and
        # inode checks, helper bytes and capacity guard run unchanged.
        if gib==6:
            old_install.CONFIG_SHA,old_install.STATE_SHA=prior_config,prior_state
        def old_protected():
            assert digest(config)==prior_config and digest(state)==prior_state and custody(held)==kept
        def old_budget():
            assert digest(capacity_path)==old_install.CAPACITY_SHA
            old_capacity.check_capacity(SCRATCH,8*1024**2,32,'prior-installer-fixture')
        def old_action(action):
            return old_install.operate(action,old_install.STORE,old_install.BINARY,prior,historical_bytes,
                                       old_protected,old_budget)
        old_action('prepare');old_action('apply')
        old_binding={'model':'amo-direct-stage-v1','approvalSha256':old_install.sha(old_install.encoded(prior))}
        assert stage.verify_active(old_binding)==prior
        assert old_action('rollback')['rollbackComplete'] and not old_action('status')['active']
        journal=old_install.STORE/old_binding['approvalSha256']
        assert all((journal/name).is_file() for name in ('installed.json','reversing.json','rolled-back.json'))
        saved=json.loads((journal/'intent.json').read_bytes())
        assert {k:pair['before'] for k,pair in saved['files'].items()}==predecessors
        assert {k:old_install.readinfo(path,mode=0o755)[1] for k,path in old_install.BINARY.items()}==predecessors
        assert custody(held)==kept
        old_bindings.append(old_binding)
        held.append(journal)
        kept=custody(held)

    # Use the exercised 31d reversal's own intent to bind the new helper pair.
    restored={k:pair['before'] for k,pair in saved['files'].items()}
    assert write(capacity_path,(deploy/'proofofwork-ui-capacity.py').read_bytes(),0o755)==install.CAPACITY_SHA
    assert native.MAX_DEPLOY_SCRATCH_BYTES==7680*1024**2
    state_sha=write(state,{'completedContext':{'pair':PAIR},'status':'complete'})
    # The historical controller obligation is represented by synthetic fixed state and manifest digests.
    # All release helpers, pinned predecessor bytes, filesystem locks, archive receivers and receipts are real.
    config_sha=write(config,{'fixture':'sealed completed pair','state':state_sha})
    lifecycle={'config':{'path':str(config),'sha256':config_sha},'state':{'path':str(state),'sha256':state_sha},
               'pair':PAIR,'controller':{'path':str(BOX/'fixture-controller'),'sha256':write(BOX/'fixture-controller',b'fixture historical controller\n')}}
    request,packed=release.closed_input(b,private_staging=True)
    approval={'schema':'pow-ui-amo-direct-stage-approval-v1','releaseId':rid,'commit':commit,'tree':tree,
              'publicationAttempt':'initial','sourceSha256':bundles['source']['sha256'],'surfacesSha256':bundles['surfaces']['sha256'],
              'buildReceiptSha256':build_sha,'inventorySha256':request['inventorySha256'],'stateSha256':state_sha,
              'configSha256':config_sha,'helperHashes':{k:helpers[k]['sha256'] for k in next_bytes},'pair':PAIR}
    approval_file=BOX/'approval.json'; approval_sha=write(approval_file,approval)
    assert install.sealed_approval(approval_file,approval_sha)==approval
    frame=BOX/'helper-frame.json'
    request_file=BOX/'closed.json'
    write(request_file, request);write(Path(str(request_file)+'.zlib'), packed)
    install.pack(approval,receipt,request_file,frame)
    def protected():
        assert [fingerprint(p) for p in (live,rollback)]==baseline and digest(config)==config_sha and digest(state)==state_sha
        assert custody(held)==kept
        with LOCK.open('rb') as other:
            try:fcntl.flock(other,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:return
            raise AssertionError('deployment lock not held')
    def budget():
        native.check_deploy_scratch(SCRATCH,4*1024**2,'installer-fixture')
        native.check_capacity(SCRATCH,4*1024**2,32,'installer-fixture')
    def operation(action):
        import base64
        packed_frame=json.loads(frame.read_bytes());assert packed_frame['approvalSha256']==approval_sha
        payloads={k:base64.b64decode(v,validate=True) for k,v in packed_frame['helpers'].items()}
        return install.operate(action,install.STORE,install.BINARY,approval,payloads,protected,budget,
                               expected_predecessors=restored)
    operation('prepare');operation('apply')
    binding={'model':'amo-direct-stage-v1','approvalSha256':approval_sha}
    assert stage.verify_active(binding)==approval
    release.bind_direct_request(request,b,build_sha,approval_sha,'initial')
    write(phase.inventory_path(rid,request['inventorySha256']),packed)
    closed=phase.recheck_closed_input(request,helpers,baseline[0],lock.fileno())
    forecast={'model':'private-stage-zero-retirement-v1','releaseId':rid,'wouldRetire':[],'previousPair':PAIR,'stateSha256':state_sha}
    pre={'amoDirectApproval':stage.verify_active(binding),'closedArchive':closed,'helpers':helpers,'live':baseline[0],'retained':[baseline[1]],'retentionDeferred':True,
         'oldManaged':{'entries':1000,'logicalBytes':1048576},'checks':[{'exitCode':0}],
         'retentionLifecycle':lifecycle,'privateStageRetention':forecast,'verifiedPreservedFallback':{'snapshotSha256':{'fixture':'1'*64}},
         'wholeSequenceCensus':sequence.capture(native)}
    forecast['preservedFallback']=pre['verifiedPreservedFallback']
    prefile=BOX/'preflight.json';write(prefile,pre);planfile=SCRATCH/('recovery-plan-'+rid+'-initial.json')
    local_plan=Path('/tmp/sealed-plan.json')
    run(['/usr/bin/python3','-I','-B',deploy/'publish/release.py','make-plan',receipt,prefile,local_plan,'--input-storage','deploy-scratch-v1'])
    p=json.loads(local_plan.read_bytes());plan_sha=digest(local_plan)
    assert stage.direct_plan_fields(p)==approval and p['amoDirectStage']==binding
    # Preserve every actual receiver statement except the transient systemd unit check.
    # A local synthetic lifecycle callback verifies the substituted fixed protected records under the real lock.
    remote=(deploy/'publish/remote_transport.py').read_text()
    a=1+remote.index("\nfields = dict(line.split('=', 1) for line in subprocess.check_output([")
    end=remote.index("lock = Path('/run/proofofwork-ui/deploy.lock')",a)
    assert 'RuntimeMaxUSec' in remote[a:end] and '/proc/self/cgroup' in remote[a:end]
    guard=(deploy/'publish/publication_admission.py').read_text()+'''
def installed_admission(binding,release,private,rule,lock_fd):
    assert private and rule['model']=='private-stage-zero-retirement-v1' and rule['releaseId']==release
    for name in ('state','config','controller'):
        pinned_file(binding[name]['path'],binding[name]['sha256'],65536)
    assert Path('/proc/self/fd/'+str(lock_fd)).resolve()==Path('/run/proofofwork-ui/deploy.lock')
    fcntl.flock(lock_fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
'''
    dispatch=BOX/'dispatch.py';write(dispatch,(guard+'\n'+remote[:a]+remote[end:]).encode())
    fcntl.flock(lock,fcntl.LOCK_UN)
    gate=release.admission_tools(release.admission_source())['plan_gate'](p)
    installer=guard+'\n'+release.direct_metadata_guard(p)+release.UPLOAD
    run(['/usr/bin/python3','-I','-B','-c',installer,plan_sha,planfile,json.dumps(gate)],data=local_plan.read_bytes())
    assert digest(planfile)==plan_sha
    def invoke(which,sha,ok=True):
        with Path(bundles['source' if which=='source' else 'surfaces']['path']).open('rb') as stream:
            return run(['/usr/bin/python3','-I','-B',dispatch,planfile,sha,which],stream=stream,ok=ok)
    invoke('surfaces-stage','0'*64,ok=False)
    assert not (SCRATCH/('recovery-transport-'+rid+'-surfaces-stage-initial')).exists()
    invoke('surfaces-stage',plan_sha)
    stage_record=SCRATCH/('recovery-transport-'+rid+'-surfaces-stage-initial')/'receipt.json'
    stage_model=json.loads(stage_record.read_bytes())['stageModel']
    assert stage_model['peakPhase']=='direct-surface-copy' and stage_model['amoDirectCapacity']==closed['amoDirectCapacity']
    assert 'constructor=amo-direct-stage-v1 direct_plan_sha256='+plan_sha in (stage_record.parent/'stager.log').read_text()
    invoke('source',plan_sha)
    receipts=[SCRATCH/('recovery-transport-'+rid+'-'+name+'-initial')/'receipt.json' for name in ('surfaces-stage','source')]
    vals=[json.loads(r.read_bytes()) for r in receipts]
    assert all(r['commit']==commit and r['tree']==tree and r['planSha256']==plan_sha and not r['productionPublished']
               and not r['historicalDeletion'] for r in vals)
    assert vals[1]['verifiedStageReceiptSha256']==digest(receipts[0]) and vals[1]['candidateProvenanceVerified']
    dest=SCRATCH/('proofofwork-www-stage-'+rid)
    assert (dest/'passthrough').samefile(dest/'passthrough-alias') and not (dest/'passthrough').samefile(live/'passthrough')
    assert os.getxattr(dest/'passthrough','user.fixture')==b'preserve'
    for n in stage.PAY_SURFACES:
        assert (dest/('proofofwork-'+n)/'assets/old.js').is_file() and (dest/('proofofwork-'+n)/'assets/new.js').is_file()
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    fence=load(deploy/'publish/native_exchange_fence.py')
    exchange_args=(Path(vals[1]['sourceCheckout']),Path('/'),live,SCRATCH,BACKUP/'releases')
    fence.direct_exchange_guard(p,vals[0],*exchange_args)
    try:
        fence.direct_exchange_guard(p,{**vals[0],'privateStageAllocation':{}},*exchange_args)
    except ValueError as error:
        assert 'completed direct candidate changed' in str(error)
    else:
        raise AssertionError('altered private-stage allocation was accepted at the exchange boundary')
    assert custody(held)==kept
    for old_binding in old_bindings:
        try:stage.verify_active(old_binding)
        except stage.StageError:pass
        else:raise AssertionError('a prior authority reactivated during successor staging')
    operation('rollback');protected()
    try:stage.verify_active(binding)
    except stage.StageError:pass
    else:raise AssertionError('reversed authority remained active')
    assert {k:install.readinfo(path,mode=0o755)[1] for k,path in install.BINARY.items()}==restored
    print(json.dumps({'surfaces':len(stage.PAY_SURFACES),'privateStageAndSourceVerified':True,'reversalVerified':True,
                      'stalePlanRefusedBeforeReceipt':True,'nativeExchangeGuardChecked':True,
                      'alteredStageReceiptRefused':True,'unchangedLiveAndRollback':True,'retainedStageAndJournalCount':len(old_bindings),
                      'scratchCeilingBytes':native.MAX_DEPLOY_SCRATCH_BYTES}))


if __name__=='__main__':
    if sys.argv[1:]==['run-fixture']:
        inside()
    else:
        unittest.main()
