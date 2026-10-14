package com.insauto.fortune;

import com.insauto.automation.ApiException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import static com.insauto.fortune.FortuneModels.*;
import static org.assertj.core.api.Assertions.*;

class FortuneServiceTest {
    private final SajuCalendar calendar = new SajuCalendar();
    private final FortuneService service = serviceAt("2026-10-14T00:00:00Z");

    @Test
    void knownSolarAndLunarBirthsProduceTheSamePillars() {
        var solar = service.preview(request("2024-02-10", "12:00", CalendarType.SOLAR, false));
        var lunar = service.preview(request("2024-01-01", "12:00", CalendarType.LUNAR, false));
        assertThat(solar.chart()).isEqualTo(lunar.chart());
        assertThat(solar.chart()).isEqualTo(new Chart("갑진(甲辰)", "병인(丙寅)", "갑진(甲辰)", "경오(庚午)", "목"));
    }

    @Test
    void validLeapMonthAndLunarFebruaryThirtyAreSupported() {
        var leap = calendar.natal(request("2023-02-01", "08:30", CalendarType.LUNAR, true), LocalDate.of(2026, 10, 14));
        assertThat(leap.solarDate()).isEqualTo(LocalDate.of(2023, 3, 22));
        var thirty = calendar.natal(request("2023-02-30", null, CalendarType.LUNAR, false), LocalDate.of(2026, 10, 14));
        assertThat(thirty.solarDate()).isEqualTo(LocalDate.of(2023, 3, 21));
    }

    @Test
    void invalidDatesLeapMonthsAndFutureConvertedBirthsAreRejected() {
        for (var request : new PreviewRequest[] {
            request("2023-02-30", null, CalendarType.SOLAR, false),
            request("2024-02-01", null, CalendarType.LUNAR, true),
            request("2023-02-30", null, CalendarType.LUNAR, true),
            request("2024-01-01", null, CalendarType.SOLAR, true),
            request("1899-12-31", null, CalendarType.SOLAR, false),
            request("2026-10-15", null, CalendarType.SOLAR, false),
            request("2026-10-14", null, CalendarType.LUNAR, false),
            request("1995-13-18", null, CalendarType.SOLAR, false),
            request("1995-07-18", "24:00", CalendarType.SOLAR, false),
            request("1995-07-18", "09:20:00", CalendarType.SOLAR, false)
        }) {
            assertThatThrownBy(() -> service.preview(request)).isInstanceOf(ApiException.class);
        }
    }

    @Test
    void unknownBirthTimeDoesNotInventAnHourPillar() {
        var preview = service.preview(request("1995-07-18", null, CalendarType.SOLAR, false));
        assertThat(preview.chart().hour()).isNull();
        assertThat(preview.basis()).contains("출생시각 미상", "정오", "절기 경계", "23시");
    }

    @Test
    void solarTermsUseKoreanTimeAndDayRollsAtTwentyThree() {
        var beforeTerm = service.preview(request("2024-02-04", "17:26", CalendarType.SOLAR, false));
        var afterTerm = service.preview(request("2024-02-04", "17:28", CalendarType.SOLAR, false));
        assertThat(beforeTerm.chart().year()).isEqualTo("계묘(癸卯)");
        assertThat(beforeTerm.chart().month()).isEqualTo("을축(乙丑)");
        assertThat(afterTerm.chart().year()).isEqualTo("갑진(甲辰)");
        assertThat(afterTerm.chart().month()).isEqualTo("병인(丙寅)");
        assertThat(service.preview(request("2024-02-10", "22:59", CalendarType.SOLAR, false)).chart().day()).isEqualTo("갑진(甲辰)");
        assertThat(service.preview(request("2024-02-10", "23:00", CalendarType.SOLAR, false)).chart().day()).isEqualTo("을사(乙巳)");
    }

    @Test
    void todayChangesAtSeoulMidnightAndRemainsTheSameForTheCalendarDay() {
        var birth = request("1995-07-18", null, CalendarType.SOLAR, false);
        var before = serviceAt("2026-10-13T14:59:59Z").preview(birth);
        var midnight = serviceAt("2026-10-13T15:00:00Z").preview(birth);
        var late = serviceAt("2026-10-14T14:59:59Z").preview(birth);
        assertThat(before.date()).isEqualTo(LocalDate.of(2026, 10, 13));
        assertThat(midnight.date()).isEqualTo(LocalDate.of(2026, 10, 14));
        assertThat(midnight).isEqualTo(late);
    }

    @Test
    void captionsDoNotExposeBirthInformationAndFitEveryRelation() {
        for (int day = 0; day < 60; day++) {
            String birthday = LocalDate.of(1995, 7, 18).plusDays(day).toString();
            var preview = service.preview(request(birthday, "09:20", CalendarType.SOLAR, false));
            assertThat(preview.instagramText()).doesNotContain(birthday, "1995", "09:20").contains(preview.date().toString());
            assertThat(preview.threadsText()).doesNotContain(birthday, "1995", "09:20").contains(preview.date().toString());
            assertThat(preview.instagramText().codePointCount(0, preview.instagramText().length())).isLessThanOrEqualTo(2200);
            assertThat(preview.threadsText().codePointCount(0, preview.threadsText().length())).isLessThanOrEqualTo(500);
            assertThat(preview.notice()).contains("전통 명리 규칙을 활용한 참고용 해석");
            assertThat(preview.basis()).contains("KST", "규칙 기반", "전체 사주·대운");
        }
    }

    private FortuneService serviceAt(String instant) {
        return new FortuneService(Clock.fixed(Instant.parse(instant), ZoneOffset.UTC), calendar);
    }

    private PreviewRequest request(String date, String time, CalendarType type, boolean leap) {
        return new PreviewRequest(date, time, type, leap);
    }
}
