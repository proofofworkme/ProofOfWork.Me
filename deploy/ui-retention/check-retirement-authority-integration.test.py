#!/usr/bin/env python3
"""Genuine stock authority fixture foundation. No production paths/actions.

Executes stock history, authentic package/fixture state seed, pending admission,
real four-payload removal, receipt/state transition and fresh Runtime.status.
Explicit test namespaces/pins and initial-condition seed are recorded.
"""
import contextlib
import importlib.util
import json
import atexit
import ast
import base64
import stat
import tarfile
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import hashlib
import re
import shutil
import subprocess
import tempfile
import os
from pathlib import Path
import unittest
from unittest.mock import patch
ORIGINAL_HERE=Path(__file__).resolve().parent
SOURCE_AREA=tempfile.TemporaryDirectory(prefix='authority-source-')
atexit.register(SOURCE_AREA.cleanup)
SOURCE_ROOT=Path(SOURCE_AREA.name)
SOURCE_SUBSTITUTIONS={}
def build_git_source_copies():
    # These are test-only copies. No production module accepts override pins.
    original=ORIGINAL_HERE.parent
    candidates=list(ORIGINAL_HERE.glob('*.py'))+[
        original/'audit30/ui-storage.py',original/'audit30/ui-release-policy.py',
        original/'audit30/check-ui-storage.test.py',original/'proofofwork-ui-capacity.py']
    raws={p.relative_to(original):p.read_text() for p in candidates}
    fixture_text=raws[Path('audit30/check-ui-storage.test.py')]
    # Include fixed production fixture releases and our six synthetic cycles.
    ids=set(re.findall(r'[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z','\n'.join(raws.values())))
    ids.update('aaaaaaaa000%d-%s'%(i,date) for i,date in [
        (3,'20261101T010000Z'),(4,'20261103T010000Z'),
        (5,'20261104T010000Z'),(6,'20261105T010000Z')])
    repositories=SOURCE_ROOT/'git-templates';repositories.mkdir()
    mapping={};metadata={}
    env={'PATH':'/usr/bin:/bin','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null',
         'GIT_AUTHOR_NAME':'Fixture','GIT_AUTHOR_EMAIL':'fixture@example.invalid',
         'GIT_COMMITTER_NAME':'Fixture','GIT_COMMITTER_EMAIL':'fixture@example.invalid',
         'GIT_AUTHOR_DATE':'2000-01-01T00:00:00Z','GIT_COMMITTER_DATE':'2000-01-01T00:00:00Z'}
    for old in sorted(ids):
        folder=repositories/old;folder.mkdir()
        (folder/'tracked.txt').write_text('synthetic immutable source '+old+'\n')
        (folder/'.gitignore').write_text('node_modules/\n')
        git=['/usr/bin/git','-c','core.hooksPath=/dev/null','-C',str(folder)]
        subprocess.run(git+['init','-q'],env=env,check=True,capture_output=True)
        subprocess.run(git+['add','.'],env=env,check=True,capture_output=True)
        subprocess.run(git+['commit','-qm','Synthetic authority fixture'],env=env,check=True,capture_output=True)
        head=subprocess.check_output(git+['rev-parse','HEAD'],env=env,text=True).strip()
        tree=subprocess.check_output(git+['rev-parse','HEAD^{tree}'],env=env,text=True).strip()
        new=head[:12]+old[12:];target=repositories/new;folder.rename(target)
        (target/'node_modules').mkdir();(target/'node_modules/ignored.bin').write_bytes(b'fixture dependency')
        mapping[old]=new;metadata[new]={'head':head,'tree':tree,'template':str(target)}
    # Only source constructors/manifest fixture data change. All validators stay real.
    fixture_text=fixture_text.replace(
        "fields=dict(format=release_format,release_id=rid,commit=rid.split('-')[0]+'0'*28,source_tree='1'*40,",
        "fields=dict(format=release_format,release_id=rid,commit=GIT_FIXTURES[rid]['head'],source_tree=GIT_FIXTURES[rid]['tree'],")
    oldline=r"p=self.l.scratch/('proofofwork-ui-source-'+rid);p.mkdir();(p/'.git').mkdir();(p/'.git'/'config').write_text('preserve this unique metadata\n');(p/'tracked.txt').write_text('source\n');(p/'node_modules').mkdir();(p/'node_modules'/'ignored.bin').write_bytes(b'preserve dependencies\x00')"
    assert oldline in fixture_text
    fixture_text=fixture_text.replace(oldline,"p=self.l.scratch/('proofofwork-ui-source-'+rid);shutil.copytree(GIT_FIXTURES[rid]['template'],p)")
    oldline=r"source=self.l.scratch/('proofofwork-ui-source-'+rid);source.mkdir();(source/'.git').mkdir();(source/'source').write_text('new immutable source');(source/'node_modules').mkdir();(source/'node_modules'/'dep').write_text('new verified runtime')"
    assert oldline in fixture_text
    fixture_text=fixture_text.replace(oldline,"source=self.l.scratch/('proofofwork-ui-source-'+rid);shutil.copytree(GIT_FIXTURES[rid]['template'],source)")
    fixture_text=fixture_text.replace("patch.object(S,'source_pointers',side_effect=source)",
                                      "patch.object(S,'source_pointers',wraps=S.source_pointers)")
    fixture_text=fixture_text.replace('import hashlib\n','import hashlib\nimport shutil\n')
    # Metadata inserted after literal ID substitution so template paths are not remapped twice.
    raws[Path('audit30/check-ui-storage.test.py')]=fixture_text
    for relative,raw in raws.items():
        for old,new in mapping.items():raw=raw.replace(old,new)
        if relative==Path('audit30/check-ui-storage.test.py'):
            raw=raw.replace("S=load('audit30_storage_test'",'GIT_FIXTURES='+repr(metadata)+"\nS=load('audit30_storage_test'")
        out=SOURCE_ROOT/'deploy'/relative;out.parent.mkdir(parents=True,exist_ok=True);out.write_text(raw)
    writer=hashlib.sha256((SOURCE_ROOT/'deploy/audit30/ui-storage.py').read_bytes()).hexdigest()
    policy=SOURCE_ROOT/'deploy/audit30/ui-release-policy.py'
    with policy.open('a') as stream:
        stream.write('\n# Exact synthetic source-copy writer authority, fixture only.\nKNOWN_RETIREMENT_CONTROLLERS.add('+repr(writer)+')\n')
    SOURCE_SUBSTITUTIONS['policy.exactFixtureWriterSha256']=writer
    SOURCE_SUBSTITUTIONS['releaseIdToRealGitCommit']=mapping
    SOURCE_SUBSTITUTIONS['gitTemplates']={k:{x:v[x] for x in ('head','tree')} for k,v in metadata.items()}
    return SOURCE_ROOT/'deploy/ui-retention'
