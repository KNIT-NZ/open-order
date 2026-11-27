// Replace only the active Standing Orders edition. No schema or query-log writes.
// A validated edition candidate is required. All database writes share one client/transaction.
import { Client } from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const out = {status:'INCOMPLETE', phase:'arguments'};
let client, transaction = false, committing = false, committed = false;
const q = async (sql, values = []) => (await client.query(sql, values)).rows;
const one = async (sql, values = []) => (await q(sql, values))[0];
const inventory = async (corpus) => {
  const documents = await q('SELECT to_jsonb(d) AS row FROM public.documents d WHERE corpus=$1 ORDER BY id',[corpus]);
  const sections = await q("SELECT to_jsonb(s)-'search_tsv' AS row FROM public.sections s JOIN public.documents d ON d.id=s.document_id WHERE d.corpus=$1 ORDER BY s.id",[corpus]);
  const chunks = await q("SELECT to_jsonb(c)-'search_tsv' AS row FROM public.chunks c JOIN public.sections s ON s.id=c.section_id JOIN public.documents d ON d.id=s.document_id WHERE d.corpus=$1 ORDER BY c.id",[corpus]);
  return {documents:documents.map(x=>x.row),sections:sections.map(x=>x.row),chunks:chunks.map(x=>x.row)};
};
const counts = (i) => ({documents:i.documents.length,sections:i.sections.length,chunks:i.chunks.length});
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v !== null && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) : v;
const digest = (i) => hash(JSON.stringify(canonical(i)));
const noSpace = (s) => s.replace(/\s/g,'');
function validateCandidate(candidate, provenance, raw) {
  assert(hash(raw)===provenance.candidateSha256,'Candidate checksum differs from edition manifest');
  assert(candidate.status==='SOURCE_RECONCILED_CANDIDATE_PENDING_APPLICATION_AND_DATABASE_ACCEPTANCE','Candidate status invalid');
  assert(candidate.edition===provenance.edition && candidate.wordEdition.sha256===provenance.wordSha256,'Edition/volume mismatch');
  assert(candidate.sections.length===provenance.sectionCount,'Section count mismatch');
  const keys = new Set(); let chunks=0;
  for (const [i,s] of candidate.sections.entries()) {
    assert(s.ordinal===i+1 && !keys.has(s.section_key),'Section ordinal/key mismatch'); keys.add(s.section_key);
    assert(s.metadata.edition===candidate.edition && hash(s.content)===s.metadata.contentSha256,'Section integrity failure');
    assert(typeof s.content==='string' && s.content.trim() && s.path.length>0 && s.citation_label && s.source_url.startsWith('https://www3.parliament.nz/'),'Source integrity failure');
    assert(s.content_markdown===s.content,'Content/markdown mismatch');
    assert(s.draftChunks.length>0 && s.draftChunks.every((c,k)=>c.chunkIndex===k && c.content.trim() && Number.isInteger(c.tokenCountEst)),'Chunk identity failure');
    assert(noSpace(s.draftChunks.map(c=>c.content).join(''))===noSpace(s.content),'Chunk text loss');chunks+=s.draftChunks.length;
    if (['A','E'].includes(s.metadata.appendix)) assert(s.metadata.wordTableRowReviewed===true,'Table row review missing');
  }
  assert(chunks===provenance.chunkCount,'Chunk count mismatch');
  for (const key of ['so-338ab','so-405aa','appendix-d-cl-1','appendix-c-cl-4','appendix-a-note']) assert(keys.has(key),'Required coverage absent');
}
async function main() {
  const [mode,candidatePath,backupPath] = process.argv.slice(2);
  assert(process.argv.length===5 && ['--rehearse','--cutover'].includes(mode),'Expected explicit --rehearse/--cutover and candidate/backup paths');
  assert(resolve(candidatePath)!==resolve(backupPath),'Candidate and backup paths collide');
  const provenance=JSON.parse(readFileSync(new URL('../data/sources/standing-orders-2026.provenance.json',import.meta.url),'utf8'));
  const raw=readFileSync(candidatePath);const candidate=JSON.parse(raw.toString('utf8'));
  validateCandidate(candidate,provenance,raw);out.candidateSha256=provenance.candidateSha256;
  out.mode=mode;out.phase='connection';
  const u=new URL(process.env.DATABASE_URL ?? '');
  assert(['postgres:','postgresql:'].includes(u.protocol) && u.hostname && !['localhost','127.0.0.1','::1','[::1]'].includes(u.hostname),'Remote PostgreSQL required');
  const allowed=new Set(['sslmode','channel_binding','application_name','connect_timeout']);
  for(const k of u.searchParams.keys())assert(allowed.has(k),'Unsupported connection URL option');
  const sslmode=u.searchParams.get('sslmode');assert(!sslmode || ['require','verify-ca','verify-full'].includes(sslmode),'Non-verifying TLS refused');
  const enableChannelBinding=u.searchParams.get('channel_binding')==='require';
  for(const k of allowed)u.searchParams.delete(k);
  client=new Client({connectionString:u.toString(),ssl:{rejectUnauthorized:true},enableChannelBinding,connectionTimeoutMillis:10000,application_name:'open_order_corpus_migration'});
  await client.connect();const socket=client.connection?.stream;assert(socket?.encrypted && socket.authorized===true,'Verified TLS required');out.tls='verified';
  out.phase='lock_and_catalog';await q('BEGIN');transaction=true;
  await q("SET LOCAL statement_timeout = '60s'");await q("SET LOCAL lock_timeout = '3s'");
  await q('LOCK TABLE public.documents, public.sections, public.chunks, public.builds IN SHARE ROW EXCLUSIVE MODE');
  // Refuse unexpected dependent relations or triggers that could mutate unrelated data.
  const scope=await q("SELECT relname,relkind,relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relname IN ('documents','sections','chunks','builds','query_logs') ORDER BY relname");
  assert(scope.length===5 && scope.every(x=>x.relkind==='r'&&!x.relrowsecurity),'Unexpected table scope');
  const dependencies=await q("SELECT conrelid::regclass::text AS child,confrelid::regclass::text AS parent,confdeltype AS action,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype='f' AND confrelid IN ('public.documents'::regclass,'public.sections'::regclass,'public.chunks'::regclass) ORDER BY child,parent");
  const expected=new Set(['sections:documents:c','sections:sections:n','chunks:sections:c']);
  assert(dependencies.length===3 && dependencies.every(x=>expected.has(`${x.child.replace(/^public\./,'')}:${x.parent.replace(/^public\./,'')}:${x.action}`)),'Unexpected foreign-key dependencies');
  const triggers=await q("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.documents'::regclass,'public.sections'::regclass,'public.chunks'::regclass,'public.builds'::regclass)");
  assert(triggers.length===0,'Unexpected non-internal triggers');
  const old=await inventory('standing_orders'), sr=await inventory('speakers_rulings');
  out.before={standingOrders:counts(old),speakersRulings:counts(sr)};
  assert(old.documents.length===1 && old.documents[0].slug==='standing-orders-2023' && old.documents[0].edition==='2023' && old.sections.length===428 && old.chunks.length===458,'Unexpected active 2023 baseline');
  assert(sr.documents.length===1 && sr.documents[0].edition==='2023' && sr.sections.length===1337 && sr.chunks.length===1341,'Unexpected Speakers Rulings baseline');
  assert((await one('SELECT count(*)::int AS n FROM public.query_logs')).n===0,'Legacy query log no longer empty');
  assert((await one('SELECT count(*)::int AS n FROM public.documents')).n===2,'Unexpected other documents');
  assert(old.sections.every(s=>s.parent_section_id===null || old.sections.some(p=>p.id===s.parent_section_id)) && sr.sections.every(s=>s.parent_section_id===null||sr.sections.some(p=>p.id===s.parent_section_id)),'Cross-corpus parent references');
  out.oldCorpusDigest=digest(old);out.speakersRulingsDigest=digest(sr);
  // Save complete public corpus rows, including old IDs, timestamps and build references, before any write.
  out.phase='backup';const backup=Buffer.from(JSON.stringify({format:'open-order-corpus-backup-v1',oldCorpusDigest:out.oldCorpusDigest,candidateSha256:out.candidateSha256,...old},null,2)+'\n');
  writeFileSync(backupPath,backup,{mode:0o600,flag:'wx'});assert(hash(readFileSync(backupPath))===hash(backup),'Backup reread mismatch');out.backupSha256=hash(backup);
  out.phase='replace';const documentId=old.documents[0].id;
  const build=await one("INSERT INTO public.builds(build_type,status,metadata) VALUES ('replace_standing_orders_corpus','running',$1::jsonb) RETURNING id",[JSON.stringify({edition:candidate.edition,candidateSha256:out.candidateSha256,previousEdition:'2023',backupSha256:out.backupSha256})]);
  // Reuse active document ID, but give new sections distinct IDs. Never delete the Rulings corpus.
  await q('DELETE FROM public.sections WHERE document_id=$1',[documentId]);
  const doc=provenance.document;
  await q('UPDATE public.documents SET slug=$2,title=$3,source_type=$4,source_url=$5,source_checksum=$6,edition=$7,published_date=NULL,metadata=$8::jsonb,updated_at=now() WHERE id=$1',[documentId,doc.slug,doc.title,doc.sourceType,doc.sourceUrl,out.candidateSha256,candidate.edition,JSON.stringify({effectiveDate:candidate.officialEffectiveDate,wordSha256:provenance.wordSha256,sourceManifestSha256:provenance.sourceManifestSha256,priorEdition:'2023',candidateSha256:out.candidateSha256})]);
  // Bulk, parameterised inserts keep the transaction bounded and preserve each candidate section exactly.
  await q(`INSERT INTO public.sections(document_id,build_id,section_key,section_type,citation_label,ordinal,path,source_locator,source_url,source_anchor,heading,content,content_markdown,metadata)
    SELECT $1::uuid,$2::uuid,x.section_key,x.section_type,x.citation_label,x.ordinal,x.path,x.source_locator,x.source_url,x.source_anchor,x.heading,x.content,x.content_markdown,x.metadata
    FROM jsonb_to_recordset($3::jsonb) AS x(section_key text,section_type text,citation_label text,ordinal int,path text[],source_locator text,source_url text,source_anchor text,heading text,content text,content_markdown text,metadata jsonb)`,[documentId,build.id,JSON.stringify(candidate.sections)]);
  const rows=candidate.sections.flatMap(s=>s.draftChunks.map(c=>({section_key:s.section_key,chunk_index:c.chunkIndex,token_count_est:c.tokenCountEst,content:c.content})));
  await q(`INSERT INTO public.chunks(section_id,build_id,chunk_index,token_count_est,content,metadata)
    SELECT s.id,$2::uuid,x.chunk_index,x.token_count_est,x.content,'{"strategy":"semantic_lexical_v2","edition":"2026"}'::jsonb
    FROM jsonb_to_recordset($3::jsonb) AS x(section_key text,chunk_index int,token_count_est int,content text)
    JOIN public.sections s ON s.document_id=$1::uuid AND s.section_key=x.section_key`,[documentId,build.id,JSON.stringify(rows)]);
  out.phase='verify_candidate';const current=await inventory('standing_orders');out.after=counts(current);
  assert(current.documents.length===1 && current.documents[0].source_checksum===out.candidateSha256 && current.documents[0].edition===candidate.edition,'Document identity mismatch');
  assert(current.sections.length===candidate.sections.length && current.chunks.length===rows.length,'Inserted counts mismatch');
  const actualByKey=new Map(current.sections.map(s=>[s.section_key,s]));const sectionKeyById=new Map(current.sections.map(s=>[s.id,s.section_key]));
  for(const s of candidate.sections){const a=actualByKey.get(s.section_key);for(const k of ['section_type','citation_label','ordinal','path','source_locator','source_url','source_anchor','heading','content','content_markdown','metadata']){
    const equal=JSON.stringify(canonical(a[k]))===JSON.stringify(canonical(s[k]));
    assert(equal,`Section field mismatch ${s.section_key} ${k}`);
  }}
  const actualChunks=new Map(current.chunks.map(c=>[`${sectionKeyById.get(c.section_id)}:${c.chunk_index}`,c]));
  for(const c of rows){const a=actualChunks.get(`${c.section_key}:${c.chunk_index}`);assert(a?.content===c.content && a.token_count_est===c.token_count_est,'Chunk roundtrip mismatch');}
  const vectors=await one(`SELECT (SELECT count(*)::int FROM public.sections WHERE document_id=$1 AND (search_tsv IS NULL OR search_tsv=''::tsvector)) AS sections,(SELECT count(*)::int FROM public.chunks c JOIN public.sections s ON s.id=c.section_id WHERE s.document_id=$1 AND (c.search_tsv IS NULL OR c.search_tsv=''::tsvector)) AS chunks`,[documentId]);
  assert(vectors.sections===0&&vectors.chunks===0,'Empty search vectors');out.emptyVectors=vectors;
  const probes=[];
  for(const [key,query] of [['so-338ab','finance'],['so-405aa','treaties'],['appendix-d-cl-1','coverage'],['appendix-c-cl-4','notice'],['appendix-a-note','leader'],['so-264','subject']]){
    const r=await one('SELECT section_key,search_tsv @@ plainto_tsquery(\'english\',$3) AS lexical FROM public.sections WHERE document_id=$1 AND lower(section_key)=$2',[documentId,key,query]);assert(r?.section_key===key&&r.lexical,'Search witness missing: '+key);probes.push({key,query,pass:true});
  }
  out.searchProbes=probes;
  assert(digest(await inventory('speakers_rulings'))===out.speakersRulingsDigest,'Speakers Rulings changed');
  assert((await one('SELECT count(*)::int AS n FROM public.query_logs')).n===0,'Legacy query log changed');
  await q("UPDATE public.builds SET status='completed',completed_at=now(),metadata=metadata||$2::jsonb WHERE id=$1",[build.id,JSON.stringify({sections:current.sections.length,chunks:current.chunks.length})]);
  out.phase='finish';
  if(mode==='--rehearse'){await q('ROLLBACK');transaction=false;out.status='REHEARSAL_ROLLED_BACK';}
  else{committing=true;await q('COMMIT');committed=true;transaction=false;out.status='COMMITTED_PENDING_PRODUCTION_ACCEPTANCE';}
  out.phase='post_transaction';
  const after=await inventory('standing_orders');assert(digest(after)===(committed?digest(current):out.oldCorpusDigest),'Post-transaction corpus mismatch');
  assert(digest(await inventory('speakers_rulings'))===out.speakersRulingsDigest,'Post-transaction Rulings mismatch');
  assert((await one('SELECT count(*)::int AS n FROM public.query_logs')).n===0,'Post-transaction legacy log changed');out.postTransaction=counts(after);out.phase='complete';
}
try{await main();}catch(error){out.status=committed?'COMMITTED_ACCEPTANCE_INCOMPLETE':committing?'COMMIT_OUTCOME_UNCERTAIN_REVIEW_REQUIRED':'ABORTED';out.error=error instanceof Error && !error.code?error.message:'Database or runtime error; review phase and SQLSTATE';if(error?.code && /^[A-Z0-9]{5}$/.test(error.code))out.sqlstate=error.code;process.exitCode=1;}
finally{if(transaction&&client){try{await q('ROLLBACK');out.rollback='requested';}catch{out.rollback='unconfirmed';}}if(client){try{await client.end();}catch{out.connectionClose='unconfirmed';}}process.stdout.write(JSON.stringify(out)+'\n');}
