#!/usr/bin/python3 -I
"""Execute guarded install/recovery against local files and simulated systemd."""
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('publish_render_installer_test', HERE/'install.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def node_archive(extra=()):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode='w:xz') as archive:
        for name, kind, body in [(m.NODE_NAME, 'dir', b''), (m.NODE_NAME+'/bin','dir',b''),
                                 (m.NODE_NAME+'/bin/node','file',b'fake node'), *extra]:
            item = tarfile.TarInfo(name); item.mode = 0o755
            item.type = tarfile.DIRTYPE if kind == 'dir' else tarfile.SYMTYPE if kind == 'link' else tarfile.REGTYPE
            if kind == 'link': item.linkname = body.decode()
            elif kind == 'file': item.size = len(body)
            archive.addfile(item, io.BytesIO(body) if kind == 'file' else None)
    return out.getvalue()


class ArchiveTests(unittest.TestCase):
    def inspect(self, raw):
        with patch.object(m, 'NODE_SHA', m.digest(raw)):
            return m.archive_inventory(raw)

    def test_checksum_precedes_archive_use(self):
        with self.assertRaisesRegex(ValueError, 'checksum'):
            m.archive_inventory(b'untrusted archive')

    def test_official_shape_inventory_includes_exact_binary_hash_and_copy_bound(self):
        rows, bound = self.inspect(node_archive())
        expected = m.expected_node_inventory(rows)
        self.assertEqual(expected['bin/node']['sha256'], m.digest(b'fake node'))
        self.assertGreater(bound, len(b'fake node'))

    def test_symlink_escape_and_duplicate_and_symlink_parent_refuse(self):
        for extra in [((m.NODE_NAME+'/bad','link',b'../../etc/passwd'),),
                      ((m.NODE_NAME+'/bin/node','file',b'changed'),),
                      ((m.NODE_NAME+'/link','link',b'bin'),(m.NODE_NAME+'/link/child','file',b'bad'))]:
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                self.inspect(node_archive(extra))

    def test_source_allowlist_and_commit_are_exact(self):
        good = {'format':'proof-of-work-publish-render-source-v1','commit':'a'*40,'tree':'b'*40,
                'files':{name:'c'*64 for name in m.SOURCE_FILES}}
        m.validate_source_manifest(good)
        for change in [{'files':{**good['files'],'server/proof-api.mjs':'d'*64}}, {'commit':'main'}]:
            with self.assertRaises(ValueError): m.validate_source_manifest({**good,**change})


class HealthTests(unittest.TestCase):
    def test_full_current_ui_provenance_and_wrong_ui(self):
        source={'commit':'a'*40,'tree':'b'*40,'files':{'module':'c'*64}}
        ui={'format':'proof-of-work-ui-source-v1','commit':'a'*40,'tree':'b'*40,
            'trackedDirty':False,'builtAt':'fixture-extra-field'}
        response={'ok':True,**source,'ui':ui}
        class Response(io.BytesIO): status=200
        def opener(value):
            return types.SimpleNamespace(open=lambda *args,**kwargs:Response(m.encoded(value)))
        with patch.object(m.urllib.request,'build_opener',return_value=opener(response)):
            self.assertEqual(m.health(source,ui),response)
        wrong={**response,'ui':{**ui,'commit':'d'*40}}
        with patch.object(m.urllib.request,'build_opener',return_value=opener(wrong)),patch.object(m.time,'sleep'):
            with self.assertRaisesRegex(ValueError,'health failed'):m.health(source,ui)


class PackageTests(unittest.TestCase):
    def test_exact_package_build_and_tamper_refusal_without_network(self):
        spec=importlib.util.spec_from_file_location('publish_renderer_package_test',HERE/'package.py')
        pkg=importlib.util.module_from_spec(spec);spec.loader.exec_module(pkg)
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);repo=root/'repo';repo.mkdir();archive=root/'node.tar.xz'
            raw=node_archive();archive.write_bytes(raw)
            names=[*m.SOURCE_FILES,m.UNIT_TEMPLATE,'deploy/publish-render/install.py','deploy/publish-render/package.py']
            for name in names:
                destination=repo/name;destination.parent.mkdir(parents=True,exist_ok=True)
                body=(HERE/Path(name).name).read_bytes() if name.startswith('deploy/') else b'export {};'
                destination.write_bytes(body)
            capture=root/'capture.json';capture.write_bytes(m.encoded({'captureControllerSha256':
                m.digest((HERE/'install.py').read_bytes()),'format':'fixture-capture'}))
            def git(_repo,*args):
                if args==('rev-parse','HEAD'):return ('a'*40).encode()
                if args==('status','--porcelain','--untracked-files=no'):return b''
                if args[0]=='show':return (repo/args[1].split(':',1)[1]).read_bytes()
                if args==('rev-parse','a'*40+'^{tree}'):return ('b'*40).encode()
                raise AssertionError(args)
            args=types.SimpleNamespace(repo=repo,commit='a'*40,capture=capture,node_archive=archive,
                output=root/'package',attempt='initial')
            with patch.object(pkg,'git',side_effect=git),patch.object(pkg,'controller',return_value=m),                    patch.object(m,'NODE_SHA',m.digest(raw)):
                pkg.build(args)
                receipt,blobs=pkg.read_package(args.output)
                self.assertEqual(set(receipt['files']),set(blobs))
                self.assertEqual(receipt['planSha256'],m.digest(blobs['plan.json']))
                (args.output/m.SOURCE_FILES[0]).write_bytes(b'tampered')
                with self.assertRaisesRegex(ValueError,'checksum differs'):pkg.read_package(args.output)
            # A dirty source must refuse before creating any package directory.
            args.output=root/'dirty-package'
            with patch.object(pkg,'git',side_effect=lambda repo,*a:b'M changed' if a[0]=='status' else ('a'*40).encode()):
                with self.assertRaisesRegex(ValueError,'clean committed'):pkg.build(args)
            self.assertFalse(args.output.exists())


