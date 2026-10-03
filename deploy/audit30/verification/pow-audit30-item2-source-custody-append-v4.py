#!/usr/bin/python3 -I -B
"""Local-only fixed-preimage custody preview and separately reviewed apply."""
import argparse
import base64
import copy
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

ROOT = Path('/home/sixer/ProofOfWork.Me')
SCOPE = 'deploy/audit30/verification/'
CUSTODY = ROOT / SCOPE / 'source-custody.json'
BASE_SHA = '723e7b864175e4f2f313d21fc16f83f12a9f9a9e4b7c99a975de90537e451eec'
BASE_BYTES = 698750
BASE_ROWS = 1418
HEX = re.compile('[0-9a-f]{64}')
PRIOR_PROPOSALS = {
    'audits/2026-10-03-audit30-exact-sixteen-body-repair-proposal.md':
        (4594, '2d29c5a8a37c1aa42631dc615f8847640bdd4ce074b1c48524271ea40f96cadc'),
    'audits/2026-10-03-audit30-oct3-pin-checker-promotion-proposal.md':
        (9457, 'cd5852c4b9415f60104b6bc72c82e580e003f000219844ef3a694d6ae86507ec'),
}

def need(value, code):
    if not value:
        raise ValueError(code)

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def pairs(items):
    result = {}
    for key, value in items:
        need(key not in result, 'DUPLICATE_JSON_KEY')
        result[key] = value
    return result

def parse(raw):
    return json.loads(raw, object_pairs_hook=pairs)

def stamp(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)

def read(path, maximum=4 * 1024**2):
    path = Path(path)
    before = path.lstat()
    need(path.is_absolute() and path.resolve() == path and stat.S_ISREG(before.st_mode)
         and before.st_nlink == 1 and 0 <= before.st_size <= maximum, 'LOCAL_INPUT_SHAPE')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        need(stamp(os.fstat(stream.fileno())) == stamp(before), 'LOCAL_INPUT_FD_DRIFT')
        raw = stream.read(maximum + 1)
        need(stamp(os.fstat(stream.fileno())) == stamp(before), 'LOCAL_INPUT_READ_DRIFT')
    need(stamp(path.lstat()) == stamp(before) and len(raw) == before.st_size, 'LOCAL_INPUT_PATH_DRIFT')
    return raw

def repo_path(value):
    need(isinstance(value, str) and value.startswith(SCOPE)
         and '..' not in Path(value).parts and not Path(value).is_absolute()
         and re.fullmatch(r'[A-Za-z0-9_.\-/]+', value), 'REPOSITORY_PATH_SCOPE')
    path = ROOT / value
    need(path != CUSTODY, 'NO_SELF_CUSTODY')
    return path

def row_bytes(row):
    need(type(row) is dict and {'originalPath', 'repositoryPath', 'bytes', 'sha256'} <= set(row)
         and type(row['bytes']) is int and 0 <= row['bytes'] <= 4 * 1024**2
         and isinstance(row['sha256'], str) and HEX.fullmatch(row['sha256']), 'ROW_SHAPE')
    raw = read(repo_path(row['repositoryPath']))
    need(len(raw) == row['bytes'] and sha(raw) == row['sha256'], 'ROW_BYTES_DIFFER')
    return raw

def envelope(raw, original, byte_count, digest):
    value = parse(raw)
    need(type(value) is dict and value.get('originalInput') == original
         and value.get('rawBytes') == byte_count and value.get('rawSha256') == digest
         and isinstance(value.get('rawBase64'), str), 'ENVELOPE_BINDING')
    decoded = base64.b64decode(value['rawBase64'], validate=True)
    need(len(decoded) == byte_count and sha(decoded) == digest, 'ENVELOPE_DECODE')
    return decoded

