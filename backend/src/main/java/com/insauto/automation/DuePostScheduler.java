package com.insauto.automation;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "insauto.scheduler.enabled", havingValue = "true", matchIfMissing = true)
public class DuePostScheduler {
    private static final Logger log = LoggerFactory.getLogger(DuePostScheduler.class);
    private final PostRepository posts;
    private final PostService service;
    private final Clock clock;

    public DuePostScheduler(PostRepository posts, PostService service, Clock clock) {
        this.posts = posts;
        this.service = service;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "${insauto.scheduler.interval-ms:15000}")
    public void runDuePosts() {
        Instant now = clock.instant();
        for (UUID id : posts.findDueIds(now, PageRequest.of(0, 100))) {
            try {
                service.simulateIfDue(id, now);
            } catch (RuntimeException ex) {
                // Do not log post text, URLs, credentials, or upstream response bodies.
                log.warn("Scheduled dry run failed for post {} ({})", id, ex.getClass().getSimpleName());
            }
        }
    }
}
