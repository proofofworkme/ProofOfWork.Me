#!/usr/bin/env python3
"""Execute the actual cutover control flow against an in-memory systemd/filesystem."""
import ast,copy,datetime,io,pathlib,sys
source=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'deploy/audit17/publish-node.py').read_text(); tree=ast.parse(source)
start=next(i for i,n in enumerate(tree.body) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='phase' for t in n.targets))
flow=compile(ast.Module(body=tree.body[start:],type_ignores=[]),'actual-cutover-flow','exec')
stopped=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='stopped')
shadow_unit=next(n.value for n in ast.walk(tree) if isinstance(n,ast.Constant) and isinstance(n.value,str) and n.value.startswith('proofofwork-audit17-') and n.value.endswith('.service'))
apps=['api.socket','api.service','worker.service']; keep=['core']; timers=['maintenance.timer']
class FakePath:
    def __init__(self,*args):pass
    def iterdir(self):return []
    def open(self,*args):return io.BytesIO()
    def __truediv__(self,other):return self
for fault in ('none','shadow-present','database-session','draining-session','readiness','exchange-ambiguous'):
    if fault=='draining-session' and 'drain_attempt' not in source:continue
    states={u:{'LoadState':'loaded','ActiveState':'active',**({} if u.endswith('.socket') else {'MainPID':'1'})} for u in apps+keep+timers}
    baseline=copy.deepcopy(states); old=['old'];new=['new'];live=[False]; saved={}; calls=[]; db_reads=[0]
    class Paths:Path=FakePath
    def state(u):
        if u==shadow_unit and u not in states:
            return {'LoadState':'not-found','ActiveState':'inactive'}
        return states[u].copy()
    if fault=='shadow-present':states[shadow_unit]={'LoadState':'loaded','ActiveState':'active','MainPID':'7'}
    def run(args,*rest):
        calls.append(args)
        if args[0]=='systemctl':
            for u in args[2:]:
                # The actual flow uses fixed names for application start.
                aliases={'proofofwork-api.service':'api.service','proofofwork-indexer-worker.service':'worker.service','proofofwork-api-wg.socket':'api.socket','proofofwork-api-wg.service':'api.service'}
                u=aliases.get(u,u)
                states[u]['ActiveState']='active' if args[1]=='start' else 'inactive'
                if 'MainPID' in states[u]:states[u]['MainPID']='1' if args[1]=='start' else '0'
            return ''
        if args[0]=='sudo':
            db_reads[0]+=1
            return '1' if fault=='database-session' or (fault=='draining-session' and db_reads[0]<3) else '0'
        if 'release-exchange' in args[0]:
            if fault=='exchange-ambiguous':raise RuntimeError('Ambiguous exchange')
            live[0]=not live[0];return 'status=exchanged'
        return ''
    def attest(path):return (new if live[0] else old) if path=='live' else (old if live[0] else new)
    def ready():
        if fault=='readiness' and live[0]:raise RuntimeError('Not ready')
        return {'ready':True}
    ns={'TIMERS':timers,'APPS':apps,'KEEP':keep,'selected':timers,'baseline':baseline,'state':state,'run':run,'attest':attest,'ready':ready,'keep_unchanged':lambda x:None,'save':lambda name,data:saved.update({name:data}),'pathlib':Paths,'datetime':datetime,'old_att':old,'new_att':new,'LIVE':'live','STAGE':'stage','RELEASE':'fixture','COMMIT':'new','OUT':'evidence','print':lambda *args:None,'json':__import__('json'),'time':type('Clock',(),{'sleep':staticmethod(lambda n:None)})}
    exec(compile(ast.Module(body=[stopped],type_ignores=[]),'stopped','exec'),ns)
    try:exec(flow,ns)
    except (RuntimeError,AssertionError):assert fault not in ('none','shadow-present','draining-session')
    else:assert fault in ('none','shadow-present','draining-session')
    if fault=='exchange-ambiguous':
        assert all(states[u]['ActiveState']=='inactive' for u in apps+timers)
        assert len([c for c in calls if 'release-exchange' in c[0]])==1
    else:
        assert all(states[u]['ActiveState']=='active' for u in apps+timers)
        assert live[0]==(fault in ('none','shadow-present','draining-session'))
    assert 'before.json' not in saved # This harness starts at the controlled window.
    print('passed',fault)
