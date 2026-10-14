# Instagram·Threads 계정 연결 설정

운영자가 Meta 앱을 한 번 설정하면, 사용자는 웹사이트의 **Instagram 연결**, **Threads 연결** 버튼에서 각 서비스에 로그인하고 게시 권한을 허용합니다. 계정 비밀번호나 액세스 토큰을 insAuto 화면에 직접 붙여 넣을 필요가 없습니다. 계정 연결과 실제 게시 성공은 별개이며, `SIMULATED`는 실제 게시가 아닙니다.

## 1. 운영자 환경 변수

저장소 루트의 로컬 `.env`에 설정하고 앱을 다시 시작합니다. `.env`는 커밋하지 않습니다.

```dotenv
INSTAGRAM_APP_ID=인스타그램_앱_ID
INSTAGRAM_APP_SECRET=인스타그램_앱_시크릿
THREADS_APP_ID=쓰레드_앱_ID
THREADS_APP_SECRET=쓰레드_앱_시크릿
PUBLIC_APP_URL=https://서비스의_정확한_호스트
FRONTEND_ORIGIN=https://서비스의_정확한_호스트
INSAUTO_SITE_PASSWORD=16자_이상의_사이트_접속_비밀번호
INSAUTO_TOKEN_ENCRYPTION_KEY=32바이트_난수의_Base64_값
```

- Instagram과 Threads의 **제품별** App ID·App Secret을 사용합니다. 일반 Meta 앱의 ID·Secret과 다를 수 있습니다.
- `PUBLIC_APP_URL`에는 사용자가 로그인 연결을 시작하는 웹사이트의 HTTPS 주소를 넣습니다. 경로, 쿼리, 프래그먼트는 넣지 않습니다.
- 공개 HTTPS 주소를 사용할 때 `FRONTEND_ORIGIN`을 `PUBLIC_APP_URL`과 같은 값으로 명시하고, 16자 이상의 `INSAUTO_SITE_PASSWORD`를 설정합니다. 먼저 사이트 비밀번호로 로그인한 다음 소셜 계정을 연결합니다. 서명된 사이트 세션은 8시간 동안 유효합니다.
- 토큰 암호화 키는 서버 전용 값입니다. 재시작 후에도 같은 키를 유지해야 저장한 계정 연결을 읽을 수 있습니다. 키가 유실되면 해당 계정을 다시 연결해야 합니다.
- `NEXT_PUBLIC_` 접두사 변수에 앱 시크릿, 액세스 토큰, 암호화 키를 넣지 않습니다.

암호화 키는 로컬 터미널에서 다음과 같이 생성할 수 있습니다. 출력값은 `.env`에만 보관합니다.

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

## 2. Instagram 앱 설정

