package com.insauto.meta;

import com.insauto.automation.Platform;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class TokenVault {
    private final SecretKeySpec key;
    private final SecureRandom random = new SecureRandom();

    public TokenVault(@Value("${INSAUTO_TOKEN_ENCRYPTION_KEY:}") String encodedKey) {
        if (encodedKey.isBlank()) { key = null; return; }
        try {
            byte[] bytes = Base64.getDecoder().decode(encodedKey.strip());
            if (bytes.length != 32) throw new IllegalArgumentException();
            key = new SecretKeySpec(bytes, "AES");
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("INSAUTO_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
        }
    }

    public boolean ready() { return key != null; }

    String encrypt(Platform platform, String plaintext) {
        try {
            byte[] nonce = new byte[12]; random.nextBytes(nonce);
            Cipher cipher = cipher(Cipher.ENCRYPT_MODE, platform, nonce);
            return Base64.getEncoder().encodeToString(nonce) + "." + Base64.getEncoder().encodeToString(cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) { throw new IllegalStateException("Could not securely store the account token."); }
    }

    String decrypt(Platform platform, String ciphertext) {
        try {
            String[] parts = ciphertext.split("\\.", -1);
            if (parts.length != 2) throw new IllegalArgumentException();
            return new String(cipher(Cipher.DECRYPT_MODE, platform, Base64.getDecoder().decode(parts[0]))
                .doFinal(Base64.getDecoder().decode(parts[1])), StandardCharsets.UTF_8);
        } catch (Exception e) { throw new IllegalStateException("Stored account credentials are unavailable; reconnect the account."); }
    }

    private Cipher cipher(int mode, Platform platform, byte[] nonce) throws Exception {
        if (key == null) throw new IllegalStateException();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode, key, new GCMParameterSpec(128, nonce));
        cipher.updateAAD(("insauto:v1:" + platform.name()).getBytes(StandardCharsets.UTF_8));
        return cipher;
    }
}
