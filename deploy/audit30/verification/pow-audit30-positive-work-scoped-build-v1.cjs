// Local-only exact named function extraction; does not execute application code.
const fs = require('node:fs');
const ts = require('/home/sixer/ProofOfWork.Me/node_modules/typescript');
const {createHash} = require('node:crypto');
const root='/home/sixer/ProofOfWork.Me/';
const sha=x=>createHash('sha256').update(x).digest('hex');
const requests=[
 ['deploy/audit5/probe-candidate.mjs',['requireFact','canonicalJson','digest','decimalQ8']],
 ['deploy/audit29/verify-candidate.mjs',['sameTip','verifyWalletResponse','verifyFencedWalletRead','makeIO']],
 ['src/shared/api/surfaceReadState.ts',['listingDisplayProjectionFingerprint']],
 ['src/App.tsx',['fetchCompleteTokenListings']],
];
const bindings=[];const parts=[];
for(const [path,names]of requests){
 const text=fs.readFileSync(root+path,'utf8');
 const file=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,path.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 for(const name of names){
  const candidates=file.statements.filter(node=>(ts.isFunctionDeclaration(node)&&node.name?.text===name)||
   (ts.isVariableStatement(node)&&node.declarationList.declarations.length===1&&node.declarationList.declarations[0].name?.text===name));
  if(candidates.length!==1)throw Error('EXACT_NAMED_DECLARATION_REQUIRED:'+name);
  const node=candidates[0];const start=node.getStart(file);const end=node.end;const source=text.slice(start,end);
  bindings.push({path,name,start,end,sha256:sha(source)});
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,removeComments:false}}).outputText.replace(/^export /gm,'');
  if(/\bimport\s/u.test(code))throw Error('IMPORT_IN_EXTRACTED_FUNCTION');parts.push(code);
 }
}
const code=parts.join('\n');const frozen={bindings,code,codeSha256:sha(code)};
const path='/tmp/pow-audit30-positive-work-scoped-leaf-v1.mjs';const template=fs.readFileSync(path,'utf8');
if(!template.includes('const FROZEN_HELPERS = null;'))throw Error('BUILD_REQUIRES_UNSEALED_TEMPLATE');
fs.writeFileSync(path,template.replace('const FROZEN_HELPERS = null;','const FROZEN_HELPERS = '+JSON.stringify(frozen)+';'));
console.log(JSON.stringify({path,bytes:fs.statSync(path).size,sha256:sha(fs.readFileSync(path)),bindings,codeSha256:sha(code)}));
