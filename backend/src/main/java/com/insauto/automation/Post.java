package com.insauto.automation;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "posts")
public class Post {
    @Id UUID id;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) Platform platform;
    @Column(nullable = false, length = 8800) String text;
    @Column(name = "media_url", length = 2048) String mediaUrl;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) PostStatus status;
    @Column(name = "scheduled_at") Instant scheduledAt;
    @Column(name = "created_at", nullable = false) Instant createdAt;
    @Column(name = "updated_at", nullable = false) Instant updatedAt;
    @Column(name = "publish_account_id", length = 100) String publishAccountId;
    @Column(name = "container_id", length = 100) String containerId;
    @Column(name = "published_id", length = 100) String publishedId;
    @Column(length = 2048) String permalink;
    @Column(name = "publish_error", length = 500) String publishError;

    @ElementCollection
    @CollectionTable(name = "post_segments", joinColumns = @JoinColumn(name = "post_id"))
    @OrderColumn(name = "segment_order")
    @Column(name = "segment_text", nullable = false, length = 8800)
    java.util.List<String> segments = new java.util.ArrayList<>();
    @ElementCollection
    @CollectionTable(name = "post_publications", joinColumns = @JoinColumn(name = "post_id"))
    @OrderColumn(name = "publication_order")
    @Column(name = "published_id", nullable = false, length = 100)
    java.util.List<String> publishedIds = new java.util.ArrayList<>();
    @Column(name = "batch_id") UUID batchId;
    @Column(name = "batch_position") Integer batchPosition;
    void touch(Instant now) {
        Instant next = now.truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        updatedAt = next.isAfter(updatedAt) ? next : updatedAt.plus(1, java.time.temporal.ChronoUnit.MICROS);
    }
    protected Post() {}

    Post(Platform platform, String text, String mediaUrl, Instant now) {
        this.id = UUID.randomUUID();
        this.platform = platform;
        this.text = text;
        this.mediaUrl = mediaUrl;
        this.status = PostStatus.DRAFT;
        this.createdAt = now.truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        this.updatedAt = this.createdAt;
    }
}
