-- Reproducible, content-addressed linked Publish Search data. No ledger rows.
CREATE TABLE IF NOT EXISTS proof_indexer.search_linked_contents (
 network text NOT NULL, content_hash text NOT NULL CHECK(content_hash ~ '^[0-9a-f]{64}$'),
 body text NOT NULL, body_bytes integer NOT NULL CHECK(body_bytes BETWEEN 1 AND 4000000),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(network,content_hash),
 CHECK(octet_length(body)=body_bytes),
 CHECK(encode(sha256(convert_to(body,'UTF8')),'hex')=content_hash)
);
CREATE TABLE IF NOT EXISTS proof_indexer.search_linked_postings (
 network text NOT NULL, content_hash text NOT NULL,
 parser_identity text NOT NULL CHECK(parser_identity ~ '^[0-9a-f]{64}$'),
 postings jsonb NOT NULL CHECK(jsonb_typeof(postings)='object'),
 postings_bytes bigint NOT NULL CHECK(postings_bytes BETWEEN 2 AND 268435456),
 CHECK(postings_bytes=octet_length(postings::text)),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(network,content_hash,parser_identity),
 FOREIGN KEY(network,content_hash) REFERENCES proof_indexer.search_linked_contents(network,content_hash)
);
CREATE TABLE IF NOT EXISTS proof_indexer.search_linked_refs (
 network text NOT NULL, run_id text NOT NULL, id text NOT NULL,
 content_hash text NOT NULL, parser_identity text NOT NULL,
 source_hash text NOT NULL, dependency_hash text NOT NULL,
 prefix_tokens integer NOT NULL CHECK(prefix_tokens>=0),
 PRIMARY KEY(network,run_id,id),
 FOREIGN KEY(network,run_id,id) REFERENCES proof_indexer.search_documents(network,run_id,id) ON DELETE CASCADE,
 FOREIGN KEY(network,content_hash,parser_identity)
  REFERENCES proof_indexer.search_linked_postings(network,content_hash,parser_identity)
);
CREATE INDEX IF NOT EXISTS search_linked_refs_content_idx
 ON proof_indexer.search_linked_refs(network,content_hash,parser_identity);

CREATE OR REPLACE FUNCTION proof_indexer.search_simple_parser_identity() RETURNS text
LANGUAGE SQL STABLE AS $f$
 SELECT encode(sha256(convert_to(jsonb_build_object(
  'model','pg16-simple-positions-255-saturation-16383-v1',
  'serverVersion',current_setting('server_version_num'),
  'parser',(SELECT p.prsnamespace::regnamespace::text||'.'||p.prsname FROM pg_ts_config c JOIN pg_ts_parser p ON p.oid=c.cfgparser WHERE c.oid='pg_catalog.simple'::regconfig),
  'locale',(SELECT jsonb_build_object('ctype',datctype,'collate',datcollate,'provider',datlocprovider,'icu',daticulocale,'version',datcollversion) FROM pg_database WHERE datname=current_database()),
  'mapping',(SELECT jsonb_agg(jsonb_build_array(maptokentype,mapseqno,mapdict::regdictionary::text,
    d.dictinitoption) ORDER BY maptokentype,mapseqno)
   FROM pg_ts_config_map m JOIN pg_ts_dict d ON d.oid=m.mapdict WHERE mapcfg='pg_catalog.simple'::regconfig)
 )::text,'UTF8')),'hex')
$f$;

CREATE OR REPLACE FUNCTION proof_indexer.search_simple_positions(txt text)
RETURNS TABLE(lexeme text,positions smallint[]) LANGUAGE plpgsql STABLE SET work_mem='256MB' AS $f$
DECLARE size_error text;
BEGIN
 BEGIN
  RETURN QUERY SELECT u.lexeme,u.positions FROM unnest(to_tsvector('pg_catalog.simple',txt)) AS u;
  RETURN;
 EXCEPTION WHEN program_limit_exceeded THEN
  GET STACKED DIAGNOSTICS size_error=MESSAGE_TEXT;
  IF size_error !~ '^string is too long for tsvector [(][0-9]+ bytes, max 1048575 bytes[)]$' THEN RAISE; END IF;
 END;
 RETURN QUERY
 WITH parsed AS NOT MATERIALIZED (
  SELECT p.token,m.mapdict,p.ord FROM ts_parse('pg_catalog.default',txt) WITH ORDINALITY p(tokid,token,ord)
  JOIN pg_ts_config_map m ON m.mapcfg='pg_catalog.simple'::regconfig AND m.maptokentype=p.tokid AND m.mapseqno=1
  WHERE octet_length(p.token)<2048
 ), numbered AS (
  SELECT p.token,p.mapdict,row_number() OVER(ORDER BY p.ord) AS position FROM parsed p
 ), words AS (
  SELECT x.word AS lexeme,least(n.position,16383)::smallint AS pos
  FROM numbered n CROSS JOIN LATERAL unnest(ts_lexize(n.mapdict,n.token)) AS x(word) WHERE octet_length(x.word)<2048
 ), distinct_positions AS (SELECT DISTINCT w.lexeme,w.pos FROM words w)
 SELECT d.lexeme,(array_agg(d.pos ORDER BY d.pos))[1:255] FROM distinct_positions d GROUP BY d.lexeme;
