import types, json, hashlib, os, importlib.util
from pathlib import Path
def sha(b): return hashlib.sha256(b).hexdigest()
def load(name, path, bind=None):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    if bind: module._BOUND_STORAGE=bind
    spec.loader.exec_module(module); return module
def installed_runtime(config_path, config_sha):
    config_path=Path(config_path); data=config_path.read_bytes()
    assert sha(data)==config_sha
    conf=json.loads(data); base=config_path.parents[2]
    pkg=Path(conf['package']['path'])
    manifest=json.loads((pkg/'package.json').read_bytes())
    for name, row in manifest['files'].items():
        assert sha((pkg/name).read_bytes())==row['sha256']
    s=load('fixture_pinned_storage',pkg/'deploy/audit30/ui-storage.py')
    p=load('fixture_pinned_policy',pkg/'deploy/audit30/ui-release-policy.py',s)
    class Runtime:
        S=s; layout=s.Layout(base)
        def status(self, frame):
            assert frame['requireComplete'] is True
            rid=frame['prospectiveRelease']
            state_path=Path(conf['statePath']); state_raw=state_path.read_bytes(); state=json.loads(state_raw)
            assert state['status']=='complete' and state['pending'] is None and state['activePhase'] is None
            pair=state['pair']
            s.PRESERVED_FALLBACK_PREDECESSOR=pair['previous']
            s.PRESERVED_FALLBACK_INTRODUCER=pair['current']
            idx=state['index']; ib=Path(idx['path']).read_bytes()
            assert sha(ib)==idx['sha256']
            index=json.loads(ib)
            assert rid not in pair.values()
            # Native verifier independently recreates all four inventory snapshots,
            # including byte hashes AND inode metadata, on every forecast request.
            hold=state['hold']
            p.verify_fallback_hold(hold,self.layout,{'previous':{'path':'fixture-pair-use-native-release-proof'}},{})
            keep={str(self.layout.live), str(self.layout.roots/('proofofwork-www-pre-'+rid)),
                  *(hold['snapshotSha256'] if hold else {})}
            archive=self.layout.archives/('proofofwork-ui-release-'+pair['current']+'.tgz')
            keep.update(str(archive)+suffix for suffix in ('','.sha256','.provenance'))
            leaving=sorted(set(index['admittedPaths'])-keep)
            binding={'config':{'path':str(config_path),'sha256':config_sha},'state':{'path':str(state_path),'sha256':sha(state_raw)},
                     'controller':conf['controller'],'pair':pair}
            forecast={'model':'private-stage-zero-retirement-v1','releaseId':rid,'previousPair':pair,
                      'stateSha256':sha(state_raw),'index':idx,'wouldRetire':leaving}
            if hold:
                forecast['preservedFallback']=hold
                assert not leaving
            else:
                previous=None
                for ref in index['admissions']:
                    raw=Path(ref['path']).read_bytes();assert sha(raw)==ref['sha256']
                    admission=json.loads(raw);pair_at=admission['retainedPair']
                    assert all(v[13:]<'20261103T032112Z' for v in pair_at.values())
                    assert previous is None or previous['current']==pair_at['previous']
                    previous=pair_at
                assert previous==pair

            # Optional fixture-only interleaving after the actual full native archive+snapshot verification.
            if (base/'inject-after-native-status').is_file():
                sidecar=Path(s.preserved_fallback_paths(self.layout)[2]); replacement=sidecar.with_name(sidecar.name+'.replacement')
                original=sidecar.stat(); data=sidecar.read_bytes(); replacement.write_bytes(data); replacement.chmod(original.st_mode&0o777)
                os.utime(replacement,ns=(original.st_atime_ns,original.st_mtime_ns));replacement.replace(sidecar)
                (base/'injected-after-native-status').touch()
            return {'retentionComplete':True, 'ok':True,'binding':binding,'index':idx,'pair':pair,'privateStageRetention':forecast,
                    'verifiedPreservedFallback':hold,**({'verifiedPreFallbackIndex':idx} if hold is None else {})}
    return Runtime()
