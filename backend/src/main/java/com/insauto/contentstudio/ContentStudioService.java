package com.insauto.contentstudio;

import com.insauto.automation.ApiException;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import java.util.function.IntSupplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import static com.insauto.contentstudio.ContentStudioModels.*;

@Service
public class ContentStudioService {
    private static final String NOTICE = "직접 작성한 문구를 조합하는 템플릿 생성기입니다. AI 모델이나 개인 사주를 분석한 결과가 아니며, 게시 전에 표현을 확인하고 수정해 주세요.";
    private static final String FOOTNOTE = "※ 사주 상징을 빌린 재미·공감용 콘텐츠입니다.";
    private final Clock clock;
    private final IntSupplier variantSource;

    @Autowired
    public ContentStudioService(Clock clock) {
        this(clock, new SecureRandom()::nextInt);
    }
    ContentStudioService(Clock clock, IntSupplier variantSource) {
        this.clock = clock; this.variantSource = variantSource;
    }

    public Options options() {
        return new Options(ContentCatalog.TOPICS.stream().map(ContentCatalog.Topic::option).toList(),
            ContentCatalog.DEVICES, List.of(new ToneOption("DIRECT", "또렷하게"), new ToneOption("WARM", "다정하게")), 12);
    }

    public Generated generate(GenerateRequest request) {
        validate(request);
        List<ContentCatalog.Topic> topics = request.topicIds().stream()
            .map(id -> ContentCatalog.TOPICS.stream().filter(topic -> topic.id().equals(id)).findFirst().orElseThrow()).toList();
        List<String> devices = List.copyOf(request.devices());
        List<Item> items = new ArrayList<>();
        int start = Math.floorMod(variantSource.getAsInt(), 108);
        for (int index = 0; index < request.count(); index++) {
            // A topic's repetitions advance consecutively even in a mixed-topic batch.
            int topicIndex = index % topics.size();
            int variant = start + index / topics.size();
            var topic = topics.get(topicIndex);
            items.add(item(topic, variant, request.tone(), devices, request.cta()));
        }
        return new Generated("TEMPLATE", clock.instant(), List.copyOf(items), NOTICE);
    }

    private Item item(ContentCatalog.Topic topic, int variant, Tone tone, List<String> devices, Cta cta) {
        String title = pick(topic.hooks(), variant);
        StringBuilder first = new StringBuilder("(1/4) ").append(title).append("\n\n사주에서 함께 살펴보는 조합\n");
        for (int i = 0; i < 3; i++) first.append("· ").append(pick(topic.signs(), variant / 4 + i)).append("\n");
        if (devices.contains("SPECIALNESS")) first.append("\n이 중 두 가지가 익숙하다면, 오늘은 이 이야기에 잠깐 머물러 보자.");
        else first.append("\n일상에서 이런 장면을 떠올려 보자.");

        StringBuilder second = new StringBuilder("(2/4) ").append(topic.tradition());
        if (devices.contains("DUALITY")) second.append("\n\n").append(topic.duality());
        if (devices.contains("OPEN_LOOP")) second.append("\n\n").append(pick(List.of(
            "그런데 정작 중요한 단서는 다른 장면에 있다. 다음 이야기에서 그 마음을 조금 더 들여다보자.",
            "여기서 한 가지 놓치기 쉬운 마음이 있다. 다음 장면에 그 실마리가 있다.",
            "이 모습을 다르게 읽게 하는 순간이 있다. 다음 이야기에서 이어 보자."), variant / 12));

        StringBuilder third = new StringBuilder("(3/4) ").append(pick(topic.scenes(), variant / 4)).append(".");
        if (devices.contains("HIDDEN_EMOTION")) third.append("\n\n").append(topic.hidden());
        third.append("\n\n").append(topic.reframe()).append("\n").append(pick(topic.metaphors(), variant / 12)).append(".");

        StringBuilder fourth = new StringBuilder("(4/4) ").append(topic.affirmation());
        if (devices.contains("REASSURANCE")) fourth.append("\n\n").append(topic.reassurance());
        fourth.append("\n\n").append(cta(topic.prompt(), cta, variant / 36)).append("\n\n").append(FOOTNOTE);
        List<String> segments = List.of(first.toString(), second.toString(), third.toString(), fourth.toString()).stream()
            .map(text -> spoken(text, tone)).toList();
        String caption = String.join("\n\n", segments) + "\n\n#사주이야기 #마음기록 #공감글";
        if (segments.stream().anyMatch(segment -> length(segment) > 500) || length(caption) > 2200) {
            throw new IllegalStateException("Authored content exceeds platform limits.");
        }
        return new Item(UUID.randomUUID(), topic.id(), spoken(title, tone), segments, caption, devices, tone);
    }

