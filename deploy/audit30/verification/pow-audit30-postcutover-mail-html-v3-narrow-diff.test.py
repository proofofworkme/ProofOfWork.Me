import ast,hashlib,pathlib,types,unittest
from unittest.mock import patch
P=pathlib.Path('/tmp')
class Tests(unittest.TestCase):
 def test_exact_collector_reverse(self):
  s=(P/'pow-audit30-postcutover-mail-html-collector-v3.py').read_text().replace('computer.proofofwork.me','api.proofofwork.me').replace("\n               'SupplementaryGroups': '1000',",'').replace("\n    need(os.getgid() == os.getegid() == 0 and set(os.getgroups()) in ({1000}, {0, 1000}),\n         'EXACT_PUBLIC_SOURCE_READ_GROUP')",'')
  self.assertEqual(s,(P/'pow-audit30-postcutover-mail-html-collector-v1.py').read_text())
 def test_exact_native_reverse(self):
  s=(P/'pow-audit30-postcutover-mail-html-native-v3.py').read_text().replace('8c95837d43e994d906cc4bbebb8a443bede34802d5eaf5d93cd2f61f60ef86db','3bcc3e071222de97529cd54bf045885ffdac2f2f2f305cbb471561dedf7f4dff').replace("\n         'SupplementaryGroups': '1000',",'').replace("\n            'SupplementaryGroups': '1000',",'').replace("('LimitFSIZE', 'SupplementaryGroups')","('LimitFSIZE',)")
  self.assertEqual(s,(P/'pow-audit30-postcutover-mail-html-native-v1.py').read_text())
 def test_assembly_and_transport_only_paths_and_pins(self):
  for stem in ['assemble','transport']:
   s=(P/('pow-audit30-postcutover-mail-html-'+stem+'-v3.py')).read_text().replace('native-v3.py','native-v1.py').replace('collector-v3.py','collector-v1.py').replace('b0c4ca5c0cb94bef317b13ea57857a5edbac2b08095969a56489ca2c0209a844','63bef564fc34e390e1b4ca70c95079ebd8be684dbe07854a5f4dc1071b5ecdc8').replace('8c95837d43e994d906cc4bbebb8a443bede34802d5eaf5d93cd2f61f60ef86db','3bcc3e071222de97529cd54bf045885ffdac2f2f2f305cbb471561dedf7f4dff')
   self.assertEqual(s,(P/('pow-audit30-postcutover-mail-html-'+stem+'-v1.py')).read_text())
 def test_original_actual_permission_hash(self):
  self.assertEqual(hashlib.sha256(str(PermissionError(13,'Permission denied','/opt/proofofwork-api/src/App.tsx')).encode()).hexdigest(),'f0372f88966b61636febba45ee98c6851156bb251483375e2d5aca3434fce5d8')
 def test_zero_caps_and_exact_group_admission(self):
  s=(P/'pow-audit30-postcutover-mail-html-collector-v3.py').read_text();n={'__name__':'_fixture'};exec(compile(s,'fixture','exec'),n)
  rid='20261003T202200Z';cg='0::/system.slice/proofofwork-audit30-mail-api-html-after-'+rid+'.service'
  def show(unit,fields):
   t=ast.parse(s);fn=next(x for x in t.body if isinstance(x,ast.FunctionDef)and x.name=='runtime');expr=next(x.value for x in fn.body if isinstance(x,ast.Assign)and isinstance(x.targets[0],ast.Name)and x.targets[0].id=='desired');return eval(compile(ast.Expression(expr),'desired','eval'),n)
  with patch.object(n['Path'],'read_text',return_value=cg),patch.object(n['os'],'getgid',return_value=0),patch.object(n['os'],'getegid',return_value=0),patch.dict(n,{'show':show}):
   for groups in [[1000],[0,1000]]:
    with patch.object(n['os'],'getgroups',return_value=groups):r=n['runtime']({'stage':'after','runId':rid});self.assertEqual(show('',())['SupplementaryGroups'],'1000');self.assertEqual(show('',())['CapabilityBoundingSet'],'');self.assertEqual(show('',())['AmbientCapabilities'],'')
   for groups in [[],[0],[1000,1001],[0,1000,1]]:
    with patch.object(n['os'],'getgroups',return_value=groups):self.assertRaisesRegex(n['Refused'],'EXACT_PUBLIC_SOURCE_READ_GROUP',n['runtime'],{'stage':'after','runId':rid})
if __name__=='__main__':unittest.main()
