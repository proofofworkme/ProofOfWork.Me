#!/usr/bin/python3 -I
"""Explicit rollout dispatcher: preserve the Search hold on every error path."""
import base64, copy, hashlib, json, os, signal, subprocess, sys

class ControllerStillRunning(RuntimeError):
    """Keep Search held until an interrupted controller finishes its rollback."""

def decoded(plan, key):
    raw = base64.b64decode(plan[key+'Base64'], validate=True)
    if hashlib.sha256(raw).hexdigest() != plan[key+'Sha256']: raise ValueError('Changed '+key)
    return raw

def invoke(code, argv=(), payload=None):
    child = subprocess.Popen(['/usr/bin/python3', '-I', '-B', '-c', code.decode(), *argv],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        stdout, stderr = child.communicate(payload, timeout=360)
    except BaseException:
        # SIGINT is a Python exception: both fixed controllers can finish their
        # existing rollback paths before this dispatcher leaves the hold scope.
        if child.poll() is None: child.send_signal(signal.SIGINT)
        try: child.communicate(timeout=600)
        except subprocess.TimeoutExpired:
            raise ControllerStillRunning('Controller rollback is still running; retain the Search hold for supervised recovery')
        raise
    if len(stdout) > 1024*1024 or len(stderr) > 1024*1024:
        raise ValueError('Controller output exceeds evidence ceiling')
    if child.returncode:
        raise ValueError('Controller refused: '+stderr[-4000:].decode(errors='replace'))
    return json.loads(stdout)

def rollout(plan):
    if os.geteuid() != 0 or not sys.flags.isolated or plan.get('format') != 'proof-of-work-jobs-rollout-plan-v1':
        raise ValueError('Exact rollout plan, root and isolated Python required')
    controller = decoded(plan, 'controller'); holder = decoded(plan, 'searchHoldController')
    ns = {'__name__':'_jobs_rollout_preflight'}; exec(compile(controller, 'jobs-scoped-node.py','exec'),ns)
    manifest = copy.deepcopy(plan['runtimeManifestTemplate'])
    ns['validate_manifest'](manifest); ns['fence'](ns['ROOT'], manifest, ns['validate_manifest'](manifest))
    if manifest['sourceCommit'] != plan['sourceCommit'] or manifest['releaseId'] != plan['releaseId']:
        raise ValueError('Manifest provenance differs')
    files = manifest['searchHold']['bindings']['files']
    args = ['--release-id',plan['releaseId'],'--attempt','initial',
        '--service-sha256',files[ns['SEARCH'][0]],'--timer-sha256',files[ns['SEARCH'][1]]]
    held = invoke(holder, ['--phase','hold',*args])
    outcome = {'format':'proof-of-work-jobs-rollout-result-v1','releaseId':plan['releaseId'],'hold':held}
    restore = True
    try:
        marker = ns['safe_read'](ns['HOLD'], 65536)
        manifest['searchHold']['markerSha256'] = ns['sha'](marker)
        ns['validate_manifest'](manifest)
        outcome['overlay'] = invoke(controller, payload=(json.dumps(manifest)+'\n').encode())
    except ControllerStillRunning:
        restore = False
        outcome['searchRestoreDeferred'] = 'Controller rollback is still running; preserve the exact Search hold'
        raise
    finally:
        if restore: outcome['searchRestore'] = invoke(holder, ['--phase','restore',*args])
        print(json.dumps(outcome),flush=True)
    return outcome

def main():
    def interrupted(signum, frame): raise InterruptedError('Jobs rollout interrupted')
    for kind in (signal.SIGTERM, signal.SIGHUP): signal.signal(kind, interrupted)
    raw = sys.stdin.buffer.read(20*1024**2+1)
    if len(raw) > 20*1024**2: raise ValueError('Oversized rollout plan')
    rollout(json.loads(raw))

if __name__ == '__main__': main()
