#!/usr/bin/python3 -I
"""Isolated refusal/metadata tests; never contacts or modifies production."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import time
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('health_retire', HERE / 'retire.py')
M = importlib.util.module_from_spec(spec); spec.loader.exec_module(M)

class Tests(unittest.TestCase):
    def proof(self):
        return {'format': 'proofofwork-ui-health-cleanup-recovery-v1', 'ok': True,
                'sourceManifestSha256': M.MANIFESTS['source'][1], 'duplicateManifestSha256': M.MANIFESTS['duplicates'][1],
                'sourceArchiveSha256': M.SOURCE_ARCHIVE, 'duplicateArchiveSha256': M.DUPLICATE_ARCHIVE,
                'sourceEntries': 9204, 'duplicateFiles': 672, 'originalInodesRestorable': False, 'duplicateRestoreArchiveSha256': M.RESTORE_ARCHIVE_SHA,
                'restoredMetadata': ['content','type','mode','uid','gid','mtimeNs','atimeNs','xattrs','symlinkTarget','regularFileLinkCount']}
    def test_recovery_accepts_only_exact_complete_schema(self):
        proof = self.proof()
        with patch.object(M, 'pinned_json', return_value=(proof, b'proof')):
            self.assertEqual(M.recovery(None, Path('/proof'), M.RECOVERY_SHA)['sha256'], hashlib.sha256(b'proof').hexdigest())
        mutations = {'format':'other', 'ok':False, 'sourceManifestSha256':'0'*64,
                     'duplicateManifestSha256':'0'*64, 'sourceArchiveSha256':'0'*64,
                     'duplicateArchiveSha256':'0'*64, 'sourceEntries':9203, 'duplicateFiles':673,
                     'originalInodesRestorable':True, 'duplicateRestoreArchiveSha256':'0'*64, 'restoredMetadata':['content']}
        for key, value in mutations.items():
            with self.subTest(key=key), patch.object(M, 'pinned_json', return_value=({**proof,key:value}, b'proof')):
                with self.assertRaises(ValueError): M.recovery(None, Path('/proof'), M.RECOVERY_SHA)
    def test_durable_custody_requires_exact_archives_and_restored_roots(self):
        proof = {'format':'proofofwork-ui-health-cleanup-durable-custody-v1', 'ok':True,
                 'recoveryProofSha256':M.RECOVERY_SHA, 'sourceManifestSha256':M.MANIFESTS['source'][1],
                 'duplicateManifestSha256':M.MANIFESTS['duplicates'][1], 'custodyRoot':M.CUSTODY_ROOT,
                 'restoredSourceRoot':M.CUSTODY_ROOT+'/restored-source69',
                 'restoredDuplicateRoot':M.CUSTODY_ROOT+'/restored-duplicates',
                 'cleanupReview':{'durableRootUnderTmpfilesRule':False},
                 'archives':[{'role':'source69','retainedArchive':M.CUSTODY_ROOT+'/retained-archives/source-69c31-retained.tgz','sha256':M.SOURCE_ARCHIVE},
                             {'role':'duplicate672','retainedArchive':M.CUSTODY_ROOT+'/retained-archives/surfaces-d9fa-retained.tgz','sha256':M.RESTORE_ARCHIVE_SHA}]}
        with patch.object(M,'pinned_json',return_value=(proof,b'custody')):
            self.assertEqual(M.custody(None,Path('/custody'))['custodyRoot'],M.CUSTODY_ROOT)
        for key,value in {'format':'other','ok':False,'recoveryProofSha256':'0'*64,
                          'sourceManifestSha256':'0'*64,'duplicateManifestSha256':'0'*64,
                          'custodyRoot':'/tmp','restoredSourceRoot':'/tmp/source',
                          'restoredDuplicateRoot':'/tmp/duplicates','cleanupReview':{},'archives':[]}.items():
            with self.subTest(key=key),patch.object(M,'pinned_json',return_value=({**proof,key:value},b'custody')):
                with self.assertRaises(ValueError):M.custody(None,Path('/custody'))
        bad=copy.deepcopy(proof);bad['archives'][0]['retainedArchive']='/tmp/source.tgz'
        with patch.object(M,'pinned_json',return_value=(bad,b'custody')):
            with self.assertRaises(ValueError):M.custody(None,Path('/custody'))
    def metadata(self, kind='file'):
        old = {'type':kind,'device':4,'dev':4,'inode':10,'uid':0,'gid':0,'links':1,
               'mtimeNs':12,'atimeNs':11,'mode':0o600,'allocatedBytes':4096,'size':3,
               'xattrs':{'user.example':'6162'}}
        row = {'kind':kind,'xattrs':[['user.example','6162']],
               'identity':{'st_dev':4,'st_ino':10,'st_uid':0,'st_gid':0,'st_nlink':1,
                           'st_mtime_ns':12,'st_atime_ns':999,'st_mode':stat.S_IFREG|0o600,'st_blocks':8,'st_size':3}}
        if kind == 'file': old['sha256']=row['sha256']='a'*64
        if kind == 'symlink':
            old.update(mode=0o777,allocatedBytes=0,link='../safe')
            row.update(target='../safe')
            row['identity'].update(st_mode=stat.S_IFLNK|0o777,st_blocks=0)
        return row, old
    def test_xattrs_and_symlink_fields_normalize_without_weakening(self):
        for kind in ('file','symlink'):
            row, old = self.metadata(kind)
            M.compare_research(row,old,True)
            changed=copy.deepcopy(row);changed['xattrs']=[['user.example','6262']]
            with self.assertRaises(ValueError):M.compare_research(changed,old,True)
            if kind=='symlink':
                row['target']='../different'
                with self.assertRaises(ValueError):M.compare_research(row,old,True)
    def test_fresh_identity_changes_are_refused_except_observational_atime(self):
        row,old=self.metadata()
        M.compare_research(row,old,True)
        for field in ('st_dev','st_ino','st_uid','st_gid','st_nlink','st_mtime_ns','st_mode','st_blocks','st_size'):
            changed=copy.deepcopy(row);changed['identity'][field]+=1
            with self.subTest(field=field),self.assertRaises(ValueError):M.compare_research(changed,old,True)
    def scope(self):
        source={'entries':[{'relative':'.'},{'relative':'one'}]}
        duplicates={'files':[{'path':str(M.FAILED_PAYLOAD/'surfaces'/('f'+str(i)))} for i in range(672)]}
        groups=[]
        for start in range(0,672,16):
            groups.append({'parent':{'path':str(M.FAILED_PAYLOAD/'surfaces')},
                           'inventory':[{'path':'f'+str(i)} for i in range(start,min(start+16,672))]})
        plan={'format':M.FORMAT,'controllerSha256':M.digest((HERE/'retire.py').read_bytes()),'helpers':M.PINS,
              'manifests':M.MANIFESTS_AS_JSON,'source':{'root':str(M.SOURCE),'inventory':[{'path':'.'},{'path':'one'}]},
              'groups':groups,'failed':{'root':str(M.FAILED)}}
        return plan,source,duplicates
    def test_scope_requires_controller_helpers_and_exact_sets(self):
        plan,source,duplicates=self.scope();M.exact_scope(plan,source,duplicates)
        for key in ('format','controllerSha256','helpers','manifests'):
            bad=copy.deepcopy(plan);bad[key]='wrong'
            with self.subTest(key=key),self.assertRaises(ValueError):M.exact_scope(bad,source,duplicates)
        bad=copy.deepcopy(plan);bad['groups'][0]['inventory'][0]['path']='../unapproved'
        with self.assertRaises(ValueError):M.exact_scope(bad,source,duplicates)
        bad=copy.deepcopy(plan);bad['groups'][0]['inventory'][0]['path']='f1'
        with self.assertRaises(ValueError):M.exact_scope(bad,source,duplicates)
        bad=copy.deepcopy(plan);bad['source']['root']='/var/www'
        with self.assertRaises(ValueError):M.exact_scope(bad,source,duplicates)
    def test_partial_preservation_keeps_unique_files_and_directory_authority(self):
        directory={'path':'.','kind':'directory','xattrs':[],
                   'identity':dict(st_dev=1,st_ino=2,st_mode=0o40700,st_uid=0,st_gid=0,st_nlink=2,st_mtime_ns=1)}
        file={'path':'unique','kind':'file','xattrs':[],'identity':{'st_ino':3},'sha256':'a'*64}
        removed={'path':'selected','kind':'file','xattrs':[],'identity':{'st_ino':4},'sha256':'b'*64}
        expected={'inventory':[directory,file,removed]}
        current=[copy.deepcopy(directory),file];current[0]['identity']['st_mtime_ns']=99
        class E:
            @staticmethod
            def inventory(*args,**kwargs):return {'fingerprint':{},'records':current}
        M.assert_preserved(E,expected,{str(M.FAILED/'selected')})
        current[0]['identity']['st_ino']=500
        with self.assertRaises(ValueError):M.assert_preserved(E,expected,{str(M.FAILED/'selected')})
        current[0]=directory;current[1]={**file,'sha256':'c'*64}
        with self.assertRaises(ValueError):M.assert_preserved(E,expected,{str(M.FAILED/'selected')})
    def test_dependency_pins_match_unmodified_native_primitives(self):
        for name,sha in M.PINS.items():self.assertEqual(M.digest((M.ROOT/'deploy'/name).read_bytes()),sha)
    def test_native_retirement_journals_and_unique_file_preservation(self):
        R=M.load_module('health_test_removal',M.ROOT/'deploy/ui-retention/removal.py');E=R.E
        with tempfile.TemporaryDirectory() as tmp:
            parent=Path(tmp);tree=parent/'tree';tree.mkdir(mode=0o700);(tree/'one').write_bytes(b'one');(tree/'one').chmod(0o600);os.symlink('one',tree/'link')
            retained=parent/'unique';retained.write_bytes(b'unique')
            # Let relatime advance beyond the freshly created link ctime.
            time.sleep(0.02)
            inv=E.inventory(tree,owner=os.getuid(),require_manifest=False,allow_symlinks=True)
            record=M.root_record(inv);log=R.Journal(parent/'tree.jsonl',record)
            fd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOATIME)
            try:self.assertEqual(R.delete_tree(fd,'tree',record,log),3)
            finally:os.close(fd);log.close()
            self.assertEqual(retained.read_bytes(),b'unique');self.assertFalse(tree.exists())
            rows=[json.loads(line) for line in (parent/'tree.jsonl').read_text().splitlines()]
            self.assertEqual([r['stage'] for r in rows],['intent','completed']*3)
            self.assertLessEqual((parent/'tree.jsonl').stat().st_size,R.journal_capacity_bound(record))

if __name__=='__main__':unittest.main()
