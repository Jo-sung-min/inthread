CREATE TABLE draft_batches (
    id UUID PRIMARY KEY,
    payload_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);
ALTER TABLE posts ADD COLUMN batch_id UUID REFERENCES draft_batches(id);
ALTER TABLE posts ADD COLUMN batch_position INTEGER;
CREATE INDEX idx_posts_batch ON posts(batch_id, batch_position);
CREATE TABLE post_segments (
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    segment_order INTEGER NOT NULL,
    segment_text VARCHAR(8800) NOT NULL,
    PRIMARY KEY (post_id, segment_order)
);
CREATE TABLE post_publications (
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    publication_order INTEGER NOT NULL,
    published_id VARCHAR(100) NOT NULL,
    PRIMARY KEY (post_id, publication_order)
);
-- Preserve receipts from posts published before series support was added.
INSERT INTO post_publications (post_id, publication_order, published_id)
SELECT id, 0, published_id FROM posts WHERE published_id IS NOT NULL;