def validate_prior(old):
    need(old.get('schema') == 'pow-audit30-verification-source-custody-v1'
         and type(old.get('files')) is list and len(old['files']) == BASE_ROWS
         and type(old.get('storedRepresentations')) is dict
         and len(old['storedRepresentations']) == 8, 'PRIOR_SCOPE')
    seen = set()
    for row in old['files']:
        path = row['repositoryPath']
        need(path not in seen, 'PRIOR_DUPLICATE_PATH')
        seen.add(path)
        mapping = old['storedRepresentations'].get(path)
        if path in PRIOR_PROPOSALS:
            byte_count, digest = PRIOR_PROPOSALS[path]
            need(mapping is None and {'originalPath', 'repositoryPath', 'bytes', 'sha256'} <= set(row)
                 and type(row['bytes']) is int and row['bytes'] == byte_count
                 and row['sha256'] == digest, 'PRIOR_PROPOSAL_IDENTITY')
            raw = read(ROOT / path)
            need(len(raw) == byte_count and sha(raw) == digest, 'PRIOR_PROPOSAL_BYTES')
        elif mapping is None:
            row_bytes(row)
        else:
            raw = read(repo_path(mapping['repositoryPath']))
            need(len(raw) == mapping['storedBytes'] and sha(raw) == mapping['storedSha256'], 'PRIOR_STORED_BYTES')
            decoded = envelope(raw, mapping['decodedIdentity']['originalInput'], mapping['rawBytes'], mapping['rawSha256'])
            need(len(decoded) == row['bytes'] and sha(decoded) == row['sha256'], 'PRIOR_RAW_ROW')
    return seen

def validate_new(row):
    allowed = {'originalPath', 'repositoryPath', 'bytes', 'sha256', 'purpose', 'qualification',
               'representation', 'rawBytes', 'rawSha256'}
    need(set(row) <= allowed and not row['repositoryPath'].endswith('.diff'), 'NEW_ROW_SCOPE')
    raw = row_bytes(row)
    origin = Path(row['originalPath'])
    need(origin.is_absolute() and (origin.is_relative_to(Path('/tmp'))
         or origin.is_relative_to(ROOT / SCOPE)), 'PUBLIC_ORIGIN_SCOPE')
    original = read(origin)
    if 'representation' in row:
        need(row['representation'] == 'closed-base64-envelope-preserves-exact-raw-input'
             and type(row.get('rawBytes')) is int and row['rawBytes'] >= 0
             and isinstance(row.get('rawSha256'), str) and HEX.fullmatch(row['rawSha256']), 'NEW_REPRESENTATION')
        decoded = envelope(raw, str(origin), row['rawBytes'], row['rawSha256'])
        need(decoded == original, 'ORIGINAL_ENVELOPE_BYTES_DIFFER')
    else:
        need('rawBytes' not in row and 'rawSha256' not in row and raw == original, 'ORIGINAL_COPY_BYTES_DIFFER')

def build(old, manifest, validator=validate_new):
    need(type(manifest) is dict and set(manifest) == {'schema', 'custodyPreimage', 'atUtc',
         'files', 'additionalQualification', 'publicReviewed', 'privateDataIncluded'}
         and manifest['schema'] == 'pow-audit30-item2-source-custody-append-manifest-v1'
         and manifest['publicReviewed'] is True and manifest['privateDataIncluded'] is False, 'EXPLICIT_PUBLIC_MANIFEST')
    need(manifest['custodyPreimage'] == {'path': str(CUSTODY.relative_to(ROOT)), 'bytes': BASE_BYTES,
         'sha256': BASE_SHA, 'rows': BASE_ROWS, 'storedRepresentations': 8}, 'MANIFEST_PREIMAGE')
    date = datetime.datetime.fromisoformat(manifest['atUtc'].replace('Z', '+00:00'))
    need(date.tzinfo is not None and date.utcoffset() == datetime.timedelta(0), 'UTC_APPEND_DATE')
    need(type(manifest['files']) is list and 1 <= len(manifest['files']) <= 512
         and isinstance(manifest['additionalQualification'], str)
         and 1 <= len(manifest['additionalQualification']) <= 8192, 'APPEND_SCOPE')
    seen = {r['repositoryPath'] for r in old['files']}
    need(len(old['files']) == BASE_ROWS and len(seen) == BASE_ROWS
         and len(old['storedRepresentations']) == 8, 'PREFIX_SCOPE')
    for row in manifest['files']:
        need(type(row) is dict and row.get('repositoryPath') not in seen, 'NEW_DUPLICATE_PATH')
        validator(row)
        seen.add(row['repositoryPath'])
    new = copy.deepcopy(old)
    new['files'].extend(copy.deepcopy(manifest['files']))
    new['atUtc'] = manifest['atUtc']
    new['qualification'] = old['qualification'] + ' ' + manifest['additionalQualification']
    need(new['files'][:BASE_ROWS] == old['files'] and new['storedRepresentations'] == old['storedRepresentations'], 'HISTORICAL_CUSTODY_CHANGED')
    for key in old:
        if key not in ('files', 'atUtc', 'qualification'):
            need(new[key] == old[key], 'HISTORICAL_METADATA_CHANGED')
    return (json.dumps(new, indent=2, sort_keys=True) + '\n').encode()

