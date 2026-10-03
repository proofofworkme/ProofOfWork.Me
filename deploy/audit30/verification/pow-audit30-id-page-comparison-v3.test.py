import copy,hashlib,importlib.util,pathlib,unittest
P=pathlib.Path
sp=importlib.util.spec_from_file_location('validator','/tmp/pow-audit30-id-page-comparison-verifier-v3.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
SQL=P('/tmp/pow-audit30-id-page-comparison-v3.sql').read_text()
OLD=P('/tmp/pow-audit30-final-id-fence-query-v1.sql').read_text().strip();NEW=P('/tmp/pow-audit30-id-transition-page-key-cte-v1.sql').read_text().strip()
def valid():
 out=[{'label':'scope','transactionReadOnly':True,'sameSnapshot':True,'maximumRowsPerPage':3,'snapshot':'1:2:'}]
 for label in m.LABELS:
  start=960601 if label.startswith('migration-')else 969000
  f=[{'height':start+i,'headerSHA256':'a'*64,'payloadSHA256':'b'*64,'payloadBytes':100+i}for i in range(3)]
  d={'label':label,**{k:True for k in m.BOOLS},'originalRows':3,'candidateRows':3,'originalUniqueKeys':3,'candidateUniqueKeys':3,'originalFingerprints':f,'candidateFingerprints':copy.deepcopy(f),'boundaryRows':int(label.startswith('migration-'))};out.append(d)
 for name in('original','candidate'):out.extend([{'label':f'activation-{name}-explain'},[{'Plan':{'Node Type':'Limit'},'Execution Time':1.0}]])
 return out
class Tests(unittest.TestCase):
 def test_valid_bounded_capture(self):self.assertTrue(m.validate_comparisons(valid())['boundedComparisonsPassed'])
 def test_each_false_predicate_refuses(self):
  for k in m.BOOLS:
   with self.subTest(k=k):v=valid();v[1][k]=False;self.assertRaises(ValueError,m.validate_comparisons,v)
 def test_duplicates_refuse(self):v=valid();v[1]['candidateUniqueKeys']=2;self.assertRaises(ValueError,m.validate_comparisons,v)
 def test_more_than_three_refuse(self):v=valid();v[1]['originalRows']=4;self.assertRaises(ValueError,m.validate_comparisons,v)
 def test_empty_row_scope_refuse(self):v=valid();v[1]['originalRows']=0;self.assertRaises(ValueError,m.validate_comparisons,v)
 def test_candidate_row_omission_refuses(self):v=valid();v[1]['candidateRows']=2;self.assertRaises(ValueError,m.validate_comparisons,v)
 def test_payload_hash_difference_refuse(self):v=valid();v[1]['candidateFingerprints'][1]['payloadSHA256']='c'*64;self.assertRaises(ValueError,m.validate_comparisons,v)
 def test_header_difference_refuse(self):v=valid();v[1]['candidateFingerprints'][1]['headerSHA256']='c'*64;self.assertRaises(ValueError,m.validate_comparisons,v)
 def test_ordered_fingerprint_gap_refuse(self):v=valid();v[1]['originalFingerprints'][1]['height']+=2;v[1]['candidateFingerprints']=copy.deepcopy(v[1]['originalFingerprints']);self.assertRaises(ValueError,m.validate_comparisons,v)
 def test_invalid_hash_refuse(self):v=valid();v[1]['originalFingerprints'][1]['payloadSHA256']='B'*64;v[1]['candidateFingerprints']=copy.deepcopy(v[1]['originalFingerprints']);self.assertRaises(ValueError,m.validate_comparisons,v)
 def test_missing_full_boundary_refuse(self):v=valid();v[3]['boundaryRows']=0;self.assertRaises(ValueError,m.validate_comparisons,v)
 def test_boolean_count_refuse(self):v=valid();v[1]['originalRows']=True;self.assertRaises(ValueError,m.validate_comparisons,v)
 def test_reordered_labels_refuse(self):v=valid();v[1],v[2]=v[2],v[1];self.assertRaises(ValueError,m.validate_comparisons,v)
 def test_partial_timeout_capture_refuse(self):self.assertRaises(ValueError,m.validate_comparisons,valid()[:4])
 def test_partial_explain_capture_refuse(self):self.assertRaises(ValueError,m.validate_comparisons,valid()[:10])
 def test_extra_row_payload_not_allowed(self):v=valid();v[1]['originalFingerprints'][0]['payload']='mail';self.assertRaises(ValueError,m.validate_comparisons,v)
 def test_source_exact_projection_and_case(self):
  self.assertEqual(SQL.count(OLD),2);self.assertEqual(SQL.count(NEW),2)
  self.assertNotIn('jsonb_build_object(\n                \'opening',SQL)
 def test_source_old_case_keeps_unknown_fields_six_only(self):self.assertEqual(SQL.count('ELSE transition.payload - ARRAY['),4);self.assertEqual(SQL.count('jsonb_path_exists('),4)
 def test_source_scope_limits_fences_and_readonly(self):
  self.assertIn('REPEATABLE READ READ ONLY',SQL);self.assertIn("statement_timeout='20s'",SQL);self.assertIn("lock_timeout='3s'",SQL);self.assertIn("temp_file_limit='32MB'",SQL);self.assertIn("work_mem='8MB'",SQL);self.assertEqual(SQL.count("EXECUTE audit30_id_page_compare('livenet'"),6);self.assertEqual(SQL.count('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)'),2);self.assertTrue(SQL.endswith('ROLLBACK;\n'))
 def test_source_payload_equality_not_just_hash(self):
  for token in('to_jsonb(ROW(o.network','o.payload IS NOT DISTINCT FROM c.payload','o.payload::text IS NOT DISTINCT FROM c.payload::text','sha256(convert_to','o.payload IS NOT DISTINCT FROM raw.payload','c.payload IS NOT DISTINCT FROM raw.payload','FULL JOIN (SELECT row_number()') :self.assertIn(token,SQL)
 def test_source_payload_not_returned(self):
  public=SQL[SQL.index("SELECT jsonb_build_object('label',$7"):SQL.index('FROM summary')]
  self.assertNotIn("'payload',",public);self.assertIn("'payloadJSONBEqual'",public);self.assertIn("'originalFingerprints'",public)
 def test_materialized_pair_retains_only_scalar_values(self):
  p=SQL.split('), paired AS MATERIALIZED (',1)[1].split(' FROM (SELECT row_number()',1)[0]
  self.assertNotRegex(p,r'AS payload_text(?:\s|,)');self.assertNotRegex(p,r'AS payload_jsonb(?:\s|,)')
  self.assertNotIn('o.*',p);self.assertNotIn('c.*',p)
  for token in('original_payload_sha256','candidate_payload_sha256','payload_jsonb_equal','payload_text_equal'):self.assertIn(token,p)
 def test_all_25_typed_header_fields_compared_without_large_payload_clone(self):
  from_fields=['network','block_height','block_hash','previous_block_hash','canonical_previous_block_hash','model','state_commitment_model','work_token_state_model','opening_network_value_q8','closing_network_value_q8','opening_state_sha256','closing_state_sha256','opening_state_payload_bytes','closing_state_payload_bytes','protocol_record_count','raw_protocol_candidate_count','transaction_count','event_count','event_set_model','event_set_sha256','event_set_payload_bytes','block_atomic','fee_once','invalid_zero','complete']
  self.assertEqual(len(from_fields),25)
  for alias in('o','c'):self.assertIn('to_jsonb(ROW('+','.join(alias+'.'+field for field in from_fields)+'))',SQL)
  self.assertNotIn("to_jsonb(o)-'payload'",SQL);self.assertNotIn("to_jsonb(c)-'payload'",SQL)
if __name__=='__main__':unittest.main()
