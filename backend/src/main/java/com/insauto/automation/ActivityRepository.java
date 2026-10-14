package com.insauto.automation;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ActivityRepository extends JpaRepository<Activity, UUID> {
    List<Activity> findTop50ByOrderByCreatedAtDesc();
    long countByPostIdAndType(UUID postId, ActivityType type);
}
