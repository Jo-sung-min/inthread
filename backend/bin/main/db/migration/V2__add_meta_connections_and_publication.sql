CREATE TABLE connected_accounts (
    platform VARCHAR(20) PRIMARY KEY,
    account_id VARCHAR(100) NOT NULL,
    username VARCHAR(200) NOT NULL,
    encrypted_token VARCHAR(8192) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    connected_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE TABLE oauth_attempts (
    state_hash VARCHAR(64) PRIMARY KEY,
    platform VARCHAR(20) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX idx_oauth_expiry ON oauth_attempts(expires_at);
ALTER TABLE posts ADD COLUMN publish_account_id VARCHAR(100);
ALTER TABLE posts ADD COLUMN container_id VARCHAR(100);
ALTER TABLE posts ADD COLUMN published_id VARCHAR(100);
ALTER TABLE posts ADD COLUMN permalink VARCHAR(2048);
ALTER TABLE posts ADD COLUMN publish_error VARCHAR(500);