1. [Meta 앱 대시보드](https://developers.facebook.com/apps/)에서 앱을 만들거나 기존 앱을 선택하고 **Instagram API with Instagram Login**을 설정합니다.
2. Instagram의 **비즈니스 또는 크리에이터 계정**을 준비합니다. 이 로그인 방식에서는 Facebook 페이지 연결이 필수는 아닙니다.
3. Instagram 비즈니스 로그인 설정의 Instagram App ID·App Secret을 위 환경 변수에 입력합니다.
4. 유효한 OAuth 리디렉션 URI에 아래 주소를 정확히 등록합니다.

   ```text
   https://서비스의_정확한_호스트/api/oauth/instagram/callback
   ```

5. `instagram_business_basic`, `instagram_business_content_publish` 권한을 설정합니다. 개발 중에는 앱에서 소유·관리하는 계정을 앱 대시보드에 등록해 테스트합니다. 그 밖의 사용자 계정에 서비스를 제공하려면 필요한 권한의 Advanced Access와 앱 검수 요건을 충족해야 합니다.
6. 웹사이트의 **Instagram 연결**을 누르고 연결할 계정으로 로그인하여 요청 권한을 허용합니다. 돌아온 화면에서 실제 계정 이름을 확인합니다.

이 방식은 Facebook Login의 `instagram_basic`, `instagram_content_publish` 권한 및 Facebook Page 토큰과 혼용하지 않습니다. [Instagram 공식 로그인 가이드](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login/), [Meta 공식 Instagram 컬렉션](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login)

## 3. Threads 앱 설정

1. Meta 앱에 **Threads API** 사용 사례를 설정합니다.
2. 앱 설정의 **Threads App ID**, **Threads App Secret**을 환경 변수에 입력합니다.
3. Threads 유효한 OAuth 리디렉션 URI에 아래 주소를 정확히 등록합니다.

   ```text
   https://서비스의_정확한_호스트/api/oauth/threads/callback
   ```

4. `threads_basic`, `threads_content_publish`, `threads_manage_replies` 권한을 요청합니다. 4편 연속글의 2~4편은 자신의 앞선 글에 답글로 게시하므로 답글 권한도 필요합니다. 기존에 두 권한만 허용해 연결했다면 다시 연결해 새 권한을 승인합니다.
5. 개발 중에는 앱 역할에서 **Threads 테스터**를 추가합니다. 해당 사용자가 Threads 웹사이트의 계정 설정 → 웹사이트 권한에서 초대를 수락한 뒤 연결합니다.
6. 웹사이트의 **Threads 연결**을 누르고 로그인·권한 허용을 완료합니다. 앱에 역할이 없는 일반 사용자를 받으려면 권한 검수를 통과하고 앱을 공개해야 합니다. [Threads 공식 시작 가이드](https://developers.facebook.com/docs/threads/get-started/), [답글 권한 설명](https://developers.facebook.com/docs/permissions#threads_manage_replies)

4편을 게시하기 전에 서버가 공식 `/v1.0/debug_token`으로 토큰의 유효성·대상 사용자·세 권한을 확인합니다. 권한이 없거나 확인에 실패하면 첫 글을 게시하지 않고 중지합니다. 앱 토큰은 `TH|앱_ID|앱_시크릿` 형태로 서버 안에서만 사용합니다. 권한 확인 URL과 원시 응답을 로그에 남기지 않습니다. [공식 토큰 검사](https://developers.facebook.com/documentation/threads/troubleshooting/debug-access-token), [앱 토큰](https://developers.facebook.com/documentation/threads/get-started/app-access-tokens)

## 4. 로컬 주소와 HTTPS

기본 개발 주소 `http://127.0.0.1:3001`은 화면·모의 실행 개발용입니다. Meta의 Threads 공식 예제는 OAuth 콜백에 HTTPS가 필요하며 `localhost` 리디렉션은 지원하지 않는다고 안내합니다. 실제 OAuth 시험에는 브라우저가 신뢰하는 HTTPS 인증서와 등록 가능한 호스트 이름을 준비하고, 브라우저에서 접속하는 주소·`PUBLIC_APP_URL`·Meta의 등록 URI를 일치시킵니다. 포트와 마지막 슬래시도 일치해야 합니다. [Meta 공식 예제의 로컬 설정](https://github.com/fbsamples/threads_api)

현재 서비스는 하나의 공유 작업 공간을 기준으로 합니다. 공개 HTTPS 프론트엔드는 명시한 원본 주소와 사이트 비밀번호를 사용해 접근을 제한합니다. OAuth는 소셜 계정 연결 수단이며 사이트 로그인과는 별개입니다. 이 비밀번호를 공유한 사람은 같은 작업 공간을 사용하므로, 독립적인 여러 고객을 받는 서비스에는 사용자별 계정·초안·게시 권한 분리가 추가로 필요합니다. 백엔드 API 키와 토큰 저장소는 프론트엔드 뒤의 서버에서만 사용합니다.

## 5. 게시 전 준비

- Instagram 이미지 게시에는 Meta 서버가 가져갈 수 있는 **공개 HTTPS JPEG 주소**가 필요합니다. 로컬 파일 경로, `localhost` 주소, 로그인해야 볼 수 있는 이미지 주소는 사용할 수 없습니다. 지원 이미지 크기는 최대 8MB, 가로세로비는 4:5~1.91:1입니다. 캡션은 최대 2,200자입니다. [공식 게시 가이드](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing/), [미디어 참고 자료](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/)
- Threads는 이미지 없이 텍스트로 게시할 수 있으며 일반 게시 본문은 최대 500자입니다. Meta는 이모티콘을 UTF-8 바이트 수로 계산한다고 명시합니다. [Threads 공식 게시 가이드](https://developers.facebook.com/docs/threads/posts/)
- 미디어 컨테이너를 생성했다는 응답만으로 게시가 끝난 것은 아닙니다. 처리 상태 확인과 게시 호출을 거쳐 외부 게시 ID를 받아야 실제 게시 성공으로 취급합니다.
- Threads 4편 연속글은 매 편의 컨테이너를 만들고 `FINISHED` 상태를 확인한 뒤 게시합니다. 2~4편은 직전 외부 게시 ID를 `reply_to_id`로 전달합니다. 자신의 루트 글에 이어 쓰는 방식이며, 다른 사람 글을 검색하거나 멘션을 조회하는 권한은 요청하지 않습니다. [공식 답글 생성](https://developers.facebook.com/docs/threads/retrieve-and-manage-replies/create-replies), [게시 상태 참고](https://developers.facebook.com/docs/threads/reference/publishing)
- 4편 전체·연결 계정을 확인한 뒤 게시합니다. `PUBLISHED`는 전체 완료, `PUBLISH_PARTIAL`은 앞선 글이 공개된 뒤 다음 편 준비에서 중지, `PUBLISH_UNKNOWN`은 마지막 요청의 실제 성공 여부를 확인해야 하는 상태입니다. `publishedIds`에 확인된 ID가 남으며 첫 글 ID만으로 전체 성공으로 판단하지 않습니다. 앞선 글 자동 취소·자동 재게시·남은 편 자동 재개는 하지 않습니다.
- 생년월일·태어난 시각 등 개인 입력은 운세 작성에 필요한 정보입니다. 공개되는 게시문과 이미지에 원본 개인정보를 넣을지는 별도로 확인합니다. 개인별 운세도 검증된 미래 예측으로 표현하지 않습니다.

## 6. 토큰 만료와 재연결

두 서비스의 OAuth 단기 토큰은 약 1시간, 장기 토큰은 약 60일간 유효합니다. 서버는 OAuth 코드를 교환하고 장기 토큰을 받은 뒤 암호화하여 저장해야 합니다. Meta 앱 시크릿과 토큰을 브라우저 응답이나 로그에 포함하지 않습니다.

플랫폼의 장기 토큰 갱신은 토큰 발급 후 24시간이 지나고 만료되기 전에 가능합니다. 현재 insAuto는 토큰 자동 갱신을 수행하지 않으므로, 만료되면 연결 버튼으로 다시 권한을 허용합니다. 만료된 토큰 자체를 갱신할 수는 없습니다. 권한 철회나 계정 상태 변경으로 만료일 전에 연결이 끊길 수도 있습니다. [Instagram 토큰 수명](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login/), [Threads 장기 토큰](https://developers.facebook.com/docs/threads/get-started/long-lived-tokens/)

## 구현 참고: 공식 엔드포인트

2026-10-14 확인. Instagram 시작 가이드의 예시는 `v26.0`, Threads 게시 가이드의 예시는 `v1.0`을 사용합니다. Threads의 최신 공식 문서·샘플은 `graph.threads.com`을 사용하며 일부 Meta Postman 예제에는 이전 `graph.threads.net` 주소가 남아 있습니다.

| 단계 | Instagram Login | Threads |
|---|---|---|
| 인증 시작 | `https://www.instagram.com/oauth/authorize` | `https://threads.com/oauth/authorize` |
| 코드 교환 | `POST https://api.instagram.com/oauth/access_token` | `POST https://graph.threads.com/oauth/access_token` |
| 장기 토큰 | `GET https://graph.instagram.com/access_token`, `grant_type=ig_exchange_token` | `GET https://graph.threads.com/access_token`, `grant_type=th_exchange_token` |
| 장기 토큰 갱신 | `GET https://graph.instagram.com/refresh_access_token`, `grant_type=ig_refresh_token` | `GET https://graph.threads.com/refresh_access_token`, `grant_type=th_refresh_token` |
| 계정 확인 | `GET https://graph.instagram.com/v26.0/me?fields=user_id,username` | `GET https://graph.threads.com/v1.0/me?fields=id,username` |
| 이미지/텍스트 컨테이너 생성 | `POST /v26.0/{ig-user-id}/media` | `POST /v1.0/{threads-user-id}/threads` |
| 컨테이너 상태 | `GET /v26.0/{container-id}?fields=status_code,status` | `GET /v1.0/{container-id}?fields=status,error_message` |
| 실제 게시 | `POST /v26.0/{ig-user-id}/media_publish` | `POST /v1.0/{threads-user-id}/threads_publish` |

OAuth 시작에는 `client_id`, `redirect_uri`, `response_type=code`, 필요한 `scope` 및 일회성 `state`를 사용합니다. `state`는 연결을 시작한 브라우저에 묶어 검증합니다. 코드 교환에는 `client_id`, `client_secret`, `grant_type=authorization_code`, 같은 `redirect_uri`, `code`를 서버에서 전송합니다. 장기 토큰 교환에는 해당 앱의 `client_secret`과 단기 `access_token`도 필요합니다.

Instagram의 계정 응답에서 `user_id`는 Instagram 프로페셔널 계정 ID이고 `id`는 앱 범위 ID입니다. 공식 예제에 `data: [{...}]` 형태가 있으므로 단일 객체 응답과 명확히 구분해 처리합니다. [Instagram 계정 확인](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started/), [Threads 인증 코드 교환](https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions/), [Meta Threads 공식 구현 예제](https://github.com/fbsamples/threads_api/blob/main/src/index.js)
