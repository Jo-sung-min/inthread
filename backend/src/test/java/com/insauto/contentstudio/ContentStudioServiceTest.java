package com.insauto.contentstudio;

import com.insauto.automation.ApiException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import static com.insauto.contentstudio.ContentStudioModels.*;
import static org.assertj.core.api.Assertions.*;

class ContentStudioServiceTest {
    private static final Instant NOW = Instant.parse("2026-10-14T00:00:00Z");
    private final Clock clock = Clock.fixed(NOW, ZoneOffset.UTC);
    private final ContentStudioService service = new ContentStudioService(clock, () -> 0);
    private final List<String> allDevices = ContentCatalog.DEVICES.stream().map(DeviceOption::id).toList();

    @Test
    void returnsTwelveDistinctSeriesForOneTopicWithFourNumberedParts() {
        var generated = service.generate(request(List.of("LATE_BLOOM"), 12, Tone.DIRECT, allDevices, Cta.COMMENT));
        assertThat(generated.generator()).isEqualTo("TEMPLATE");
        assertThat(generated.generatedAt()).isEqualTo(NOW);
        assertThat(generated.notice()).contains("템플릿", "개인 사주");
        assertThat(generated.items()).hasSize(12);
        assertThat(generated.items()).extracting(Item::id).doesNotHaveDuplicates();
        assertThat(generated.items()).extracting(Item::instagramCaption).doesNotHaveDuplicates();
        // Distinct captions come from different hooks AND scenes, not item numbers or UUIDs.
        assertThat(generated.items().stream().map(item -> item.segments().get(0) + item.segments().get(2)).toList())
            .doesNotHaveDuplicates();
        generated.items().forEach(item -> {
            assertThat(item.segments()).hasSize(4);
            for (int i = 0; i < 4; i++) assertThat(item.segments().get(i)).startsWith("(" + (i + 1) + "/4) ");
            assertThat(item.segments().get(0)).contains("사주", "· ");
            assertThat(item.segments().get(3)).contains("댓글", "재미·공감용");
        });
    }

    @Test
    void primaryThemesRetainTheirSajuTermsAndEmotionalArc() {
        var items = service.generate(request(List.of("LATE_BLOOM", "ATTRACTION", "SOFT_INSIDE"), 3, Tone.DIRECT, allDevices, Cta.COMMENT)).items();
        assertThat(items.get(0).instagramCaption()).contains("진·술·축·미", "인성", "창고", "나는 언제쯤이지", "버틴 시간");
        assertThat(items.get(1).instagramCaption()).contains("도화", "홍염", "식상", "연락하는 사람은 많은데");
        assertThat(items.get(2).instagramCaption()).contains("경금·신금", "편관", "인성", "그날 표정", "혼자 마음의 거리");
    }

    @Test
    void everyDeviceToggleChangesOnlyItsIntendedPassage() {
        var off = service.generate(request(List.of("LATE_BLOOM"), 1, Tone.DIRECT, List.of(), Cta.COMMENT)).items().getFirst();
        List<String> markers = List.of("겉으론", "집에 오면", "다음 이야기", "두 가지", "비교 때문에");
        List<Integer> segmentIndexes = List.of(1, 2, 1, 0, 3);
        for (int device = 0; device < allDevices.size(); device++) {
            var on = service.generate(request(List.of("LATE_BLOOM"), 1, Tone.DIRECT, List.of(allDevices.get(device)), Cta.COMMENT)).items().getFirst();
            assertThat(on.devices()).containsExactly(allDevices.get(device));
            int changed = segmentIndexes.get(device);
            assertThat(on.segments().get(changed)).contains(markers.get(device));
            assertThat(off.segments().get(changed)).doesNotContain(markers.get(device));
            for (int segment = 0; segment < 4; segment++) {
                if (segment != changed) assertThat(on.segments().get(segment)).isEqualTo(off.segments().get(segment));
            }
        }
    }

