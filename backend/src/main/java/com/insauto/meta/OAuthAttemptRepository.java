package com.insauto.meta;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Optional;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
interface OAuthAttemptRepository extends JpaRepository<OAuthAttempt, String> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from OAuthAttempt a where a.stateHash = :hash")
    Optional<OAuthAttempt> findLocked(@Param("hash") String hash);
    void deleteByExpiresAtBefore(Instant instant);
}
