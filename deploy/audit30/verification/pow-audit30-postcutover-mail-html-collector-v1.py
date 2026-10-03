#!/usr/bin/python3 -I
"""Fixed saved-corpus versus public HTTPS mailbox and exact UI HTML helper bytes; hashes only.

The saved Core proof is consumed, never replayed. No SQL/Core, private payload
export, authentication material, data mutation, redirect, proxy, or retry.
"""
import base64, collections, datetime as dt, hashlib, http.client, json, os
import re, signal, stat, subprocess, sys, time
from pathlib import Path
from urllib.parse import quote

APPROVAL = '6821c987b9a5d110fbe9fb2820955b7cbc26dda9faddb67667fc49e892f5c820'
PRIVATE = Path('/data/proofofwork-release-backups/audit30-mail-body-census-20261003T011506Z/preimages.jsonl')
PRIVATE_SHA = 'd71dc1d0cc7a490442092471a30ca388392c9e0ce6a8c33b6c1be22ebedabbe7'
PRIVATE_BYTES = 8321455
FOOTER_SHA = '2de9665f2b93516ca2b366ef9216990d37be1f46d330a4c7f1d9f2709b353dfc'
FROZEN_CENSUS_SHA = '818aaf4207ac5f5c627211eec21ed3991f6fd3a8400cce909c64c6be053ce61c'
WRAPPER_SHA = '37cb62d6440f21f18f4a0f561a0561fb063156f9cb447d172884142056d77f41'
SQL_SHA = 'c109ac647b7d249c9198c6a4b20bca5099b818db733e1b33b8080922909bdaa6'
SHAPE_SOURCE_SHA = '421a332a04aa26fe4d688a909711b802b4c11f30b42b7ef6525f5131b99bdd8d'
LIVE = ('bitcoind.service', 'electrs.service', 'postgresql@16-main.service',
        'proofofwork-api.service', 'proofofwork-indexer-worker.service')
