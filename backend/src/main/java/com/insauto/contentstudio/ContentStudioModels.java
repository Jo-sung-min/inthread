package com.insauto.contentstudio;

import com.fasterxml.jackson.annotation.JsonFormat;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class ContentStudioModels {
    private ContentStudioModels() {}
    public enum Tone { DIRECT, WARM }
    public enum Cta { COMMENT, SAVE }
    public record TopicOption(String id, String label, String description) {}
    public record DeviceOption(String id, String label, String description) {}
    public record ToneOption(String id, String label) {}
    public record Options(List<TopicOption> topics, List<DeviceOption> devices, List<ToneOption> tones, int maxBatchSize) {}
    public record GenerateRequest(
        @NotEmpty @Size(max = 9) List<@NotBlank @Size(max = 40) String> topicIds,
        @NotNull @Min(1) @Max(12) Integer count,
        @NotNull Tone tone,
        @NotNull @Size(max = 5) List<@NotBlank @Size(max = 40) String> devices,
        @NotNull Cta cta
    ) {}
    public record Item(UUID id, String topicId, String title, List<String> segments,
                       String instagramCaption, List<String> devices, Tone tone) {}
    public record Generated(String generator, @JsonFormat(shape = JsonFormat.Shape.STRING) Instant generatedAt,
                            List<Item> items, String notice) {}
}
