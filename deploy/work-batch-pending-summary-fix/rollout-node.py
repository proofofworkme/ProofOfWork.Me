#!/usr/bin/python3 -I
"""Explicit rollout dispatcher: preserve the Search hold on every error path."""
import base64, copy, hashlib, json, os, signal, subprocess, sys

CONTROLLER_TIMEOUT_SECONDS = 4800
SEARCH_TIMEOUT_SECONDS = 1200
CONTROLLER_RECOVERY_GRACE_SECONDS = 600

class ControllerStillRunning(RuntimeError):
    """Keep Search held until an interrupted or incomplete rollback is recovered."""

def decoded(plan, key):
    raw = base64.b64decode(plan[key+'Base64'], validate=True)
    if hashlib.sha256(raw).hexdigest() != plan[key+'Sha256']: raise ValueError('Changed '+key)
    return raw

def invoke(code, argv=(), payload=None, require_recovery_receipt=False):
    child = subprocess.Popen(['/usr/bin/python3', '-I', '-B', '-c', code.decode(), *argv],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        stdout, stderr = child.communicate(payload, timeout=CONTROLLER_TIMEOUT_SECONDS if require_recovery_receipt else SEARCH_TIMEOUT_SECONDS)
    except BaseException:
        # SIGINT is a Python exception: both fixed controllers can finish their
        # existing rollback paths before this dispatcher leaves the hold scope.
        if child.poll() is None: child.send_signal(signal.SIGINT)
        try: stdout, stderr = child.communicate(timeout=CONTROLLER_RECOVERY_GRACE_SECONDS)
        except subprocess.TimeoutExpired:
            raise ControllerStillRunning('Controller rollback is still running; retain the Search hold for supervised recovery')
        if require_recovery_receipt:
            try: receipt = json.loads(stdout)
            except (ValueError, UnicodeError): receipt = {}
            if not isinstance(receipt,dict) or receipt.get('rolledBack') is not True or receipt.get('recoveryIncomplete'):
                raise ControllerStillRunning('Interrupted controller recovery is unverified; retain the Search hold')
        raise
    if len(stdout) > 1024*1024 or len(stderr) > 1024*1024:
        if require_recovery_receipt:
            raise ControllerStillRunning('Oversized controller evidence; retain the Search hold')
        raise ValueError('Controller output exceeds evidence ceiling')
    try: receipt = json.loads(stdout)
    except (ValueError, UnicodeError):
        if require_recovery_receipt:
            raise ControllerStillRunning('Malformed controller evidence; retain the Search hold') from None
        raise ValueError('Malformed controller evidence') from None
    if require_recovery_receipt and not isinstance(receipt,dict):
        raise ControllerStillRunning('Invalid controller evidence; retain the Search hold')
    if child.returncode:
        if not isinstance(receipt,dict) or receipt.get('recoveryIncomplete') or (require_recovery_receipt and receipt.get('rolledBack') is not True):
            raise ControllerStillRunning('Controller recovery is unverified; retain the Search hold for supervised recovery')
        raise ValueError('Controller refused: '+stderr[-4000:].decode(errors='replace'))
    if require_recovery_receipt and (receipt.get('installed') is not True or receipt.get('recoveryIncomplete')):
        raise ControllerStillRunning('Controller success is unverified; retain the Search hold')
    return receipt


def rollout(envelope):
    if set(envelope)!={'format','planBase64','planSha256','rehearsal'} or envelope['format']!='work-batch-pending-summary-dispatch-request-v1':
        raise ValueError('Exact plan and rehearsal dispatch envelope required')
    raw=base64.b64decode(envelope['planBase64'],validate=True)
    if hashlib.sha256(raw).hexdigest()!=envelope['planSha256']:raise ValueError('Plan bytes differ')
    plan=json.loads(raw)
    reference=envelope['rehearsal']
    if type(reference)is not dict or set(reference)!={'path','sha256'}:raise ValueError('Missing rehearsal binding')
    if os.geteuid() != 0 or not sys.flags.isolated or plan.get('format') != 'proof-of-work-work-batch-pending-summary-fix-rollout-plan-v1':
        raise ValueError('Exact rollout plan, root and isolated Python required')
    controller = decoded(plan, 'controller'); holder = decoded(plan, 'searchHoldController')
    ns = {'__name__':'_work-batch-pending-summary-fix_rollout_preflight'}; exec(compile(controller, 'work-batch-pending-summary-fix-scoped-node.py','exec'),ns)
    manifest = copy.deepcopy(plan['runtimeManifestTemplate'])
    ns['validate_manifest'](manifest); ns['fence'](ns['ROOT'], manifest, ns['validate_manifest'](manifest))
    ns['metadata_fence'](ns['ROOT'], manifest['sourceMetadata'])
    ns['source_identity_fence'](ns['ROOT'],manifest)
    if ns['batch_authority']()!=manifest['batchAuthority']:raise ValueError('Existing batch v1 changed')
    if manifest['sourceCommit'] != plan['sourceCommit'] or manifest['releaseId'] != plan['releaseId']:
        raise ValueError('Manifest provenance differs')
    ns['capture_api_environment']()
    ns['require_restart_configuration'](manifest['restartConfigurationSha256'])
    from pathlib import Path
    qraw=ns['safe_read'](Path(reference['path']),8*1024**2)
    if ns['sha'](qraw)!=reference['sha256']:raise ValueError('Qualification changed')
    ns['validate_rehearsal'](json.loads(qraw),envelope['planSha256'],manifest,plan['rehearsalHelperSha256'])
    manifest['rehearsal']={**reference,'planSha256':envelope['planSha256'],'helperSha256':plan['rehearsalHelperSha256']}
    files = manifest['searchHold']['bindings']['files']
    args = ['--release-id',plan['releaseId'],'--attempt','initial',
        '--service-sha256',files[ns['SEARCH'][0]],'--timer-sha256',files[ns['SEARCH'][1]]]
    held = invoke(holder, ['--phase','hold',*args])
    outcome = {'format':'proof-of-work-work-batch-pending-summary-fix-rollout-result-v1','releaseId':plan['releaseId'],'rehearsal':reference,'hold':held}
    restore = True
    try:
        marker = ns['safe_read'](ns['HOLD'], 65536)
        manifest['searchHold']['markerSha256'] = ns['sha'](marker)
        ns['validate_manifest'](manifest)
        outcome['overlay'] = invoke(controller, payload=(json.dumps(manifest)+'\n').encode(), require_recovery_receipt=True)
    except ControllerStillRunning:
        restore = False
        outcome['searchRestoreDeferred'] = 'Controller rollback is still running; preserve the exact Search hold'
        raise
    finally:
        if restore: outcome['searchRestore'] = invoke(holder, ['--phase','restore',*args])
        print(json.dumps(outcome),flush=True)
    return outcome

def main():
    def interrupted(signum, frame): raise InterruptedError('WORK canonical reader rollout interrupted')
    for kind in (signal.SIGTERM, signal.SIGHUP): signal.signal(kind, interrupted)
    raw = sys.stdin.buffer.read(30*1024**2+1)
    if len(raw) > 30*1024**2: raise ValueError('Oversized rollout plan')
    rollout(json.loads(raw))

if __name__ == '__main__': main()
