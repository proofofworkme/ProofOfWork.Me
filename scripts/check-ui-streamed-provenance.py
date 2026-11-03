#!/usr/bin/env python3
"""Exercise the installed provenance script's diskless archive reader."""
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'deploy/proofofwork-ui-release-provenance.sh').read_text()
READER = SOURCE.split("<<'PY_ARCHIVE'\n", 1)[1].split('\nPY_ARCHIVE\n', 1)[0]
ASSET = 'assets/' + 'a'*135 + '.js'
FILE = 'surfaces/computer/' + ASSET
INDEX = b'<script src="/' + ASSET.encode() + b'"></script>'
sha = lambda data: hashlib.sha256(data).hexdigest()


def info(path, mode, kind=tarfile.REGTYPE, size=0):
    item = tarfile.TarInfo(path)
    item.mode, item.type, item.size = mode, kind, size
    return item


def encode(rows, format=tarfile.GNU_FORMAT):
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode='w', format=format) as archive:
        for member, data in rows:
            archive.addfile(member, io.BytesIO(data))
    return raw.getvalue()


def invoke(path, digest, expected, env=None):
    fields = [value for surface, (count, tree) in expected.items() for value in (surface, str(count), tree)]
    return subprocess.run([sys.executable, '-IB', '-c', READER, str(path), digest, *fields],
                          capture_output=True, text=True, timeout=150, env=env)


class ArchiveStream(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name) / 'candidate.tgz'
        self.rows = [(info('surfaces/', 0o755, tarfile.DIRTYPE), b''),
                     (info('surfaces/computer/', 0o755, tarfile.DIRTYPE), b''),
                     (info('surfaces/computer/assets/', 0o755, tarfile.DIRTYPE), b''),
                     (info('surfaces/computer/index.html', 0o644, size=len(INDEX)), INDEX),
                     (info(FILE, 0o644, size=2), b'ok')]
        self.expected = {'computer': (2, sha(b''.join(
            name.encode() + b'\0' + b'644\0' + sha(data).encode() + b'\n'
            for name, data in [(ASSET, b'ok'), ('index.html', INDEX)])))}

    def run_blob(self, compressed, *, valid=False, expected=None, digest=None, env=None):
        self.path.write_bytes(compressed)
        self.path.chmod(0o600)
        result = invoke(self.path, digest or sha(compressed), expected or self.expected, env)
        self.assertEqual(result.returncode == 0, valid, result.stderr)
        self.assertEqual(list(self.path.parent.iterdir()), [self.path], 'Verifier wrote an extracted file or temporary inventory')

    def check(self, rows, **kwargs):
        self.run_blob(gzip.compress(encode(rows)), **kwargs)

    def test_positive_gnu_pax_and_old_alias(self):
        for style in (tarfile.GNU_FORMAT, tarfile.PAX_FORMAT, tarfile.USTAR_FORMAT):
            with self.subTest(style=style):
                if style == tarfile.USTAR_FORMAT:
                    # POSIX prefix + basename layout with a long overall path.
                    asset = 'assets/' + 'a'*65 + '/' + 'b'*60 + '.js'
                    html = ('<script src="/' + asset + '"></script>').encode()
                    rows = self.rows[:3] + [(info('surfaces/computer/'+asset.rsplit('/',1)[0], 0o755, tarfile.DIRTYPE), b''),
                        (info('surfaces/computer/index.html', 0o644, size=len(html)), html),
                        (info('surfaces/computer/'+asset, 0o644, size=2), b'ok')]
                    expected = {'computer': (2, sha(asset.encode()+b'\x00644\0'+sha(b'ok').encode()+b'\nindex.html\x00644\0'+sha(html).encode()+b'\n'))}
                else:
                    rows, expected = self.rows, self.expected
                self.run_blob(gzip.compress(encode(rows, style)), valid=True, expected=expected)

    def test_namespace_mode_content_and_count(self):
        cases = [
            self.rows + [(info('unmanaged/', 0o755, tarfile.DIRTYPE), b'')],
            self.rows + [(info('surfaces/permission/index.html', 0o644), b'')],
            self.rows + [(info(FILE, 0o644), b'')],
            self.rows + [(info('surfaces/computer/assets', 0o644), b'')],
            self.rows + [(info('surfaces/computer/index.html/child', 0o644), b'')],
            self.rows[:3] + [(info('surfaces/computer/index.html', 0o664, size=len(INDEX)), INDEX), self.rows[-1]],
            self.rows[:2] + [(info('surfaces/computer/assets', 0o740, tarfile.DIRTYPE), b'')] + self.rows[3:],
            self.rows[:-1] + [(info(FILE, 0o744, size=2), b'ok')],
            self.rows[:-1] + [(info(FILE, 0o644, size=2), b'no')],
            self.rows + [(info('surfaces/computer/else', 0o644), b'')],
        ]
        for i, rows in enumerate(cases):
            with self.subTest(case=i):
                self.check(rows)

    def test_missing_index_reference_even_when_expected_digest_matches(self):
        tree = sha(b'index.html\x00644\0' + sha(INDEX).encode() + b'\n')
        self.check(self.rows[:-1], expected={'computer': (1,tree)})

    def test_unsafe_names_types_and_limits(self):
        for name in ('/escape', 'surfaces//computer/a', 'surfaces/computer/../a',
                     'surfaces/computer/./a', 'surfaces/computer/a\\b', 'surfaces/computer/a\nb'):
            self.check(self.rows + [(info(name, 0o644), b'')])
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE, tarfile.CHRTYPE, tarfile.GNUTYPE_SPARSE):
            self.check(self.rows + [(info('surfaces/computer/special', 0o644, kind), b'')])
        for count in (1024**3+1, 2*1024**2+1):
            name = 'surfaces/computer/large' if count > 2**30 else 'surfaces/computer/index.html'
            self.run_blob(gzip.compress(info(name, 0o644, size=count).tobuf() + bytes(1024)))
        dirs = [(info(f'surfaces/computer/d{i}', 0o755, tarfile.DIRTYPE), b'') for i in range(10_001)]
        self.check(self.rows + dirs)

    def test_posix_overrides_and_trailers(self):
        for attributes in ({'path': 'surfaces/computer/../escape'}, {'GNU.sparse.major': '1'},
                           {'size': '10000000'}, {'SCHILY.xattr.security.capability': 'x'}):
            rows = self.rows[:]
            changed = info('surfaces/computer/extra', 0o644, size=1)
            changed.pax_headers = attributes
            self.run_blob(gzip.compress(encode([*rows, (changed, b'x')], tarfile.PAX_FORMAT)))
        raw = encode(self.rows)
        self.run_blob(gzip.compress(raw + b'nonzero trailer'))
        self.run_blob(gzip.compress(raw)[:-3])
        self.run_blob(gzip.compress(raw), digest='0'*64)
        self.run_blob(gzip.compress(raw[:-1].rstrip(b'\x00')))
        self.check(self.rows, env={**os.environ, 'POW_UI_TEST_FAIL_ARCHIVE_TOP_LEVEL_DISCOVERY_AFTER_OUTPUT':'1'})


if __name__ == '__main__':
    unittest.main()
