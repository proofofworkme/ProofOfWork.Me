"""Appended to the scoped controller: final read-only census after old worker drain."""
linked_engine_install = install
linked_engine_restore_verified_apps = restore_verified_apps
linked_census_uncertain = False

def linked_census_stopped(unit):
    text = subprocess.check_output(['/usr/bin/systemctl','show',unit,'--property=LoadState',
        '--property=ActiveState','--property=MainPID'],text=True,timeout=15)
    row = dict(line.split('=',1) for line in text.splitlines() if '=' in line)
    return row.get('LoadState') == 'not-found' or (row.get('ActiveState') in ('inactive','failed') and row.get('MainPID') == '0')

def linked_recover_census(unit):
    global linked_census_uncertain
    linked_census_uncertain = True
    try:
        subprocess.run(['/usr/bin/systemctl','stop',unit],check=True,capture_output=True,timeout=40)
        require(linked_census_stopped(unit), 'Census child is still active')
    except BaseException:
        # Even a failed stop may race a collected terminal unit. Only an
        # independently observed terminal state can clear uncertainty.
        require(linked_census_stopped(unit), 'Census child recovery unverified')
    linked_census_uncertain = False

def restore_verified_apps(m, authority, search, hold_raw):
    require(not linked_census_uncertain, 'Census child state unknown; retain drained apps and Search hold')
    return linked_engine_restore_verified_apps(m, authority, search, hold_raw)


def require_linked_writer_off():
    before = states(UNITS)[UNITS[0]]
    pid = before.get('MainPID', '')
    require(before.get('ActiveState') == 'active' and pid.isdigit() and int(pid) > 0,
            'New API process unavailable for writer-off fence')
    with open('/proc/' + pid + '/environ', 'rb') as stream:
        raw = stream.read(1024*1024+1)
    require(len(raw) <= 1024*1024 and b'PUBLISH_LINKED_WRITES_ENABLED=1' not in raw.split(b'\0'),
            'New API process has linked writes enabled; do not restore public gateway')
    require(states(UNITS)[UNITS[0]] == before, 'API process changed during writer-off fence')

def linked_preinstall_census(backup):
    global linked_census_uncertain
    m = json.loads(safe_read(backup / 'manifest.json', 20*1024**2))
    root, proof = validate_linked_stage(m.get('linkedStage'), m['sourceCommit'], m.get('linkedPlanSha256'), ROOT)
    require_apps_drained()
    hold_raw = safe_read(HOLD, 65536)
    require(sha(hold_raw) == m['searchHold']['markerSha256'], 'Census hold changed')
    node = Path('/opt/node-v24.18.0-linux-x64/bin/node')
    require(sha(safe_read(node, 200*1024**2)) == m['nodeSha256'], 'Census runtime changed')
    unit = 'pow-linked-census-' + root.name[:12]
    command = ['/usr/bin/systemd-run','--quiet','--pipe','--wait','--collect','--service-type=exec','--unit='+unit,
        '--property=User=powadmin','--property=Group=powadmin','--property=NoNewPrivileges=true',
        '--property=PrivateDevices=true','--property=PrivateTmp=true','--property=ProtectSystem=strict',
        '--property=ProtectHome=true','--property=CapabilityBoundingSet=','--property=MemorySwapMax=0',
        '--property=MemoryMax=512M','--property=CPUQuota=100%','--property=IOWeight=25',
        '--property=IOSchedulingClass=idle','--property=Nice=10','--property=RuntimeMaxSec=300',
        '--property=LimitCORE=0','--property=WorkingDirectory='+str(root),
        '--property=EnvironmentFile=/etc/proofofwork-api/proof-indexer-db.env',
        '--property=EnvironmentFile=/etc/proofofwork-api/bitcoin-rpc.env',
        '--setenv=NETWORK=livenet','--setenv=POW_INDEX_DB_POOL_MAX=1',
        '--setenv=POW_INDEX_DB_STATEMENT_TIMEOUT_MS=15000',str(node),
        str(root/'deploy/linked-publish/stage.mjs'),'census',m['releaseId']]
    linked_census_uncertain = True
    try:
        result = subprocess.run(command, capture_output=True, timeout=330)
    except BaseException:
        linked_recover_census(unit)
        raise
    if not linked_census_stopped(unit):
        linked_census_uncertain = True
        raise RuntimeError('Census unit exit unverified')
    linked_census_uncertain = False
    require(len(result.stdout) <= 1024*1024 and len(result.stderr) <= 1024*1024, 'Oversized census output')
    require(result.returncode == 0, 'Preinstall raw census failed')
    receipt = json.loads(result.stdout)
    durable(backup/'preinstall-census.json', (json.dumps(receipt,sort_keys=True)+'\n').encode())
    require(receipt.get('ok') is True and receipt.get('requiresReplayReview') is False
            and receipt.get('preexistingV2Candidates') == [], 'Preexisting raw v2 articles require explicit replay review')
    require_apps_drained()
    require(safe_read(HOLD,65536) == hold_raw, 'Census hold changed')

def install(root, backup, rows, metadata, candidate, stamp):
    if candidate:
        linked_preinstall_census(backup)
    return linked_engine_install(root, backup, rows, metadata, candidate, stamp)
