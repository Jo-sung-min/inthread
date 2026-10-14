package com.insauto.meta;

import com.insauto.automation.ApiException;
import com.insauto.automation.Platform;
import com.insauto.meta.ConnectionModels.OAuthComplete;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:connection-test;DB_CLOSE_DELAY=-1",
    "insauto.api-key=test-key", "insauto.scheduler.enabled=false",
    "INSTAGRAM_APP_ID=111", "INSTAGRAM_APP_SECRET=test-instagram-secret",
    "THREADS_APP_ID=222", "THREADS_APP_SECRET=test-threads-secret",
    "PUBLIC_APP_URL=https://app.example.com",
    "INSAUTO_TOKEN_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
})
@AutoConfigureMockMvc
class ConnectionIntegrationTest {
    private static final Instant NOW = Instant.parse("2026-10-14T00:00:00Z");
    @Autowired ConnectionService service;
    @Autowired AccountRepository accounts;
    @Autowired OAuthAttemptRepository attempts;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @MockitoBean MetaClient client;
    @MockitoBean Clock clock;

    @BeforeEach
    void setup() {
        when(clock.instant()).thenReturn(NOW);
        accounts.deleteAll(); attempts.deleteAll();
        when(client.exchange(any(), anyString())).thenReturn(new MetaClient.AccountToken("456", "fortune_account", "test-access-token", 3600));
    }

    @Test
    void storesOnlyStateHashAndEncryptedTokenAndNeverSerializesSecrets() throws Exception {
        var start = service.start(Platform.INSTAGRAM);
        assertThat(start.authorizationUrl()).startsWith("https://www.instagram.com/oauth/authorize?")
            .contains("state=" + start.state()).contains("instagram_business_content_publish");
        String stateHash = jdbc.queryForObject("select state_hash from oauth_attempts", String.class);
        assertThat(stateHash).hasSize(64).doesNotContain(start.state());
        assertThat(service.complete(Platform.INSTAGRAM, new OAuthComplete("test-code", start.state())).connected()).isTrue();
        assertThat(attempts.count()).isZero();
        String encrypted = jdbc.queryForObject("select encrypted_token from connected_accounts where platform='INSTAGRAM'", String.class);
        assertThat(encrypted).doesNotContain("test-access-token");
        var credentials = service.credentials(Platform.INSTAGRAM, "456");
        assertThat(credentials.token()).isEqualTo("test-access-token");
        assertThat(credentials.toString()).doesNotContain("test-access-token");
        String json = mvc.perform(get("/api/v1/connections").header("X-API-Key", "test-key"))
            .andExpect(status().isOk()).andExpect(jsonPath("$[0].connected").value(true))
            .andReturn().getResponse().getContentAsString();
        assertThat(json).doesNotContain("test-access-token", "test-instagram-secret", "test-code", encrypted, "encryptedToken");
    }

    @Test
    void rejectsStateReplayAndWrongPlatformWithoutCallingMeta() {
        var start = service.start(Platform.INSTAGRAM);
        var request = new OAuthComplete("code", start.state());
        assertThatThrownBy(() -> service.complete(Platform.THREADS, request)).isInstanceOf(ApiException.class);
        verifyNoInteractions(client);
        service.complete(Platform.INSTAGRAM, request);
        assertThatThrownBy(() -> service.complete(Platform.INSTAGRAM, request)).isInstanceOf(ApiException.class);
        verify(client, times(1)).exchange(Platform.INSTAGRAM, "code");
    }

    @Test
    void expiresStatesAndConsumesFailuresBeforeTheExchange() {
        var expired = service.start(Platform.THREADS);
        when(clock.instant()).thenReturn(NOW.plusSeconds(600));
        assertThatThrownBy(() -> service.complete(Platform.THREADS, new OAuthComplete("code", expired.state())))
            .isInstanceOf(ApiException.class);
        verifyNoInteractions(client);
        assertThat(attempts.count()).isZero();
        when(clock.instant()).thenReturn(NOW);
        var failed = service.start(Platform.INSTAGRAM);
        when(client.exchange(Platform.INSTAGRAM, "bad-code")).thenThrow(new MetaClient.Failure("Provider rejected the code."));
        assertThatThrownBy(() -> service.complete(Platform.INSTAGRAM, new OAuthComplete("bad-code", failed.state())))
            .isInstanceOf(ApiException.class);
        assertThat(attempts.count()).isZero();
        assertThatThrownBy(() -> service.complete(Platform.INSTAGRAM, new OAuthComplete("bad-code", failed.state())))
            .isInstanceOf(ApiException.class);
        verify(client, times(1)).exchange(Platform.INSTAGRAM, "bad-code");
    }

    @Test
    void concurrentCallbacksCanExchangeTheCodeOnlyOnce() throws Exception {
        var start = service.start(Platform.INSTAGRAM);
        var request = new OAuthComplete("same-code", start.state());
        var gate = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var tasks = List.of(
                executor.submit(() -> completeAfterGate(gate, request)),
                executor.submit(() -> completeAfterGate(gate, request)));
            gate.countDown();
            assertThat(List.of(tasks.get(0).get(), tasks.get(1).get())).containsExactlyInAnyOrder(true, false);
        }
        verify(client, times(1)).exchange(Platform.INSTAGRAM, "same-code");
    }

    @Test
    void credentialsRejectMissingChangedExpiredOrTamperedAccountAndDisconnectRemovesIt() {
        assertThatThrownBy(() -> service.credentials(Platform.THREADS, "456")).isInstanceOf(ApiException.class);
        var start = service.start(Platform.THREADS);
        service.complete(Platform.THREADS, new OAuthComplete("code", start.state()));
        assertThatThrownBy(() -> service.credentials(Platform.THREADS, "999")).isInstanceOf(ApiException.class);
        when(clock.instant()).thenReturn(NOW.plusSeconds(3540));
        assertThatThrownBy(() -> service.credentials(Platform.THREADS, "456")).isInstanceOf(ApiException.class);
        when(clock.instant()).thenReturn(NOW.plusSeconds(3600));
        assertThat(service.view(Platform.THREADS).connected()).isFalse();
        when(clock.instant()).thenReturn(NOW);
        jdbc.update("update connected_accounts set encrypted_token='tampered' where platform='THREADS'");
        assertThatThrownBy(() -> service.credentials(Platform.THREADS, "456")).isInstanceOf(ApiException.class);
        service.disconnect(Platform.THREADS);
        assertThat(accounts.count()).isZero();
        assertThat(service.view(Platform.THREADS).connected()).isFalse();
    }

    @Test
    void allConnectionRoutesRequireTheWorkspaceKey() throws Exception {
        mvc.perform(get("/api/v1/connections")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/connections/INSTAGRAM/oauth/start")).andExpect(status().isUnauthorized());
        mvc.perform(delete("/api/v1/connections/THREADS")).andExpect(status().isUnauthorized());
    }

    private boolean completeAfterGate(CountDownLatch gate, OAuthComplete request) throws Exception {
        gate.await();
        try { return service.complete(Platform.INSTAGRAM, request).connected(); }
        catch (ApiException expected) { return false; }
    }
}
