#!/usr/bin/env python3
"""Exercise the deployed Caddy routes without changing production.

Usage: python3 scripts/check-seo-caddy.py --caddy /path/to/caddy
The executable must support the repository Caddyfile (production uses 2.6.2).
Fixtures are temporary; the server listens only on loopback with TLS/admin off.
API/health proxies are inspected but never called.
"""
import argparse
import http.client
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
HOSTS = {
    'www': 'landing', 'id': 'id', 'dns': 'dns', 'computer': 'computer',
    'desktop': 'desktop', 'browser': 'browser', 'pages': 'pages',
    'permission': 'permission', 'boost': 'boost', 'publish': 'publish',
    'search': 'search', 'code': 'code', 'jobs': 'jobs', 'amo': 'marketplace',
    'growth': 'growth', 'log': 'activity', 'credit': 'token', 'wallet': 'wallet',
    'work': 'work', 'infinity': 'infinity', 'inception': 'inception',
}
TXID = '0123456789abcdef' * 4


def rewrite_fixture(value, base):
    if isinstance(value, dict):
        for key, child in list(value.items()):
            if key == 'root' and isinstance(child, str) and child.startswith('/var/www/proofofwork-'):
                value[key] = str(base / Path(child).name)
            elif key == 'filename' and child == '/var/log/caddy/access.json':
                value[key] = str(base / 'access.json')
            else:
                rewrite_fixture(child, base)
    elif isinstance(value, list):
        for child in value:
            rewrite_fixture(child, base)