HERE=build_git_source_copies()
spec=importlib.util.spec_from_file_location('authority_lifecycle_fixtures',HERE/'check-lifecycle-remote.test.py')
T=importlib.util.module_from_spec(spec);spec.loader.exec_module(T)
F,L=T.F,T.R

class AuthorityIntegration(unittest.TestCase):
    def setUp(self):
        T.RemoteTests.setUp(self)
        if os.environ.get('POW_AUTHORITY_FIXTURE_KEEP')=='1':
            self.fixture.tmp._finalizer.detach()
            self.fixture.tmp.cleanup=lambda:None
            SOURCE_AREA._finalizer.detach()
            atexit.unregister(SOURCE_AREA.cleanup)
        self.capacity.stop()  # Real capacity admission, never a success mock.
        self.fixture.capacity_patch.stop()
        original=(HERE.parent/'proofofwork-ui-capacity.py').read_text()
        replacements={'/var/backups/proofofwork-ui':str(self.layout.base),
                      '/var/tmp/proofofwork-deploy':str(self.layout.scratch)}
        candidate=original
        for old,new in replacements.items():candidate=candidate.replace(old,new)
        self.layout.capacity.write_text(candidate)
        self.layout.capacity.chmod(0o700)
        self.capacity_substitutions=replacements

    tearDown=T.RemoteTests.tearDown
    initialize=T.RemoteTests.initialize
    https=T.RemoteTests.https
    prepare=T.RemoteTests.prepare
    vps_prepared=T.RemoteTests.vps_prepared
    vps_complete=T.RemoteTests.vps_complete
    publish_vps_fixture=T.RemoteTests.publish_vps_fixture

    def bootstrap_installed_package(self, overrides=None, activate=True):
        global L
        repository=ORIGINAL_HERE.parents[1]
        members={}
        for name in T.I.FILES:
            source=SOURCE_ROOT/name
            if not source.exists():source=repository/name
            raw=source.read_bytes()
            if name.endswith('.py'):
                value=raw.decode()
                if name=='deploy/audit30/ui-storage.py':
                    value=value.replace("def __init__(self, prefix=Path('/')):",
                                        "def __init__(self, prefix=Path("+repr(str(self.fixture.base))+")):")
                    value+='\n# Exact synthetic held authority, fixture source only.\n'
                    value+='APPROVAL_SHA='+repr(self.fixture.auth)+'\n'
                    for key in ('HELD_SHA','HOLD_SHA','ROTATION_CONFIG_PINS','PRESERVED_FALLBACK_PREDECESSOR','PRESERVED_FALLBACK_INTRODUCER','PRESERVED_1042_PREDECESSOR','PRESERVED_1042_INTRODUCER'):
                        value+=key+'='+repr(getattr(F.S,key))+'\n'
                elif name=='deploy/audit30/ui-release-policy.py':
                    for key in ('FALLBACK_ADMISSION_SHA256','PRESERVED_1042_ADMISSIONS'):
                        value+='\n'+key+'='+repr(getattr(F.P,key))+'\n'
                elif name=='deploy/ui-retention/lifecycle_remote.py':
                    for old in ('/etc/proofofwork-retention','/var/lib/proofofwork-ui-retention',
                                '/var/backups/proofofwork-ui','/var/tmp/proofofwork-deploy'):
                        value=value.replace(old,str(self.fixture.base/old.lstrip('/')))
                raw=value.encode()
            members[name]=raw
        if overrides:members.update(overrides)
        writer=hashlib.sha256(members['deploy/audit30/ui-storage.py']).hexdigest()
        policy='deploy/audit30/ui-release-policy.py'
        members[policy]+=("\n# Exact fixture installed writer.\nKNOWN_RETIREMENT_CONTROLLERS.add("+repr(writer)+")\n").encode()
        operator_source=self.fixture.base/('operator-source-'+str(len(list(self.fixture.base.glob('operator-source-*')))))
        operator_source.mkdir(mode=0o700)
        for name,raw in members.items():
            path=operator_source/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
        git=['/usr/bin/git','-c','core.hooksPath=/dev/null','-C',str(operator_source)]
        env={'PATH':'/usr/bin:/bin','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null',
             'GIT_AUTHOR_NAME':'Fixture','GIT_AUTHOR_EMAIL':'fixture@example.invalid',
             'GIT_COMMITTER_NAME':'Fixture','GIT_COMMITTER_EMAIL':'fixture@example.invalid'}
        for command in (['init','-q'],['add','.'],['commit','-qm','Exact generated authority package']):
            subprocess.run(git+command,env=env,check=True,capture_output=True)
        commit=subprocess.check_output(git+['rev-parse','HEAD'],env=env,text=True).strip()
        tree=subprocess.check_output(git+['rev-parse','HEAD^{tree}'],env=env,text=True).strip()
        manifest={'schema':'pow-ui-retention-package-v1','sourceCommit':commit,'sourceTree':tree,
                  'files':{name:{'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
                           for name,raw in members.items()}}
        encoded=L.encoded(manifest);package_sha=L.sha(encoded)
        package=self.layout.evidence/('ui-lifecycle-tools-'+package_sha)
        package.mkdir(mode=0o700)
        for name,raw in members.items():
            path=package/name;path.parent.mkdir(parents=True,exist_ok=True)
            path.write_bytes(raw);path.chmod(0o600)
        (package/'package.json').write_bytes(encoded)
        config_path=self.fixture.base/'etc/proofofwork-retention/ui-lifecycle.json'
        state_path=self.fixture.base/'var/lib/proofofwork-ui-retention/state.json'
        state_path.parent.mkdir(parents=True,exist_ok=True)
        config={'schema':'pow-ui-retention-lifecycle-config-v1','scopeApprovalSha256':L.APPROVAL_SHA,
                'statePath':str(state_path),'retentionPolicy':L.VPS_POLICY,'offHostCustodyRoot':None,
                'package':{'path':str(package),'sha256':package_sha},
                'sourceCommit':manifest['sourceCommit'],'sourceTree':manifest['sourceTree'],
                'controller':{'path':str(package/'deploy/ui-retention/lifecycle_remote.py'),
                              'sha256':manifest['files']['deploy/ui-retention/lifecycle_remote.py']['sha256']},
                'approval':{'path':str(package/T.I.FILES[0]),'sha256':L.APPROVAL_SHA}}
        if not activate:return package,config,manifest,members
        config_path.write_bytes(L.encoded(config));config_path.chmod(0o600)
        config_sha=L.sha(config_path.read_bytes())
        spec=importlib.util.spec_from_file_location('authority_installed_lifecycle',package/'deploy/ui-retention/lifecycle_remote.py')
        installed=importlib.util.module_from_spec(spec);spec.loader.exec_module(installed)
        runtime=installed.installed_runtime(config_path,config_sha)
        # All subsequent fixture writers and readers use the actually installed modules.
        self.original_modules=(F.S,F.P,T.R)
        self.addCleanup(self.restore_modules)
        F.S,F.P,T.R=runtime.S,runtime.P,installed
        L=installed
        self.runtime=runtime;self.layout=runtime.layout
        self.config=config;self.state=state_path.parent
        self.initial_package={'path':str(package),'sha256':package_sha}
        self.initial_config_sha=config_sha

    def restore_modules(self):
        global L
        F.S,F.P,T.R=self.original_modules
        L=T.R

    def execute_historical_completion(self,index):
        scope=F.P.policy_scope(index,self.layout,L.APPROVAL_SHA)
        plan=F.S.create_plan(self.layout,'future-retention',L.APPROVAL_SHA,scope)
        if not plan['delete'] and scope.get('preservedFallback'):
            rule={'model':'private-stage-zero-retirement-v1','wouldRetire':[]}
            for key in ('preservedFallback','preservedRelease1042'):
                if scope.get(key):rule[key]=scope[key]
            plan['privateStageRetention']={'forecast':rule,
                'releasePlanSha256':L.sha(L.encoded({'syntheticPublication':rule})),
                'publicationReceiptSha256':L.sha(L.encoded({'syntheticPublicationReceipt':rule}))}
        plan_binding=self.fixture.policy_record('audit30-historical-plan-',plan)
        result=F.S.execute(plan,F.S.digest(plan),self.layout,True)
        receipt={'path':result['receiptPath'],'sha256':result['receiptSha256']}
        value,_=L.read_json(index['path'],index['sha256'])
        index=self.fixture.policy_record('audit30-policy-admission-index-historical-',
            dict(value,completedRetirements=[*value['completedRetirements'],receipt]))
        F.P.load_index(index['path'],index['sha256'],self.layout,L.APPROVAL_SHA)
        return index,plan_binding,receipt

    def authority_foundation(self):
        # Historical policy/storage records predate lifecycle installation.
        # They are executed by stock validators, not fabricated lifecycle events.
        _,_,_,_,index=self.fixture.migration_fixture()
        index,plan,receipt=self.execute_historical_completion(index)
        oldids=['aaaaaaaa0003-20261101T010000Z','aaaaaaaa0004-20261103T010000Z',
                'aaaaaaaa0005-20261104T010000Z','aaaaaaaa0006-20261105T010000Z']
        older,held,prior,current=[SOURCE_SUBSTITUTIONS['releaseIdToRealGitCommit'][x] for x in oldids]
        substitutions={'capacity.literalNamespaces':self.capacity_substitutions,
                       'sourceCopy':SOURCE_SUBSTITUTIONS}
        for ordinal,release in enumerate((older,held,prior,current)):
            self.fixture.publish_policy_fixture(release,F.S.V5_SURFACES,'proofofwork-ui-release-v5')
            admission=F.P.admission(self.layout,L.APPROVAL_SHA,False,index)
            binding=self.fixture.policy_record('audit30-policy-admission-historical-',admission)
            value,_=L.read_json(index['path'],index['sha256'])
            value=dict(value,admissions=[*value['admissions'],binding])
            index=self.fixture.policy_record('audit30-policy-admission-index-historical-',value)
            changes=()
            if ordinal in (1,2):
                pins={'archive':value['admissions'][-2]['sha256'],'root':value['admissions'][-1]['sha256']}
                changes=((F.S,'PRESERVED_FALLBACK_PREDECESSOR',older),
                         (F.S,'PRESERVED_FALLBACK_INTRODUCER',held),
                         (F.P,'FALLBACK_ADMISSION_SHA256',pins)) if ordinal==1 else (
                         (F.S,'PRESERVED_1042_PREDECESSOR',held),
                         (F.S,'PRESERVED_1042_INTRODUCER',prior),
                         (F.P,'PRESERVED_1042_ADMISSIONS',pins))
            index,plan,receipt=self.execute_historical_completion(index)
            # Establish the historical hold only after its introducer cycle;
            # the relevant payload was already protected as current/previous.
            for module,name,value in changes:
                patcher=patch.object(module,name,value);patcher.start();self.addCleanup(patcher.stop)
                substitutions[name]=value
        historical_index=index
        # Freeze known historical pins before package/config creation. No old
        # package/config or lifecycle receipt is rewritten to adopt this seed.
        self.bootstrap_installed_package()
        pair,context=self.runtime.current()
        seed={'schema':'pow-ui-retention-lifecycle-state-v1',
              'configSha256':self.initial_config_sha,'revision':1,'status':'complete',
              'pending':None,'activePhase':None,'index':historical_index,
              'completedContext':context,'lastIntent':None,'lastUpgrade':{},
              'lastCompleted':{'cycleId':'fixture-stock-baseline-'+current,
                  'retentionPolicy':L.VPS_POLICY,'retainedPair':context['pair'],
                  'ordinaryPlan':plan,'ordinaryReceipt':receipt}}
        L.write_new(self.runtime.state_path,L.encoded(seed))
        derivation={'kind':'explicit-fixture-initial-condition-not-import-api',
                    'configSha256':self.initial_config_sha,'index':historical_index,
                    'executedStockPlan':plan,'executedStockCompletion':receipt,
                    'initialRevision':1,'lastIntent':None,
                    'contextDerivation':'fresh protected_pair+safeguards+manifest hashes',
                    'noLifecycleHistoryFabricated':True}
        self.fixture.policy_record('authority-fixture-seed-derivation-',derivation)
        fresh=L.installed_runtime(L.CONFIG_PATH,self.initial_config_sha)
        fd=F.S.lock(self.layout);fresh.lock_fd=fd
        try:status=fresh.status({'requireComplete':True})
        finally:fresh.lock_fd=None;os.close(fd)
        self.assertEqual(status['pair'],{'current':current,'previous':prior})
        self.assertTrue(status['retentionComplete'])
        paths=F.S.preserved_fallback_paths(self.layout)+F.S.preserved_1042_paths(self.layout)
        selected=[p for p in paths if p.endswith('.tgz') or Path(p).is_dir()]
        self.assertEqual(len(selected),4)
        return {'stage':'authenticated-historical-stock-seed',
                'initialInstalledPackage':self.initial_package,
                'qualifiedTerminalRetirement':False,'realRuntimeStatus':status,
                'stateSha256':status['stateSha256'],'selectedPayloadPaths':selected,
                'seedDerivation':derivation,'substitutions':substitutions,
                'inheritedFixtureBoundaries':['temporary namespace','synthetic publication metadata',
                    'explicit initial state seed from genuinely executed stock completion'],
                'nextBoundary':'Generate exact proposal/restore/package bindings and real StockGuard admission'}

    def retire_fixture(self,baseline):
        def load(name,path):
            spec=importlib.util.spec_from_file_location(name,path)
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
        def assign(raw,values):
            tree=ast.parse(raw);lines=raw.splitlines(keepends=True)
            edits=[]
            for node in tree.body:
                if isinstance(node,ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name):
                    name=node.targets[0].id
                    if name in values:edits.append((node.lineno-1,node.end_lineno,name))
            self.assertEqual({name for _,_,name in edits},set(values))
            for start,end,name in sorted(edits,reverse=True):
                lines[start:end]=[name+' = '+repr(values[name])+'\n']
            return ''.join(lines)
        base=self.fixture.base
        # Descriptor inventory is real; production paths are never passed to it.
        helper=load('authority_inventory_source',HERE/'inventory.py')
        fallback=F.S.preserved_fallback_paths(self.layout)
        second=F.S.preserved_1042_paths(self.layout)
        selected=[second[1],second[0],fallback[1],fallback[0]]
        trees=[];equivalents=[];sidecars=[]
        for selected_path in selected:
            path=Path(selected_path)
            frozen=(helper.inventory_file_group(path,[path.name]) if path.is_file()
                    else helper.inventory(path))
            rows=[]
            for row in frozen['records']:
                info=row['identity'];absolute=str(path if path.is_file() else path/row['path'])
                record={'path':absolute,'type':'file' if row['kind']=='file' else 'dir',
                    'device':info['st_dev'],'inode':info['st_ino'],'nlink':info['st_nlink'],
                    'mode':stat.S_IMODE(info['st_mode']),'uid':info['st_uid'],'gid':info['st_gid'],
                    'size':info['st_size'],'mtimeNs':info['st_mtime_ns'],'ctimeNs':info['st_ctime_ns']}
                if row['kind']=='file':record['sha256']=row['sha256']
                rows.append(record)
                if path.is_dir() and row['path'] not in ('.','.proofofwork-ui-release'):
                    target=self.layout.live/row['path']
                    self.assertEqual(stat.S_IMODE(target.lstat().st_mode),record['mode'])
                    if row['kind']=='file':
                        self.assertEqual(F.S.hash_read(target)[0],record['sha256'])
                    equivalents.append({'source':absolute,'equal':True})
            entry={'root':str(path),'records':rows}
            if path.is_dir():
                entry['preservedManifestBase64']=base64.b64encode((path/'.proofofwork-ui-release').read_bytes()).decode()
            else:
                for suffix in ('.sha256','.provenance'):
                    q=Path(str(path)+suffix);sidecars.append({'path':str(q),'sha256':F.S.hash_read(q)[0]})
            trees.append(entry)
        pair=F.S.protected_pair(self.layout,{})
        retained={k:pair[k]['fields']['release_id'] for k in ('current','previous')}
        previous=Path(pair['previous']['path'])
        archive=self.layout.archives/pair['previous']['fields']['archive_name']
        before=F.S.snapshot(previous)
        destination=base/'static-restore';destination.mkdir(mode=0o700)
        fd=os.open(archive,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
        try:
            with os.fdopen(os.dup(fd),'rb') as stream,tarfile.open(fileobj=stream,mode='r:gz') as tar:
                entries=tar.getmembers();self.assertLess(len(entries),1000)
                self.assertTrue(all(member.size>=0 for member in entries))
                self.assertLessEqual(sum(member.size for member in entries),64*1024**2)
                for member in entries:
                    parts=Path(member.name).parts
                    self.assertTrue(parts and parts[0]=='surfaces' and '..' not in parts)
                    self.assertTrue(member.isdir() or member.isfile())
                tar.extractall(destination,members=entries,filter='data')
        finally:os.close(fd)
        for member in entries:
            parts=Path(member.name).parts
            if len(parts)<2:continue
            target=previous/('proofofwork-'+parts[1])
            if len(parts)>2:target=target.joinpath(*parts[2:])
            if member.isfile():self.assertEqual(F.S.hash_read(destination/member.name)[0],F.S.hash_read(target)[0])
        self.assertEqual(before,F.S.snapshot(previous))
        class References(HTMLParser):
            def __init__(self):
                super().__init__();self.references=[]
            def handle_starttag(self,tag,attrs):
                for key,value in attrs:
                    if key in ('src','href','poster') and value is not None:
                        self.references.append((tag,key,value))
        counts={'htmlFiles':0,'references':0,'external':0,'sameDocument':0,
                'dynamicRoutes':0,'localFilesChecked':0,'missingLocalFiles':[],
                'unsafeLocalReferences':[]}
        for html in sorted(destination.rglob('*.html')):
            counts['htmlFiles']+=1;parser=References()
            parser.feed(html.read_text(encoding='utf-8'));parser.close()
            relative=html.relative_to(destination/'surfaces')
            surface_root=destination/'surfaces'/relative.parts[0]
            for tag,key,value in parser.references:
                counts['references']+=1;url=urlsplit(value)
                if url.scheme or url.netloc:
                    counts['external']+=1;continue
                if not url.path:
                    counts['sameDocument']+=1;continue
                path=unquote(url.path)
                target=(surface_root/path.lstrip('/') if path.startswith('/') else html.parent/path).resolve()
                if not target.is_relative_to(surface_root.resolve()):
                    counts['unsafeLocalReferences'].append(value);continue
                # Extensionless anchors are application routes, not asserted files.
                # Asset attributes (src/poster) must exist regardless of extension.
                if tag=='a' and key=='href' and not Path(path.rstrip('/')).suffix:
                    counts['dynamicRoutes']+=1;continue
                if target.is_dir():target=target/'index.html'
                counts['localFilesChecked']+=1
                if not target.is_file():counts['missingLocalFiles'].append(str(target))
        references_pass=not counts['missingLocalFiles'] and not counts['unsafeLocalReferences']
        self.assertTrue(references_pass,counts)
        restore={'scope':'isolated static archive restoration; NOT production rollback',
                 'uiInventoryBeforeAfterEqual':True,'staticReferencePass':references_pass,
                 'staticReferenceCheck':counts,'maximumExtractedBytes':64*1024**2,
                 'archiveDeclaredBytes':sum(member.size for member in entries),
                 'restoredEntries':len(entries),'archiveSha256':F.S.hash_read(archive)[0]}
        inventory={'pair':retained,'inventories':trees,'historicalEquivalentCopies':equivalents,
                   'allHistoricalEntriesHaveRetainedEquivalent':True}
        directory=self.layout.evidence/'older-backup-retirement-6fd05dc1e04e';directory.mkdir(mode=0o700)
        def save(name,value):
            raw=L.encoded(value);path=directory/name
            L.write_new(path,raw);return {'path':str(path),'sha256':L.sha(raw)}
        ib=save('inventory.json',inventory);rb=save('static-restore.json',restore)
        proposal={'status':'PROPOSAL_ONLY_NOT_AUTHORIZED_FOR_EXECUTION',
                  'selected':[{'path':p} for p in selected],'pair':retained,
                  'inventorySha256':ib['sha256'],'rehearsalReceipt':rb,
                  'allHistoricalEntriesHaveRetainedEquivalent':True,'historicalUnequalCount':0,
                  'sidecarsKeep':sidecars,'stateSha256':baseline['stateSha256']}
        pb=save('proposal.json',proposal)
        approval=save('owner-approval.json',{'schema':'pow-owner-exact-payload-retirement-approval-v1',
             'proposalSha256':pb['sha256'],'retiredPayloadPaths':selected,'retainedPair':retained,
             'permanent':True,'sourceMessageId':'SYNTHETIC_FIXTURE_ONLY',
             'approvedAtUtc':'SYNTHETIC_FIXTURE_ONLY'})
        receipt=(HERE/'retirement_receipt.py').read_text()
        receipt=assign(receipt,{'PROPOSAL_SHA':pb['sha256'],'INVENTORY_SHA':ib['sha256'],
            'RESTORE_SHA':rb['sha256'],'PAIR':retained,'BASE':str(self.layout.base),
            'PATHS':tuple(selected),'SOURCE_INDEX':baseline['seedDerivation']['index'],
            'PRIOR_CONFIG_SHA':self.initial_config_sha})
        receipt=receipt.replace("str(layout.live) == '/var/www'","str(layout.live) == "+repr(str(self.layout.live)))
        receipt=receipt.replace("r['restoredEntries'] == 2839","r['restoredEntries'] == "+str(len(entries)))
        receipt=receipt.replace("for parent in (p.parent, *p.parents):",
             "for parent in (x for x in (p.parent, *p.parents) if x.is_relative_to(Path("+repr(str(base))+"))):")
        receipt=receipt.replace("require(p.is_absolute() and p.resolve(strict=True) == p,",
             "require(p.is_absolute() and p.is_relative_to(Path("+repr(str(base))+")) and p.resolve(strict=True) == p,")
        transition=(HERE/'retirement_transition.py').read_text()
        transition=assign(transition,{'CONFIG':str(L.CONFIG_PATH),'STATE':str(self.runtime.state_path),
            'DIRECTORY':str(directory),'INDEX':str(self.layout.evidence/'audit30-policy-admission-index-payload-retirement-6fd05dc1e04e.json')})
        # Keep Path semantics in the copied module's fixed constants.
        for key in ('CONFIG','STATE','DIRECTORY','INDEX'):
            transition=transition.replace(key+' = '+repr({'CONFIG':str(L.CONFIG_PATH),'STATE':str(self.runtime.state_path),
                'DIRECTORY':str(directory),'INDEX':str(self.layout.evidence/'audit30-policy-admission-index-payload-retirement-6fd05dc1e04e.json')}[key]),
                key+' = Path('+repr({'CONFIG':str(L.CONFIG_PATH),'STATE':str(self.runtime.state_path),
                'DIRECTORY':str(directory),'INDEX':str(self.layout.evidence/'audit30-policy-admission-index-payload-retirement-6fd05dc1e04e.json')}[key])+')')
        transition=transition.replace("for parent in (directory,*directory.parents):",
            "for parent in (x for x in (directory,*directory.parents) if x.is_relative_to(Path("+repr(str(base))+"))):")
        transition=transition.replace("directory=Path(directory)","directory=Path(directory)\n    require(directory.is_relative_to(Path("+repr(str(base))+")),'Outside fixture ancestor boundary')")
        controller=(HERE/'retirement_controller.py').read_text()
        controller=assign(controller,{'CURRENT_MANIFEST_SHA':F.S.hash_read(self.layout.live/'.proofofwork-ui-release')[0],
             'PREVIOUS_MANIFEST_SHA':F.S.hash_read(previous/'.proofofwork-ui-release')[0]})
        controller=controller.replace("LOCK = Path('/run/proofofwork-ui/deploy.lock')",
                                      'LOCK = Path('+repr(str(self.layout.lock))+')')
        # Simulated host inventory inputs; scanner body/metadata guards unchanged.
        reference_root=base/'reference-inventory';reference_root.mkdir(mode=0o700)
        proc=reference_root/'proc';process=proc/'2147483646'
        (process/'fd').mkdir(parents=True,mode=0o700)
        neutral=reference_root/'neutral';neutral.mkdir()
        executable=neutral/'program';executable.write_text('fixture executable')
        for name,target in (('cwd',neutral),('root',neutral),('exe',executable)):
            (process/name).symlink_to(target)
        (process/'fd/3').symlink_to(executable)
        (process/'mountinfo').write_text('22 1 0:1 / /fixture rw - tmpfs tmpfs rw\n')
        (process/'cmdline').write_bytes(b'fixture-program\x00')
        (process/'maps').write_text('00400000-00401000 r-xp 00000000 00:01 1 '+str(executable)+'\n')
        configs=reference_root/'configs';configs.mkdir()
        config_file=configs/'fixture.conf';config_file.write_text('safe fixture configuration\n')
        loaded=reference_root/'loaded';loaded.mkdir()
        unit=loaded/'fixture.service';unit.write_text('[Service]\nExecStart=/fixture/neutral\n')
        removal=(HERE/'removal.py').read_text()
        original_signature="def check_references(paths,proc_root=Path('/proc'),config_roots=DEFAULT_CONFIG_ROOTS,ignore_pid=None,loaded_paths=None):"
        fixture_signature=("def check_references(paths,proc_root=Path("+repr(str(proc))+"),config_roots=("+
                           repr(str(configs))+",),ignore_pid=None,loaded_paths=("+repr(str(unit))+",)):")
        self.assertEqual(removal.count(original_signature),1)
        removal=removal.replace(original_signature,fixture_signature)

        for prefix in ('/etc/','/usr/local/'):
            removal=removal.replace(prefix,str(base/prefix.lstrip('/'))+'/')
        overrides={'deploy/ui-retention/retirement_receipt.py':receipt.encode(),
                   'deploy/ui-retention/retirement_transition.py':transition.encode(),
                   'deploy/ui-retention/retirement_controller.py':controller.encode(),
                   'deploy/ui-retention/removal.py':removal.encode()}
        package,config,manifest,members=self.bootstrap_installed_package(overrides,activate=False)
        newL=load('authority_successor_lifecycle',package/'deploy/ui-retention/lifecycle_remote.py')
        C=load('authority_successor_controller',package/'deploy/ui-retention/retirement_controller.py')
        Tr=load('authority_successor_transition',package/'deploy/ui-retention/retirement_transition.py')
        # Negative checks exercise each unchanged scanner branch before pending.
        reference_negatives=[]
        for target,error in ((unit,'Loaded native/transient unit or drop-in references selected root'),
                             (process/'cmdline','Live process text references selected root'),
                             (config_file,'Production configuration or installed operator references selected root')):
            original=target.read_bytes();target.write_bytes(selected[0].encode())
            try:
                with self.assertRaisesRegex(ValueError,error):C.W.check_references(selected)
                reference_negatives.append(error)
            finally:target.write_bytes(original)
        clean_references=C.W.check_references(selected)
        self.assertEqual(clean_references['processes'],1)
        self.assertEqual(len(clean_references['loadedUnitFiles']),1)
        fd=F.S.lock(self.layout);control=None
        try:
            transition=Tr.Transition(F.S,newL,fd)
            intent=transition.prepare_pending({'path':str(package),'sha256':config['package']['sha256']})
            transition.install_pending()
            pending_sha=transition.positions()['configSha256']
            with self.assertRaisesRegex(ValueError,'pending'):
                newL.installed_runtime(newL.CONFIG_PATH,pending_sha)
            control=C.open_pending_controller(newL,pending_sha,approval['sha256'],fd)
            for ordinal in range(4):
                prepared=control.prepare();self.assertEqual(prepared.index,ordinal)
                control.perform(prepared)
            terminal=C.complete_terminal(control)
            pending=json.loads(Path(newL.CONFIG_PATH).read_bytes())
            binding=dict(pending['payloadRetirement'],mode='complete',receipt=terminal)
            context=transition.R.load_verified_retirement(binding,self.layout,lambda layout:F.S.protected_pair(layout,{}))
            transition.prepare_terminal(context)
            result=transition.install_terminal(context)
            fresh=newL.installed_runtime(newL.CONFIG_PATH,result['configSha256'])
            fresh.lock_fd=fd
            try:status=fresh.status({'requireComplete':True})
            finally:fresh.lock_fd=None
            self.assertTrue(status['retentionComplete'])
            self.assertEqual(status['verifiedRetiredPayloads']['retiredPayloadPaths'],selected)
            return {'qualifiedTerminalRetirement':True,'status':status,'terminal':terminal,
                    'seedDerivation':baseline['seedDerivation'],'intent':intent['binding'],
                    'referenceInventory':{'model':'simulated-process-config-systemd-inputs',
                         'procRoot':str(proc),'configRoots':[str(configs)],'loadedPaths':[str(unit)],
                         'negativeChecks':reference_negatives,'cleanReport':clean_references,
                         'productionLiveHostReferenceQualification':False},
                    'operator':{'commit':manifest['sourceCommit'],'tree':manifest['sourceTree']},
                    'package':config['package'],'fixtureBase':str(base),'sourceCopies':str(SOURCE_ROOT),
                    'fixtureSubstitutions':{'namespace':str(base),'ancestorBoundary':str(base),
                        'restoredEntries':len(entries),'proposalSha256':pb['sha256'],
                        'inventorySha256':ib['sha256'],'restoreSha256':rb['sha256'],
                        'retainedPair':retained,'selectedPayloadPaths':selected,
                        'sourceIndex':baseline['seedDerivation']['index'],
                        'priorConfigSha256':self.initial_config_sha}}
        finally:
            if control is not None:control.journal.close()
            os.close(fd)

    def test_real_stock_foundation_has_two_holds_and_completed_current_prior(self):
        proof=self.authority_foundation()
        terminal=self.retire_fixture(proof)
        self.assertTrue(terminal['qualifiedTerminalRetirement'])
        report=dict(terminal,baseline=proof,harnessSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                    boundaries=['synthetic namespaces and exact authority pins',
                                'fixture initial state derived from real stock completion, not importer API',
                                'synthetic publication metadata; no public HTTP deployment',
                                'reference scanner uses explicit simulated process/config/loaded-unit inputs; algorithm unchanged'],
                    productionActions=False)
        result_path=self.fixture.base/'authority-result.json'
        L.write_new(result_path,L.encoded(report))
        print('AUTHORITY_TERMINAL '+json.dumps({'qualifiedTerminalRetirement':True,
            'fixtureBase':str(self.fixture.base),'sourceCopies':str(SOURCE_ROOT),
            'report':{'path':str(result_path),'sha256':hashlib.sha256(result_path.read_bytes()).hexdigest()},
            'package':terminal['package'],'operator':terminal['operator'],
            'configSha256':terminal['status']['configSha256'],
            'stateSha256':terminal['status']['stateSha256'],
            'productionActions':False,'fixtureKept':os.environ.get('POW_AUTHORITY_FIXTURE_KEEP')=='1'},
            sort_keys=True),flush=True)


if __name__=='__main__':unittest.main()
