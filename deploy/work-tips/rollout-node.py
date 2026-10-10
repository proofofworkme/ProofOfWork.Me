#!/usr/bin/python3 -I
"""Explicit rollout dispatcher: preserve the Search hold on every error path."""
import base64, copy, hashlib, json, os, signal, subprocess, sys

class ControllerStillRunning(RuntimeError):
    """Keep Search held until an interrupted or incomplete rollback is recovered."""

def decoded(plan, key):
    raw = base64.b64decode(plan[key+'Base64'], validate=True)
    if hashlib.sha256(raw).hexdigest() != plan[key+'Sha256']: raise ValueError('Changed '+key)
    return raw

def controller_receipt(stdout, stderr, returncode, require_recovery_receipt):
    try:
        if len(stdout) > 1024*1024 or len(stderr) > 1024*1024:
            raise ValueError('Controller output exceeds evidence ceiling')
        receipt = json.loads(stdout)
        if not isinstance(receipt, dict): raise ValueError('Controller receipt must be an object')
    except BaseException as error:
        if require_recovery_receipt:
            raise ControllerStillRunning('Controller recovery is unverified; retain the Search hold for supervised recovery') from error
        raise
    if receipt.get('recoveryIncomplete') or (require_recovery_receipt and not (
            receipt.get('rolledBack') is True or (returncode == 0 and receipt.get('installed') is True))):
        raise ControllerStillRunning('Controller recovery is unverified; retain the Search hold for supervised recovery')
    return receipt

def invoke(code, argv=(), payload=None, require_recovery_receipt=False):
    child = subprocess.Popen(['/usr/bin/python3', '-I', '-B', '-c', code.decode(), *argv],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        stdout, stderr = child.communicate(payload, timeout=360)
    except BaseException:
        # SIGINT is a Python exception: both fixed controllers can finish their
        # existing rollback paths before this dispatcher leaves the hold scope.
        # Every interruption during signaling or grace remains uncertain.
        try:
            if child.poll() is None: child.send_signal(signal.SIGINT)
            stdout, stderr = child.communicate(timeout=600)
            controller_receipt(stdout, stderr, child.returncode, require_recovery_receipt)
        except BaseException as recovery_error:
            raise ControllerStillRunning('Controller recovery is unverified; retain the Search hold for supervised recovery') from recovery_error
        # Verified installation/rollback permits Search restoration, but the
        # original timeout/interruption must still fail the overall dispatch.
        raise
    receipt = controller_receipt(stdout, stderr, child.returncode, require_recovery_receipt)
    if child.returncode:
        raise ValueError('Controller refused: '+stderr[-4000:].decode(errors='replace'))
    return receipt

def rollout(plan):
    if os.geteuid() != 0 or not sys.flags.isolated or plan.get('format') != 'proof-of-work-work-tips-rollout-plan-v1':
        raise ValueError('Exact rollout plan, root and isolated Python required')
    controller = decoded(plan, 'controller'); holder = decoded(plan, 'searchHoldController')
    ns = {'__name__':'_work_tips_rollout_preflight'}; exec(compile(controller, 'work-tips-scoped-node.py','exec'),ns)
    manifest = copy.deepcopy(plan['runtimeManifestTemplate'])
    ns['validate_manifest'](manifest); ns['fence'](ns['ROOT'], manifest, ns['validate_manifest'](manifest))
    if manifest['sourceCommit'] != plan['sourceCommit'] or manifest['releaseId'] != plan['releaseId']:
        raise ValueError('Manifest provenance differs')
    files = manifest['searchHold']['bindings']['files']
    args = ['--release-id',plan['releaseId'],'--attempt','initial',
        '--service-sha256',files[ns['SEARCH'][0]],'--timer-sha256',files[ns['SEARCH'][1]]]
    held = invoke(holder, ['--phase','hold',*args])
    outcome = {'format':'proof-of-work-work-tips-rollout-result-v1','releaseId':plan['releaseId'],'hold':held}
    restore = True
    try:
        marker = ns['safe_read'](ns['HOLD'], 65536)
        manifest['searchHold']['markerSha256'] = ns['sha'](marker)
        ns['validate_manifest'](manifest)
        outcome['overlay'] = invoke(controller, payload=(json.dumps(manifest)+'\n').encode(), require_recovery_receipt=True)
    except ControllerStillRunning:
        restore = False
        outcome['searchRestoreDeferred'] = 'Controller recovery is unverified; preserve the exact Search hold'
        raise
    finally:
        if restore: outcome['searchRestore'] = invoke(holder, ['--phase','restore',*args])
        print(json.dumps(outcome),flush=True)
    return outcome

def main():
    def interrupted(signum, frame): raise InterruptedError('WORK tips rollout interrupted')
    for kind in (signal.SIGTERM, signal.SIGHUP): signal.signal(kind, interrupted)
    raw = sys.stdin.buffer.read(20*1024**2+1)
    if len(raw) > 20*1024**2: raise ValueError('Oversized rollout plan')
    rollout(json.loads(raw))

if __name__ == '__main__': main()
