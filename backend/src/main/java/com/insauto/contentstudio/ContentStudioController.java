package com.insauto.contentstudio;

import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import static com.insauto.contentstudio.ContentStudioModels.*;

@RestController
@RequestMapping("/api/v1/content-studio")
public class ContentStudioController {
    private final ContentStudioService service;
    public ContentStudioController(ContentStudioService service) { this.service = service; }
    @GetMapping("/options") public Options options() { return service.options(); }
    @PostMapping("/generate")
    public ResponseEntity<Generated> generate(@Valid @RequestBody GenerateRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.generate(request));
    }
}