    private static String cta(String prompt, Cta cta, int variant) {
        return cta == Cta.COMMENT ? pick(List.of(
            prompt + " — 괜찮다면 댓글로 이야기해 보자.",
            "댓글로 나누고 싶다면, '" + prompt + "'에 대해 한 줄만 남겨 보자.",
            "떠오르는 게 있다면 댓글로 알려 줘. 오늘의 질문은 '" + prompt + "'."), variant)
            : pick(List.of(
                "나중에 다시 읽고 싶다면 저장해 두자. 오늘은 '" + prompt + "'에 대해 짧게 적어 보자.",
                "필요한 날 꺼내 볼 수 있도록 저장해 두자. '" + prompt + "'도 함께 기억해 보자.",
                "마음에 남는 문장이 있다면 저장해 두자. 다음에는 '" + prompt + "'도 함께 떠올려 보자."), variant);
    }

    private void validate(GenerateRequest request) {
        if (request == null || request.count() == null || request.count() < 1 || request.count() > 12
            || request.tone() == null || request.cta() == null || request.topicIds() == null || request.topicIds().isEmpty()
            || request.topicIds().size() > ContentCatalog.TOPICS.size() || request.devices() == null || request.devices().size() > 5
            || new HashSet<>(request.topicIds()).size() != request.topicIds().size()
            || new HashSet<>(request.devices()).size() != request.devices().size()) throw invalid();
        var topics = ContentCatalog.TOPICS.stream().map(ContentCatalog.Topic::id).toList();
        var devices = ContentCatalog.DEVICES.stream().map(DeviceOption::id).toList();
        if (!topics.containsAll(request.topicIds()) || !devices.containsAll(request.devices())) throw invalid();
    }
    private static ApiException invalid() {
        return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_CONTENT_OPTIONS", "주제, 표현 장치, 말투와 생성 개수(1~12개)를 확인해 주세요.");
    }
    private static String pick(List<String> choices, int index) { return choices.get(Math.floorMod(index, choices.size())); }
    private static int length(String value) { return value.codePointCount(0, value.length()); }

    // Deliberate endings used by our authored catalog, not arbitrary model text.
    private static String spoken(String text, Tone tone) {
        boolean warm = tone == Tone.WARM;
        String[][] endings = {
            {"아니다", "아니야", "아니에요"}, {"없다", "없어", "없어요"}, {"있다", "있어", "있어요"},
            {"좋다", "좋아", "좋아요"}, {"된다", "돼", "돼요"}, {"보자", "봐", "봐요"},
            {"두자", "둬", "둬요"}, {"이야기다", "이야기야", "이야기예요"},
            {"말이다", "말이야", "말이에요"}, {"한다", "해", "해요"}, {"읽는다", "읽어", "읽어요"},
            {"살핀다", "살펴", "살펴요"}, {"본다", "봐", "봐요"}, {"남는다", "남아", "남아요"},
            {"전한다", "전해", "전해요"}, {"지킨다", "지켜", "지켜요"}, {"받친다", "받쳐", "받쳐요"},
            {"필요하다", "필요해", "필요해요"}, {"다르다", "달라", "달라요"}, {"않는다", "않아", "않아요"},
            {"비유다", "비유야", "비유예요"}
        };
        for (String[] ending : endings) {
            text = text.replaceAll(java.util.regex.Pattern.quote(ending[0]) + "(?=[.!?]|$)", ending[warm ? 2 : 1]);
        }
        return warm ? text.replace("무엇일까?", "무엇일까요?").replace("것일까?", "것일까요?")
            .replace("있지?", "있지 않나요?").replace("지우지 마.", "지우지 마세요.")
            .replace("아니니까.", "아니니까요.").replace("수 있으니까.", "수 있으니까요.")
            .replace("알려 줘.", "알려 주세요.") : text;
    }
}
