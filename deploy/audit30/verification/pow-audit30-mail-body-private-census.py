#!/usr/bin/python3 -I
"""Frozen read-only census plus private exact SQL-line custody; no DB mutations."""
import argparse,base64,contextlib,hashlib,importlib.util,io,json,os,pathlib,re,stat,sys,types,subprocess,signal
FROZEN_SHA='818aaf4207ac5f5c627211eec21ed3991f6fd3a8400cce909c64c6be053ce61c'
MAX_PRIVATE=360*1024**2
MAX_PUBLIC=40*1024**2
def need(ok,code):
    if not ok:raise ValueError(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(o):return json.dumps(o,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()
def identity(s):return (s.st_dev,s.st_ino,s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))
def canonical_ancestors(path):
    p=pathlib.Path(path)
    need(p.is_absolute() and str(p)==path and '..' not in p.parts,'PRIVATE_PATH_NOT_CANONICAL')
    for parent in p.parents:need(stat.S_ISDIR(os.lstat(parent).st_mode),'PRIVATE_PATH_SYMLINK')
class Capture:
    def __init__(self,path,header,enforce_owner=True):
        canonical_ancestors(path);parent=os.lstat(str(pathlib.Path(path).parent))
        need(stat.S_ISDIR(parent.st_mode) and stat.S_IMODE(parent.st_mode)==0o700,'PRIVATE_PARENT_MODE')
        if enforce_owner:need(parent.st_uid==parent.st_gid==0,'PRIVATE_PARENT_OWNER')
        self.path=path;self.parent=parent;self.fd=None;self.hash=hashlib.sha256();self.bytes=0;self.records=0;self.closed=False
        self.fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        try:
            os.fchmod(self.fd,0o600);self.created=os.fstat(self.fd)
            if enforce_owner:need(self.created.st_uid==self.created.st_gid==0,'PRIVATE_FILE_OWNER')
            self.sync_parent();self.write(dict(phase='private-capture-header',schema='pow-audit30-mail-private-sql-lines-v1',**header))
        except BaseException:
            os.close(self.fd);self.fd=None;raise
    def sync_parent(self):
        parent_path=str(pathlib.Path(self.path).parent)
        fd=os.open(parent_path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:
            need(identity(os.fstat(fd))==identity(self.parent)==identity(os.lstat(parent_path)),'PRIVATE_PARENT_IDENTITY')
            os.fsync(fd);need(identity(os.fstat(fd))==identity(os.lstat(parent_path)),'PRIVATE_PARENT_IDENTITY')
        finally:os.close(fd)
    def write(self,o):
        b=encoded(o)+b'\n';need(self.bytes+len(b)<=MAX_PRIVATE,'PRIVATE_CAPTURE_BYTE_BOUND');pos=0
        while pos<len(b):pos+=os.write(self.fd,b[pos:])
        self.hash.update(b);self.bytes+=len(b)
    def append_raw(self,line):
        need(isinstance(line,bytes) and len(line)<=8*1024**2,'PRIVATE_SQL_LINE_BOUND')
        row=json.loads(line);need(row.get('phase') in ('snapshot','row'),'PRIVATE_SQL_PHASE')
        self.write(dict(phase='private-sql-line',recordBase64=base64.b64encode(line).decode(),recordSHA256=sha(line)))
        self.records+=1
    def finish(self,result,complete):
        need(not self.closed,'PRIVATE_CAPTURE_ALREADY_CLOSED')
        public=encoded(result);need(len(public)<=MAX_PUBLIC,'PUBLIC_RECEIPT_BOUND')
        self.write(dict(phase='private-capture-footer',status='complete' if complete else 'failed',records=self.records,publicCensusBase64=base64.b64encode(public).decode(),publicCensusSHA256=sha(public)))
        os.fsync(self.fd);after=os.fstat(self.fd);named=os.lstat(self.path)
        need(identity(after)==identity(self.created)==identity(named) and after.st_nlink==named.st_nlink==1 and after.st_size==named.st_size==self.bytes,'PRIVATE_FILE_IDENTITY')
        self.sync_parent();os.close(self.fd);self.fd=None;self.closed=True
        return dict(path=self.path,bytes=self.bytes,sha256=self.hash.hexdigest(),complete=complete,records=self.records,mode='0600',private=True)
    def close(self):
        if self.fd is not None:
            try:os.fsync(self.fd)
            finally:os.close(self.fd);self.fd=None
def load_frozen(path,enforce_owner=True):
    canonical_ancestors(path);s=os.lstat(path)
    need(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and not stat.S_IMODE(s.st_mode)&0o7022,'FROZEN_SOURCE_MODE')
    if enforce_owner:need(s.st_uid==s.st_gid==0,'FROZEN_SOURCE_OWNER')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        need(s.st_size<=1024**2,'FROZEN_SOURCE_BOUND');b=os.read(fd,s.st_size+1);need(len(b)==s.st_size and identity(os.fstat(fd))==identity(s)==identity(os.lstat(path)) and sha(b)==FROZEN_SHA,'FROZEN_SOURCE_HASH')
    finally:os.close(fd)
    m=types.ModuleType('audit30_frozen_mail_census');m.__file__=path
    exec(compile(b,path,'exec'),m.__dict__)
    need(sha(pathlib.Path(path).read_bytes())==FROZEN_SHA and identity(os.lstat(path))==identity(s),'FROZEN_SOURCE_CHANGED_IMPORT')
    return m,b.decode()
def instrument(module,source,capture):
    import ast
    tree=ast.parse(source);nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='sql_stream'];need(len(nodes)==1,'FROZEN_STREAM_AMBIGUOUS')
    node=nodes[0];body='\n'.join(source.splitlines()[node.lineno-1:node.end_lineno])+'\n'
    old='if line.strip():yield json.loads(line)';need(body.count(old)==1,'FROZEN_STREAM_SHAPE')
    body=body.replace(old,'if line.strip():\n                        _audit30_private_capture.append_raw(line)\n                        yield json.loads(line)')
    module._audit30_private_capture=capture
    # Session-only stable timestamp rendering, retaining the exact existing SQL.
    module.SQL=module.SQL.replace("SET LOCAL statement_timeout='60s';", "SET LOCAL timezone='UTC'; SET LOCAL statement_timeout='60s';",1)
    exec(compile(body,'<hash-bound-private-census-stream>','exec'),module.__dict__)
    return sha(module.SQL.encode())
def instrument_core(module,source):
    # The original collector stays immutable. Only CLI getblockhash framing
    # changes; all RPC process/deadline/count/canonical gates are retained.
    import ast
    tree=ast.parse(source);classes=[n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Core'];need(len(classes)==1,'FROZEN_CORE_CLASS')
    methods=[n for n in classes[0].body if isinstance(n,ast.FunctionDef) and n.name=='rpc'];need(len(methods)==1,'FROZEN_CORE_RPC')
    import textwrap
    node=methods[0];body=textwrap.dedent('\n'.join(source.splitlines()[node.lineno-1:node.end_lineno])+'\n')
    old='self.calls+=1;return json.loads(out)';need(body.count(old)==1,'FROZEN_CORE_PARSER_SHAPE')
    body=body.replace(old,"self.calls+=1\n    if method=='getblockhash':\n        text=bytes(out).decode('ascii').strip()\n        if re.fullmatch('[0-9a-f]{64}',text):return text\n        value=json.loads(out)\n        if not isinstance(value,str) or not re.fullmatch('[0-9a-f]{64}',value):raise ValueError('CORE_BLOCK_HASH_FRAMING')\n        return value\n    return json.loads(out)")
    namespace=dict(module.__dict__);exec(compile(body,'<hash-bound-core-getblockhash-framing>','exec'),namespace);module.Core.rpc=namespace['rpc']
    return sha(body.encode())

SQL_ENV={'PATH':'/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','LC_ALL':'C','LANG':'C','TZ':'UTC','PGHOST':'/run/postgresql','PGPORT':'5432','PGCONNECT_TIMEOUT':'5','PGAPPNAME':'audit30-mail-census-readonly','PGOPTIONS':'-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=30000'}
class SqlControl:
    def __init__(self,private_path):
        p=pathlib.Path(private_path);match=re.fullmatch(r'audit30-mail-body-census-([0-9]{8}T[0-9]{6}Z)',p.parent.name)
        need(p.name=='preimages.jsonl' and p.parent.parent==pathlib.Path('/data/proofofwork-release-backups') and match is not None,'SQL_UNIT_PRIVATE_PATH')
        self.run_id=match[1];self.unit='proofofwork-audit30-mail-sql-'+self.run_id+'.service';self.parent='proofofwork-audit30-mail-census-'+self.run_id+'.service';self.intent=p.parent/'native-sql-launch-intent.json';self.invocation=None;self.parent_invocation=None
    def props(self,unit,fields):
        need(unit in (self.unit,self.parent),'SQL_UNIT_SCOPE')
        r=subprocess.run(['/usr/bin/systemctl','show',unit,*['--property='+k for k in fields]],capture_output=True,env=SQL_ENV,timeout=10)
        need(r.returncode==0 and not r.stderr and len(r.stdout)<=16384,'SQL_UNIT_PROPERTIES')
        lines=r.stdout.decode('ascii').splitlines();need(all('=' in x for x in lines),'SQL_UNIT_PROPERTY_FRAME');v=dict(x.split('=',1) for x in lines);need(set(v)==set(fields),'SQL_UNIT_PROPERTY_KEYS');return v
    def argv(self):
        props=['UnsetEnvironment=LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_DEBUG LD_PROFILE LD_ORIGIN_PATH LD_ASSUME_KERNEL GLIBC_TUNABLES GCONV_PATH LOCPATH PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE PGUSER PGDATABASE PGOPTIONS PGHOST PGHOSTADDR PGPORT PYTHONPATH PYTHONHOME BASH_ENV ENV','User=postgres','Group=postgres','UMask=0077','RuntimeMaxSec=75s','TimeoutStopSec=5s','MemoryMax=1G','MemorySwapMax=0','CPUQuota=50%','TasksMax=32','KillMode=control-group','ProtectSystem=strict','ProtectHome=yes','PrivateTmp=yes','PrivateDevices=yes','PrivateIPC=yes','PrivateNetwork=yes','RestrictAddressFamilies=AF_UNIX','NoNewPrivileges=yes','CapabilityBoundingSet=','AmbientCapabilities=','BindsTo='+self.parent,'Requisite='+self.parent,'After='+self.parent]
        return ['/usr/bin/systemd-run','--quiet','--wait','--pipe','--unit='+self.unit,'--service-type=exec',*['--property='+x for x in props],*['--setenv='+k+'='+v for k,v in SQL_ENV.items()],'/usr/bin/env','-i',*[k+'='+v for k,v in SQL_ENV.items()],'/usr/lib/postgresql/16/bin/psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-d','proof_indexer']
    def parent_check(self):
        v=self.props(self.parent,['LoadState','ActiveState','MainPID','InvocationID','ControlGroup'])
        need(v['LoadState']=='loaded' and v['ActiveState']=='active' and re.fullmatch(r'[1-9][0-9]*',v['MainPID']) is not None and re.fullmatch(r'[0-9a-f]{32}',v['InvocationID']) is not None and v['ControlGroup']=='/system.slice/'+self.parent,'SQL_PARENT_IDENTITY')
        need(any(x.split(':',2)[-1]==v['ControlGroup'] for x in pathlib.Path('/proc/self/cgroup').read_text().splitlines()),'SQL_PARENT_CGROUP')
        if self.parent_invocation is not None:need(v['InvocationID']==self.parent_invocation,'SQL_PARENT_CHANGED')
        self.parent_invocation=v['InvocationID'];return v
    def prepare(self):
        parent=self.parent_check();v=self.props(self.unit,['LoadState','MainPID']);need(v==dict(LoadState='not-found',MainPID='0'),'SQL_UNIT_ALREADY_EXISTS')
        raw=encoded(dict(schema='pow-audit30-native-mail-sql-intent-v1',unit=self.unit,parent=self.parent,parentInvocationID=self.parent_invocation,argvSHA256=sha(encoded(self.argv())),wrapperSHA256=sha(pathlib.Path(__file__).read_bytes())))
        fd=os.open(self.intent,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        try:
            os.fchmod(fd,0o600);pos=0
            while pos<len(raw):pos+=os.write(fd,raw[pos:])
            os.fsync(fd)
        finally:os.close(fd)
        fd=os.open(self.intent.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:os.fsync(fd)
        finally:os.close(fd)
        return parent
    def owned_state(self):
        fields=['LoadState','ActiveState','MainPID','InvocationID','User','Group','BindsTo','Requisite']
        v=self.props(self.unit,fields)
        if v['LoadState']=='not-found':need(v['MainPID']=='0','SQL_ABSENT_PID');return v
        need(v['LoadState']=='loaded' and v['User']=='postgres' and v['Group']=='postgres' and v['BindsTo']==self.parent and v['Requisite']==self.parent and re.fullmatch(r'[0-9a-f]{32}',v['InvocationID']) is not None,'SQL_CHILD_IDENTITY')
        if self.invocation is not None:need(v['InvocationID']==self.invocation,'SQL_CHILD_CHANGED')
        self.invocation=v['InvocationID'];return v
    def observe(self):
        if self.invocation is None:self.parent_check();self.owned_state()
    def stop(self):
        self.parent_check();v=self.owned_state()
        if v['LoadState']!='not-found' and (v['MainPID']!='0' or v['ActiveState'] not in ('inactive','failed')):
            r=subprocess.run(['/usr/bin/systemctl','stop',self.unit],capture_output=True,env=SQL_ENV,timeout=10);need(r.returncode==0 and len(r.stdout)+len(r.stderr)<=16384,'SQL_STOP_FAILED')
        after=self.owned_state();need(after['MainPID']=='0' and after['ActiveState'] in ('inactive','failed'),'SQL_UNIT_NOT_STOPPED')
        return dict(unit=self.unit,parent=self.parent,parentInvocationID=self.parent_invocation,childInvocationID=self.invocation,stopped=True,readonly=True,environmentSHA256=sha(encoded(SQL_ENV)))

def custody_stamp(x):return (x.st_dev,x.st_ino,x.st_mode,x.st_uid,x.st_gid,x.st_nlink,x.st_size,x.st_mtime_ns,x.st_ctime_ns)

def cleanup_native_sql(private_path):
    control=SqlControl(private_path)
    if not os.path.lexists(control.intent):
        control.parent_check();need(control.props(control.unit,['LoadState','MainPID'])==dict(LoadState='not-found',MainPID='0'),'SQL_UNIT_WITHOUT_OWNED_INTENT');return dict(unit=control.unit,stopped=True,notLaunched=True)
    s=control.intent.lstat();need(stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<=16384,'SQL_INTENT_CUSTODY')
    fd=os.open(control.intent,os.O_RDONLY|os.O_NOFOLLOW)
    try:raw=os.read(fd,16385);need(len(raw)==s.st_size and custody_stamp(os.fstat(fd))==custody_stamp(s)==custody_stamp(control.intent.lstat()),'SQL_INTENT_CHANGED')
    finally:os.close(fd)
    v=json.loads(raw);need(set(v)=={'schema','unit','parent','parentInvocationID','argvSHA256','wrapperSHA256'} and v['schema']=='pow-audit30-native-mail-sql-intent-v1' and v['unit']==control.unit and v['parent']==control.parent and v['argvSHA256']==sha(encoded(control.argv())) and v['wrapperSHA256']==sha(pathlib.Path(__file__).read_bytes()) and re.fullmatch(r'[0-9a-f]{32}',v['parentInvocationID']) is not None,'SQL_INTENT_BINDING')
    control.parent_invocation=v['parentInvocationID'];return control.stop()

def instrument_native_sql(module,source,capture,control):
    import ast
    tree=ast.parse(source);node=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='sql_stream');body='\n'.join(source.splitlines()[node.lineno-1:node.end_lineno])+'\n'
    original="['/usr/sbin/runuser','-u','postgres','--','/usr/bin/psql','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-d','proof_indexer']"
    need(body.count(original)==1,'FROZEN_SQL_ARGV_SHAPE');body=body.replace(original,'_audit30_sql_control.argv()');old='if line.strip():yield json.loads(line)';need(body.count(old)==1,'FROZEN_SQL_YIELD_SHAPE')
    body=body.replace(old,'if line.strip():\n                        _audit30_sql_control.observe()\n                        _audit30_private_capture.append_raw(line)\n                        yield json.loads(line)')
    module._audit30_private_capture=capture;module._audit30_sql_control=control;module.SQL=module.SQL.replace("SET LOCAL statement_timeout='60s';", "SET LOCAL timezone='UTC'; SET LOCAL statement_timeout='60s';",1)
    exec(compile(body,'<fixed-systemd-native-sql-stream>','exec'),module.__dict__)

def run(module,source,capture,core_argv,sql_control=None):
    if sql_control is None:instrument(module,source,capture)
    else:instrument_native_sql(module,source,capture,sql_control)
    instrument_core(module,source);out=io.StringIO();old_argv=sys.argv
    try:
        sys.argv=[module.__file__,*core_argv]
        with contextlib.redirect_stdout(out):code=module.main()
        raw=out.getvalue().strip().encode();need(len(raw)<=MAX_PUBLIC,'PUBLIC_RECEIPT_BOUND');result=json.loads(raw)
        complete=code==0 and result.get('ok') is True and result.get('coreVerified') is True
        result['privateCapture']=capture.finish(result,complete);result['captureWrapperModel']='pow-audit30-mail-private-census-wrapper-v1'
        return result,0 if complete else 1
    except Exception as e:
        code=str(e) if re.fullmatch('[A-Z_]+',str(e)) else 'DETAIL_REDACTED'
        result=dict(schema='pow-audit30-mail-private-census-failure-v1',ok=False,errorClass=type(e).__name__,code=code)
        if not capture.closed:
            try:result['privateCapture']=capture.finish(result,False)
            except Exception:result['privateCaptureIncomplete']=True
        return result,1
    finally:
        sys.argv=old_argv;capture.close()
        if sql_control is not None:sql_control.stop()
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--private-preimages',required=True);ap.add_argument('--census-source');ap.add_argument('--core-cli',required=True);ap.add_argument('--core-datadir',required=True);ap.add_argument('--core-conf');a=ap.parse_args()
    need(sys.flags.isolated and os.geteuid()==0,'ROOT_ISOLATED_REQUIRED')
    path=a.census_source or str(pathlib.Path(__file__).with_name('mail-body-census.py'))
    module,source=load_frozen(path);args=['--core-cli',a.core_cli,'--core-datadir',a.core_datadir]
    if a.core_conf:args+=['--core-conf',a.core_conf]
    header=dict(frozenCensusSHA256=FROZEN_SHA,wrapperSHA256=sha(pathlib.Path(__file__).read_bytes()),sqlSHA256=sha(module.SQL.replace("SET LOCAL statement_timeout='60s';", "SET LOCAL timezone='UTC'; SET LOCAL statement_timeout='60s';",1).encode()))
    control=SqlControl(a.private_preimages);control.prepare()
    def interrupted(*_):raise InterruptedError('SQL_PARENT_INTERRUPTED')
    previous={q:signal.signal(q,interrupted) for q in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP)}
    try:
        capture=Capture(a.private_preimages,header);result,code=run(module,source,capture,args,control);result['nativeSqlService']=control.stop();sys.stdout.buffer.write(encoded(result));return code
    finally:
        control.stop()
        for q,v in previous.items():signal.signal(q,v)
if __name__=='__main__':
    try:sys.exit(main())
    except Exception as e:
        sys.stdout.buffer.write(encoded(dict(schema='pow-audit30-mail-private-census-failure-v1',ok=False,errorClass=type(e).__name__,code=str(e) if re.fullmatch('[A-Z_]+',str(e)) else 'DETAIL_REDACTED')));sys.exit(1)
