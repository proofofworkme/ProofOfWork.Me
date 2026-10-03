#!/usr/bin/python3 -I
"""Fixed public Action64 custody append; no native/private/production action.

DRAFT: do not run before Root independently reviews this exact source and its
extra list. Required extra list: /tmp/pow-audit30-action64-extra-public-bindings-v1.json
with exactly schema, files, acceptance. Files are explicit {path,bytes,sha256,type}
records, including this helper. No wildcard, directory, dynamic discovery or
private input is supported. acceptance={mode:"pending"} is the default scope.
For accepted-current-oct3-logical-snapshot-only, acceptance must contain exactly
mode, rootReview, peerReview, postStop, logicalSnapshotOnly, and
productionPhysicalPagesOrChainMathOrPitrCertified=false. Each review/stop field
is one binding to an explicit JSON file already in files. Root's reviewed list
is the semantic certification; transport exit zero alone is not certification.
Prior global representation mappings are immutable. New diffs, JSONL, plain
text and empty channels use closed lossless base64 envelopes in their own rows.
No rollback, deletion, remote call, service control, pin/config change or
private corpus read is implemented. A partial append is preserved, never retried.
"""
from pathlib import Path
import base64, copy, datetime, hashlib, json, os, re, stat, subprocess

ROOT = Path('/home/sixer/ProofOfWork.Me')
TMP = Path('/tmp')
BASE = 'c33e83fa1659b63160615bf7adca7ef42a0d1188'
INVENTORY = TMP / 'pow-audit30-action64-fixed-public-inventory-v2.json'
INVENTORY_BYTES = 94469
INVENTORY_SHA = 'eebd6404834952fe3fbce240328d46c1fb4faf6b56cf0c9ec23fd0503fa34760'
EXTRA = TMP / 'pow-audit30-action64-extra-public-bindings-v1.json'
INTENT = TMP / 'pow-audit30-action64-public-custody-intent-v1.json'
RECEIPT = TMP / 'pow-audit30-action64-public-custody-preservation-v1.json'
E = ROOT / 'audits/2026-10-02-audit30-remaining-phase-execution.evidence.json'
C = ROOT / 'deploy/audit30/verification/source-custody.json'
T = ROOT / 'audits/2026-10-02-audit30-followup-tracker.md'
VERIFY = ROOT / 'deploy/audit30/verification'
MAX_INPUT = 2 * 1024**2
ALLOWED_TYPES = {'python-source', 'python-test-source', 'json-public-receipt',
                 'raw-diff', 'native-capture-stdout', 'native-capture-stderr'}


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()


