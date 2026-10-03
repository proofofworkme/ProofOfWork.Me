import base64, copy, hashlib, http.client, http.server, importlib.util, json
import pathlib, signal, socket, tempfile, threading, time, types, unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('M', '/tmp/pow-audit30-mail-api-population-v2.py')
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)
ADDRESS = '1' + 'A' * 25
OTHER = '1' + 'B' * 25


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def witness(txid='a' * 64, actor=ADDRESS, memo=' \tUnicode é\n '):
    return {'txid': txid, 'kind': 'mail', 'status': 'confirmed', 'actor': actor,
            'rawBody': M.body_digest(memo)}


def payload(rows=None, actor=ADDRESS, memo=' \tUnicode é\n '):
    rows = rows or [witness()]
    return {'address': actor, 'network': 'livenet',
            'historyCoverage': {'complete': True, 'model': 'proof-index-address-mail-complete-v1'},
            'sentMessages': [{'txid': row['txid'], 'from': actor, 'network': 'livenet',
                              'protocolKind': row['kind'], 'status': 'confirmed', 'memo': memo}
                             for row in rows]}


def capture(memos=None):
    memos = [' \tUnicode é\n ', ''] if memos is None else memos
    raw_rows, public_rows = [], []
    for i, memo in enumerate(memos):
        txid = format(i + 1, '064x')
        raw_rows.append({'phase': 'row', 'network': 'livenet', 'txid': txid,
                         'events': [{'kind': 'mail', 'status': 'confirmed',
                                     'payload': {'memo': memo, 'senderAddress': ADDRESS, 'confirmed': True}}],
                         'mail': {'status': 'confirmed', 'sender_address': ADDRESS}})
        public_rows.append({'network': 'livenet', 'txid': txid, 'kind': 'mail', 'status': 'confirmed',
                            'canonicalCore': {'coreScriptsBound': True},
                            'rawBody': {'isNull': False, **M.body_digest(memo)},
                            'payloadDirectEqualsRaw': True})
    public = {'schema': 'pow-audit30-mail-body-census-v1', 'ok': True, 'coreVerified': True,
              'errors': [], 'sourceSha256': M.FROZEN_CENSUS_SHA, 'rows': public_rows,
              'counts': {'confirmed': len(memos)}, 'snapshot': {'mailRows': len(memos)}}
    public_raw = encoded(public)
    head = {'phase': 'private-capture-header', 'schema': 'pow-audit30-mail-private-sql-lines-v1',
            'frozenCensusSHA256': M.FROZEN_CENSUS_SHA, 'wrapperSHA256': M.WRAPPER_SHA, 'sqlSHA256': M.SQL_SHA}
    records = [{'phase': 'snapshot', 'transactionReadOnly': 'on', 'mailRows': len(memos)}, *raw_rows]
    envelopes = []
    for row in records:
        raw = encoded(row)
        envelopes.append({'phase': 'private-sql-line', 'recordBase64': base64.b64encode(raw).decode(),
                          'recordSHA256': M.sha(raw)})
    footer = {'phase': 'private-capture-footer', 'status': 'complete', 'records': len(records),
              'publicCensusBase64': base64.b64encode(public_raw).decode(), 'publicCensusSHA256': M.sha(public_raw)}
    return [head, *envelopes, footer], public


def capture_raw(objects):
    return b'\n'.join(encoded(row) for row in objects) + b'\n'


