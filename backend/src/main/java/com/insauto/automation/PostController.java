package com.insauto.automation;

import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import static com.insauto.automation.ApiModels.*;

@RestController
@RequestMapping("/api/v1")
public class PostController {
    private final PostService service;
    private final DraftBatchService batches;
    private final LivePublishService livePublisher;
    private final com.insauto.meta.ConnectionService connections;

    public PostController(PostService service, LivePublishService livePublisher, com.insauto.meta.ConnectionService connections, DraftBatchService batches) {
        this.service = service; this.batches = batches; this.livePublisher = livePublisher; this.connections = connections;
    }

    @GetMapping("/health")
    public Map<String, String> health() { return Map.of("status", "UP", "mode", "EXPLICIT_LIVE_PUBLISH"); }

    @GetMapping("/posts")
    public List<PostView> listPosts() { return service.list(); }

    @PostMapping("/posts")
    @ResponseStatus(HttpStatus.CREATED)
    public PostView createPost(@Valid @RequestBody CreatePost request) { return service.create(request); }

    @PostMapping("/posts/batch")
    @ResponseStatus(HttpStatus.CREATED)
    public BatchView createBatch(@Valid @RequestBody CreateBatch request) { return batches.create(request); }
    @PatchMapping("/posts/{id}")
    public PostView updateDraft(@PathVariable UUID id, @Valid @RequestBody UpdatePost request) {
        return service.update(id, request);
    }

    @PostMapping("/posts/{id}/schedule")
    public PostView schedulePost(@PathVariable UUID id, @Valid @RequestBody SchedulePost request) {
        return service.schedule(id, request.scheduledAt());
    }

    @PostMapping("/posts/{id}/cancel-schedule")
    public PostView cancelSchedule(@PathVariable UUID id) { return service.cancelSchedule(id); }

    @PostMapping("/posts/{id}/dry-run")
    public PostView dryRunPost(@PathVariable UUID id) { return service.dryRun(id); }

    @PostMapping("/posts/{id}/publish")
    public PostView publishPost(@PathVariable UUID id, @Valid @RequestBody PublishPost request) {
        return livePublisher.publish(id, request);
    }

    @GetMapping("/activity")
    public List<ActivityView> listActivity() { return service.activity(); }

    @GetMapping("/channels")
    public List<ChannelView> listChannels() {
        return connections.list().stream().map(c -> new ChannelView(c.platform(),
            c.platform() == Platform.INSTAGRAM ? "Instagram" : "Threads", c.connected(),
            c.connected() ? "LIVE_AVAILABLE" : "DRY_RUN", c.platform().textLimit(),
            c.connected() ? "실제 게시 가능. 예약은 모의 실행이며 실제 게시 버튼으로만 전송합니다."
                : "계정을 연결하면 실제 게시가 가능합니다. 예약은 모의 실행입니다.")).toList();
    }
}
