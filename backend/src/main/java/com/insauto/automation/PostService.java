package com.insauto.automation;

import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import static com.insauto.automation.ApiModels.*;

@Service
public class PostService {
    private final PostRepository posts;
    private final ActivityRepository activities;
    private final DryRunPublisher publisher;
    private final Clock clock;

    public PostService(PostRepository posts, ActivityRepository activities, DryRunPublisher publisher, Clock clock) {
        this.posts = posts;
        this.activities = activities;
        this.publisher = publisher;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<PostView> list() { return posts.findAllByOrderByCreatedAtDesc().stream().map(PostView::from).toList(); }

    @Transactional(readOnly = true)
    public List<ActivityView> activity() {
        return activities.findTop50ByOrderByCreatedAtDesc().stream().map(ActivityView::from).toList();
    }

    @Transactional
    public PostView create(CreatePost request) {
        String text = normalizeText(request.platform(), request.text());
        String mediaUrl = normalizeMediaUrl(request.mediaUrl());
        List<String> segments = normalizeSegments(request.platform(), text, request.segments());
        Post candidate = new Post(request.platform(), text, mediaUrl, clock.instant());
        candidate.segments.addAll(segments);
        Post post = posts.save(candidate);
        record(post, ActivityType.DRAFT_CREATED, "Draft created.");
        return PostView.from(post);
    }

    @Transactional
    public PostView update(UUID id, UpdatePost request) {
        Post post = locked(id);
        requireStatus(post, PostStatus.DRAFT);
        String text = normalizeText(post.platform, request.text());
        String mediaUrl = normalizeMediaUrl(request.mediaUrl());
        List<String> requestedSegments = request.segments();
        if (requestedSegments == null && !post.segments.isEmpty()) {
            requestedSegments = new java.util.ArrayList<>(post.segments);
            requestedSegments.set(0, text);
        }
        List<String> segments = normalizeSegments(post.platform, text, requestedSegments);
        post.segments.clear();
        post.segments.addAll(segments);
        post.text = text;
        post.mediaUrl = mediaUrl;
        post.touch(clock.instant());
        record(post, ActivityType.DRAFT_UPDATED, "Draft text and media URL updated.");
        return PostView.from(post);
    }

    @Transactional
    public PostView schedule(UUID id, Instant scheduledAt) {
        Post post = locked(id);
        requireStatus(post, PostStatus.DRAFT);
        if (!scheduledAt.isAfter(clock.instant())) throw badRequest("SCHEDULE_IN_PAST", "scheduledAt must be in the future with a UTC offset.");
        requirePublishable(post);
        post.status = PostStatus.SCHEDULED;
        post.scheduledAt = scheduledAt;
        post.touch(clock.instant());
        record(post, ActivityType.POST_SCHEDULED, "Dry run scheduled for " + scheduledAt + ". No live publishing will occur.");
        return PostView.from(post);
    }

    @Transactional
    public PostView cancelSchedule(UUID id) {
        Post post = locked(id);
        requireStatus(post, PostStatus.SCHEDULED);
        post.status = PostStatus.DRAFT;
        post.scheduledAt = null;
        post.touch(clock.instant());
        record(post, ActivityType.SCHEDULE_CANCELLED, "Scheduled dry run cancelled; post returned to draft.");
        return PostView.from(post);
    }

    @Transactional
    public PostView dryRun(UUID id) {
        Post post = locked(id);
        requireStatus(post, PostStatus.DRAFT);
        requirePublishable(post);
        simulate(post);
        return PostView.from(post);
    }

    /** Lock and state check make overlapping scheduler executions safe. */
    @Transactional
    public void simulateIfDue(UUID id, Instant now) {
        Post post = posts.findLockedById(id).orElse(null);
        if (post == null || post.status != PostStatus.SCHEDULED || post.scheduledAt.isAfter(now)) return;
        requirePublishable(post);
        simulate(post);
    }

    private void simulate(Post post) {
        String result = publisher.simulate(post);
        post.status = PostStatus.SIMULATED;
        post.touch(clock.instant());
        record(post, ActivityType.DRY_RUN_COMPLETED, result);
    }

    private void record(Post post, ActivityType type, String message) {
        activities.save(new Activity(post, type, message, clock.instant()));
    }

    private Post locked(UUID id) {
        return posts.findLockedById(id).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "POST_NOT_FOUND", "Post was not found."));
    }

    private void requireStatus(Post post, PostStatus required) {
        if (post.status != required) throw new ApiException(HttpStatus.CONFLICT, "INVALID_POST_STATE", "This operation requires " + required + "; current status is " + post.status + ".");
    }

    private void requirePublishable(Post post) {
        if (post.platform == Platform.INSTAGRAM && post.mediaUrl == null) {
            throw badRequest("MEDIA_REQUIRED", "Instagram requires a public HTTPS image URL before scheduling or running a simulation.");
        }
    }

    private static void validateMediaUrl(String value) {
        try {
            URI uri = URI.create(value);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            boolean publicDomain = host.matches("(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\\.[a-z]{2,63}")
                && !host.endsWith(".localhost") && !host.endsWith(".local") && !host.endsWith(".internal");
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !publicDomain || uri.getUserInfo() != null
                || uri.getFragment() != null || (uri.getPort() != -1 && uri.getPort() != 443)) {
                throw new IllegalArgumentException();
            }
        } catch (IllegalArgumentException ex) {
            throw badRequest("INVALID_MEDIA_URL", "mediaUrl must be an HTTPS URL on a public domain without credentials or a fragment. IP addresses and non-HTTPS ports are unsupported. The URL is not fetched.");
        }
    }

    private static String normalizeText(Platform platform, String value) {
        if (platform == null || value == null || value.isBlank()) throw badRequest("INVALID_POST_TEXT", "플랫폼과 비어 있지 않은 본문이 필요합니다.");
        String text = value.strip();
        if (text.codePointCount(0, text.length()) > platform.textLimit()) {
            throw badRequest("TEXT_TOO_LONG", platform + " text must be at most " + platform.textLimit() + " Unicode characters.");
        }
        return text;
    }

    private static List<String> normalizeSegments(Platform platform, String text, List<String> segments) {
        if (segments == null || segments.isEmpty()) return List.of();
        if (platform != Platform.THREADS) throw badRequest("SERIES_PLATFORM_UNSUPPORTED", "연속 답글은 Threads에서 지원합니다. Instagram은 내용을 합친 캡션을 사용해 주세요.");
        if (segments.size() != 4) throw badRequest("INVALID_SERIES", "연속 콘텐츠는 본문과 답글을 포함한 4편이 필요합니다.");
        List<String> normalized = segments.stream().map(segment -> normalizeText(platform, segment)).toList();
        if (!normalized.getFirst().equals(text)) throw badRequest("SERIES_TEXT_MISMATCH", "본문 text는 첫 번째 편과 같아야 합니다.");
        return normalized;
    }
    private static String normalizeMediaUrl(String value) {
        String mediaUrl = value == null || value.isBlank() ? null : value.strip();
        if (mediaUrl != null) validateMediaUrl(mediaUrl);
        return mediaUrl;
    }

    private static ApiException badRequest(String code, String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, code, message);
    }
}
