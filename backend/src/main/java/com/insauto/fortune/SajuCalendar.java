package com.insauto.fortune;

import com.insauto.automation.ApiException;
import com.nlf.calendar.EightChar;
import com.nlf.calendar.Lunar;
import com.nlf.calendar.LunarMonth;
import com.nlf.calendar.Solar;
import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import static com.insauto.fortune.FortuneModels.*;

/** Calendar rules adapted from the sibling fatell calculator; no birth data is persisted. */
@Component
public class SajuCalendar {
    private static final String STEMS = "甲乙丙丁戊己庚辛壬癸";
    private static final String KOREAN_STEMS = "갑을병정무기경신임계";
    private static final String BRANCHES = "子丑寅卯辰巳午未申酉戌亥";
    private static final String KOREAN_BRANCHES = "자축인묘진사오미신유술해";
    private static final String[] ELEMENTS = {"목", "화", "토", "금", "수"};

    public NatalChart natal(PreviewRequest request, LocalDate today) {
        if (request == null || request.birthDate() == null
            || !request.birthDate().matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")
            || request.calendarType() == null) {
            throw invalid("생년월일과 양력·음력 구분을 입력해 주세요.");
        }
        if (request.calendarType() == CalendarType.SOLAR && request.leapMonth()) {
            throw invalid("윤달은 음력 날짜에만 선택할 수 있습니다.");
        }
        LocalTime time = parseTime(request.birthTime());
        int year = Integer.parseInt(request.birthDate().substring(0, 4));
        int month = Integer.parseInt(request.birthDate().substring(5, 7));
        int day = Integer.parseInt(request.birthDate().substring(8, 10));
        if (year < 1900 || year > today.getYear() || month < 1 || month > 12 || day < 1 || day > 31) {
            throw invalid("생년월일은 1900년부터 오늘까지의 유효한 날짜여야 합니다.");
        }
        LocalTime calculationTime = time == null ? LocalTime.NOON : time;
        LocalDate solarDate;
        try {
            if (request.calendarType() == CalendarType.LUNAR) {
                int signedMonth = request.leapMonth() ? -month : month;
                LunarMonth lunarMonth = LunarMonth.fromYm(year, signedMonth);
                if (lunarMonth == null || day > lunarMonth.getDayCount()) {
                    throw invalid("해당 음력 날짜 또는 윤달이 존재하지 않습니다.");
                }
                Solar solar = Lunar.fromYmdHms(year, signedMonth, day,
                    calculationTime.getHour(), calculationTime.getMinute(), 0).getSolar();
                solarDate = LocalDate.of(solar.getYear(), solar.getMonth(), solar.getDay());
            } else {
                solarDate = LocalDate.of(year, month, day);
            }
        } catch (ApiException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw invalid("유효하지 않거나 지원하지 않는 생년월일입니다.");
        }
        if (solarDate.isAfter(today)) throw invalid("미래의 생년월일은 입력할 수 없습니다.");
        return calculate(solarDate, time);
    }

    NatalChart calculate(LocalDate solarDate, LocalTime time) {
        LocalTime effectiveTime = time == null ? LocalTime.NOON : time;
        LocalDateTime koreanTime = LocalDateTime.of(solarDate, effectiveTime);
        // The library's astronomical terms use UTC+08; input is explicitly KST (UTC+09).
        // Only year/month terms are shifted. Day/hour retain the entered civil time.
        EightChar terms = eightChar(koreanTime.minusHours(1));
        EightChar local = eightChar(koreanTime);
        return new NatalChart(solarDate, terms.getYear(), terms.getMonth(), local.getDay(),
            time == null ? null : local.getTime());
    }

    private EightChar eightChar(LocalDateTime date) {
        EightChar result = Solar.fromYmdHms(date.getYear(), date.getMonthValue(), date.getDayOfMonth(),
            date.getHour(), date.getMinute(), 0).getLunar().getEightChar();
        result.setSect(1); // Day pillar changes at 23:00, matching fatell.
        return result;
    }

    private LocalTime parseTime(String time) {
        if (time == null) return null;
        if (!time.matches("([01][0-9]|2[0-3]):[0-5][0-9]")) {
            throw invalid("출생시각은 HH:mm 형식으로 입력하거나 비워 주세요.");
        }
        try { return LocalTime.parse(time); }
        catch (DateTimeException exception) { throw invalid("유효한 출생시각을 입력해 주세요."); }
    }

    static int elementIndex(String pillar) { return STEMS.indexOf(pillar.charAt(0)) / 2; }
    static int branchIndex(String pillar) { return BRANCHES.indexOf(pillar.charAt(1)); }
    static String element(String pillar) { return ELEMENTS[elementIndex(pillar)]; }
    static String display(String pillar) {
        if (pillar == null) return null;
        return "" + KOREAN_STEMS.charAt(STEMS.indexOf(pillar.charAt(0)))
            + KOREAN_BRANCHES.charAt(BRANCHES.indexOf(pillar.charAt(1))) + "(" + pillar + ")";
    }
    static ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_BIRTH_INPUT", message);
    }

    record NatalChart(LocalDate solarDate, String year, String month, String day, String hour) {
        Chart view() { return new Chart(display(year), display(month), display(day), display(hour), element(day)); }
    }
}
