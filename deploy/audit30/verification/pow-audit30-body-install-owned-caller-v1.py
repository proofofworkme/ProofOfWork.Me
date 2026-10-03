#!/usr/bin/python3
"""One separately Root-authorized install transport. No retry or implied next step."""
import hashlib,json,sys,types
from pathlib import Path
T_PATH=Path('/tmp/pow-audit30-readonly-owned-transport-v3.py');T_SHA='1dedef0a6c7021d114017e711ad74f9cfed4e461fc047a2be2c49e590f3da18e'
SOURCE=Path('/tmp/pow-audit30-body-human-authority-install-v1.py');SOURCE_SHA='511c01dd8d7cfb5808038498cb45788720d34aac9ff29e7793374f761d9b3119';REQUEST=Path('/tmp/pow-audit30-body-human-authority-install-request-v1.json');REQUEST_SHA='dbf50b04aad837714af813e0f65f1ca2bc15d74990243e635206207e9634a606';PREFIX=Path('/tmp/pow-audit30-body-human-authority-install-native-v1');DEADLINE=90;REQUEST_CAP=65536
def main():
 if len(sys.argv)!=1:raise ValueError('NO_EXTRA_ARGV')
 raw=T_PATH.read_bytes()
 if len(raw)>12288 or hashlib.sha256(raw).hexdigest()!=T_SHA:raise ValueError('EXACT_SHARED_TRANSPORT_PIN')
 T=types.ModuleType('frozen_owned_transport');T.__file__=str(T_PATH);exec(compile(raw,str(T_PATH),'exec'),T.__dict__)
 source=T.bound(SOURCE,SOURCE_SHA,49152);request=T.bound(REQUEST,REQUEST_SHA,REQUEST_CAP)
 result=T.execute(T.remote_command(source),request,PREFIX,DEADLINE,stdout_cap=65536,stderr_cap=65536,bindings={'sourceSHA256':SOURCE_SHA,'requestSHA256':REQUEST_SHA,'transportSHA256':T_SHA,'operation':'install','nativeStopNotInferredFromTransport':True})
 print(json.dumps(result,sort_keys=True));return 0 if result['exitCode']==0 and result['failure']is None else 1
if __name__=='__main__':sys.exit(main())
