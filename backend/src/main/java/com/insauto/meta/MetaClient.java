package com.insauto.meta;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.insauto.automation.Platform;
import com.insauto.meta.ConnectionModels.Credentials;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/** All network destinations are fixed Meta endpoints. Never log requests or provider response bodies. */
@Component
public class MetaClient {
    private final ObjectMapper mapper;
    private final MetaSettings settings;
    private final HttpClient http;

    @Autowired
    public MetaClient(ObjectMapper mapper, MetaSettings settings) {
        this(mapper, settings, HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8))
            .followRedirects(HttpClient.Redirect.NEVER).build());
    }
    MetaClient(ObjectMapper mapper, MetaSettings settings, HttpClient http) {
        this.mapper = mapper; this.settings = settings; this.http = http;
    }

    static final class AccountToken {
        final String accountId, username, token;
        final long expiresIn;
        AccountToken(String accountId, String username, String token, long expiresIn) {
            this.accountId = accountId; this.username = username; this.token = token; this.expiresIn = expiresIn;
        }
        @Override public String toString() { return "AccountToken[redacted]"; }
    }
    public static final class Failure extends RuntimeException {
        public Failure(String message) { super(message); }
    }

    AccountToken exchange(Platform p, String code) {
        String tokenUrl = p == Platform.INSTAGRAM ? "https://api.instagram.com/oauth/access_token" : "https://graph.threads.com/oauth/access_token";
        JsonNode shortResponse = single(send("POST", tokenUrl, Map.of("client_id", settings.appId(p),
            "client_secret", settings.secret(p), "grant_type", "authorization_code", "redirect_uri", settings.callback(p), "code", code), null, false));
        String shortToken = required(shortResponse, "access_token");
        String graph = p == Platform.INSTAGRAM ? "https://graph.instagram.com" : "https://graph.threads.com";
        JsonNode longResponse = send("GET", graph + "/access_token", Map.of("grant_type", p == Platform.INSTAGRAM ? "ig_exchange_token" : "th_exchange_token",
            "client_secret", settings.secret(p), "access_token", shortToken), null, false);
        String token = required(longResponse, "access_token");
        long expires = longResponse.path("expires_in").asLong(0);
        if (expires < 1 || expires > 366L * 86400) throw new Failure("Meta did not return a valid token expiration. Reconnect the account.");
        Credentials temporary = new Credentials(p, "me", token);
        JsonNode identity = single(graph(temporary, "GET", "/me", Map.of("fields", p == Platform.INSTAGRAM ? "user_id,username" : "id,username")));
        String accountId = id(required(identity, p == Platform.INSTAGRAM ? "user_id" : "id"));
        String username = required(identity, "username");
        if (username.length() > 200) throw new Failure("Meta returned an invalid account identity.");
        return new AccountToken(accountId, username, token, expires);
    }

    public String createContainer(Credentials credentials, String text, String mediaUrl) {
        Map<String, String> fields = new LinkedHashMap<>();
        if (credentials.platform() == Platform.INSTAGRAM) {
            fields.put("caption", text); fields.put("image_url", mediaUrl);
        } else {
            fields.put("media_type", mediaUrl == null ? "TEXT" : "IMAGE"); fields.put("text", text);
            if (mediaUrl != null) fields.put("image_url", mediaUrl);
        }
        String path = "/" + id(credentials.accountId()) + (credentials.platform() == Platform.INSTAGRAM ? "/media" : "/threads");
        return id(required(graph(credentials, "POST", path, fields), "id"));
    }

    /** Check reply grants before exposing the root of a four-part series. */
    public void requireReplyPermission(Credentials credentials) {
        if (credentials.platform() != Platform.THREADS || settings.appId(Platform.THREADS).isBlank()
            || settings.secret(Platform.THREADS).isBlank()) throw new Failure("Threads reply permission could not be verified. Reconnect the account.");
        String appToken = "TH|" + settings.appId(Platform.THREADS) + "|" + settings.secret(Platform.THREADS);
        JsonNode data = send("GET", "https://graph.threads.com/v1.0/debug_token",
            Map.of("access_token", appToken, "input_token", credentials.token()), null, false).path("data");
        var scopes = new java.util.HashSet<String>();
        if (data.path("scopes").isArray()) data.path("scopes").forEach(scope -> scopes.add(scope.asText()));
        if (!data.path("is_valid").asBoolean(false) || !"USER".equals(data.path("type").asText())
            || !credentials.accountId().equals(data.path("user_id").asText())
            || !scopes.containsAll(java.util.Set.of("threads_basic", "threads_content_publish", "threads_manage_replies")))
            throw new Failure("Threads reply permission could not be verified. Reconnect the account.");
    }
    /** Replies attach to the previous confirmed post, never to a creation container. */
    public String createReplyContainer(Credentials credentials, String text, String replyToId) {
        if (credentials.platform() != Platform.THREADS) throw new Failure("Only Threads supports this reply series.");
        return id(required(graph(credentials, "POST", "/" + id(credentials.accountId()) + "/threads",
            Map.of("media_type", "TEXT", "text", text, "reply_to_id", id(replyToId))), "id"));
    }
    public String containerStatus(Credentials credentials, String containerId) {
        boolean instagram = credentials.platform() == Platform.INSTAGRAM;
        JsonNode response = graph(credentials, "GET", "/" + id(containerId), Map.of("fields", instagram ? "status_code" : "status"));
        return required(response, instagram ? "status_code" : "status");
    }

    public String publishContainer(Credentials credentials, String containerId) {
        String path = "/" + id(credentials.accountId()) + (credentials.platform() == Platform.INSTAGRAM ? "/media_publish" : "/threads_publish");
        return id(required(graph(credentials, "POST", path, Map.of("creation_id", id(containerId))), "id"));
    }

    public String permalink(Credentials credentials, String publishedId) {
        String value = required(graph(credentials, "GET", "/" + id(publishedId), Map.of("fields", "permalink")), "permalink");
        try {
            URI uri = URI.create(value);
            String host = uri.getHost();
            if (!"https".equals(uri.getScheme()) || uri.getUserInfo() != null || host == null || value.length() > 2048
                || !(host.equals("instagram.com") || host.endsWith(".instagram.com") || host.equals("threads.com")
                || host.endsWith(".threads.com") || host.equals("threads.net") || host.endsWith(".threads.net"))) throw new IllegalArgumentException();
            return value;
        } catch (IllegalArgumentException e) { throw new Failure("Meta returned an invalid post link."); }
    }

    private JsonNode graph(Credentials credentials, String method, String path, Map<String, String> params) {
        boolean instagram = credentials.platform() == Platform.INSTAGRAM;
        String base = instagram ? "https://graph.instagram.com/" + settings.instagramVersion : "https://graph.threads.com/v1.0";
        Map<String, String> fields = new LinkedHashMap<>(params);
        if (!instagram) fields.put("access_token", credentials.token());
        return send(method, base + path, fields, instagram ? credentials.token() : null, instagram && method.equals("POST"));
    }

    private JsonNode send(String method, String url, Map<String, String> fields, String bearer, boolean json) {
        try {
            HttpRequest.Builder request = HttpRequest.newBuilder().timeout(Duration.ofSeconds(10)).header("Accept", "application/json");
            if (method.equals("GET")) request.uri(URI.create(url + "?" + form(fields))).GET();
            else request.uri(URI.create(url)).header("Content-Type", json ? "application/json" : "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(json ? mapper.writeValueAsString(fields) : form(fields)));
            if (bearer != null) request.header("Authorization", "Bearer " + bearer);
            HttpResponse<String> response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300)
                throw new Failure("Meta rejected the request (HTTP " + response.statusCode() + "). Check account permissions, token expiry and media requirements.");
            if (response.body().length() > 1_000_000) throw new Failure("Meta response was too large.");
            JsonNode result = mapper.readTree(response.body());
            if (result == null || result.has("error")) throw new Failure("Meta could not complete this request. Check account permissions and reconnect if needed.");
            return result;
        } catch (Failure e) { throw e; }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new Failure("Meta request was interrupted. Check the post status before taking further action."); }
        catch (Exception e) { throw new Failure("Meta response was unavailable. Check the post status before taking further action."); }
    }

    static String form(Map<String, String> values) {
        return values.entrySet().stream().map(e -> encode(e.getKey()) + "=" + encode(e.getValue())).collect(Collectors.joining("&"));
    }
    private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
    private static JsonNode single(JsonNode node) {
        if (!node.has("data")) return node;
        JsonNode data = node.get("data");
        if (!data.isArray() || data.size() != 1) throw new Failure("Meta returned an unexpected account response.");
        return data.get(0);
    }
    private static String required(JsonNode node, String field) {
        String value = node.path(field).asText("");
        if (value.isBlank() || value.length() > 4096) throw new Failure("Meta returned an incomplete response.");
        return value;
    }
    private static String id(String value) {
        if (value == null || !value.matches("[0-9]{1,100}")) throw new Failure("Meta returned an invalid identifier.");
        return value;
    }
}
