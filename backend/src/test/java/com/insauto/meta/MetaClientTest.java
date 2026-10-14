package com.insauto.meta;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.insauto.automation.Platform;
import com.insauto.meta.ConnectionModels.Credentials;
import java.io.ByteArrayOutputStream;
import java.net.URLDecoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Flow;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class MetaClientTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final MetaSettings settings = new MetaSettings("111", "ig-secret", "222", "th-secret", "https://app.example.com", "v26.0");
    private HttpClient http;
    private MetaClient client;

    @BeforeEach
    void setup() {
        http = mock(HttpClient.class);
        client = new MetaClient(mapper, settings, http);
    }

    @Test
    void instagramAcceptsDirectAndWrappedTokenResponsesAndUsesUserId() throws Exception {
        for (boolean wrapped : new boolean[]{false, true}) {
            reset(http);
            String tokenBody = "{\"access_token\":\"short-token\",\"user_id\":\"123\"}";
            String identityBody = "{\"user_id\":\"456\",\"id\":\"999\",\"username\":\"fortune_account\"}";
            replies(wrapped ? "{\"data\":[" + tokenBody + "]}" : tokenBody,
                "{\"access_token\":\"long-token\",\"expires_in\":5184000}",
                wrapped ? "{\"data\":[" + identityBody + "]}" : identityBody);
            var account = client.exchange(Platform.INSTAGRAM, "authorization+code");
            assertThat(account.accountId).isEqualTo("456");
            assertThat(account.username).isEqualTo("fortune_account");
            assertThat(account.token).isEqualTo("long-token");
            assertThat(account.toString()).doesNotContain("long-token");
            var requests = requests(3);
            assertThat(requests.get(0).uri().toString()).isEqualTo("https://api.instagram.com/oauth/access_token");
            assertThat(form(body(requests.get(0)))).containsEntry("code", "authorization+code")
                .containsEntry("client_secret", "ig-secret")
                .containsEntry("redirect_uri", "https://app.example.com/api/oauth/instagram/callback");
            assertThat(form(requests.get(1).uri().getRawQuery())).containsEntry("grant_type", "ig_exchange_token");
            assertThat(requests.get(2).uri().getPath()).isEqualTo("/v26.0/me");
            assertThat(form(requests.get(2).uri().getRawQuery())).containsEntry("fields", "user_id,username").doesNotContainKey("access_token");
            assertThat(requests.get(2).headers().firstValue("Authorization")).hasValue("Bearer long-token");
            assertThat(requests).allSatisfy(request -> assertThat(request.timeout()).hasValue(Duration.ofSeconds(10)));
        }
    }

    @Test
    void instagramRejectsAmbiguousIdentityOrMissingExpiration() throws Exception {
        replies("{\"access_token\":\"short-token\"}", "{\"access_token\":\"long-token\",\"expires_in\":60}", "{\"id\":\"999\",\"username\":\"account\"}");
        assertThatThrownBy(() -> client.exchange(Platform.INSTAGRAM, "code")).isInstanceOf(MetaClient.Failure.class);
        reset(http);
        replies("{\"access_token\":\"short-token\"}", "{\"access_token\":\"long-token\"}");
        assertThatThrownBy(() -> client.exchange(Platform.INSTAGRAM, "code")).isInstanceOf(MetaClient.Failure.class).hasMessageContaining("expiration");
        requests(2);
    }

    @Test
    void instagramWritesJsonWithBearerAndThreadsWritesFormWithEncodedToken() throws Exception {
        replies("{\"id\":\"100\"}", "{\"id\":\"101\"}", "{\"id\":\"102\"}", "{\"id\":\"103\"}");
        var instagram = new Credentials(Platform.INSTAGRAM, "456", "ig-token");
        var threads = new Credentials(Platform.THREADS, "789", "th+token&safe");
        assertThat(client.createContainer(instagram, "오늘 & 운세 🌙", "https://images.example.com/card.jpg")).isEqualTo("100");
        client.publishContainer(instagram, "100");
        client.createContainer(threads, "오늘 & 운세 🌙", null);
        client.publishContainer(threads, "102");
        var requests = requests(4);
        assertThat(requests.get(0).uri().toString()).isEqualTo("https://graph.instagram.com/v26.0/456/media");
        assertThat(requests.get(0).headers().firstValue("Authorization")).hasValue("Bearer ig-token");
        assertThat(requests.get(0).headers().firstValue("Content-Type")).hasValue("application/json");
        var instagramBody = mapper.readTree(body(requests.get(0)));
        assertThat(instagramBody.path("caption").asText()).isEqualTo("오늘 & 운세 🌙");
        assertThat(instagramBody.has("access_token")).isFalse();
        assertThat(mapper.readTree(body(requests.get(1))).path("creation_id").asText()).isEqualTo("100");
        assertThat(requests.get(2).uri().toString()).isEqualTo("https://graph.threads.com/v1.0/789/threads");
        assertThat(requests.get(2).headers().firstValue("Content-Type")).hasValue("application/x-www-form-urlencoded");
        assertThat(form(body(requests.get(2)))).containsEntry("media_type", "TEXT").containsEntry("text", "오늘 & 운세 🌙")
            .containsEntry("access_token", "th+token&safe").doesNotContainKey("image_url");
        assertThat(form(body(requests.get(3)))).containsEntry("creation_id", "102");
        assertThat(requests.get(3).uri().getPath()).isEqualTo("/v1.0/789/threads_publish");
    }

    @Test
    void threadsOAuthUsesItsOwnAppAndIdentityContract() throws Exception {
        replies("{\"access_token\":\"short-token\"}", "{\"access_token\":\"long-token\",\"expires_in\":5184000}", "{\"id\":\"789\",\"username\":\"threads_account\"}");
        assertThat(client.exchange(Platform.THREADS, "code").accountId).isEqualTo("789");
        var requests = requests(3);
        assertThat(requests.get(0).uri().toString()).isEqualTo("https://graph.threads.com/oauth/access_token");
        assertThat(form(body(requests.get(0)))).containsEntry("client_id", "222").containsEntry("client_secret", "th-secret");
        assertThat(form(requests.get(1).uri().getRawQuery())).containsEntry("grant_type", "th_exchange_token");
        assertThat(form(requests.get(2).uri().getRawQuery())).containsEntry("fields", "id,username").containsEntry("access_token", "long-token");
    }

    @Test
    void statusFieldsDifferAndUntrustedPermalinksAreRejected() throws Exception {
        replies("{\"status_code\":\"FINISHED\"}", "{\"status\":\"FINISHED\"}", "{\"permalink\":\"https://instagram.com.attacker.example/post\"}");
        assertThat(client.containerStatus(new Credentials(Platform.INSTAGRAM, "456", "secret"), "100")).isEqualTo("FINISHED");
        assertThat(client.containerStatus(new Credentials(Platform.THREADS, "789", "secret"), "200")).isEqualTo("FINISHED");
        assertThatThrownBy(() -> client.permalink(new Credentials(Platform.INSTAGRAM, "456", "secret"), "100"))
            .isInstanceOf(MetaClient.Failure.class).hasMessageContaining("invalid post link");
        var requests = requests(3);
        assertThat(form(requests.get(0).uri().getRawQuery())).containsEntry("fields", "status_code");
        assertThat(form(requests.get(1).uri().getRawQuery())).containsEntry("fields", "status");
    }

    @Test
    void providerErrorsAndTimeoutsNeverExposeBodiesTokensOrRequestUrls() throws Exception {
        var rejected = response(400, "secret-token private-email@example.com");
        when(http.send(any(HttpRequest.class), org.mockito.ArgumentMatchers.<HttpResponse.BodyHandler<String>>any()))
            .thenReturn(rejected);
        assertThatThrownBy(() -> client.createContainer(new Credentials(Platform.THREADS, "789", "secret-token"), "text", null))
            .isInstanceOf(MetaClient.Failure.class).hasMessageContaining("HTTP 400")
            .hasMessageNotContaining("secret-token").hasMessageNotContaining("private-email");
        reset(http);
        when(http.send(any(HttpRequest.class), org.mockito.ArgumentMatchers.<HttpResponse.BodyHandler<String>>any()))
            .thenThrow(new HttpTimeoutException("https://graph.threads.com?access_token=secret-token"));
        assertThatThrownBy(() -> client.createContainer(new Credentials(Platform.THREADS, "789", "secret-token"), "text", null))
            .isInstanceOf(MetaClient.Failure.class).hasMessageNotContaining("secret-token").hasMessageNotContaining("https://");
        requests(1); // No automatic retry after an uncertain publishing operation.
    }

    @Test
    void replyContainerUsesPublishedParentIdAndFormEncoding() throws Exception {
        replies("{\"id\":\"101\"}");
        assertThat(client.createReplyContainer(new Credentials(Platform.THREADS, "789", "token&safe"), "둘째 편 & 🌙", "200")).isEqualTo("101");
        var request = requests(1).getFirst();
        assertThat(request.uri().toString()).isEqualTo("https://graph.threads.com/v1.0/789/threads");
        assertThat(form(body(request))).containsEntry("reply_to_id", "200").containsEntry("text", "둘째 편 & 🌙")
            .containsEntry("media_type", "TEXT").containsEntry("access_token", "token&safe");
    }

    @Test
    void replyPreflightUsesSameAppTokenAndChecksAllRequiredGrantsAndAccount() throws Exception {
        String valid = "{\"data\":{\"is_valid\":true,\"type\":\"USER\",\"user_id\":\"789\",\"scopes\":[\"threads_basic\",\"threads_content_publish\",\"threads_manage_replies\"]}}";
        replies(valid);
        client.requireReplyPermission(new Credentials(Platform.THREADS, "789", "user+token"));
        var request = requests(1).getFirst();
        assertThat(request.method()).isEqualTo("GET");
        assertThat(request.uri().getHost()).isEqualTo("graph.threads.com");
        assertThat(request.uri().getPath()).isEqualTo("/v1.0/debug_token");
        assertThat(form(request.uri().getRawQuery())).containsEntry("access_token", "TH|222|th-secret")
            .containsEntry("input_token", "user+token");
        for (String invalid : java.util.List.of(valid.replace("true", "false"), valid.replace("789", "999"),
                valid.replace("USER", "APP"), valid.replace("threads_manage_replies", "other_permission"), "{}")) {
            reset(http);
            replies(invalid);
            assertThatThrownBy(() -> client.requireReplyPermission(new Credentials(Platform.THREADS, "789", "user+token")))
                .isInstanceOf(MetaClient.Failure.class).hasMessageContaining("Reconnect")
                .hasMessageNotContaining("user+token").hasMessageNotContaining("th-secret");
            requests(1);
        }
    }
    private void replies(String... bodies) throws Exception {
        var responses = Arrays.stream(bodies).map(body -> response(200, body)).toList();
        var stubbing = when(http.send(any(HttpRequest.class), org.mockito.ArgumentMatchers.<HttpResponse.BodyHandler<String>>any()));
        for (var response : responses) stubbing = stubbing.thenReturn(response);
    }
    @SuppressWarnings("unchecked")
    private HttpResponse<String> response(int status, String body) {
        HttpResponse<String> response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(status); when(response.body()).thenReturn(body);
        return response;
    }
    private java.util.List<HttpRequest> requests(int count) throws Exception {
        var captor = ArgumentCaptor.forClass(HttpRequest.class);
        verify(http, times(count)).send(captor.capture(), org.mockito.ArgumentMatchers.<HttpResponse.BodyHandler<String>>any());
        return captor.getAllValues();
    }
    private static Map<String, String> form(String body) {
        return Arrays.stream(body.split("&")).map(pair -> pair.split("=", 2)).collect(Collectors.toMap(
            pair -> URLDecoder.decode(pair[0], StandardCharsets.UTF_8),
            pair -> URLDecoder.decode(pair[1], StandardCharsets.UTF_8)));
    }
    private static String body(HttpRequest request) {
        var result = new CompletableFuture<String>();
        var bytes = new ByteArrayOutputStream();
        request.bodyPublisher().orElseThrow().subscribe(new Flow.Subscriber<ByteBuffer>() {
            public void onSubscribe(Flow.Subscription subscription) { subscription.request(Long.MAX_VALUE); }
            public void onNext(ByteBuffer buffer) { byte[] item = new byte[buffer.remaining()]; buffer.get(item); bytes.writeBytes(item); }
            public void onError(Throwable error) { result.completeExceptionally(error); }
            public void onComplete() { result.complete(bytes.toString(StandardCharsets.UTF_8)); }
        });
        return result.join();
    }
}