NODE = '/opt/node-v24.18.0-linux-x64/bin/node'
NODE_SHA = '41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c'
APP_SHA = '87fd17ac3ade8eff1a5beae96f0bac6b43866d16ac8487d9bc347aa01b2a7ca2'
ENCODING_SHA = 'ab938b32d9884bd20ad33658aeb0fa1cc79e4d8576529f7127e266f3b06b4ca9'
API_SHA = '9ab92c0fe3cb358fcaacccd62915eabc4c9ee75e42d29c6c989259b1305436f4'
LEAF_SHA = 'c9537fbb7b023559ab3b10f0b83b09cca3eb393cd4da8b99ebd77322d696eda7'
LEAF = base64.b64decode('aW1wb3J0ICogYXMgYml0Y29pbiBmcm9tICJiaXRjb2luanMtbGliIjsKaW1wb3J0IHsgQnVmZmVyIH0gZnJvbSAiYnVmZmVyIjsKZXhwb3J0IGZ1bmN0aW9uIGJ5dGVMZW5ndGgodmFsdWUpIHsKICAgIHJldHVybiBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUodmFsdWUpLmxlbmd0aDsKfQpleHBvcnQgZnVuY3Rpb24gYnl0ZXNUb0hleChieXRlcykgewogICAgcmV0dXJuIEFycmF5LmZyb20oYnl0ZXMsIChieXRlKSA9PiBieXRlLnRvU3RyaW5nKDE2KS5wYWRTdGFydCgyLCAiMCIpKS5qb2luKCIiKTsKfQpleHBvcnQgZnVuY3Rpb24gc2hhMjU2SGV4KGJ5dGVzKSB7CiAgICByZXR1cm4gYnl0ZXNUb0hleChiaXRjb2luLmNyeXB0by5zaGEyNTYoQnVmZmVyLmZyb20oYnl0ZXMpKSk7Cn0KZXhwb3J0IGZ1bmN0aW9uIGJhc2U2NFVybEZyb21CYXNlNjQodmFsdWUpIHsKICAgIHJldHVybiB2YWx1ZS5yZXBsYWNlKC9cKy9nLCAiLSIpLnJlcGxhY2UoL1wvL2csICJfIikucmVwbGFjZSgvPSskL3UsICIiKTsKfQpleHBvcnQgZnVuY3Rpb24gYmFzZTY0RnJvbUJhc2U2NFVybCh2YWx1ZSkgewogICAgY29uc3QgYmFzZTY0ID0gdmFsdWUucmVwbGFjZSgvLS9nLCAiKyIpLnJlcGxhY2UoL18vZywgIi8iKTsKICAgIHJldHVybiBiYXNlNjQucGFkRW5kKE1hdGguY2VpbChiYXNlNjQubGVuZ3RoIC8gNCkgKiA0LCAiPSIpOwp9CmV4cG9ydCBmdW5jdGlvbiBiYXNlNjRVcmxFbmNvZGVCeXRlcyhieXRlcykgewogICAgcmV0dXJuIGJhc2U2NFVybEZyb21CYXNlNjQoQnVmZmVyLmZyb20oYnl0ZXMpLnRvU3RyaW5nKCJiYXNlNjQiKSk7Cn0KZXhwb3J0IGZ1bmN0aW9uIGJhc2U2NFVybERlY29kZUJ5dGVzKHZhbHVlKSB7CiAgICBpZiAoIS9eW0EtWmEtejAtOV8tXSokLy50ZXN0KHZhbHVlKSkgewogICAgICAgIHRocm93IG5ldyBFcnJvcigiSW52YWxpZCBiYXNlNjR1cmwgZGF0YS4iKTsKICAgIH0KICAgIHJldHVybiBuZXcgVWludDhBcnJheShCdWZmZXIuZnJvbShiYXNlNjRGcm9tQmFzZTY0VXJsKHZhbHVlKSwgImJhc2U2NCIpKTsKfQpleHBvcnQgZnVuY3Rpb24gZW5jb2RlVGV4dEJhc2U2NFVybCh2YWx1ZSkgewogICAgcmV0dXJuIGJhc2U2NFVybEVuY29kZUJ5dGVzKG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZSh2YWx1ZSkpOwp9CmV4cG9ydCBmdW5jdGlvbiBkZWNvZGVUZXh0QmFzZTY0VXJsKHZhbHVlKSB7CiAgICByZXR1cm4gbmV3IFRleHREZWNvZGVyKCJ1dGYtOCIsIHsgZmF0YWw6IGZhbHNlIH0pLmRlY29kZShiYXNlNjRVcmxEZWNvZGVCeXRlcyh2YWx1ZSkpOwp9CmV4cG9ydCBmdW5jdGlvbiBjaHVua0FzY2lpKHZhbHVlLCBtYXhCeXRlcykgewogICAgY29uc3QgY2h1bmtzID0gW107CiAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgdmFsdWUubGVuZ3RoOyBpbmRleCArPSBtYXhCeXRlcykgewogICAgICAgIGNodW5rcy5wdXNoKHZhbHVlLnNsaWNlKGluZGV4LCBpbmRleCArIG1heEJ5dGVzKSk7CiAgICB9CiAgICByZXR1cm4gY2h1bmtzLmxlbmd0aCA/IGNodW5rcyA6IFsiIl07Cn0KZXhwb3J0IGZ1bmN0aW9uIGNodW5rVXRmOCh2YWx1ZSwgbWF4Qnl0ZXMpIHsKICAgIGNvbnN0IGNodW5rcyA9IFtdOwogICAgbGV0IGN1cnJlbnQgPSAiIjsKICAgIGZvciAoY29uc3QgY2hhcmFjdGVyIG9mIHZhbHVlKSB7CiAgICAgICAgY29uc3QgbmV4dCA9IGAke2N1cnJlbnR9JHtjaGFyYWN0ZXJ9YDsKICAgICAgICBpZiAoYnl0ZUxlbmd0aChuZXh0KSA+IG1heEJ5dGVzKSB7CiAgICAgICAgICAgIGNodW5rcy5wdXNoKGN1cnJlbnQpOwogICAgICAgICAgICBjdXJyZW50ID0gY2hhcmFjdGVyOwogICAgICAgICAgICBjb250aW51ZTsKICAgICAgICB9CiAgICAgICAgY3VycmVudCA9IG5leHQ7CiAgICB9CiAgICBpZiAoY3VycmVudCB8fCBjaHVua3MubGVuZ3RoID09PSAwKSB7CiAgICAgICAgY2h1bmtzLnB1c2goY3VycmVudCk7CiAgICB9CiAgICByZXR1cm4gY2h1bmtzOwp9CmZ1bmN0aW9uIGlzQnJvd3Nlckh0bWxNZXNzYWdlQm9keSh2YWx1ZSkgewogICAgY29uc3QgdGV4dCA9IHZhbHVlLnRyaW0oKTsKICAgIGlmICghdGV4dCkgewogICAgICAgIHJldHVybiBmYWxzZTsKICAgIH0KICAgIHJldHVybiAoL148IWRvY3R5cGVccytodG1sW1xzPl0vaXUudGVzdCh0ZXh0KSB8fAogICAgICAgIC9ePGh0bWxbXHM+XS9pdS50ZXN0KHRleHQpIHx8CiAgICAgICAgLzxcLyg/Omh0bWx8aGVhZHxib2R5KT4vaXUudGVzdCh0ZXh0KSB8fAogICAgICAgIC9ePCg/OmF8YXJ0aWNsZXxib2R5fGJ1dHRvbnxjYW52YXN8Y29kZXxkaXZ8Zm9ybXxoWzEtNl18aGVhZHxpbWd8aW5wdXR8bWFpbnxvbHxwfHByZXxzY3JpcHR8c2VjdGlvbnxzcGFufHN0eWxlfHN2Z3x0YWJsZXx1bCkoPzpcc3w+fFwvKS9pdS50ZXN0KHRleHQpKTsKfQpmdW5jdGlvbiBicm93c2VyTWVzc2FnZUJvZHlBdHRhY2htZW50KGh0bWwsIHN1YmplY3QpIHsKICAgIGNvbnN0IGJ5dGVzID0gbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKGh0bWwpOwogICAgY29uc3Qgc2FmZVN1YmplY3QgPSAoc3ViamVjdCA/PyAiIikKICAgICAgICAudHJpbSgpCiAgICAgICAgLnJlcGxhY2UoL1teXHcuLV0rL2d1LCAiLSIpCiAgICAgICAgLnJlcGxhY2UoL14tK3wtKyQvZ3UsICIiKQogICAgICAgIC5zbGljZSgwLCA4MCk7CiAgICBjb25zdCBuYW1lID0gc2FmZVN1YmplY3QKICAgICAgICA/IHNhZmVTdWJqZWN0LnRvTG93ZXJDYXNlKCkuZW5kc1dpdGgoIi5odG1sIikKICAgICAgICAgICAgPyBzYWZlU3ViamVjdAogICAgICAgICAgICA6IGAke3NhZmVTdWJqZWN0fS5odG1sYAogICAgICAgIDogIm1lc3NhZ2UtYm9keS5odG1sIjsKICAgIHJldHVybiB7CiAgICAgICAgZGF0YTogYmFzZTY0VXJsRW5jb2RlQnl0ZXMoYnl0ZXMpLAogICAgICAgIG1pbWU6ICJ0ZXh0L2h0bWwiLAogICAgICAgIG5hbWUsCiAgICAgICAgc2hhMjU2OiBzaGEyNTZIZXgoYnl0ZXMpLAogICAgICAgIHNpemU6IGJ5dGVzLmJ5dGVMZW5ndGgsCiAgICB9Owp9Cgpjb25zdCByb3dzPVtdO2xldCBzaXplPTA7Zm9yIGF3YWl0KGNvbnN0IHBpZWNlIG9mIHByb2Nlc3Muc3RkaW4pe3NpemUrPXBpZWNlLmxlbmd0aDtpZihzaXplPjE2KjEwMjQqMTAyNCl0aHJvdyBFcnJvcignSFRNTF9JTlBVVF9CT1VORCcpO3Jvd3MucHVzaChwaWVjZSk7fWNvbnN0IG1lc3NhZ2VzPUpTT04ucGFyc2UoQnVmZmVyLmNvbmNhdChyb3dzKS50b1N0cmluZygndXRmOCcpKTtpZighQXJyYXkuaXNBcnJheShtZXNzYWdlcyl8fG1lc3NhZ2VzLmxlbmd0aCE9PTYxOSl0aHJvdyBFcnJvcignSFRNTF9QT1BVTEFUSU9OX0NPVU5UJyk7Y29uc3Qgb3V0PVtdLGlkcz1uZXcgU2V0KCk7bGV0IGNsYXNzaWZpZWQ9MCxhdHRhY2hlZD0wOwpmb3IoY29uc3QgbWVzc2FnZSBvZiBtZXNzYWdlcyl7aWYoIW1lc3NhZ2V8fHR5cGVvZiBtZXNzYWdlLm1lbW8hPT0nc3RyaW5nJ3x8IS9eW2EtZjAtOV17NjR9JC91LnRlc3QobWVzc2FnZS50eGlkKXx8aWRzLmhhcyhtZXNzYWdlLnR4aWQpKXRocm93IEVycm9yKCdIVE1MX01FU1NBR0VfU0hBUEUnKTtpZHMuYWRkKG1lc3NhZ2UudHhpZCk7Y29uc3QgYnl0ZXM9bmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKG1lc3NhZ2UubWVtbykscmF3PXNoYTI1NkhleChieXRlcyk7aWYocmF3IT09bWVzc2FnZS5yYXdCb2R5LnNoYTI1Nnx8Ynl0ZXMubGVuZ3RoIT09bWVzc2FnZS5yYXdCb2R5LmJ5dGVzKXRocm93IEVycm9yKCdIVE1MX0NBTk9OSUNBTF9NRU1PX0JZVEVTJyk7aWYoIWlzQnJvd3Nlckh0bWxNZXNzYWdlQm9keShtZXNzYWdlLm1lbW8pKWNvbnRpbnVlO2NsYXNzaWZpZWQrKztpZihtZXNzYWdlLmhhc0V4cGxpY2l0QXR0YWNobWVudCl7YXR0YWNoZWQrKztjb250aW51ZTt9Y29uc3QgYXR0YWNobWVudD1icm93c2VyTWVzc2FnZUJvZHlBdHRhY2htZW50KG1lc3NhZ2UubWVtbyk7aWYoYXR0YWNobWVudC5taW1lIT09J3RleHQvaHRtbCd8fGF0dGFjaG1lbnQuc2l6ZSE9PWJ5dGVzLmxlbmd0aHx8YXR0YWNobWVudC5zaGEyNTYhPT1yYXd8fCFCdWZmZXIuZnJvbShhdHRhY2htZW50LmRhdGEsJ2Jhc2U2NHVybCcpLmVxdWFscyhCdWZmZXIuZnJvbShieXRlcykpKXRocm93IEVycm9yKCdIVE1MX0RFUklWRURfQllURVMnKTtvdXQucHVzaCh7dHhpZDptZXNzYWdlLnR4aWQsYnl0ZXM6YXR0YWNobWVudC5zaXplLHNoYTI1NjphdHRhY2htZW50LnNoYTI1Nn0pO30KY29uc29sZS5sb2coSlNPTi5zdHJpbmdpZnkoe3NjaGVtYToncG93LWF1ZGl0MzAtZGVyaXZlZC1odG1sLWJvZHktaGFzaGVzLXYxJyxwb3B1bGF0aW9uUm93czptZXNzYWdlcy5sZW5ndGgsaHRtbEJvZGllc0NsYXNzaWZpZWQ6Y2xhc3NpZmllZCxleHBsaWNpdEF0dGFjaG1lbnRIdG1sQm9kaWVzRXhjbHVkZWQ6YXR0YWNoZWQsZGVyaXZlZEJvZHlBdHRhY2htZW50c1ZlcmlmaWVkOm91dC5sZW5ndGgscmF3Qnl0ZXNQcmVzZXJ2ZWQ6dHJ1ZSxyb3dzOm91dCxwcml2YXRlTWVtb0V4cG9ydGVkOmZhbHNlLGF0dGFjaG1lbnRSZW5kZXJpbmdDZXJ0aWZpZWQ6ZmFsc2V9KSk7Cg==', validate=True)
MAX_ACTORS = 40
MAX_RESPONSE = 16 * 1024**2
MAX_HTTP_TOTAL = 128 * 1024**2
MAX_SENT = 10000
WALL_SECONDS = 600
REQUEST_SECONDS = 30
HEX = re.compile(r'[0-9a-f]{64}\Z')


