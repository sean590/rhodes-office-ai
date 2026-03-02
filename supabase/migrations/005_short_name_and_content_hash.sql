-- Add short_name to entities for canonical document naming
ALTER TABLE entities ADD COLUMN short_name TEXT;
CREATE UNIQUE INDEX idx_entities_short_name ON entities(short_name);

-- Add content_hash to documents for duplicate detection
ALTER TABLE documents ADD COLUMN content_hash TEXT;
CREATE INDEX idx_docs_content_hash ON documents(content_hash);
