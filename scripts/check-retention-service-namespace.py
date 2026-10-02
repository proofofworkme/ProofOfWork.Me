#!/usr/bin/env python3
"""Verify a fresh actual retention service invocation against a direct read.

The installed mode never starts or modifies a service. Run the approved
oneshot separately, then pass --verify-installed --role=ui (or node).
"""
import argparse
import copy
import datetime
import json
import pathlib
import re
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCRATCH = '/var/tmp/proofofwork-deploy'
CHECKER = '/usr/local/sbin/proofofwork-retention-protection'
UNIT = 'proofofwork-retention-protection.service'
ROLE_DEADLINES = {'ui': '60s', 'node': '20s'}
# systemctl show canonically renders the approved UI 60s as 1min.
# Keep source-unit spellings and direct-check timeouts exact in ROLE_DEADLINES.
EFFECTIVE_DEADLINES = {'ui': ('60s', '1min'), 'node': ('20s',)}
HARDENING = {
    'PrivateTmp': 'yes', 'PrivateDevices': 'yes', 'NoNewPrivileges': 'yes',
    'ProtectSystem': 'strict', 'ProtectHome': 'yes',
    'ProtectControlGroups': 'yes', 'ProtectKernelLogs': 'yes',
    'ProtectKernelModules': 'yes', 'ProtectKernelTunables': 'yes',
    'RestrictSUIDSGID': 'yes', 'LockPersonality': 'yes', 'RestrictRealtime': 'yes',
    'MemoryMax': '33554432', 'CPUQuotaPerSecUSec': '100ms',
    'TasksMax': '16', 'TimeoutStartUSec': '20s', 'UMask': '0077',
    'RestrictAddressFamilies': 'AF_UNIX', 'User': 'root', 'Group': 'root',
    'BindPaths': '', 'ReadWritePaths': '',
}


def verify_namespace(role, properties, entry, direct, direct_exit):
    expected_properties = {**HARDENING, 'TimeoutStartUSec': ROLE_DEADLINES[role]}
    for name, expected in expected_properties.items():
        accepted = EFFECTIVE_DEADLINES[role] if name == 'TimeoutStartUSec' else (expected,)
        if properties.get(name) not in accepted:
            raise ValueError('Effective hardening differs: ' + name)
    expected_caps = 'cap_dac_read_search' if role == 'node' else ''
    for name in ('CapabilityBoundingSet', 'AmbientCapabilities'):
        if properties.get(name) != expected_caps:
            raise ValueError('Effective capability scope differs: ' + name)
    # systemctl show expands the unit's single binding to its default rbind
    # spelling. All accepted forms name the same exact source and destination.
    if properties.get('BindReadOnlyPaths') not in (SCRATCH, SCRATCH + ':' + SCRATCH,
                                                 SCRATCH + ':' + SCRATCH + ':rbind'):
        raise ValueError('Scratch binding is absent or broader than approved')
    if (properties.get('FragmentPath') != '/etc/systemd/system/' + UNIT or
        properties.get('LoadState') != 'loaded'):
        raise ValueError('Unexpected installed retention unit')
    scheduled = entry['receipt']
    namespace = scheduled.get('scratchNamespace', {})
    if (namespace.get('path') != SCRATCH or namespace.get('exists') is not True or
        namespace.get('canonical') is not True or namespace.get('readOnlyBind') is not True or
        namespace.get('exactMount', {}).get('mountpoint') != SCRATCH or
        'ro' not in namespace.get('exactMount', {}).get('mountOptions', []) or
        'rw' in namespace.get('exactMount', {}).get('mountOptions', [])):
        raise ValueError('Actual checker namespace lacks exact read-only scratch')
    invocation = entry.get('invocationId', '')
    if not re.fullmatch('[0-9a-f]{32}', invocation) or namespace.get('invocationId') != invocation:
        raise ValueError('Namespace receipt is not bound to the service invocation')
    if properties.get('InvocationID') != invocation:
        raise ValueError('Namespace receipt is not from the current systemd invocation')
    if scheduled.get('role') != role or direct.get('role') != role:
        raise ValueError('Unexpected checker role')
    if (scheduled.get('historicalHeldInventory') != direct.get('historicalHeldInventory') or
        scheduled.get('issues') != direct.get('issues') or
        scheduled.get('units') != direct.get('units') or scheduled.get('ok') != direct.get('ok')):
        raise ValueError('Scheduled and direct protection checks disagree')
    held = scheduled.get('historicalHeldInventory', {})
    if held.get('heldPaths') != (295 if role == 'ui' else 521):
        raise ValueError('Historical inventory was not evaluated completely')
    if role == 'ui' and (held.get('approvedRelocatedHeldPaths') != 2 or
                        held.get('approvedRelocationEvidence', {}).get('ok') is not True):
        raise ValueError('Exact approved UI relocations were not verified')
    expected_exit = 0 if scheduled.get('ok') is True else 1
    if (direct_exit != expected_exit or
        properties.get('ExecMainStatus') != str(expected_exit)):
        raise ValueError('Checker status does not match reported protection')
    return {'ok': True, 'role': role, 'serviceInvocationId': invocation,
            'scratchReadOnlyInActualService': True,
            'scheduledAndDirectAgree': True, 'retentionOk': scheduled['ok'],
            'monitorExitStatus': expected_exit,
            'missingHeldPaths': held.get('missingHeldPaths', []),
            'approvedRelocatedHeldPaths': held.get('approvedRelocatedHeldPaths', 0),
            'qualification': 'Verification passes when namespace/reporting is correct; '
                             'a red retention result remains red and its missing paths remain visible.'}


