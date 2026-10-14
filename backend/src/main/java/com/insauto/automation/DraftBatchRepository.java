package com.insauto.automation;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
interface DraftBatchRepository extends JpaRepository<DraftBatch, UUID> {}
