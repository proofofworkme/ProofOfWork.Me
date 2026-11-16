#!/usr/bin/python3
"""Focused historical-citation admission tests; no production paths changed."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import unittest
import tempfile
import subprocess
from types import SimpleNamespace
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('storage_fixtures',HERE/'check-ui-storage.test.py')
F=importlib.util.module_from_spec(spec);spec.loader.exec_module(F)
S=F.S

def document(target='/retired/archive.tgz'):
    return {'format':'pow-upgrade-impact-v1','upgrade':'test','liveCheck':'scripts/check.mjs',
            'ciTests':['test.py'],'reviews':[{'targets':['pay'],'disposition':'compatible',
            'reason':'Historical '+target,'evidence':['tests.py']}]}
def raw(value):return (json.dumps(value,indent=2)+'\n').encode()

class ReasonMaskTests(unittest.TestCase):
    def test_only_reason_is_masked_with_exact_byte_positions(self):
        v=document();b=raw(v);mask=S.release_impact_reason_mask(b)
        self.assertEqual(len(mask),len(b));p=b.index(b'/retired/archive.tgz')
        self.assertEqual(mask[p:p+20],b' '*20)
        self.assertIn(b'scripts/check.mjs',mask)
    def test_unicode_quotes_and_repeated_reasons_preserve_offsets(self):
        v=document();v['reviews'][0]['reason']='\"héllo\"\n '+v['reviews'][0]['reason']
        v['reviews'].append(copy.deepcopy(v['reviews'][0]));b=raw(v);mask=S.release_impact_reason_mask(b)
        for _,offset in S.path_occurrences(b,['/retired/archive.tgz']):
            self.assertEqual(mask[offset:offset+20],b' '*20)
    def test_unknown_root_or_review_field_refuses(self):
        for where in ('root','review'):
            v=document();(v if where=='root' else v['reviews'][0])['unknown']='x'
            with self.assertRaisesRegex(ValueError,'shape'):S.release_impact_reason_mask(raw(v))
    def test_duplicate_key_refuses(self):
        b=raw(document()).replace(b'"upgrade": "test",',b'"upgrade": "test", "upgrade": "other",')
        with self.assertRaisesRegex(ValueError,'Duplicate JSON'):S.release_impact_reason_mask(b)
    def test_escaped_path_noncanonical_format_and_bad_types_refuse(self):
        b=raw(document())
        for candidate in (b.replace(b'/retired',b'\\/retired'), b.replace(b'/retired',b'\\u002fretired'), b.strip(), json.dumps(document()).encode()):
            with self.assertRaisesRegex(ValueError,'canonical'):S.release_impact_reason_mask(candidate)
        for key,value in [('reason',['x']),('targets','pay'),('evidence',{'path':'x'}),('disposition','unrecognized')]:
            v=document();v['reviews'][0][key]=value
            with self.assertRaisesRegex(ValueError,'shape'):S.release_impact_reason_mask(raw(v))

class AdmissionTests(unittest.TestCase):
    def setUp(self):
        self.f=F.StorageTests();self.f.setUp();self.addCleanup(self.f.doCleanups);self.addCleanup(self.f.tearDown)
        self.source=self.f.l.scratch/('proofofwork-ui-source-'+self.f.current)
        self.targets=[r['path'] for r in self.f.l.exact()]
        self.doc=self.source/'release-impact.json'
    def admit(self,v):
        self.doc.write_bytes(raw(v));binding=self.f.citation_manifest('cleanup',self.targets,[(self.source,'release-impact.json')])
        with patch.object(S,'git_document_blob',side_effect=self.f.fake_blob):
            return S.load_citation_review(binding,self.f.l,S.protected_pair(self.f.l,{}),'cleanup',self.targets,self.f.auth)
    def test_exact_reason_is_admitted_without_removal(self):
        result=self.admit(document(self.targets[0]));self.assertIn(str(self.doc),result)
        self.assertTrue(all(os.path.lexists(p) for p in self.targets))
    def test_operational_fields_never_qualify_even_with_review(self):
        for field in ('liveCheck','upgrade','ciTests','targets','evidence'):
            with self.subTest(field=field):
                v=document(self.targets[0])
                if field in ('liveCheck','upgrade'):v[field]=self.targets[0]
                elif field=='ciTests':v[field]=[self.targets[0]]
                else:v['reviews'][0][field]=[self.targets[0]]
                with self.assertRaisesRegex(ValueError,'outside a reviewed reason'):self.admit(v)
    def test_other_nested_reason_does_not_qualify(self):
        v=document(self.targets[0]);v['extra']={'reason':self.targets[0]}
        with self.assertRaisesRegex(ValueError,'shape'):self.admit(v)
    def test_incomplete_occurrences_hash_drift_and_blob_drift_refuse(self):
        v=document(self.targets[0]);v['reviews'].append(copy.deepcopy(v['reviews'][0]));self.doc.write_bytes(raw(v))
        binding=self.f.citation_manifest('cleanup',self.targets,[(self.source,'release-impact.json')])
        pair=S.protected_pair(self.f.l,{})
        record=json.loads(Path(binding['path']).read_bytes());record['files'][0]['citations'].pop()
        Path(binding['path']).write_bytes(raw(record));changed=dict(binding,sha256=S.hash_read(Path(binding['path']))[0])
        with patch.object(S,'git_document_blob',side_effect=self.f.fake_blob):
            with self.assertRaisesRegex(ValueError,'every exact occurrence'):S.load_citation_review(changed,self.f.l,pair,'cleanup',self.targets,self.f.auth)
        with patch.object(S,'git_document_blob',return_value='f'*40):
            with self.assertRaisesRegex(ValueError,'bytes/Git blob'):S.load_citation_review(changed,self.f.l,pair,'cleanup',self.targets,self.f.auth)
        self.doc.write_bytes(raw(v)+b' ')
        with patch.object(S,'git_document_blob',side_effect=self.f.fake_blob):
            with self.assertRaisesRegex(ValueError,'bytes/Git blob'):S.load_citation_review(changed,self.f.l,pair,'cleanup',self.targets,self.f.auth)

class ActualGitTests(unittest.TestCase):
    def setUp(self):
        old=os.umask(0o077);self.addCleanup(os.umask,old)
    def test_real_committed_blob_and_clean_source_are_required(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);source=base/'source';source.mkdir();evidence=base/'evidence';evidence.mkdir()
            doc=source/'release-impact.json';b=raw(document());doc.write_bytes(b)
            git=['git','-c','user.name=Citation fixture','-c','user.email=fixture@example.invalid','-C',str(source)]
            env={'PATH':'/usr/bin:/bin','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_SYSTEM':'/dev/null'}
            for args in (['init','-q'],['add','release-impact.json'],['commit','-qm','fixture']):
                subprocess.run(git+args,env=env,check=True,timeout=10,capture_output=True)
            identity=S.source_pointers(source);protected={'sources':[{'path':str(source),'git':identity}]}
            target='/retired/archive.tgz';offset=b.index(target.encode());start=b.rfind(b'\n',0,offset)+1;end=b.find(b'\n',offset)+1
            citation={'target':target,'byteOffset':offset,'line':b.count(b'\n',0,offset)+1,'lineSha256':hashlib.sha256(b[start:end]).hexdigest(),'classification':'historical-release-evidence'}
            proof=evidence/'audit30-semantic-real-git.json';proof.write_text('Reviewed exact historical reason')
            value={'schema':'pow-audit30-historical-citation-review-v1','host':'77.42.91.106','scopeApprovalSha256':'a'*64,'operationKind':'future-retention','candidatePaths':[target],
                   'protectedSources':[{'path':str(source),'head':identity['head'],'tree':identity['tree']}],
                   'reviewEvidence':[{'path':str(proof),'sha256':S.hash_read(proof)[0]}],
                   'files':[{'sourcePath':str(source),'relativePath':'release-impact.json','sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'gitBlobSha1':S.git_document_blob(source,'release-impact.json',identity['head']),'citations':[citation]}]}
            review=evidence/'audit30-citation-review-real-git.json';review.write_bytes(raw(value));binding={'path':str(review),'sha256':S.hash_read(review)[0]}
            result=S.load_citation_review(binding,SimpleNamespace(evidence=evidence),protected,'future-retention',[target],'a'*64)
            self.assertIn(str(doc),result)
            doc.write_bytes(b+b' ')
            with self.assertRaisesRegex(ValueError,'local changes'):
                S.load_citation_review(binding,SimpleNamespace(evidence=evidence),protected,'future-retention',[target],'a'*64)

if __name__=='__main__':
    suite=unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(c) for c in (ReasonMaskTests,AdmissionTests,ActualGitTests))
    for name in ('test_exact_historical_citation_plan_and_byte_tamper','test_citation_scope_occurrence_context_and_review_hash_refuse','test_citation_never_qualifies_config_symlink_or_process_match','test_reviewed_document_alias_and_active_usage_always_refuse','test_postpublication_policy_requires_fresh_exact_citation_review'):
        suite.addTest(F.StorageTests(name))
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(not result.wasSuccessful())
