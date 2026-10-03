// Proposed final-human-approval binding only. No DB connection or production run.
// Preserve reviewed2e9 template; root custody must attest raw future approval bytes.
import crypto from 'node:crypto';
export const TEMPLATE_SHA256='2e9a7fb67616e46b3b14d1074dc5206eb280df6868cc249943645b8d8ab685da';
export const PLAN_SHA256='4ac3a8d9b4b79befd36abc590731b1bc8f2e6c83919d5f6427c34c58a6ddba00';
export const MANIFEST_SHA256='8d5d347aea2d398d75e69631f90b3efdd1c3254cfdbf3864015199b078699c50';
export const WORKER_GUARD_SHA256='48001283affb80b3b027dcc93831074aee872fbee649fb14482c32b00eb1c76c';
const HEX=/^[0-9a-f]{64}$/u,need=(v,c)=>{if(!v)throw Error(c);};
export const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const quote=s=>JSON.stringify(s).replace(/[\u0080-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
export function encoded(v){if(Array.isArray(v))return`[${v.map(encoded).join(',')}]`;if(v&&typeof v==='object')return`{${Object.keys(v).sort().map(k=>`${quote(k)}:${encoded(v[k])}`).join(',')}}`;return typeof v==='string'?quote(v):JSON.stringify(v);}
const eq=(a,b)=>encoded(a)===encoded(b);
export function validateApproval(raw,receiptSHA256,plan,{adapterSHA256,operation,priorAcknowledgedApplyReceiptSHA256=null}){
 need(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=32768&&HEX.test(receiptSHA256)&&hash(raw)===receiptSHA256,'HUMAN_APPROVAL_RAW_BYTES_PIN');let a;try{a=JSON.parse(raw.toString('utf8'));}catch{throw Error('HUMAN_APPROVAL_JSON');}
 need(encoded(a)===raw.toString('utf8'),'HUMAN_APPROVAL_CANONICAL_BYTES');
 const fields=['schema','status','authority','humanApprovalEvidenceSHA256','authorizedOperations','conditionalInverseRequiresAcknowledgedApply','inverseRequiresSeparateInvocation','network','originalPlanSHA256','manifestSHA256','targetCount','orderedTargetTxids','writerTemplateSHA256','productionAdapterSHA256','workerPreservationGuardSHA256','privateCommitInverseProofReceiptSHA256','freshMailProjectionReceiptSHA256','readinessClosureSHA256','expectedDatabaseIdentity','productionDataChangeApproved','onlyMailItemsBodyText','canonicalReadinessInvalidationApproved','operationalEpochRewindAllowed','automaticRetryAllowed'];
 need(a?.schema==='pow-audit30-exact-sixteen-production-approval-v1'&&eq(Object.keys(a).sort(),fields.sort())&&a.status==='approved'&&a.authority==='human'&&HEX.test(a.humanApprovalEvidenceSHA256),'EXPLICIT_HUMAN_APPROVAL_REQUIRED');
 need(['apply','inverse'].includes(operation)&&eq(a.authorizedOperations,['apply','inverse'])&&a.conditionalInverseRequiresAcknowledgedApply===true&&a.inverseRequiresSeparateInvocation===true&&a.network==='livenet'&&a.originalPlanSHA256===PLAN_SHA256&&a.manifestSHA256===MANIFEST_SHA256&&plan.manifestSHA256===MANIFEST_SHA256&&a.targetCount===16&&plan.targets.length===16&&eq(a.orderedTargetTxids,plan.targets.map(t=>t.txid))&&a.orderedTargetTxids.every((t,i)=>HEX.test(t)&&(!i||t>a.orderedTargetTxids[i-1])),'APPROVAL_EXACT_SIXTEEN_SCOPE');
 need(a.writerTemplateSHA256===TEMPLATE_SHA256&&HEX.test(adapterSHA256)&&a.productionAdapterSHA256===adapterSHA256&&a.workerPreservationGuardSHA256===WORKER_GUARD_SHA256&&[a.privateCommitInverseProofReceiptSHA256,a.freshMailProjectionReceiptSHA256,a.readinessClosureSHA256].every(h=>HEX.test(h)),'APPROVAL_REVIEWED_SOURCE_AND_PROOF_BINDINGS');
 need(a.productionDataChangeApproved===true&&a.onlyMailItemsBodyText===true&&a.canonicalReadinessInvalidationApproved===true&&a.operationalEpochRewindAllowed===false&&a.automaticRetryAllowed===false,'APPROVAL_DATA_OPERATION_BOUNDARIES');
 const id=a.expectedDatabaseIdentity;need(id&&eq(Object.keys(id).sort(),['dataDirectory','socket','listenAddresses','port','readOnly','checksums','user','database','serverAddress'].sort())&&typeof id.dataDirectory==='string'&&id.dataDirectory.startsWith('/')&&!id.dataDirectory.split('/').some(p=>p==='..'||p==='.')&&!id.dataDirectory.includes('audit30')&&id.socket==='/var/run/postgresql'&&id.port==='5432'&&id.user==='postgres'&&id.database==='proof_indexer'&&id.serverAddress===null&&['off','on'].includes(id.readOnly)&&['off','on'].includes(id.checksums)&&typeof id.listenAddresses==='string','APPROVAL_PRODUCTION_DATABASE_IDENTITY');
 need(operation==='apply'?priorAcknowledgedApplyReceiptSHA256===null:HEX.test(priorAcknowledgedApplyReceiptSHA256),'INVERSE_EXPLICIT_INVOCATION_AND_ACKNOWLEDGED_APPLY');return a;
}
export function bindApprovedTemplate(template,approvalBytes,approvalSHA256,plan,options){
 need(Buffer.isBuffer(template)&&hash(template)===TEMPLATE_SHA256,'REVIEWED_WRITER_TEMPLATE_BYTES_PIN');const approval=validateApproval(approvalBytes,approvalSHA256,plan,options),from='export const LIVE_APPROVAL_PIN=null;',to=`export const LIVE_APPROVAL_PIN='${approvalSHA256}';`,text=template.toString('utf8');need(text.split(from).length===2,'EXACT_SINGLE_APPROVAL_BINDING');const generated=Buffer.from(text.replace(from,to));need(generated.toString('utf8').replace(to,from)===text,'APPROVAL_BINDING_REVERSIBLE');return{approval,generated,generatedSHA256:hash(generated),templateSHA256:TEMPLATE_SHA256,approvalReceiptSHA256:approvalSHA256,onlyConstantReplacement:true};
}
