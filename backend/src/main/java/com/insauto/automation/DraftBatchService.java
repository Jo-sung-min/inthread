package com.insauto.automation;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.HexFormat;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import static com.insauto.automation.ApiModels.*;

/** A single-server lock covers the full commit, including concurrent replay of a previously unseen key. */
@Service
public class DraftBatchService {
    private final DraftBatchRepository batches;
    private final PostRepository posts;
    private final PostService drafts;
    private final ObjectMapper mapper;
    private final Clock clock;
    private final TransactionTemplate transaction;

    public DraftBatchService(DraftBatchRepository batches, PostRepository posts, PostService drafts,
                             ObjectMapper mapper, Clock clock, PlatformTransactionManager manager) {
        this.batches = batches; this.posts = posts; this.drafts = drafts; this.mapper = mapper; this.clock = clock;
        this.transaction = new TransactionTemplate(manager);
    }

    public synchronized BatchView create(CreateBatch request) {
        if (request.requestId() == null || request.posts() == null || request.posts().isEmpty() || request.posts().size() > 12)
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_BATCH", "한 번에 1~12개 초안과 저장 요청 ID를 보내 주세요.");
        String hash = fingerprint(request);
        return transaction.execute(tx -> {
            DraftBatch existing = batches.findById(request.requestId()).orElse(null);
            if (existing != null) {
                if (!existing.payloadHash.equals(hash)) throw new ApiException(HttpStatus.CONFLICT, "BATCH_KEY_REUSED", "이미 사용한 저장 요청 ID입니다. 변경된 글은 새 요청 ID로 저장해 주세요.");
                return new BatchView(posts.findByBatchIdOrderByBatchPositionAsc(existing.id).stream().map(PostView::from).toList());
            }
            DraftBatch batch = batches.saveAndFlush(new DraftBatch(request.requestId(), hash, clock.instant()));
            int position = 0;
            for (CreatePost input : request.posts()) {
                if (input == null) throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_BATCH", "초안 항목이 비어 있습니다.");
                PostView view = drafts.create(input);
                Post post = posts.findById(view.id()).orElseThrow();
                post.batchId = batch.id; post.batchPosition = position++;
            }
            posts.flush();
            return new BatchView(posts.findByBatchIdOrderByBatchPositionAsc(batch.id).stream().map(PostView::from).toList());
        });
    }

    private String fingerprint(CreateBatch request) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(mapper.writeValueAsBytes(request.posts()))); }
        catch (Exception ex) { throw new IllegalStateException("Could not fingerprint the draft batch."); }
    }
}
