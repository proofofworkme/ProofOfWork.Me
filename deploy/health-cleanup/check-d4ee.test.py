#!/usr/bin/python3 -I
"""Exact-tree cleanup qualification/refusal tests; no production operations."""
import ast
import copy
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import time
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('d4ee_test',HERE/'d4ee_trees.py')
M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)

class Tests(unittest.TestCase):
    def row(self,name='.',kind='directory',ino=1,links=2):
        return {'path':name,'kind':kind,'xattrs':[],
                'identity':dict(st_dev=1,st_ino=ino,st_mode=(stat.S_IFDIR if kind=='directory' else stat.S_IFREG)|0o700,
                  st_nlink=links,st_uid=0,st_gid=0,st_size=4096,st_blocks=8,st_blksize=4096,
                  st_atime_ns=1,st_mtime_ns=2,st_ctime_ns=3),
                **({'sha256':'a'*64} if kind=='file' else {})}
    def manifest(self):
        trees={}
        for role,path in M.TREES.items():
            rows=[self.row(),self.row('a','file',2,2),self.row('b','file',2,2)]
            trees[role]={'fingerprint':{'root':str(path),'format':'proofofwork-ui-retained-root-v1','entries':3},'records':rows}
        return {'schema':'pow-d4ee-ui-recovery-manifest-v1','host':'77.42.91.106',
                'stateSha256':M.STATE_SHA,'configSha256':M.CONFIG_SHA,
                'inventoryHelperSha256':M.PINS['ui-retention/inventory.py'],'trees':trees}
    def proof(self):
        return {'schema':'pow-d4ee-ui-recovery-proof-v1','ok':True,'manifestSha256':M.MANIFEST_SHA,
          'custodyRoot':M.CUSTODY_ROOT,'inventoryHelperSha256':M.PINS['ui-retention/inventory.py'],
          'archiveCustodySha256':'ccd4e1298fb4639f584ae2253f4aae258faa31aa27cabd6e35b5c703e3075a26','originalInodesRestorable':False,'originalCtimeRestorable':False,
          'restoredMetadata':['content','type','mode','uid','gid','mtimeNs','atimeNs','xattrs','symlinkTarget','internalHardlinkTopology'],
          'cleanupReview':{'durableRootUnderTmpfilesRule':False},
          'archives':{r:{'path':M.CUSTODY_ROOT+'/retained-d4ee-'+r+'.tgz','sha256':h} for r,h in M.ARCHIVES.items()},
          'restored':{r:{'path':M.CUSTODY_ROOT+'/restored-'+r,'entries':M.COUNTS[r],'ok':True,'externalHardlinks':False,'allocatedBytesOriginal':M.ALLOCATED[r],
                         'verification':{'internalHardlinksRestored':True,'modeTimesXattrsRestored':True,'ownerRestored':True}} for r in M.TREES}}
    def test_closed_allocation_counts_internal_links_once(self):
        rows=[self.row(),self.row('a','file',2,2),self.row('b','file',2,2)]
        self.assertEqual(M.closed_allocation(rows),8192)
        rows[1]['identity']['st_nlink']=3;rows[2]['identity']['st_nlink']=3
        with self.assertRaisesRegex(ValueError,'external hardlinks'):M.closed_allocation(rows)
    def test_inconsistent_hardlink_content_or_attributes_refuse(self):
        rows=[self.row('a','file',2,2),self.row('b','file',2,2)]
        for field,value in [('sha256','b'*64),('xattrs',[['user.x','61']])]:
            bad=copy.deepcopy(rows);bad[1][field]=value
            with self.assertRaises(ValueError):M.closed_allocation(bad)
    def test_manifest_requires_exact_roots_roles_counts_and_allocation(self):
        with patch.object(M,'COUNTS',{'source':3,'surfaces':3}),patch.object(M,'ALLOCATED',{'source':8192,'surfaces':8192}):
            value=self.manifest();M.validate_manifest(value)
            for key,bad in [('schema','bad'),('host','other'),('stateSha256','0'*64),('configSha256','0'*64),('inventoryHelperSha256','0'*64)]:
                altered=copy.deepcopy(value);altered[key]=bad
                with self.subTest(key=key),self.assertRaises(ValueError):M.validate_manifest(altered)
            for change in ('root','count','allocation','duplicate','escape','parent','role'):
                altered=copy.deepcopy(value);tree=altered['trees']['source']
                if change=='root':tree['fingerprint']['root']='/var/www'
                if change=='count':tree['fingerprint']['entries']=4
                if change=='allocation':tree['records'][0]['identity']['st_blocks']=9
                if change=='duplicate':tree['records'][2]['path']='a'
                if change=='escape':tree['records'][2]['path']='../b'
                if change=='parent':tree['records'][2]['path']='missing/b'
                if change=='role':altered['trees']['other']=tree
                with self.subTest(change=change),self.assertRaises(ValueError):M.validate_manifest(altered)
    def test_recovery_requires_exact_durable_paths_and_full_metadata(self):
        proof=self.proof();M.validate_proof(proof)
        for key,bad in [('schema','bad'),('ok',False),('manifestSha256','0'*64),('custodyRoot','/tmp'),
                        ('originalInodesRestorable',True),('originalCtimeRestorable',True),
                        ('restoredMetadata',['content']),('cleanupReview',{}),('inventoryHelperSha256','0'*64),('archiveCustodySha256','0'*64)]:
            altered=copy.deepcopy(proof);altered[key]=bad
            with self.subTest(key=key),self.assertRaises(ValueError):M.validate_proof(altered)
        for field,value in [('path','/tmp/archive.tgz'),('sha256','0'*64)]:
            bad=copy.deepcopy(proof);bad['archives']['source'][field]=value
            with self.assertRaises(ValueError):M.validate_proof(bad)
        for field,value in [('path','/tmp/restore'),('entries',0),('ok',False),('externalHardlinks',True),('allocatedBytesOriginal',0),('verification',{})]:
            bad=copy.deepcopy(proof);bad['restored']['surfaces'][field]=value
            with self.assertRaises(ValueError):M.validate_proof(bad)
    def test_initial_research_allows_only_observational_atime_difference(self):
        row=self.row('file','file',2,1);actual=copy.deepcopy(row)
        actual['identity']['st_atime_ns']=999;M.match_record(actual,row)
        for field in row['identity']:
            if field=='st_atime_ns':continue
            altered=copy.deepcopy(row);altered['identity'][field]+=1
            with self.subTest(field=field),self.assertRaises(ValueError):M.match_record(altered,row)
        altered=copy.deepcopy(row);altered['sha256']='b'*64
        with self.assertRaises(ValueError):M.match_record(altered,row)
        symlink={'path':'link','kind':'symlink','target':'a','xattrs':[],'identity':row['identity']}
        with self.assertRaises(ValueError):M.match_record({**symlink,'target':'b'},symlink)
    def test_scope_refuses_extra_or_reordered_roots_and_changed_writer(self):
        with patch.object(M,'COUNTS',{'source':3,'surfaces':3}),patch.object(M,'ALLOCATED',{'source':8192,'surfaces':8192}):
            approved=self.manifest()['trees']
            records=[{**v['fingerprint'],'inventory':v['records'],'retainedParent':{'path':str(M.SCRATCH)}} for v in approved.values()]
            plan={'format':M.FORMAT,'controllerSha256':M.digest((HERE/'d4ee_trees.py').read_bytes()),
                  'helpers':M.PINS,'manifestSha256':M.MANIFEST_SHA,'proofSha256':M.PROOF_SHA,'trees':records}
            M.exact_scope(plan,approved)
            for field,value in [('format','bad'),('controllerSha256','0'*64),('helpers',{}),('manifestSha256','0'*64),('proofSha256','0'*64),
                                ('trees',records[::-1]),('trees',records+[records[0]])]:
                changed=copy.deepcopy(plan);changed[field]=value
                with self.subTest(field=field),self.assertRaises(ValueError):M.exact_scope(changed,approved)
    def test_extensionless_installed_helper_load(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'extensionless-helper';path.write_text('VALUE = 42\n')
            module=M.load_module('d4ee_extensionless_fixture',path)
            self.assertEqual(module.VALUE,42)
    def test_source_uses_installed_helpers_not_candidate_source(self):
        for name,value in M.PINS.items():self.assertEqual(M.digest((M.ROOT/'deploy'/name).read_bytes()),value)
        source=(HERE/'d4ee_trees.py').read_text()
        helpers=ast.get_source_segment(source,next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='helpers'))
        self.assertIn("PACKAGE / 'deploy'",helpers);self.assertNotIn("ROOT /",helpers)
        self.assertNotIn('shutil.rmtree',source)
    def test_lifecycle_config_change_refuses_before_dispatch(self):
        class E:
            @staticmethod
            def read_regular(path,*args):return b'changed',None
        with self.assertRaisesRegex(ValueError,'configuration changed'):M.lifecycle(E,7)
    def test_apply_prior_journal_refuses_without_removal(self):
        plan={'manifestPath':str(M.EVIDENCE/'manifest.json'),'proofPath':str(M.EVIDENCE/'recovery-proof.json'),
              'createdAtUnix':time.time(),'guards':{}}
        args=type('Args',(),{'sha256':'a'*64})()
        with patch.object(M,'pinned_json',return_value=(plan,b'')),patch.object(M,'authority',return_value={}),\
             patch.object(M,'exact_scope'),patch.object(M.os.path,'lexists',return_value=True),patch.object(M,'qualify') as qualify:
            with self.assertRaisesRegex(ValueError,'Prior attempt'):M.apply_command(args,None,None,None,1)
            qualify.assert_not_called()
    def test_apply_expired_plan_refuses_before_intent(self):
        plan={'manifestPath':str(M.EVIDENCE/'manifest.json'),'proofPath':str(M.EVIDENCE/'recovery-proof.json'),'createdAtUnix':0}
        args=type('Args',(),{'sha256':'a'*64})()
        with patch.object(M,'pinned_json',return_value=(plan,b'')),patch.object(M,'authority',return_value={}),patch.object(M,'exact_scope'):
            with self.assertRaisesRegex(ValueError,'expired'):M.apply_command(args,None,None,None,1)
    def test_native_two_tree_hardlink_symlink_deletion_preserves_sibling(self):
        R=M.load_module('d4ee_native_test',M.ROOT/'deploy/ui-retention/removal.py');E=R.E
        with tempfile.TemporaryDirectory() as temp:
            parent=Path(temp);keep=parent/'keep';keep.write_bytes(b'kept')
            for name in ('one','two'):
                tree=parent/name;tree.mkdir(mode=0o700)
                (tree/'a').write_bytes(b'payload');(tree/'a').chmod(0o600);os.link(tree/'a',tree/'b');os.symlink('a',tree/'link')
                time.sleep(0.02)
                current=E.inventory(tree,owner=os.getuid(),require_manifest=False,allow_symlinks=True)
                record=M.root_record(current);self.assertEqual(len(current['records']),4)
                journal=R.Journal(parent/(name+'.jsonl'),record);fd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOATIME)
                try:self.assertEqual(R.delete_tree(fd,name,record,journal),4)
                finally:os.close(fd);journal.close()
                self.assertFalse(tree.exists())
                rows=[json.loads(line) for line in (parent/(name+'.jsonl')).read_text().splitlines()]
                self.assertEqual([r['stage'] for r in rows],['intent','completed']*4)
                self.assertLessEqual((parent/(name+'.jsonl')).stat().st_size,R.journal_capacity_bound(record))
            self.assertEqual(keep.read_bytes(),b'kept')

if __name__=='__main__':unittest.main()
