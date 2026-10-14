package com.insauto.automation;

import org.springframework.stereotype.Component;

/** Deliberately has no HTTP client, access token, or publishing side effects. */
@Component
public class DryRunPublisher {
    public String simulate(Post post) {
        return "DRY_RUN completed for " + post.platform + ". No content was sent to Meta or published.";
    }
}
