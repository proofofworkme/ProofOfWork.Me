"""Pure validator for fixed source-only comparative capture, never a PG caller."""
import copy
LABELS=[f'{anchor}-{phase}-comparison'for anchor in('activation','migration','latest-pwid')for phase in('initial','final')]
BOOLS=['transactionReadOnly','originalDense','candidateDense','headersEqual','payloadJSONBEqual','payloadTextEqual','payloadSHA256Equal','orderedHeightsEqual','rowMembershipEqual','boundaryFullPayloadEqual']
def validate_comparisons(values):
 if not isinstance(values,list):raise ValueError('values must be list')
 if len(values)<7:raise ValueError('incomplete comparison capture')
 scope=values[0]
 if not isinstance(scope,dict)or scope.get('label')!='scope'or scope.get('transactionReadOnly')is not True or scope.get('sameSnapshot')is not True or scope.get('maximumRowsPerPage')!=3 or not isinstance(scope.get('snapshot'),str):raise ValueError('fixed readonly scope differs')
 comparisons=values[1:7]
 for label,v in zip(LABELS,comparisons):
  if not isinstance(v,dict)or v.get('label')!=label:raise ValueError('fixed ordered labels differ')
  for k in BOOLS:
   if v.get(k)is not True:raise ValueError('comparison predicate refused: '+k)
  n=v.get('originalRows')
  if type(n)is not int or not 1<=n<=3:raise ValueError('original population bound differs')
  if any(type(v.get(k))is not int or v[k]!=n for k in['candidateRows','originalUniqueKeys','candidateUniqueKeys']):raise ValueError('row/unique-key membership differs')
  o=v.get('originalFingerprints');c=v.get('candidateFingerprints')
  if not isinstance(o,list)or len(o)!=n or o!=c:raise ValueError('ordered fingerprints differ')
  heights=[]
  for f in o:
   if set(f)!= {'height','headerSHA256','payloadSHA256','payloadBytes'}:raise ValueError('fingerprint shape differs')
   if type(f['height'])is not int or f['height']<1 or type(f['payloadBytes'])is not int or f['payloadBytes']<0:raise ValueError('fingerprint numeric bound differs')
   for k in['headerSHA256','payloadSHA256']:
    if not isinstance(f[k],str)or len(f[k])!=64 or any(ch not in'0123456789abcdef'for ch in f[k]):raise ValueError('fingerprint hash differs')
   heights.append(f['height'])
  if heights!=list(range(heights[0],heights[0]+n)):raise ValueError('dense ordered heights differ')
  if type(v.get('boundaryRows'))is not int or not 0<=v['boundaryRows']<=n:raise ValueError('boundary population differs')
  if label.startswith('migration-')and(v['boundaryRows']!=1 or heights[0]!=960601):raise ValueError('full migration sample missing')
 # Plan labels and plans are separately required for a complete native result.
 if len(values)!=11:raise ValueError('plan capture incomplete or extra values')
 for offset,name in[(7,'original'),(9,'candidate')]:
  if values[offset]!= {'label':f'activation-{name}-explain'}:raise ValueError('fixed plan label differs')
  plan=values[offset+1]
  if not isinstance(plan,list)or len(plan)!=1 or not isinstance(plan[0],dict)or'Plan'not in plan[0]:raise ValueError('EXPLAIN shape differs')
 return {'boundedComparisonsPassed':True,'comparisonCount':6,'planCount':2,'maximumRowsPerPage':3,'sameSnapshot':True}
