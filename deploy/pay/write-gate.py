#!/usr/bin/python3 -I
"""Pay-only adapter over the reviewed one-file activation and recovery engine.

Prepare/capture do not enable writes. Apply requires an independently reviewed
successful Pay deployment, exact-tip preactivation qualification and capture.
"""
import hashlib
from pathlib import Path

ADAPTER = Path(__file__).resolve()
ENGINE = ADAPTER.parent.parent / 'mail-work-batch/activation-controller.py'
ENGINE_SHA256 = 'f9ae6507699b48b353a27719d90d1bc40e0fa563861c75b9e41807f1a540d8ab'
SUPPORT = ADAPTER.parent.parent / 'mail-work-batch/scoped-node.py'
SUPPORT_SHA256 = '6802cd6b4cff7138b7e1f620deee5a2a8d898bd99b1f0ed65bc38eec91793fda'
engine_raw = ENGINE.read_bytes()
if hashlib.sha256(engine_raw).hexdigest() != ENGINE_SHA256:
    raise ValueError('Activation engine changed; independent review required')
# Keep its complete configuration, ownership/race, journaling and recovery
# behavior. Only the dedicated product namespace changes; declaration handling
# and evidence admission are replaced explicitly below.
engine_source = engine_raw.decode().split("\nif __name__ == '__main__':", 1)[0]
engine_source = engine_source.replace('WORK_MAIL_BATCH_', 'POW_PAY_').replace('work-mail-batch', 'pay')
exec(compile(engine_source, str(ADAPTER), 'exec'), globals())
engine_main = main
FIELDS = {}
DROPIN = Path('/etc/systemd/system/proofofwork-api.service.d/zzzzz-pay-writes.conf')
SWITCH = 'POW_PAY_WRITES_ENABLED'

# systemd may reorder unit memberships on daemon-reload. Preserve every member
# and all ordered configuration, while binding membership rather than its display order.
_ENGINE_CONFIGURATION = configuration


def canonical_unit_dependencies(value):
    require(isinstance(value, str), 'Unsupported systemd dependency serialization')
    if value == '':
        return value
    names = value.split(' ')
    require(len(names) == len(set(names)) and all(
        0 < len(name) <= 255 and
        re.fullmatch(r'(?:[A-Za-z0-9:_.@-]|\\x[0-9A-Fa-f]{2})+', name)
        for name in names), 'Unsupported systemd dependency serialization')
    return ' '.join(sorted(names))


def configuration(h, owned):
    units = (API, WORKER, *h['GATEWAY'], *h['AUTHORITY'], *h['SEARCH'])
    def ctl(*args):
        value = h['ctl'](*args)
        if (len(args) == 5 and args[0] == 'show' and args[1] in units and
                args[2:4] == ('--value', '-p') and args[4] in ('Requires', 'PartOf')):
            return canonical_unit_dependencies(value)
        return value
    return _ENGINE_CONFIGURATION({**h, 'ctl': ctl}, owned)



def public_pins(pins):
    require(pins == {}, 'Pay has no environment-supplied protocol or declaration authority')
    return {}


def bound_json(binding, limit=32*1024**2):
    require(isinstance(binding,dict) and set(binding)=={'path','sha256'} and
        SHA.fullmatch(binding['sha256']), 'Missing exact evidence reference')
    path=Path(binding['path'])
    require(path.is_absolute() and str(path).startswith(('/tmp/','/data/')) and
        path.resolve(strict=True)==path, 'Evidence must remain on the VPS')
    info=path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and not info.st_mode&0o7022 and
        info.st_size<=limit, 'Unsafe evidence file')
    identity=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
    with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb') as stream:
        require(identity(os.fstat(stream.fileno()))==identity(info),'Evidence changed before read')
        raw=stream.read(limit+1)
        require(identity(os.fstat(stream.fileno()))==identity(info) and identity(path.lstat())==identity(info),
            'Evidence changed during read')
    require(len(raw)==info.st_size and sha(raw)==binding['sha256'],'Evidence hash differs')
    return json.loads(raw),raw


def deployment_evidence(approval,h):
    manifest,mraw=bound_json(approval['deploymentManifest'])
    receipt,_=bound_json(approval['deploymentReceipt'])
    return validate_deployment(manifest,mraw,receipt,approval,h)


