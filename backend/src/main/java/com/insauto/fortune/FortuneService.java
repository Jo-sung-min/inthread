package com.insauto.fortune;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import org.springframework.stereotype.Service;
import static com.insauto.fortune.FortuneModels.*;

@Service
public class FortuneService {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final String NOTICE = "전통 명리 규칙을 활용한 참고용 해석입니다. "
        + "미래를 예측하거나 전문 상담을 대신하지 않으며, 실제 선택은 자신의 상황을 바탕으로 해 주세요.";
    private final Clock clock;
    private final SajuCalendar calendar;

    public FortuneService(Clock clock, SajuCalendar calendar) {
        this.clock = clock;
        this.calendar = calendar;
    }

    public Preview preview(PreviewRequest request) {
        LocalDate today = LocalDate.now(clock.withZone(SEOUL));
        var natal = calendar.natal(request, today);
        var daily = calendar.calculate(today, LocalTime.NOON);
        int relation = Math.floorMod(SajuCalendar.elementIndex(daily.day())
            - SajuCalendar.elementIndex(natal.day()), 5);
        boolean oppositeBranches = Math.floorMod(SajuCalendar.branchIndex(daily.day())
            - SajuCalendar.branchIndex(natal.day()), 12) == 6;
        Reading reading = reading(relation, oppositeBranches);
        String basis = "한국 표준시(KST·UTC+09:00) 가정 · 절기 기준 연·월주 · 23시 일주 교체. "
            + "오늘은 한국 날짜의 정오 일진 " + SajuCalendar.display(daily.day()) + "을 사용합니다. "
            + "출생 일간(" + natal.view().dayElement() + ")과 오늘 일간(" + SajuCalendar.element(daily.day())
            + ")의 오행 관계 및 일지 관계를 중심으로 만든 규칙 기반 문구입니다. "
            + "전체 사주·대운·출생지의 태양시 보정은 해석에 포함하지 않습니다. "
            + (request.calendarType() == CalendarType.LUNAR ? "음력 변환은 lunar-java 역법 기준입니다. " : "")
            + (request.birthTime() == null
                ? "출생시각 미상: 시주를 제외하고 정오로 계산하므로 절기 경계일의 연·월주와 23시 이후 일주가 달라질 수 있습니다."
                : "입력한 출생시각을 사용했습니다.");
        String instagram = "오늘의 사주 운세 · " + today + "\n\n"
            + "전체 흐름\n" + reading.overall() + "\n\n"
            + "관계\n" + reading.relationship() + "\n\n"
            + "일과 공부\n" + reading.work() + "\n\n"
            + "소비 습관\n" + reading.money() + "\n\n"
            + "오늘의 작은 실천\n" + reading.action() + "\n\n"
            + "개인 사주의 일간과 오늘 일진을 참고한 문구입니다.\n" + NOTICE
            + "\n\n#오늘의운세 #사주 #하루기록";
        String threads = "오늘의 사주 운세 · " + today + "\n\n"
            + reading.overall() + "\n" + reading.relationship() + "\n" + reading.work()
            + "\n" + reading.money() + "\n\n오늘의 실천: " + reading.action()
            + "\n\n전통 명리 규칙을 활용한 참고용 해석이며 미래를 보장하지 않습니다. #오늘의운세";
        return new Preview(today, basis, NOTICE, natal.view(), reading, instagram, threads);
    }

    private Reading reading(int relation, boolean oppositeBranches) {
        String relationship = oppositeBranches
            ? "서로 다른 속도를 존중하고, 중요한 말은 한 번 더 확인해 보세요."
            : "상대의 말을 끝까지 듣고, 고마운 마음 하나를 구체적으로 전해 보세요.";
        // Wood→fire→earth→metal→water is the generating cycle. A delta of 2 is control.
        return switch (relation) {
            case 0 -> new Reading(
                "오늘의 키워드는 균형과 동료입니다. 비교보다 자신의 속도를 살펴보세요.", relationship,
                "혼자 결정하기 전에 동료의 관점을 하나 들어 보세요.",
                "모임이나 함께 쓰는 비용의 범위를 미리 정해 보세요.",
                "미뤄 둔 안부 한 통을 보내 보세요.");
            case 1 -> new Reading(
                "오늘의 키워드는 표현과 정리입니다. 머릿속 생각을 작은 결과물로 옮겨 보세요.", relationship,
                "완벽한 시작보다 끝낼 수 있는 작은 작업을 골라 보세요.",
                "기분에 따른 구매는 목록에 적고 잠시 미뤄 보세요.",
                "생각 세 가지를 적고 한 가지부터 실행해 보세요.");
            case 2 -> new Reading(
                "오늘의 키워드는 관리와 실천입니다. 가진 시간과 자원을 차분히 점검해 보세요.", relationship,
                "해야 할 일의 범위를 좁히고 완료 기준을 정해 보세요.",
                "예산과 실제 지출을 비교하고 불필요한 구독을 확인해 보세요.",
                "오늘 꼭 마칠 일 한 가지를 정해 보세요.");
            case 3 -> new Reading(
                "오늘의 키워드는 기준과 책임입니다. 무리한 약속보다 지킬 수 있는 범위를 정해 보세요.", relationship,
                "일정과 요구 사항을 확인하고 여유 시간을 남겨 보세요.",
                "결제 조건과 자동이체 내역을 한 번 더 확인해 보세요.",
                "일정표에 짧은 휴식 시간을 넣어 보세요.");
            default -> new Reading(
                "오늘의 키워드는 배움과 회복입니다. 새로운 결론보다 이미 가진 자료를 돌아보세요.", relationship,
                "막힌 부분은 기록을 찾아보거나 믿을 만한 사람에게 물어보세요.",
                "배움에 쓰려는 비용도 필요한 범위 안에서 정해 보세요.",
                "배운 내용 한 가지를 자신의 말로 정리해 보세요.");
        };
    }
}
