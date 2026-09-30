#!/usr/bin/env python3
"""Exercise prepared retention holds using isolated files, never /etc."""
import pathlib, subprocess, tempfile, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class RetentionHold(unittest.TestCase):
    def test_apply_guards_block_before_target_access(self):
        with tempfile.TemporaryDirectory() as tmp:
            hold=pathlib.Path(tmp)/'hold';hold.touch()
            for name,args in [('proofofwork-release-prune.sh',['/invalid', '2','--apply']),('proofofwork-ui-storage-prune.sh',['--apply']),('audit28/ui-release-prune-held.sh',['/invalid','2','--apply'])]:
                script=(ROOT/'deploy'/name).read_text().replace('/etc/proofofwork-retention/audit28.hold',str(hold))
                result=subprocess.run(['bash','-c',script,'fixture',*args],capture_output=True,text=True)
                self.assertEqual(result.returncode,78,result.stderr)
                self.assertIn('Retention blocked',result.stderr)
    def test_broken_symlink_still_blocks(self):
        with tempfile.TemporaryDirectory() as tmp:
            hold=pathlib.Path(tmp)/'hold';hold.symlink_to(pathlib.Path(tmp)/'missing')
            script=(ROOT/'deploy/proofofwork-ui-storage-prune.sh').read_text().replace('/etc/proofofwork-retention/audit28.hold',str(hold))
            result=subprocess.run(['bash','-c',script,'fixture','--apply'],capture_output=True,text=True)
            self.assertEqual(result.returncode,78)
    def test_direct_verified_retention_is_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            hold=pathlib.Path(tmp)/'hold';hold.touch()
            script=(ROOT/'deploy/proofofwork-ui-verified-retention.py').read_text().replace('/etc/proofofwork-retention/audit28.hold',str(hold))
            result=subprocess.run(['python3','-c',script,'--apply'],capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertIn('Persistent audit28 retention hold',result.stderr)
    def test_publisher_defers_retention_when_held(self):
        with tempfile.TemporaryDirectory() as tmp:
            hold=pathlib.Path(tmp)/'hold';hold.touch()
            script=(ROOT/'deploy/proofofwork-ui-release-publish.sh').read_text().split('while (($# > 0)); do')[0].replace('/etc/proofofwork-retention/audit28.hold',str(hold))
            result=subprocess.run(['bash','-c',script+'\nprintf "%s" "$defer_verified_retention"'],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(result.stdout,'1')
    def test_monitor_rejects_reboot_unsafe_timer_state(self):
        import runpy
        evaluate=runpy.run_path(str(ROOT/'scripts/check-retention-protection.py'))['evaluate']
        marker=dict(exists=True,symlink=False,regular=True,canonical=True,uid=0,mode=0o600)
        self.assertFalse(evaluate('ui',marker,{'timer':dict(LoadState='loaded',ActiveState='inactive')})['ok'])
        self.assertFalse(evaluate('ui',marker,{'timer':dict(LoadState='masked',ActiveState='inactive',persistentMask=False)})['ok'])
        self.assertTrue(evaluate('ui',marker,{'timer':dict(LoadState='masked',ActiveState='inactive',persistentMask=True)})['ok'])
        self.assertFalse(evaluate('ui',dict(exists=False),{'timer':dict(LoadState='masked',ActiveState='inactive',persistentMask=True)})['ok'])
    def test_node_monitor_requires_real_pin_aware_backup_tooling(self):
        import runpy
        module=runpy.run_path(str(ROOT/'scripts/check-retention-protection.py'));valid=module['logical_pin_protection_is_valid']
        pin=dict(exists=True,regular=True,symlink=False,canonical=True,uid=0,mode=0o644,bytes=64)
        tool=dict(pin,mode=0o755)
        self.assertTrue(valid(pin,[module['EXPECTED_LOGICAL_PIN']],tool,module['EXPECTED_LOGICAL_BACKUP_TOOL_SHA256']))
        self.assertFalse(valid(pin,[module['EXPECTED_LOGICAL_PIN']],tool,'old-unprotected-tool'))
        self.assertFalse(valid(pin,[],tool,module['EXPECTED_LOGICAL_BACKUP_TOOL_SHA256']))
if __name__=='__main__':unittest.main()