    @Test
    void roundRobinTopicsAndToneAndCtaSelectionsAreHonored() {
        var mixed = service.generate(request(List.of("ATTRACTION", "SOFT_INSIDE"), 5, Tone.DIRECT, List.of(), Cta.COMMENT));
        assertThat(mixed.items()).extracting(Item::topicId).containsExactly("ATTRACTION", "SOFT_INSIDE", "ATTRACTION", "SOFT_INSIDE", "ATTRACTION");
        var direct = service.generate(request(List.of("LATE_BLOOM"), 1, Tone.DIRECT, allDevices, Cta.COMMENT)).items().getFirst();
        var warm = service.generate(request(List.of("LATE_BLOOM"), 1, Tone.WARM, allDevices, Cta.SAVE)).items().getFirst();
        assertThat(warm.tone()).isEqualTo(Tone.WARM);
        assertThat(direct.segments().get(1)).contains("있지?");
        assertThat(warm.segments().get(1)).contains("있지 않나요?");
        assertThat(warm.segments().get(3)).contains("저장").doesNotContain("댓글");
        assertThat(warm.instagramCaption()).doesNotContain("있어요면", "아니에요면");
    }

    @Test
    void allTopicsTonesCtasAndDeviceCombinationsStayWithinPlatformLimits() {
        for (var topic : ContentCatalog.TOPICS) for (Tone tone : Tone.values()) for (Cta cta : Cta.values()) {
            for (int mask = 0; mask < 32; mask++) {
                List<String> devices = new ArrayList<>();
                for (int bit = 0; bit < 5; bit++) if ((mask & (1 << bit)) != 0) devices.add(allDevices.get(bit));
                int variant = mask * 3;
                var generator = new ContentStudioService(clock, () -> variant);
                var item = generator.generate(request(List.of(topic.id()), 1, tone, devices, cta)).items().getFirst();
                assertThat(item.segments()).allSatisfy(segment -> assertThat(length(segment)).isLessThanOrEqualTo(500));
                assertThat(length(item.instagramCaption())).isLessThanOrEqualTo(2200);
                assertThat(item.instagramCaption()).doesNotContain("있어요면", "아니에요면");
            }
        }
    }

    @Test
    void allVariantFamiliesKeepSameTopicBatchDistinct() {
        for (int start = 0; start < 108; start += 12) {
            int seed = start;
            var generator = new ContentStudioService(clock, () -> seed);
            for (var topic : ContentCatalog.TOPICS) {
                var batch = generator.generate(request(List.of(topic.id()), 12, Tone.WARM, allDevices, Cta.SAVE));
                assertThat(batch.items()).extracting(Item::instagramCaption).doesNotHaveDuplicates();
            }
        }
    }

    @Test
    void invalidUnknownOrDuplicateOptionsAreRejectedBeforeGeneration() {
        for (var input : List.of(
            request(List.of(), 1, Tone.DIRECT, List.of(), Cta.COMMENT),
            request(List.of("UNKNOWN"), 1, Tone.DIRECT, List.of(), Cta.COMMENT),
            request(List.of("LATE_BLOOM", "LATE_BLOOM"), 1, Tone.DIRECT, List.of(), Cta.COMMENT),
            request(List.of("LATE_BLOOM"), 0, Tone.DIRECT, List.of(), Cta.COMMENT),
            request(List.of("LATE_BLOOM"), 13, Tone.DIRECT, List.of(), Cta.COMMENT),
            request(List.of("LATE_BLOOM"), 1, Tone.DIRECT, List.of("UNKNOWN"), Cta.COMMENT),
            request(List.of("LATE_BLOOM"), 1, Tone.DIRECT, List.of("DUALITY", "DUALITY"), Cta.COMMENT),
            request(List.of("LATE_BLOOM"), 1, null, List.of(), Cta.COMMENT))) {
            assertThatThrownBy(() -> service.generate(input)).isInstanceOf(ApiException.class);
        }
        assertThat(service.options().topics()).hasSize(9);
        assertThat(service.options().devices()).hasSize(5);
        assertThat(service.options().maxBatchSize()).isEqualTo(12);
    }

    private GenerateRequest request(List<String> topics, int count, Tone tone, List<String> devices, Cta cta) {
        return new GenerateRequest(topics, count, tone, devices, cta);
    }
    private static int length(String value) { return value.codePointCount(0, value.length()); }
}
