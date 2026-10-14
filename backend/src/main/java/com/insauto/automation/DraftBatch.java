package com.insauto.automation;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "draft_batches")
class DraftBatch {
    @Id UUID id;
    @Column(name = "payload_hash", nullable = false, length = 64) String payloadHash;
    @Column(name = "created_at", nullable = false) Instant createdAt;
    protected DraftBatch() {}
    DraftBatch(UUID id, String payloadHash, Instant now) { this.id = id; this.payloadHash = payloadHash; this.createdAt = now; }
}
