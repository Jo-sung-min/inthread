package com.insauto.meta;

import com.insauto.automation.Platform;
import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "connected_accounts")
class ConnectedAccount {
    @Id @Enumerated(EnumType.STRING) @Column(length = 20) Platform platform;
    @Column(name = "account_id", nullable = false, length = 100) String accountId;
    @Column(nullable = false, length = 200) String username;
    @Column(name = "encrypted_token", nullable = false, length = 8192) String encryptedToken;
    @Column(name = "expires_at", nullable = false) Instant expiresAt;
    @Column(name = "connected_at", nullable = false) Instant connectedAt;
    protected ConnectedAccount() {}
}