def validate_deployment(manifest,mraw,receipt,approval,h):
    require(manifest.get('format')=='proof-of-work-pay-scoped-runtime-v1' and
        receipt.get('format')==manifest['format'] and manifest.get('sourceCommit')==approval['sourceCommit'] and
        receipt.get('sourceCommit')==approval['sourceCommit'] and receipt.get('manifestSha256')==sha(mraw) and
        manifest.get('baselineHead')==receipt.get('baselineHead')==approval['runtimeHead'] and
        receipt.get('releaseId')==manifest.get('releaseId'), 'Wrong completed Pay deployment')
    require(receipt.get('installed') is True and receipt.get('rolledBack') is False and receipt.get('completedAt') and
        not any(receipt.get(k) for k in ('errorClass','recoveryIncomplete','recoveryErrorClass')),
        'Pay deployment is incomplete or recovered')
    rows=manifest.get('sources',[])
    require(len(rows)==len(h['ALLOWED']) and {row['path'] for row in rows}==h['ALLOWED'] and
        receipt.get('sources')==[{k:v for k,v in row.items() if k!='base64'} for row in rows],
        'Pay deployment scope or receipt differs')
    expected={**manifest['dependencies'],**{row['path']:row['after'] for row in rows}}
    require({name:row['sha256'] for name,row in approval['runtime'].items()}==expected,
        'Activation runtime is not the exact successful Pay deployment')
    require(approval['node']['sha256']==manifest['nodeSha256'],'Deployment Node differs')
    return expected


def qualification_evidence(approval):
    report,_=bound_json(approval['qualification'],2*1024**2)
    return validate_qualification(report,approval)


def validate_qualification(report,approval):
    result=report.get('result',{})
    require(report.get('format')=='pay-write-gate-qualification-v1' and
        report.get('sourceCommit')==approval['sourceCommit'] and report.get('rootReviewed') is True and
        report.get('checkerSha256')==approval['checkerSha256'] and
        report.get('runtimeAfter')=={name:row['sha256'] for name,row in approval['runtime'].items()} and
        result.get('ok') is True and result.get('mode')=='preactivation' and
        result.get('signingExercised') is False and type(result.get('height')) is int and
        result['height']>=975856 and SHA.fullmatch(result.get('hash','')),
        'Reviewed exact-source Pay preactivation qualification is missing')
    return {'height':result['height'],'blockHash':result['hash']}


def load_helper(approval):
    require(approval.get('format')=='pay-activation-approval-v1' and COMMIT.fullmatch(approval.get('sourceCommit','')) and
        COMMIT.fullmatch(approval.get('runtimeHead','')) and SHA.fullmatch(approval.get('runtimeStatusSha256','')),
        'Missing reviewed Pay approval identity')
    paths={'controllerSha256':ADAPTER,'probeSha256':HERE/'write-gate-probe.mjs',
        'dormantControllerSha256':HERE/'scoped-node.py','engineSha256':ENGINE,'supportSha256':SUPPORT,
        'checkerSha256':HERE.parent.parent/'scripts/check-pay-live.mjs'}
    for key,path in paths.items():
        require(SHA.fullmatch(approval.get(key,'')) and sha(path.read_bytes())==approval[key],
            'Reviewed activation source changed')
    require(approval['engineSha256']==ENGINE_SHA256 and approval['supportSha256']==SUPPORT_SHA256,
        'Unreviewed activation support')
    h={'__name__':'_pay_gate_runtime'}
    exec(compile((HERE/'scoped-node.py').read_bytes(),'pay-scoped-node.py','exec'),h)
    support={'__name__':'_pay_gate_support'}
    exec(compile(SUPPORT.read_bytes(),str(SUPPORT),'exec'),support)
    for name in ('process_environment','normalize_exec_start','rename_absent'):
        h[name]=support[name]
    deployment_evidence(approval,h)
    qualification_evidence(approval)
    return h


def probe(h,approval,owned=None,expected_pins=None):
    require(expected_pins in (None,{}),'Unexpected Pay declaration pins')
    checkpoint=qualification_evidence(approval)
    environment=process_environment(h,owned)
    node=approval['node']['path']
    pid=h['states']((API,))[API]['MainPID']
    require(os.readlink('/proc/'+pid+'/exe')==node,'Running Node identity differs')
    completed=subprocess.run([node,'--max-old-space-size=192',str(HERE/'write-gate-probe.mjs')],
        input=canonical({'expectedWriteEnabled':bool(owned and owned['enabled']),'checkpoint':checkpoint}),
        stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=environment,timeout=45,check=False)
    require(completed.returncode==0 and len(completed.stdout)<=65536,'Independent Pay gate evidence unavailable')
    result=json.loads(completed.stdout)
    require(result.get('format')=='pay-write-gate-evidence-v1' and result.get('pins')=={} and
        result.get('tip')==checkpoint and result.get('writesEnabled') is bool(owned and owned['enabled']) and
        result.get('readerQualified') is True,'Pay gate probe differs')
    return result


if __name__=='__main__':
    try: engine_main()
    except BaseException:
        print('Pay write-gate controller failed; inspect the private VPS receipt.',file=sys.stderr)
        sys.exit(1)