def stable(s):
    # Access time is excluded; historical atime-inclusive refusal stays preserved.
    return (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_nlink,
            s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def read(path, maximum=MAX_INPUT):
    s = path.lstat()
    require(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and
            path.resolve(strict=True) == path and s.st_size <= maximum,
            'Noncanonical/oversized/nonregular input: ' + str(path))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        require(stable(os.fstat(fd)) == stable(s), 'Input FD drift: ' + str(path))
        with os.fdopen(fd, 'rb', closefd=False) as f:
            raw = f.read(maximum + 1)
        require(stable(os.fstat(fd)) == stable(s), 'Open input drift: ' + str(path))
    finally:
        os.close(fd)
    require(stable(path.lstat()) == stable(s) and len(raw) == s.st_size,
            'Input identity/byte drift: ' + str(path))
    return raw


def create(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(raw)
        f.flush()
        os.fsync(f.fileno())


def git(*args):
    env = dict(os.environ, GIT_OPTIONAL_LOCKS='0')
    return subprocess.check_output(['git', *args], cwd=ROOT, env=env)


def public_binding(binding):
    require(set(binding) == {'path', 'bytes', 'sha256', 'type'}, 'Binding keys')
    path = Path(binding['path'])
    require(path.parent == TMP and re.fullmatch(r'pow-audit30-[A-Za-z0-9_.-]+', path.name)
            and path.suffix in ('.py', '.json', '.diff', '.stdout', '.stderr'),
            'Nonfixed public path')
    require(binding['type'] in ALLOWED_TYPES and type(binding['bytes']) is int
            and 0 <= binding['bytes'] <= MAX_INPUT and
            re.fullmatch(r'[0-9a-f]{64}', binding['sha256']), 'Binding type/size/SHA')
    raw = read(path)
    require(len(raw) == binding['bytes'] and sha(raw) == binding['sha256'],
            'Binding drift: ' + str(path))
    return path, raw


def representation(path, raw):
    is_channel = path.suffix in ('.stdout', '.stderr')
    is_diff = path.suffix == '.diff'
    is_json = False
    if path.suffix == '.json' or is_channel:
        try:
            json.loads(raw)
            is_json = True
        except (ValueError, UnicodeDecodeError):
            require(is_channel, 'Public JSON parse refusal: ' + str(path))
    if is_diff or (is_channel and not is_json):
        kind = 'raw-diff' if is_diff else 'exact-native-channel'
        envelope = {'schema': 'pow-audit30-exact-public-byte-custody-v1',
                    'kind': kind, 'originalInput': str(path), 'encoding': 'base64',
                    'rawBytes': len(raw), 'rawSha256': sha(raw),
                    'rawBase64': base64.b64encode(raw).decode('ascii')}
        stored = encode(envelope)
        require(base64.b64decode(envelope['rawBase64'], validate=True) == raw,
                'Lossless envelope identity')
        return path.name + '.evidence.json', stored, {
            'representation': 'closed-base64-envelope-preserves-exact-raw-input',
            'rawBytes': len(raw), 'rawSha256': sha(raw)}
    return path.name + ('.json' if is_channel else ''), raw, {}


def prior_custody_bytes(row, global_representations):
    mapping = global_representations.get(row['repositoryPath'])
    if mapping is not None:
        stored = read(ROOT / mapping['repositoryPath'])
        require(len(stored) == mapping['storedBytes'] and
                sha(stored) == mapping['storedSha256'], 'Prior envelope drift')
        envelope = json.loads(stored)
        raw = base64.b64decode(envelope['rawBase64'], validate=True)
        require(envelope['originalInput'] == row['originalPath'] and
                len(raw) == mapping['rawBytes'] and sha(raw) == mapping['rawSha256'],
                'Prior decoded identity')
        return raw
    return read(ROOT / row['repositoryPath'])


def certify_acceptance(extra, selected):
    gate = extra['acceptance']
    require(isinstance(gate, dict), 'Acceptance shape')
    if gate == {'mode': 'pending'}:
        return {'mode': 'pending', 'rootPeerPostStopAcceptancePresent': False,
                'qualification': 'Actual restore return is recorded; Root/peer/current-stop acceptance remains pending.'}
    require(set(gate) == {'mode', 'rootReview', 'peerReview', 'postStop',
                         'logicalSnapshotOnly', 'productionPhysicalPagesOrChainMathOrPitrCertified'},
            'Acceptance keys')
    require(gate['mode'] == 'accepted-current-oct3-logical-snapshot-only' and
            gate['logicalSnapshotOnly'] is True and
            gate['productionPhysicalPagesOrChainMathOrPitrCertified'] is False,
            'Acceptance exceeds scoped logical snapshot')
    receipts = []
    for key in ('rootReview', 'peerReview', 'postStop'):
        binding = gate[key]
        path, raw = public_binding(binding)
        require(str(path) in selected and selected[str(path)][0] == binding,
                'Acceptance receipt not in explicit fixed extra list')
        value = json.loads(raw)
        require(isinstance(value, dict) and value, 'Empty acceptance receipt')
        receipts.append({'role': key, 'binding': binding, 'reviewedPublicReceipt': value})
    require(len({r['binding']['path'] for r in receipts}) == 3,
            'Root/peer/post-stop roles require three distinct receipts')
    return {'mode': gate['mode'], 'rootPeerPostStopAcceptancePresent': True,
            'receipts': receipts, 'logicalSnapshotOnly': True,
            'qualification': 'Only actual current Oct3 logical backup-snapshot recovery and its isolated-page/stop scope are accepted from the explicit Root-reviewed certification list. No chain/math/PITR/production-page or complete item7 certificate.'}


def main():
    require(git('rev-parse', 'HEAD').decode().strip() == BASE, 'Action63 HEAD drift')
    baseline = {p: read(p, 16 * 1024**2) for p in (E, C, T)}
    for path, raw in baseline.items():
        require(git('show', BASE + ':' + str(path.relative_to(ROOT))) == raw,
                'Preappend tracked baseline drift')
    evidence = json.loads(baseline[E]); custody = json.loads(baseline[C])
    old_e = copy.deepcopy(evidence); old_c = copy.deepcopy(custody)
    require(len(evidence['actions']) == 63 and len(custody['files']) == 650,
            'Fixed Action63 action/custody cardinality')
    global_representations = custody['storedRepresentations']
    for row in custody['files']:
        raw = prior_custody_bytes(row, global_representations)
        require(len(raw) == row['bytes'] and sha(raw) == row['sha256'],
                'Prior custody drift: ' + row['repositoryPath'])
    inventory_raw = read(INVENTORY)
    require(len(inventory_raw) == INVENTORY_BYTES and sha(inventory_raw) == INVENTORY_SHA,
            'Fixed inventory drift')
    inventory = json.loads(inventory_raw)
    require(inventory['baseHead'] == BASE and inventory['artifactCount'] == 67 and
            not inventory['exactMissingArtifacts'] and not inventory['receiptBindingMismatches'],
            'Inventory scope/refusal')
    extra_raw = read(EXTRA); extra = json.loads(extra_raw)
    require(set(extra) == {'schema', 'files', 'acceptance'} and
            extra['schema'] == 'pow-audit30-action64-extra-public-bindings-v1' and
            isinstance(extra['files'], list) and len(extra['files']) <= 50,
            'Root extra-list closed schema')
    selected = {}
    for row in inventory['files']:
        binding = {k: row[k] for k in ('path', 'bytes', 'sha256', 'type')}
        path, raw = public_binding(binding)
        require(str(path) not in selected, 'Duplicate fixed inventory path')
        selected[str(path)] = (binding, raw)
    for binding in extra['files']:
        path, raw = public_binding(binding)
        require(str(path) not in selected and path not in (INVENTORY, EXTRA),
                'Duplicate/circular Root extra binding')
        selected[str(path)] = (binding, raw)
    require(str(Path(__file__).resolve(strict=True)) in selected,
            'Root extra list must pin this exact helper source')
    for path, raw in ((INVENTORY, inventory_raw), (EXTRA, extra_raw)):
        selected[str(path)] = ({'path': str(path), 'bytes': len(raw),
                               'sha256': sha(raw), 'type': 'json-public-receipt'}, raw)
    acceptance = certify_acceptance(extra, selected)
    # Exact actual native return is always distinct from review/stop acceptance.
    capture_path = str(TMP / 'pow-audit30-oct3-isolated-restore-native-104500-v1.json')
    capture = json.loads(selected[capture_path][1])
    require(capture['exitCode'] == 0 and capture['seconds'] == 3313.588926 and
            capture['finishedAtUtc'] == '2026-10-03T11:32:09.796896+00:00',
            'Actual restore return pin')
    for channel in ('stdout', 'stderr'):
        b = capture['captures'][channel]; raw = selected[b['path']][1]
        require(len(raw) == b['bytes'] and sha(raw) == b['sha256'],
                'Actual restore capture-channel drift')
    known = {r['originalPath']: r for r in custody['files']}
    require(len(known) == len(custody['files']), 'Duplicate prior original paths')
    targets = {}; rows = []
    for original, (binding, raw) in sorted(selected.items()):
        require(read(Path(original)) == raw, 'Last preappend source drift')
        if original in known:
            r = known[original]
            require(r.get('rawBytes', r['bytes']) == len(raw) and
                    r.get('rawSha256', r['sha256']) == sha(raw), 'Known original drift')
            continue
        name, stored, extras = representation(Path(original), raw)
        target = VERIFY / name
        require(target not in targets, 'Representation target collision')
        require(not target.exists() and not target.is_symlink(),
                'Creation-only artifact target already present: ' + str(target))
        targets[target] = stored
        rows.append({'originalPath': original, 'repositoryPath': str(target.relative_to(ROOT)),
                     'bytes': len(stored), 'sha256': sha(stored), **extras})
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    accepted = acceptance['mode'] == 'accepted-current-oct3-logical-snapshot-only'
    description = ('Action64 preserves all 63 prior action values and 650 custody rows. '
                   'The fixed public capacity V3, retained-context caller, bridge V2 refusal '
                   'and V3 successor, coupled V5 and promotion-full-read namespace successor '
                   'are preserved with their original fixtures, reviews, templates, exact '
                   'diffs and capture channels. Source acceptance grants no native, recovery, '
                   'pin/checker promotion or retirement authority. The actual Oct3 isolated '
                   'restore returned exit0 at 11:32:09.796896 UTC after 3313.588926 seconds. ')
    description += ('Explicit Root/peer/current-post-stop receipts accept only this actual '
                    'Oct3 logical backup snapshot and its isolated-page/stop scope. '
                    if accepted else 'Root/peer/current-post-stop acceptance remains pending; '
                    'the native return is not substituted for acceptance. ')
    description += ('Historical Oct2 proofs and current-source absence stay qualified. '
                    'No chain/math/PITR/live-page integrity, financial completeness, continuous '
                    'global dependency closure or complete item7 assurance is inferred. '
                    'The unchanged 293 GiB full recovery peak remains a distinct capacity gate; '
                    'measured source size does not lower ceilings. Current survivor-specific '
                    'promotion, recovery configuration and additional retirement require final '
                    'approval. Exact16 production repair approval remains requested and '
                    'unanswered. Prior approval, mutation, retirement and request lists and '
                    'the May9 operator-paid/noIDs finding remain unchanged. No production '
                    'data/configuration mutation, API/worker/UI cutover, new deletion or '
                    'automatic retry is performed by this append.')
    evidence['actions'].append({'atUtc': now, 'action': description,
        'publicSourceCustodyAdded': rows, 'actualOct3RestoreTransport': capture,
        'currentOct3LogicalSnapshotAcceptance': acceptance,
        'priorItem7CheckpointPreserved': copy.deepcopy(old_e['items']['7']),
        'productionDataMutation': False, 'recoveryConfigurationMutation': False,
        'additionalDeletion': False})
    evidence['updatedAtUtc'] = now
    evidence['items']['7']['status'] = (
        'Current Oct3 logical backup-snapshot restore accepted only from exact actual Root/peer/current-post-stop receipts; isolated pages/roles/accounting are scoped to those reviewed receipts. Historical Oct2 proof and current source absence remain qualified. Chain/math, live production physical pages, live WAL/PITR and full recovery activation remain uncertified/gated; 293GiB whole recovery capacity is separate. No complete item7 certificate.'
        if accepted else
        'Current Oct3 isolated restore returned exit0; Root/peer/current-post-stop acceptance remains pending. Source-only recovery capacity V3 and promotion/bridge successors are preserved, not installed or activated. Historical Oct2 source remains absent; final production-data/recovery/promotion/deletion gates and all earlier qualifications remain open.')
    evidence['items']['7'].setdefault('progressCheckpoints', []).append({
        'atUtc': now, 'action': 64, 'actualOct3RestoreReturnedExitZero': True,
        'currentOct3LogicalSnapshotAccepted': accepted,
        'rootPeerCurrentPostStopAcceptance': acceptance['mode'],
        'chainMathOrProductionPageOrPitrCertified': False,
        'finalRecoveryPromotionAndRetirementApprovalPending': True})
    custody['files'].extend(rows); custody['atUtc'] = now
    require(evidence['actions'][:63] == old_e['actions'] and
            custody['files'][:650] == old_c['files'] and
            custody['storedRepresentations'] == old_c['storedRepresentations'],
            'Historical action/custody/representation drift')
    for key in old_c:
        if key not in ('files', 'atUtc'):
            require(custody[key] == old_c[key], 'Prior custody object drift')
    for key in old_e:
        if key not in ('actions', 'items', 'updatedAtUtc'):
            require(evidence[key] == old_e[key], 'Prior evidence object drift')
    for key in old_e['items']:
        if key != '7':
            require(evidence['items'][key] == old_e['items'][key], 'Other item drift')
    old_checkpoints = old_e['items']['7'].get('progressCheckpoints', [])
    require(evidence['items']['7']['progressCheckpoints'][:-1] == old_checkpoints,
            'Prior item7 checkpoints drift')
    tracker = baseline[T].decode('utf-8')
    if accepted:
        prefix = '| 7 | Backup restoration, physical integrity and PITR |'
        prior_rows = [line for line in tracker.splitlines() if line.startswith(prefix)]
        require(len(prior_rows) == 1, 'Exactly one current item7 tracker row')
        replacement = '| 7 | Backup restoration, physical integrity and PITR | Current Oct3 logical snapshot restore passed; live recovery and survivor promotion remain gated | Isolated restore/testing approved; final recovery/pin changes remain gated | 24 tables/429,732 rows, one sequence, three roles/52 ACL statements, 238 exact credit definitions and isolated checksums pass. Original private PIDs/socket/cgroup absent; original five unchanged. Known16 text defects remain. Full293GiB recovery peak, production pages/PITR, promotion and retirement remain unresolved; Oct2 historical proof preserved/source absent |'
        tracker = tracker.replace(prior_rows[0], replacement)
    tracker += '\n- ' + now + ': ' + description + '\n'
    outputs = {E: encode(evidence), C: encode(custody), T: tracker.encode('utf-8')}
    require(not INTENT.exists() and not RECEIPT.exists(), 'No automatic append retry')
    intent = {'schema': 'pow-audit30-action64-public-custody-intent-v1',
              'baseHead': BASE, 'atUtc': now, 'actionsBefore': 63, 'custodyRowsBefore': 650,
              'scope': [str(p.relative_to(ROOT)) for p in outputs],
              'baseline': [{'path': str(p), 'bytes': len(b), 'sha256': sha(b)} for p,b in baseline.items()],
              'plannedOutputs': [{'path': str(p), 'bytes': len(b), 'sha256': sha(b)} for p,b in outputs.items()],
              'newRows': rows, 'partialWriteRequiresExplicitReviewNotAutomaticRetry': True,
              'productionMutation': False}
    # All sources, prior custody and future representations are validated before writes.
    for p, raw in baseline.items():
        require(read(p, 16 * 1024**2) == raw, 'Baseline changed before append')
    create(INTENT, encode(intent))
    for target, raw in targets.items():
        create(target, raw)
        require(read(target) == raw, 'Created custody bytes differ')
    for p, raw in baseline.items():
        require(read(p, 16 * 1024**2) == raw, 'Baseline changed during public copies')
    for original, (_binding, raw) in selected.items():
        require(read(Path(original)) == raw, 'Source drift during public copies')
    for row in old_c['files']:
        raw = prior_custody_bytes(row, old_c['storedRepresentations'])
        require(len(raw) == row['bytes'] and sha(raw) == row['sha256'],
                'Prior custody drift during public copies')
    # Each document write is atomic. Intent preserves pre/post bindings if interrupted
    # between documents; no broad rollback, deletion or silent continuation exists.
    for path, raw in outputs.items():
        staged = path.with_name(path.name + '.action64-new')
        create(staged, raw)
        os.replace(staged, path)
    for path, raw in outputs.items():
        require(read(path, 16 * 1024**2) == raw, 'Final document byte mismatch')
    receipt = {'schema': 'pow-audit30-action64-public-custody-preservation-v1',
        'atUtc': now, 'baseHead': BASE, 'oldActionsPreserved': 63,
        'oldCustodyRowsPreserved': 650, 'actionsNow': len(evidence['actions']),
        'custodyRowsNow': len(custody['files']), 'newRows': rows,
        'approvalMutationRetirementRequestAndGlobalRepresentationObjectsUnchanged': True,
        'currentOct3LogicalSnapshotAcceptance': acceptance['mode'],
        'productionMutation': False, 'remoteNativeExecutionPerformed': False,
        'hygieneCommitPushNotYetPerformed': True}
    create(RECEIPT, encode(receipt))
    print(json.dumps({k:v for k,v in receipt.items() if k != 'newRows'}, sort_keys=True))


if __name__ == '__main__':
    main()