class Refused(Exception):
    pass


def need(value, code):
    if not value:
        raise Refused(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def pairs(rows):
    result = {}
    for key, value in rows:
        need(key not in result, 'DUPLICATE_JSON_KEY')
        result[key] = value
    return result


def parse(raw):
    return json.loads(raw, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(Refused('NONFINITE_JSON')))


def identity(s):
    return (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_nlink,
            s.st_size, s.st_mtime_ns, s.st_ctime_ns)


def read_authority(path, expected, limit, mode):
    s = path.lstat()
    need(path.resolve(strict=True) == path and stat.S_ISREG(s.st_mode)
         and (s.st_uid, s.st_gid, stat.S_IMODE(s.st_mode), s.st_nlink) == (0, 0, mode, 1)
         and s.st_size <= limit and not os.listxattr(path, follow_symlinks=False), 'FILE_AUTHORITY')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
    with os.fdopen(fd, 'rb') as f:
        need(identity(os.fstat(f.fileno())) == identity(s), 'FILE_OPEN_DRIFT')
        raw = f.read(limit + 1)
        need(identity(os.fstat(f.fileno())) == identity(s), 'FILE_READ_DRIFT')
    need(identity(path.lstat()) == identity(s) and len(raw) == s.st_size
         and len(raw) <= limit and sha(raw) == expected, 'FILE_BYTES_DRIFT')
    return raw, identity(s)


def body_digest(value):
    need(isinstance(value, str), 'MEMO_UTF8_STRING_REQUIRED')
    raw = value.encode('utf-8', errors='strict')
    return {'bytes': len(raw), 'sha256': sha(raw)}


def known_actor(payload, mail):
    for candidate in (payload.get('actor'), payload.get('senderAddress'), mail.get('sender_address')):
        need(candidate is None or isinstance(candidate, str), 'ACTOR_STRING_TYPE')
        value = (candidate or '').strip()
        if value and value.lower() != 'unknown':
            need(14 <= len(value) <= 100 and re.fullmatch(r'[A-Za-z0-9]+', value), 'ACTOR_SAFE_ADDRESS')
            return value
    raise Refused('ACTOR_MISSING')


def capture_rows(raw, expected_rows=619, expected_actors=33, footer_sha=FOOTER_SHA):
    need(raw.endswith(b'\n') and len(raw) <= PRIVATE_BYTES, 'CAPTURE_TERMINATION_OR_BOUND')
    objects = [parse(line) for line in raw.splitlines()]
    need(len(objects) == expected_rows + 3, 'CAPTURE_LINE_COUNT')
    head, footer = objects[0], objects[-1]
    need(head == {'phase': 'private-capture-header', 'schema': 'pow-audit30-mail-private-sql-lines-v1',
                  'frozenCensusSHA256': FROZEN_CENSUS_SHA, 'wrapperSHA256': WRAPPER_SHA,
                  'sqlSHA256': SQL_SHA}, 'CAPTURE_SOURCE_HEADER')
    need(set(footer) == {'phase', 'status', 'records', 'publicCensusBase64', 'publicCensusSHA256'}
         and footer['phase'] == 'private-capture-footer' and footer['status'] == 'complete'
         and footer['records'] == expected_rows + 1 and footer['publicCensusSHA256'] == footer_sha,
         'CAPTURE_COMPLETE_FOOTER')
    public_raw = base64.b64decode(footer['publicCensusBase64'], validate=True)
    need(sha(public_raw) == footer_sha, 'FOOTER_BYTES_HASH')
    public = parse(public_raw)
    need(public.get('schema') == 'pow-audit30-mail-body-census-v1' and public.get('ok') is True
         and public.get('coreVerified') is True and public.get('errors') == []
         and public.get('sourceSha256') == FROZEN_CENSUS_SHA, 'SAVED_CORE_PROOF_REQUIRED')
    public_rows = public.get('rows')
    need(isinstance(public_rows, list) and len(public_rows) == expected_rows, 'PUBLIC_POPULATION_COUNT')
    witnesses = []
    snapshot = None
    for ordinal, envelope in enumerate(objects[1:-1]):
        need(set(envelope) == {'phase', 'recordBase64', 'recordSHA256'}
             and envelope['phase'] == 'private-sql-line', 'CAPTURE_RECORD_ENVELOPE')
        line = base64.b64decode(envelope['recordBase64'], validate=True)
        need(len(line) <= 8 * 1024**2 and sha(line) == envelope['recordSHA256'], 'CAPTURE_RECORD_HASH')
        row = parse(line)
        if ordinal == 0:
            need(row.get('phase') == 'snapshot' and row.get('transactionReadOnly') == 'on'
                 and row.get('mailRows') == expected_rows, 'SAVED_SNAPSHOT_REQUIRED')
            snapshot = row
            continue
        need(row.get('phase') == 'row' and row.get('network') == 'livenet'
             and HEX.fullmatch(row.get('txid', '')) is not None
             and isinstance(row.get('events'), list) and len(row['events']) == 1
             and isinstance(row.get('mail'), dict), 'PRIVATE_ROW_IDENTITY')
        event, mail = row['events'][0], row['mail']
        need(isinstance(event, dict) and isinstance(event.get('payload'), dict), 'EVENT_PAYLOAD_TYPE')
        payload = event['payload']
        need(event.get('status') == mail.get('status') == 'confirmed'
             and payload.get('status', 'confirmed') == 'confirmed'
             and payload.get('confirmed', True) is True, 'CONFIRMED_SAVED_ROW')
        given = public_rows[ordinal - 1]
        need(given.get('txid') == row['txid'] and given.get('network') == 'livenet'
             and given.get('status') == 'confirmed' and given.get('kind') == event.get('kind')
             and isinstance(given.get('canonicalCore'), dict)
             and given['canonicalCore'].get('coreScriptsBound') is True, 'PUBLIC_PRIVATE_ROW_BINDING')
        digest = body_digest(payload.get('memo'))
        raw_body = given.get('rawBody')
        need(isinstance(raw_body, dict) and raw_body.get('isNull') is False
             and {k: raw_body.get(k) for k in ('bytes', 'sha256')} == digest
             and given.get('payloadDirectEqualsRaw') is True, 'PRIVATE_MEMO_RAW_HASH_DISAGREEMENT')
        witnesses.append({'txid': row['txid'], 'kind': event['kind'], 'status': 'confirmed',
                          'actor': known_actor(payload, mail), 'rawBody': digest})
    ids = [w['txid'] for w in witnesses]
    actors = {w['actor'] for w in witnesses}
    need(ids == sorted(ids) and len(set(ids)) == expected_rows and len(actors) == expected_actors
         and expected_actors <= MAX_ACTORS, 'UNIQUE_ORDERED_POPULATION_AND_ACTORS')
    need(public.get('counts', {}).get('confirmed') == expected_rows, 'CONFIRMED_PUBLIC_COUNT')
    return witnesses, {'footerSha256': footer_sha, 'snapshot': {k: public['snapshot'][k]
                       for k in ('mailRows',) if k in public['snapshot']},
                       'savedCoreProofConsumed': True, 'newCoreCalls': 0,
                       'privateShapeSourceSha256': SHAPE_SOURCE_SHA}


def show(unit, fields):
    p = subprocess.run(['/usr/bin/systemctl', 'show', unit, '--no-pager',
                        *['--property=' + field for field in fields]], stdin=subprocess.DEVNULL,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5,
                       env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
    need(p.returncode == 0 and not p.stderr and len(p.stdout) <= 65536, 'FIXED_SERVICE_METADATA')
    d = pairs(line.split('=', 1) for line in p.stdout.decode().splitlines())
    need(set(d) == set(fields), 'SERVICE_METADATA_FIELDS')
    return d


def live_five(expected):
    result = {}
    for unit in LIVE:
        row = show(unit, ('LoadState', 'ActiveState', 'SubState', 'MainPID', 'InvocationID'))
        need(row['LoadState'] == 'loaded' and row['ActiveState'] == 'active'
             and row['SubState'] == 'running'
             and {k: row[k] for k in ('MainPID', 'InvocationID')} == expected[unit], 'LIVE_FIVE_CHANGED')
        result[unit] = row
    return result


def request(value):
    need(isinstance(value, dict) and set(value) == {'schema', 'approvalSha256', 'stage', 'runId',
         'sourceSha256', 'liveFive'} and value['schema'] == 'pow-audit30-mail-api-population-request-v1'
         and value['approvalSha256'] == APPROVAL and value['stage'] == 'after', 'EXACT_REQUEST')
    rid = value['runId']
    need(isinstance(rid, str) and re.fullmatch(r'20[0-9]{6}T[0-9]{6}Z', rid)
         and dt.datetime.strptime(rid, '%Y%m%dT%H%M%SZ').strftime('%Y%m%dT%H%M%SZ') == rid,
         'CALENDAR_RUN_ID')
    need(HEX.fullmatch(value['sourceSha256']) is not None and set(value['liveFive']) == set(LIVE),
         'SOURCE_AND_LIVE_SCOPE')
    for row in value['liveFive'].values():
        need(set(row) == {'MainPID', 'InvocationID'} and isinstance(row['MainPID'], str)
             and re.fullmatch(r'[1-9][0-9]*', row['MainPID'])
             and isinstance(row['InvocationID'], str) and re.fullmatch(r'[0-9a-f]{32}', row['InvocationID']),
             'LIVE_EXPECTED_IDENTITY')
    return value


def runtime(value):
    name = 'proofofwork-audit30-mail-api-html-' + value['stage'] + '-' + value['runId'] + '.service'
    expected_cgroup = '0::/system.slice/' + name
    need(Path('/proc/self/cgroup').read_text().strip() == expected_cgroup, 'EXACT_NATIVE_CGROUP')
    desired = {'LoadState': 'loaded', 'Type': 'exec', 'Transient': 'yes', 'User': 'root', 'Group': 'root',
               'MainPID': str(os.getpid()), 'MemoryMax': str(512 * 1024**2), 'MemorySwapMax': '0',
               'CPUQuotaPerSecUSec': '250ms', 'TasksMax': '16', 'RuntimeMaxUSec': '11min',
               'NoNewPrivileges': 'yes', 'CapabilityBoundingSet': '', 'AmbientCapabilities': '',
               'ProtectSystem': 'strict', 'ProtectHome': 'yes', 'PrivateTmp': 'yes',
               'PrivateDevices': 'yes', 'PrivateIPC': 'yes', 'PrivateNetwork': 'no',
               'RestrictAddressFamilies': 'AF_UNIX AF_INET', 'ReadWritePaths': '',
               'InaccessiblePaths': '/run/postgresql /var/lib/postgresql /data/bitcoin /etc/bitcoin /etc/proofofwork-api'}
    result = show(name, tuple(desired))
    need(all(result[k] == v for k, v in desired.items() if k != 'RestrictAddressFamilies')
         and set(result['RestrictAddressFamilies'].split()) == {'AF_UNIX', 'AF_INET'},
         'ACTUAL_COLLECTOR_RESOURCES_OR_NAMESPACE')
    return {'unit': name, 'actualProperties': result,
            'backendResourceCapClaimed': False, 'collectorOnlyResourceCaps': True}


class WireBudget:
    """Charge every received body byte before framing/JSON interpretation."""
    def __init__(self, maximum=MAX_HTTP_TOTAL):
        self.maximum = maximum
        self.used = 0

    def charge(self, count):
        need(type(count) is int and count >= 0, 'WIRE_BYTE_COUNT')
        self.used += count
        need(self.used <= self.maximum, 'CUMULATIVE_HTTP_BOUND')


def get_mail(address, deadline, budget=None):
    budget = WireBudget() if budget is None else budget
    need(budget.used < budget.maximum, 'CUMULATIVE_HTTP_BOUND')
    start = time.monotonic()
    request_deadline = min(deadline, start + REQUEST_SECONDS)
    need(request_deadline > start, 'WHOLE_DEADLINE')
    previous_handler = signal.getsignal(signal.SIGALRM)
    previous_timer = signal.getitimer(signal.ITIMER_REAL)
    need(previous_timer[1] == 0, 'NONPERIODIC_NATIVE_DEADLINE_REQUIRED')
    def absolute_timeout(*_):
        raise Refused('ABSOLUTE_REQUEST_DEADLINE')
    signal.setitimer(signal.ITIMER_REAL, 0)
    signal.signal(signal.SIGALRM, absolute_timeout)
    signal.setitimer(signal.ITIMER_REAL, request_deadline - start)
    connection = None
    response = None
    route = '/api/v1/address/' + quote(address, safe='') + '/mail?fresh=1&network=livenet'
    try:
        connection = http.client.HTTPSConnection('api.proofofwork.me', 443, timeout=request_deadline - start)
        connection.request('GET', route, headers={'Accept': 'application/json', 'Connection': 'close',
                                                 'Accept-Encoding': 'identity'})
        remaining = request_deadline - time.monotonic()
        need(remaining > 0, 'ABSOLUTE_REQUEST_DEADLINE')
        if connection.sock is not None:
            connection.sock.settimeout(remaining)
        response = connection.getresponse()
        need(response.status == 200, 'HTTP_STATUS_' + str(response.status))
        need(response.getheader('Content-Encoding', 'identity').lower() == 'identity', 'HTTP_ENCODING')
        declared = response.getheader('Content-Length')
        need(declared is None or (declared.isdigit() and int(declared) <= MAX_RESPONSE), 'HTTP_DECLARED_BOUND')
        chunks, count = [], 0
        while True:
            remaining = request_deadline - time.monotonic()
            need(remaining > 0, 'ABSOLUTE_REQUEST_DEADLINE')
            # response.read1 is a single bounded underlying read, avoiding a
            # peer extending the absolute limit by trickling a large read().
            sock = getattr(getattr(response.fp, 'raw', None), '_sock', None)
            if sock is not None:
                sock.settimeout(remaining)
            need(budget.used < budget.maximum, 'CUMULATIVE_HTTP_BOUND')
            try:
                part = response.read1(min(65536, MAX_RESPONSE - count + 1,
                                          budget.maximum - budget.used + 1))
            except http.client.IncompleteRead as error:
                budget.charge(len(error.partial))
                raise
            if not part:
                break
            budget.charge(len(part))
            chunks.append(part)
            count += len(part)
            need(count <= MAX_RESPONSE, 'HTTP_RESPONSE_BOUND')
        raw = b''.join(chunks)
        need(declared is None or len(raw) == int(declared), 'HTTP_FRAMING_INCOMPLETE')
        return parse(raw), {'bytes': len(raw), 'sha256': sha(raw), 'seconds': time.monotonic() - start}
    finally:
        if response is not None:
            response.close()
        if connection is not None:
            connection.close()
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        if previous_timer[0] > 0:
            # Preserve the original whole-collector deadline, rather than
            # resetting its remaining duration after each actor request.
            signal.setitimer(signal.ITIMER_REAL,
                             max(.000001, previous_timer[0] - (time.monotonic() - start)))


def compare_response(address, expected, payload):
    need(isinstance(payload, dict) and payload.get('address') == address
         and payload.get('network') == 'livenet', 'HTTP_ADDRESS_NETWORK_IDENTITY')
    coverage = payload.get('historyCoverage')
    need(isinstance(coverage, dict) and coverage.get('complete') is True
         and coverage.get('model') == 'proof-index-address-mail-complete-v1', 'HTTP_HISTORY_INCOMPLETE')
    messages = payload.get('sentMessages')
    need(isinstance(messages, list) and len(messages) <= MAX_SENT, 'HTTP_SENT_LIST_BOUND')
    by_id = {}
    for message in messages:
        need(isinstance(message, dict) and HEX.fullmatch(message.get('txid', '')) is not None,
             'HTTP_SENT_TXID_TYPE')
        need(message['txid'] not in by_id, 'HTTP_DUPLICATE_SENT_TXID')
        by_id[message['txid']] = message
    rows = []
    for witness in expected:
        message = by_id.get(witness['txid'])
        found = message is not None
        digest = None
        memo_valid = found and isinstance(message.get('memo'), str)
        if memo_valid:
            digest = body_digest(message['memo'])
        reasons = []
        if not found:
            reasons.append('missing-sent-row')
        else:
            if message.get('from') != address or message.get('network') != 'livenet':
                reasons.append('sender-or-network')
            if message.get('status') != 'confirmed':
                reasons.append('confirmed-status')
            if message.get('protocolKind') != witness['kind']:
                reasons.append('protocol-kind')
            if not memo_valid:
                reasons.append('memo-not-utf8-string')
            elif digest != witness['rawBody']:
                reasons.append('memo-raw-byte-difference')
        rows.append({'txid': witness['txid'], 'addressSha256': sha(address.encode()),
                     'kind': witness['kind'], 'expectedStatus': 'confirmed', 'found': found,
                     'expectedRawBody': witness['rawBody'], 'actualMemo': digest,
                     'allCheckedFieldsMatch': not reasons, 'discrepancies': reasons})
    return rows, {'returnedSentCount': len(messages), 'expectedSentCount': len(expected),
                  'extraUncertifiedSentCount': len(set(by_id) - {w['txid'] for w in expected}),
                  'historyCoverageComplete': True}


def collect(witnesses, stage, deadline, getter=get_mail):
    groups = collections.defaultdict(list)
    for witness in witnesses:
        groups[witness['actor']].append(witness)
    need(0 < len(groups) <= MAX_ACTORS, 'ACTOR_REQUEST_BOUND')
    outcomes, rows, errors = [], [], []
    budget = WireBudget()
    for address in sorted(groups):
        if budget.used >= budget.maximum:
            errors.append({'code': 'cumulative-http-bound',
                           'unrequestedActorCount': len(groups) - len(outcomes)})
            break
        if time.monotonic() >= deadline:
            errors.append({'code': 'whole-deadline', 'unrequestedActorCount': len(groups) - len(outcomes)})
            break
        address_hash = sha(address.encode())
        prior_bytes = budget.used
        try:
            payload, transfer = getter(address, deadline, budget)
            need(transfer['bytes'] == budget.used - prior_bytes, 'WIRE_TRANSFER_ACCOUNTING')
            checked, coverage = compare_response(address, groups[address], payload)
            rows.extend(checked)
            outcomes.append({'addressSha256': address_hash, 'status': 'checked',
                             'transfer': transfer, **coverage})
        except BaseException as error:
            if isinstance(error, (KeyboardInterrupt, SystemExit, InterruptedError)):
                raise
            code = str(error) if isinstance(error, Refused) else type(error).__name__
            errors.append({'addressSha256': address_hash, 'errorClass': type(error).__name__,
                           'code': code, 'privateReasonSha256': sha(str(error).encode())})
            outcomes.append({'addressSha256': address_hash, 'status': 'request-or-response-refused',
                             'receivedBodyBytes': budget.used - prior_bytes})
            if isinstance(error, Refused) and str(error) == 'CUMULATIVE_HTTP_BOUND':
                break
    matching = sum(row['allCheckedFieldsMatch'] for row in rows)
    complete = len(outcomes) == len(groups) and not errors and len(rows) == len(witnesses)
    accepted = complete and matching == len(witnesses)
    return {'schema': 'pow-audit30-mail-api-population-result-v1',
            'stage': stage, 'status': 'passed' if accepted else 'observed-discrepancies-or-incomplete',
            'populationRows': len(witnesses), 'actorCount': len(groups), 'actorsAttempted': len(outcomes),
            'rowsChecked': len(rows), 'rowsMatchingRawAndIdentity': matching,
            'rowsWithDiscrepancies': len(rows) - matching, 'completeExpectedCorpusCoverage': complete,
            'allExpectedRowsVerified': accepted, 'requiredAfterCutoverAcceptance': stage == 'after',
            'afterCutoverAccepted': stage == 'after' and accepted, 'responseBytes': budget.used,
            'actors': outcomes, 'rows': rows, 'errors': errors, 'productionMutation': False,
            'privatePayloadExported': False, 'addressesExported': False, 'newCoreCalls': 0,
            'sqlCalls': 0, 'financialCompleteness': False,
            'qualification': 'All 619 saved confirmed mailbox rows against 33 actor mailboxes. Consumes the frozen canonical source-script proof; no new Core replay, post-snapshot complete corpus, pending status, attachment rendering, or backend-wide resource certificate.'}


def helper_source(path, expected, maximum, owner):
    s = path.lstat()
    need(path.resolve(strict=True) == path and stat.S_ISREG(s.st_mode)
         and s.st_uid == s.st_gid == owner and s.st_nlink == 1
         and not stat.S_IMODE(s.st_mode) & 0o022 and 0 < s.st_size <= maximum,
         'UI_SOURCE_FILE_SHAPE')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as f:
        raw = f.read(maximum + 1)
        need(identity(os.fstat(f.fileno())) == identity(s), 'UI_SOURCE_FD_DRIFT')
    need(len(raw) == s.st_size and sha(raw) == expected
         and identity(path.lstat()) == identity(s), 'UI_SOURCE_PIN_DRIFT')
    return identity(s)


def html_and_https_collect(witnesses, deadline):
    import pwd
    owner = pwd.getpwnam('powadmin').pw_uid
    need(owner > 0 and sha(LEAF) == LEAF_SHA, 'HTML_OWNER_OR_LEAF_PIN')
    pins = [(Path(NODE), NODE_SHA, 128 * 1024**2, 0),
            (Path('/opt/proofofwork-api/src/App.tsx'), APP_SHA, 4 * 1024**2, owner),
            (Path('/opt/proofofwork-api/src/shared/utils/encoding.ts'), ENCODING_SHA, 65536, owner),
            (Path('/opt/proofofwork-api/server/proof-api.mjs'), API_SHA, 4 * 1024**2, owner)]
    source_proofs = [helper_source(*pin) for pin in pins]
    groups = collections.defaultdict(list)
    for witness in witnesses:
        groups[witness['actor']].append(witness)
    private_messages = []
    def getter(address, request_deadline, budget):
        payload, transfer = get_mail(address, request_deadline, budget)
        checked, _ = compare_response(address, groups[address], payload)
        if all(row['allCheckedFieldsMatch'] for row in checked):
            actual = {message['txid']: message for message in payload['sentMessages']}
            for witness in groups[address]:
                message = actual[witness['txid']]
                private_messages.append({'txid': witness['txid'], 'memo': message['memo'],
                                         'rawBody': witness['rawBody'],
                                         'hasExplicitAttachment': (isinstance(message.get('attachment'), (dict, list)) or bool(message.get('attachment')))})
        return payload, transfer
    result = collect(witnesses, 'after', deadline, getter=getter)
    need(result['allExpectedRowsVerified'] and len(private_messages) == 619,
         'PUBLIC_HTTPS_ALL619_NOT_VERIFIED')
    remaining = min(45, deadline - time.monotonic())
    need(remaining > 0, 'HTML_WHOLE_DEADLINE')
    private_input = json.dumps(private_messages, ensure_ascii=False, separators=(',', ':')).encode()
    need(len(private_input) <= 16 * 1024**2, 'HTML_PRIVATE_INPUT_BOUND')
    child = subprocess.run([NODE, '--max-old-space-size=128', '--input-type=module',
                            '--eval', LEAF.decode()], input=private_input,
                           cwd='/opt/proofofwork-api', env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'},
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=remaining)
    need(child.returncode == 0 and not child.stderr and len(child.stdout) <= 512 * 1024,
         'HTML_FIXED_CHILD_REFUSED')
    html = parse(child.stdout)
    need(html.get('schema') == 'pow-audit30-derived-html-body-hashes-v1'
         and html.get('populationRows') == 619 and html.get('rawBytesPreserved') is True
         and html.get('privateMemoExported') is False and html.get('attachmentRenderingCertified') is False,
         'HTML_FIXED_CHILD_BINDING')
    need([helper_source(*pin) for pin in pins] == source_proofs, 'UI_SOURCE_FINAL_DRIFT')
    seconds = sorted(actor['transfer']['seconds'] for actor in result['actors'])
    need(len(seconds) == 33 and all(isinstance(x, (int, float)) and 0 <= x <= REQUEST_SECONDS for x in seconds),
         'HTTPS_LATENCY_POPULATION')
    result.update(publicHTTPSOrigin='https://api.proofofwork.me', publicHTTPSAll619Verified=True,
                  derivedHTML=html, uiHelperAppSourceSha256=APP_SHA, uiHelperEncodingSourceSha256=ENCODING_SHA,
                  uiHelperLeafSha256=LEAF_SHA, actualApiSourceSha256=API_SHA,
                  latencySeconds={'requests': len(seconds), 'min': round(seconds[0], 6),
                                  'median': round(seconds[len(seconds)//2], 6),
                                  'p95': round(seconds[(95*len(seconds)+99)//100-1], 6),
                                  'max': round(seconds[-1], 6)},
                  qualification='All619 saved confirmed canonical mailbox witnesses over33 fresh public HTTPS GETs; exact current App body classifier/attachment helper bytes for derived HTML only. Consumes frozen canonical source-script proof; excludes post-snapshot corpus, pending mail, explicit attachment rendering and backend-wide resource certification.')
    return result


def main():
    need(sys.flags.isolated and os.geteuid() == os.getegid() == 0
         and os.uname().nodename == 'pow-bitcoin-01' and len(sys.argv) == 2
         and HEX.fullmatch(sys.argv[1]) is not None, 'NATIVE_ROOT_ARGV')
    old = {s: signal.getsignal(s) for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGALRM)}
    def interrupted(*_):
        raise InterruptedError('fixed-collector-signal-or-deadline')
    for s in old:
        signal.signal(s, interrupted)
    signal.alarm(WALL_SECONDS)
    deadline = time.monotonic() + WALL_SECONDS
    result = None
    try:
        raw_request = sys.stdin.buffer.read(65537)
        need(len(raw_request) <= 65536 and sha(raw_request) == sys.argv[1], 'RAW_REQUEST_HASH')
        value = request(parse(raw_request))
        source_path = Path(__file__)
        need(source_path == Path('/usr/local/lib/proofofwork-audit30-mail-api-html-population') /
             value['runId'] / 'collector.py', 'EXACT_IMMUTABLE_SOURCE_PATH')
        source, source_meta = read_authority(source_path, value['sourceSha256'], 65536, 0o440)
        actual_runtime = runtime(value)
        before = live_five(value['liveFive'])
        parent = PRIVATE.parent.lstat()
        need(PRIVATE.parent.resolve(strict=True) == PRIVATE.parent and stat.S_ISDIR(parent.st_mode)
             and (parent.st_uid, parent.st_gid, stat.S_IMODE(parent.st_mode)) == (0, 0, 0o700), 'PRIVATE_PARENT')
        raw, meta = read_authority(PRIVATE, PRIVATE_SHA, PRIVATE_BYTES, 0o600)
        need(len(raw) == PRIVATE_BYTES, 'PRIVATE_EXACT_SIZE')
        witnesses, saved = capture_rows(raw)
        result = html_and_https_collect(witnesses, deadline)
        need(read_authority(PRIVATE, PRIVATE_SHA, PRIVATE_BYTES, 0o600)[1] == meta, 'PRIVATE_FINAL_CUSTODY')
        need(read_authority(source_path, value['sourceSha256'], 65536, 0o440)[1] == source_meta,
             'SOURCE_FINAL_CUSTODY')
        need(live_five(value['liveFive']) == before, 'LIVE_FINAL_CUSTODY')
        runtime(value)
        result.update(atUtc=dt.datetime.now(dt.timezone.utc).isoformat(), requestSha256=sys.argv[1],
                      sourceSha256=sha(source), privateCaptureSha256=PRIVATE_SHA,
                      privateCaptureUnchanged=True, sourceUnchanged=True, liveFiveUnchanged=True,
                      savedCanonicalProof=saved, runtime=actual_runtime)
        print(json.dumps(result, sort_keys=True, separators=(',', ':')))
        return 0 if value['stage'] == 'baseline' or result['afterCutoverAccepted'] else 2
    except BaseException as error:
        if result is not None:
            result.update(status='refused-final-custody', allExpectedRowsVerified=False,
                          afterCutoverAccepted=False)
        print(json.dumps({'schema': 'pow-audit30-mail-api-population-refusal-v1',
                          'errorClass': type(error).__name__,
                          'code': str(error) if isinstance(error, Refused) else 'UNEXPECTED_OR_SIGNAL',
                          'privateReasonSha256': sha(str(error).encode()), 'partialResult': result,
                          'productionMutation': False, 'privatePayloadExported': False},
                         sort_keys=True, separators=(',', ':')))
        return 1
    finally:
        signal.alarm(0)
        for s, handler in old.items():
            signal.signal(s, handler)


if __name__ == '__main__':
    raise SystemExit(main())
