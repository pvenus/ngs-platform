# Shared prop workspace

The Local and Space shell serve the same browser module and use the shared
workspace replica registry. `프랍 설계` lists published folders and small latest
pointers (`props/<propId>/metadata.json`) without opening packages or images.
The roster search matches title and folder ID without changing the selected detail.
The query and scroll position are restored within the browser session.
A selection verifies the actual immutable manifest SHA and resolves only its
typed assets. The inline Detail and Pixel previews loop until stopped or the page changes.
Only the browser preview copy loops; published files and puzzle playback remain
one-shot. Preview URLs are same-origin; individual APNGs are only fetched
on play. No Local draft, fixture overlay, generic file query or NPC video route.

Writes use the existing authenticated `/api/requests` queue. On native
Mac NGS, the private server checks the actual Request Service MCP
`request_submit` schema (read-only `tools/list`) before showing the Add or
Regenerate controls, and rechecks before enqueueing. It accepts only the
confirmed static `still` mode for creation/regeneration. A separate
`prop.animation.generate` schema with the selected source revision and SHA
enables only the existing-prop animation action, never a create/regenerate
mode. An inaccessible or mismatched schema produces no active control. The normal RS-MCP relay must be at this same release before
activating the native app. It forwards the typed request; there is no direct
browser call to the Request Service.

The common Space UI also requires explicit server capabilities. Its
`NGS_PROP_GENERATE_ENABLED`, `NGS_PROP_REGENERATE_ENABLED` and
`NGS_PROP_ANIMATION_ENABLED` settings are off by default; this Mac deployment
does not set them or publish Space. Space applies its existing active Binari
participant roster to the `props` resource, not the queue-only exception.
The design pin additionally requires the existing `concept` grant.

To adopt the existing private Mac preview release, the reviewed ordinary OPS
assembler and native executor recognize an owner-pinned
`project-page-local-candle-<40 hex>` only as a predecessor, with the matching
commit binding and execution directory. Destination is always the verified
GitHub artifact. Queue, Miniflare data, startup/schema pins and preview files
are unchanged. The usual private predecessor plist/rollback is retained.

`prop.generate` is a complete creation intent, not an image request.
The Add popup may choose one reference from the published prop list
(default: none). The submission pins that folder's revision and manifest
SHA, uses its detail image in the generation worker, and creates a
different, new folder. A reference that has changed or disappeared must be
selected again. Only CREATE accepts a reference; geometry consistency is
guided by the image, not guaranteed by exact compositing.
A regeneration targets one current published folder by revision and SHA.
It replaces the active pointer only after a full new package is published;
prior versions and assets remain preserved. Existing animations are not copied
into the new version by default.
A named animation request targets one current folder and accepts one prompt,
with no preset pickers and no new base image. Accepted responses only prove
queueing; assets remain listed only after canonical publication and normal
replica sync. This change does not install runtime providers or author test
assets in the real project.

### 시네마틱 배치 이미지와 서진 능력 미리보기

새 생성·재생성의 `spirit-v1` 프로필은 큰 원본과 동일한 프레이밍을 쓰는 1/5 크기의
시네마틱 배치 이미지와 1/5 픽셀 후처리 결과를 같은 프랍 묶음에 보관한다. 크기는 각
원본 축의 1/5을 반올림한다. 원본을 누르면 확대 팝업을 열며 원본은 능력 전환과 독립적이다.
기본 정보에서 ‘서진 능력 사용’을 누르면 배치 미리보기만 픽셀(OFF)과 시네마틱(ON)
사이를 오간다. 기존 디테일·픽셀만 있는 프랍과 두 레인의 프랍 애니메이션은 계속 읽을 수 있다.

## 정식 픽셀 프랍 (spirit-v2)

시네마틱 원본을 먼저 확정하고, 같은 오브젝트를 픽셀 아트로 다시 생성합니다. 픽셀 이미지 생성은 시네마틱 원본의 구도와 바닥 기준점을 참조하며, 완성된 픽셀 그림을 원본 크기의 1/5로 축소한 뒤 팔레트와 알파를 보정합니다. 시네마틱 원본을 부드럽게 1/5로 줄인 영시용 가지는 별도이며 픽셀 이미지를 입력으로 사용하지 않습니다. 중간 생성 PNG는 편집 목록에 노출하지 않습니다. 기존 spirit-v1 요청은 원래 계약으로 마감되고 공개 프랍은 자동 재생성하지 않습니다.

## 여러 배율의 프랍

최초 `prop.generate` 요청은 `scalePercents`로 100, 90, …, 10, 5 중
여러 값을 선택할 수 있다. 기존 요청에 필드가 없으면 기존 배치 결과를 사용한다.
큰 시네마틱 원본은 보존되고, 선택한 배율마다 같은 캔버스 크기의 픽셀·시네마틱
배치 PNG 쌍을 등록한다. 해당 배율은 원본 전체의 가로·세로에 적용되므로 50%는
가로와 세로 각각 절반이다.

`prop.scale.generate`는 기존 프랍 ID, 현재 리비전·해시, 아직 게시되지 않은
배율 목록을 받는 별도 정식 요청이다. 새 리비전에 이미지를 추가하며 원본,
애니메이션, 이전 배율은 유지한다. 생성된 픽셀 원본 기반 자산은 새 요청의
후속 배율용으로 유지할 수 있지만, 배치 선택지나 상세 원본으로는 표시하지 않는다.
이 자산이 없는 구형 프랍의 더 큰 픽셀 버전은 기존 픽셀을 확대하므로 새 디테일이
생기지 않는다.

조립 플레이의 퍼즐 바인딩과 맵 꾸미기의 배치 프랍은 선택한 배율
`imageScalePercent`를 프랍 리비전·해시와 함께 저장한다. 배치 후 조절하는
`scale`은 이 배율 이미지에 적용하는 별도 값이다. 이전 바인딩은 해당 필드 없이
기존 기준 이미지로 계속 동작한다. 최신 프랍 이미지가 필요하면 에디터에서
명시적으로 다시 연결할 수 있다.

로컬은 Request Service가 두 배율 계약을 광고할 때만 선택 UI를 활성화한다.
Space 배포에서는 기존 설정에 더해 `NGS_PROP_SCALE_ENABLED=1`이 필요하며,
이 변경으로 운영 설정을 자동으로 바꾸지 않는다.
