CREATE TABLE posts (
    id UUID PRIMARY KEY,
    platform VARCHAR(20) NOT NULL,
    text VARCHAR(8800) NOT NULL,
    media_url VARCHAR(2048),
    status VARCHAR(20) NOT NULL,
    scheduled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX idx_posts_due ON posts(status, scheduled_at);
CREATE INDEX idx_posts_created ON posts(created_at);

CREATE TABLE activities (
    id UUID PRIMARY KEY,
    post_id UUID NOT NULL REFERENCES posts(id),
    platform VARCHAR(20) NOT NULL,
    type VARCHAR(30) NOT NULL,
    message VARCHAR(500) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX idx_activities_created ON activities(created_at);
