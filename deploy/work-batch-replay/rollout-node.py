#!/usr/bin/python3 -I
"""Explicit rollout dispatcher: preserve the Search hold on every error path."""
import base64, copy, hashlib, json, os, signal, subprocess, sys

class ControllerStillRunning(RuntimeError):
    """Keep Search held until an interrupted or incomplete rollback is recovered."""
    def __init__(self, message, evidence=None):
        super().__init__(message); self.evidence = evidence

class ControllerRolledBack(ValueError):
    """A terminal receipt verifies rollback and permits Search restoration."""
    def __init__(self, message, evidence):
        super().__init__(message); self.evidence = evidence

def child_evidence(child, stdout, stderr, interrupted=None):
    result = {'exitCode':child.returncode,
        'stdout':stdout[:1024*1024].decode(errors='replace'),
        'stderr':stderr[:1024*1024].decode(errors='replace'),
        'stdoutBytes':len(stdout), 'stderrBytes':len(stderr),
        'stdoutSha256':hashlib.sha256(stdout).hexdigest(),
        'stderrSha256':hashlib.sha256(stderr).hexdigest()}
    if interrupted is not None: result['interruptionClass'] = type(interrupted).__name__
    return result

def decoded(plan, key):
    raw = base64.b64decode(plan[key+'Base64'], validate=True)
    if hashlib.sha256(raw).hexdigest() != plan[key+'Sha256']: raise ValueError('Changed '+key)
    return raw

