#!/usr/bin/env python3
import copy,hashlib,importlib.util,json,os,pathlib,re,tempfile,unittest
from unittest.mock import patch
P=pathlib.Path('/tmp/pow-audit30-readiness-closure-collector-v2.py');spec=importlib.util.spec_from_file_location('closure',P);M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)
SRC=pathlib.Path('/home/sixer/ProofOfWork.Me/deploy/proof-indexer-readiness-epoch.sql')
def fixture():
 fs=[]
 for name,(h,n)in sorted((M.FUNCTION_HASHES|M.MARKER_HASHES).items()):
  marker=name in M.MARKER_HASHES
  fs.append({'name':name,'owner':'proof_indexer'if marker else'proof_indexer_readiness_owner','language':'plpgsql','securityDefiner':not marker,'config':None if marker else['search_path=pg_catalog, pg_temp'],'kind':'f','argumentCount':0,'returnsSet':False,'returnTypeOid':2279,'volatility':'v','parallel':'u','strict':False,'leakProof':False,'supportOid':0,'sourceSha256':h,'sourceBytes':n,'canonicalSourceEquality':True,'definitionSha256':'a'*64,'acl':[{'grantee':x,'grantor':'proof_indexer'if marker else'proof_indexer_readiness_owner','privilege':'EXECUTE','grantable':False}for x in(['PUBLIC','proof_indexer']if marker else['proof_indexer','proof_indexer_readiness_owner'])]})
 ts=[{'relation':r,'name':n,'function':f,'functionSchema':'proof_indexer','enabled':'O'if n in M.MARKER_TRIGGER_HASHES else'A','type':t,'internal':False,'hasConstraint':d,'deferrable':d,'initiallyDeferred':d,'argumentCount':0,'argumentBytes':0,'noCondition':True,'oldTransitionTable':None,'newTransitionTable':None,'noParent':True,'definitionSha256':M.MARKER_TRIGGER_HASHES.get(n,'b'*64)}for r,n,f,t,d in M.expected_triggers()]
 rs=[{'name':n,'owner':'proof_indexer_readiness_owner'if n.startswith('readiness_')else'proof_indexer','kind':'r','persistence':'p','rls':False,'forceRls':False,'accessMethod':'heap','ruleCount':0,'inheritanceCount':0,'columns':[],'constraints':[],'indexes':[],'acl':[]}for n in['mail_items','meta','readiness_epoch_queue','readiness_epoch_shards']]
 role={'name':'proof_indexer_readiness_owner','login':False,'superuser':False,'createRole':False,'createDb':False,'replication':False,'bypassRls':False,'inherit':True,'connectionLimit':-1,'noExpiry':True,'noConfiguration':True,'schemaUsage':True,'memberships':0}
 return {'closure':{'schema':'pow-audit30-readiness-public-closure-v2','functions':fs,'triggers':ts,'relations':rs,'ownerRole':role},'closureSha256':'c'*64,'snapshot':'2:2:','identity':{'database':'proof_indexer','user':'postgres','transactionReadOnly':'on','searchPath':'pg_catalog, pg_temp','serverVersion':'160015','maxPreparedTransactions':'0'},'dataSummary':{'queueRows':0,'shardRows':64,'livenetShardRows':64,'validLivenetShards':64}}
