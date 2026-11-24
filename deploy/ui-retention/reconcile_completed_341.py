"""Guard the single completed-cycle recovery from the unsealed AMO revision 341.

This module is dispatched by install_lifecycle.py with candidate modules from the
reviewed immutable package. Planning uses no on-host writer.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def need(condition, message):
    if not condition:
        raise ValueError(message)


EVIDENCE = Path('/var/backups/proofofwork-ui/cleanup-evidence')
CONFIG = Path('/etc/proofofwork-retention/ui-lifecycle.json')
STATE = Path('/var/lib/proofofwork-ui-retention/state.json')
SCRATCH = Path('/var/tmp/proofofwork-deploy')
PAIR = {'current': '2084747c3f8c-20261118T181547Z', 'previous': '9f18a0ce7032-20261118T004519Z'}
GRANT = 'f08f5eb9450915470ebcd06c5030c562bcc8bdd0e190637e96f3f8fde717e16f'
CAPACITY = Path('/usr/local/sbin/proofofwork-ui-capacity')
SEVEN = 'd38a524da2d9ba5c035dc62acf4880d7235f32d49e7a4c0d7c1a77f6715aae99'
FUTURE_CAPACITY = Path('/var/lib/proofofwork-ui-scratch-capacity/2bde67832b5a80106d226c49081e89c3637ac7b8a21959706392a237f00c379f')
STAGES = {
    '31d335e99ad8-20261124T032904Z': ('02ab48e68f975bba59c2052333402d2d965a9e65b298ba0fdd9bbee36a547520', '0aa2e6467af1b06de962611770da0f8248ae9f694b387d4e8fc9b39763ea25a8', '99e2d1cd7a1e4a1abf7e8f8aa12b318f1abcdc692153ce5fc6c1802890acd355'),
    '56da86069b00-20261123T214728Z': ('a7dadd2fad60f11607f97b837f53acdaf5fdf682371b115a665fada4061d909a', 'cad273eccd0120ae28f01960b346fee0b38f0420ade290e704b16ce20679f6ad', 'eb00b12d8e4aa4fe97a87034b2bd7b59000275cf909036f57a321b5f42f1d143'),
}
STAGE_ROOTS = '32ee1411ec56d9f07af2a48e0915dd774d24716084dc492c889ec39ffa99b787'
MIB = 1024**2
WRITER = 'deploy/ui-retention/reconcile_completed_341.py'
PROOF = 'deploy/ui-retention/amo_341_recovery.py'
EXCHANGE = 'deploy/ui-retention/recovery_exchange.py'
RETIREMENT = 'deploy/ui-retention/retirement_receipt.py'


def projection(plan):
    """Derive expected ordinary records without pretending that the real switch has happened."""
    before, payload = plan['before'], plan['payload']
    prior_state = json.loads(base64.b64decode(before['stateBase64'], validate=True))
    prior_config = json.loads(base64.b64decode(before['configBase64'], validate=True))
    cfg = payload['config']
    journal = EVIDENCE / ('ui-lifecycle-upgrade-' + cfg['package']['sha256'])
    cycle = prior_state['lastCompleted']['cycleId']
    request = plan['request']
    last = dict(intentPath=str(journal/'intent.json'), completionPath=str(journal/'completed.json'),
                statusVerificationPath=str(journal/'verified.json'), priorConfigSha256=request['configSha256'],
                priorStateSha256=request['stateSha256'], supersededCycleId=None, preservedCompletedCycleId=cycle)
    template = dict(prior_state, revision=343, configSha256=payload['configSha256'], lastUpgrade=last)
    intent = dict(schema='pow-ui-retention-upgrade-intent-v1', plan=plan, stateTemplate=template,
                  stateTemplateSha256=sha(encode(template)), disposition='completed-cycle-preserved',
                  freshPreparationRequired=False)
    intent_sha = sha(encode(intent))
    state = dict(template, lastUpgrade=dict(last, intentSha256=intent_sha))
    done = dict(schema='pow-ui-retention-upgrade-completed-v1', ok=True,
                intent={'path':last['intentPath'],'sha256':intent_sha},
                config={'path':str(CONFIG),'sha256':payload['configSha256']},
                state={'path':str(STATE),'sha256':sha(encode(state))},stateRevision=343,
                priorConfig={'path':str(journal/'prior-config.json'),'sha256':request['configSha256']},
                priorState={'path':str(journal/'prior-state.json'),'sha256':request['stateSha256']},
                supersededCycleId=None,index=state['index'],freshPreparationRequired=False,retentionComplete=True,
                publicationHealthy=True,priorPackageAndPhaseEvidencePreserved=True,
                priorHelpersHoldsAndTimersPreserved=True,preservedCompletedCycleId=cycle,
                completionVerification=before['completionVerification'])
    verified = dict(schema='pow-ui-retention-upgrade-status-verified-v1',ok=True,
                    config=done['config'],state=done['state'],upgradeReceipt={'path':str(journal/'completed.json'),'sha256':sha(encode(done))},
                    preservedCompletedCycleId=cycle,contextSha256=sha(encode(state['completedContext'])))
    return dict(journal=journal,priorState=prior_state,priorConfig=prior_config,config=cfg,state=state,
                intent=intent,completed=done,verified=verified)


def fixed_inputs(native, proof, cfg, st):
    failed = proof.verify_failed_evidence(cfg, st, native.read_bound)
    old = json.loads(native.read_bound(proof.FAILED_JOURNAL/'intent.json', failed['intentSha256']))
    original = old['plan']
    need(sha(encode(original))==proof.AUTHORITY['planSha256'],'Failed 341 source plan differs')
    # Reuse the original native inode-identity and terminal check. At the exact
    # failed successor the *prior* config/state no longer occupy the live paths;
    # authenticate the original terminal by its own sealed files and inode positions.
    terminal = original['before']['priorStageReversal']
    store=Path('/var/lib/proofofwork-ui-amo-stage')/GRANT
    for name,key in [('intent.json','intentSha256'),('installed.json','installedSha256'),('rolled-back.json','rolledBackSha256')]:
        native.read_bound(store/name,terminal[key])
    helper = native.CATCHUP_PRIOR_STAGE
    root=Path('/tmp')/('proofofwork-amo-installer-'+helper['releaseId']+'-initial')
    need(native.safe(root,True).st_mode&0o777 == 0o700,'Unsafe prior installer directory')
    sealed = {'__name__':'_verified_prior_341','__file__':str(root/'amo_stage_installer.py')}
    exec(compile(native.read_bound(root/'amo_stage_installer.py',helper['installerSha256']),sealed['__file__'],'exec'),sealed)
    approval=sealed['sealed_approval'](root/'amo-approval.json',GRANT)
    frame=json.loads(native.read_bound(root/'amo-helper-frame.json',helper['frameSha256']))
    def pinned():
        native.read_bound(proof.FAILED_JOURNAL/'verification-failed.json',failed['failureSha256'])
        native.read_bound(CAPACITY,SEVEN)
        need(not os.path.lexists(FUTURE_CAPACITY),'New capacity journal requires reconciliation')
    status=sealed['operate']('status',sealed['STORE'],sealed['BINARY'],approval,
                             {k:base64.b64decode(v,validate=True) for k,v in frame['helpers'].items()},pinned,None)
    need(status=={k:terminal[k] for k in status} and status['rollbackComplete'] and not status['active'],
         '31d grant terminal changed')
    roots=[]
    for rid,(plan_sha,stage_sha,source_sha) in STAGES.items():
        p=json.loads(native.read_bound(SCRATCH/('recovery-plan-'+rid+'-initial.json'),plan_sha))
        need(p['releaseId']==rid and p['retentionLifecycle']['pair']==PAIR,'Retained stage pair changed')
        for kind,digest in [('surfaces-stage',stage_sha),('source',source_sha)]:
            res=json.loads(native.read_bound(SCRATCH/('recovery-transport-'+rid+'-'+kind+'-initial')/'receipt.json',digest))
            need(res['ok'] is True and res['releaseId']==rid and res['planSha256']==plan_sha and
                 res['productionPublished'] is False,'Retained stage receipt differs')
        for path in map(Path,(p['preservedSourceCheckout'],p['preservedSurfacesRoot'],SCRATCH/('proofofwork-www-stage-'+rid))):
            info=path.lstat()
            need(path.resolve(strict=True)==path and stat.S_ISDIR(info.st_mode),'Unsafe retained stage directory')
            roots.append([info.st_dev,info.st_ino,info.st_ctime_ns,info.st_mtime_ns])
    need(sha(encode(roots))==STAGE_ROOTS,'Retained stage roots changed')
    return failed, terminal, original


def allocation(proj, payload):
    # Files in /etc and /var/lib exchange with existing inodes on the same FS.
    # All other bytes (including reversal receipts) are charged in cleanup-evidence.
    records=('priorConfig','priorState','config','state','intent','completed','verified')
    # One file for each prior record, original and replacement pair, and up to
    # two copy-equivalents as conservative exchange/reconciliation allowance.
    total=3*sum(len(encode(proj[k])) for k in records)
    total+=2*(len(encode(payload['manifest']))+sum(v['bytes'] for v in payload['files'].values()))
    total+=4*MIB   # bounded custody metadata and filesystem rounding
    need(total<=64*MIB,'Reviewed recovery allocation exceeds 64 MiB')
    return {'rootAndBackupAdditionalBytes':total,'additionalInodes':512,'scratchAndTransportBytes':0}


def projected_reader(native, proof, original, payload, records=None):
    # Only new names in the candidate journal may resolve to projected bytes;
    # every historical read still goes through the pinned native reader.
    retirement=native.verifier_module(payload,'recovery341_candidate_retirement',RETIREMENT,
                                      {'_BOUND_AMO_341_SOURCE':base64.b64decode(payload['files'][PROOF]['base64'],validate=True),
                                       '_BOUND_AMO_341_EXCHANGE_SOURCE':base64.b64decode(payload['files'][EXCHANGE]['base64'],validate=True)})
    # This fixed sibling is an unchanged, authenticated input of the existing package.
    old_root=Path(original.config['package']['path'])
    sibling='deploy/ui-retention/failed_prepare_repair.py'
    native.read_bound(old_root/sibling,payload['manifest']['files'][sibling]['sha256'])
    retirement.__file__=str(old_root/RETIREMENT)
    if records is not None:
        journal=records['journal']
        future={journal/name:encode(records[key]) for name,key in [('intent.json','intent'),('completed.json','completed'),
                         ('prior-config.json','priorConfig'),('prior-state.json','priorState')]}
        package_root = Path(payload['config']['package']['path'])
        future[package_root/'package.json'] = encode(payload['manifest'])
        for name, item in payload['files'].items():
            future[package_root/name] = base64.b64decode(item['base64'],validate=True)
        old_read,old_raw=retirement.read_bound,retirement.read_raw_bound
        def projected(path,expected,*args):
            if Path(path) not in future:return old_read(path,expected,*args)
            raw=future[Path(path)]
            need(sha(raw)==expected,'Projected record SHA differs')
            return raw
        def projected_raw(path,*args):
            return future[Path(path)] if Path(path) in future else old_raw(path,*args)
        retirement.read_bound,retirement.read_raw_bound=projected,projected_raw
    loaded=retirement.load_verified_retirement(original.config['payloadRetirement'],original.layout,
                        lambda layout: original.S.protected_pair(layout,{}))
    need(loaded.proof==original.retirement.proof,'Candidate changed original retirement proof')
    return loaded


def review(native, proof, exchange, original, payload):
    req=proof.request()
    cfgraw=native.read_bound(CONFIG,req['configSha256']);straw=native.read_bound(STATE,req['stateSha256'])
    cfg,st=json.loads(cfgraw),json.loads(straw)
    failed,reversal,old_plan=fixed_inputs(native,proof,cfg,st)
    need(st['status']=='complete' and not st.get('pending') and not st.get('activePhase'),
         'Prior cycle has pending work')
    candidate=projected_reader(native,proof,original,payload)
    candidate.verify_failed_amo_341(st,cfg)
    _,context=original.current()
    scope=original.policy_scope(st['index'])
    need(context==st['completedContext'] and context['pair']==PAIR and not scope['eligible'] and
         scope['verifiedRetiredPayloads']==original.retirement.proof,'Failed predecessor physical retention differs')
    stored=json.loads(native.read_bound(proof.FAILED_JOURNAL/'completed.json',failed['completedSha256']))['completionVerification']
    vps=original.verify_vps_completion(st,context)
    need(stored['fullCompletionVerified'] is True and stored['context']==context and
         stored['index']==st['index'] and stored['lastCompleted']==st['lastCompleted'] and
         stored['verifiedRetiredPayloads']==candidate.proof and stored['vpsVerification']==vps,
         'Original ordinary completion proof differs')
    original.S.compare_guards(original.layout,context['guards'],[])
    original.retirement.verify_scope(original.layout)
    # The original controller owns verification of installed capacity authority.
    # Its normal status also verifies the transport terminal in verify_vps_completion.
    controller=cfg['controller']
    scope_module={'__name__':'verified_341_capacity','__file__':controller['path']}
    raw=native.read_bound(controller['path'],controller['sha256'])
    exec(compile(raw,controller['path'],'exec'),scope_module)
    floor=scope_module['capacity_floor_authority'](original.layout)
    scratch=scope_module['scratch_capacity_authority'](original.layout)
    helper_paths=('scratch_successor.py','amo_scratch_successor.py')
    for name in helper_paths:
        relative='deploy/ui-retention/'+name
        native.read_bound(Path(cfg['package']['path'])/relative,payload['manifest']['files'][relative]['sha256'])
    candidate_scope=native.verifier_module(payload,'recovery_341_prospective_scope','deploy/ui-retention/lifecycle_remote.py')
    candidate_scope.__file__=controller['path']  # authenticated, unchanged scratch reader siblings
    scope_raw=base64.b64decode(payload['files'][native.CATCHUP_SCRATCH_SCOPE]['base64'],validate=True)
    need(sha(scope_raw)==native.CATCHUP_SCRATCH_SHA,'Reviewed catch-up scratch scope changed')
    prior_authority=json.loads(scope_raw)['predecessorAuthority']
    need(floor==candidate_scope.capacity_floor_authority(original.layout) and
         scratch==candidate_scope.scratch_capacity_authority(original.layout) and
         floor['rootReserveBytes']==8*1024**3 and floor['growthReserveBytes']==64*MIB and
         scratch['scratchBudgetBytes']==7*1024**3 and
         all(scratch[k]==v for k,v in prior_authority.items()),
         'Reviewed predecessor and successor capacity authorities differ')
    # The failed 341 cannot supply ordinary status. Use the same intent census
    # against this exact authenticated failed state without calling state() again.
    paths = list(original.layout.evidence.glob('ui-lifecycle-*-intent.json'))
    need(len(paths) <= 100000, 'Lifecycle evidence enumeration exceeds bound')
    adoption,repair = original.storage_adoption(st),original.failed_prepare_repair(st)
    sealed = {record['sealedPhaseIntent']['path'] for record in (adoption,repair) if record}
    need(all(str(path) in sealed or os.path.lexists(path.with_name(
        path.name.removesuffix('-intent.json')+'-completed.json')) for path in paths),'Other lifecycle intent is unfinished')
    completed=native.completed_phase_evidence(original,st,req['stateSha256'],
                         {'context':context,'verifiedRetiredPayloads':candidate.proof})
    reference=old_plan['before']['completedReview']
    need({k:v for k,v in completed.items() if k not in ('state','stateSha256')}==
         {k:v for k,v in reference.items() if k not in ('state','stateSha256')},
         'Preserved completed-phase receipts or retirement evidence differ')
    device=exchange.directory(EVIDENCE)[0]
    for live in (CONFIG,STATE):
        for ancestor in live.parents:
            exchange.directory(ancestor)
        need(exchange.directory(live.parent)[0]==device,'Recovery custody and original files must share a filesystem')
    descriptors={'config':exchange.read(CONFIG)[1],'state':exchange.read(STATE)[1]}
    need(all(v['identity'][0]==device and v['sha256']==req[k+'Sha256'] for k,v in descriptors.items()),
         'Recovery inode or original digest differs')
    return dict(configBase64=base64.b64encode(cfgraw).decode(),stateBase64=base64.b64encode(straw).decode(),
                completedReview=completed,capacityAuthority={'floor':floor,'scratch':scratch},
                completionVerification=stored,amo341Failure=failed,priorStageReversal=reversal,
                guards=native.guard_inventory(),evidence=native.evidence_inventory(EVIDENCE),
                originalFiles=descriptors)


def make_plan(native,proof,exchange,original,base_payload):
    before=review(native,proof,exchange,original,base_payload)
    payload=native.preserve_retirement(base_payload,before)
    plan=dict(schema='pow-ui-retention-upgrade-plan-v1',scopeApprovalSha256=native.APPROVAL,payload=payload,
              request=proof.request(),before=before)
    proj=projection(plan)
    need(not os.path.lexists(proj['journal']) and not os.path.lexists(payload['config']['package']['path']),
         'Recovery package or journal already exists; inspect before proceeding')
    projected_reader(native,proof,original,payload,proj).verify_prospective_amo_341(proj['state'],proj['config'])
    budget=allocation(proj,payload)
    subprocess.run(['/usr/bin/python3','-I','-B',str(CAPACITY),'check','--path',str(EVIDENCE),
                    '--additional-bytes',str(budget['rootAndBackupAdditionalBytes']),'--additional-inodes',
                    str(budget['additionalInodes']),'--phase','amo-341-native-recovery'],check=True,capture_output=True,timeout=180)
    return plan


def save_package(native,payload):
    root=Path(payload['config']['package']['path'])
    root.mkdir(mode=0o700);native.sync(root.parent)
    for name,file in payload['files'].items():
        target=root/name
        for p in reversed(target.parents):
            if root in p.parents and not os.path.lexists(p):
                p.mkdir(mode=0o700);native.sync(p.parent)
        native.save(target,base64.b64decode(file['base64'],validate=True))
    native.save(root/'package.json',encode(payload['manifest']))
    return root


def verify_package(native,payload):
    root=Path(payload['config']['package']['path'])
    manifest=payload['manifest']
    native.read_bound(root/'package.json',payload['config']['package']['sha256'])
    for name,item in manifest['files'].items():
        need(len(native.read_bound(root/name,item['sha256']))==item['bytes'],'Installed package length differs')
    expected={root/'package.json',*(root/name for name in manifest['files'])}
    dirs={root,*[p for f in expected for p in f.parents if root in p.parents]}
    for path in dirs:
        info=native.safe(path,True)
        need(info.st_gid==os.getegid() and stat.S_IMODE(info.st_mode)==0o700,'Recovery directory custody differs')
        for entry in path.iterdir():
            need(entry in expected or entry in dirs,'Unreviewed installed recovery package entry')
    for path in expected:
        info=native.safe(path)
        need(info.st_gid==os.getegid() and stat.S_IMODE(info.st_mode)==0o600,'Recovery file custody differs')


def forecast(plan):
    p=projection(plan); payload=plan['payload']
    return {'scope':'prospective-341-to-343','planSha256':sha(encode(plan)),
            'packageSha256':payload['config']['package']['sha256'],'configSha256':payload['configSha256'],
            'stateSha256':sha(encode(p['state'])),'afterRevision':343,'preservedPair':PAIR,
            'originalFilesSha256':sha(encode(plan['before']['originalFiles'])),
            'projectedIntentSha256':sha(encode(p['intent'])),'projectedCompletedSha256':sha(encode(p['completed'])),
            'projectedNativeSealSha256':sha(encode(p['verified'])),
            'capacityAuthoritySha256':sha(encode(plan['before']['capacityAuthority'])),
            'completionVerificationSha256':sha(encode(plan['before']['completionVerification'])),
            'capacity':allocation(p,payload),'historical341Failed':True,'installed':False}


def execute(native,proof,exchange,action,value):
    """Entered only by the authenticated normal completed-cycle installer dispatcher."""
    need(socket.gethostname()=='ubuntu-4gb-hel1-1' and os.getuid()==os.geteuid()==os.getgid()==os.getegid()==0
         and sys.flags.isolated and sys.dont_write_bytecode and not sys.flags.optimize,'Wrong receiver or interpreter')
    os.umask(0o077)
    base_payload=value['payload']
    native.validate_payload(base_payload)
    auth=proof.AUTHORITY
    # The predecessor remains the lock/storage implementation even if a prior
    # attempt stopped between the two live exchanges.
    storage_path='deploy/audit30/ui-storage.py'
    old_store=EVIDENCE/('ui-lifecycle-tools-'+auth['packageSha256'])/storage_path
    old_manifest=json.loads(native.read_bound(old_store.parents[2]/'package.json',auth['packageSha256']))
    need(old_manifest['files'][storage_path]==base_payload['manifest']['files'][storage_path],
         'Original deployment lock implementation differs')
    loader=native.verifier_module(base_payload,'recovery341_storage','deploy/audit30/ui-storage.py')
    native.read_bound(old_store,base_payload['manifest']['files']['deploy/audit30/ui-storage.py']['sha256'])
    loader.__file__=str(old_store)
    layout=loader.Layout()
    fd=loader.lock(layout)
    try:
        guard=lambda:loader.require_execution_lock(fd,layout)
        guard()
        if action=='plan':
            need(set(value)=={'payload'},'Expanded read-only recovery frame')
            original=native.existing_runtime(auth['configSha256'])
            original.lock_fd=fd
            plan=make_plan(native,proof,exchange,original,base_payload)
            return forecast(plan)
        need(action in ('apply','status','reconcile') and set(value)=={'payload','planSha256'} and
             native.SHA.fullmatch(value['planSha256']), 'Expanded or unbound recovery request')
        j=EVIDENCE/('ui-lifecycle-upgrade-'+base_payload['config']['package']['sha256'])
        fresh = not os.path.lexists(j)
        if fresh:
            need(action=='apply','Recovery journal does not yet exist')
            original=native.existing_runtime(auth['configSha256']);original.lock_fd=fd
            plan=make_plan(native,proof,exchange,original,base_payload)
        else:
            native.safe(j,True)
            prior_intent=json.loads(native.read_bound(j/'intent.json'))
            plan=prior_intent['plan']
        need(sha(encode(plan))==value['planSha256'] and plan['request']==proof.request() and plan['payload']==native.preserve_retirement(base_payload,plan['before']),
             'Recovery request, original committed package or plan digest changed')
        proj=projection(plan);j=proj['journal'];payload=plan['payload']
        files=plan['before']['originalFiles']
        prior={'config':auth['configSha256'],'state':auth['stateSha256']}
        live={'config':encode(proj['config']),'state':encode(proj['state'])}

        def fence():
            guard()
            native.read_bound(proof.FAILED_JOURNAL/'verification-failed.json',auth['failureSha256'])
            need(not os.path.lexists(proof.FAILED_JOURNAL/'verified.json') and not os.path.lexists(FUTURE_CAPACITY),
                 'Failed authority or successor capacity changed')
            native.read_bound(CAPACITY,SEVEN)

        def validate_prepared():
            fence()
            verify_package(native,payload)
            for name,key in [('prior-state.json','priorState'),('prior-config.json','priorConfig'),('intent.json','intent')]:
                need(native.read_bound(j/name)==encode(proj[key]),'Recovery journal differs')
            permitted={'prior-state.json','prior-config.json','intent.json','completed.json','verified.json','exchange'}
            need(set(os.listdir(j))<=permitted,'Unexpected recovery journal entry')
            for name,key in [('completed.json','completed'),('verified.json','verified')]:
                if os.path.lexists(j/name):need(exchange.read(j/name)[0]==encode(proj[key]),'Conflicting recovery terminal')
            guards=native.guard_inventory()
            guards['existingPackages']=[p for p in guards['existingPackages'] if p!=Path(payload['config']['package']['path']).name]
            need(guards==plan['before']['guards'],'Existing helpers/holds/timers/pair changed')
            evidence=native.evidence_inventory(EVIDENCE)
            for p in (j,Path(payload['config']['package']['path'])):evidence.pop(p.name)
            need(evidence==plan['before']['evidence'],'Original lifecycle evidence changed')
            fixed_inputs(native,proof,proj['priorConfig'],proj['priorState'])

        def restored():
            validate_prepared()
            need(exchange.read(CONFIG)[1]==files['config'] and exchange.read(STATE)[1]==files['state'],
                 'Recovery did not restore the original 341 inode pair')
            return sha(encode(proof.verify_failed_evidence(proj['priorConfig'],proj['priorState'],native.read_bound)))

        def outer_receipt(name, record, *, create=False):
            path = j / name
            expected = encode(record)
            if create and not os.path.lexists(path):
                exchange.create(path, expected)
            raw, descriptor, _ = exchange.read(path)
            need(raw == expected, 'Conflicting recovery terminal')
            # A prior process may have linked a fully fsynced inode and stopped
            # before flushing its name. Repeat this even for an existing receipt.
            native.sync(j)
            need(exchange.read(path)[1] == descriptor, 'Recovery receipt changed during durability check')
            return descriptor['sha256']

        def verify_after():
            validate_prepared()
            native.read_bound(CONFIG,payload['configSha256']);native.read_bound(STATE,proj['completed']['state']['sha256'])
            outer_receipt('completed.json', proj['completed'], create=True)
            installed=native.existing_runtime(payload['configSha256'])
            installed.lock_fd=fd
            state=proj['state']; state_sha=proj['completed']['state']['sha256']
            has_seal = os.path.lexists(j/'verified.json')
            if has_seal:
                outer_receipt('verified.json', proj['verified'])
            status=installed.recovery_switch_status(require_current_seal=has_seal)
            need(status['configSha256']==payload['configSha256'] and status['stateSha256']==state_sha
                 and status['retentionComplete'] is True
                 and status['publicationHealthy'] is True and status['context']==state['completedContext']
                 and status['pair']==PAIR and not status['unfinishedIntents'],'Installed native status failed')
            seal_sha = outer_receipt('verified.json', proj['verified'], create=True)
            status=installed.recovery_switch_status(require_current_seal=True)
            need(status['stateSha256']==state_sha and status['configSha256']==payload['configSha256'] and
                 status['publicationHealthy'] is True and status['retentionComplete'] is True and status['pair']==PAIR,
                 'Native recovery status with actual provisional seal failed')
            validate_prepared()
            return seal_sha

        def verify_ordinary():
            validate_prepared()
            outer_receipt('completed.json', proj['completed'])
            verified_sha = outer_receipt('verified.json', proj['verified'])
            runtime=native.existing_runtime(payload['configSha256']);runtime.lock_fd=fd
            status=runtime.recovery_switch_status(require_current_seal=True,provisional=True)
            need(status['retentionComplete'] is True and status['publicationHealthy'] is True and
                 status['stateSha256']==proj['completed']['state']['sha256'] and status['pair']==PAIR and
                 status['configSha256']==payload['configSha256'] and status['context']==proj['state']['completedContext']
                 and not status['unfinishedIntents'],'Native ordinary acceptance failed')
            validate_prepared()
            return proof.acceptance_digest(proj['config'],proj['completed'],verified_sha)

        def exchange_phase(phase):
            return exchange.operate(phase,j/'exchange',value['planSha256'],prior,live,fence,verify_after,restored,
                                    prior_descriptors=files,verify_ordinary=verify_ordinary)

        if fresh:
            j.mkdir(mode=0o700);native.sync(j.parent)
            for name,key in [('intent.json','intent'),('prior-config.json','priorConfig'),('prior-state.json','priorState')]:
                native.save(j/name,encode(proj[key]))
            save_package(native,payload)
            validate_prepared()
            reviewed=native.completed_package_review(payload,Path(payload['config']['package']['path']),original,
                                                     plan['before']['completedReview'])
            need(reviewed==plan['before']['completionVerification'],'Candidate package ordinary proof changed before activation')
            need(files=={'config':exchange.read(CONFIG)[1],'state':exchange.read(STATE)[1]},'Failed 341 inode pair changed')
            exchange_phase('prepare')
        validate_prepared()
        if action=='apply' and not fresh:
            need(exchange_phase('status')['disposition']=='prepared',
                 'Only an exactly prepared matching operation may resume apply')
        result=exchange_phase(action)
        if action=='status' and result['disposition']=='accepted':
            native_runtime=native.existing_runtime(payload['configSha256']);native_runtime.lock_fd=fd
            normal=native_runtime.status({'requireComplete':True})
            need(normal['retentionComplete'] is True and normal['publicationHealthy'] is True and
                 normal['stateSha256']==proj['completed']['state']['sha256'] and normal['pair']==PAIR,
                 'Ordinary status requires independent reconciliation')
        if action=='status' and result=={'disposition':'absent','planSha256':value['planSha256']}:
            # The complete outer journal precedes creation of the paired custody.
            # The exchange reader already checked both original descriptors.
            restored()
            result=dict(result,positions={'config':'before','state':'before'})
        # Report the two independently checked positions, including partial and restored states.
        live_digests={k+'Sha256':(prior[k] if position=='before' else sha(live[k]))
                      for k,position in result['positions'].items()}
        if result['disposition']=='restored':
            restored()
        return {'exchange':result,**live_digests,'accepted':result['disposition']=='accepted',
                'planSha256':value['planSha256'],'capacity':allocation(proj,payload)}
    finally:os.close(fd)
