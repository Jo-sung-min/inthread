package com.insauto.automation;

import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class ApiExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);
    @ExceptionHandler(ApiException.class)
    ResponseEntity<ProblemDetail> handleApi(ApiException ex, HttpServletRequest request) {
        return problem(ex.status, ex.code, ex.getMessage(), request, null);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ProblemDetail> handleValidation(MethodArgumentNotValidException ex, HttpServletRequest request) {
        Map<String, String> errors = new LinkedHashMap<>();
        ex.getBindingResult().getFieldErrors().forEach(error -> errors.putIfAbsent(error.getField(), error.getDefaultMessage()));
        return problem(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Correct the invalid request fields.", request, errors);
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class})
    ResponseEntity<ProblemDetail> handleMalformed(Exception ex, HttpServletRequest request) {
        return problem(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Invalid JSON, enum value, UUID, or timestamp. Timestamps must include a UTC offset.", request, null);
    }

    @ExceptionHandler({NoResourceFoundException.class, HttpRequestMethodNotSupportedException.class,
        HttpMediaTypeNotSupportedException.class, HttpMediaTypeNotAcceptableException.class})
    ResponseEntity<ProblemDetail> handleHttp(Exception ex, HttpServletRequest request) {
        HttpStatus status = HttpStatus.valueOf(((ErrorResponse) ex).getStatusCode().value());
        return problem(status, "HTTP_" + status.value(), status.getReasonPhrase(), request, null);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ProblemDetail> handleUnexpected(Exception ex, HttpServletRequest request) {
        log.error("API request failed ({})", ex.getClass().getSimpleName());
        return problem(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "An unexpected server error occurred.", request, null);
    }

    private ResponseEntity<ProblemDetail> problem(HttpStatus status, String code, String detail,
                                                  HttpServletRequest request, Map<String, String> errors) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setType(URI.create("urn:insauto:error:" + code));
        problem.setInstance(URI.create(request.getRequestURI()));
        problem.setProperty("code", code);
        if (errors != null) problem.setProperty("errors", errors);
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_PROBLEM_JSON).body(problem);
    }
}
