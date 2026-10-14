package com.insauto.fortune;

import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import static com.insauto.fortune.FortuneModels.*;

@RestController
@RequestMapping("/api/v1/fortunes")
public class FortuneController {
    private final FortuneService service;
    public FortuneController(FortuneService service) { this.service = service; }

    @PostMapping("/preview")
    public ResponseEntity<Preview> preview(@Valid @RequestBody PreviewRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.preview(request));
    }
}
