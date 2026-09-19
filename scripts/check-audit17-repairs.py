#!/usr/bin/env python3
"""Boundary tests for the actual repair controllers' exact-unit/txid helpers."""
import ast,decimal,hashlib,pathlib,re

def helpers(path,names,namespace):
 tree=ast.parse(pathlib.Path(path).read_text())
 funcs=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names]
 assert len(funcs)==len(names)
 exec(compile(ast.Module(body=funcs,type_ignores=[]),path,'exec'),namespace)
 return namespace
raw=helpers('deploy/audit17/repair-aux-raw.py',{'sats','raw_txid','literal'},{'decimal':decimal,'hashlib':hashlib})
# One input, one output, followed by a witness vector. Its non-witness bytes
# are constructed separately so the expected ID does not reuse the parser.
version=bytes.fromhex('02000000');locktime=bytes.fromhex('00000000')
body=bytes.fromhex('01'+'11'*32+'00000000'+'00'+'ffffffff'+'01'+'2202000000000000'+'01'+'51')
legacy=version+body+locktime
witness=version+b'\x00\x01'+body+bytes.fromhex('0201aa02bbbb')+locktime
expected=hashlib.sha256(hashlib.sha256(legacy).digest()).digest()[::-1].hex()
assert raw['raw_txid'](legacy.hex())==expected==raw['raw_txid'](witness.hex())
for malformed in [legacy[:-1],legacy+b'\x00',witness[:-1],b'']:
 try:raw['raw_txid'](malformed.hex())
 except (AssertionError,IndexError,KeyError):pass
 else:raise AssertionError('malformed transaction accepted')
for value,expected in [('0',0),('0.00000001',1),('0.00000546',546),('21000000',2100000000000000)]:assert raw['sats'](value)==expected
for value in ['-1','0.000000001','21000000.00000001','NaN','Infinity']:
 try:raw['sats'](value)
 except (AssertionError,decimal.InvalidOperation):pass
 else:raise AssertionError('out-of-range monetary value accepted')
alias=helpers('deploy/audit17/repair-incb-aliases.py',{'integer','text'},{'re':re})
for n in [0,1,99999999,100000000,293987255080509083181,10**80+1]:
 value=alias['text'](n); whole,_,fraction=value.partition('.')
 assert int(whole)*100000000+int(fraction.ljust(8,'0') or '0')==n
 assert alias['integer'](str(n))==n
for bad in ['1e8','01','-1','1.5',1.5,True,None]:
 try:alias['integer'](bad)
 except AssertionError:pass
 else:raise AssertionError('noncanonical exact integer accepted')
for payload in ["'quoted'",'$repair$',"a\\b\n\"c"]:
 quoted=raw['literal'](payload);assert payload in quoted and quoted.count(quoted.split('$')[1])==2
print('Audit 17 repair boundary tests passed: txids, malformed lengths, exact units, large aliases and SQL literals')
