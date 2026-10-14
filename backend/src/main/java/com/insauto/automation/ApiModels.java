package com.insauto.automation;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class ApiModels {
    private ApiModels() {}

    public record CreatePost(@NotNull Platform platform, @NotBlank @Size(max = 8800) String text,
                             @Size(max = 2048) String mediaUrl,
                             @Size(max = 4) List<@NotBlank @Size(max = 8800) String> segments) {
        public CreatePost(Platform platform, String text, String mediaUrl) { this(platform, text, mediaUrl, null); }
    }
    public record CreateBatch(@NotNull UUID requestId, @NotNull @Size(min = 1, max = 12) List<@NotNull @Valid CreatePost> posts) {}
    public record BatchView(List<PostView> posts) {}
    public record SchedulePost(@NotNull Instant scheduledAt) {}

    public record UpdatePost(@NotBlank @Size(max = 8800) String text, @Size(max = 2048) String mediaUrl,
                             @Size(max = 4) List<@NotBlank @Size(max = 8800) String> segments) {
        public UpdatePost(String text, String mediaUrl) { this(text, mediaUrl, null); }
    }
    public record PublishPost(@NotBlank @Size(max = 100) String accountId, @NotNull Instant expectedUpdatedAt) {}

    public record PostView(UUID id, Platform platform, String text, String mediaUrl, PostStatus status,
                           Instant scheduledAt, Instant createdAt, Instant updatedAt,
                           String publishedAccountId, String publishedId, String permalink, String publishError,
                           List<String> segments, List<String> publishedIds) {
        static PostView from(Post p) {
            return new PostView(p.id, p.platform, p.text, p.mediaUrl, p.status, p.scheduledAt, p.createdAt, p.updatedAt,
                p.publishAccountId, p.publishedId, p.permalink, p.publishError, List.copyOf(p.segments), List.copyOf(p.publishedIds));
        }
    }
    public record ActivityView(UUID id, UUID postId, Platform platform, ActivityType type, String message, Instant createdAt) {
        static ActivityView from(Activity a) { return new ActivityView(a.id, a.postId, a.platform, a.type, a.message, a.createdAt); }
    }
    public record ChannelView(Platform platform, String name, boolean connected, String mode, int textLimit, String description) {}
}
