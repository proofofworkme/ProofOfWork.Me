#!/usr/bin/python3 -I
"""Isolated fixtures only; never contacts production."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import time
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('ad330_cleanup',HERE/'ad330_duplicates.py')
M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)

class Tests(unittest.TestCase):
    def row(self,path,kind='file',size=1,blocks=1):
        return {'path':path,'kind':kind,'xattrs':[],**({'sha256':'a'*64} if kind=='file' else {}),
                'identity':{'st_dev':1,'st_ino':2,'st_uid':0,'st_gid':0,'st_nlink':1,'st_size':size,
                            'st_blocks':blocks,'st_mode':(stat.S_IFREG|0o600) if kind=='file' else (stat.S_IFDIR|0o700),
                            'st_mtime_ns':1,'st_atime_ns':1,'st_ctime_ns':1}}
    def manifest(self):
        files=[]
        for i in range(2048):
            relative=M.PAYLOAD.name+'/surfaces/f'+str(i)
            native=self.row(relative,size=337505835-2047 if i==0 else 1,
                            blocks=342032384//512-2047 if i==0 else 1)
            files.append({'path':str(M.FAILED/relative),'relative':relative,'native':native})
        dirs=[self.row(M.PAYLOAD.name,'directory')]+[
            self.row(M.PAYLOAD.name+'/d'+str(i),'directory') for i in range(169)]
        unique=self.row(str(M.UNIQUE.relative_to(M.FAILED)),size=7634944)
        return {'format':'proofofwork-ad330-duplicate-manifest-v1','root':str(M.FAILED),
                'archiveSha256':M.ARCHIVE_SHA,'inventoryHelperSha256':M.PINS['ui-retention/inventory.py'],
                'allocatedBytes':342032384,'logicalBytes':337505835,'files':files,'retainedDirectories':dirs,
                'retainedRoot':self.row('.','directory'),'retainedPartial':{'native':unique,'expectedCompleteSize':7968826,'prefixSha256':unique['sha256']}}
    def proof(self):
        return {'format':'proofofwork-ad330-duplicate-recovery-v1','ok':True,'manifestSha256':M.MANIFEST_SHA,
                'durableArchiveSha256':M.ARCHIVE_SHA,'duplicateFiles':2048,'originalInodesRestorable':False,
                'originalCtimeRestorable':False,'durableArchivePath':M.DURABLE_ARCHIVE,'restoreRoot':M.RESTORE_ROOT,
                'restoredMetadata':['content','type','mode','uid','gid','mtimeNs','atimeNs','xattrs','regularFileLinkCount']}
    def test_exact_manifest_and_aggregate_counts(self):
        manifest=self.manifest();authority=M.validate_manifest(manifest)
        self.assertEqual(len(authority['selected']),2048);self.assertEqual(len(authority['records']),2220)
        for key,value in {'format':'wrong','root':'/var/www','archiveSha256':'0'*64,
                          'inventoryHelperSha256':'0'*64,'allocatedBytes':0,'logicalBytes':0}.items():
            bad={**manifest,key:value}
            with self.subTest(key=key),self.assertRaises(ValueError):M.validate_manifest(bad)
        for mutation in ('missing','duplicate','escape','unique','alias','directory','bytes'):
            bad=copy.deepcopy(manifest)
            if mutation=='missing':bad['files'].pop()
            if mutation=='duplicate':bad['files'][1]=bad['files'][0]
            if mutation=='escape':bad['files'][0]['native']['path']='../outside'
            if mutation=='unique':bad['files'][0]['path']=str(M.UNIQUE)
            if mutation=='alias':bad['files'][0]['native']['identity']['st_nlink']=2
            if mutation=='directory':bad['files'][0]['native']['kind']='directory'
            if mutation=='bytes':bad['files'][0]['native']['identity']['st_blocks']+=1
            with self.subTest(mutation=mutation),self.assertRaises(ValueError):M.validate_manifest(bad)
    def test_retained_partial_and_all_directories_are_required(self):
        for mutation in ('size','hash','path','directories'):
            bad=self.manifest()
            if mutation=='size':bad['retainedPartial']['native']['identity']['st_size']+=1
            if mutation=='hash':bad['retainedPartial']['prefixSha256']='0'*64
            if mutation=='path':bad['retainedPartial']['native']['path']='other'
            if mutation=='directories':bad['retainedDirectories'].pop()
            with self.subTest(mutation=mutation),self.assertRaises(ValueError):M.validate_manifest(bad)
    def test_recovery_requires_exact_durable_restoration(self):
        proof=self.proof();M.validate_proof(proof)
        for key,value in {'format':'wrong','ok':False,'manifestSha256':'wrong','durableArchiveSha256':'0'*64,
                          'duplicateFiles':2047,'originalInodesRestorable':True,'originalCtimeRestorable':True,
                          'durableArchivePath':'/tmp/archive','restoreRoot':'/tmp/restore','restoredMetadata':['content']}.items():
            with self.subTest(key=key),self.assertRaises(ValueError):M.validate_proof({**proof,key:value})
    def test_original_metadata_drift_is_refused_except_atime(self):
        original=self.row('one');actual=copy.deepcopy(original);actual['identity']['st_atime_ns']=5
        M.match_record(actual,original)
        for key in original['identity']:
            if key=='st_atime_ns':continue
            bad=copy.deepcopy(original);bad['identity'][key]+=1
            with self.subTest(key=key),self.assertRaises(ValueError):M.match_record(bad,original)
        for key,value in {'path':'other','kind':'directory','sha256':'0'*64,'xattrs':[['user.a','aa']]}.items():
            with self.subTest(key=key),self.assertRaises(ValueError):M.match_record({**original,key:value},original)
    def scope(self):
        authority=M.validate_manifest(self.manifest());groups=[]
        for start in range(0,2048,16):
            groups.append({'parent':{'path':str(M.PAYLOAD/'surfaces')},
                           'inventory':[{'path':'f'+str(i)} for i in range(start,start+16)]})
        return {'format':M.FORMAT,'controllerSha256':M.digest((HERE/'ad330_duplicates.py').read_bytes()),
                'helpers':M.PINS,'manifestSha256':M.MANIFEST_SHA,'proofSha256':M.PROOF_SHA,
                'failed':{'root':str(M.FAILED),'inventory':authority['records']},'groups':groups},authority
    def test_plan_scope_rejects_changed_authority_and_membership(self):
        plan,authority=self.scope();M.exact_scope(plan,authority)
        for key in ('format','controllerSha256','helpers','manifestSha256','proofSha256'):
            with self.subTest(key=key),self.assertRaises(ValueError):M.exact_scope({**plan,key:'wrong'},authority)
        bad=copy.deepcopy(plan);bad['groups'][0]['inventory'][0]['path']='../unexpected'
        with self.assertRaises(ValueError):M.exact_scope(bad,authority)
    def test_prior_intent_refuses_before_lifecycle_or_unlink(self):
        plan,authority=self.scope()
        with tempfile.TemporaryDirectory() as tmp,patch.object(M,'EVIDENCE',Path(tmp)):
            plan.update(manifestPath=str(Path(tmp)/'manifest.json'),proofPath=str(Path(tmp)/'recovery-proof.json'),createdAtUnix=int(time.time()))
            (Path(tmp)/'intent.json').write_text('{}')
            with patch.object(M,'pinned_json',return_value=(plan,b'plan')),patch.object(M,'authority',return_value=authority),patch.object(M,'lifecycle') as lifecycle:
                with self.assertRaisesRegex(ValueError,'Prior attempt'):M.apply_command(types.SimpleNamespace(sha256='a'*64),None,None,None,0)
                lifecycle.assert_not_called()
    def test_native_selective_unlink_preserves_unique_and_directories(self):
        R=M.load_module('ad330_test_removal',M.ROOT/'deploy/ui-retention/removal.py');E=R.E
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'partial';root.mkdir(mode=0o700);parent=root/'surfaces';parent.mkdir(mode=0o700)
            for name in ('a','b','partial'):(parent/name).write_bytes(name.encode());(parent/name).chmod(0o600)
            with patch.object(M,'FAILED',root):
                before=M.root_record(E.inventory(root,owner=os.getuid(),require_manifest=False,allow_symlinks=False))
                value=E.inventory_file_group(parent/'a',['a','b'],owner=os.getuid())
                group={**M.root_record(value),'parent':value['parent']}
                journal=R.Journal(Path(tmp)/'actions.jsonl',expected_root=group)
                fd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOATIME)
                try:self.assertEqual(R.delete_file_group(fd,group,journal),2)
                finally:os.close(fd);journal.close()
                # Production is root-owned; patch owner only for isolated fixture.
                original=E.inventory
                with patch.object(E,'inventory',side_effect=lambda path,**kw:original(path,owner=os.getuid(),**kw)):
                    M.assert_preserved(E,before,{str(parent/'a'),str(parent/'b')})
                self.assertEqual((parent/'partial').read_bytes(),b'partial');self.assertTrue(parent.is_dir())
                rows=[json.loads(x) for x in (Path(tmp)/'actions.jsonl').read_text().splitlines()]
                self.assertEqual([x['stage'] for x in rows],['intent','completed']*2)
                self.assertLessEqual((Path(tmp)/'actions.jsonl').stat().st_size,R.journal_capacity_bound(group))
    def test_digest_validator_is_exact_and_fail_closed(self):
        self.assertIsNotNone(M.SHA.fullmatch('a'*64))
        for value in ('a'*63,'a'*65,'A'*64,'a'*64+'\n','a'*64+'\\Z'):
            self.assertIsNone(M.SHA.fullmatch(value))
        class E:
            @staticmethod
            def read_regular(path,limit):
                return b'{}',types.SimpleNamespace(st_uid=0,st_gid=0,st_mode=stat.S_IFREG|0o600)
        self.assertEqual(M.pinned_json(E,'/fixture',M.digest(b'{}'))[0],{})
        with self.assertRaises(ValueError):M.pinned_json(E,'/fixture','a'*64)
    def test_native_helper_hashes_are_unchanged(self):
        for name,sha in M.PINS.items():self.assertEqual(M.digest((M.ROOT/'deploy'/name).read_bytes()),sha)

if __name__=='__main__':unittest.main()
