package com.insauto.fortune;

import com.fasterxml.jackson.annotation.JsonFormat;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.time.LocalDate;

public final class FortuneModels {
    private FortuneModels() {}

    public enum CalendarType { SOLAR, LUNAR }

    // A lunar date cannot be represented by LocalDate: lunar February may have 30 days.
    public record PreviewRequest(
        @NotBlank @Pattern(regexp = "[0-9]{4}-[0-9]{2}-[0-9]{2}") String birthDate,
        @Pattern(regexp = "([01][0-9]|2[0-3]):[0-5][0-9]") String birthTime,
        @NotNull CalendarType calendarType,
        boolean leapMonth
    ) {}

    public record Chart(String year, String month, String day, String hour, String dayElement) {}
    public record Reading(String overall, String relationship, String work, String money, String action) {}
    public record Preview(
        @JsonFormat(shape = JsonFormat.Shape.STRING) LocalDate date,
        String basis, String notice, Chart chart, Reading reading,
        String instagramText, String threadsText
    ) {}
}
