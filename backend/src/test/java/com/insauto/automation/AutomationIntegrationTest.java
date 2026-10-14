package com.insauto.automation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:insauto-test;DB_CLOSE_DELAY=-1",
    "insauto.api-key=test-key",
    "insauto.scheduler.enabled=false"
})
@AutoConfigureMockMvc
class AutomationIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired PostRepository posts;
    @Autowired ActivityRepository activities;
    @Autowired PostService service;
    @Autowired JdbcTemplate jdbc;

    @BeforeEach
    void cleanDatabase() {
        activities.deleteAll();
        posts.deleteAll();
    }

    @Test
    void publicHealthAndOpenApiButPrivateDataRequiresEitherSupportedAuthentication() throws Exception {
        mvc.perform(get("/api/v1/health")).andExpect(status().isOk()).andExpect(jsonPath("$.mode").value("EXPLICIT_LIVE_PUBLISH"));
        mvc.perform(get("/openapi.yaml")).andExpect(status().isOk());
        for (String path : List.of("/posts", "/channels", "/activity")) {
            mvc.perform(get("/api/v1" + path)).andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith("application/problem+json"))
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        }
        mvc.perform(get("/api/v1/posts").header("X-API-Key", "wrong-key")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/posts").header("Authorization", "Bearer wrong-key")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/posts").header("Authorization", "Bearer test-key")).andExpect(status().isOk());
        mvc.perform(get("/api/v1/channels").header("X-API-Key", "test-key")).andExpect(status().isOk())
            .andExpect(jsonPath("$[0].connected").value(false));
        mvc.perform(post("/api/v1/posts").contentType(MediaType.APPLICATION_JSON)
            .content("{\"platform\":\"THREADS\",\"text\":\"unauthorized\"}"))
            .andExpect(status().isUnauthorized());
        assertThat(posts.count()).isZero();
    }

    @Test
    void draftScheduleCancelAndSimulationPersistWithCorrectActivity() throws Exception {
        String id = create("THREADS", "A test draft", null);
        mvc.perform(get("/api/v1/posts").header("X-API-Key", "test-key"))
            .andExpect(jsonPath("$[0].status").value("DRAFT"))
            .andExpect(jsonPath("$[0].mediaUrl").isEmpty());
        Instant future = Instant.now().plusSeconds(3600);
        schedule(id, future).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("SCHEDULED"));
        mvc.perform(post("/api/v1/posts/{id}/dry-run", id).header("X-API-Key", "test-key"))
            .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("INVALID_POST_STATE"));
        mvc.perform(post("/api/v1/posts/{id}/cancel-schedule", id).header("X-API-Key", "test-key"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("DRAFT"))
            .andExpect(jsonPath("$.scheduledAt").isEmpty());
        mvc.perform(post("/api/v1/posts/{id}/dry-run", id).header("Authorization", "Bearer test-key"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("SIMULATED"));
        mvc.perform(get("/api/v1/activity").header("X-API-Key", "test-key"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(4))
            .andExpect(jsonPath("$[0].type").value("DRY_RUN_COMPLETED"));
        assertThat(jdbc.queryForObject("select status from posts where id = ?", String.class, UUID.fromString(id))).isEqualTo("SIMULATED");
        assertThat(activities.countByPostIdAndType(UUID.fromString(id), ActivityType.DRY_RUN_COMPLETED)).isEqualTo(1);
    }

    @Test
    void repeatedSimulationOrSchedulingCannotMutateTerminalPost() throws Exception {
        String id = create("THREADS", "One execution", null);
        mvc.perform(post("/api/v1/posts/{id}/dry-run", id).header("X-API-Key", "test-key")).andExpect(status().isOk());
        mvc.perform(post("/api/v1/posts/{id}/dry-run", id).header("X-API-Key", "test-key")).andExpect(status().isConflict());
        schedule(id, Instant.now().plusSeconds(600)).andExpect(status().isConflict());
        mvc.perform(post("/api/v1/posts/{id}/cancel-schedule", id).header("X-API-Key", "test-key")).andExpect(status().isConflict());
        assertThat(activities.countByPostIdAndType(UUID.fromString(id), ActivityType.DRY_RUN_COMPLETED)).isEqualTo(1);
    }

    @Test
    void instagramCanSaveWithoutImageButCannotScheduleOrSimulateUntilImagePresent() throws Exception {
        String id = create("INSTAGRAM", "An image draft", null);
        mvc.perform(post("/api/v1/posts/{id}/dry-run", id).header("X-API-Key", "test-key"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("MEDIA_REQUIRED"));
        schedule(id, Instant.now().plusSeconds(600)).andExpect(status().isBadRequest());
        String withImage = create("INSTAGRAM", "An image draft", "https://images.example.com/photo.jpg");
        mvc.perform(post("/api/v1/posts/{id}/dry-run", withImage).header("X-API-Key", "test-key"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("SIMULATED"));
    }

    @Test
    void validatesTextIncludingUnicodeCodePointsAndRequiredFields() throws Exception {
        create("THREADS", "😀".repeat(500), null);
        create("INSTAGRAM", "a".repeat(2200), null);
        for (Map<String, Object> payload : List.of(
            Map.<String, Object>of("platform", "THREADS", "text", "a".repeat(501)),
            Map.<String, Object>of("platform", "INSTAGRAM", "text", "a".repeat(2201)),
            Map.<String, Object>of("platform", "THREADS", "text", "   "),
            Map.<String, Object>of("text", "No platform"),
            Map.<String, Object>of("platform", "FACEBOOK", "text", "Unsupported"))) {
            mvc.perform(post("/api/v1/posts").header("X-API-Key", "test-key").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(payload))).andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith("application/problem+json"));
        }
        assertThat(posts.count()).isEqualTo(2);
    }

    @Test
    void rejectsUnsafeMediaUrlSyntaxWithoutFetchingAnything() throws Exception {
        for (String url : List.of("http://example.com/x.jpg", "https://127.0.0.1/x.jpg", "https://localhost/x.jpg",
            "https://10.0.0.1/x.jpg", "https://[::1]/x.jpg", "https://a.local/x.jpg", "https://user:pass@example.com/x.jpg",
            "https://example.com:8080/x.jpg", "file:///etc/passwd", "not-a-url")) {
            mvc.perform(post("/api/v1/posts").header("X-API-Key", "test-key").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("platform", "THREADS", "text", "Test", "mediaUrl", url))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_MEDIA_URL"));
        }
        assertThat(posts.count()).isZero();
    }

    @Test
    void pastOrInvalidScheduleAndUnknownIdReturnStructuredErrors() throws Exception {
        String id = create("THREADS", "Schedule validation", null);
        schedule(id, Instant.now().minusSeconds(10)).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("SCHEDULE_IN_PAST"));
        mvc.perform(post("/api/v1/posts/{id}/schedule", id).header("X-API-Key", "test-key")
            .contentType(MediaType.APPLICATION_JSON).content("{\"scheduledAt\":\"2030-01-01T09:00:00\"}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        mvc.perform(post("/api/v1/posts/{id}/dry-run", UUID.randomUUID()).header("X-API-Key", "test-key"))
            .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("POST_NOT_FOUND"));
        mvc.perform(post("/api/v1/posts/not-a-uuid/dry-run").header("X-API-Key", "test-key"))
            .andExpect(status().isBadRequest());
        assertThat(posts.findById(UUID.fromString(id)).orElseThrow().status).isEqualTo(PostStatus.DRAFT);
    }

    @Test
    void unknownRoutesAndUnsupportedMethodsHaveProblemDetails() throws Exception {
        mvc.perform(get("/api/v1/missing").header("X-API-Key", "test-key"))
            .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("HTTP_404"));
        mvc.perform(delete("/api/v1/posts").header("X-API-Key", "test-key"))
            .andExpect(status().isMethodNotAllowed()).andExpect(jsonPath("$.code").value("HTTP_405"));
    }

    @Test
    void dueSchedulerProcessesOnlyDuePostsAndRepeatingItDoesNotDuplicateActivity() throws Exception {
        Instant now = Instant.now();
        UUID due = UUID.fromString(create("THREADS", "Due", null));
        UUID later = UUID.fromString(create("THREADS", "Later", null));
        schedule(due.toString(), now.plusSeconds(60)).andExpect(status().isOk());
        schedule(later.toString(), now.plusSeconds(3600)).andExpect(status().isOk());
        DuePostScheduler scheduler = new DuePostScheduler(posts, service, Clock.fixed(now.plusSeconds(120), ZoneOffset.UTC));
        scheduler.runDuePosts();
        scheduler.runDuePosts();
        assertThat(posts.findById(due).orElseThrow().status).isEqualTo(PostStatus.SIMULATED);
        assertThat(posts.findById(later).orElseThrow().status).isEqualTo(PostStatus.SCHEDULED);
        assertThat(activities.countByPostIdAndType(due, ActivityType.DRY_RUN_COMPLETED)).isEqualTo(1);
    }

    @Test
    void concurrentWorkersSimulateTheSameScheduledPostExactlyOnce() throws Exception {
        UUID id = UUID.fromString(create("THREADS", "Concurrent execution", null));
        Instant due = Instant.now().plusSeconds(60);
        schedule(id.toString(), due).andExpect(status().isOk());
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> { start.await(); service.simulateIfDue(id, due.plusSeconds(1)); return null; });
            var second = executor.submit(() -> { start.await(); service.simulateIfDue(id, due.plusSeconds(1)); return null; });
            start.countDown();
            first.get();
            second.get();
        }
        assertThat(posts.findById(id).orElseThrow().status).isEqualTo(PostStatus.SIMULATED);
        assertThat(activities.countByPostIdAndType(id, ActivityType.DRY_RUN_COMPLETED)).isEqualTo(1);
    }

    @Test
    void draftUpdateAddsInstagramMediaAndValidatesBeforePersisting() throws Exception {
        String id = create("INSTAGRAM", "Original text", null);
        for (Map<String, Object> payload : List.of(
            Map.<String, Object>of("text", "x".repeat(2201)),
            Map.<String, Object>of("text", "Must not be saved", "mediaUrl", "http://example.com/image.jpg"))) {
            mvc.perform(patch("/api/v1/posts/{id}", id).header("X-API-Key", "test-key")
                .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(payload)))
                .andExpect(status().isBadRequest());
        }
        assertThat(posts.findById(UUID.fromString(id)).orElseThrow().text).isEqualTo("Original text");
        assertThat(activities.countByPostIdAndType(UUID.fromString(id), ActivityType.DRAFT_UPDATED)).isZero();
        mvc.perform(patch("/api/v1/posts/{id}", id).header("X-API-Key", "test-key")
            .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(Map.of(
                "text", "Image added", "mediaUrl", "https://example.com/image.jpg", "platform", "THREADS"))))
            .andExpect(status().isOk()).andExpect(jsonPath("$.platform").value("INSTAGRAM"))
            .andExpect(jsonPath("$.mediaUrl").value("https://example.com/image.jpg"));
        mvc.perform(patch("/api/v1/posts/{id}", id).header("X-API-Key", "test-key")
            .contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"Cleared image\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.mediaUrl").isEmpty());
        mvc.perform(patch("/api/v1/posts/{id}", id).header("X-API-Key", "test-key")
            .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(Map.of(
                "text", "Ready to schedule", "mediaUrl", "https://example.com/image.jpg"))))
            .andExpect(status().isOk());
        schedule(id, Instant.now().plusSeconds(3600)).andExpect(status().isOk());
        mvc.perform(patch("/api/v1/posts/{id}", id).header("X-API-Key", "test-key")
            .contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"Too late\"}"))
            .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("INVALID_POST_STATE"));
        assertThat(posts.findById(UUID.fromString(id)).orElseThrow().text).isEqualTo("Ready to schedule");
        assertThat(activities.countByPostIdAndType(UUID.fromString(id), ActivityType.DRAFT_UPDATED)).isEqualTo(3);
    }

    private String create(String platform, String text, String mediaUrl) throws Exception {
        var body = new java.util.HashMap<String, Object>();
        body.put("platform", platform);
        body.put("text", text);
        if (mediaUrl != null) body.put("mediaUrl", mediaUrl);
        String response = mvc.perform(post("/api/v1/posts").header("X-API-Key", "test-key")
            .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body)))
            .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        JsonNode json = mapper.readTree(response);
        return json.path("id").asText();
    }

    private org.springframework.test.web.servlet.ResultActions schedule(String id, Instant time) throws Exception {
        return mvc.perform(post("/api/v1/posts/{id}/schedule", id).header("X-API-Key", "test-key")
            .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(Map.of("scheduledAt", time))));
    }
}
