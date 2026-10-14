package com.insauto.automation;

import com.insauto.meta.ConnectionModels.Credentials;
import com.insauto.meta.ConnectionService;
import com.insauto.meta.MetaClient;
import java.time.Clock;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import static com.insauto.automation.ApiModels.*;

@Service
public class LivePublishService {
    private final PostRepository posts;
    private final ActivityRepository activities;
    private final ConnectionService connections;
    private final MetaClient meta;
    private final Clock clock;
    private final TransactionTemplate transaction;

    public LivePublishService(PostRepository posts, ActivityRepository activities, ConnectionService connections,
                              MetaClient meta, Clock clock, PlatformTransactionManager manager) {
        this.posts = posts; this.activities = activities; this.connections = connections;
        this.meta = meta; this.clock = clock; this.transaction = new TransactionTemplate(manager);
    }

    private record Prepared(PostView post, Credentials credentials) {}

    public PostView publish(UUID id, PublishPost request) {
        Prepared prepared = transaction.execute(tx -> {
            Post post = locked(id);
            // Repeating an already-confirmed request returns the receipt without contacting Meta.
            if (post.status == PostStatus.PUBLISHED && request.accountId().equals(post.publishAccountId))
                return new Prepared(PostView.from(post), null);
            if (post.status != PostStatus.DRAFT) throw conflict("INVALID_POST_STATE", "이 게시물은 이미 실행되었거나 실행 중입니다. 실제 계정의 게시 내역을 확인해 주세요. 자동 재전송하지 않습니다.");
            if (!post.updatedAt.equals(request.expectedUpdatedAt())) throw conflict("POST_CHANGED", "초안이 변경되었습니다. 최신 내용을 확인하고 다시 게시해 주세요.");
            if (post.platform == Platform.INSTAGRAM && post.mediaUrl == null)
                throw new ApiException(HttpStatus.BAD_REQUEST, "MEDIA_REQUIRED", "Instagram 게시에는 외부에서 열리는 HTTPS JPEG 이미지 주소가 필요합니다.");
            Credentials credentials = connections.credentials(post.platform, request.accountId());
            post.status = PostStatus.PUBLISHING; post.publishAccountId = request.accountId(); post.publishError = null;
            touch(post); record(post, ActivityType.PUBLISH_STARTED, "Explicit live publication started for account " + request.accountId() + ".");
            return new Prepared(PostView.from(post), credentials);
        });
        if (prepared.credentials() == null) return prepared.post();
        boolean publishSent = false;
        java.util.List<String> parts = prepared.post().segments().isEmpty()
            ? java.util.List.of(prepared.post().text()) : prepared.post().segments();
        String previousId = null;
        try {
            if (parts.size() > 1) meta.requireReplyPermission(prepared.credentials());
            for (int index = 0; index < parts.size(); index++) {
                publishSent = false;
                String containerId = index == 0
                    ? meta.createContainer(prepared.credentials(), parts.get(index), prepared.post().mediaUrl())
                    : meta.createReplyContainer(prepared.credentials(), parts.get(index), previousId);
                transaction.executeWithoutResult(tx -> { Post post = locked(id); post.containerId = containerId; touch(post); });
                awaitReady(prepared.credentials(), containerId);
                // A lost response from here is ambiguous; stop the series without sending this part again.
                publishSent = true;
                String publishedId = meta.publishContainer(prepared.credentials(), containerId);
                int partNumber = index + 1;
                transaction.executeWithoutResult(tx -> {
                    Post post = locked(id);
                    post.publishedIds.add(publishedId);
                    if (post.publishedId == null) post.publishedId = publishedId;
                    touch(post);
                    record(post, ActivityType.PUBLISH_PART_CONFIRMED, "Meta confirmed part " + partNumber + "/" + parts.size() + ". Post ID: " + publishedId + ".");
                    if (partNumber == parts.size()) {
                        post.status = PostStatus.PUBLISHED;
                        record(post, ActivityType.PUBLISH_CONFIRMED, "Meta confirmed all " + parts.size() + " part(s). Root post ID: " + post.publishedId + ".");
                    }
                });
                publishSent = false;
                previousId = publishedId;
            }
        } catch (RuntimeException failure) {
            boolean uncertain = publishSent;
            transaction.executeWithoutResult(tx -> {
                Post post = locked(id);
                if (post.status == PostStatus.PUBLISHED) return;
                int completed = post.publishedIds.size();
                post.status = uncertain ? PostStatus.PUBLISH_UNKNOWN : completed > 0 ? PostStatus.PUBLISH_PARTIAL : PostStatus.PUBLISH_FAILED;
                post.publishError = uncertain
                    ? "확인된 게시: " + completed + "편. 전송한 글이 이미 게시되었을 수 있으니 계정에서 직접 확인해 주세요. 중복 방지를 위해 재전송하지 않습니다."
                    : completed > 0
                        ? completed + "편이 게시되었고, 다음 편 준비에 실패해 중단했습니다. 앞선 글은 공개 상태입니다. 계정에서 확인해 주세요. 자동 재전송하지 않습니다."
                        : "게시 준비를 완료하지 못해 게시 요청을 보내지 않았습니다. 계정을 다시 연결해 답글 권한을 확인하고 공개 이미지 조건을 확인해 주세요.";
                touch(post); record(post, uncertain ? ActivityType.PUBLISH_UNCERTAIN : ActivityType.PUBLISH_FAILED, post.publishError);
            });
        }
        PostView result = transaction.execute(tx -> PostView.from(locked(id)));
        // Root link lookup cannot erase a durable receipt, including receipts from a partial series.
        if (result.publishedId() != null) {
            try {
                String link = meta.permalink(prepared.credentials(), result.publishedId());
                transaction.executeWithoutResult(tx -> { Post post = locked(id); post.permalink = link; });
                result = transaction.execute(tx -> PostView.from(locked(id)));
            } catch (RuntimeException ignored) { /* Publication state and IDs remain visible. */ }
        }
        return result;
    }
    private void awaitReady(Credentials credentials, String containerId) {
        long deadline = System.nanoTime() + java.time.Duration.ofSeconds(35).toNanos();
        do {
            String status = meta.containerStatus(credentials, containerId);
            if (status.equals("FINISHED")) return;
            if (!status.equals("IN_PROGRESS")) throw new MetaClient.Failure("Media container is not publishable.");
            if (System.nanoTime() >= deadline) break;
            try { Thread.sleep(2000); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new MetaClient.Failure("Publication preparation was interrupted."); }
        } while (System.nanoTime() < deadline);
        throw new MetaClient.Failure("Media container did not finish processing in time.");
    }

    /** Single-server recovery: interrupted work must never be automatically re-sent after restart. */
    @org.springframework.context.event.EventListener(org.springframework.boot.context.event.ApplicationReadyEvent.class)
    public void recoverInterruptedPublications() {
        transaction.executeWithoutResult(tx -> {
            for (Post candidate : posts.findByStatus(PostStatus.PUBLISHING)) {
                Post post = locked(candidate.id);
                if (post.status != PostStatus.PUBLISHING) continue;
                post.status = PostStatus.PUBLISH_UNKNOWN;
                post.publishError = "서버가 게시 처리 도중 재시작되었습니다. 실제 계정에서 게시 여부를 확인해 주세요. 자동 재전송하지 않습니다.";
                touch(post); record(post, ActivityType.PUBLISH_UNCERTAIN, post.publishError);
            }
        });
    }
    private Post locked(UUID id) {
        return posts.findLockedById(id).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "POST_NOT_FOUND", "Post was not found."));
    }
    private void touch(Post post) { post.touch(clock.instant()); }
    private void record(Post post, ActivityType type, String message) { activities.save(new Activity(post, type, message, clock.instant())); }
    private ApiException conflict(String code, String message) { return new ApiException(HttpStatus.CONFLICT, code, message); }
}
