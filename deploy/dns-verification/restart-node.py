#!/usr/bin/python3 -I
"""Hash-fenced restart rehearsal; changes service state only, never source or DNS receipts."""
import base64, fcntl, hashlib, json, os, subprocess, sys

def restart(request):
    def decoded(key):
        raw = base64.b64decode(request[key+'Base64'], validate=True)
        if hashlib.sha256(raw).hexdigest() != request[key+'Sha256']: raise ValueError('Changed '+key)
        return raw
    if os.geteuid() != 0 or not sys.flags.isolated: raise ValueError('Root isolated Python required')
    controller = decoded('controller'); holder = decoded('holder'); supervisor = decoded('supervisor')
    ns = {'__name__':'_dns_restart_controller'}; exec(compile(controller,'scoped-node.py','exec'), ns)
    dispatch = {'__name__':'_dns_restart_dispatch'}; exec(compile(supervisor,'rollout-node.py','exec'), dispatch)
    capture = request['capture']; require = ns['require']; read = ns['safe_read']; root = ns['ROOT']
    require(capture['format'] == 'proof-of-work-dns-verification-runtime-capture-v1' and
        capture['controllerSha256'] == request['controllerSha256'], 'Wrong capture')
    require(len(capture['sources']) <= 2000, 'Oversized source scope')
    def fence():
        for name,row in capture['sources'].items():
            require(ns['sha'](read(root/ns['source_path'](name))) == row['sha256'], 'Source changed: '+name)
        head = subprocess.check_output(['/usr/bin/git','-c',f'safe.directory={root}','-C',str(root),'rev-parse','HEAD'],text=True).strip()
        require(head == capture['baselineHead'], 'Runtime Git changed')
    fence()
    release = request['releaseId']
    require(ns['re'].fullmatch('[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z',release), 'Invalid restart identity')
    args = ['--release-id',release,'--attempt','initial','--service-sha256',capture['searchFiles'][ns['SEARCH'][0]],
        '--timer-sha256',capture['searchFiles'][ns['SEARCH'][1]]]
    invoke = dispatch['invoke']; held = invoke(holder,['--phase','hold',*args]); restored = False
    receipt = {'releaseId':release,'held':held,'sourcesUnchanged':False,'restartComplete':False}
    try:
        info = ns['LOCK'].lstat()
        require(info.st_uid == 0 and info.st_gid == 0 and info.st_mode & 0o777 == 0o600 and info.st_nlink == 1, 'Unsafe ops lock')
        fd = os.open(ns['LOCK'],os.O_RDONLY|os.O_NOFOLLOW)
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        require(ns['identity'](os.fstat(fd)) == ns['identity'](ns['LOCK'].lstat()),'Lock changed')
        fence()
        for unit, expected in {**capture['gateway']['files'], **capture['searchFiles']}.items():
            require(ns['sha'](read(ns['Path']('/etc/systemd/system')/unit,65536)) == expected, 'Service unit changed')
        api_state = ns['states'](ns['UNITS'])
        node = ns['Path'](os.readlink('/proc/'+api_state[ns['UNITS'][0]]['MainPID']+'/exe'))
        require(str(node) == capture['nodePath'] and ns['sha'](read(node,200*1024**2)) == capture['nodeSha256'], 'Node changed')
        ns['require_gateway_baseline'](ns['gateway_states'](),capture['gateway'])
        ns['require_protected_services'](capture['protectedServices'])
        before = ns['states'](ns['UNITS']); authority = ns['states'](ns['AUTHORITY']); search = ns['states'](ns['SEARCH'])
        ns['require_search_held'](search)
        hold_raw = read(ns['HOLD'],65536)
        receipt['before'] = before
        try:
            ns['drain_apps'](); fence()
        finally:
            after = ns['restore_verified_apps'](capture,authority,search,hold_raw)
            restored = True; receipt['after'] = after
        fence(); require(before[ns['UNITS'][0]]['MainPID'] != after[ns['UNITS'][0]]['MainPID'], 'API did not restart')
        receipt['sourcesUnchanged'] = True; receipt['restartComplete'] = True
    finally:
        if restored: receipt['searchRestore'] = invoke(holder,['--phase','restore',*args])
        else: receipt['searchRestoreDeferred'] = 'Inspect guarded restart failure before releasing Search hold'
        print(json.dumps(receipt),flush=True)

def main():
    raw=sys.stdin.buffer.read(90*1024**2+1)
    if len(raw)>90*1024**2: raise ValueError('Oversized request')
    restart(json.loads(raw))
if __name__ == '__main__': main()
