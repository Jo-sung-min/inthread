package com.insauto.meta;

import com.insauto.automation.Platform;
import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "oauth_attempts")
class OAuthAttempt {
    @Id @Column(name = "state_hash", length = 64) String stateHash;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) Platform platform;
    @Column(name = "expires_at", nullable = false) Instant expiresAt;
    protected OAuthAttempt() {}
}
