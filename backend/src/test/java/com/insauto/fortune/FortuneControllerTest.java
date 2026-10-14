package com.insauto.fortune;

import com.insauto.automation.ApiExceptionHandler;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class FortuneControllerTest {
    private MockMvc mvc;

    @BeforeEach
    void setup() {
        var service = new FortuneService(Clock.fixed(Instant.parse("2026-10-14T00:00:00Z"), ZoneOffset.UTC), new SajuCalendar());
        mvc = MockMvcBuilders.standaloneSetup(new FortuneController(service))
            .setControllerAdvice(new ApiExceptionHandler()).build();
    }

    @Test
    void returnsStructuredPreviewWithoutCachingSensitiveChart() throws Exception {
        mvc.perform(post("/api/v1/fortunes/preview").contentType(MediaType.APPLICATION_JSON).content("""
            {"birthDate":"1995-07-18","birthTime":null,"calendarType":"SOLAR","leapMonth":false}
            """))
            .andExpect(status().isOk())
            .andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.date").value("2026-10-14"))
            .andExpect(jsonPath("$.chart.hour").isEmpty())
            .andExpect(jsonPath("$.reading.overall").isNotEmpty())
            .andExpect(jsonPath("$.birthDate").doesNotExist());
    }

    @Test
    void malformedAndImpossibleInputsHaveStructuredErrors() throws Exception {
        mvc.perform(post("/api/v1/fortunes/preview").contentType(MediaType.APPLICATION_JSON).content("""
            {"birthDate":"2023-02-30","calendarType":"SOLAR"}
            """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("INVALID_BIRTH_INPUT"));
        mvc.perform(post("/api/v1/fortunes/preview").contentType(MediaType.APPLICATION_JSON).content("""
            {"birthDate":"1995-07-18","birthTime":"29:12","calendarType":"SOLAR"}
            """))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }
}