def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def exclusive(path, raw, mode=0o600):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        os.fchmod(stream.fileno(), mode)
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    sync_directory(path.parent)

def main():
    need(sys.flags.isolated, 'LOCAL_ISOLATED')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--preview')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--reviewed-preview')
    parser.add_argument('--reviewed-preview-sha256')
    parser.add_argument('--root-reviewed', action='store_true')
    args = parser.parse_args()
    need(bool(args.preview) != args.apply and HEX.fullmatch(args.manifest_sha256), 'EXACT_PREVIEW_OR_APPLY')
    manifest_path = Path(args.manifest)
    need(manifest_path.parent == Path('/tmp'), 'MANIFEST_LOCAL_SCOPE')
    manifest_raw = read(manifest_path)
    need(sha(manifest_raw) == args.manifest_sha256, 'MANIFEST_BYTES_DIFFER')
    old_raw = read(CUSTODY)
    need(len(old_raw) == BASE_BYTES and sha(old_raw) == BASE_SHA, 'CUSTODY_PREIMAGE_DRIFT')
    old_mode = stat.S_IMODE(CUSTODY.lstat().st_mode)
    need(CUSTODY.lstat().st_uid == os.getuid(), 'CUSTODY_OWNER')
    old = parse(old_raw)
    validate_prior(old)
    manifest = parse(manifest_raw)
    new_raw = build(old, manifest)
    if args.apply:
        need(args.root_reviewed and args.reviewed_preview and args.reviewed_preview_sha256
             and HEX.fullmatch(args.reviewed_preview_sha256), 'SEPARATE_ROOT_PREVIEW_REVIEW')
        preview = Path(args.reviewed_preview)
        need(preview.parent == Path('/tmp'), 'REVIEWED_PREVIEW_SCOPE')
        reviewed = read(preview)
        need(sha(reviewed) == args.reviewed_preview_sha256 and reviewed == new_raw, 'REVIEWED_PREVIEW_DIFFER')
        need(read(CUSTODY) == old_raw, 'CUSTODY_CHANGED_BEFORE_WRITE')
        temporary = CUSTODY.with_name('source-custody.item2-append-v1.tmp')
        exclusive(temporary, new_raw, old_mode)
        need(read(CUSTODY) == old_raw, 'CUSTODY_CHANGED_BEFORE_REPLACE')
        os.replace(temporary, CUSTODY)
        sync_directory(CUSTODY.parent)
        need(read(CUSTODY) == new_raw, 'CUSTODY_POSTIMAGE_DIFFER')
        operation = 'applied'
        target = CUSTODY
    else:
        need(not args.root_reviewed and not args.reviewed_preview and not args.reviewed_preview_sha256, 'PREVIEW_ONLY')
        target = Path(args.preview)
        need(target.parent == Path('/tmp') and target.resolve(strict=False) == target, 'PREVIEW_LOCAL_SCOPE')
        exclusive(target, new_raw)
        operation = 'previewed'
    new = parse(new_raw)
    need(new['files'][:BASE_ROWS] == old['files'] and new['storedRepresentations'] == old['storedRepresentations'], 'FINAL_PREFIX_DRIFT')
    validate_prior(old)
    for row in manifest['files']:
        validate_new(row)
    print(json.dumps({'schema': 'pow-audit30-item2-source-custody-append-result-v1',
          'operation': operation, 'path': str(target), 'bytes': len(new_raw), 'sha256': sha(new_raw),
          'manifestSHA256': args.manifest_sha256, 'historicalRowsPreserved': BASE_ROWS,
          'eightMappingsPreserved': True, 'appendedRows': len(manifest['files']),
          'totalRows': len(new['files']), 'repositoryFilesCopied': False,
          'gitOrRemoteCalls': False}, sort_keys=True))

if __name__ == '__main__':
    main()
