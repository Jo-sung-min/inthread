package com.insauto.meta;

import com.insauto.automation.ApiException;
import com.insauto.automation.Platform;
import com.insauto.meta.ConnectionModels.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class ConnectionService {
    private final AccountRepository accounts;
    private final OAuthAttemptRepository attempts;
    private final MetaSettings settings;
    private final TokenVault vault;
    private final MetaClient client;
    private final Clock clock;
    private final TransactionTemplate transaction;
    private final SecureRandom random = new SecureRandom();

    public ConnectionService(AccountRepository accounts, OAuthAttemptRepository attempts, MetaSettings settings,
                             TokenVault vault, MetaClient client, Clock clock, PlatformTransactionManager manager) {
        this.accounts = accounts; this.attempts = attempts; this.settings = settings; this.vault = vault;
        this.client = client; this.clock = clock; this.transaction = new TransactionTemplate(manager);
    }

    @Transactional(readOnly = true)
    public List<ConnectionView> list() { return List.of(view(Platform.INSTAGRAM), view(Platform.THREADS)); }

    @Transactional(readOnly = true)
    public ConnectionView view(Platform platform) {
        ConnectedAccount account = accounts.findById(platform).orElse(null);
        boolean connected = account != null && vault.ready() && account.expiresAt.isAfter(clock.instant());
        String message = settings.configurationMessage(platform, vault.ready());
        return new ConnectionView(platform, connected, account == null ? null : account.username,
            account == null ? null : account.accountId, account == null ? null : account.expiresAt,
            message == null, account != null && !connected ? "계정 연결이 만료되었거나 암호화 키가 없습니다. 다시 연결해 주세요." : message);
    }

    public OAuthStart start(Platform platform) {
        String message = settings.configurationMessage(platform, vault.ready());
        if (message != null) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "OAUTH_NOT_CONFIGURED", message);
        byte[] bytes = new byte[32]; random.nextBytes(bytes);
        String state = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        transaction.executeWithoutResult(status -> {
            attempts.deleteByExpiresAtBefore(clock.instant());
            OAuthAttempt attempt = new OAuthAttempt(); attempt.stateHash = hash(state); attempt.platform = platform;
            attempt.expiresAt = clock.instant().plusSeconds(600); attempts.save(attempt);
        });
        java.util.Map<String, String> fields = new java.util.LinkedHashMap<>();
        fields.put("client_id", settings.appId(platform)); fields.put("redirect_uri", settings.callback(platform));
        fields.put("response_type", "code"); fields.put("state", state);
        fields.put("scope", platform == Platform.INSTAGRAM ? "instagram_business_basic,instagram_business_content_publish" : "threads_basic,threads_content_publish,threads_manage_replies");
        if (platform == Platform.INSTAGRAM) { fields.put("enable_fb_login", "false"); fields.put("force_reauth", "true"); }
        String base = platform == Platform.INSTAGRAM ? "https://www.instagram.com/oauth/authorize" : "https://threads.com/oauth/authorize";
        return new OAuthStart(base + "?" + MetaClient.form(fields), state);
    }

    public ConnectionView complete(Platform platform, OAuthComplete request) {
        // Consume state in a committed transaction before any external request; failed exchanges cannot replay a code.
        Boolean accepted = transaction.execute(status -> {
            OAuthAttempt attempt = attempts.findLocked(hash(request.state())).orElse(null);
            if (attempt == null || attempt.platform != platform) return false;
            boolean valid = attempt.expiresAt.isAfter(clock.instant());
            attempts.delete(attempt);
            return valid;
        });
        if (!Boolean.TRUE.equals(accepted)) throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_OAUTH_STATE", "연결 요청이 만료되었거나 이미 사용되었습니다. 연결 버튼을 다시 눌러 주세요.");
        if (settings.configurationMessage(platform, vault.ready()) != null)
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "OAUTH_NOT_CONFIGURED", "계정 연결 설정이 변경되었습니다. 운영자에게 확인해 주세요.");
        MetaClient.AccountToken token;
        try { token = client.exchange(platform, request.code()); }
        catch (MetaClient.Failure e) { throw new ApiException(HttpStatus.BAD_GATEWAY, "OAUTH_EXCHANGE_FAILED", e.getMessage()); }
        transaction.executeWithoutResult(status -> {
            ConnectedAccount account = accounts.findById(platform).orElseGet(ConnectedAccount::new);
            account.platform = platform; account.accountId = token.accountId; account.username = token.username;
            account.encryptedToken = vault.encrypt(platform, token.token); account.expiresAt = clock.instant().plusSeconds(token.expiresIn);
            account.connectedAt = clock.instant(); accounts.save(account);
        });
        return view(platform);
    }

    @Transactional
    public void disconnect(Platform platform) { accounts.deleteById(platform); }

    @Transactional(readOnly = true)
    public Credentials credentials(Platform platform, String expectedAccountId) {
        ConnectedAccount account = accounts.findById(platform).orElseThrow(() ->
            new ApiException(HttpStatus.CONFLICT, "ACCOUNT_NOT_CONNECTED", "사이트에서 먼저 계정을 연결해 주세요."));
        if (!account.accountId.equals(expectedAccountId)) throw new ApiException(HttpStatus.CONFLICT, "ACCOUNT_CHANGED", "연결된 계정이 변경되었습니다. 게시 대상 계정을 다시 확인해 주세요.");
        if (!account.expiresAt.isAfter(clock.instant().plusSeconds(60))) throw new ApiException(HttpStatus.CONFLICT, "ACCOUNT_EXPIRED", "계정 연결이 만료되었습니다. 다시 연결해 주세요.");
        try { return new Credentials(platform, account.accountId, vault.decrypt(platform, account.encryptedToken)); }
        catch (IllegalStateException e) { throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "TOKEN_UNAVAILABLE", "계정 토큰을 사용할 수 없습니다. 암호화 설정을 확인한 뒤 다시 연결해 주세요."); }
    }

    private static String hash(String state) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(state.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException("SHA-256 unavailable."); }
    }
}
