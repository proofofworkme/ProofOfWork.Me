"""Authenticate the locked publication forecast immediately before the native forward rename."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess

SHA = re.compile(r'[0-9a-f]{64}\Z')
RID = re.compile(r'[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z\Z')
ATTEMPT = re.compile(r'[a-z0-9][a-z0-9-]{0,30}\Z')


def require(ok, reason):
    if not ok:
        raise ValueError('Native exchange fence: '+reason)


def identity(s):
    return s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns


_NO_PIN = object()


def read(path, pin=_NO_PIN, limit=65536):
    path = Path(path)
    before = path.lstat()
    require(path.is_absolute() and path.resolve()==path and stat.S_ISREG(before.st_mode)
            and before.st_uid==os.geteuid() and before.st_gid==os.getegid()
            and before.st_nlink==1 and not before.st_mode&0o7022 and before.st_size<=limit,
            'unsafe or oversized '+str(path))
    fd=os.open(path, os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
    with os.fdopen(fd,'rb') as stream:
        require(identity(os.fstat(fd))==identity(before),'opened different file')
        data=stream.read(before.st_size+1)
        require(len(data)==before.st_size and identity(os.fstat(fd))==identity(path.lstat())==identity(before),
                'file changed during read')
    require(pin is _NO_PIN or isinstance(pin,str) and SHA.fullmatch(pin) and hashlib.sha256(data).hexdigest()==pin,'SHA differs: '+str(path))
    return data


def decode(data):
    def unique(pairs):
        result={}
        for key,value in pairs:
            require(key not in result,'duplicate evidence field: '+key)
            result[key]=value
        return result
    return json.loads(data,object_pairs_hook=unique)


def git(source,*args):
    return subprocess.check_output(['/usr/bin/git','--no-replace-objects','-C',str(source),*args],
                                  env={'PATH':'/usr/bin:/bin','LC_ALL':'C','GIT_CONFIG_NOSYSTEM':'1',
                                       'GIT_CONFIG_GLOBAL':'/dev/null','GIT_OPTIONAL_LOCKS':'0','GIT_NO_LAZY_FETCH':'1'},
                                  stdin=subprocess.DEVNULL,timeout=20)


def committed_file(source,commit,relative,pin):
    data=read(source/relative,pin,2*1024**2)
    require(git(source,'show',commit+':'+relative)==data,'verified checkout differs from committed '+relative)
    return data


def inherited_lock(path, fd, intent):
    named=path.lstat()
    require(path.resolve()==path and stat.S_ISREG(named.st_mode) and named.st_uid==os.geteuid()
            and named.st_gid==os.getegid() and named.st_nlink==1 and not named.st_mode&0o7022
            and fd>=3 and identity(os.fstat(fd))==identity(named),'deployment lock identity changed')
    # The publisher Python process owns the flock. Its Bash child passes this
    # same open file description to the final rename helper without unlocking it.
    shell=os.getppid()
    owner=intent['lockHolderPid']
    shell_status=dict(line.split(':',1) for line in Path('/proc',str(shell),'status').read_text().splitlines() if ':' in line)
    require(type(owner) is int and owner>1 and owner==int(shell_status['PPid'])
            and type(intent['lockFd']) is int and intent['lockFd']==fd,'intent does not name the live wrapper/descriptor')
    expected=identity(named)
    require(identity(os.stat('/proc/'+str(owner)+'/fd/'+str(fd)))==expected,'wrapper no longer owns this descriptor')
    for proc in ('self',str(owner)):
        rows=Path('/proc',proc,'fdinfo',str(fd)).read_text().splitlines()
        lockrows=[row.split() for row in rows if row.startswith('lock:')]
        require(len(lockrows)==1 and len(lockrows[0])==9,'missing exclusive lock evidence')
        row=lockrows[0]
        require(row[2:6]==['FLOCK','ADVISORY','WRITE',str(owner)] and row[7:]==['0','EOF'],
                'descriptor has another holder or lock mode')
        device=[int(value,base) for value,base in zip(row[6].split(':'),(16,16,10))]
        require(device==[os.major(named.st_dev),os.minor(named.st_dev),named.st_ino],'lock inode differs')
    return expected


def final_hold_rows(hold, rule, prefix):
    if not hold:
        return []
    base=prefix/'var/backups/proofofwork-ui'
    evidence=base/'cleanup-evidence'
    release, intro=hold['releaseId'],hold['introducedBy']
    require(hold['model']=='verified-fallback-in-place-v1' and RID.fullmatch(release)
            and RID.fullmatch(intro) and release!=intro,'invalid preserved release identity')
    root=base/'rollback-roots'/('proofofwork-www-pre-'+intro)
    archive=base/'releases'/('proofofwork-ui-release-'+release+'.tgz')
    paths=[str(root),str(archive),str(archive)+'.sha256',str(archive)+'.provenance']
    require(set(hold['snapshotSha256'])==set(paths),'unexpected preserved path set')
    index_ref=rule['index']
    require(Path(index_ref['path']).parent==evidence,'index outside native evidence')
    index=decode(read(index_ref['path'],index_ref['sha256'],64*1024**2))
    admissions={}
    for key, rid in [('root',intro),('archive',release)]:
        pin=hold['admissions'][key]
        path=evidence/('audit30-policy-admission-release-'+rid+'.json')
        require(index['admissions'].count({'path':str(path),'sha256':pin})==1,'original admission is not in the current index')
        admissions[key]=decode(read(path,pin,64*1024**2))
    roots=admissions['root']['roots']; archives=admissions['archive']['archives']
    require(len(roots)==len(archives)==1,'unexpected original admission scope')
    snapshots=[roots[0]['snapshot'],archives[0]['snapshot'],*archives[0]['sidecars']]
    require([snap['path'] for snap in snapshots]==paths,'original four snapshots differ')
    rows=[]
    for snap in snapshots:
        entries=snap['entries']
        digest=hashlib.sha256(json.dumps(entries,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        require(digest==snap['sha256']==hold['snapshotSha256'][snap['path']],'original snapshot digest differs')
        for entry in entries:
            rel=Path(entry['path'])
            require(not rel.is_absolute() and '..' not in rel.parts and
                    entry['kind'] in ('file','directory'),'invalid preserved entry')
            rows.append((Path(snap['path'])/rel,entry))
    require(0<len(rows)<=25000,'preserved entry census exceeds bound')
    return rows


def final_inode_fence(rows):
    # The installed runtime has already rehashed bytes and checked archive
    # coverage/xattrs. Repeat the inexpensive identity census after all other
    # reads, so an equal-content rename during later validation is detected.
    for path,row in rows:
        s=path.lstat()
        expected=(row['device'],row['inode'],row['mode'],row['uid'],row['gid'],row['links'],row['size'],row['mtimeNs'],row['ctimeNs'])
        actual=(s.st_dev,s.st_ino,stat.S_IMODE(s.st_mode),s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
        correct_type=stat.S_ISDIR(s.st_mode) if row['kind']=='directory' else stat.S_ISREG(s.st_mode)
        require(correct_type and actual==expected,'physical fallback entry changed: '+str(path))


def require_pre_fallback_index(observed,state,scope,prefix,release):
    """A missing hold is admissible only with authenticated affirmative history."""
    record=observed.get('verifiedPreFallbackIndex')
    require(isinstance(record,dict) and set(record)=={'path','sha256'}
            and record==observed.get('index')==state.get('index')
            and Path(record['path']).parent==prefix/'var/backups/proofofwork-ui/cleanup-evidence',
            'missing or unbound affirmative pre-fallback index')
    index=decode(read(record['path'],record['sha256'],64*1024**2))
    pair=scope['pair'];cutoff='20261103T032112Z'
    require(pair==observed.get('pair')==state.get('completedContext',{}).get('pair')
            and set(pair)=={'current','previous'} and all(isinstance(rid,str) and RID.fullmatch(rid)
            and rid[13:]<cutoff for rid in pair.values()),'pair is not genuinely before the pinned fallback')
    require(release[13:]>max(rid[13:] for rid in pair.values()),'backdated proposed release')
    admissions=index.get('admissions')
    require(isinstance(admissions,list) and 0<len(admissions)<=256,'invalid pre-fallback admissions')
    last=None
    for ref in admissions:
        require(set(ref)=={'path','sha256'} and Path(ref['path']).parent==Path(record['path']).parent,
                'pre-fallback admission outside trusted index')
        adm=decode(read(ref['path'],ref['sha256'],64*1024**2))
        last=adm['retainedPair']
        require(set(last)=={'current','previous'} and all(isinstance(rid,str) and RID.fullmatch(rid)
                and rid[13:]<cutoff for rid in last.values()),'index includes a later or backdated admission')
    require(last==pair,'last sealed admission does not bind the claimed pair')


def verify(received, source, publisher, live, scratch, archive_dir, rollback, lock_path, fd, release, commit, attempt, pin, test):
    source,publisher,live,scratch,archive_dir,rollback,lock_path=map(Path,(source,publisher,live,scratch,archive_dir,rollback,lock_path))
    require(RID.fullmatch(release) and release.startswith(commit[:12]+'-') and re.fullmatch('[0-9a-f]{40}',commit)
            and ATTEMPT.fullmatch(attempt) and SHA.fullmatch(pin),'wrong release, attempt, or plan binding')
    prefix=live.parents[1] if test else Path('/')
    if test:
        require(prefix not in (Path('/'),Path('/tmp'),Path('/var/tmp')) and
                (prefix.is_relative_to('/tmp') or prefix.is_relative_to('/var/tmp')),
                'test prefix is not an isolated temporary directory')
    require((live,scratch,archive_dir,rollback,lock_path)==(prefix/'var/www',prefix/'var/tmp/proofofwork-deploy',
            prefix/'var/backups/proofofwork-ui/releases',prefix/'var/backups/proofofwork-ui/rollback-roots',
            prefix/'run/proofofwork-ui/deploy.lock'),'mixed test/production paths or noncanonical native layout')
    plan_path=scratch/('recovery-plan-'+release+'-'+attempt+'.json')
    intent_path=scratch/('recovery-publish-'+release+'-'+attempt)/'intent.json'
    received_intent=read(intent_path)
    intent=decode(received_intent)
    lock=inherited_lock(lock_path,fd,intent)
    plan=decode(read(plan_path,pin))
    if not test:
        unit='proofofwork-recovery-release-'+release+'-ui-'+attempt+'.service'
        properties=subprocess.check_output(['/usr/bin/systemctl','show',unit,'-p','ActiveState','-p','MainPID','-p','KillMode',
                                            '-p','RuntimeMaxUSec','-p','ControlGroup'],text=True,timeout=10)
        fields=dict(row.split('=',1) for row in properties.splitlines())
        require(fields.get('ActiveState')=='active' and fields.get('MainPID')==str(intent['lockHolderPid'])
                and fields.get('KillMode')=='control-group' and fields.get('RuntimeMaxUSec')=='1h 10min'
                and fields.get('ControlGroup','').endswith('/'+unit)
                and any(row.endswith(':'+fields['ControlGroup']) for row in Path('/proc/self/cgroup').read_text().splitlines()),
                'lock holder is not the active release wrapper service')
    expected={'releaseId':release,'commit':commit,'tree':git(source,'rev-parse','HEAD^{tree}').decode().strip()}
    require(git(source,'rev-parse','HEAD').decode().strip()==commit and
            plan.get('publicationAttempt')==attempt and intent.get('attempt')==attempt
            and intent.get('planSha256')==pin and all(plan.get(k)==v==intent.get(k) for k,v in expected.items())
            and plan.get('frontendOnly') is True and plan.get('retentionDeferred') is True
            and intent.get('retentionDeferred') is True,'plan/intent/source publication identity differs')
    native=plan['publicationHelpers']['publisher']
    require(native['path']==str(publisher) and publisher==prefix/'usr/local/sbin/proofofwork-ui-release-publish',
            'unexpected installed publisher path')
    require(read(publisher,native['sha256'],2*1024**2)==committed_file(source,commit,'deploy/proofofwork-ui-release-publish.sh',native['sha256']),
            'installed publisher differs from release source')
    committed_file(source,commit,'deploy/publish/native_exchange_fence.py',received)
    committed_file(source,commit,'deploy/publish/publish.py',plan['wrapperSourceSha256']['publish.py'])
    scope=plan['retentionLifecycle'];config_ref=scope['config'];state_ref=scope['state']
    require(config_ref['path']==str(prefix/'etc/proofofwork-retention/ui-lifecycle.json') and
            state_ref['path']==str(prefix/'var/lib/proofofwork-ui-retention/state.json'),'unexpected lifecycle config or state path')
    config=decode(read(config_ref['path'],config_ref['sha256']))
    state=decode(read(state_ref['path'],state_ref['sha256'],64*1024**2))
    package=config['package']
    pkg=prefix/'var/backups/proofofwork-ui/cleanup-evidence'/('ui-lifecycle-tools-'+package['sha256'])
    require(SHA.fullmatch(package['sha256']) and str(pkg)==package['path'] and pkg.resolve()==pkg,'unexpected lifecycle package')
    manifest=decode(read(pkg/'package.json',package['sha256']))
    require(manifest['schema']=='pow-ui-retention-package-v1' and manifest['sourceCommit']==config['sourceCommit']
            and manifest['sourceTree']==config['sourceTree'],'lifecycle package source differs')
    relative='deploy/ui-retention/lifecycle_remote.py'
    controller=config['controller']
    require(controller==scope['controller'] and controller['path']==str(pkg/relative)
            and manifest['files'][relative]['sha256']==controller['sha256'],'unexpected lifecycle controller')
    code=read(pkg/relative,controller['sha256'],2*1024**2)
    for name in (relative,'deploy/audit30/ui-storage.py','deploy/audit30/ui-release-policy.py'):
        authority=manifest['files'][name]
        member=read(pkg/name,authority['sha256'],2*1024**2)
        require(len(member)==authority['bytes'] and member==committed_file(source,commit,name,authority['sha256']),
                'installed verifier differs from exact release source')
    package_scope={'__name__':'_native_exchange_lifecycle','__file__':controller['path']}
    exec(compile(code,controller['path'],'exec'),package_scope)
    runtime=package_scope['installed_runtime'](config_ref['path'],config_ref['sha256'])
    request={'requireComplete':True,'prospectiveRelease':release}
    private='inputCompactor' in plan
    if private:
        rule=plan.get('privateStageRetention')
        require(isinstance(rule,dict) and rule['model']=='private-stage-zero-retirement-v1' and rule['wouldRetire']==[]
                and rule['releaseId']==release and rule['stateSha256']==state_ref['sha256']
                and rule['previousPair']==scope['pair'] and plan['closedArchive']['privateStaging']['model']=='private-release-stage-v1',
                'private plan does not bind zero retirement')
        src_path=scratch/('recovery-transport-'+release+'-source-'+attempt)/'receipt.json'
        stage_path=scratch/('recovery-transport-'+release+'-surfaces-stage-'+attempt)/'receipt.json'
        src=decode(read(src_path,intent['verifiedSourceReceiptSha256']))
        require(src.get('ok') is True and src.get('phase')=='source' and src.get('sourceCheckout')==str(source)
                and src.get('candidateProvenanceVerified') is True and src.get('detachedSourceClean') is True
                and src.get('planSha256')==pin and all(src.get(k)==v for k,v in expected.items()),
                'source receipt not bound to this candidate')
        require(src['verifiedStageReceiptSha256']==intent['verifiedStageReceiptSha256'],'source/stage receipt binding changed')
        stage=decode(read(stage_path,src['verifiedStageReceiptSha256']))
        require(stage.get('ok') is True and stage.get('phase')=='surfaces-stage' and stage.get('releaseId')==release
                and stage.get('planSha256')==pin and stage.get('managedArchive')==str(archive_dir/('proofofwork-ui-release-'+release+'.tgz'))
                and SHA.fullmatch(stage.get('archiveSha256','')),'stage receipt differs')
        checksum=read(Path(stage['managedArchive']+'.sha256')).decode().split()
        require(checksum==[stage['archiveSha256'],Path(stage['managedArchive']).name],'managed archive checksum differs')
    else:
        require('privateStageRetention' not in plan and 'privateStaging' not in plan.get('closedArchive',{}),
                'private metadata in ordinary plan')
    # The installed policy recomputes its own release pair, pins and actual
    # full physical snapshots. A caller's prior summary cannot stand in for it.
    observed=runtime.status(request)
    require(observed['retentionComplete'] is True and observed['binding']==scope and 'verifiedPreservedFallback' in observed,
            'native binding, preservation capability or state changed')
    forecast=observed['privateStageRetention']
    require(forecast['releaseId']==release and forecast['stateSha256']==state_ref['sha256']
            and forecast['index']==state['index'] and forecast['previousPair']==scope['pair'],
            'forecast did not bind the current state, index and proposed release')
    if observed['verifiedPreservedFallback'] is None:
        require_pre_fallback_index(observed,state,scope,prefix,release)
    rows=[]
    if private:
        require(forecast==rule and forecast.get('preservedFallback')==observed.get('verifiedPreservedFallback'),
                'native final preservation forecast differs')
        rows=final_hold_rows(observed.get('verifiedPreservedFallback'),rule,prefix)
    else:
        require(not observed.get('verifiedPreservedFallback') and not forecast.get('preservedFallback'),
                'ordinary plan cannot publish with an active preserved fallback')
    # Final rereads fence the same immutable request and same held descriptor
    # after potentially long snapshot verification, with no release/relock.
    require(read(intent_path)==received_intent and inherited_lock(lock_path,fd,intent)==lock,
            'intent or lock changed before rename')
    read(plan_path,pin)
    read(config_ref['path'],config_ref['sha256'])
    read(state_ref['path'],state_ref['sha256'],64*1024**2)
    final_inode_fence(rows)
