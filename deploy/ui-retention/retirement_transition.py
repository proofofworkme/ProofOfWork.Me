#!/usr/bin/env python3
"""Exact payload-retirement config/state transition, library only.

No payload deletion or CLI is provided. Every write requires the existing stock
deployment lock. Pending config blocks publication. Final state is installed
before final config; uncertain positions must be reconciled explicitly, never
rolled back to a policy asserting already-retired payloads still exist.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat

CONFIG = Path('/etc/proofofwork-retention/ui-lifecycle.json')
STATE = Path('/var/lib/proofofwork-ui-retention/state.json')
DIRECTORY = Path('/var/backups/proofofwork-ui/cleanup-evidence/older-backup-retirement-6fd05dc1e04e')
INDEX = DIRECTORY.parent/'audit30-policy-admission-index-payload-retirement-6fd05dc1e04e.json'
MAX = 16*1024**2

def require(ok, message):
    if not ok:raise ValueError(message)

def encoded(value):
    return (json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def identity(info):
    return [info.st_dev,info.st_ino,info.st_mode,info.st_uid,info.st_gid,
            info.st_nlink,info.st_size,info.st_mtime_ns,info.st_ctime_ns]

def ancestor_check(directory):
    """Production trust boundary: every named ancestor is root-owned/nonwritable."""
    directory=Path(directory)
    for parent in (directory,*directory.parents):
        info=parent.lstat()
        require(parent.resolve(strict=True)==parent and stat.S_ISDIR(info.st_mode)
                and info.st_uid==0 and not info.st_mode&0o022,
                'Unsafe transition ancestor')

def parent_identity(info):
    return (info.st_dev,info.st_ino,info.st_mode,info.st_uid,info.st_gid)

def parent_fence(path, fd, expected):
    ancestor_check(path.parent)
    require(parent_identity(path.parent.lstat())==expected
            and parent_identity(os.fstat(fd))==expected,
            'Transition parent directory changed')

def open_parent(path):
    path=Path(path)
    require(path.is_absolute(),'Transition path must be absolute')
    ancestor_check(path.parent)
    expected=parent_identity(path.parent.lstat())
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:parent_fence(path,fd,expected)
    except BaseException:os.close(fd);raise
    return fd,expected

def read_at(parent, name, expected=None):
    require('/' not in name and name not in ('','.','..'),'Invalid transition basename')
    before=os.stat(name,dir_fd=parent,follow_symlinks=False)
    require(stat.S_ISREG(before.st_mode) and before.st_uid==os.geteuid()
            and not before.st_mode&0o7022 and before.st_nlink==1
            and 0<before.st_size<=MAX,'Unsafe transition evidence')
    fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME,dir_fd=parent)
    try:
        require(identity(os.fstat(fd))==identity(before),'Evidence replaced on open')
        with os.fdopen(os.dup(fd),'rb') as stream:raw=stream.read(MAX+1)
        require(len(raw)==before.st_size and identity(os.fstat(fd))==identity(before)
                and identity(os.stat(name,dir_fd=parent,follow_symlinks=False))==identity(before),
                'Evidence changed during read')
    finally:os.close(fd)
    require(expected is None or sha(raw)==expected,'Transition evidence hash differs')
    return raw

def read(path, expected=None):
    path=Path(path);parent,before=open_parent(path)
    try:
        raw=read_at(parent,path.name,expected)
        parent_fence(path,parent,before)
        return raw
    finally:os.close(parent)

def json_read(path, expected=None):
    def unique(pairs):
        out={}
        for k,v in pairs:
            require(k not in out,'Duplicate JSON key');out[k]=v
        return out
    return json.loads(read(path,expected),object_pairs_hook=unique)

def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)

def save(path, raw):
    path=Path(path);parent,before=open_parent(path)
    try:
        try:os.stat(path.name,dir_fd=parent,follow_symlinks=False)
        except FileNotFoundError:
            fd=os.open(path.name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,
                       0o600,dir_fd=parent)
            try:
                with os.fdopen(os.dup(fd),'wb') as stream:
                    stream.write(raw);stream.flush();os.fsync(stream.fileno())
            finally:os.close(fd)
            os.fsync(parent)
        require(read_at(parent,path.name)==raw,'Existing transition evidence differs')
        parent_fence(path,parent,before)
        return {'path':str(path),'sha256':sha(raw)}
    finally:os.close(parent)

def receipt_module():
    if globals().get('_BOUND_RETIREMENT') is not None:return globals()['_BOUND_RETIREMENT']
    p=Path(__file__).with_name('retirement_receipt.py')
    info=p.lstat()
    require(p.resolve(strict=True)==p and info.st_uid==os.geteuid()
            and not info.st_mode&0o7022,'Unsafe receipt companion')
    spec=importlib.util.spec_from_file_location('retirement_transition_receipt',p)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

class Transition:
    def __init__(self, storage, lifecycle, lock_fd, *, intent_sha=None):
        self.S=storage;self.L=lifecycle;self.layout=storage.Layout()
        self.lock_fd=lock_fd;self.R=receipt_module();self.intent_sha=intent_sha
        self.lock()

    def lock(self):
        self.S.require_execution_lock(self.lock_fd,self.layout)

    def package(self, binding):
        require(set(binding)=={'path','sha256'},'Package binding differs')
        root=Path(binding['path'])
        require(root.parent==DIRECTORY.parent
                and root.name=='ui-lifecycle-tools-'+binding['sha256'],
                'Package namespace differs')
        manifest=json_read(root/'package.json',binding['sha256'])
        require(manifest.get('schema')=='pow-ui-retention-package-v1'
                and set(manifest['files'])==set(self.L.PACKAGE_FILES),
                'Package file scope differs')
        for name,pin in manifest['files'].items():
            require(set(pin)=={'bytes','sha256'},'Package pin fields differ')
            raw=read(root/name,pin['sha256'])
            require(len(raw)==pin['bytes'],'Package member size differs')
        own='deploy/ui-retention/retirement_transition.py'
        require(sha(read(Path(__file__).resolve()))==manifest['files'][own]['sha256'],
                'Transition code differs from verified package')
        return manifest

    def original_preflight(self, config, state):
        """Authenticate the OLD controller/package, then run its full read-only status."""
        self.lock()
        binding=config['controller'];path=Path(binding['path'])
        require(path==Path(config['package']['path'])/'deploy/ui-retention/lifecycle_remote.py',
                'Original controller namespace differs')
        read(path,binding['sha256'])
        spec=importlib.util.spec_from_file_location('retirement_prior_lifecycle',path)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        runtime=module.installed_runtime(CONFIG,self.R.PRIOR_CONFIG_SHA)
        self.lock();runtime.lock_fd=self.lock_fd
        try:status=runtime.status({'requireComplete':True})
        finally:runtime.lock_fd=None
        self.lock()
        require(status.get('publicationHealthy') is True and status.get('retentionComplete') is True
                and status.get('pair')==self.R.PAIR
                and status.get('index')==self.R.SOURCE_INDEX
                and status.get('context')==state['completedContext'],
                'Original physical lifecycle is not freshly complete')

    def terminal_config(self, context, intent):
        self.R.require_verified_retirement(context)
        proof=context.proof
        pending=json_read(intent['pendingConfig']['path'],intent['pendingConfig']['sha256'])
        binding=pending.get('payloadRetirement',{})
        require(proof['proposalSha256']==self.R.PROPOSAL_SHA
                and proof['sourceIndex']==self.R.SOURCE_INDEX
                and proof['policyCodeSha256']==intent['package']['sha256']
                and pending['package']==intent['package']
                and binding=={'mode':'pending','proposalSha256':self.R.PROPOSAL_SHA,
                    'receipt':None,'priorConfigSha256':self.R.PRIOR_CONFIG_SHA,
                    'sourceIndex':dict(self.R.SOURCE_INDEX),
                    'policyCodeSha256':intent['package']['sha256']},
                'Terminal context differs from exact planned pending package')
        require(proof['receipt']['path']==self.R.TERMINAL_PATH
                and proof['receiptSha256']==proof['receipt']['sha256'],
                'Terminal receipt binding differs')
        return dict(pending,payloadRetirement=dict(binding,mode='complete',receipt=proof['receipt']))

    def prepare_pending(self, package):
        self.lock();manifest=self.package(package)
        old_config=read(CONFIG,self.R.PRIOR_CONFIG_SHA)
        proposal=json_read(DIRECTORY/'proposal.json',self.R.PROPOSAL_SHA)
        old_state=read(STATE,proposal['stateSha256'])
        old_index=read(self.R.SOURCE_INDEX['path'],self.R.SOURCE_INDEX['sha256'])
        config=json.loads(old_config);state=json.loads(old_state)
        require(config.get('payloadRetirement') is None
                and config['statePath']==str(STATE)
                and state['configSha256']==self.R.PRIOR_CONFIG_SHA
                and state['status']=='complete' and state['pending'] is None
                and state['activePhase'] is None
                and state['index']==self.R.SOURCE_INDEX
                and state['lastCompleted']['retainedPair']==self.R.PAIR,
                'Original completed lifecycle changed')
        self.original_preflight(config,state)
        for name,raw in [('prior-config.json',old_config),('prior-state.json',old_state),
                         ('prior-index.json',old_index)]:save(DIRECTORY/name,raw)
        pending=dict(config,package=dict(package),sourceCommit=manifest['sourceCommit'],
                     sourceTree=manifest['sourceTree'])
        pending['controller']={'path':str(Path(package['path'])/'deploy/ui-retention/lifecycle_remote.py'),
            'sha256':manifest['files']['deploy/ui-retention/lifecycle_remote.py']['sha256']}
        pending['approval']={'path':str(Path(package['path'])/self.L.PACKAGE_FILES[0]),
                             'sha256':self.L.APPROVAL_SHA}
        require(sha(read(pending['approval']['path']))==self.L.APPROVAL_SHA,
                'Original scope approval differs')
        pending['payloadRetirement']={'mode':'pending','proposalSha256':self.R.PROPOSAL_SHA,
            'receipt':None,'priorConfigSha256':self.R.PRIOR_CONFIG_SHA,
            'sourceIndex':dict(self.R.SOURCE_INDEX),'policyCodeSha256':package['sha256']}
        pb=save(DIRECTORY/'pending-config.json',encoded(pending))
        intent={'schema':'pow-exact-payload-retirement-transition-intent-v1',
            'proposalSha256':self.R.PROPOSAL_SHA,'priorConfigSha256':self.R.PRIOR_CONFIG_SHA,
            'priorStateSha256':proposal['stateSha256'],'sourceIndex':dict(self.R.SOURCE_INDEX),
            'package':dict(package),'pendingConfig':pb}
        self.lock();binding=save(DIRECTORY/'transition-intent.json',encoded(intent))
        self.intent_sha=binding['sha256']
        return {'binding':binding,'value':intent}

    def intent(self):
        require(isinstance(self.intent_sha,str) and len(self.intent_sha)==64,
                'Expected immutable transition intent digest required')
        intent=json_read(DIRECTORY/'transition-intent.json',self.intent_sha)
        require(intent['schema']=='pow-exact-payload-retirement-transition-intent-v1'
                and intent['proposalSha256']==self.R.PROPOSAL_SHA
                and intent['priorConfigSha256']==self.R.PRIOR_CONFIG_SHA
                and intent['sourceIndex']==self.R.SOURCE_INDEX
                and intent['pendingConfig']['path']==str(DIRECTORY/'pending-config.json'),
                'Transition intent authority differs')
        proposal=json_read(DIRECTORY/'proposal.json',self.R.PROPOSAL_SHA)
        require(intent['priorStateSha256']==proposal['stateSha256'],'Prior state pin differs')
        self.package(intent['package'])
        read(intent['pendingConfig']['path'],intent['pendingConfig']['sha256'])
        read(DIRECTORY/'prior-state.json',intent['priorStateSha256'])
        read(DIRECTORY/'prior-config.json',self.R.PRIOR_CONFIG_SHA)
        read(DIRECTORY/'prior-index.json',self.R.SOURCE_INDEX['sha256'])
        return intent

    def replace(self, path, expected, raw, name, *, resume=False):
        """Directory-fd-relative CAS; an unknown/replaced parent never receives writes."""
        self.lock();path=Path(path)
        require(path in (CONFIG,STATE),'Only lifecycle config/state may change')
        parent,parent_before=open_parent(path)
        try:
            before=os.stat(path.name,dir_fd=parent,follow_symlinks=False)
            read_at(parent,path.name,expected)
            descriptor={'path':str(path),'before':identity(before),'beforeSha256':expected,
                        'afterSha256':sha(raw)}
            started=DIRECTORY/(name+'-started.json')
            if os.path.lexists(started):
                require(resume and json_read(started)==descriptor,
                        'Uncertain replacement requires exact explicit reconciliation')
            else:save(started,encoded(descriptor))
            temporary='.'+path.name+'.pow-retirement-'+name+'.tmp'
            parent_fence(path,parent,parent_before)
            try:os.stat(temporary,dir_fd=parent,follow_symlinks=False)
            except FileNotFoundError:
                fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,
                           0o600,dir_fd=parent)
                try:
                    with os.fdopen(os.dup(fd),'wb') as stream:
                        stream.write(raw);stream.flush()
                        os.fchmod(stream.fileno(),stat.S_IMODE(before.st_mode))
                        os.fchown(stream.fileno(),before.st_uid,before.st_gid)
                        os.fsync(stream.fileno())
                finally:os.close(fd)
                os.fsync(parent)
            else:
                require(resume and read_at(parent,temporary)==raw,
                        'Uncertain/partial replacement temp')
            self.lock();parent_fence(path,parent,parent_before)
            require(identity(os.stat(path.name,dir_fd=parent,follow_symlinks=False))==identity(before),
                    'Destination changed before replace')
            read_at(parent,path.name,expected)
            require(read_at(parent,temporary)==raw,'Staged replacement changed')
            parent_fence(path,parent,parent_before)
            os.rename(temporary,path.name,src_dir_fd=parent,dst_dir_fd=parent)
            os.fsync(parent);parent_fence(path,parent,parent_before)
            require(read_at(parent,path.name)==raw,'Installed replacement differs')
            after=os.stat(path.name,dir_fd=parent,follow_symlinks=False)
            save(DIRECTORY/(name+'-installed.json'),encoded({'path':str(path),'sha256':sha(raw),
                                                           'identity':identity(after)}))
        finally:os.close(parent)

    def install_pending(self, *, resume=False):
        self.lock();intent=self.intent()
        read(STATE,intent['priorStateSha256'])
        raw=read(intent['pendingConfig']['path'],intent['pendingConfig']['sha256'])
        if sha(read(CONFIG))==intent['pendingConfig']['sha256']:
            return self.positions()
        self.original_preflight(json_read(DIRECTORY/'prior-config.json',self.R.PRIOR_CONFIG_SHA),
                                json_read(DIRECTORY/'prior-state.json',intent['priorStateSha256']))
        self.replace(CONFIG,self.R.PRIOR_CONFIG_SHA,raw,'pending-config',resume=resume)
        read(STATE,intent['priorStateSha256'])

    def prepare_terminal(self, context):
        self.lock();self.R.require_verified_retirement(context);intent=self.intent()
        expected_config=self.terminal_config(context,intent)
        read(CONFIG,intent['pendingConfig']['sha256']);read(STATE,intent['priorStateSha256'])
        context.verify_scope(self.layout)
        prior=json_read(DIRECTORY/'prior-state.json',intent['priorStateSha256'])
        pair=self.S.protected_pair(self.layout,{})
        guards,_=self.S.safeguards(self.layout,model=self.S.ROTATING_LOG_GUARD_MODEL)
        observed={'pair':{k:pair[k]['fields']['release_id'] for k in ('current','previous')},
                  'manifests':{k:self.S.hash_read(Path(pair[k]['path'])/'.proofofwork-ui-release')[0]
                               for k in ('current','previous')},'guards':guards}
        require(observed==prior['completedContext'],'Completed context changed outside exact scope')
        index=json_read(DIRECTORY/'prior-index.json',self.R.SOURCE_INDEX['sha256'])
        require('payloadRetirement' not in index,'Original index already transitioned')
        index=dict(index,payloadRetirement=context.proof)
        index_binding=save(INDEX,encoded(index))
        config=expected_config
        config_binding=save(DIRECTORY/'successor-config.json',encoded(config))
        patch={'configSha256':config_binding['sha256'],'index':index_binding,
               'revision':prior['revision']+2,'lastUpgrade':{},
               'completedContext':prior['completedContext']}
        transition={'schema':'pow-exact-payload-retirement-state-transition-v1',
            'priorState':{'path':str(DIRECTORY/'prior-state.json'),'sha256':intent['priorStateSha256']},
            'priorConfig':{'path':str(DIRECTORY/'prior-config.json'),'sha256':self.R.PRIOR_CONFIG_SHA},
            'successorConfigSha256':config_binding['sha256'],
            'terminalReceipt':context.proof['receipt'],'successorIndex':index_binding,
            'statePatch':patch,'preservedLastUpgrade':prior.get('lastUpgrade',{})}
        tb=save(DIRECTORY/'transition-completed.json',encoded(transition))
        state=dict(prior,**patch,lastPayloadRetirement=tb)
        state_binding=save(DIRECTORY/'successor-state.json',encoded(state))
        context.verify_lifecycle_state(state,config_binding['sha256'])
        self.lock()
        return {'config':config_binding,'state':state_binding,'transition':tb,'index':index_binding}

    def positions(self):
        self.lock();intent=self.intent()
        cs=sha(read(CONFIG));ss=sha(read(STATE))
        cp='original' if cs==self.R.PRIOR_CONFIG_SHA else 'pending' if cs==intent['pendingConfig']['sha256'] else 'unknown'
        sp='original' if ss==intent['priorStateSha256'] else 'unknown'
        if (DIRECTORY/'successor-config.json').exists():
            if cs==sha(read(DIRECTORY/'successor-config.json')):cp='terminal'
        if (DIRECTORY/'successor-state.json').exists():
            if ss==sha(read(DIRECTORY/'successor-state.json')):sp='terminal'
        require((cp,sp) in (('original','original'),('pending','original'),
                           ('pending','terminal'),('terminal','terminal')),
                'Unknown or unsafe mixed lifecycle positions')
        return {'config':cp,'state':sp,'configSha256':cs,'stateSha256':ss}

    def install_terminal(self, context, *, resume=False):
        self.lock();self.R.require_verified_retirement(context);intent=self.intent()
        position=self.positions();require(position['config']!='original','Pending config not installed')
        config=read(DIRECTORY/'successor-config.json');state=read(DIRECTORY/'successor-state.json')
        require(config==encoded(self.terminal_config(context,intent)),
                'Staged successor config differs from exact reconstruction')
        require(state==encoded(json.loads(state)),'Noncanonical successor state')
        context.verify_scope(self.layout);context.verify_lifecycle_state(json.loads(state),sha(config))
        if position['config']=='terminal':
            require(position['state']=='terminal','Unsafe terminal config position')
            save(DIRECTORY/'transition-installed.json',encoded(position))
            return position
        if position['state']=='terminal':
            require(resume,'Partial terminal installation requires explicit reconciliation')
        else:
            self.replace(STATE,intent['priorStateSha256'],state,'terminal-state',resume=resume)
        self.lock();read(STATE,sha(state))
        context.verify_scope(self.layout)
        context.verify_lifecycle_state(json.loads(state),sha(config))
        self.replace(CONFIG,intent['pendingConfig']['sha256'],config,'terminal-config',resume=resume)
        position=self.positions()
        require(position['config']==position['state']=='terminal','Terminal installation incomplete')
        save(DIRECTORY/'transition-installed.json',encoded(position))
        return position
