import ast,copy,hashlib,importlib.util,json,types,unittest
from pathlib import Path
S=Path('/tmp/pow-audit30-dual-pin-promotion-completed-read-v1.py');spec=importlib.util.spec_from_file_location('readonly_receiver',S);R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
PRODUCER=Path('/tmp/pow-audit30-coupled-pin-checker-promotion-v6.py');pb=PRODUCER.read_bytes();assert hashlib.sha256(pb).hexdigest()=='dfa403996e776a8ed192a024848b06f71b5fa041a24bf5b9687ff04ce3714535'
M=types.ModuleType('inert_producer');M.__file__='<frozen-v6>';exec(compile(pb,M.__file__,'exec'),M.__dict__)
plan=json.loads(Path('/tmp/pow-audit30-coupled-pin-checker-promotion-plan-144000-v6.json').read_bytes())
current={str(p):{'metadata':dict(plan['installed'][str(p)],bytes=size,mode=mode),'sha256':h}for p,(size,mode,h)in R.EXPECTED.items()}
new={str(R.PIN):{'bytes':R.NEW_PIN,'mode':0o644},str(R.CHECKER):{'bytes':b'fixture-only-code-not-native','mode':0o755}}
# Evaluate only the exact frozen producer completion expression. No apply_pair,
# replacement, file access, child or native function is executed.
f=next(n for n in ast.parse(pb).body if isinstance(n,ast.FunctionDef)and n.name=='apply_pair')
save=next(n for n in ast.walk(f)if isinstance(n,ast.Call)and isinstance(n.func,ast.Name)and n.func.id=='save'and isinstance(n.args[0],ast.Constant)and n.args[0].value=='completed')
G=dict(M.__dict__,completion_pins=R.PINS,new=new,meta=lambda p:current[str(p)]['metadata'],sha=lambda b:R.EXPECTED[R.PIN][2]if b==R.NEW_PIN else R.EXPECTED[R.CHECKER][2])
producer_value=eval(compile(ast.Expression(save.args[1]),'<frozen-public-completion-expression>','eval'),G)
class Cases(unittest.TestCase):
 def test_exact_frozen_producer_expression_matches_receiver(self):
  self.assertEqual(R.validate(R.canonical(producer_value),current),producer_value)
 def test_each_authenticated_pin_drift_refuses(self):
  for k in R.PINS:
   v=copy.deepcopy(producer_value);v[k]='0'*64
   with self.assertRaisesRegex(ValueError,'COMPLETION_PINS'):R.validate(R.canonical(v),current)
 def test_expanded_authority_or_joint_atomicity_refuses(self):
  for k in('deletionAuthorized','recoveryActivation','automaticDeletion','jointAtomicTransaction'):
   v=copy.deepcopy(producer_value);v[k]=True
   with self.assertRaisesRegex(ValueError,'SCOPE_AND_LIMITS'):R.validate(R.canonical(v),current)
 def test_duplicate_and_extra_public_fields_refuse(self):
  v=copy.deepcopy(producer_value);v['extra']='unreviewed'
  with self.assertRaisesRegex(ValueError,'COMPLETION_PINS'):R.validate(R.canonical(v),current)
  raw=R.canonical(producer_value)[:-1]+b',"status":"completed"}'
  with self.assertRaisesRegex(ValueError,'DUPLICATE'):R.validate(raw,current)
 def test_noncanonical_producer_bytes_refuse(self):
  with self.assertRaisesRegex(ValueError,'CANONICAL'):R.validate(R.canonical(producer_value)+b'\n',current)
 def test_current_installed_metadata_drift_refuses(self):
  changed=copy.deepcopy(current);changed[str(R.PIN)]['metadata']['inode']+=1
  with self.assertRaisesRegex(ValueError,'METADATA_MATCHES'):R.validate(R.canonical(producer_value),changed)
 def test_two_rows_order_and_old_checker_drift_refuse(self):
  v=copy.deepcopy(producer_value);v['installed'].reverse()
  with self.assertRaisesRegex(ValueError,'ORDERED_INSTALLED'):R.validate(R.canonical(v),current)
  v=copy.deepcopy(producer_value);v['oldCheckerSha256']='0'*64
  with self.assertRaisesRegex(ValueError,'TWO_REPLACEMENTS'):R.validate(R.canonical(v),current)
 def test_reader_has_fixed_read_scope_and_no_children_or_writes(self):
  tree=ast.parse(S.read_bytes());calls=[n for n in ast.walk(tree)if isinstance(n,ast.Call)]
  self.assertFalse(any(isinstance(n.func,ast.Attribute)and n.func.attr in('Popen','run','mkdir','write_bytes','write_text','unlink','replace')for n in calls))
  self.assertEqual(list(R.EXPECTED),[R.PIN,R.CHECKER]);self.assertEqual(len(R.NEW_PIN),78);self.assertEqual(R.sha(R.NEW_PIN),R.EXPECTED[R.PIN][2])
if __name__=='__main__':unittest.main()