def invoke(code, argv=(), payload=None, require_recovery_receipt=False):
    child = subprocess.Popen(['/usr/bin/python3', '-I', '-B', '-c', code.decode(), *argv],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    interrupted = None
    try:
        stdout, stderr = child.communicate(payload, timeout=33600 if require_recovery_receipt else 360)
    except BaseException as error:
        interrupted = error
        # SIGINT is a Python exception: both fixed controllers can finish their
        # existing rollback paths before this dispatcher leaves the hold scope.
        try:
            if child.poll() is None: child.send_signal(signal.SIGINT)
            stdout, stderr = child.communicate(timeout=900)
        except BaseException as recovery_error:
            stdout = getattr(recovery_error, 'output', None) or getattr(error, 'output', None) or b''
            stderr = getattr(recovery_error, 'stderr', None) or getattr(error, 'stderr', None) or b''
            raise ControllerStillRunning(
                'Controller result is uncertain; retain the Search hold for supervised recovery',
                child_evidence(child, stdout, stderr, error)) from recovery_error
    evidence = child_evidence(child, stdout, stderr, interrupted)
    def unverified(reason):
        return ControllerStillRunning(
            'Controller recovery is unverified ('+reason+'); retain the Search hold for supervised recovery', evidence)
    if len(stdout) > 1024*1024 or len(stderr) > 1024*1024:
        raise unverified('output exceeds evidence ceiling')
    try: receipt = json.loads(stdout)
    except (ValueError, UnicodeError) as error: raise unverified('invalid receipt') from error
    if not isinstance(receipt, dict) or type(child.returncode) is not int:
        raise unverified('missing terminal result')
    if receipt.get('recoveryIncomplete'):
        raise unverified('incomplete rollback')
    if require_recovery_receipt and payload is not None:
        manifest = json.loads(payload)
        if any(receipt.get(key) != manifest[key] for key in ('format','releaseId','sourceCommit','sourceTree')) \
                or receipt.get('manifestSha256') != hashlib.sha256(payload).hexdigest():
            raise unverified('receipt provenance differs')
    if child.returncode:
        if require_recovery_receipt:
            if receipt.get('rolledBack') is not True or not isinstance(receipt.get('servicesAfterRollback'), dict):
                raise unverified('rollback not verified')
            raise ControllerRolledBack('Controller refused after verified rollback: '+
                stderr[-4000:].decode(errors='replace'), evidence)
        raise unverified('hold operation refused')
    if require_recovery_receipt:
        if receipt.get('installed') is not True or receipt.get('rolledBack') is not False \
                or receipt.get('replayPublication',{}).get('committed') is not True \
                or receipt.get('replayPublication',{}).get('postconditionsVerified') is not True \
                or not isinstance(receipt.get('servicesAfter'), dict) \
                or not isinstance(receipt.get('completedAt'), str) or not receipt['completedAt']:
            raise unverified('installation not verified')
    elif receipt.get('ok') is not True:
        raise unverified('hold operation not verified')
    elif interrupted is not None:
        # An interrupted hold acquisition must not launch the overlay merely
        # because the holder finished while the dispatcher was waiting.
        raise unverified('hold operation was interrupted')
    if interrupted is not None: receipt['dispatchInterruptionClass'] = type(interrupted).__name__
    return receipt

def rollout(plan):
    if os.geteuid() != 0 or not sys.flags.isolated or plan.get('format') != 'proof-of-work-work-batch-replay-rollout-plan-v1':
        raise ValueError('Exact rollout plan, root and isolated Python required')
    controller = decoded(plan, 'controller'); holder = decoded(plan, 'searchHoldController')
    ns = {'__name__':'_work-batch-replay_rollout_preflight'}; exec(compile(controller, 'work-batch-replay-scoped-node.py','exec'),ns)
    manifest = copy.deepcopy(plan['runtimeManifestTemplate'])
    ns['validate_manifest'](manifest); ns['fence'](ns['ROOT'], manifest, ns['validate_manifest'](manifest))
    ns['metadata_fence'](ns['ROOT'], manifest['sourceMetadata'])
    ns['verify_verifier_sources'](manifest['evidenceVerifier'])
    ns['verify_replay_source_manifest'](manifest)
    ns['require_writes_disabled_configuration']()
    ns['require_restart_configuration'](manifest['restartConfigurationSha256'])
    if manifest['sourceCommit'] != plan['sourceCommit'] or manifest['releaseId'] != plan['releaseId']:
        raise ValueError('Manifest provenance differs')
    files = manifest['searchHold']['bindings']['files']
    args = ['--release-id',plan['releaseId'],'--attempt','initial',
        '--service-sha256',files[ns['SEARCH'][0]],'--timer-sha256',files[ns['SEARCH'][1]]]
    outcome = {'format':'proof-of-work-work-batch-replay-rollout-result-v1','releaseId':plan['releaseId']}
    try:
        outcome['hold'] = invoke(holder, ['--phase','hold',*args])
    except BaseException as error:
        outcome['holdFailure'] = getattr(error, 'evidence', None) or {'errorClass':type(error).__name__}
        print(json.dumps(outcome),flush=True)
        raise
    restore = True
    try:
        marker = ns['safe_read'](ns['HOLD'], 65536)
        manifest['searchHold']['markerSha256'] = ns['sha'](marker)
        ns['validate_manifest'](manifest)
        restore = False
        outcome['overlay'] = invoke(controller, payload=(json.dumps(manifest)+'\n').encode(), require_recovery_receipt=True)
        restore = True
    except ControllerRolledBack as error:
        restore = True
        outcome['overlayFailure'] = error.evidence
        raise
    except BaseException as error:
        if not restore:
            outcome['searchRestoreDeferred'] = 'Controller state is unverified; preserve the exact Search hold'
            outcome['overlayFailure'] = getattr(error, 'evidence', None) or {'errorClass':type(error).__name__}
        raise
    finally:
        try:
            if restore: outcome['searchRestore'] = invoke(holder, ['--phase','restore',*args])
        except BaseException as error:
            outcome['searchRestoreFailure'] = getattr(error, 'evidence', None) or {'errorClass':type(error).__name__}
            raise
        finally:
            print(json.dumps(outcome),flush=True)
    return outcome

def main():
    def interrupted(signum, frame): raise InterruptedError('WORK batch replay rollout interrupted')
    for kind in (signal.SIGTERM, signal.SIGHUP): signal.signal(kind, interrupted)
    raw = sys.stdin.buffer.read(20*1024**2+1)
    if len(raw) > 20*1024**2: raise ValueError('Oversized rollout plan')
    rollout(json.loads(raw))

if __name__ == '__main__': main()
