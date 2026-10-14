package com.insauto.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class ApiKeyFilter extends OncePerRequestFilter {
    private final byte[] expected;
    private final ObjectMapper mapper;

    public ApiKeyFilter(@Value("${insauto.api-key}") String apiKey, ObjectMapper mapper) {
        if (apiKey.isBlank()) throw new IllegalArgumentException("INSAUTO_API_KEY must not be blank.");
        this.expected = apiKey.getBytes(StandardCharsets.UTF_8);
        this.mapper = mapper;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getServletPath();
        if (path.isEmpty()) path = request.getRequestURI().substring(request.getContextPath().length());
        return !path.startsWith("/api/v1") || (path.equals("/api/v1/health") && request.getMethod().equals("GET"));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
        throws ServletException, IOException {
        String supplied = request.getHeader("X-API-Key");
        String authorization = request.getHeader("Authorization");
        if (authorization != null && authorization.regionMatches(true, 0, "Bearer ", 0, 7)) {
            supplied = authorization.substring(7);
        }
        if (supplied == null || !MessageDigest.isEqual(expected, supplied.getBytes(StandardCharsets.UTF_8))) {
            response.setStatus(401);
            response.setContentType("application/problem+json");
            mapper.writeValue(response.getOutputStream(), Map.of("type", "urn:insauto:error:UNAUTHORIZED", "title", "Unauthorized",
                "status", 401, "detail", "A valid Bearer token or X-API-Key header is required.", "instance", request.getRequestURI(), "code", "UNAUTHORIZED"));
            return;
        }
        chain.doFilter(request, response);
    }
}
