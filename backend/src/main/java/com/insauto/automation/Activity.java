package com.insauto.automation;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "activities")
public class Activity {
    @Id UUID id;
    @Column(name = "post_id", nullable = false) UUID postId;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) Platform platform;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 30) ActivityType type;
    @Column(nullable = false, length = 500) String message;
    @Column(name = "created_at", nullable = false) Instant createdAt;

    protected Activity() {}

    Activity(Post post, ActivityType type, String message, Instant now) {
        this.id = UUID.randomUUID();
        this.postId = post.id;
        this.platform = post.platform;
        this.type = type;
        this.message = message;
        this.createdAt = now;
    }
}
