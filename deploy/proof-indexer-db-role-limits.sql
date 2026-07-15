ALTER ROLE proof_indexer IN DATABASE proof_indexer
  SET temp_file_limit = '1GB';

ALTER ROLE proof_indexer IN DATABASE proof_indexer
  SET log_temp_files = '256MB';