def request(port, host, path):
    client = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
    client.request('GET', path, headers={'Host': host + '.proofofwork.me'})
    response = client.getresponse()
    result = response.status, dict(response.getheaders()), response.read().decode()
    client.close()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--caddy', required=True, type=Path)
    args = parser.parse_args()
    caddy = str(args.caddy.resolve(strict=True))
    adapted = subprocess.run([caddy, 'adapt', '--config', str(ROOT / 'deploy/Caddyfile'),
        '--adapter', 'caddyfile'], capture_output=True, text=True, check=True)
    config = json.loads(adapted.stdout)
    assert '{args' not in adapted.stdout, 'Caddy snippet arguments were not expanded'
    with tempfile.TemporaryDirectory(prefix='pow-seo-caddy-') as temporary:
        base = Path(temporary)
        for surface in HOSTS.values():
            path = base / ('proofofwork-' + surface)
            path.mkdir()
            for name, content in {
                'index.html': 'INDEX ' + surface,
                'app.html': 'APP ' + surface,
                'noindex-app.html': 'PRIVATE ' + surface,
                '404.html': 'NOT FOUND',
                'pages-runner.html': 'RUNNER',
                'robots.txt': 'User-agent: *\nAllow: /\n',
                'sitemap.xml': '<urlset/>',
                'source-provenance.json': '{"clean":true}',
            }.items():
                (path / name).write_text(content)
            (path / 'assets').mkdir()
            (path / 'assets/test-0123456789.js').write_text('ASSET')
            (path / 'brand').mkdir()
            (path / 'brand/logo.svg').write_text('<svg/>')
        rewrite_fixture(config, base)
        config['admin'] = {'disabled': True}
        server = config['apps']['http']['servers']['srv0']
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        server['listen'] = [f'127.0.0.1:{port}']
        server['automatic_https'] = {'disable': True}
        server.pop('tls_connection_policies', None)
        config['apps']['http']['servers'] = {'test': server}
        config['apps'].pop('tls', None)
        config_path = base / 'caddy.json'
        config_path.write_text(json.dumps(config))
        result = subprocess.run([caddy, 'validate', '--config', str(config_path)],
            capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        checks = 0
        with (base / 'server.log').open('w+') as log:
            process = subprocess.Popen([caddy, 'run', '--config', str(config_path)],
                stdout=log, stderr=log)
            try:
                for _ in range(100):
                    if process.poll() is not None:
                        log.seek(0)
                        raise AssertionError(log.read())
                    try:
                        request(port, 'www', '/')
                        break
                    except OSError:
                        time.sleep(.05)
                else:
                    raise AssertionError('Caddy did not begin listening')

                def check(host, path, status=200, body=None, robots=None, location=None, content_type=None):
                    nonlocal checks
                    code, headers, actual = request(port, host, path)
                    context = f'{host} {path}: {code} {headers} {actual}'
                    assert code == status, context
                    if body is not None:
                        assert actual == body, context
                    assert headers.get('X-Robots-Tag') == robots, context
                    if location is not None:
                        assert headers.get('Location') == location, context
                    if content_type:
                        assert headers.get('Content-Type', '').startswith(content_type), context
                    checks += 1
                    return headers

                for host, surface in HOSTS.items():
                    check(host, '/', body='INDEX ' + surface)
                    check(host, '/?utm_source=release', body='APP ' + surface)
                    check(host, '/?network=livenet', body='APP ' + surface)
                    check(host, '/?network=testnet', body='PRIVATE ' + surface, robots='noindex, nofollow')
                    check(host, '/?q=query', body='PRIVATE ' + surface, robots='noindex, nofollow')
                    check(host, '/?folder=pages', body='PRIVATE ' + surface, robots='noindex, nofollow')
                    check(host, '/?network=livenet&network=livenet', body='PRIVATE ' + surface, robots='noindex, nofollow')
                    check(host, '/robots.txt', body='User-agent: *\nAllow: /\n', content_type='text/plain')
                    check(host, '/sitemap.xml', body='<urlset/>', content_type='text/xml')
                    check(host, '/source-provenance.json', body='{"clean":true}', content_type='application/json')
                    asset_headers = check(host, '/assets/test-0123456789.js', body='ASSET')
                    assert 'immutable' in asset_headers.get('Cache-Control', ''), asset_headers
                    check(host, '/brand/logo.svg', body='<svg/>')
                    for path in ['/does-not-exist', '/missing.js', '/assets/missing.js', '/write/extra']:
                        check(host, path, status=404)
                    for path in ['/app.html', '/noindex-app.html', '/404.html']:
                        check(host, path, robots='noindex, nofollow')
                    check(host, '/index.html', body='INDEX ' + surface)
                    check(host, '/index.html?network=testnet', body='PRIVATE ' + surface, robots='noindex, nofollow')
                    runner_headers = check(host, '/pages-runner.html', body='RUNNER', robots='noindex, nofollow')
                    assert 'sandbox allow-scripts' in runner_headers.get('Content-Security-Policy', ''), runner_headers
                    assert runner_headers.get('X-Frame-Options') == 'SAMEORIGIN', runner_headers

                for path in ['/write', '/write/']:
                    check('publish', path, body='PRIVATE publish', robots='noindex, nofollow')
                    check('www', path, status=404)
                for path in ['/tx/' + TXID, '/TX/' + TXID.upper(), '/' + TXID,
                    '/name/example.pow', '/name/child.example.pow/', '/Example.POW', '/child.example.pow']:
                    check('browser', path, body='APP browser')
                    check('browser', path + '?network=testnet', body='PRIVATE browser', robots='noindex, nofollow')
                    check('www', path, status=404)
                for path in ['/tx/no', '/name/-bad.pow', '/name/grand.child.example.pow', '/name/example.pow/extra']:
                    check('browser', path, status=404)
                for host, query in [('publish','article='+TXID), ('publish','profile=alice'),
                    ('boost','profile=alice'), ('code','repo='+TXID+'&version='+TXID+'&path=index.html'),
                    ('jobs','job='+TXID), ('browser','txid='+TXID), ('browser','name=child.example.pow'),
                    ('credit','asset='+TXID)]:
                    check(host, '/?'+query, body='APP '+HOSTS[host])
                    check(host, '/?'+query+'&mode=edit', body='PRIVATE '+HOSTS[host], robots='noindex, nofollow')
                check('publish', '/?article='+TXID+'&article='+TXID, body='PRIVATE publish', robots='noindex, nofollow')
                bridge = check('computer', '/?social-identity-bridge=1', body='PRIVATE computer', robots='noindex, nofollow')
                assert 'X-Frame-Options' not in bridge, bridge
                assert 'frame-ancestors https://boost.proofofwork.me' in bridge['Content-Security-Policy'], bridge
                check('marketplace', '/?tab=dns', status=308, location='https://amo.proofofwork.me/?tab=dns')
                check('token', '/?asset='+TXID, status=301, location='https://credit.proofofwork.me/?asset='+TXID)
                check('domain', '/?name=example', status=308, location='https://dns.proofofwork.me/?name=example')
                # Match the shared browser/build policy for generated routes, duplicate
                # keys and normal encoded values. Caddy sees raw query bytes, so
                # deliberately over-encoded semantic keys/hex are conservatively
                # excluded at the edge; canonical links never generate those forms.
                corpus = [(host, path) for host in HOSTS for path in (
                    '/', '/index.html', '/?utm_source=release%20note',
                    '/?network=livenet', '/?network=testnet', '/?folder=pages',
                    '/?q=proof%20work', '/?%71=proof', '/?mode=edit',
                    '/?network=livenet&network=livenet', '/unknown?network=livenet')]
                corpus += [
                    ('publish', '/?article='+TXID),
                    ('publish', '/index.html?article='+TXID),
                    ('publish', '/?article='+TXID+'&profile=alice'),
                    ('publish', '/?profile=alice%20smith'),
                    ('publish', '/write/'),
                    ('boost', '/?profile=alice%40proofofwork.me'),
                    ('boost', '/?profile=alice&profile=bob'),
                    ('code', '/?repo='+TXID+'&version='+TXID+'&path=src%2Findex.html'),
                    ('code', '/?path=src%2Findex.html'),
                    ('code', '/?repo=invalid'),
                    ('jobs', '/?job='+TXID),
                    ('credit', '/?asset='+TXID),
                    ('browser', '/tx/'+TXID),
                    ('browser', '/name/child.example.pow/'),
                    ('browser', '/?name=child.example.pow'),
                    ('browser', '/?txid='+TXID+'&tx='+TXID),
                    ('browser', '/?txid='+TXID+'&utm_source=share'),
                    ('browser', '/tx/'+TXID+'?network=testnet'),
                    ('browser', '/name/grand.child.example.pow'),
                ]
                surface_names = {'id': 'id-launch', 'dns': 'dns-launch', 'activity': 'log'}
                inputs = [{'surface': surface_names.get(HOSTS[h], HOSTS[h]),
                    'url': 'https://'+h+'.proofofwork.me'+p} for h, p in corpus]
                policy_script = """
import { readFileSync } from 'node:fs';
import { resolveDocumentVariant } from './src/app/seoMetadata.mjs';
const inputs = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(inputs.map(({surface,url}) => resolveDocumentVariant(surface,url))));
"""
                policies = json.loads(subprocess.run(['node', '--input-type=module', '-e', policy_script],
                    input=json.dumps(inputs), capture_output=True, text=True, cwd=ROOT, check=True).stdout)
                for (host, path), variant in zip(corpus, policies, strict=True):
                    if variant == 'not-found':
                        check(host, path, status=404)
                    else:
                        prefix = {'root': 'INDEX ', 'app': 'APP ', 'noindex': 'PRIVATE '}[variant]
                        check(host, path, body=prefix+HOSTS[host],
                            robots='noindex, nofollow' if variant == 'noindex' else None)
                print(f'SEO Caddy integration passed: {checks} HTTP assertions across {len(HOSTS)} public roots; {len(corpus)} catalog parity cases.')
            finally:
                process.terminate()
                process.wait(timeout=10)


if __name__ == '__main__':
    main()
