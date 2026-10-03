import base64,hashlib,json,re,sys
try:
 assert sys.flags.isolated and len(sys.argv)==2 and re.fullmatch('[0-9a-f]{64}',sys.argv[1])
 raw=sys.stdin.buffer.read(32769);assert len(raw)<=32768 and hashlib.sha256(raw).hexdigest()==sys.argv[1]
 r=json.loads(raw);assert set(r)=={'schema','rootSHA256','rootBase64','leafSHA256','leafBase64'} and r['schema']=='pow-audit30-focused-mail-readonly-request-v4'
 sources=[]
 for name,pin,cap in [('root','189e7e513d596be856b28f1adacf027ed32a77f4b51e3be4bc14f083fca4eba7',24576),('leaf','82d0c4ec91899a874bf72187e3ed49ce9f4fbc0b4a81e05c1297d99db8fbc223',8192)]:
  b=base64.b64decode(r[name+'Base64'],validate=True);assert len(b)<=cap and r[name+'SHA256']==pin==hashlib.sha256(b).hexdigest();sources.append(b)
 n={'__name__':'_focused_native','__file__':'focused-root-reviewed.py'};exec(compile(sources[0],n['__file__'],'exec'),n);code=n['main'](sources[1])
except BaseException as e:
 print(json.dumps({'schema':'pow-audit30-focused-mail-readonly-refused-v4','errorClass':type(e).__name__,'guardCode':str(e)if type(e).__name__=='Refused'and re.fullmatch('[A-Z][A-Z0-9_]{1,63}',str(e))else None,'privateContentsExported':False,'automaticRetry':False}),file=sys.stderr);code=1
raise SystemExit(code)
