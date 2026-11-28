# 정식 프랍 묶음과 퍼즐 참조 (v1)

프랍 하나는 정식 `prop.generate`의 결과 한 건이다. 기본 비픽셀·픽셀 이미지 한 쌍, 내장 클릭 영역, 그리고 별도 생성한 이름 있는 애니메이션을 같은 **프랍 폴더**에서 관리한다. 기존 로컬 촛불 시제품을 덮어쓰거나 정식 결과로 표시하지 않는다.

## 원본 Filex & 카탈로그

NPC와 같은 프로젝트 하위 폴더 스코프를 사용한다. PDS가 요청/프로젝트 권한을 확인한 뒤 Filex에 저장하고, NGS가 승인된 원본 포인터를 읽는다.

- `canonical-files/binari/props/<propId>/metadata.json`: 작은 최신 포인터 `{schemaVersion:"ngs.prop-pointer.v1",projectId:"binari",propId,title,revision,sha256}`.
- `…/releases/<revision>/manifest.json`: 해당 정식 요청에서 확정한 불변 매니페스트.
- `…/assets/<sha256>.png`: 동일 프랍 폴더 안의 실측 콘텐츠 해시 자산. 확장자는 PNG 계열 공통, PNG/APNG 타입은 매니페스트가 구분한다.

목록은 폴더 및 포인터만 읽는다. 상세에서만 선택한 매니페스트, 재생에서만 그 프랍의 기본 자산 및 선택한 클립을 읽는다. 기존 확정 버전의 변경이나 최신 버전 자동 대체는 없다. 새 등록·배율 생성·애니메이션 등록 끝에는 최신 포인터를 이전 `revision + sha256` 기준으로 원자적으로 비교해 교체해야 한다. 파일 배치·원자 비교는 공유 계약이 아니라 Filex 저장 어댑터의 책임이다.

## 완성 묶음과 검증

`ngs.prop-package.v1` 필드는 `{schemaVersion,projectId,propId,revision,officialRequestId,requestSha256,designContextSha256,title,parentSha256,media,interaction,animations}`. 최초 `revision:1,parentSha256:null`; 이후 부모 매니페스트의 정확한 SHA-256. 영수증은 `prop.package.<sha256(canonical JSON UTF-8)>`이고 canonical JSON은 모든 객체 키 정렬, 배열은 그대로, 여백 없이 직렬화한다.

- `media:{detail,pixel}` (기존) 또는 `media:{detail,pixel,spirit}` (시네마틱 배치 프로필): 8비트 RGBA 정지 PNG 두 장. 각 매체는 `{assetId,sha256,bytes,width,height,mediaType,frameDurationsMs}`. `assetId=sha256+".png"`; 정지는 `image/png`와 빈 시간 배열. 픽셀은 같은 프레이밍 비율의 별도 작은 원본.
- `interaction:{pixelOpen,detailTrigger}`: 각기 `null` 또는 해당 이미지 자연 좌표의 `{action,x,y,width,height}`. 픽셀 `open`, 비픽셀 `activate`만 허용. 일반 입력이나 스크립트 실행을 열지 않는다. 클릭 영역은 이미지에 귀속되고 퍼즐 배치 좌표와 분리한다.
- `animations:[{id,title,officialRequestId,requestSha256,media}]`: 별도 생성 요청 한 번마다 이름 있는 클립 하나를 추가. 기존 미디어·영역·클립은 이 요청에서 바꾸지 않는다. 과거 전체 재생성 요청의 매니페스트도 계속 조회할 수 있지만 해당 요청을 신규 접수하지 않는다. 배율 추가 요청은 선택 배율의 이미지 쌍만 다시 처리하고 다른 자산은 유지한다.
- 클립 양쪽은 `image/apng`, 같은 정밀한 정수 밀리초 프레임 배열, 각각 기본과 동일한 자연 해상도. 규격상 PNG/APNG는 필터를 실제로 디코딩한다. 각 전체 프레임에 투명 픽셀과 보이는 픽셀이 있어야 하며, APNG는 1회 재생 및 같은 크기의 독립 RGBA 프레임(Offset=0, dispose=none, blend=source)만 받는다. RGB, 불투명 RGBA, 빈 결과, 한쪽만 움직임, 이름만 APNG는 거부한다. 일반 최적화됐거나 논리 프레임이 다른 APNG는 게시 전에 이 프로필로 다시 인코딩한다.

## 동일 Local / Space 플레이어 입력

두 호스트는 동일 `prop-package-contract.mjs` 소스를 사용한다. 퍼즐은 `{propRef:{propId,revision,sha256},placement:{x,y},start:"manual"|"on-entry",animationId:null|id}`만 참조하며 프랍 생성이나 매체를 다시 해석하지 않는다. 조회 어댑터는 요청한 프로젝트·프랍·해시 범위 지키고, 공용 `resolvePropPlayback`은 그 반환 바이트를 다시 검증한다. `projectPropPlayer`는 URL/경로 없이 `ngs.prop-player-input.v1`을 고정 WASM 런타임에 전달한다. 부모 퍼즐/호스트는 클릭 결과와 재생 토큰을 받을 뿐이며 후속 이야기/다른 프랍 전환만 결정한다.

## 실제 파이프라인과 남은 연결

운영은 코드 기반 Planner를 사용한다. 현재 활성 단일 이미지 공식 경로에는 이미 정식 PDS 자료 읽기/alpha PNG 입증이 있지만, 다단계 프랍 결과가 자동 등록됐다는 뜻은 아니다. 제안한 경로는 공식 요청 → Master Visual/Prop Design + 의도 고정 → 문서 메타 및 단일 기본 이미지 → 선택한 경우만 I2V RGB → 주제 알파 추출/정규화와 픽셀 파생 → PDS/Filex 검증/포인터 확정이다.

- 별도 스테이징 INT8 I2V는 실제 입력 이미지 → RGB PNG 프레임만 출력한다. Q8_0 체크포인트, Wan2.2 VAE, GGUF 로더가 Mac에 없어 실제 호출 미검증. 기존 NPC 후처리에서 중요한 알파 및 축소 primitives는 재사용할 수 있으나 입출력은 NPC/pose/direction으로 제한되어 새 프랍 scoped adapter가 필요하다. 전체 촛대에 effect-luma를 적용하면 어두운 금속도 삭제될 수 있어 자동 대체하지 않는다.
- RGB 프레임을 알파 처리하고 양쪽 APNG를 동일 프레임 시간으로 인코딩하고, 문서/모델 출처와 정식 요청을 PDS/Filex에서 검증한 뒤에만 완성 결과를 노출해야 한다. 이 문서/공용 계약/픽스처는 실제 워커나 운영 발표를 대신하지 않는다.

`spirit-v1`의 `spirit`은 시네마틱 디테일 원본을 축소한 정지 PNG이며 `pixel`과 동일한 1/5 캔버스 크기다. 기존 애니메이션의 두 레인과 퍼즐 플레이 입력에는 새 애니메이션 레인을 추가하지 않는다.
