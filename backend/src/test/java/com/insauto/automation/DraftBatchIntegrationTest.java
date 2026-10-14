package com.insauto.automation;

import com.fasterxml.jackson.databind.ObjectMapper;
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
import org.springframework.test.web.servlet.MockMvc;
import static com.insauto.automation.ApiModels.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"spring.datasource.url=jdbc:h2:mem:batch-test;DB_CLOSE_DELAY=-1", "insauto.api-key=test-key", "insauto.scheduler.enabled=false"})
@AutoConfigureMockMvc
class DraftBatchIntegrationTest {
    @Autowired DraftBatchService batches;
    @Autowired PostService drafts;
    @Autowired PostRepository posts;
    @Autowired DraftBatchRepository records;
    @Autowired ActivityRepository activities;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    static final List<String> SERIES = List.of("늦게 피는 사주 특징 (1/4)", "창고를 채우는 시간 (2/4)", "비교보다 나의 속도 (3/4)", "지금까지 버틴 마음 (4/4)");

    @BeforeEach void clean() { activities.deleteAll(); posts.deleteAll(); records.deleteAll(); }
    CreatePost series() { return new CreatePost(Platform.THREADS, SERIES.getFirst(), null, SERIES); }

    @Test void savesOrderedSeriesAtomicallyAndReplayReturnsTheSameIds() {
        CreateBatch request = new CreateBatch(UUID.randomUUID(), List.of(series(), new CreatePost(Platform.INSTAGRAM, String.join("\n\n", SERIES), null)));
        BatchView first = batches.create(request), replay = batches.create(request);
        assertThat(first.posts()).hasSize(2);
        assertThat(first.posts().getFirst().segments()).containsExactlyElementsOf(SERIES);
        assertThat(first.posts().get(1).segments()).isEmpty();
        assertThat(replay.posts().stream().map(PostView::id)).containsExactlyElementsOf(first.posts().stream().map(PostView::id).toList());
        assertThat(posts.count()).isEqualTo(2);
        assertThat(activities.count()).isEqualTo(2);
        assertThat(records.count()).isEqualTo(1);
    }

    @Test void sameKeyWithChangedContentConflictsWithoutAddingAnything() {
        UUID id = UUID.randomUUID();
        batches.create(new CreateBatch(id, List.of(series())));
        assertThatThrownBy(() -> batches.create(new CreateBatch(id, List.of(new CreatePost(Platform.THREADS, "Different", null)))))
            .isInstanceOf(ApiException.class).extracting(e -> ((ApiException)e).code).isEqualTo("BATCH_KEY_REUSED");
        assertThat(posts.count()).isEqualTo(1);
    }

    @Test void laterInvalidItemRollsBackEarlierDraftsActivitiesAndBatchKey() {
        UUID id = UUID.randomUUID();
        assertThatThrownBy(() -> batches.create(new CreateBatch(id, List.of(series(), new CreatePost(Platform.THREADS, "가".repeat(501), null)))))
            .isInstanceOf(ApiException.class);
        assertThat(posts.count()).isZero(); assertThat(activities.count()).isZero(); assertThat(records.count()).isZero();
        assertThat(batches.create(new CreateBatch(id, List.of(series()))).posts()).hasSize(1);
    }

    @Test void concurrentSameRequestCreatesOneBatch() throws Exception {
        CreateBatch request = new CreateBatch(UUID.randomUUID(), List.of(series(), series()));
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> { start.await(); return batches.create(request); });
            var second = executor.submit(() -> { start.await(); return batches.create(request); });
            start.countDown();
            assertThat(first.get().posts().stream().map(PostView::id)).containsExactlyElementsOf(second.get().posts().stream().map(PostView::id).toList());
        }
        assertThat(posts.count()).isEqualTo(2); assertThat(records.count()).isEqualTo(1);
    }

    @Test void segmentReplacementIsValidatedAndOmissionPreservesTheRemainingParts() {
        PostView saved = drafts.create(series());
        PostView updated = drafts.update(saved.id(), new UpdatePost("수정된 첫 편 (1/4)", null));
        assertThat(updated.segments()).containsExactly("수정된 첫 편 (1/4)", SERIES.get(1), SERIES.get(2), SERIES.get(3));
        assertThat(updated.updatedAt()).isAfter(saved.updatedAt());
        List<String> changed = List.of("수정된 첫 편 (1/4)", "수정된 둘째 편 (2/4)", SERIES.get(2), SERIES.get(3));
        assertThat(drafts.update(saved.id(), new UpdatePost(changed.getFirst(), null, changed)).segments()).containsExactlyElementsOf(changed);
        assertThatThrownBy(() -> drafts.update(saved.id(), new UpdatePost("mismatch", null, SERIES))).isInstanceOf(ApiException.class);
        assertThat(drafts.list().getFirst().segments()).containsExactlyElementsOf(changed);
    }

    @Test void apiProtectsBatchAndRejectsOversizedBatchAndInvalidSeries() throws Exception {
        mvc.perform(post("/api/v1/posts/batch").contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isUnauthorized());
        for (Object request : List.of(
            Map.of("requestId", UUID.randomUUID(), "posts", List.of()),
            Map.of("requestId", UUID.randomUUID(), "posts", java.util.Collections.nCopies(13, series())),
            Map.of("posts", List.of(series())))) {
            mvc.perform(post("/api/v1/posts/batch").header("X-API-Key", "test-key").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(request))).andExpect(status().isBadRequest());
        }
        for (CreatePost request : List.of(
            new CreatePost(Platform.THREADS, "mismatch", null, SERIES),
            new CreatePost(Platform.THREADS, "one", null, List.of("one", "two")),
            new CreatePost(Platform.INSTAGRAM, SERIES.getFirst(), null, SERIES),
            new CreatePost(Platform.THREADS, SERIES.getFirst(), null, List.of(SERIES.getFirst(), " ", "3", "4")),
            new CreatePost(Platform.THREADS, SERIES.getFirst(), null, List.of(SERIES.getFirst(), "😀".repeat(501), "3", "4")))) {
            mvc.perform(post("/api/v1/posts").header("X-API-Key", "test-key").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(request))).andExpect(status().isBadRequest());
        }
        assertThat(posts.count()).isZero();
        mvc.perform(post("/api/v1/posts/batch").header("X-API-Key", "test-key").contentType(MediaType.APPLICATION_JSON)
            .content(mapper.writeValueAsString(new CreateBatch(UUID.randomUUID(), List.of(series())))))
            .andExpect(status().isCreated()).andExpect(jsonPath("$.posts[0].segments.length()").value(4))
            .andExpect(jsonPath("$.posts[0].publishedIds.length()").value(0));
    }
}