def installed_verification(role):
    names = list(HARDENING) + ['CapabilityBoundingSet', 'AmbientCapabilities',
        'BindReadOnlyPaths', 'FragmentPath', 'LoadState', 'ExecMainStatus', 'InvocationID']
    arguments = ['systemctl', 'show', UNIT]
    for name in names:
        arguments += ['-p', name]
    properties_read = subprocess.run(arguments, check=True, capture_output=True,
                                    text=True, timeout=10)
    properties = dict(line.split('=', 1) for line in properties_read.stdout.splitlines() if '=' in line)
    journal = subprocess.run(['journalctl', '-u', UNIT, '--since=-5min', '-n', '40',
        '--no-pager', '-o', 'json'], check=True, capture_output=True, text=True, timeout=10)
    entry = None
    for line in journal.stdout.splitlines():
        try:
            row = json.loads(line)
            receipt = json.loads(row.get('MESSAGE', ''))
        except (ValueError, TypeError):
            continue
        if isinstance(receipt, dict) and receipt.get('role') == role and 'historicalHeldInventory' in receipt:
            entry = {'receipt': receipt, 'invocationId': row.get('_SYSTEMD_INVOCATION_ID', '')}
    if entry is None:
        raise ValueError('No fresh checker receipt from the actual service')
    direct_read = subprocess.run([CHECKER, '--role=' + role], capture_output=True,
                                 text=True, timeout=int(ROLE_DEADLINES[role][:-1]))
    result = verify_namespace(role, properties, entry,
        json.loads(direct_read.stdout), direct_read.returncode)
    result['checkedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    return result


def fixtures(role='ui'):
    properties = {**HARDENING, 'CapabilityBoundingSet': '', 'AmbientCapabilities': '',
        'TimeoutStartUSec': ROLE_DEADLINES[role],
        'BindReadOnlyPaths': SCRATCH, 'FragmentPath': '/etc/systemd/system/' + UNIT,
        'LoadState': 'loaded', 'ExecMainStatus': '1', 'InvocationID': 'a' * 32}
    if role == 'node':
        properties.update(CapabilityBoundingSet='cap_dac_read_search', AmbientCapabilities='cap_dac_read_search')
    held = {'heldPaths': 295 if role == 'ui' else 521, 'missingHeldPaths': ['/real-missing-evidence']}
    if role == 'ui':
        held.update(approvedRelocatedHeldPaths=2, approvedRelocationEvidence={'ok': True})
    direct = {'role': role, 'ok': False, 'issues': ['historical-held-path-missing-or-retirement-invalid'],
              'historicalHeldInventory': held, 'units': {'timer': {'persistentMask': True}}}
    scheduled = copy.deepcopy(direct)
    scheduled['scratchNamespace'] = {'path': SCRATCH, 'exists': True, 'canonical': True,
        'readOnlyBind': True, 'exactMount': {'mountpoint': SCRATCH, 'mountOptions': ['ro']},
        'invocationId': 'a' * 32}
    return properties, {'receipt': scheduled, 'invocationId': 'a' * 32}, direct, 1


class RetentionNamespaceTests(unittest.TestCase):
    def test_correct_reporting_preserves_known_red_status(self):
        for role in ('ui', 'node'):
            result = verify_namespace(role, *fixtures(role))
            self.assertTrue(result['ok'])
            self.assertFalse(result['retentionOk'])
            self.assertEqual(result['monitorExitStatus'], 1)
            self.assertEqual(result['missingHeldPaths'], ['/real-missing-evidence'])
            args = list(copy.deepcopy(fixtures(role)))
            args[0]['BindReadOnlyPaths'] = SCRATCH + ':' + SCRATCH + ':rbind'
            self.assertTrue(verify_namespace(role, *args)['ok'])

    def test_role_specific_approved_deadlines_are_exact(self):
        for role, wrong in (('ui', '20s'), ('ui', '59s'), ('ui', '61s'),
                            ('ui', '1min 1s'), ('ui', '2min'),
                            ('node', '60s'), ('node', '1min'), ('node', '21s')):
            args = list(copy.deepcopy(fixtures(role)))
            args[0]['TimeoutStartUSec'] = wrong
            with self.subTest(role=role, timeout=wrong), self.assertRaisesRegex(ValueError, 'TimeoutStartUSec'):
                verify_namespace(role, *args)

    def test_actual_canonical_ui_one_minute_spelling_preserves_red_status(self):
        args = list(copy.deepcopy(fixtures('ui')))
        args[0]['TimeoutStartUSec'] = '1min'
        result = verify_namespace('ui', *args)
        self.assertTrue(result['ok'])
        self.assertFalse(result['retentionOk'])
        self.assertEqual(result['monitorExitStatus'], 1)
        self.assertEqual(result['missingHeldPaths'], ['/real-missing-evidence'])

    def test_receipt_must_match_current_systemd_invocation(self):
        for role in ('ui', 'node'):
            for current in ('', 'b' * 32):
                args = list(copy.deepcopy(fixtures(role)))
                args[0]['InvocationID'] = current
                with self.subTest(role=role, invocation=current), self.assertRaisesRegex(
                        ValueError, 'current systemd invocation'):
                    verify_namespace(role, *args)

    def test_private_namespace_false_positive_or_changed_hardening_rejected(self):
        for name in HARDENING:
            args = list(copy.deepcopy(fixtures())); args[0][name] = 'changed'
            with self.subTest(name=name), self.assertRaises(ValueError):
                verify_namespace('ui', *args)
        for mutate in (
            lambda a: a[0].update(BindReadOnlyPaths=''),
            lambda a: a[0].update(BindReadOnlyPaths=SCRATCH + ' /var/tmp'),
            lambda a: a[0].update(CapabilityBoundingSet='cap_sys_admin'),
            lambda a: a[1]['receipt']['scratchNamespace'].update(readOnlyBind=False),
            lambda a: a[1]['receipt']['scratchNamespace']['exactMount'].update(mountOptions=['rw']),
            lambda a: a[1]['receipt']['scratchNamespace'].update(invocationId='b' * 32),
            lambda a: a[1]['receipt']['historicalHeldInventory'].update(missingHeldPaths=['/namespace-hidden']),
            lambda a: a[1]['receipt']['historicalHeldInventory'].update(heldPaths=1),
            lambda a: a[0].update(ExecMainStatus='0'),
        ):
            args = list(copy.deepcopy(fixtures())); mutate(args)
            with self.assertRaises(ValueError):
                verify_namespace('ui', *args)

    def test_templates_preserve_hardening_exact_binding_and_approved_deadlines(self):
        expected = {'Type': 'oneshot', 'User': 'root', 'Group': 'root', 'TimeoutStartSec': '20s',
            'MemoryMax': '32M', 'CPUQuota': '10%', 'TasksMax': '16', 'NoNewPrivileges': 'true',
            'PrivateTmp': 'true', 'PrivateDevices': 'true', 'ProtectSystem': 'strict',
            'ProtectHome': 'true', 'ProtectControlGroups': 'true', 'ProtectKernelLogs': 'true',
            'ProtectKernelModules': 'true', 'ProtectKernelTunables': 'true',
            'RestrictAddressFamilies': 'AF_UNIX', 'RestrictSUIDSGID': 'true',
            'LockPersonality': 'true', 'RestrictRealtime': 'true', 'UMask': '0077',
            'BindReadOnlyPaths': SCRATCH}
        for role in ('ui', 'node'):
            text = (ROOT / ('deploy/proofofwork-retention-protection-' + role + '.service')).read_text()
            lines = [line for line in text.splitlines() if '=' in line]
            settings = dict(line.split('=', 1) for line in lines)
            self.assertEqual(len(settings), len(lines))
            for name, value in {**expected, 'TimeoutStartSec': ROLE_DEADLINES[role]}.items():
                self.assertEqual(settings.get(name), value)
            self.assertEqual(settings['ExecStart'], CHECKER + ' --role=' + role)
            caps = 'CAP_DAC_READ_SEARCH' if role == 'node' else ''
            self.assertEqual(settings['CapabilityBoundingSet'], caps)
            self.assertEqual(settings['AmbientCapabilities'], caps)
            self.assertNotIn('ReadWritePaths', settings)


if __name__ == '__main__':
    if '--verify-installed' not in sys.argv:
        unittest.main(verbosity=2)
    else:
        parser = argparse.ArgumentParser()
        parser.add_argument('--verify-installed', action='store_true', required=True)
        parser.add_argument('--role', choices=['ui', 'node'], required=True)
        options = parser.parse_args()
        try:
            print(json.dumps(installed_verification(options.role)))
        except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError) as error:
            print(json.dumps({'ok': False, 'role': options.role, 'errorClass': type(error).__name__,
                              'error': str(error)}))
            raise SystemExit(1)
