package com.insauto.automation;

import com.insauto.meta.ConnectionModels.Credentials;
import com.insauto.meta.ConnectionService;
import com.insauto.meta.MetaClient;
import java.time.Instant;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import static com.insauto.automation.ApiModels.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@SpringBootTest(properties = {"spring.datasource.url=jdbc:h2:mem:live-test;DB_CLOSE_DELAY=-1", "insauto.scheduler.enabled=false"})
class LivePublishIntegrationTest {
    @Autowired PostService drafts;
    @Autowired LivePublishService publisher;
    @Autowired PostRepository posts;
    @Autowired ActivityRepository activities;
    @MockitoBean ConnectionService connections;
    @MockitoBean MetaClient meta;
    @MockitoBean java.time.Clock clock;
    Credentials credentials;

    @BeforeEach void setup() {
        when(clock.instant()).thenReturn(Instant.parse("2026-10-14T00:00:00Z"));
        activities.deleteAll(); posts.deleteAll();
        credentials = mock(Credentials.class);
        when(credentials.platform()).thenReturn(Platform.THREADS);
        when(credentials.accountId()).thenReturn("12345");
        when(connections.credentials(any(), eq("12345"))).thenReturn(credentials);
        when(meta.createContainer(any(), anyString(), any())).thenReturn("100");
        when(meta.containerStatus(any(), anyString())).thenReturn("FINISHED");
        when(meta.publishContainer(any(), anyString())).thenReturn("200");
        when(meta.permalink(any(), anyString())).thenReturn("https://www.threads.com/@tester/post/abc");
    }
    PostView draft(Platform platform, String media) { return drafts.create(new CreatePost(platform, "오늘의 사주 운세 테스트", media)); }
    PublishPost approval(PostView post) { return new PublishPost("12345", post.updatedAt()); }

    @Test void verifiedReceiptPersistsAndRepeatDoesNotPublishTwice() {
        PostView post = draft(Platform.THREADS, null);
        PostView published = publisher.publish(post.id(), approval(post));
        assertThat(published.status()).isEqualTo(PostStatus.PUBLISHED);
        assertThat(published.publishedId()).isEqualTo("200");
        assertThat(published.publishedAccountId()).isEqualTo("12345");
        assertThat(published.permalink()).startsWith("https://www.threads.com/");
        assertThat(publisher.publish(post.id(), approval(post)).publishedId()).isEqualTo("200");
        verify(meta, times(1)).createContainer(any(), anyString(), any());
        verify(meta, times(1)).publishContainer(any(), eq("100"));
        assertThat(activities.countByPostIdAndType(post.id(), ActivityType.PUBLISH_CONFIRMED)).isEqualTo(1);
    }

    @Test void changedDraftMissingMediaAndDisconnectedAccountNeverReachMeta() {
        PostView post = draft(Platform.THREADS, null);
        drafts.update(post.id(), new UpdatePost("Changed content", null));
        assertThatThrownBy(() -> publisher.publish(post.id(), approval(post))).isInstanceOf(ApiException.class)
            .extracting(e -> ((ApiException)e).code).isEqualTo("POST_CHANGED");
        PostView instagram = draft(Platform.INSTAGRAM, null);
        assertThatThrownBy(() -> publisher.publish(instagram.id(), approval(instagram))).isInstanceOf(ApiException.class)
            .extracting(e -> ((ApiException)e).code).isEqualTo("MEDIA_REQUIRED");
        PostView disconnected = draft(Platform.THREADS, null);
        when(connections.credentials(any(), anyString())).thenThrow(new ApiException(org.springframework.http.HttpStatus.CONFLICT, "ACCOUNT_CHANGED", "Reconnect"));
        assertThatThrownBy(() -> publisher.publish(disconnected.id(), approval(disconnected))).isInstanceOf(ApiException.class);
        assertThat(posts.findById(disconnected.id()).orElseThrow().status).isEqualTo(PostStatus.DRAFT);
        verifyNoInteractions(meta);
    }

    @Test void failedPreparationNeverSendsPublishRequestAndIsNotAutomaticallyRetried() {
        PostView post = draft(Platform.THREADS, null);
        when(meta.containerStatus(any(), anyString())).thenReturn("ERROR");
        assertThat(publisher.publish(post.id(), approval(post)).status()).isEqualTo(PostStatus.PUBLISH_FAILED);
        assertThatThrownBy(() -> publisher.publish(post.id(), approval(post))).isInstanceOf(ApiException.class);
        verify(meta, never()).publishContainer(any(), anyString());
        verify(meta, times(1)).createContainer(any(), anyString(), any());
    }

