#!/usr/bin/env python3
"""Offline proof of the pending-summary rehearsal boundary; no production I/O."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
spec = importlib.util.spec_from_file_location('pending_rehearsal', HERE / 'rehearsal.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
# The unchanged, hash-pinned sandbox's SQL/RPC/startup/environment tests remain
# executable coverage; the tests below exercise this new caller and result.
base_spec = importlib.util.spec_from_file_location('original_rehearsal_tests',
    HERE.parent / 'work-batch-reader-recovery/rehearsal.test.py')
base_tests = importlib.util.module_from_spec(base_spec)
base_spec.loader.exec_module(base_tests)
SharedSandbox = base_tests.Rehearsal


def javascript(source):
    result = subprocess.run(['node', '--input-type=module'], input=source, text=True,
                            capture_output=True, timeout=30)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout


def family(tx, height, count, miner):
    return {'txid':tx,'height':height,'recipientCount':count,'parentCount':1,'childCount':count,
            'registryPaymentSats':546,'minerFeeSats':miner,'zeroFeeChildren':True}


def result_fixture():
    call = {'ok':True,'published':False,'publicationAccountingCurrent':True,
            'indexedThroughBlock':973575,'indexedThroughBlockHash':'a'*64,'snapshotId':'b'*24,
            'summaryKeys':r.SUMMARY_KEYS,
            'knownConfirmedFamilies':[family(r.B25,973284,12,546),family(r.C69,973567,7,432)],
            'pendingHistoryProof':{'txid':r.PENDING,'state':'pending','inputCount':189,'uniqueKeys':189,
                'preservedCount':189,'canonicalPendingTransfers':0,'canonicalPendingParents':0,'identityError':False}}
    return {**copy.deepcopy(call),'format':r.FORMAT,'twoCalls':True,'calls':[copy.deepcopy(call),copy.deepcopy(call)]}


def native_fixture(plan, output):
    binds = ' '.join(str(output / name) + ':' + str(r.RUNTIME / target) for name,target in
        [('api.mjs',r.API),('reader.mjs',r.READER),('worker.mjs',r.WORKER),('postgres.mjs',r.POSTGRES)])
    return {'LoadState':'loaded','ActiveState':'active','SubState':'exited','Result':'success',
        'ExecMainStatus':'0','MainPID':'0','InvocationID':'c'*32,'ProtectSystem':'strict',
        'NoNewPrivileges':'yes','ReadWritePaths':'','User':'powadmin','WorkingDirectory':str(r.RUNTIME),
        'BindReadOnlyPaths':binds,'ExecStart':'{ path=/node ; argv[]='+' '.join(r.command(plan,output,{})[-4:])+' ; ignore_errors=no ; }',
        'EnvironmentFiles':'/private/one.env (ignore_errors=no) /private/two.env (ignore_errors=no)',
        'MemoryMax':str(2*1024**3),'MemorySwapMax':'0','CPUQuotaPerSecUSec':'1s','RuntimeMaxUSec':'5min',
        'TimeoutStopUSec':'15s','KillMode':'control-group','RemainAfterExit':'yes'}


class PendingRehearsal(unittest.TestCase):
    def test_exact_private_transform_and_startup_removal(self):
        raw = (ROOT / r.API).read_bytes()
        actual = r.transform_api(raw).decode()
        expected = r.BASE['transform_api'](raw).decode()
        inverse = actual.removesuffix(r.TAIL) + r.BASE['TAIL']
        inverse = inverse.replace(r.OBSERVED_RETURN, r.RETURN)
        self.assertEqual(inverse, expected)
        self.assertNotIn('server.listen(', actual)
        self.assertEqual(actual.count(r.OBSERVED_RETURN), 1)
        self.assertEqual(actual.count('for (let call = 0; call < 2; call++)'),1)
        checked = subprocess.run(['node','--input-type=module','--check'],input=actual,text=True,capture_output=True)
        self.assertEqual(checked.returncode,0,checked.stderr)
        for wrong in [raw.replace(r.RETURN.encode(), b'return payload;'), raw+r.RETURN.encode()]:
            with self.assertRaises(ValueError):r.transform_api(wrong)

    def test_observer_uses_actual_pending_identity_and_does_not_mutate(self):
        source=(ROOT/r.API).read_text()
        start=source.index('function tokenTransferHistoryItemKey(')
        end=source.index('\nfunction ',start+1)
        key=source[start:end]
        javascript('''
import assert from 'node:assert/strict';
const isWorkBatchTransferChild = row => row.transferVersion === 'batch1';
''' + key + '''
const payload={transfers:Array.from({length:189},(_,i)=>({txid:"''' + r.PENDING + '''",
 tokenId:'work',network:'livenet',transferVersion:'batch1',confirmed:false,protocolVout:1,recordOrdinal:i+1,
 containerPosition:{protocolVout:1,recordOrdinal:0},batchRecipientIndex:i,batchRecipientCount:189})),transferBatches:[{confirmed:false}]};
const before=JSON.stringify(payload);
globalThis.__pendingSummaryObservations=[];
function run(){
''' + r.OBSERVED_RETURN + '''
}
const filtered=run(), proof=globalThis.__pendingSummaryObservations[0];
assert.equal(proof.inputCount,189); assert.equal(proof.uniqueKeys,189);
assert.equal(proof.preservedCount,189); assert.equal(proof.identityError,false);
assert.equal(proof.canonicalPendingTransfers,0);assert.equal(proof.canonicalPendingParents,0);
assert.equal(JSON.stringify(payload),before);assert.equal(filtered.transfers.length,0);
payload.transfers[3].recordOrdinal=1;
assert.throws(run,/pending WORK batch/i);
''')

    def test_result_requires_actual_two_calls_families_and_pending_exclusion(self):
        original=result_fixture()
        self.assertEqual(r.validate_result(original),original)
        changes=[('accounting',lambda x:x['calls'][1].update(publicationAccountingCurrent=False)),
          ('callfailure',lambda x:x['calls'][0].update(ok=False)),
          ('publication',lambda x:x.update(published=True)),
          ('checkpoint',lambda x:x['calls'][1].update(indexedThroughBlock=973576)),
          ('hash',lambda x:x['calls'][1].update(indexedThroughBlockHash='c'*64)),
          ('snapshot',lambda x:x['calls'][1].update(snapshotId='c'*24)),
          ('coverage',lambda x:x['calls'][1].update(summaryKeys=r.SUMMARY_KEYS[:-1])),
          ('parentcount',lambda x:x['calls'][1]['knownConfirmedFamilies'][0].update(parentCount=2)),
          ('childcount',lambda x:x['calls'][1]['knownConfirmedFamilies'][0].update(childCount=11)),
          ('childfees',lambda x:x['calls'][1]['knownConfirmedFamilies'][1].update(zeroFeeChildren=False)),
          ('parentfee',lambda x:x['calls'][0]['knownConfirmedFamilies'][0].update(registryPaymentSats=1092)),
          ('miner',lambda x:x['calls'][0]['knownConfirmedFamilies'][0].update(minerFeeSats=0)),
          ('collapsed',lambda x:x['calls'][1]['pendingHistoryProof'].update(uniqueKeys=1)),
          ('mutated',lambda x:x['calls'][1]['pendingHistoryProof'].update(preservedCount=0)),
          ('canonicalpending',lambda x:x['calls'][1]['pendingHistoryProof'].update(canonicalPendingParents=1)),
          ('identity',lambda x:x['calls'][1]['pendingHistoryProof'].update(identityError=True)),
          ('onecall',lambda x:x.update(calls=x['calls'][:1]))]
        for name,change in changes:
            with self.subTest(name=name):
                value=copy.deepcopy(original);change(value)
                with self.assertRaises(ValueError):r.validate_result(value)

    def test_confirmation_and_eviction_are_not_false_pending_claims(self):
        for state in ['confirmed','absent']:
            value=result_fixture()
            for call in [value,*value['calls']]:
                proof=call['pendingHistoryProof'];proof.update(state=state,inputCount=0,uniqueKeys=0,preservedCount=0)
                if state=='confirmed':proof['confirmedFamily']=family(r.PENDING,973575,189,3123)
            r.validate_result(value)
            if state=='confirmed':
                value['calls'][0]['pendingHistoryProof']['confirmedFamily']['childCount']=188
                with self.assertRaises(ValueError):r.validate_result(value)
            else:
                value['calls'][0]['pendingHistoryProof']['inputCount']=189
                with self.assertRaises(ValueError):r.validate_result(value)

    def test_actual_tail_worker_gate_two_calls_and_public_family_proofs(self):
        tail=r.TAIL.replace('await import("../scripts/backfill-proof-indexer.mjs")','worker')
        javascript('''
import assert from 'node:assert/strict';
let corrupt='',calls=0,checked=0,exitCode,lastResult;
const hash='a'.repeat(64),height=973575,snapshot='b'.repeat(24);
const proofIndexOperationalStatusPayload=async()=>({indexedThroughBlock:height,scan:{blockHash:hash}});
const worker={summaryPayloadsWithAlignedWorkFloor:x=>x,canonicalSummaryCoverage:()=>height,
 summaryPayloadSnapshotId:x=>x.snapshotId,canonicalSummaryAccountingModelsCurrent:()=>{checked++;return corrupt!=='worker';}};
const families=[['''+json.dumps(r.B25)+''',973284,12,546],['''+json.dumps(r.C69)+''',973567,7,432]];
const internalCanonicalSummaryPayload=async()=>{
 calls++;
 if(corrupt==='first-call'&&calls===1)throw Error('failed');
 globalThis.__pendingSummaryObservations.push({txid:'''+json.dumps(r.PENDING)+''',inputCount:189,uniqueKeys:corrupt==='keys'?1:189,
 preservedCount:189,canonicalPendingTransfers:0,canonicalPendingParents:0,identityError:false});
 const projection={transferBatches:families.map(([txid,blockHeight,recipientCount,minerFeeSats])=>({txid,blockHeight,recipientCount,
 confirmed:true,kind:'token-transfer-batch',transferVersion:'batch1',paidSats:546,registryMutationFeeSats:546,batchRegistryPaymentSats:546,minerFeeSats})),
 items:families.flatMap(([txid,blockHeight,count])=>Array.from({length:count},()=>({txid,blockHeight,confirmed:true,transferVersion:'batch1',
 rawCandidate:false,economicDelta:false,chargesTransactionFee:false,claimsEconomicOutputs:false,paidSats:0,registryMutationFeeSats:0,
 minerFeeSats:0,canonicalMinerFeeSats:0,attributedMinerFeeSats:0})))};
 if(corrupt==='flag')delete projection.items[0].chargesTransactionFee;
 if(corrupt==='fee')projection.items[0].minerFeeSats=546;
 const summaryPayloads=Object.fromEntries('''+json.dumps(r.SUMMARY_KEYS)+'''.map(key=>[key,{indexedThroughBlockHash:hash,snapshotId:snapshot}]));
 summaryPayloads.workSummary.workTransferValueProjection=projection;
 return {indexedThroughBlock:height,indexedThroughBlockHash:hash,snapshotId:corrupt==='snapshot'&&calls===2?'c'.repeat(24):snapshot,summaryPayloads};
};
process.exit=code=>{exitCode=code;};console.log=value=>{lastResult=JSON.parse(value);};console.error=()=>{};
async function run(){
'''+tail+'''
}
await run();assert.equal(exitCode,0);assert.equal(calls,2);assert.equal(checked,2);
assert.equal(lastResult.calls.length,2);assert.equal(lastResult.pendingHistoryProof.uniqueKeys,189);
for(const failure of ['worker','keys','flag','fee','snapshot','first-call']){
 corrupt=failure;calls=0;await run();assert.equal(exitCode,1,failure);
 if(failure==='first-call')assert.equal(calls,1);
}
''')

    def test_native_terminal_sandbox_and_identity_are_mandatory(self):
        plan={'runtimeManifestTemplate':{'releaseId':'a'*12+'-20261028T180000Z'},'nodePath':'/usr/bin/node'}
        output=Path('/tmp/proofofwork-rehearsal-test')
        state=native_fixture(plan,output)
        r.validate_native(state,plan,output,state['EnvironmentFiles'])
        for key,bad in [('LoadState','not-found'),('ExecMainStatus','1'),('MainPID','42'),('Result','timeout'),
                        ('InvocationID',''),('ProtectSystem','no'),('ReadWritePaths','/data'),('User','root'),
                        ('MemorySwapMax','1'),('MemoryMax','infinity'),('RuntimeMaxUSec','infinity'),
                        ('BindReadOnlyPaths',''),('ExecStart','other'),('EnvironmentFiles','/private/two.env (ignore_errors=no)')]:
            with self.subTest(key=key):
                changed={**state,key:bad}
                with self.assertRaises(ValueError):r.validate_native(changed,plan,output,state['EnvironmentFiles'])

    def test_real_private_modes_exclusive_creation_and_symlink_refusal(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            old=os.umask(0o077)
            try:r.save(root/'api.mjs',b'export {};',0o644);r.save(root/'intent.json',b'{}')
            finally:os.umask(old)
            self.assertEqual(stat.S_IMODE((root/'api.mjs').stat().st_mode),0o644)
            self.assertEqual(stat.S_IMODE((root/'intent.json').stat().st_mode),0o600)
            with self.assertRaises(FileExistsError):r.save(root/'api.mjs',b'changed',0o644)
            (root/'symlink').symlink_to(root/'intent.json')
            with self.assertRaises(FileExistsError):r.save(root/'symlink',b'changed')
            self.assertEqual((root/'intent.json').read_bytes(),b'{}')

    def test_qualified_receipt_passes_actual_controller_and_rejects_physical_or_dispatch_tampering(self):
        controller = {'__name__':'_offline_qualification_controller'}
        exec(compile((HERE/'scoped-node.py').read_bytes(),'scoped-node.py','exec'),controller)
        expected={name:('fixture '+name).encode() for name in r.ADAPTER_NAMES}
        candidate=b'candidate'
        manifest={'sourceCommit':'a'*40,'sourceTree':'b'*40,'releaseId':'a'*12+'-20261028T180000Z',
          'sources':[{'path':r.API,'after':r.sha(candidate)}],
          'dependencies':{r.API:'c'*64,r.READER:'d'*64,r.WORKER:'e'*64}}
        plan={'runtimeManifestTemplate':manifest,'nodePath':'/usr/bin/node','rehearsalHelperSha256':'f'*64}
        with tempfile.TemporaryDirectory(prefix='proofofwork-qualification-fixture-') as directory:
            output=Path(directory)
            args=SimpleNamespace(output=output,plan_sha256='1'*64)
            native=native_fixture(plan,output)
            identity={'format':r.DISPATCH_FORMAT,'planSha256':args.plan_sha256,
              'sourceCommit':manifest['sourceCommit'],'sourceTree':manifest['sourceTree'],'releaseId':manifest['releaseId'],
              'rehearsalHelperSha256':plan['rehearsalHelperSha256'],'candidateHashes':{r.API:r.sha(candidate)},
              'dependencyHashes':manifest['dependencies'],'adapterHashes':{k:r.sha(v) for k,v in expected.items()},
              'unit':r.unit_name(manifest),'published':False,'productionSourceMutation':False}
            dispatch={**identity,'dispatchExitCode':0,'invocationId':native['InvocationID']}
            for name,raw in expected.items():r.save(output/name,raw,0o644)
            for name,value in [('intent.json',identity),('dispatch.json',dispatch)]:
                r.save(output/name,json.dumps(value).encode())
            r.save(output/'stdout',(json.dumps(result_fixture())+'\n').encode());r.save(output/'stderr',b'')
            ns={**controller,'safe_read':lambda path,limit=10*1024**2:path.read_bytes(),
                'ctl':lambda *args:native['EnvironmentFiles']}
            with mock.patch.object(r,'adapters',return_value=expected),mock.patch.object(r,'native_state',return_value=native),\
                 mock.patch.object(r,'fence'):
                receipt=r.qualified_receipt(args,plan,manifest,{}, {r.API:candidate},ns)
                controller['validate_rehearsal'](receipt,args.plan_sha256,manifest,plan['rehearsalHelperSha256'])
                self.assertEqual(receipt['nativeProperties']['LoadState'],'loaded')
                self.assertEqual(set(receipt['evidenceReferences']),set(r.EVIDENCE_NAMES))
                for name,ref in receipt['evidenceReferences'].items():
                    self.assertEqual(ref,{'path':str(output/name),'sha256':r.sha((output/name).read_bytes()),
                                          'bytes':(output/name).stat().st_size})
                for key,bad in [('sourceTree','c'*40),('invocationId','2'*32),('dispatchExitCode',1),
                                ('dependencyHashes',{}),('rehearsalHelperSha256','2'*64)]:
                    altered={**dispatch,key:bad};(output/'dispatch.json').write_text(json.dumps(altered))
                    with self.subTest(key=key),self.assertRaises(ValueError):
                        r.qualified_receipt(args,plan,manifest,{}, {r.API:candidate},ns)
                (output/'dispatch.json').write_text(json.dumps(dispatch))
                (output/'reader.mjs').write_bytes(b'altered')
                with self.assertRaises(ValueError):r.qualified_receipt(args,plan,manifest,{}, {r.API:candidate},ns)
            self.assertFalse((output/'qualification.json').exists())

    def test_committed_sandbox_pin_and_evidence_contract(self):
        self.assertEqual(r.sha(r.BASE_PATH.read_bytes()),r.BASE_SHA256)
        self.assertEqual(set(r.EVIDENCE_NAMES),{'intent.json','dispatch.json','stdout','stderr',
            'api.mjs','reader.mjs','worker.mjs','postgres.mjs','fetch-guard.mjs'})
        self.assertEqual(set(r.ADAPTER_NAMES),set(r.EVIDENCE_NAMES)-{'intent.json','dispatch.json','stdout','stderr'})
        self.assertNotIn('chargesRegistryFee',r.TAIL)
        self.assertNotIn('chargesMinerFee',r.TAIL)


if __name__=='__main__':unittest.main()
