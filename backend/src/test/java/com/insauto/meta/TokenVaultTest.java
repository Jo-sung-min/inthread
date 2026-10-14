package com.insauto.meta;

import com.insauto.automation.Platform;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class TokenVaultTest {
    private final TokenVault vault = new TokenVault(Base64.getEncoder().encodeToString(new byte[32]));

    @Test
    void encryptsWithFreshNoncesAndRoundTripsUnicodeWithoutPlaintext() {
        String plaintext = "secret-token-한글+&";
        String first = vault.encrypt(Platform.INSTAGRAM, plaintext);
        String second = vault.encrypt(Platform.INSTAGRAM, plaintext);
        assertThat(first).isNotEqualTo(second).doesNotContain(plaintext);
        assertThat(first.split("\\.")[0]).isNotEqualTo(second.split("\\.")[0]);
        assertThat(vault.decrypt(Platform.INSTAGRAM, first)).isEqualTo(plaintext);
        assertThat(vault.decrypt(Platform.INSTAGRAM, second)).isEqualTo(plaintext);
    }

    @Test
    void platformSwapTamperingAndWrongKeysFailAuthentication() {
        String encrypted = vault.encrypt(Platform.INSTAGRAM, "secret-token");
        assertThatThrownBy(() -> vault.decrypt(Platform.THREADS, encrypted)).isInstanceOf(IllegalStateException.class);
        String[] parts = encrypted.split("\\.");
        byte[] bytes = Base64.getDecoder().decode(parts[1]); bytes[0] ^= 1;
        String tampered = parts[0] + "." + Base64.getEncoder().encodeToString(bytes);
        assertThatThrownBy(() -> vault.decrypt(Platform.INSTAGRAM, tampered))
            .isInstanceOf(IllegalStateException.class).hasMessageNotContaining("secret-token");
        byte[] otherKey = new byte[32]; otherKey[0] = 1;
        TokenVault other = new TokenVault(Base64.getEncoder().encodeToString(otherKey));
        assertThatThrownBy(() -> other.decrypt(Platform.INSTAGRAM, encrypted)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void unconfiguredOrInvalidKeysCannotStoreTokens() {
        TokenVault absent = new TokenVault("");
        assertThat(absent.ready()).isFalse();
        assertThatThrownBy(() -> absent.encrypt(Platform.THREADS, "secret-token")).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new TokenVault("secret-not-base64")).isInstanceOf(IllegalArgumentException.class)
            .hasMessageNotContaining("secret-not-base64");
        assertThatThrownBy(() -> new TokenVault(Base64.getEncoder().encodeToString(new byte[16]))).isInstanceOf(IllegalArgumentException.class);
    }
}
