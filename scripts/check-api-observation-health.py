#!/usr/bin/env python3
import runpy
summarize = runpy.run_path('deploy/proofofwork-api-observation-health.py')['summarize']
base = {'event':'http-response-observation','method':'GET','route':'/api/v1/token-history','status':200,'elapsedMs':50,'payloadBytes':123}
assert summarize([])['coverage']=='no-observations'
assert summarize([base]*20)['severity']==0
assert summarize([base]*19+[{**base,'status':503}])['severity']==1
assert summarize([base]*17+[{**base,'status':503}]*3)['severity']==2
assert summarize([{**base,'elapsedMs':30000}]*5)['severity']==2
assert 'missing-payload-measurement' in summarize([{**base,'payloadBytes':None}]*5)['routes'][0]['alerts']
assert 'large-response' in summarize([{**base,'payloadBytes':8*1024**2}])['routes'][0]['alerts']
assert summarize([{**base,'route':'/api/v1/address/private/utxo'}])['routes'][0]['route']=='/api/v1/address/:address/utxo'
print('API observation thresholds, absent coverage, byte measurements and address normalization passed.')