    @Test void lostPublicationResponseIsUnknownAndNeverRetried() {
        PostView post = draft(Platform.THREADS, null);
        when(meta.publishContainer(any(), anyString())).thenThrow(new MetaClient.Failure("timeout"));
        PostView result = publisher.publish(post.id(), approval(post));
        assertThat(result.status()).isEqualTo(PostStatus.PUBLISH_UNKNOWN);
        assertThat(result.publishedId()).isNull();
        assertThat(result.publishError()).contains("이미 게시되었을 수");
        assertThatThrownBy(() -> publisher.publish(post.id(), approval(post))).isInstanceOf(ApiException.class);
        verify(meta, times(1)).publishContainer(any(), anyString());
    }

    @Test void permalinkFailureDoesNotEraseConfirmedPublication() {
        PostView post = draft(Platform.THREADS, null);
        when(meta.permalink(any(), anyString())).thenThrow(new MetaClient.Failure("optional lookup failed"));
        PostView result = publisher.publish(post.id(), approval(post));
        assertThat(result.status()).isEqualTo(PostStatus.PUBLISHED);
        assertThat(result.publishedId()).isEqualTo("200");
        assertThat(result.permalink()).isNull();
    }

    @Test void persistedClaimBlocksConcurrentPublishBeforeFirstNetworkRequestCompletes() throws Exception {
        PostView post = draft(Platform.THREADS, null);
        CountDownLatch started = new CountDownLatch(1), release = new CountDownLatch(1);
        when(meta.createContainer(any(), anyString(), any())).thenAnswer(invocation -> {
            started.countDown();
            if (!release.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("test timed out");
            return "100";
        });
        try (var executor = Executors.newSingleThreadExecutor()) {
            var first = executor.submit(() -> publisher.publish(post.id(), approval(post)));
            try {
                assertThat(started.await(10, TimeUnit.SECONDS)).isTrue();
                assertThat(posts.findById(post.id()).orElseThrow().status).isEqualTo(PostStatus.PUBLISHING);
                assertThatThrownBy(() -> publisher.publish(post.id(), approval(post))).isInstanceOf(ApiException.class);
            } finally { release.countDown(); }
            assertThat(first.get(10, TimeUnit.SECONDS).status()).isEqualTo(PostStatus.PUBLISHED);
        }
        verify(meta, times(1)).publishContainer(any(), anyString());
    }

    @Test void restartMarksAnInterruptedRequestUnknownWithoutReSending() {
        PostView original = draft(Platform.THREADS, null);
        Post row = posts.findById(original.id()).orElseThrow();
        row.status = PostStatus.PUBLISHING;
        posts.saveAndFlush(row);
        publisher.recoverInterruptedPublications();
        assertThat(posts.findById(original.id()).orElseThrow().status).isEqualTo(PostStatus.PUBLISH_UNKNOWN);
        verifyNoInteractions(meta);
        assertThatThrownBy(() -> publisher.publish(original.id(), approval(original))).isInstanceOf(ApiException.class);
    }
    PostView seriesDraft() {
        var segments = java.util.List.of("사주 특징 (1/4)", "설명과 반전 (2/4)", "숨은 감정 (3/4)", "인정과 댓글 유도 (4/4)");
        return drafts.create(new CreatePost(Platform.THREADS, segments.getFirst(), null, segments));
    }

    @Test void fourPartsPublishInOrderAsRepliesToConfirmedMediaIds() {
        PostView post = seriesDraft();
        when(meta.createReplyContainer(any(), anyString(), anyString())).thenReturn("101", "102", "103");
        when(meta.publishContainer(any(), anyString())).thenReturn("200", "201", "202", "203");
        PostView result = publisher.publish(post.id(), approval(post));
        assertThat(result.status()).isEqualTo(PostStatus.PUBLISHED);
        assertThat(result.publishedId()).isEqualTo("200");
        assertThat(result.publishedIds()).containsExactly("200", "201", "202", "203");
        var ordered = inOrder(meta);
        ordered.verify(meta).createContainer(any(), eq(post.segments().get(0)), isNull());
        ordered.verify(meta).publishContainer(any(), eq("100"));
        ordered.verify(meta).createReplyContainer(any(), eq(post.segments().get(1)), eq("200"));
        ordered.verify(meta).publishContainer(any(), eq("101"));
        ordered.verify(meta).createReplyContainer(any(), eq(post.segments().get(2)), eq("201"));
        ordered.verify(meta).publishContainer(any(), eq("102"));
        ordered.verify(meta).createReplyContainer(any(), eq(post.segments().get(3)), eq("202"));
        ordered.verify(meta).publishContainer(any(), eq("103"));
        assertThat(publisher.publish(post.id(), approval(post)).publishedIds()).hasSize(4);
        verify(meta, times(4)).publishContainer(any(), anyString());
    }

    @Test void laterPreparationFailureKeepsPublishedPartsAndStopsTheSeries() {
        PostView post = seriesDraft();
        when(meta.createReplyContainer(any(), anyString(), anyString())).thenThrow(new MetaClient.Failure("reply preparation failed"));
        PostView result = publisher.publish(post.id(), approval(post));
        assertThat(result.status()).isEqualTo(PostStatus.PUBLISH_PARTIAL);
        assertThat(result.publishedIds()).containsExactly("200");
        assertThat(result.publishError()).contains("1편이 게시");
        assertThat(result.permalink()).isNotNull();
        assertThatThrownBy(() -> publisher.publish(post.id(), approval(post))).isInstanceOf(ApiException.class);
        verify(meta, times(1)).publishContainer(any(), anyString());
        verify(meta, times(1)).createReplyContainer(any(), anyString(), eq("200"));
    }

    @Test void lostReplyReceiptPreservesConfirmedRootAndNeverContinuesOrRetries() {
        PostView post = seriesDraft();
        when(meta.createReplyContainer(any(), anyString(), anyString())).thenReturn("101");
        when(meta.publishContainer(any(), anyString())).thenReturn("200").thenThrow(new MetaClient.Failure("timeout"));
        PostView result = publisher.publish(post.id(), approval(post));
        assertThat(result.status()).isEqualTo(PostStatus.PUBLISH_UNKNOWN);
        assertThat(result.publishedIds()).containsExactly("200");
        assertThat(result.publishError()).contains("확인된 게시: 1편");
        assertThatThrownBy(() -> publisher.publish(post.id(), approval(post))).isInstanceOf(ApiException.class);
        verify(meta, times(2)).publishContainer(any(), anyString());
        verify(meta, times(1)).createReplyContainer(any(), anyString(), anyString());
    }

    @Test void changedReplyInvalidatesPreviouslyReviewedSeriesEvenWhenTheFirstPartIsUnchanged() {
        PostView post = seriesDraft();
        var segments = new java.util.ArrayList<>(post.segments());
        segments.set(2, "변경된 셋째 편");
        drafts.update(post.id(), new UpdatePost(post.text(), null, segments));
        assertThatThrownBy(() -> publisher.publish(post.id(), approval(post))).isInstanceOf(ApiException.class)
            .extracting(e -> ((ApiException)e).code).isEqualTo("POST_CHANGED");
        verifyNoInteractions(meta);
    }
    @Test void missingReplyGrantStopsBeforeAnyPartIsCreatedOrPublished() {
        PostView post = seriesDraft();
        doThrow(new MetaClient.Failure("Reconnect for reply permission")).when(meta).requireReplyPermission(any());
        PostView result = publisher.publish(post.id(), approval(post));
        assertThat(result.status()).isEqualTo(PostStatus.PUBLISH_FAILED);
        assertThat(result.publishedIds()).isEmpty();
        verify(meta, never()).createContainer(any(), anyString(), any());
        verify(meta, never()).createReplyContainer(any(), anyString(), anyString());
        verify(meta, never()).publishContainer(any(), anyString());
    }
    @Test void simulatedAndScheduledPostsCannotBePublished() {
        PostView simulated = draft(Platform.THREADS, null);
        drafts.dryRun(simulated.id());
        assertThatThrownBy(() -> publisher.publish(simulated.id(), approval(simulated))).isInstanceOf(ApiException.class);
        PostView scheduled = draft(Platform.THREADS, null);
        drafts.schedule(scheduled.id(), Instant.now().plusSeconds(600));
        assertThatThrownBy(() -> publisher.publish(scheduled.id(), approval(scheduled))).isInstanceOf(ApiException.class);
        verifyNoInteractions(meta);
    }
}
