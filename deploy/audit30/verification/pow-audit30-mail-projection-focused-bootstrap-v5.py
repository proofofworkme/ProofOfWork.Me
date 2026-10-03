import base64,hashlib,json,re,sys,zlib
try:
 assert sys.flags.isolated and len(sys.argv)==2 and re.fullmatch('[0-9a-f]{64}',sys.argv[1])
 raw=sys.stdin.buffer.read(32769);assert len(raw)<=32768 and hashlib.sha256(raw).hexdigest()==sys.argv[1]
 r=json.loads(raw);assert set(r)=={'schema','rootSHA256','rootBase64','leafSHA256','leafBase64','encoding'} and r['schema']=='pow-audit30-focused-mail-readonly-request-v5'and r['encoding']=='zlib-base64-v1'
 sources=[]
 for name,pin,cap in [('root','428722c174d433948bc4fb9202f38ce930a37b1abcfcc9b6b7e4fc126b16eb74',24576),('leaf','ac37be8c62908ca09e965fa04f219247652f1b52377c51951e14dbcd786a6708',8192)]:
  packed=base64.b64decode(r[name+'Base64'],validate=True);d=zlib.decompressobj();b=d.decompress(packed,cap+1);assert d.eof and not d.unconsumed_tail and not d.unused_data and len(b)<=cap and r[name+'SHA256']==pin==hashlib.sha256(b).hexdigest();sources.append(b)
 n={'__name__':'_focused_native','__file__':'focused-root-reviewed.py'};exec(compile(sources[0],n['__file__'],'exec'),n);code=n['main'](sources[1])
except BaseException as e:
 print(json.dumps({'schema':'pow-audit30-focused-mail-readonly-refused-v4','errorClass':type(e).__name__,'guardCode':str(e)if type(e).__name__=='Refused'and re.fullmatch('[A-Z][A-Z0-9_]{1,63}',str(e))else None,'privateContentsExported':False,'automaticRetry':False}),file=sys.stderr);code=1
raise SystemExit(code)