class InstallTests(unittest.TestCase):
    def setUp(self):
        previous_umask = os.umask(0o077); self.addCleanup(os.umask, previous_umask)
        self.owner = os.getuid(); self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name); self.patches=[]
        def override(name, value):
            p=patch.object(m,name,value);p.start();self.patches.append(p)
        self.addCleanup(lambda:[p.stop() for p in reversed(self.patches)])
        for name, relative in {'ROOT':'opt/renderer','NODE_ROOT':'opt/'+m.NODE_NAME,
            'BASE':'scratch','BACKUPS':'backups','LOCK':'run/deploy.lock',
            'UNIT':'units/'+m.UNIT_NAME,'WANTED':'units/multi-user.target.wants/'+m.UNIT_NAME,
            'MANIFEST':'www/.proofofwork-ui-release','UI':'www/publish'}.items():
            override(name,self.base/relative)
        override('ACTIVE',m.ROOT/'active.json')
        for p in [m.BASE,m.BACKUPS,m.LOCK.parent,m.UNIT.parent,m.WANTED.parent,m.UI,m.NODE_ROOT.parent]:
            p.mkdir(parents=True,exist_ok=True)
        m.LOCK.touch(mode=0o600)
        self.raw=node_archive();override('NODE_SHA',m.digest(self.raw))
        original_read=m.read_safe;original_tree=m.tree_inventory
        override('read_safe',lambda p,limit=2*1024**2,**kw:Path(p).read_bytes() if Path(p)==Path(m.__file__) else
            original_read(p,limit,owner=self.owner,**{k:v for k,v in kw.items() if k!='owner'}))
        def directory(p):
            self.assertEqual(p.resolve(strict=True),p)
            self.assertTrue(p.is_dir() and not p.is_symlink())
        override('directory',directory)
        def wanted_target():
            if not os.path.lexists(m.WANTED): return None
            self.assertTrue(m.WANTED.is_symlink())
            self.assertEqual(os.readlink(m.WANTED),str(m.UNIT))
            return str(m.UNIT)
        override('wanted_target',wanted_target)
        override('tree_inventory',lambda p,**kw:original_tree(p,owner=self.owner,**kw))
        override('protected_snapshot',lambda: {'files':{'unchanged':'pinned'},'units':{'caddy':'same'}})
        self.active='inactive'
        self.state={'LoadState':'not-found','ActiveState':'inactive','SubState':'dead',
                    'MainPID':'0','UnitFileState':'','FragmentPath':''}
        override('state',lambda name:{**self.state,'ActiveState':self.active})
        self.before={'format':'proof-of-work-publish-render-capture-v1',
            'protected':m.protected_snapshot(), 'renderer':{'unit':None,'active':None,'wanted':None,
            'state':dict(self.state)},'node':None}
        override('capture',lambda:copy.deepcopy(self.before))
        port_probe = patch.object(m.socket, 'socket'); port_probe.start(); self.addCleanup(port_probe.stop)
        self.commands=[]
        def run(argv,lock=None,timeout=60):
            self.commands.append(argv)
            if argv[-1:] == ['--version']:return 'v24.18.0'
            if argv[:2]==['/usr/bin/systemctl','stop']: self.active='inactive'; self.state['MainPID']='0'
            if argv[:2] in [['/usr/bin/systemctl','start'],['/usr/bin/systemctl','restart']]:
                self.active='active'; self.state.update({'MainPID':'12345','FragmentPath':str(m.UNIT),'LoadState':'loaded'})
            return '{}'
        override('run',run)
        self.admissions=[]
        def admit(*args):self.admissions.append(args);return {'status':'sufficient'}
        override('admit',admit)
        override('health',lambda manifest,ui:{'ok':True,**manifest,'ui':ui})
        override('UNIT_TEMPLATE','deploy/publish-render/'+m.UNIT_NAME)
        self.commit='a'*40;self.token=self.commit[:12]+'-initial'
        self.package=m.BASE/('publish-render-'+self.token);self.package.mkdir()
        files={name:b'export {};' for name in m.SOURCE_FILES}
        files['deploy/publish-render/install.py']=Path(m.__file__).read_bytes()
        files[m.UNIT_TEMPLATE]=(HERE/m.UNIT_NAME).read_bytes()
        files[m.NODE_NAME+'.tar.xz']=self.raw
        for name,body in files.items():
            p=self.package/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(body)
        self.manifest={'format':'proof-of-work-publish-render-source-v1','commit':self.commit,
            'tree':'b'*40,'files':{name:m.digest(files[name]) for name in m.SOURCE_FILES}}
        self.plan={'format':'proof-of-work-publish-render-install-v1','attempt':'initial',
            'source':self.manifest,'before':copy.deepcopy(self.before),'nodeArchiveSha256':m.NODE_SHA,
            'installerSha256':m.digest(files['deploy/publish-render/install.py']),
            'unitTemplateSha256':m.digest(files[m.UNIT_TEMPLATE])}
        (m.UI/'source-provenance.json').write_bytes(m.encoded({'format':'proof-of-work-ui-source-v1','commit':self.commit,'tree':'b'*40,'trackedDirty':False}))
        m.MANIFEST.write_text('format=proofofwork-ui-release-v5\ncommit='+self.commit+'\nsource_tree='+'b'*40+'\n'+
            '\n'.join('surface.'+name+'.sha256='+'c'*64+'\nsurface.'+name+'.file_count=1' for name in sorted(m.SURFACES)))
        self.root_patch=patch.object(m.os,'geteuid',return_value=0);self.root_patch.start();self.addCleanup(self.root_patch.stop)
        self.gid_patch=patch.object(m.os,'getegid',return_value=0);self.gid_patch.start();self.addCleanup(self.gid_patch.stop)

    def invoke(self):
        raw=m.encoded(self.plan);(self.package/'plan.json').write_bytes(raw)
        m.install(self.package,m.digest(raw))

    def receipt(self):return m.BACKUPS/'publish-render'/self.token

    def test_success_installs_only_sidecar_and_retains_all_evidence(self):
        self.invoke()
        self.assertTrue((self.receipt()/'completed.json').is_file())
        self.assertEqual(json.loads(m.ACTIVE.read_bytes()),self.manifest)
        self.assertTrue((m.ROOT/'releases'/self.commit/'release.json').is_file())
        self.assertTrue(m.NODE_ROOT.is_dir())
        self.assertEqual(os.readlink(m.WANTED),str(m.UNIT))
        service_actions=[a for a in self.commands if a[:1]==['/usr/bin/systemctl'] and len(a)>2]
        self.assertTrue(all(a[-1]==m.UNIT_NAME for a in service_actions))
        self.assertEqual(len(self.admissions),3)

    def test_capacity_refusal_occurs_before_any_install_allocation(self):
        with patch.object(m,'admit',side_effect=ValueError('capacity refused')), self.assertRaisesRegex(ValueError,'capacity'):
            self.invoke()
        self.assertFalse(m.ROOT.exists());self.assertFalse(m.NODE_ROOT.exists())
        self.assertFalse((m.BACKUPS/'publish-render').exists())

    def test_unsorted_runtime_archive_extracts_in_one_stream_pass(self):
        raw=node_archive(((m.NODE_NAME+'/zdir/zfile','file',b'z first'),
            (m.NODE_NAME+'/adir/afile','file',b'a second'),
            (m.NODE_NAME+'/zdir','dir',b''),(m.NODE_NAME+'/adir','dir',b'')))
        with patch.object(m,'NODE_SHA',m.digest(raw)):
            rows,_=m.archive_inventory(raw)
        with patch.object(m.tarfile,'open',wraps=m.tarfile.open) as opened:
            m.install_node(raw,m.NODE_ROOT.parent/'unsorted-rehearsal',rows)
        self.assertEqual(opened.call_count,1)
        self.assertEqual(opened.call_args.kwargs['mode'],'r|xz')
        self.assertEqual((m.NODE_ROOT/'zdir/zfile').read_bytes(),b'z first')
        self.assertEqual((m.NODE_ROOT/'adir/afile').read_bytes(),b'a second')
        self.assertEqual(m.tree_inventory(m.NODE_ROOT),m.expected_node_inventory(rows))

    def test_existing_nonofficial_runtime_refuses_before_admission(self):
        self.before['node'] = {'bin/node': {'sha256': 'unreviewed'}}
        self.plan['before'] = copy.deepcopy(self.before)
        with self.assertRaisesRegex(ValueError, 'official archive'): self.invoke()
        self.assertEqual(self.admissions, [])

    def test_tampered_source_refuses_before_admission(self):
        (self.package/m.SOURCE_FILES[0]).write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'source differs'):self.invoke()
        self.assertEqual(self.admissions,[])

    def test_stale_ui_and_missing_root_refuse(self):
        (m.UI/'source-provenance.json').write_bytes(m.encoded({'commit':'c'*40,'tree':'b'*40,'trackedDirty':False}))
        with self.assertRaisesRegex(ValueError,'exact candidate'):self.invoke()
        self.assertEqual(self.admissions,[])

    def test_same_count_wrong_surface_and_duplicate_manifest_refuse(self):
        before=m.MANIFEST.read_text()
        for changed in (before.replace('surface.pages.', 'surface.unexpected.'), before+'\ncommit='+self.commit):
            m.MANIFEST.write_text(changed)
            with self.assertRaises(ValueError):self.invoke()
            self.assertEqual(self.admissions,[])

    def test_failed_health_restores_absent_unit_preserves_runtime_source_and_receipts(self):
        with patch.object(m,'health',side_effect=ValueError('unhealthy')),self.assertRaisesRegex(RuntimeError,'unhealthy'):
            self.invoke()
        self.assertFalse(m.UNIT.exists());self.assertFalse(m.ACTIVE.exists());self.assertFalse(os.path.lexists(m.WANTED))
        self.assertTrue((m.UNIT.parent/('.'+m.UNIT.name+'.failed-'+self.token)).is_file())
        self.assertTrue((self.receipt()/'recovery.json').is_file())
        self.assertTrue((m.ROOT/'releases'/self.commit).is_dir());self.assertTrue(m.NODE_ROOT.is_dir())
        self.assertEqual(self.active,'inactive')

    def test_failure_receipt_io_error_does_not_skip_rollback(self):
        save=m.save
        def fail_receipt(path,*args,**kw):
            if path.name=='failure.json':raise OSError('injected receipt I/O failure')
            return save(path,*args,**kw)
        with patch.object(m,'save',side_effect=fail_receipt),patch.object(m,'health',side_effect=ValueError('unhealthy')):
            with self.assertRaisesRegex(RuntimeError,'receipt I/O'):self.invoke()
        self.assertFalse(m.UNIT.exists());self.assertFalse(m.ACTIVE.exists());self.assertFalse(os.path.lexists(m.WANTED))
        self.assertTrue((self.receipt()/'recovery.json').exists())

    def test_upgrade_failure_restores_exact_prior_unit_manifest_and_active_state(self):
        old_manifest={**self.manifest,'commit':'d'*40}
        old_active=m.encoded(old_manifest);old_unit=b'[Service]\nExecStart=/previous\n'
        m.ROOT.mkdir();m.ACTIVE.write_bytes(old_active);m.UNIT.write_bytes(old_unit)
        os.symlink(str(m.UNIT),m.WANTED);self.active='active'
        self.before['renderer'].update({'active':m.digest(old_active),'unit':m.digest(old_unit),
            'wanted':str(m.UNIT),'state':{**self.state,'LoadState':'loaded','ActiveState':'active'}})
        self.plan['before']=copy.deepcopy(self.before)
        with patch.object(m,'health',side_effect=ValueError('unhealthy')),self.assertRaisesRegex(RuntimeError,'unhealthy'):self.invoke()
        self.assertEqual(m.UNIT.read_bytes(),old_unit);self.assertEqual(m.ACTIVE.read_bytes(),old_active)
        self.assertEqual(self.active,'active');self.assertEqual(os.readlink(m.WANTED),str(m.UNIT))

    def test_unknown_unit_during_upgrade_never_starts_unknown_code(self):
        old_active=m.encoded({**self.manifest,'commit':'d'*40}); old_unit=b'previous unit'
        m.ROOT.mkdir();m.ACTIVE.write_bytes(old_active);m.UNIT.write_bytes(old_unit)
        os.symlink(str(m.UNIT),m.WANTED);self.active='active'
        self.before['renderer'].update({'active':m.digest(old_active),'unit':m.digest(old_unit),
            'wanted':str(m.UNIT),'state':{**self.state,'LoadState':'loaded','ActiveState':'active'}})
        self.plan['before']=copy.deepcopy(self.before)
        def tamper(*args):
            m.UNIT.write_bytes(b'unknown unit');raise ValueError('unhealthy')
        with patch.object(m,'health',side_effect=tamper),self.assertRaisesRegex(RuntimeError,'Unknown current bytes'):
            self.invoke()
        self.assertEqual(self.active,'inactive')
        self.assertFalse(any(a[:2]==['/usr/bin/systemctl','start'] for a in self.commands))

    def test_enospc_after_promotion_restores_preallocated_prior_bytes(self):
        old_active=m.encoded({**self.manifest,'commit':'d'*40});old_unit=b'previous unit'
        m.ROOT.mkdir();m.ACTIVE.write_bytes(old_active);m.UNIT.write_bytes(old_unit)
        os.symlink(str(m.UNIT),m.WANTED);self.active='active'
        self.before['renderer'].update({'active':m.digest(old_active),'unit':m.digest(old_unit),
            'wanted':str(m.UNIT),'state':{**self.state,'LoadState':'loaded','ActiveState':'active'}})
        self.plan['before']=copy.deepcopy(self.before)
        save=m.save; exhausted=False
        def guarded_save(*args,**kw):
            if exhausted:raise OSError(28,'No space left on device')
            return save(*args,**kw)
        def unhealthy(*args):
            nonlocal exhausted
            exhausted=True;raise ValueError('unhealthy')
        with patch.object(m,'save',side_effect=guarded_save),patch.object(m,'health',side_effect=unhealthy):
            with self.assertRaises(RuntimeError):self.invoke()
        self.assertTrue(exhausted)
        self.assertEqual(m.UNIT.read_bytes(),old_unit);self.assertEqual(m.ACTIVE.read_bytes(),old_active)
        self.assertEqual(self.active,'active')

    def test_unknown_post_promotion_bytes_are_preserved_not_overwritten(self):
        def tamper(*args):
            m.UNIT.write_bytes(b'unknown external unit');raise ValueError('unhealthy')
        with patch.object(m,'health',side_effect=tamper),self.assertRaisesRegex(RuntimeError,'Unknown current bytes'):
            self.invoke()
        self.assertEqual(m.UNIT.read_bytes(),b'unknown external unit')


if __name__=='__main__':unittest.main()
