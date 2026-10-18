#!/usr/bin/python3
"""Inventory-sized journals: exact bytes, durable pairing and real deletion fences."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('journal_removal',Path(__file__).with_name('removal.py'))
W=importlib.util.module_from_spec(spec);spec.loader.exec_module(W);E=W.E


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.umask=os.umask(0o077);self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name)
        self.root=self.base/'source-"é';self.root.mkdir();self.file=self.root/('quote-"é-'+('a'*220));self.file.write_bytes(b'exact retained bytes')
        (self.root/'nested').mkdir();os.link(self.file,self.root/'nested'/'shared');(self.root/'link').symlink_to(self.file.name)
        self.inventory=E.inventory(self.root,os.geteuid(),require_manifest=False,allow_symlinks=True)
        self.expected=dict(self.inventory['fingerprint'],inventory=self.inventory['records'])
        self.log=self.base/'actions.jsonl'
    def tearDown(self):self.tmp.cleanup();os.umask(self.umask)
    def action(self,row=None):
        row=row or next(r for r in self.expected['inventory'] if r['kind']=='file')
        value=dict(root=self.expected['root'],path=row['path'],kind=row['kind'],before=dict(row['identity']))
        if row['kind']=='symlink':value['target']=row['target']
        else:value['sha256']=row.get('sha256')
        return value
    def journal(self):return W.Journal(self.log,expected_root=self.expected)
    def remove(self,journal,hook=None):
        fd=os.open(self.base,os.O_RDONLY|os.O_DIRECTORY|os.O_NOATIME)
        try:return W.delete_tree(fd,self.root.name,self.expected,journal,hook)
        finally:os.close(fd)
    def test_bound_matches_exact_worst_case_encoded_pairs(self):
        expected=0;wide=-(10**20-1);count=len(self.expected['inventory'])
        for row in self.expected['inventory']:
            action=self.action(row);action['before']={field:wide for field in E.STAT_FIELDS}
            expected+=len(E.encoded(dict(stage='intent',action=action,atUtc=W.JOURNAL_TIME)))
            expected+=len(E.encoded(dict(stage='completed',action=dict(action,ordinal=count),atUtc=W.JOURNAL_TIME)))
        self.assertEqual(W.journal_capacity_bound(self.expected),expected)
        self.assertLess(expected,W.MAX_JOURNAL_BYTES)
        self.assertEqual(len(str(wide)),21)
    def test_exact_worst_case_pair_fits_bound_without_extra_schema_fields(self):
        row=copy.deepcopy(next(r for r in self.expected['inventory'] if r['kind']=='file'));row['path']='one'
        row['identity']={field:-(10**20-1) for field in E.STAT_FIELDS}
        source=dict(self.expected,format='proofofwork-ui-retained-files-v1',entries=1,inventory=[row])
        action=dict(root=source['root'],path='one',kind='file',before=row['identity'],sha256=row['sha256'])
        journal=W.Journal(self.log,expected_root=source)
        try:
            with patch.object(W.time,'strftime',return_value=W.JOURNAL_TIME):
                journal('intent',action);self.assertGreater(journal.reserved,0);journal('completed',dict(action,ordinal=1))
            self.assertEqual(journal.bytes,journal.maximum);self.assertEqual(journal.bytes,W.journal_capacity_bound(source))
            self.assertEqual(self.log.stat().st_size,journal.maximum)
        finally:journal.close()
    def test_real_long_escaped_paths_symlinks_and_hardlinks_keep_old_schema(self):
        journal=self.journal()
        try:self.assertEqual(self.remove(journal),self.expected['entries']);self.assertIsNone(journal.pending);self.assertEqual(journal.reserved,0)
        finally:journal.close()
        raw=self.log.read_bytes();self.assertLessEqual(len(raw),W.journal_capacity_bound(self.expected));self.assertIn(b'\\"',raw);self.assertIn(b'\\u00e9',raw)
        rows=[json.loads(line) for line in raw.splitlines()];self.assertEqual(len(rows),2*self.expected['entries'])
        for n in range(self.expected['entries']):
            before,after=rows[2*n:2*n+2];self.assertEqual(set(before),{'stage','action','atUtc'});self.assertEqual(before['stage'],'intent');self.assertEqual(after['stage'],'completed')
            self.assertEqual(after['action'],dict(before['action'],ordinal=n+1));self.assertEqual(len(before['atUtc']),20)
        self.assertFalse(self.root.exists())
    def test_exact_file_group_journal_preserves_parent_and_other_members(self):
        selected=self.root/'selected.tgz';selected.write_bytes(b'closed archive bytes')
        inventory=E.inventory_file_group(selected,[selected.name],os.geteuid());source=dict(inventory['fingerprint'],inventory=inventory['records'],parent=inventory['parent'])
        journal=W.Journal(self.log,expected_root=source);fd=os.open(self.root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOATIME)
        try:self.assertEqual(W.delete_file_group(fd,source,journal),1)
        finally:os.close(fd);journal.close()
        self.assertFalse(selected.exists());self.assertTrue(self.file.exists());self.assertTrue(self.root.is_dir())
        self.assertLessEqual(self.log.stat().st_size,W.journal_capacity_bound(source))
    def test_pair_is_reserved_before_any_intent_or_unlink(self):
        journal=self.journal();action=self.action()
        # There is room for a single row, but never for its completion.
        journal.maximum=len(E.encoded(dict(stage='intent',action=action,atUtc=W.JOURNAL_TIME)))
        try:
            with self.assertRaisesRegex(ValueError,'pair exceeds'):journal('intent',action)
            self.assertEqual(self.log.stat().st_size,0);self.assertTrue(self.file.exists())
            with self.assertRaisesRegex(ValueError,'pair exceeds'):self.remove(journal)
            self.assertEqual(self.log.stat().st_size,0);self.assertTrue(self.file.exists());self.assertTrue((self.root/'link').is_symlink())
        finally:journal.close()
    def test_pending_pair_blocks_other_intents_and_wrong_completions(self):
        journal=self.journal();action=self.action()
        try:
            journal('intent',action);size=self.log.stat().st_size
            for stage,value in [('intent',action),('completed',dict(action,ordinal=2)),('completed',dict(action,ordinal=True)),('completed',dict(action,ordinal=1,extra='unreserved'))]:
                with self.subTest(stage=stage,value=value),self.assertRaises(ValueError):journal(stage,value)
                self.assertEqual(self.log.stat().st_size,size)
            journal('completed',dict(action,ordinal=1))
            with self.assertRaisesRegex(ValueError,'duplicate'):journal('intent',action)
            with self.assertRaises(ValueError):journal('completed',dict(action,ordinal=1))
        finally:journal.close()
    def test_caller_cannot_mutate_reserved_action(self):
        journal=self.journal();action=self.action();original=copy.deepcopy(action)
        try:
            journal('intent',action);action['before']['st_ctime_ns']+=1
            with self.assertRaisesRegex(ValueError,'differs from reserved'):journal('completed',dict(action,ordinal=1))
            journal('completed',dict(original,ordinal=1));self.assertEqual(journal.count,1)
        finally:journal.close()
    def test_unknown_member_extra_fields_hash_target_and_kind_refuse_before_write(self):
        journal=self.journal();action=self.action()
        variants=[dict(action,path='unknown'),dict(action,extra='bytes'),dict(action,sha256='f'*64),dict(action,kind='directory'),dict(action,root='/different')]
        link=self.action(next(r for r in self.expected['inventory'] if r['kind']=='symlink'));variants.append(dict(link,target='different'))
        try:
            for value in variants:
                with self.subTest(value=value),self.assertRaises(ValueError):journal('intent',value)
            self.assertEqual(self.log.stat().st_size,0);self.assertTrue(self.file.exists())
        finally:journal.close()
    def test_stat_width_type_and_fields_refuse_before_write(self):
        journal=self.journal();action=self.action()
        try:
            for value in (10**21,-10**20,True,1.5,'123'):
                changed=copy.deepcopy(action);changed['before']['st_ctime_ns']=value
                with self.subTest(value=value),self.assertRaisesRegex(ValueError,'integer'):journal('intent',changed)
            changed=copy.deepcopy(action);changed['before']['extra']=1
            with self.assertRaisesRegex(ValueError,'identity fields'):journal('intent',changed)
            self.assertEqual(self.log.stat().st_size,0);self.assertTrue(self.file.exists())
        finally:journal.close()
    def test_timestamp_and_stage_refuse_before_write(self):
        journal=self.journal();action=self.action()
        try:
            with patch.object(W.time,'strftime',return_value='10000-01-01T00:00:00Z'):
                with self.assertRaisesRegex(ValueError,'timestamp'):journal('intent',action)
            with self.assertRaisesRegex(ValueError,'stage'):journal('other',action)
            self.assertEqual(self.log.stat().st_size,0)
        finally:journal.close()
    def test_duplicate_inventory_oversize_and_invalid_integers_refuse_before_create(self):
        duplicate=copy.deepcopy(self.expected);duplicate['inventory'].append(duplicate['inventory'][0]);duplicate['entries']+=1
        huge=copy.deepcopy(self.expected);huge['root']='/'+'a'*W.MAX_JOURNAL_BYTES
        malformed=copy.deepcopy(self.expected);malformed['inventory'][0]['identity']['st_ino']=10**21
        for source in (duplicate,huge,malformed):
            with self.subTest(source=source['entries']),self.assertRaises(ValueError):W.Journal(self.log,expected_root=source)
            self.assertFalse(self.log.exists());self.assertTrue(self.file.exists())
    def test_legacy_journal_callers_and_records_remain_compatible(self):
        journal=W.Journal(self.log)
        try:
            self.assertEqual(journal.maximum,16*1024**2);action=self.action();journal('intent',action);journal('completed',dict(action,ordinal=1))
        finally:journal.close()
        rows=[json.loads(line) for line in self.log.read_bytes().splitlines()]
        self.assertEqual(rows[1]['action'],dict(rows[0]['action'],ordinal=1));self.assertEqual(set(rows[0]),{'stage','action','atUtc'})


if __name__=='__main__':unittest.main()
