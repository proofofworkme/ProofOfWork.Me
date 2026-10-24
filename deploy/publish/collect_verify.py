"""Verify release bytes on the VPS; return only compact receipts to the operator."""
import argparse
import base64
import hashlib
import json
import pathlib
import re
import shlex
import subprocess


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("plan")
parser.add_argument("publish_log")
parser.add_argument("destination")
args = parser.parse_args()
plan_path = pathlib.Path(args.plan)
publish_path = pathlib.Path(args.publish_log)
assert plan_path.stat().st_size <= 65536
assert publish_path.stat().st_size <= 8 * 1024**2
plan = json.loads(plan_path.read_text())
release, commit, tree = (plan[k] for k in ("releaseId", "commit", "tree"))
assert re.fullmatch(r"[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z", release)
assert re.fullmatch(r"[0-9a-f]{40}", commit)
assert re.fullmatch(r"[0-9a-f]{40}", tree)
assert release.startswith(commit[:12] + "-")
rows = []
for line in publish_path.read_text().splitlines():
    try:
        value = json.loads(line)
    except json.JSONDecodeError:
        continue
    if isinstance(value, dict):
        rows.append(value)
receipts = [r for r in rows if r.get("releaseId") == release and "exitCode" in r]
assert len(receipts) == 1
receipt = receipts[0]
assert receipt["commit"] == commit and receipt["tree"] == tree
assert receipt["exitCode"] == 0 and receipt["failure"] is None
proofs = [r for r in rows if r.get("ok") is True and r.get("allPriorRootsPreserved") is True]
assert len(proofs) == 1
proof = proofs[0]
assert re.fullmatch(r"[0-9a-f]{64}", proof["archiveSha256"])
assert re.fullmatch(r"[0-9a-f]{64}", proof["manifestSha256"])
destination = pathlib.Path(args.destination)
assert destination.is_absolute()
destination.mkdir(mode=0o700)
assert destination.resolve() == destination
helper = pathlib.Path(__file__).with_name("https_smoke.py")
helper_raw = helper.read_bytes()
assert hashlib.sha256(helper_raw).hexdigest() == plan["httpsSmokeSha256"]
# No archive, runtime capture or restoration payload crosses back to this host.
# The pinned verifier reads the existing archive and active manifest on the VPS.
request = {"releaseId": release, "commit": commit, "tree": tree,
           "archiveSha256": proof["archiveSha256"], "manifestSha256": proof["manifestSha256"],
           "helperBase64": base64.b64encode(helper_raw).decode(),
           "helperSha256": plan["httpsSmokeSha256"]}
bootstrap = r'''
import base64,hashlib,json,os,pathlib,re,stat,subprocess,sys
assert os.geteuid()==os.getegid()==0 and sys.flags.isolated
raw=sys.stdin.buffer.read(262145);assert len(raw)<=262144
r=json.loads(raw);rid=r['releaseId']
assert re.fullmatch('[0-9a-f]{12}-[0-9]{8}T[0-9]{6}Z',rid)
assert all(re.fullmatch('[0-9a-f]{40}',r[k]) for k in ('commit','tree'))
assert rid.startswith(r['commit'][:12]+'-')
assert all(re.fullmatch('[0-9a-f]{64}',r[k]) for k in ('archiveSha256','manifestSha256','helperSha256'))
code=base64.b64decode(r['helperBase64'],validate=True)
assert len(code)<=131072 and hashlib.sha256(code).hexdigest()==r['helperSha256']
manifest=pathlib.Path('/var/www/.proofofwork-ui-release')
assert manifest.resolve()==manifest and manifest.stat().st_size<=65536
assert hashlib.sha256(manifest.read_bytes()).hexdigest()==r['manifestSha256']
parent=pathlib.Path('/var/backups/proofofwork-ui/cleanup-evidence')
s=parent.lstat();assert parent.resolve()==parent and stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==0 and not s.st_mode&0o7022
subprocess.run(['/usr/bin/python3','-I','-B','/usr/local/sbin/proofofwork-ui-capacity','check',
 '--path',str(parent),'--additional-bytes','65536','--additional-inodes','4','--phase','vps-https-receipt'],check=True,stdout=subprocess.DEVNULL,timeout=60)
os.umask(0o077)
receipt=parent/('ui-https-'+rid+'.json')
assert not os.path.lexists(receipt),'Existing HTTPS receipt requires explicit reconciliation'
archive='/var/backups/proofofwork-ui/releases/proofofwork-ui-release-'+rid+'.tgz'
result=subprocess.run(['/usr/bin/python3','-I','-B','-c',code.decode(),archive,rid,r['commit'],r['tree'],r['archiveSha256'],
 '--manifest',str(manifest),'--receipt',str(receipt),'--workers','8','--timeout','30','--overall-timeout','900'],
 capture_output=True,timeout=930)
assert receipt.is_file() and not receipt.is_symlink() and receipt.stat().st_size<=65536,'Missing or oversized HTTPS receipt'
data=receipt.read_bytes();value=json.loads(data)
assert hashlib.sha256(manifest.read_bytes()).hexdigest()==r['manifestSha256'],'Live release changed during HTTPS verification'
print(json.dumps({'remoteReceipt':str(receipt),'sha256':hashlib.sha256(data).hexdigest(),'receipt':value}),flush=True)
if result.returncode or value.get('ok') is not True:
 sys.stderr.buffer.write(result.stderr[-4096:]);sys.exit(1)
'''
command = ["ssh", "-i", "/home/sixer/.ssh/proofofwork_me_ed25519",
           "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
           "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10", "root@77.42.91.106",
           shlex.join(['/usr/bin/python3', '-I', '-B', '-c', bootstrap])]
result = subprocess.run(command, input=json.dumps(request).encode(), capture_output=True, timeout=1020)
assert len(result.stdout) <= 65536 and len(result.stderr) <= 65536, 'Oversized remote verification report'
if result.returncode:
    raise RuntimeError('VPS HTTPS verification failed; inspect its durable receipt: ' + result.stderr.decode(errors='replace')[-4096:])
verified = json.loads(result.stdout)
smoke = verified['receipt']
assert smoke.get('ok') is True
for key, expected in [('releaseId', release), ('commit', commit), ('tree', tree),
                      ('archiveSha256', proof['archiveSha256']), ('manifestSha256', proof['manifestSha256'])]:
    assert smoke[key] == expected, 'Remote verification identity differs: ' + key
with (destination/'vps-verification.json').open('x') as output:
    json.dump(verified, output, sort_keys=True); output.write('\n')
with (destination/'https-smoke-receipt.json').open('x') as output:
    json.dump(smoke, output, sort_keys=True); output.write('\n')
assert plan.get('retentionLifecycle'), 'Release requires an installed retention lifecycle binding'
lifecycle = pathlib.Path(__file__).parents[1] / 'ui-retention/lifecycle.py'
subprocess.run(['/usr/bin/python3', '-I', '-B', str(lifecycle), 'complete',
                str(plan_path), str(publish_path), str(destination/'https-smoke-receipt.json'),
                str(destination/'retention')], check=True, timeout=14400)
