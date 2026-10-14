package com.insauto.meta;

import com.insauto.automation.Platform;
import com.insauto.meta.ConnectionModels.*;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/connections")
public class ConnectionController {
    private final ConnectionService service;
    public ConnectionController(ConnectionService service) { this.service = service; }
    @GetMapping public List<ConnectionView> list() { return service.list(); }
    @PostMapping("/{platform}/oauth/start") public OAuthStart start(@PathVariable Platform platform) { return service.start(platform); }
    @PostMapping("/{platform}/oauth/complete") public ConnectionView complete(@PathVariable Platform platform, @Valid @RequestBody OAuthComplete body) {
        return service.complete(platform, body);
    }
    @DeleteMapping("/{platform}") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void disconnect(@PathVariable Platform platform) { service.disconnect(platform); }
}