class Tests(unittest.TestCase):
 def test_canonical_exact_bytes(self):
  a,b=M.canonical_parts(SRC.read_bytes());self.assertEqual(M.sha(a),M.ASSERTION_SHA);self.assertEqual(len(b),3)
 def test_ddl_not_in_assertion(self):
  a,_=M.canonical_parts(SRC.read_bytes());text=re.sub(r"'(?:''|[^'])*'",'',a.decode());self.assertIsNone(re.search(r'\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|EXECUTE|CALL)\b',text,re.I))
 def test_migration_tamper(self):
  with self.assertRaises(ValueError):M.canonical_parts(SRC.read_bytes().replace(b'RETURN NULL;',b'RETURN NEW;',1))
 def test_shared_query_exact(self):
  self.assertEqual(M.CLOSURE_SQL,pathlib.Path('/tmp/pow-audit30-readiness-closure-query-v2.sql').read_text());self.assertEqual(M.sha(M.CLOSURE_SQL.encode()),M.CLOSURE_SQL_SHA);self.assertIn(' AS value FROM closure;',M.CLOSURE_SQL)
 def test_emit_readonly(self):
  sql=M.build_sql();self.assertTrue(sql.startswith('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;'));self.assertTrue(sql.endswith('ROLLBACK;\n'));self.assertNotIn('CREATE TABLE',sql);self.assertIn("'canonicalAssertionAccepted',true",sql)
 def test_pass(self):self.assertTrue(M.validate_observation(fixture())['exactImmutableMarkerProsrc'])
 def refuse(self,cb):
  d=fixture();cb(d)
  with self.assertRaises(ValueError):M.validate_observation(d)
 def test_source_hash_drift(self):self.refuse(lambda d:d['closure']['functions'][0].update(sourceSha256='d'*64))
 def test_source_byte_comparison_false(self):self.refuse(lambda d:d['closure']['functions'][0].update(canonicalSourceEquality=False))
 def test_unknown_function(self):self.refuse(lambda d:d['closure']['functions'].append(copy.deepcopy(d['closure']['functions'][0])))
 def test_grantable_acl(self):self.refuse(lambda d:d['closure']['functions'][0]['acl'][0].update(grantable=True))
 def test_owner_configuration(self):self.refuse(lambda d:d['closure']['ownerRole'].update(noConfiguration=False))
 def test_owner_membership(self):self.refuse(lambda d:d['closure']['ownerRole'].update(memberships=1))
 def test_unknown_trigger(self):self.refuse(lambda d:d['closure']['triggers'].append(dict(d['closure']['triggers'][0],name='other_trigger')))
 def test_disabled_trigger(self):self.refuse(lambda d:d['closure']['triggers'][0].update(enabled='O'))
 def test_trigger_other_schema(self):self.refuse(lambda d:d['closure']['triggers'][0].update(functionSchema='other'))
 def test_non_deferred_queue(self):self.refuse(lambda d:next(t for t in d['closure']['triggers']if t['relation']=='readiness_epoch_queue').update(initiallyDeferred=False))
 def test_trigger_condition(self):self.refuse(lambda d:d['closure']['triggers'][0].update(noCondition=False))
 def test_relation_rls(self):self.refuse(lambda d:d['closure']['relations'][0].update(rls=True))
 def test_nonempty_queue(self):self.refuse(lambda d:d['dataSummary'].update(queueRows=1))
 def test_not_readonly(self):self.refuse(lambda d:d['identity'].update(transactionReadOnly='off'))
 def test_source_metadata_read(self):
  with tempfile.TemporaryDirectory()as t:
   p=pathlib.Path(t)/'source.sql';p.write_bytes(SRC.read_bytes());p.chmod(0o600);self.assertEqual(M.source_proof(p)['sha256'],M.CANONICAL_SHA)
 def test_source_symlink(self):
  with tempfile.TemporaryDirectory()as t:
   p=pathlib.Path(t)/'source.sql';p.symlink_to(SRC)
   with self.assertRaises(ValueError):M.source_proof(p)
 def test_source_writable(self):
  with tempfile.TemporaryDirectory()as t:
   p=pathlib.Path(t)/'source.sql';p.write_bytes(SRC.read_bytes());p.chmod(0o664)
   with self.assertRaises(ValueError):M.source_proof(p)
 def test_remote_code_compile(self):
  code=M.emit_remote('20261003T020000Z');compile(code,'remote','exec');self.assertIn('User=postgres',code);self.assertNotIn("'sudo'",code);self.assertNotIn('catalog-private.json',code)
 def test_bad_calendar(self):
  with self.assertRaises(ValueError):M.emit_remote('20260230T020000Z')
 def test_output_contains_hashes_not_source(self):
  q=M.CLOSURE_SQL;self.assertNotIn(' AS prosrc',q);self.assertNotIn(' AS function_definition',q);self.assertNotIn(' AS trigger_definition',q);self.assertIn('canonicalSourceEquality',q)
class MarkerTests(unittest.TestCase):
 refuse=Tests.refuse
 def test_marker_source_owner_security_acl(self):
  for change in [{'sourceSha256':'e'*64},{'securityDefiner':True},{'config':['search_path=pg_catalog, pg_temp']},{'owner':'postgres'}]:
   with self.subTest(change=change):self.refuse(lambda d:next(f for f in d['closure']['functions']if f['name']=='reject_work_precision_v2_marker_mutation').update(change))
 def test_marker_trigger_type_enabled_definition(self):
  for change in [{'type':29},{'enabled':'A'},{'definitionSha256':'c'*64}]:
   with self.subTest(change=change):self.refuse(lambda d:next(t for t in d['closure']['triggers']if t['name']=='work_precision_v2_marker_immutable').update(change))
 def test_unknown_twenty_fourth_trigger_never_skipped(self):
  self.refuse(lambda d:d['closure']['triggers'].append(dict(d['closure']['triggers'][-1],name='unknown_marker')))
 def test_base_sql_source_exact_byte_parser(self):
  base=pathlib.Path('/home/sixer/ProofOfWork.Me/server/sql/proof-indexer-v1.sql')
  with tempfile.TemporaryDirectory()as t:
   p=pathlib.Path(t)/'base.sql';p.write_bytes(base.read_bytes());p.chmod(0o600);self.assertEqual(M.source_proof(p,True)['sha256'],M.BASE_SQL_SHA)
   p.write_bytes(base.read_bytes().replace(b'RETURN OLD;',b'RETURN NEW;',1))
   with self.assertRaises(ValueError):M.source_proof(p,True)
if __name__=='__main__':unittest.main()
