#!/usr/bin/python3 -I
"""Refusal fixtures. Actual PostgreSQL acceptance is the private native run."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

path = Path(__file__).resolve().with_name('rehearse-pitr-mechanics.py')
spec = importlib.util.spec_from_file_location('pitr', path)
pitr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pitr)


def plan():
    run = '20261002T232000Z'
    return dict(schema=pitr.SCHEMA, approvalSha256=pitr.APPROVAL,
        sourceSha256='1'*64, guardSha256='2'*64,
        latestBackupReadReceiptSha256='3'*64, runId=run, host='pow-bitcoin-01',
        job='/data/proofofwork-audit30-pitr-mechanics-'+run,
        unit='proofofwork-audit30-pitr-mechanics-'+run+'.service',
        liveServices={s:dict(MainPID='42', InvocationID='4'*32) for s in pitr.SERVICES},
        backupWindow=dict(preflightAtUtc='2026-10-02T23:20:00+00:00',
                          nextScheduledAtUtc='2026-10-03T03:18:00+00:00'))


class RefusalTests(unittest.TestCase):
    def test_exact_scope_is_accepted_without_mutation(self):
        value=plan(); before=copy.deepcopy(value)
        self.assertEqual(pitr.validate_plan(value), before)
        self.assertEqual(value, before)

    def test_job_unit_host_authority_and_hash_substitution_refuse(self):
        substitutions=[('job','/var/lib/postgresql/16/main'),
            ('job','/data/proofofwork-audit30-pitr-mechanics-20261002T232000Z/../live'),
            ('unit','postgresql@16-main.service'),('host','pow-bitcoin-01;bad'),
            ('runId','20261099T232000Z'),('sourceSha256','f'*63),
            ('guardSha256','Z'*64),('approvalSha256','0'*64),
            ('latestBackupReadReceiptSha256','/tmp/foo')]
        for k,v in substitutions:
            with self.subTest(k=k,v=v):
                row=plan();row[k]=v
                with self.assertRaises(ValueError):pitr.validate_plan(row)

    def test_any_missing_or_additional_live_authority_refuses(self):
        for s in pitr.SERVICES:
            row=plan();del row['liveServices'][s]
            with self.subTest(service=s),self.assertRaises(ValueError):pitr.validate_plan(row)
        row=plan();row['liveServices']['pg_receivewal@16-main.service']=dict(MainPID='42',InvocationID='4'*32)
        with self.assertRaises(ValueError):pitr.validate_plan(row)

    def test_inactive_or_forged_pid_identity_refuses(self):
        for value in ('0','-1','42;bad'):
            row=plan();next(iter(row['liveServices'].values()))['MainPID']=value
            with self.subTest(value=value),self.assertRaises(ValueError):pitr.validate_plan(row)

    def test_non_utc_or_missing_window_refuses(self):
        for window in ({'preflightAtUtc':'2026-10-02T23:20:00','nextScheduledAtUtc':'2026-10-03T03:18:00+00:00'},
                       {'preflightAtUtc':'2026-10-02T23:20:00-04:00','nextScheduledAtUtc':'2026-10-03T03:18:00+00:00'},
                       {'preflightAtUtc':'2026-10-02T23:20:00+00:00'}):
            row=plan();row['backupWindow']=window
            with self.subTest(window=window),self.assertRaises(ValueError):pitr.validate_plan(row)

    def test_duplicate_json_authority_refuses(self):
        with self.assertRaises(ValueError):json.loads('{"job":"safe","job":"live"}',object_pairs_hook=pitr.unique_pairs)

    def test_symlink_and_parent_alias_source_refuse(self):
        with tempfile.TemporaryDirectory() as root:
            root=Path(root); source=root/'source';source.write_bytes(b'reviewed')
            alias=root/'alias';alias.symlink_to(source)
            for p in (alias,root/'folder'/'..'/'source'):
                with self.subTest(path=p),self.assertRaises((ValueError,FileNotFoundError)):pitr.raw_hash(p)

    def test_input_mutation_during_hash_is_detected(self):
        with tempfile.TemporaryDirectory() as root:
            source=Path(root)/'source';source.write_bytes(b'reviewed')
            original=Path.read_bytes
            def mutate(p):
                raw=original(p);p.write_bytes(b'unreviewed');return raw
            with patch.object(Path,'read_bytes',mutate),self.assertRaises(ValueError):pitr.raw_hash(source)

    def test_normal_reads_ignore_atime_but_bind_other_metadata(self):
        with tempfile.TemporaryDirectory() as root:
            source=Path(root)/'source';source.write_bytes(b'reviewed')
            digest,raw=pitr.raw_hash(source)
            self.assertEqual(raw,b'reviewed');self.assertEqual(len(digest),64)

    def test_config_live_paths_ports_and_command_injection_refuse(self):
        j=Path(plan()['job']);c=j/'source';s=j/'source-socket'
        bad=[(Path('/var/lib/postgresql/16/main'),s,55441,None),
             (c,Path('/run/postgresql'),55441,None),(c,s,5432,None),
             (j/'source'/'..'/'live',s,55441,None),
             (j/'recovered',j/'recovered-socket',55442,(Path('/tmp/wal'),'audit30_20261002T232000Z')),
             (j/'recovered',j/'recovered-socket',55442,(j/'wal',"bad'; DELETE"))]
        for args in bad:
            with self.subTest(args=args),self.assertRaises(ValueError):pitr.config(*args)

    def test_candidate_config_uses_unix_only_slot_cap_and_named_pause(self):
        j=Path(plan()['job']);text=pitr.config(j/'recovered',j/'recovered-socket',55442,(j/'wal','audit30_20261002T232000Z'))
        self.assertIn("listen_addresses = ''",text)
        self.assertIn("max_slot_wal_keep_size = '16GB'",text)
        self.assertIn("recovery_target_action = 'pause'",text)
        self.assertIn("archive_mode = off",text)
        self.assertNotIn('/run/postgresql',text)


if __name__=='__main__':unittest.main(verbosity=2)
