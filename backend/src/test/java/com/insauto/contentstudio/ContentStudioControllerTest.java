package com.insauto.contentstudio;

import com.insauto.automation.ApiExceptionHandler;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ContentStudioControllerTest {
    private MockMvc mvc;
    @BeforeEach
    void setup() {
        var service = new ContentStudioService(Clock.fixed(Instant.parse("2026-10-14T00:00:00Z"), ZoneOffset.UTC), () -> 0);
        mvc = MockMvcBuilders.standaloneSetup(new ContentStudioController(service))
            .setControllerAdvice(new ApiExceptionHandler()).build();
    }
    @Test
    void optionsAndGenerationExposeTheDocumentedContract() throws Exception {
        mvc.perform(get("/api/v1/content-studio/options")).andExpect(status().isOk())
            .andExpect(jsonPath("$.maxBatchSize").value(12)).andExpect(jsonPath("$.topics[0].id").value("LATE_BLOOM"));
        mvc.perform(post("/api/v1/content-studio/generate").contentType(MediaType.APPLICATION_JSON).content("""
            {"topicIds":["LATE_BLOOM"],"count":2,"tone":"DIRECT","devices":[],"cta":"COMMENT"}
            """))
            .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
            .andExpect(jsonPath("$.generator").value("TEMPLATE"))
            .andExpect(jsonPath("$.generatedAt").value("2026-10-14T00:00:00Z"))
            .andExpect(jsonPath("$.items.length()").value(2)).andExpect(jsonPath("$.items[0].segments.length()").value(4));
    }
    @Test
    void missingInvalidAndUnknownOptionsReturnStructuredBadRequests() throws Exception {
        mvc.perform(post("/api/v1/content-studio/generate").contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        mvc.perform(post("/api/v1/content-studio/generate").contentType(MediaType.APPLICATION_JSON).content("""
            {"topicIds":["UNKNOWN"],"count":1,"tone":"DIRECT","devices":[],"cta":"COMMENT"}
            """))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_CONTENT_OPTIONS"));
        mvc.perform(post("/api/v1/content-studio/generate").contentType(MediaType.APPLICATION_JSON).content("""
            {"topicIds":["LATE_BLOOM"],"count":13,"tone":"DIRECT","devices":[],"cta":"COMMENT"}
            """))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }
}