END
$f$;

CREATE OR REPLACE FUNCTION proof_indexer.search_simple_token_count(txt text) RETURNS integer
LANGUAGE SQL STABLE AS $f$
 SELECT count(*)::integer FROM ts_parse('pg_catalog.default',txt) p
 JOIN pg_ts_config_map m ON m.mapcfg='pg_catalog.simple'::regconfig AND m.maptokentype=p.tokid AND m.mapseqno=1
 WHERE octet_length(p.token)<2048
$f$;

CREATE OR REPLACE FUNCTION proof_indexer.search_query_lexemes(q tsquery) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE rest text; answer text[];
BEGIN
 rest:=regexp_replace(q::text,$rx$'(?:''|\\.|[^'])*'$rx$,'','g');
 IF rest !~ '^[()&|!<>0-9 -]*$' THEN RAISE EXCEPTION 'Unsupported canonical Search query tree'; END IF;
 SELECT COALESCE(array_agg(DISTINCT term ORDER BY term),ARRAY[]::text[]) INTO answer
 FROM (SELECT unnest(tsvector_to_array((m[1])::tsvector)) AS term
       FROM regexp_matches(q::text,$rx$'(?:''|\\.|[^'])*'$rx$,'g') m) a;
 RETURN answer;
END
$f$;

CREATE OR REPLACE FUNCTION proof_indexer.search_linked_query_vector(
 posting_input jsonb, prefix_vector tsvector, prefix_tokens integer, query tsquery
) RETURNS tsvector LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE postings jsonb; prefix jsonb; term text; p smallint[]; vector_text text:='';
BEGIN
 IF prefix_tokens<0 OR jsonb_typeof(posting_input)<>'object' THEN RAISE EXCEPTION 'Invalid linked Search projection'; END IF;
 -- Detoast/copy the content object once, not once per query lexeme.
 postings:=posting_input || '{}'::jsonb;
 SELECT COALESCE(jsonb_object_agg(lexeme,to_jsonb(positions)),'{}'::jsonb) INTO prefix FROM unnest(prefix_vector);
 FOREACH term IN ARRAY proof_indexer.search_query_lexemes(query) LOOP
  SELECT (array_agg(pos ORDER BY pos))[1:255] INTO p FROM (
   SELECT DISTINCT x::smallint AS pos FROM jsonb_array_elements_text(COALESCE(prefix->term,'[]'::jsonb)) x
   UNION
   SELECT DISTINCT least(x::integer+prefix_tokens,16383)::smallint AS pos
   FROM jsonb_array_elements_text(COALESCE(postings->term,'[]'::jsonb)) x
  ) v;
  IF p IS NOT NULL THEN
   vector_text:=vector_text || array_to_tsvector(ARRAY[term])::text || ':' || array_to_string(p,',') || ' ';
  END IF;
 END LOOP;
 IF octet_length(vector_text)>524288 THEN RAISE EXCEPTION 'Linked Search query projection exceeded its safe bound'; END IF;
 RETURN vector_text::tsvector;
END
$f$;

CREATE OR REPLACE FUNCTION proof_indexer.search_simple_parser_supported() RETURNS boolean
LANGUAGE SQL STABLE AS $f$
 SELECT current_setting('server_version_num')::integer BETWEEN 160000 AND 169999
 AND EXISTS(SELECT 1 FROM pg_ts_config c JOIN pg_ts_parser p ON p.oid=c.cfgparser
   WHERE c.oid='pg_catalog.simple'::regconfig AND p.prsnamespace='pg_catalog'::regnamespace AND p.prsname='default')
 AND EXISTS(SELECT 1 FROM pg_ts_config_map WHERE mapcfg='pg_catalog.simple'::regconfig)
 AND NOT EXISTS(SELECT 1 FROM pg_ts_config_map m JOIN pg_ts_dict d ON d.oid=m.mapdict
   WHERE m.mapcfg='pg_catalog.simple'::regconfig AND
     (m.mapseqno<>1 OR m.mapdict<>'pg_catalog.simple'::regdictionary OR COALESCE(d.dictinitoption,'')<>''))
$f$;

CREATE OR REPLACE FUNCTION proof_indexer.search_linked_excerpt(prefix text,body text,q text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE full_text text:=prefix||E'\n'||body; at integer; first_char integer; excerpt text;
BEGIN
 at:=CASE WHEN q='' THEN 0 ELSE strpos(lower(full_text),lower(q)) END;
 first_char:=CASE WHEN at=0 THEN 1 ELSE greatest(1,at-100) END;
 excerpt:=substring(full_text FROM first_char FOR 360);
 RETURN CASE WHEN first_char>1 THEN '…' ELSE '' END || excerpt ||
        CASE WHEN first_char+length(excerpt)<=length(full_text) THEN '…' ELSE '' END;
END
$f$;

-- One explicit serving-generation pin per network bounds prebuild retention.
-- Never auto-expire: release only after reader switch and rollback verification.
CREATE TABLE IF NOT EXISTS proof_indexer.search_serving_pins (
 network text PRIMARY KEY, run_id text NOT NULL REFERENCES proof_indexer.search_runs(run_id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 200),
 created_at timestamptz NOT NULL DEFAULT now()
);
