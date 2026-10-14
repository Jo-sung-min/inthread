package com.insauto.meta;

import com.insauto.automation.Platform;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;

public final class ConnectionModels {
    private ConnectionModels() {}
    public record ConnectionView(Platform platform, boolean connected, String username, String accountId,
                                 Instant expiresAt, boolean oauthConfigured, String configurationMessage) {}
    public record OAuthStart(String authorizationUrl, String state) {}
    public record OAuthComplete(@NotBlank @Size(max = 4096) String code, @NotBlank @Size(max = 100) String state) {}
    // Never return or log Credentials through a controller or tool result.
    public static final class Credentials {
        private final Platform platform;
        private final String accountId, token;
        Credentials(Platform platform, String accountId, String token) { this.platform = platform; this.accountId = accountId; this.token = token; }
        public Platform platform() { return platform; }
        public String accountId() { return accountId; }
        public String token() { return token; }
        @Override public String toString() { return "Credentials[redacted]"; }
    }
}
