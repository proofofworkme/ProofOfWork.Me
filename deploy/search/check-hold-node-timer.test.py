#!/usr/bin/env python3
"""Execute Search hold/restore against a fake systemd and real immutable receipts."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('hold', HERE/'hold-node-timer.py')
hold = importlib.util.module_from_spec(spec); spec.loader.exec_module(hold)


class HoldTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='search-timer-hold-')
        self.base = Path(self.temporary.name)
        self.units = self.base/'units'; self.units.mkdir()
        self.root = self.base/'search-hold'
        self.marker = self.base/'marker'
        self.pins = {}
        for name in [hold.SERVICE, hold.TIMER]:
            raw = (name+'\n').encode(); (self.units/name).write_bytes(raw)
            self.pins[name] = hashlib.sha256(raw).hexdigest()
        self.bindings = {'releaseId': 'a'*12+'-20261004T120000Z', 'attempt': 'initial', 'files': self.pins}
        self.states = {name: {'ActiveState': 'active', 'MainPID': '51'} for name in hold.KEEP}
        self.states.update({name: {'ActiveState': 'inactive', 'UnitFileState': 'masked'} for name in hold.TIMERS})
        self.states[hold.TIMER] = {'ActiveState': 'active', 'UnitFileState': 'enabled'}
        self.states[hold.SERVICE] = {'ActiveState': 'active', 'MainPID': '73'}
        self.actions = []
        self.fail = None
        self.patches = [patch.object(hold, 'UNITS', self.units), patch.object(hold, 'HOLD', self.marker),
            patch.object(hold, 'safe_directory', lambda p: None),
            patch.object(hold, 'safe_read', lambda p, limit=65536: Path(p).read_bytes()),
            patch.object(hold, 'systemctl', self.systemctl)]
        for item in self.patches: item.start()

    def tearDown(self):
        for item in reversed(self.patches): item.stop()
        self.temporary.cleanup()

    def systemctl(self, arguments):
        if arguments[0] == 'show':
            values = self.states[arguments[1]]
            fields = [word.split('=', 1)[1] for word in arguments[2:]]
            return ''.join(field+'='+values[field]+'\n' for field in fields)
        self.actions.append(arguments)
        if self.fail == tuple(arguments):
            self.fail = None
            raise ValueError('injected failure')
        self.states[arguments[1]]['ActiveState'] = 'active' if arguments[0] == 'start' else 'inactive'
        if arguments[1] == hold.SERVICE: self.states[hold.SERVICE]['MainPID'] = '0'
        return ''

    def test_active_hold_restore_changes_only_search_activation(self):
        original = hold.baseline()
        hold.apply('hold', self.root, self.bindings)
        self.assertTrue(self.marker.exists())
        self.assertEqual(self.states[hold.TIMER]['ActiveState'], 'inactive')
        self.assertEqual(self.states[hold.SERVICE]['MainPID'], '0')
        hold.apply('restore', self.root, self.bindings)
        self.assertFalse(self.marker.exists())
        self.assertEqual(hold.baseline(), original)
        self.assertEqual(self.states[hold.TIMER], {'ActiveState': 'active', 'UnitFileState': 'enabled'})
        self.assertTrue((self.root/'held.json').is_file())
        self.assertTrue((self.root/'restored.json').is_file())
        self.assertTrue(all(name in [hold.SERVICE, hold.TIMER] for _, name in self.actions))

    def test_inactive_disabled_timer_stays_inactive_disabled(self):
        self.states[hold.TIMER] = {'ActiveState': 'inactive', 'UnitFileState': 'disabled'}
        hold.apply('hold', self.root, self.bindings); hold.apply('restore', self.root, self.bindings)
        self.assertEqual(self.states[hold.TIMER], {'ActiveState': 'inactive', 'UnitFileState': 'disabled'})
        self.assertNotIn(['start', hold.TIMER], self.actions)

    def test_hold_failure_restores_activation_and_retains_receipts(self):
        self.fail = ('stop', hold.SERVICE)
        with self.assertRaises(ValueError): hold.apply('hold', self.root, self.bindings)
        self.assertFalse(self.marker.exists())
        self.assertEqual(self.states[hold.TIMER]['ActiveState'], 'active')
        self.assertTrue(json.loads((self.root/'rollback.json').read_text())['ok'])
        self.assertTrue((self.root/'failed.json').exists())

    def test_changed_release_marker_or_unit_bytes_refuse(self):
        hold.apply('hold', self.root, self.bindings)
        changed = {**self.bindings, 'releaseId': 'b'*12+'-20261004T120000Z'}
        with self.assertRaises(ValueError): hold.apply('restore', self.root, changed)
        (self.units/hold.SERVICE).write_bytes(b'changed')
        with self.assertRaises(ValueError): hold.apply('restore', self.root, self.bindings)
        self.assertTrue(self.marker.exists())
        self.assertEqual(self.states[hold.TIMER]['ActiveState'], 'inactive')

    def test_restore_failure_can_retry_without_erasing_evidence(self):
        hold.apply('hold', self.root, self.bindings)
        self.fail = ('start', hold.TIMER)
        with self.assertRaises(ValueError): hold.apply('restore', self.root, self.bindings)
        self.assertTrue(self.marker.exists())
        self.assertTrue((self.root/'restore-failed-0.json').is_file())
        hold.apply('restore', self.root, self.bindings)
        self.assertFalse(self.marker.exists())
        self.assertTrue((self.root/'restore-failed-0.json').is_file())

    def test_other_existing_timer_change_blocks_restore(self):
        hold.apply('hold', self.root, self.bindings)
        self.states[hold.TIMERS[0]]['ActiveState'] = 'active'
        with self.assertRaises(ValueError): hold.apply('restore', self.root, self.bindings)
        self.assertTrue(self.marker.exists())
        self.assertEqual(self.states[hold.TIMER]['ActiveState'], 'inactive')

    def test_duplicate_hold_and_restore_refuse(self):
        hold.apply('hold', self.root, self.bindings)
        with self.assertRaises(ValueError): hold.apply('hold', self.base/'another', self.bindings)
        hold.apply('restore', self.root, self.bindings)
        with self.assertRaises((ValueError, FileNotFoundError)): hold.apply('restore', self.root, self.bindings)


if __name__ == '__main__':
    unittest.main(verbosity=2)
