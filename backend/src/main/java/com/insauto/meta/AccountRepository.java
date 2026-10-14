package com.insauto.meta;
import com.insauto.automation.Platform;
import org.springframework.data.jpa.repository.JpaRepository;
interface AccountRepository extends JpaRepository<ConnectedAccount, Platform> {}
