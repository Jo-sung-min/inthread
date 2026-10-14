package com.insauto.meta;

import com.insauto.automation.Platform;
import java.net.URI;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class MetaSettings {
    final String instagramId, instagramSecret, threadsId, threadsSecret, publicAppUrl, instagramVersion;

    public MetaSettings(@Value("${INSTAGRAM_APP_ID:}") String instagramId,
                        @Value("${INSTAGRAM_APP_SECRET:}") String instagramSecret,
                        @Value("${THREADS_APP_ID:}") String threadsId,
                        @Value("${THREADS_APP_SECRET:}") String threadsSecret,
                        @Value("${PUBLIC_APP_URL:}") String publicAppUrl,
                        @Value("${INSTAGRAM_GRAPH_VERSION:v26.0}") String instagramVersion) {
        this.instagramId = instagramId.strip(); this.instagramSecret = instagramSecret.strip();
        this.threadsId = threadsId.strip(); this.threadsSecret = threadsSecret.strip();
        this.publicAppUrl = publicAppUrl.strip().replaceAll("/+$", "");
        if (!instagramVersion.matches("v[0-9]+\\.[0-9]+")) throw new IllegalArgumentException("Invalid Instagram API version.");
        this.instagramVersion = instagramVersion;
    }

    String appId(Platform p) { return p == Platform.INSTAGRAM ? instagramId : threadsId; }
    String secret(Platform p) { return p == Platform.INSTAGRAM ? instagramSecret : threadsSecret; }
    String callback(Platform p) { return publicAppUrl + "/api/oauth/" + p.name().toLowerCase(Locale.ROOT) + "/callback"; }

    String configurationMessage(Platform p, boolean vaultReady) {
        if (appId(p).isBlank() || secret(p).isBlank()) return "운영자가 Meta 앱 ID와 시크릿을 서버에 설정해야 합니다.";
        if (!validPublicOrigin(publicAppUrl)) return "계정 연결을 위해 운영자가 공개 HTTPS 사이트 주소를 설정해야 합니다.";
        if (!vaultReady) return "운영자가 계정 토큰 암호화 키를 서버에 설정해야 합니다.";
        return null;
    }

    static boolean validPublicOrigin(String value) {
        try {
            URI uri = URI.create(value);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            return "https".equals(uri.getScheme()) && host.matches("[a-z0-9][a-z0-9.-]*\\.[a-z]{2,63}")
                && !host.endsWith(".localhost") && !host.endsWith(".local") && !host.endsWith(".internal")
                && uri.getUserInfo() == null && uri.getQuery() == null && uri.getFragment() == null
                && (uri.getPort() == -1 || uri.getPort() == 443) && (uri.getPath().isEmpty() || uri.getPath().equals("/"));
        } catch (IllegalArgumentException e) { return false; }
    }
}
