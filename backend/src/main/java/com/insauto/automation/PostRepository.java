package com.insauto.automation;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PostRepository extends JpaRepository<Post, UUID> {
    List<Post> findAllByOrderByCreatedAtDesc();
    List<Post> findByStatus(PostStatus status);
    List<Post> findByBatchIdOrderByBatchPositionAsc(UUID batchId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Post p where p.id = :id")
    Optional<Post> findLockedById(@Param("id") UUID id);

    @Query("select p.id from Post p where p.status = com.insauto.automation.PostStatus.SCHEDULED and p.scheduledAt <= :now order by p.scheduledAt")
    List<UUID> findDueIds(@Param("now") Instant now, Pageable pageable);
}
