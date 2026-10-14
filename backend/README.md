# InsAuto backend

Spring Boot **3.5.16**, Java **21**, Gradle **8.14.3**. `fatell/backend`의 버전에 맞췄습니다.

## 실행

```powershell
.\gradlew.bat bootRun
```

기본 주소는 `http://127.0.0.1:8081`이며 파일 데이터베이스가 `backend/data/insauto.mv.db`에 생성됩니다. 실행 디렉터리를 `backend`로 유지하세요.

- `INSAUTO_API_KEY`: 기본값 `local-dev-key`. 외부 공개 전 반드시 변경하세요.
- `SERVER_ADDRESS`: 기본값 `127.0.0.1`. 컨테이너에서는 `0.0.0.0`을 설정하세요.
- `SERVER_PORT`: 기본값 `8081`.
- `INSAUTO_SCHEDULER_ENABLED`: 기본값 `true`.
- `INSAUTO_SCHEDULER_INTERVAL_MS`: 기본값 `15000`.
- `DATABASE_URL`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`: 데이터베이스 연결 설정.
- `SPRING_PROFILES_ACTIVE=postgres`: PostgreSQL을 사용할 때 설정하세요.

기본 H2 파일 DB는 단일 백엔드 프로세스용입니다. 현재 실제 게시 복구는 단일 백엔드 인스턴스용입니다. PostgreSQL을 사용하더라도 여러 인스턴스로 동시에 운영하지 마세요. H2와 PostgreSQL에 같은 Flyway SQL을 적용합니다. 기본 인증은 개인용 단일 API 키이며 사용자별 권한이나 다중 사용자 격리는 아직 없습니다.

## API

`GET /api/v1/health`, `GET /openapi.yaml`은 공개입니다. 나머지 `/api/v1` 요청은 `Authorization: Bearer <INSAUTO_API_KEY>` 또는 `X-API-Key: <INSAUTO_API_KEY>`가 필요합니다. OpenAPI는 GPT Actions에 맞게 Bearer 인증과 고정 `operationId`를 제공합니다. 외부 AI 연결 시 OpenAPI의 `servers`를 실제 HTTPS 배포 주소로 변경하세요.

- `GET /api/v1/posts`: 최신순 게시물 목록
- `POST /api/v1/posts`: `{ "platform": "THREADS", "text": "안녕하세요", "mediaUrl": null }`
- `PATCH /api/v1/posts/{id}`: 초안의 `text`, `mediaUrl` 전체 교체. 플랫폼은 바뀌지 않으며 `mediaUrl`을 생략하거나 null로 보내면 이미지 URL을 지웁니다.
- `POST /api/v1/posts/{id}/schedule`: `{ "scheduledAt": "2030-01-01T09:00:00+09:00" }`
- `POST /api/v1/posts/{id}/cancel-schedule`: 예약 취소
- `POST /api/v1/posts/{id}/dry-run`: 즉시 모의 실행
- `GET /api/v1/activity`: 최근 50개 작업 기록
- `GET /api/v1/channels`: 채널별 제한과 연결 상태

예약과 즉시 실행은 `DRAFT`에서만 가능합니다. 예약 취소는 `SCHEDULED`에서만 가능하며 `DRAFT`로 돌아갑니다. `SIMULATED`는 종료 상태입니다. 반복 요청은 상태 충돌 `409`를 반환해 중복 실행을 막습니다. 초안 생성은 멱등하지 않으므로 응답을 잃었을 때 목록을 확인하고 재시도하세요.

실제 계정 연결과 명시적 실게시를 지원합니다. OAuth 및 암호화 설정은 `../docs/meta-setup.md`를 확인하세요. `POST /api/v1/posts/{id}/publish`에 확인한 `accountId`와 `expectedUpdatedAt`을 보내며, 게시 준비/응답 유실을 구분해 자동 재전송을 차단합니다. 예약은 여전히 **DRY_RUN**입니다. `SIMULATED`는 게시 성공을 뜻하지 않습니다. 예약 실행은 약 15초마다 최대 100건을 처리합니다. 게시물별 DB 잠금과 같은 트랜잭션의 상태/활동 기록으로 동시 실행을 방지합니다. 실제 게시는 네트워크 호출 전에 실행 상태를 커밋하고 중복 요청을 차단합니다. 응답 유실·중단 후 재시작은 PUBLISH_UNKNOWN 상태로 남깁니다.

Threads는 500자, Instagram은 2200자까지 지원하며 Unicode 코드 포인트로 계산합니다. Instagram은 예약/모의 실행 전에 이미지 URL이 필요합니다. 이미지 URL이 빠진 Instagram 초안은 초안 수정 API로 이미지 URL을 추가한 뒤 실행할 수 있습니다. URL은 HTTPS 공개 도메인 형식만 검사하고 다운로드하지 않습니다. DNS 접근성, 파일 종류, 실제 이미지 여부는 확인하지 않습니다.

## 콘텐츠 작업실과 연속 게시

- `GET /api/v1/content-studio/options`: 주제·표현 장치·말투 목록.
- `POST /api/v1/content-studio/generate`: `topicIds`, `count`(1~12), `tone`, `devices`, `cta`로 4부작 미리보기 생성. TEMPLATE 방식이며 저장/게시는 하지 않습니다.
- `POST /api/v1/posts/batch`: UUID `requestId`와 1~12개의 `posts`. 같은 ID와 내용은 기존 초안 ID들을 순서대로 반환하고, 같은 ID의 다른 내용은 409를 반환합니다. 저장은 하나의 트랜잭션입니다.
- Threads 생성/수정 DTO의 `segments`: 빈 배열 또는 정확히 4개의 문단. 첫 문단은 `text`와 같아야 하며 각 편 500자 이하입니다. 수정 시 생략하면 기존 나머지 편을 유지하고, `[]`는 단일 글로 변경합니다.
- 시리즈 실게시: 기존 `/publish`에 전체 내용을 검토한 버전과 계정을 보냅니다. 답글 권한 사전 검사 → 첫 글 → 직전 확인된 게시 ID에 답글 연결. `publishedIds`는 게시 순서대로 누적합니다. 이후 준비 실패는 `PUBLISH_PARTIAL`, 전송 결과 불명은 `PUBLISH_UNKNOWN`이며 자동 재전송하지 않습니다.

새 데이터 구조는 Flyway V3로 적용됩니다. 기존 단일 게시물의 확인된 게시 ID도 순서형 기록으로 이관합니다. 실제 게시 HTTP 요청은 시리즈 처리 시간을 고려해 최대 360초를 허용하고, 응답이 끊기면 목록 조회로 상태를 확인하세요.
## 검증

```powershell
.\gradlew.bat test
.\gradlew.bat bootJar
```

통합 테스트는 API 인증, 입력 제한, 상태 전이, DB 저장, 예약 처리, 동시 실행 시 단일 기록을 검증합니다. PostgreSQL 실제 연결과 Meta 게시 호출은 이 테스트에 포함되지 않습니다.

개인 운세: POST /api/v1/fortunes/preview. 연결 목록: GET /api/v1/connections. 세부 DTO와 OAuth 경로는 OpenAPI를 확인하세요. 출생 입력은 저장하지 않습니다.