class Tests(unittest.TestCase):
    def test_utf8_whitespace_and_empty_are_exact(self):
        objects, public = capture()
        rows, saved = M.capture_rows(capture_raw(objects), 2, 1, objects[-1]['publicCensusSHA256'])
        self.assertEqual(rows[0]['rawBody'], M.body_digest(' \tUnicode é\n '))
        self.assertEqual(rows[1]['rawBody'], M.body_digest(''))
        self.assertNotEqual(rows[0]['rawBody'], M.body_digest('Unicode é'))
        self.assertTrue(saved['savedCoreProofConsumed'])
        self.assertEqual(saved['newCoreCalls'], 0)

    def test_capture_header_hash_footer_order_and_core_refuse(self):
        original, public = capture()
        for change in ('header', 'footer', 'recordhash', 'roworder', 'core', 'payloadraw', 'nullmemo'):
            objects = copy.deepcopy(original)
            if change == 'header':
                objects[0]['wrapperSHA256'] = '0' * 64
            elif change == 'footer':
                objects[-1]['status'] = 'failed'
            elif change == 'recordhash':
                objects[2]['recordSHA256'] = '0' * 64
            elif change == 'roworder':
                objects[2], objects[3] = objects[3], objects[2]
            elif change == 'nullmemo':
                row = M.parse(base64.b64decode(objects[2]['recordBase64']))
                row['events'][0]['payload']['memo'] = None
                raw = encoded(row)
                objects[2].update(recordBase64=base64.b64encode(raw).decode(), recordSHA256=M.sha(raw))
            else:
                value = copy.deepcopy(public)
                if change == 'core':
                    value['coreVerified'] = False
                else:
                    value['rows'][0]['rawBody']['sha256'] = '0' * 64
                raw = encoded(value)
                objects[-1].update(publicCensusBase64=base64.b64encode(raw).decode(), publicCensusSHA256=M.sha(raw))
            with self.subTest(change=change), self.assertRaises(M.Refused):
                M.capture_rows(capture_raw(objects), 2, 1, objects[-1]['publicCensusSHA256'])

    def test_capture_truncation_duplicate_json_and_incomplete_coverage_refuse(self):
        objects, _ = capture()
        raw = capture_raw(objects)
        self.assertRaises(M.Refused, M.capture_rows, raw[:-1], 2, 1, objects[-1]['publicCensusSHA256'])
        self.assertRaises(M.Refused, M.parse, b'{"memo":1,"memo":2}')
        self.assertRaises(M.Refused, M.parse, b'{"v":NaN}')
        self.assertRaises(M.Refused, M.capture_rows, raw, 3, 1, objects[-1]['publicCensusSHA256'])

    def test_actor_fallback_unknown_and_path_characters_refuse(self):
        self.assertEqual(M.known_actor({'actor': 'Unknown', 'senderAddress': ' ' + ADDRESS + ' '}, {}), ADDRESS)
        self.assertEqual(M.known_actor({}, {'sender_address': ADDRESS}), ADDRESS)
        self.assertRaises(M.Refused, M.known_actor, {'actor': '../../etc/bitcoin'}, {})
        self.assertRaises(M.Refused, M.known_actor, {}, {'sender_address': None})
        self.assertRaises(M.Refused, M.known_actor, {'actor': 123}, {'sender_address': ADDRESS})

    def test_all_response_identity_body_fields_are_checked(self):
        row = witness()
        valid = payload()
        compared, _ = M.compare_response(ADDRESS, [row], valid)
        self.assertTrue(compared[0]['allCheckedFieldsMatch'])
        for key, value, reason in [('memo', 'Unicode é', 'memo-raw-byte-difference'),
                                   ('memo', None, 'memo-not-utf8-string'),
                                   ('status', 'pending', 'confirmed-status'),
                                   ('protocolKind', 'file', 'protocol-kind'),
                                   ('from', OTHER, 'sender-or-network'),
                                   ('network', 'testnet', 'sender-or-network')]:
            bad = copy.deepcopy(valid)
            bad['sentMessages'][0][key] = value
            result, _ = M.compare_response(ADDRESS, [row], bad)
            self.assertIn(reason, result[0]['discrepancies'])

    def test_missing_row_remains_finding_without_false_green(self):
        valid = payload()
        valid['sentMessages'] = []
        result, coverage = M.compare_response(ADDRESS, [witness()], valid)
        self.assertFalse(result[0]['found'])
        self.assertEqual(result[0]['discrepancies'], ['missing-sent-row'])
        self.assertEqual(coverage['returnedSentCount'], 0)

    def test_duplicate_returned_txid_and_wrong_corpus_identity_refuse(self):
        for change in ('duplicate', 'address', 'network', 'coverage', 'model'):
            bad = payload()
            if change == 'duplicate':
                bad['sentMessages'] *= 2
            elif change == 'coverage':
                bad['historyCoverage']['complete'] = False
            elif change == 'model':
                bad['historyCoverage']['model'] = 'partial'
            else:
                bad[change] = OTHER if change == 'address' else 'testnet'
            with self.subTest(change=change):
                self.assertRaises(M.Refused, M.compare_response, ADDRESS, [witness()], bad)

    def test_baseline_differences_recorded_after_mode_requires_exact_parity(self):
        def get(address, deadline, budget):
            value = payload(memo='Unicode é')
            budget.charge(123)
            return value, {'bytes': 123, 'sha256': 'b' * 64, 'seconds': .01}
        for stage in ('baseline', 'after'):
            result = M.collect([witness()], stage, time.monotonic() + 1, get)
            self.assertTrue(result['completeExpectedCorpusCoverage'])
            self.assertFalse(result['allExpectedRowsVerified'])
            self.assertEqual(result['rowsWithDiscrepancies'], 1)
            self.assertFalse(result['afterCutoverAccepted'])
            self.assertNotIn(ADDRESS, json.dumps(result))
            self.assertNotIn('Unicode é', json.dumps(result))

    def test_rpc_http_error_preserves_prefix_and_continues_other_actor(self):
        rows = [witness(actor=ADDRESS), witness(txid='b' * 64, actor=OTHER)]
        def get(address, deadline, budget):
            if address == ADDRESS:
                raise OSError('PRIVATE_BODY_SENTINEL')
            budget.charge(100)
            return payload([rows[1]], OTHER), {'bytes': 100, 'sha256': 'c' * 64, 'seconds': 0}
        result = M.collect(rows, 'after', time.monotonic() + 1, get)
        self.assertEqual(result['actorsAttempted'], 2)
        self.assertEqual(result['rowsChecked'], 1)
        self.assertFalse(result['completeExpectedCorpusCoverage'])
        self.assertNotIn('PRIVATE_BODY_SENTINEL', json.dumps(result))

    def test_signal_and_whole_deadline_do_not_claim_complete(self):
        def interrupted(*_):
            raise InterruptedError('fixture')
        self.assertRaises(InterruptedError, M.collect, [witness()], 'after', time.monotonic() + 1, interrupted)
        result = M.collect([witness()], 'after', time.monotonic() - 1)
        self.assertEqual(result['actorsAttempted'], 0)
        self.assertFalse(result['allExpectedRowsVerified'])

    def test_total_byte_cap_refuses_without_retry(self):
        calls = []
        def get(address, deadline, budget):
            calls.append(address)
            budget.charge(M.MAX_HTTP_TOTAL + 1)
            return payload(), {'bytes': M.MAX_HTTP_TOTAL + 1, 'sha256': 'b' * 64, 'seconds': .01}
        result = M.collect([witness()], 'after', time.monotonic() + 1, get)
        self.assertEqual(len(calls), 1)
        self.assertFalse(result['completeExpectedCorpusCoverage'])

    def real_http(self, code=200, raw=None, declared=None, encoding=None, delay=0,
                  budget=None, trickle_header=False, trickle_body=False):
        raw = encoded(payload()) if raw is None else raw
        calls = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                calls.append(self.path)
                if trickle_header:
                    wire = b'HTTP/1.1 200 OK\r\nX-Trickled: abcdefghijklmnopqrstuvwxyz\r\n'
                    try:
                        for byte in wire:
                            self.wfile.write(bytes([byte]))
                            self.wfile.flush()
                            time.sleep(.025)
                    except (BrokenPipeError, ConnectionResetError):
                        pass
                    return
                self.send_response(code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(raw) if declared is None else declared))
                if encoding:
                    self.send_header('Content-Encoding', encoding)
                if code == 302:
                    self.send_header('Location', 'http://private.invalid/never')
                self.end_headers()
                if delay:
                    time.sleep(delay)
                try:
                    if trickle_body:
                        for byte in raw:
                            self.wfile.write(bytes([byte]))
                            self.wfile.flush()
                            time.sleep(.025)
                    else:
                        self.wfile.write(raw)
                except (BrokenPipeError, ConnectionResetError):
                    pass
            def log_message(self, *args):
                pass
        server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        real_connection = http.client.HTTPConnection
        def connection(host, port, timeout):
            self.assertEqual((host, port), ('127.0.0.1', 8081))
            return real_connection(host, server.server_port, timeout=timeout)
        try:
            with patch.object(M.http.client, 'HTTPConnection', side_effect=connection):
                return M.get_mail(ADDRESS, time.monotonic() + 1, budget), calls
        finally:
            server.shutdown()
            server.server_close()
            thread.join(1)

    def test_real_http_fixed_origin_path_and_no_proxy_redirect(self):
        (value, transfer), calls = self.real_http()
        self.assertEqual(value['address'], ADDRESS)
        self.assertEqual(calls, ['/api/v1/address/' + ADDRESS + '/mail?fresh=1&network=livenet'])
        self.assertGreater(transfer['bytes'], 0)
        self.assertRaises(M.Refused, self.real_http, 302)

    def test_real_http_malformed_duplicate_json_and_encoding_refuse(self):
        for kwargs in ({'raw': b'{"x":1,"x":2}'}, {'encoding': 'gzip'},
                       {'declared': M.MAX_RESPONSE + 1}, {'declared': 999999}):
            with self.subTest(kwargs=kwargs):
                self.assertRaises((M.Refused, http.client.IncompleteRead), self.real_http, **kwargs)

    def test_real_http_absolute_response_deadline(self):
        with patch.object(M, 'REQUEST_SECONDS', .08):
            start = time.monotonic()
            self.assertRaises((M.Refused, TimeoutError, socket.timeout), self.real_http, delay=.2)
            self.assertLess(time.monotonic() - start, .6)

    def test_actual_trickled_header_and_body_absolute_timers(self):
        for kwargs in ({'trickle_header': True}, {'trickle_body': True}):
            with self.subTest(kwargs=kwargs), patch.object(M, 'REQUEST_SECONDS', .08):
                start = time.monotonic()
                with self.assertRaises(M.Refused) as caught:
                    self.real_http(**kwargs)
                self.assertEqual(str(caught.exception), 'ABSOLUTE_REQUEST_DEADLINE')
                self.assertLess(time.monotonic() - start, .65)

    def test_downloaded_invalid_json_is_charged_across_actors_and_stops_at_cap(self):
        calls = []
        budget_type = M.WireBudget
        actors = [ADDRESS, OTHER, '1' + 'C' * 25, '1' + 'D' * 25]
        witnesses = [witness(txid=format(i + 1, '064x'), actor=actor)
                     for i, actor in enumerate(actors)]
        def get(actor, deadline, budget):
            calls.append(actor)
            return self.real_http(raw=b'?' * 24, budget=budget)[0]
        with patch.object(M, 'WireBudget', side_effect=lambda: budget_type(50)):
            result = M.collect(witnesses, 'after', time.monotonic() + 10, get)
        self.assertEqual(len(calls), 3)
        self.assertEqual(result['responseBytes'], 51)
        self.assertEqual([a['receivedBodyBytes'] for a in result['actors']], [24, 24, 3])
        self.assertFalse(result['completeExpectedCorpusCoverage'])

    def test_wrong_framing_received_body_and_parse_failures_are_charged(self):
        for kwargs in ({'raw': b'not-json'}, {'raw': b'partial', 'declared': 100}):
            budget = M.WireBudget(1000)
            with self.subTest(kwargs=kwargs), self.assertRaises((M.Refused, ValueError, http.client.IncompleteRead)):
                self.real_http(budget=budget, **kwargs)
            self.assertEqual(budget.used, len(kwargs['raw']))

    def test_request_timer_restores_original_whole_deadline_without_extending_it(self):
        old_handler = signal.getsignal(signal.SIGALRM)
        old_timer = signal.getitimer(signal.ITIMER_REAL)
        def whole(*_):
            raise AssertionError('whole timer should not fire in this fixture')
        try:
            signal.signal(signal.SIGALRM, whole)
            signal.setitimer(signal.ITIMER_REAL, 1.5)
            with patch.object(M, 'REQUEST_SECONDS', .08), self.assertRaises(M.Refused):
                self.real_http(trickle_header=True)
            remaining, interval = signal.getitimer(signal.ITIMER_REAL)
            self.assertIs(signal.getsignal(signal.SIGALRM), whole)
            self.assertEqual(interval, 0)
            self.assertGreater(remaining, 0)
            self.assertLess(remaining, 1.45)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, old_handler)
            if old_timer[0]:
                signal.setitimer(signal.ITIMER_REAL, *old_timer)

    def test_runtime_families_order_qualification_and_weak_resource_refusal(self):
        request = {'stage': 'baseline', 'runId': '20261003T050000Z'}
        name = 'proofofwork-audit30-mail-api-baseline-20261003T050000Z.service'
        def show(unit, fields):
            self.assertEqual(unit, name)
            desired = dict(LoadState='loaded', Type='exec', Transient='yes', User='root', Group='root',
                           MainPID=str(M.os.getpid()), MemoryMax=str(512 * 1024**2), MemorySwapMax='0',
                           CPUQuotaPerSecUSec='250ms', TasksMax='16', RuntimeMaxUSec='11min',
                           NoNewPrivileges='yes', CapabilityBoundingSet='', AmbientCapabilities='',
                           ProtectSystem='strict', ProtectHome='yes', PrivateTmp='yes', PrivateDevices='yes',
                           PrivateIPC='yes', PrivateNetwork='no', RestrictAddressFamilies='AF_INET AF_UNIX',
                           ReadWritePaths='', InaccessiblePaths='/run/postgresql /var/lib/postgresql /data/bitcoin /etc/bitcoin /etc/proofofwork-api')
            return desired
        with patch.object(pathlib.Path, 'read_text', return_value='0::/system.slice/' + name), patch.object(M, 'show', side_effect=show):
            result = M.runtime(request)
            self.assertTrue(result['collectorOnlyResourceCaps'])
            self.assertFalse(result['backendResourceCapClaimed'])
            for key, value in [('MemoryMax', 'infinity'), ('User', 'postgres'), ('PrivateNetwork', 'yes'),
                               ('RestrictAddressFamilies', 'AF_UNIX AF_INET AF_INET6')]:
                row = show(name, ()) | {key: value}
                with patch.object(M, 'show', return_value=row):
                    self.assertRaises(M.Refused, M.runtime, request)

    def test_authority_symlink_wrong_mode_and_modified_bytes_refuse(self):
        with tempfile.TemporaryDirectory() as text:
            p = pathlib.Path(text) / 'proof'
            p.write_bytes(b'fixed')
            p.chmod(0o666)
            self.assertRaises(M.Refused, M.read_authority, p, M.sha(b'fixed'), 5, 0o600)
            link = pathlib.Path(text) / 'alias'
            link.symlink_to(p)
            self.assertRaises(M.Refused, M.read_authority, link, M.sha(b'fixed'), 5, 0o600)

    def test_exact_request_authority_and_unknown_fields_refuse(self):
        valid = {'schema': 'pow-audit30-mail-api-population-request-v1', 'approvalSha256': M.APPROVAL,
                 'stage': 'after', 'runId': '20261003T050000Z', 'sourceSha256': 'a' * 64,
                 'liveFive': {u: {'MainPID': '42', 'InvocationID': 'b' * 32} for u in M.LIVE}}
        self.assertEqual(M.request(valid), valid)
        for change in (valid | {'stage': 'write'}, valid | {'extra': 'http://other'},
                       valid | {'approvalSha256': 'e' * 64}, valid | {'runId': '20260230T010000Z'},
                       valid | {'liveFive': {}}):
            self.assertRaises((M.Refused, ValueError), M.request, change)


if __name__ == '__main__':
    unittest.main()
