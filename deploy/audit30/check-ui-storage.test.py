#!/usr/bin/python3
"""Actual temporary-filesystem fixtures: corruption, holds, pointers and partial work."""
import hashlib
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

def load(name,filename):
    loader=importlib.machinery.SourceFileLoader(name,str(Path(__file__).with_name(filename)));spec=importlib.util.spec_from_loader(name,loader);m=importlib.util.module_from_spec(spec);loader.exec_module(m);return m
S=load('audit30_storage_test','ui-storage.py');P=load('audit30_policy_test','ui-release-policy.py')

class StorageTests(unittest.TestCase):
    def setUp(self):
        self.old_umask=os.umask(0o077)
        self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);self.l=S.Layout(self.base)
        for p in [self.l.live,self.l.roots,self.l.archives,self.l.scratch,self.l.evidence,self.l.target.parent,self.l.lock.parent,self.l.units,self.l.held.parent,self.l.capacity.parent]:p.mkdir(parents=True,exist_ok=True)
        self.l.lock.write_text('');self.l.capacity.write_text('# safe capacity fixture\n');self.l.hold.write_text('generic hold remains\n')
        rows=[dict(role='ui',path=p,decision='retain',retentionClass='managed-ui-recovery-container',releaseGate='exact proof and explicit scoped approval') for p in ['/var/backups/proofofwork-ui/releases','/var/backups/proofofwork-ui/rollback-roots']]
        self.review=dict(retain=rows);self.write_review()
        for n in ('proofofwork-ui-release-prune.timer','proofofwork-ui-storage-prune.timer'):(self.l.units/n).symlink_to('/dev/null')
        self.old_held,self.old_hold=S.HELD_SHA,S.HOLD_SHA;S.HOLD_SHA=hashlib.sha256(self.l.hold.read_bytes()).hexdigest();self.update_held()
        self.current='26500e4d2ff7-20261002T054938Z';self.previous='835e30258d23-20261002T052338Z'
        self.release(self.l.live,self.current);self.release(self.l.roots/('proofofwork-www-pre-'+self.current),self.previous)
        for rid,contained in zip(S.ROOT_IDS,S.ARCHIVE_IDS):self.release(self.l.roots/('proofofwork-www-pre-'+rid),contained)
        for rid in [self.current,self.previous,*S.SOURCE_IDS]:
            p=self.l.scratch/('proofofwork-ui-source-'+rid);p.mkdir();(p/'.git').mkdir();(p/'.git'/'config').write_text('preserve this unique metadata\n');(p/'tracked.txt').write_text('source\n');(p/'node_modules').mkdir();(p/'node_modules'/'ignored.bin').write_bytes(b'preserve dependencies\x00')
        self.dependency_provenance(self.l.live,self.current);self.dependency_provenance(self.l.roots/('proofofwork-www-pre-'+self.current),self.previous)
        self.l.refs=[]
        def source(path):
            rid=path.name.removeprefix('proofofwork-ui-source-');return dict(head=rid.split('-')[0]+'0'*28,tree='1'*40,statusSha256='x',ignoredNodeModulesLines=1)
        self.source_patch=patch.object(S,'source_pointers',side_effect=source);self.source_patch.start();self.capacity_patch=patch.object(S,'capacity');self.capacity_patch.start()
        self.auth='a'*64
    def tearDown(self):
        self.source_patch.stop();self.capacity_patch.stop();S.HELD_SHA=self.old_held;S.HOLD_SHA=self.old_hold;self.tmp.cleanup();os.umask(self.old_umask)
    def write_review(self):self.l.held.write_text(json.dumps(self.review,sort_keys=True))
    def update_held(self):S.HELD_SHA=hashlib.sha256(self.l.held.read_bytes()).hexdigest()
    def release(self,root,rid):
        root.mkdir(exist_ok=True);fields=dict(format='proofofwork-ui-release-v3',release_id=rid,commit=rid.split('-')[0]+'0'*28,source_tree='1'*40,archive_name='proofofwork-ui-release-'+rid+'.tgz')
        for name in S.SURFACES:
            p=root/('proofofwork-'+name);p.mkdir(mode=0o755);p.chmod(0o755);f=p/'index.html';f.write_text('surface '+name);f.chmod(0o644);h=hashlib.sha256();h.update(b'index.html\x00644\x00'+hashlib.sha256(f.read_bytes()).hexdigest().encode()+b'\n');fields['surface.'+name+'.sha256']=h.hexdigest();fields['surface.'+name+'.file_count']='1'
        archive=self.l.archives/fields['archive_name']
        # Do not overwrite a retained archive when another root contains that release.
        if not archive.exists():
            with tarfile.open(archive,'w:gz') as t:
                info=tarfile.TarInfo('surfaces');info.type=tarfile.DIRTYPE;info.mode=0o700;info.uid=os.getuid();info.gid=os.getgid();t.addfile(info)
                for name in S.SURFACES:t.add(root/('proofofwork-'+name),arcname='surfaces/'+name)
            fields['archive_sha256']=hashlib.sha256(archive.read_bytes()).hexdigest()
            mb=''.join(k+'='+v+'\n' for k,v in fields.items()).encode();Path(str(archive)+'.sha256').write_text(fields['archive_sha256']+'  '+archive.name+'\n');Path(str(archive)+'.provenance').write_bytes(mb)
        else:
            mb=Path(str(archive)+'.provenance').read_bytes()
        (root/'.proofofwork-ui-release').write_bytes(mb)
    def plan(self):return S.create_plan(self.l,'cleanup',self.auth)
    def dependency_provenance(self,root,rid):
        dependency=S.dependency_fingerprint(S.snapshot(self.l.scratch/('proofofwork-ui-source-'+rid),links=True));fields=dict(l.split('=',1) for l in (root/'.proofofwork-ui-release').read_text().splitlines());fields.update(source_dependency_model=dependency['model'],source_dependency_entry_count=str(dependency['entryCount']),source_dependency_bytes=str(dependency['regularBytes']),source_dependency_sha256=dependency['sha256']);raw=''.join(k+'='+v+'\n' for k,v in fields.items());(root/'.proofofwork-ui-release').write_text(raw);(self.l.archives/(fields['archive_name']+'.provenance')).write_text(raw)
    def test_canonical_dependency_heredoc_parity(self):
        p=self.base/'canonical-source';n=p/'node_modules';n.mkdir(parents=True);n.chmod(0o755)
        for name in ('a','é'):(n/name).mkdir(mode=0o755);(n/name).chmod(0o755)
        for name,data,mode in [('a/binary',b'\0\xff\n',0o644),('tool',b'#!/bin/sh\n',0o755),('é/file',b'utf8-dir\n',0o644)]:
            q=n/name;q.write_bytes(data);q.chmod(mode)
        (n/'relative').symlink_to('a/binary')
        canonical=Path(__file__).resolve().parents[1]/'proofofwork-ui-release-provenance.sh'
        body=canonical.read_text().split('attest_source_dependencies() {',1)[1].split("<<'PY'\n",1)[1].split('\nPY\n',1)[0]
        out=subprocess.run(['/usr/bin/python3','-I','-B','-',str(p)],input=body,text=True,capture_output=True,check=True,timeout=30).stdout.strip().split('\t')
        actual=S.dependency_fingerprint(S.snapshot(p,links=True));self.assertEqual(out,[str(actual['entryCount']),str(actual['regularBytes']),actual['sha256']]);self.assertEqual(out[:2],['7','22'])
        if os.getuid()==1000 and os.getgid()==1000:self.assertEqual(out[2],'6f17f895f60abdcd311f44782a74945f0591ec2fab36b7db4071447ff927ca7c')
    def cleanup(self):
        plan=self.plan();out=S.execute(plan,S.digest(plan),self.l,True);return dict(path=out['receiptPath'],sha256=out['receiptSha256'])
    def citation_manifest(self,kind,candidates,files):
        pair=S.protected_pair(self.l,{});evidence=self.l.evidence/'audit30-semantic-fixture.json'
        if not evidence.exists():S.durable(evidence,dict(classification='Historical release evidence; no active dependencies'))
        rows=[]
        for source,relative in files:
            raw=(source/relative).read_bytes();citations=[]
            for target,offset in S.path_occurrences(raw,candidates):
                start=raw.rfind(b'\n',0,offset)+1;end=raw.find(b'\n',offset);end=len(raw) if end<0 else end+1
                citations.append(dict(target=target,byteOffset=offset,line=raw.count(b'\n',0,offset)+1,lineSha256=hashlib.sha256(raw[start:end]).hexdigest(),classification='historical-release-evidence'))
            rows.append(dict(sourcePath=str(source),relativePath=relative,sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw),gitBlobSha1=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest(),citations=citations))
        value=dict(schema='pow-audit30-historical-citation-review-v1',host='77.42.91.106',scopeApprovalSha256=self.auth,operationKind=kind,candidatePaths=candidates,protectedSources=[dict(path=r['path'],head=r['git']['head'],tree=r['git']['tree']) for r in pair['sources']],reviewEvidence=[dict(path=str(evidence),sha256=S.hash_read(evidence,S.MAX_JSON)[0])],files=rows)
        p=self.l.evidence/('audit30-citation-review-'+str(len(list(self.l.evidence.glob('audit30-citation-review-*'))))+'.json');S.durable(p,value);return dict(path=str(p),sha256=S.hash_read(p,S.MAX_JSON)[0])
    def fake_blob(self,source,relative,head):
        raw=(source/relative).read_bytes();return hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
    def test_exact_cleanup_and_preserved_pair(self):
        plan=self.plan();self.assertEqual(len(plan['delete']),40);self.assertEqual(len(plan['heldBoundaries']),40)
        S.validate_plan(plan,self.l,'cleanup',self.auth);out=S.execute(plan,S.digest(plan),self.l,True)
        self.assertEqual(out['completedCount'],40);self.assertTrue(self.l.live.exists());self.assertTrue((self.l.roots/('proofofwork-www-pre-'+self.current)).exists());self.assertTrue(self.l.hold.exists());self.assertEqual(os.readlink(self.l.units/'proofofwork-ui-release-prune.timer'),'/dev/null')
    def test_expanded_partial_duplicate_scope_refused(self):
        plan=self.plan()
        for rows in [plan['delete'][:-1],plan['delete']+[plan['delete'][0]],plan['delete'][::-1]]:
            changed=dict(plan,delete=rows)
            with self.assertRaises(ValueError):S.validate_plan(changed,self.l,'cleanup',self.auth)
    def test_changed_file_blocks_before_any_removal(self):
        plan=self.plan();p=Path(plan['delete'][0]['path'])/'proofofwork-work'/'index.html';p.write_text('corrupt')
        with self.assertRaises(ValueError):S.execute(plan,S.digest(plan),self.l,True)
        self.assertTrue(all(os.path.lexists(r['path']) for r in plan['delete']));self.assertEqual(list(self.l.evidence.iterdir()),[])
    def test_unique_passthrough_refuses(self):
        (self.l.roots/('proofofwork-www-pre-'+S.ROOT_IDS[0])/'unique-evidence.txt').write_text('must survive')
        with self.assertRaisesRegex(ValueError,'Unique non-release'):self.plan()
    def test_individually_held_descendant_refuses(self):
        self.review['retain'].append(dict(role='ui',path='/var/backups/proofofwork-ui/rollback-roots/proofofwork-www-pre-'+S.ROOT_IDS[0]+'/evidence',decision='retain'));self.write_review();self.update_held()
        with self.assertRaisesRegex(ValueError,'Individually held'):self.plan()
    def test_hold_or_mask_change_refuses(self):
        plan=self.plan();self.l.hold.write_text('changed')
        with self.assertRaisesRegex(ValueError,'hold changed'):S.execute(plan,S.digest(plan),self.l)
    def test_archive_checksum_is_not_payload_proof(self):
        p=self.l.archives/('proofofwork-ui-release-'+S.ARCHIVE_IDS[0]+'.tgz')
        with tarfile.open(p,'w:gz') as t:
            info=tarfile.TarInfo('surfaces');info.type=tarfile.DIRTYPE;info.mode=0o755;t.addfile(info)
        old=Path(str(p)+'.provenance').read_text();newhash=hashlib.sha256(p.read_bytes()).hexdigest();fields=dict(l.split('=',1) for l in old.splitlines());fields['archive_sha256']=newhash;raw=''.join(k+'='+v+'\n' for k,v in fields.items());Path(str(p)+'.provenance').write_text(raw);Path(str(p)+'.sha256').write_text(newhash+'  '+p.name+'\n')
        root=self.l.roots/('proofofwork-www-pre-'+S.ROOT_IDS[0]);(root/'.proofofwork-ui-release').write_text(raw)
        with self.assertRaises(ValueError):self.plan()
    def test_inode_replacement_refuses(self):
        p=self.base/'single';p.write_text('same bytes');before=S.snapshot(p);q=self.base/'replacement';q.write_text('same bytes');os.utime(q,ns=(p.stat().st_atime_ns,p.stat().st_mtime_ns));q.replace(p)
        with self.assertRaises(ValueError):S.match_snapshot(S.snapshot(p),before)
    def test_known_hardlink_unlink_and_unknown_unlink(self):
        p=self.base/'file';q=self.base/'link';p.write_text('shared');os.link(p,q);before=S.snapshot(p);q.unlink();actual=S.snapshot(p)
        with self.assertRaisesRegex(ValueError,'hardlink'):S.match_snapshot(actual,before)
        r=before['entries'][0];S.match_snapshot(actual,before,{(r['device'],r['inode']):1})
    def test_live_fd_and_operator_pointer_refuse(self):
        p=self.base/'operator.sh';candidate=str(self.l.roots/('proofofwork-www-pre-'+S.ROOT_IDS[0]));p.write_text('use '+candidate)
        with self.assertRaisesRegex(ValueError,'references'):S.references([candidate],[p],proc=self.base/'no-proc')
        inbound=self.base/'inbound';inbound.symlink_to(candidate)
        with self.assertRaisesRegex(ValueError,'references'):S.references([candidate],[inbound],proc=self.base/'no-proc')
    def test_reference_budget_and_per_root_census(self):
        one=self.base/'scan-one';two=self.base/'scan-two';one.mkdir();two.mkdir();(one/'small').write_bytes(b'1234');(two/'small').write_bytes(b'5678');(two/'large').write_bytes(b'x'*(1024**2+1));(two/'node_modules').mkdir();(two/'node_modules'/'excluded').write_bytes(b'stay excluded')
        out=S.references([], [one,two],proc=self.base/'no-proc',byte_limit=8)
        self.assertEqual(out['bytesRead'],8);self.assertEqual(out['entryLimit'],100000);self.assertEqual(out['perFileByteLimit'],1024**2);self.assertEqual([r['bytesRead'] for r in out['perRoot']],[0,4,4]);self.assertEqual(out['perRoot'][2]['skippedLargeFiles'],1);self.assertEqual(out['perRoot'][2]['skippedPayloadDirectories'],1)
        with self.assertRaisesRegex(ValueError,'byte bound: limit=7 consumed=8'):S.references([], [one,two],proc=self.base/'no-proc',byte_limit=7)
    def test_escaped_regex_preserves_substring_and_process_pointer_semantics(self):
        candidate=str(self.base/'literal[1].root');operator=self.base/'operator';operator.write_text('prefix '+candidate+'-suffix')
        with self.assertRaisesRegex(ValueError,'content-pointer'):S.references([candidate],[operator],proc=self.base/'no-proc')
        operator.write_text(candidate.replace('[1]','1').replace('.root','Xroot'));S.references([candidate],[operator],proc=self.base/'no-proc');S.references([], [operator],proc=self.base/'no-proc')
        proc=self.base/'fake-proc';process=proc/'123';process.mkdir(parents=True);(process/'cwd').symlink_to(candidate);(process/'cmdline').write_bytes(b'command');(process/'maps').write_bytes(os.fsencode(candidate)+b' (deleted)');(process/'mountinfo').write_bytes(b'mount')
        with self.assertRaisesRegex(ValueError,'path-pointer'):S.references([candidate],[],proc=proc)
        (process/'cwd').unlink()
        with self.assertRaisesRegex(ValueError,'content-pointer'):S.references([candidate],[],proc=proc)
    def test_process_mapping_read_bound_refuses(self):
        proc=self.base/'fake-proc';process=proc/'123';process.mkdir(parents=True);(process/'maps').write_bytes(b'x'*(1024**2+1))
        with self.assertRaisesRegex(ValueError,'per-file byte bound'):S.references([],[],proc=proc)
    def test_exact_historical_citation_plan_and_byte_tamper(self):
        source=self.l.scratch/('proofofwork-ui-source-'+self.current);target=self.l.exact()[0]['path'];doc=source/'OP_RETURN_INFRASTRUCTURE.md';doc.write_text('Historical release receipt: '+target+'\n');self.l.refs=[]
        with self.assertRaisesRegex(ValueError,'references'):self.plan()
        binding=self.citation_manifest('cleanup',[r['path'] for r in self.l.exact()],[(source,doc.name)])
        with patch.object(S,'git_document_blob',side_effect=self.fake_blob):
            plan=S.create_plan(self.l,'cleanup',self.auth,citation_review=binding);self.assertEqual(len(plan['references']['qualifiedHistoricalMatches']),1);self.assertEqual(plan['citationReview'],binding);S.execute(plan,S.digest(plan),self.l,False)
            doc.write_text(doc.read_text()+'unreviewed edit\n')
            with self.assertRaisesRegex(ValueError,'bytes/Git blob'):S.execute(plan,S.digest(plan),self.l,True)
        self.assertTrue(all(os.path.lexists(r['path']) for r in self.l.exact()))
    def test_citation_scope_occurrence_context_and_review_hash_refuse(self):
        source=self.l.scratch/('proofofwork-ui-source-'+self.current);target=self.l.exact()[0]['path'];doc=source/'OP_RETURN_INFRASTRUCTURE.md';doc.write_text('Historical '+target+'\nHistorical '+target+'\n');binding=self.citation_manifest('cleanup',[r['path'] for r in self.l.exact()],[(source,doc.name)]);pair=S.protected_pair(self.l,{});original=json.loads(Path(binding['path']).read_text())
        with patch.object(S,'git_document_blob',side_effect=self.fake_blob):
            for mutate in [lambda v:v['candidatePaths'].pop(),lambda v:v['protectedSources'][0].update(head='f'*40),lambda v:v['files'][0]['citations'].pop(),lambda v:v['files'][0]['citations'][0].update(lineSha256='f'*64),lambda v:v['files'][0]['citations'][0].update(classification='active-config')]:
                value=json.loads(json.dumps(original));mutate(value);Path(binding['path']).write_text(json.dumps(value));h=S.hash_read(Path(binding['path']),S.MAX_JSON)[0]
                with self.assertRaises(ValueError):S.load_citation_review(dict(path=binding['path'],sha256=h),self.l,pair,'cleanup',[r['path'] for r in self.l.exact()],self.auth)
            with self.assertRaisesRegex(ValueError,'hash differs'):S.load_citation_review(binding,self.l,pair,'cleanup',[r['path'] for r in self.l.exact()],self.auth)
    def test_citation_never_qualifies_config_symlink_or_process_match(self):
        source=self.l.scratch/('proofofwork-ui-source-'+self.current);target=self.l.exact()[0]['path'];doc=source/'OP_RETURN_INFRASTRUCTURE.md';doc.write_text('Historical '+target+'\n');binding=self.citation_manifest('cleanup',[r['path'] for r in self.l.exact()],[(source,doc.name)])
        with patch.object(S,'git_document_blob',side_effect=self.fake_blob):
            admitted=S.load_citation_review(binding,self.l,S.protected_pair(self.l,{}),'cleanup',[r['path'] for r in self.l.exact()],self.auth);config=self.base/'installed-config';config.write_text(target)
            with self.assertRaisesRegex(ValueError,'references'):S.references([target],[config,source],proc=self.base/'no-proc',reviewed_files=admitted)
            with self.assertRaisesRegex(ValueError,'references'):S.references([target],[doc],proc=self.base/'no-proc',reviewed_files=admitted)
            config.unlink();config.symlink_to(target)
            with self.assertRaisesRegex(ValueError,'references'):S.references([target],[config,source],proc=self.base/'no-proc',reviewed_files=admitted)
            proc=self.base/'fake-proc';process=proc/'123';process.mkdir(parents=True);(process/'maps').write_text(target)
            with self.assertRaisesRegex(ValueError,'references'):S.references([target],[source],proc=proc,reviewed_files=admitted)
            value=json.loads(Path(binding['path']).read_text());value['files'][0]['relativePath']='.env';Path(binding['path']).write_text(json.dumps(value));bad=dict(path=binding['path'],sha256=S.hash_read(Path(binding['path']),S.MAX_JSON)[0])
            with self.assertRaisesRegex(ValueError,'allowed protected-source document'):S.load_citation_review(bad,self.l,S.protected_pair(self.l,{}),'cleanup',[r['path'] for r in self.l.exact()],self.auth)
    def test_reviewed_document_alias_and_active_usage_always_refuse(self):
        source=self.l.scratch/('proofofwork-ui-source-'+self.current);target=self.l.exact()[0]['path'];doc=source/'OP_RETURN_INFRASTRUCTURE.md';doc.write_text('Historical '+target+'\n');binding=self.citation_manifest('cleanup',[r['path'] for r in self.l.exact()],[(source,doc.name)])
        with patch.object(S,'git_document_blob',side_effect=self.fake_blob):
            admitted=S.load_citation_review(binding,self.l,S.protected_pair(self.l,{}),'cleanup',[r['path'] for r in self.l.exact()],self.auth);outside=self.base/'outside-scan';outside.mkdir();chain=outside/'alias';chain.symlink_to(doc);config=self.base/'installed-config.json';config.symlink_to(chain)
            with self.assertRaisesRegex(ValueError,'active-reviewed-document-pointer'):S.references([target],[config,source],proc=self.base/'no-proc',reviewed_files=admitted)
            config.unlink();config.symlink_to(source)
            with self.assertRaisesRegex(ValueError,'active-reviewed-document-pointer'):S.references([target],[config,source],proc=self.base/'no-proc',reviewed_files=admitted)
            config.unlink();config.write_text('read '+str(doc))
            with self.assertRaisesRegex(ValueError,'active-reviewed-document-content-pointer'):S.references([target],[config,source],proc=self.base/'no-proc',reviewed_files=admitted)
            config.unlink();proc=self.base/'fake-proc';process=proc/'123';process.mkdir(parents=True);(process/'fd').mkdir();(process/'fd'/'7').symlink_to(doc)
            with self.assertRaisesRegex(ValueError,'active-reviewed-document-pointer'):S.references([target],[source],proc=proc,reviewed_files=admitted)
            (process/'fd'/'7').unlink();(process/'fd'/'7').symlink_to(chain)
            with self.assertRaisesRegex(ValueError,'active-reviewed-document-pointer'):S.references([target],[source],proc=proc,reviewed_files=admitted)
            (process/'fd'/'7').unlink();(process/'cwd').symlink_to(source)
            with self.assertRaisesRegex(ValueError,'active-reviewed-document-pointer'):S.references([target],[source],proc=proc,reviewed_files=admitted)
            (process/'cwd').unlink();(process/'exe').symlink_to(doc)
            with self.assertRaisesRegex(ValueError,'active-reviewed-document-pointer'):S.references([target],[source],proc=proc,reviewed_files=admitted)
            (process/'exe').unlink();(process/'maps').write_text(str(doc))
            with self.assertRaisesRegex(ValueError,'active-reviewed-document-content-pointer'):S.references([target],[source],proc=proc,reviewed_files=admitted)
            with self.assertRaisesRegex(ValueError,'active-reviewed-document-content-pointer'):S.references([],[source],proc=proc,reviewed_files=admitted)
            config.write_text(str(doc))
            with self.assertRaisesRegex(ValueError,'active-reviewed-document-content-pointer'):S.references([],[config,source],proc=self.base/'no-proc',reviewed_files=admitted)
            config.unlink()
            (process/'maps').unlink();(process/'root').symlink_to('/')
            out=S.references([target],[source],proc=proc,reviewed_files=admitted);self.assertEqual(len(out['qualifiedHistoricalMatches']),1)
    def test_committed_document_blob_is_exact_and_nonexecutable(self):
        p=self.base/'git-document';subprocess.run(['git','init','-q',str(p)],check=True);doc=p/'OP_RETURN_INFRASTRUCTURE.md';doc.write_text('Historical record\n');subprocess.run(['git','-C',str(p),'add',doc.name],check=True);subprocess.run(['git','-C',str(p),'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'],check=True);head=subprocess.check_output(['git','-C',str(p),'rev-parse','HEAD'],text=True).strip();self.assertEqual(S.git_document_blob(p,doc.name,head),self.fake_blob(p,doc.name,head));doc.chmod(0o755);subprocess.run(['git','-C',str(p),'add',doc.name],check=True);subprocess.run(['git','-C',str(p),'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','exec fixture'],check=True);head=subprocess.check_output(['git','-C',str(p),'rev-parse','HEAD'],text=True).strip()
        with self.assertRaisesRegex(ValueError,'regular committed document'):S.git_document_blob(p,doc.name,head)
    def test_preservation_requires_completed_cleanup(self):
        with self.assertRaisesRegex(ValueError,'cleanup prerequisite'):S.create_plan(self.l,'preserve-sources',self.auth)
    def test_whole_source_preservation_and_inverse(self):
        done=self.cleanup();plan=S.create_plan(self.l,'preserve-sources',self.auth,prerequisite=done);out=S.execute(plan,S.digest(plan),self.l,True)
        for r in plan['moves']:
            self.assertFalse(os.path.lexists(r['source']));self.assertTrue(Path(r['target']).exists());self.assertEqual((Path(r['target'])/'.git'/'config').read_text(),'preserve this unique metadata\n');S.match_snapshot(S.snapshot(Path(r['target']),links=True),r['snapshot'],relocation=True)
        inverse=S.create_plan(self.l,'inverse-preservation',self.auth,inverse_receipt=dict(path=out['receiptPath'],sha256=out['receiptSha256']));S.execute(inverse,S.digest(inverse),self.l,True)
        self.assertTrue(all(Path(r['source']).exists() for r in self.l.moves()))
    def test_source_absolute_symlink_and_xattr_corruption(self):
        p=self.base/'source';p.mkdir();(p/'file').write_text('x');(p/'link').symlink_to(str(p/'file'))
        with self.assertRaisesRegex(ValueError,'Absolute'):S.snapshot(p,links=True)
        (p/'link').unlink();os.setxattr(p/'file','user.audit30',b'preserve');before=S.snapshot(p);os.setxattr(p/'file','user.audit30',b'changed')
        with self.assertRaises(ValueError):S.match_snapshot(S.snapshot(p),before)
    def test_partial_deletion_failure_has_durable_receipt(self):
        plan=self.plan();real=S.shutil.rmtree;count=0
        def fail_second(*args,**kwargs):
            nonlocal count
            count+=1
            if count==2:raise OSError('fixture interrupted')
            return real(*args,**kwargs)
        with patch.object(S.shutil,'rmtree',side_effect=fail_second):
            with self.assertRaises(OSError):S.execute(plan,S.digest(plan),self.l,True)
        failures=list(self.l.evidence.glob('*failed.json'));self.assertEqual(len(failures),1);r=json.loads(failures[0].read_text());self.assertEqual(len(r['completed']),1);self.assertEqual(r['status'],'failed');self.assertTrue(Path(plan['delete'][1]['path']).exists())
    def test_git_alternates_and_dirty_status_refuse(self):
        self.source_patch.stop();p=self.base/'git-source';subprocess.run(['git','init','-q',str(p)],check=True);(p/'file').write_text('one');subprocess.run(['git','-C',str(p),'add','file'],check=True);subprocess.run(['git','-C',str(p),'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'],check=True)
        S.source_pointers(p);(p/'.git'/'objects'/'info'/'alternates').write_text('/external')
        with self.assertRaisesRegex(ValueError,'external'):S.source_pointers(p)
        (p/'.git'/'objects'/'info'/'alternates').unlink();(p/'file').write_text('two')
        with self.assertRaisesRegex(ValueError,'local changes'):S.source_pointers(p)
        self.source_patch.start()
    def test_git_configuration_and_index_flags_refuse(self):
        self.source_patch.stop();p=self.base/'git-source';subprocess.run(['git','init','-q',str(p)],check=True);(p/'file').write_text('one');subprocess.run(['git','-C',str(p),'add','file'],check=True);subprocess.run(['git','-C',str(p),'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'],check=True)
        subprocess.run(['git','-C',str(p),'config','core.worktree',str(p)],check=True)
        with self.assertRaisesRegex(ValueError,'configuration pointer'):S.source_pointers(p)
        subprocess.run(['git','-C',str(p),'config','--unset','core.worktree'],check=True);subprocess.run(['git','-C',str(p),'update-index','--assume-unchanged','file'],check=True)
        with self.assertRaisesRegex(ValueError,'index flags'):S.source_pointers(p)
    def test_promisor_dependencies_refuse_before_git_status(self):
        self.source_patch.stop();p=self.base/'promisor-source';subprocess.run(['git','init','-q',str(p)],check=True);(p/'file').write_text('one');subprocess.run(['git','-C',str(p),'add','file'],check=True);subprocess.run(['git','-C',str(p),'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'],check=True)
        for key,value in [('extensions.partialclone','origin'),('remote.origin.promisor','true'),('remote.origin.partialclonefilter','blob:none')]:
            subprocess.run(['git','-C',str(p),'config',key,value],check=True)
            with self.assertRaisesRegex(ValueError,'configuration pointer'):S.source_pointers(p)
            subprocess.run(['git','-C',str(p),'config','--unset',key],check=True)
        (p/'.git'/'objects'/'pack'/'fixture.promisor').write_text('')
        with self.assertRaisesRegex(ValueError,'promisor objects'):S.source_pointers(p)
        self.source_patch.start()
    def test_git_filter_driver_refused_before_any_execution(self):
        self.source_patch.stop();p=self.base/'filter-source';subprocess.run(['git','init','-q',str(p)],check=True);(p/'file').write_text('one');(p/'.gitattributes').write_text('file filter=audit30\n');subprocess.run(['git','-C',str(p),'add','.'],check=True);subprocess.run(['git','-C',str(p),'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'],check=True)
        sentinel=self.base/'must-not-exist';subprocess.run(['git','-C',str(p),'config','filter.audit30.clean','touch '+str(sentinel)+'; cat'],check=True)
        # Force a content check; the dangerous filter must be refused before status.
        (p/'file').write_text('one')
        with self.assertRaisesRegex(ValueError,'configuration pointer'):S.source_pointers(p)
        self.assertFalse(sentinel.exists());self.source_patch.start()
    def policy_index(self,admissions,retirements=None):
        rows=[]
        for i,a in enumerate(admissions):
            p=self.l.evidence/('audit30-policy-admission-'+str(i)+'.json')
            if not p.exists():S.durable(p,a)
            rows.append(dict(path=str(p),sha256=S.hash_read(p,S.MAX_JSON)[0]))
        value=dict(schema='pow-audit30-ui-admission-index-v1',scopeApprovalSha256=self.auth,admissions=rows,completedRetirements=retirements or [])
        p=self.base/('index-'+str(len(list(self.base.glob('index-*'))))+'.json');S.durable(p,value);return dict(path=str(p),sha256=S.hash_read(p,S.MAX_JSON)[0])
    def test_future_bootstrap_chain_exact_policy_and_missing_loss(self):
        with patch.object(P,'S',S):
            bootstrap=P.admission(self.l,self.auth,True);index=self.policy_index([bootstrap])
            self.assertEqual(P.policy_scope(index,self.l,self.auth)['eligible'],[])
            new='abcdef123456-20261002T220000Z';os.rename(self.l.live,self.l.roots/('proofofwork-www-pre-'+new));self.release(self.l.live,new)
            src=self.l.scratch/('proofofwork-ui-source-'+new);src.mkdir();(src/'.git').mkdir();(src/'source').write_text('new source')
            (src/'node_modules').mkdir();(src/'node_modules'/'dep').write_text('new runtime');self.dependency_provenance(self.l.live,new)
            added=P.admission(self.l,self.auth,False,index);index=self.policy_index([bootstrap,added]);scope=P.policy_scope(index,self.l,self.auth);self.assertEqual(len(scope['eligible']),4)
            self.assertTrue(all(self.previous in r['path'] or r['kind']=='rollback-root' for r in scope['eligible']))
            plan=S.create_plan(self.l,'future-retention',self.auth,scope);out=S.execute(plan,S.digest(plan),self.l,True)
            with self.assertRaisesRegex(ValueError,'Unreconciled missing'):P.policy_scope(index,self.l,self.auth)
            updated=self.policy_index([bootstrap,added],[dict(path=out['receiptPath'],sha256=out['receiptSha256'])]);self.assertEqual(P.policy_scope(updated,self.l,self.auth)['eligible'],[])
            self.assertTrue((self.l.roots/('proofofwork-www-pre-'+S.ROOT_IDS[0])).exists());self.assertTrue((self.l.scratch/('proofofwork-ui-source-'+self.previous)).exists())
    def test_future_rejects_forged_history_or_partial_assets(self):
        with patch.object(P,'S',S):
            bootstrap=P.admission(self.l,self.auth,True);bad=json.loads(json.dumps(bootstrap));bad['archives']=bad['archives'][:1]
            index=self.policy_index([bad])
            with self.assertRaisesRegex(ValueError,'Partial'):P.policy_scope(index,self.l,self.auth)
    def test_postpublication_policy_requires_fresh_exact_citation_review(self):
        with patch.object(P,'S',S),patch.object(S,'git_document_blob',side_effect=self.fake_blob):
            old_source=self.l.scratch/('proofofwork-ui-source-'+self.current);(old_source/'OP_RETURN_INFRASTRUCTURE.md').write_text('Historical '+self.l.exact()[0]['path']+'\n');old=self.citation_manifest('cleanup',[r['path'] for r in self.l.exact()],[(old_source,'OP_RETURN_INFRASTRUCTURE.md')]);bootstrap=P.admission(self.l,self.auth,True);index=self.policy_index([bootstrap])
            new='abcdef123456-20261002T220000Z';os.rename(self.l.live,self.l.roots/('proofofwork-www-pre-'+new));self.release(self.l.live,new);source=self.l.scratch/('proofofwork-ui-source-'+new);source.mkdir();(source/'.git').mkdir();(source/'node_modules').mkdir();(source/'node_modules'/'dep').write_text('new runtime');self.dependency_provenance(self.l.live,new);added=P.admission(self.l,self.auth,False,index);index=self.policy_index([bootstrap,added]);scope=P.policy_scope(index,self.l,self.auth);targets=[r['path'] for r in scope['eligible']];(source/'audits').mkdir();doc=source/'audits'/'release.md';doc.write_text('Historical verified prior recovery: '+targets[0]+'\nHistorical archive: '+next(p for p in targets if p.endswith('.tgz'))+'\n')
            with self.assertRaisesRegex(ValueError,'references'):S.create_plan(self.l,'future-retention',self.auth,scope)
            with self.assertRaisesRegex(ValueError,'scope/source/approval'):S.create_plan(self.l,'future-retention',self.auth,scope,citation_review=old)
            binding=self.citation_manifest('future-retention',targets,[(source,'audits/release.md')]);plan=S.create_plan(self.l,'future-retention',self.auth,scope,citation_review=binding);self.assertEqual(len(plan['references']['qualifiedHistoricalMatches']),1);out=S.execute(plan,S.digest(plan),self.l,True);self.assertEqual(out['completedCount'],4);self.assertTrue(doc.exists());self.assertEqual(doc.read_text().count('Historical'),2)

    def test_shared_protected_inode_survives_complete_cleanup(self):
        shared=self.l.live/'proofofwork-work'/'index.html';old=self.l.roots/('proofofwork-www-pre-'+S.ROOT_IDS[0])/'proofofwork-work'/'index.html';old.unlink();os.link(shared,old)
        plan=self.plan();S.execute(plan,S.digest(plan),self.l,True);self.assertEqual(shared.read_text(),'surface work');self.assertEqual(shared.stat().st_nlink,1)
    def test_atomic_rename_never_overwrites_existing_target(self):
        p=self.base/'original';q=self.base/'occupied';p.mkdir();q.mkdir();(p/'bytes').write_text('preserve')
        with self.assertRaises(OSError):S.rename_no_replace(p,q)
        self.assertTrue(p.exists());self.assertTrue(q.exists());self.assertTrue((p/'bytes').exists())
    def test_runtime_provenance_mismatch_refuses(self):
        (self.l.scratch/('proofofwork-ui-source-'+self.current)/'node_modules'/'ignored.bin').write_bytes(b'altered')
        with self.assertRaisesRegex(ValueError,'runtime dependencies differ'):self.plan()
    def test_malformed_archive_directory_mode_refuses(self):
        root=self.l.roots/('proofofwork-www-pre-'+S.ROOT_IDS[0]);fields,_,_=S.manifest(root);p=self.l.archives/fields['archive_name']
        with tarfile.open(p,'w:gz') as t:
            info=tarfile.TarInfo('surfaces');info.type=tarfile.DIRTYPE;info.mode=0o700;info.uid=os.getuid();info.gid=os.getgid();t.addfile(info)
            for name in S.SURFACES:
                def alter(member):
                    if member.isdir():member.mode=0o777
                    return member
                t.add(root/('proofofwork-'+name),arcname='surfaces/'+name,filter=alter)
        fields['archive_sha256']=hashlib.sha256(p.read_bytes()).hexdigest();raw=''.join(k+'='+v+'\n' for k,v in fields.items());(root/'.proofofwork-ui-release').write_text(raw);Path(str(p)+'.provenance').write_text(raw);Path(str(p)+'.sha256').write_text(fields['archive_sha256']+'  '+p.name+'\n')
        with self.assertRaisesRegex(ValueError,'directory mode'):self.plan()
    def test_canonical_private_archive_wrapper_and_refusals(self):
        # Retained production265 uses0700 surfaces wrapper and0755 rendered dirs.
        root=self.l.live;fields,_,_=S.manifest(root);p=self.l.archives/fields['archive_name']
        for mode,uid,gid,accept in [(0o700,os.getuid(),os.getgid(),True),(0o755,os.getuid(),os.getgid(),True),(0o000,os.getuid(),os.getgid(),False),(0o777,os.getuid(),os.getgid(),False),(0o700,os.getuid()+1,os.getgid(),False),(0o700,os.getuid(),os.getgid()+1,False)]:
            with tarfile.open(p,'w:gz') as t:
                info=tarfile.TarInfo('surfaces');info.type=tarfile.DIRTYPE;info.mode=mode;info.uid=uid;info.gid=gid;t.addfile(info)
                for name in S.SURFACES:t.add(root/('proofofwork-'+name),arcname='surfaces/'+name)
            fields['archive_sha256']=hashlib.sha256(p.read_bytes()).hexdigest();raw=''.join(k+'='+v+'\n' for k,v in fields.items());(root/'.proofofwork-ui-release').write_text(raw);Path(str(p)+'.provenance').write_text(raw);Path(str(p)+'.sha256').write_text(fields['archive_sha256']+'  '+p.name+'\n')
            if accept:S.release_proof(root,self.l,{})
            else:
                with self.assertRaisesRegex(ValueError,'surfaces archive root'):S.release_proof(root,self.l,{})
    def test_actual_sigterm_after_rename_preserves_inverse_evidence(self):
        code=r'''
import importlib.machinery,importlib.util,json,os,signal,sys
from pathlib import Path
loader=importlib.machinery.SourceFileLoader('signal_fixture',sys.argv[1]);spec=importlib.util.spec_from_loader(loader.name,loader);m=importlib.util.module_from_spec(spec);loader.exec_module(m)
t=m.StorageTests();t.setUp()
try:
 done=t.cleanup();plan=m.S.create_plan(t.l,'preserve-sources',t.auth,prerequisite=done);rename=m.S.rename_no_replace;count=0
 def interrupt_after_move(left,right):
  global count
  rename(left,right);count+=1
  if count==1:os.kill(os.getpid(),signal.SIGTERM)
 m.S.rename_no_replace=interrupt_after_move
 try:m.S.execute(plan,m.S.digest(plan),t.l,True)
 except InterruptedError:pass
 failed=sorted(t.l.evidence.glob('*preserve-sources*failed.json'))[-1];value=json.loads(failed.read_text());assert value['errorClass']=='InterruptedError' and value['completed']==[]
 inverse=m.S.create_plan(t.l,'inverse-preservation',t.auth,inverse_receipt=dict(path=str(failed),sha256=m.S.hash_read(failed,m.S.MAX_JSON)[0]));assert len(inverse['moves'])==1;m.S.execute(inverse,m.S.digest(inverse),t.l,True)
 assert all(Path(r['source']).exists() and not Path(r['target']).exists() for r in t.l.moves());print(json.dumps({'gracefulSignalFailedReceipt':True,'inverseRecovered':True}))
finally:t.tearDown()
'''
        out=subprocess.run(['/usr/bin/python3','-I','-B','-c',code,str(Path(__file__).resolve())],capture_output=True,text=True,timeout=45)
        self.assertEqual(out.returncode,0,out.stderr);self.assertEqual(json.loads(out.stdout),dict(gracefulSignalFailedReceipt=True,inverseRecovered=True))


if __name__=='__main__':unittest.main()
