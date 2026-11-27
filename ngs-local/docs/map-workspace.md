# 맵 제작
탑뷰는 별도 기획 자료다. NGS에서는 이미 게시된 배경에서 사용할 이미지 버전을 골라 맵을 만든다.
초기 정식 요청에 시작 구역, 선택된 배경, 방향이 정해진 연결 목록과 배경 제작 의도를 전달한다. 연결 목록은 요청 작성자가 직접 지정하거나 정확한 구역 이름이 들어간 → 경로를 붙여넣어 확정한다. 문서 워커는 선택된 이미지 고정본을 보고, 요청된 연결 각각의 포털 사각형과 도착 좌표만 찾는다. 모델과 게시 단계 어느 쪽에서도 요청에 없는 연결 추가·삭제·역방향 전환은 허용하지 않는다.
좌표는 각 이미지 전체의 왼쪽 위가 0,0인 정수 0–1000 단위다. 출입구와 도착점은 각기 다른 화면을 기준으로 한다. 이미지 버전 교체 시 해당 화면 좌표는 초기화한다.
세부 수정은 탭의 sessionStorage만 갱신한다. 적용 시 정확한 좌표와 이전 리비전을 정식 수정 요청으로 보낸다. 문서 워커가 수동 값을 다시 추론하지 않는다. PDS·Filex는 이미지와 요청의 일치를 검증하고 새 리비전만 게시한다.

## 실제 워프
구역을 위에서 아래로 배치하고 ‘배치 순서대로 단방향 연결’을 누르면 1→2→… 방향을 명시한 요청 초안이 만들어진다. 문서 워커는 이 순서를 변경하지 않는다. 좌표가 채워지면 ‘워프 플레이’에서 키보드나 바닥 클릭으로 발점을 움직일 수 있다. 포털을 클릭한다고 즉시 이동하지 않고, 발점이 포털 영역에 진입할 때 다음 배경 및 도착 좌표로 이동한다. 초기 등장 위치 기본값은 (500,850)이다. 이동 중 좁은 트리거를 건너뛰지 않도록 발점의 이동 선분을 검사한다. 이 기능은 벽 충돌, 내비게이션 메시 또는 게임 씬 빌드까지 포함하지 않는다.

### 이동 불가 영역 모양

기존 저장본에 `shape`와 `rotation`이 없으면 회전하지 않은 사각형으로 읽는다.
새 영역은 사각형(`rect`) 또는 원·타원(`ellipse`)만 사용한다. `rect` 안의 가로·세로는
회전 전 크기이며 기존의 0–1000 정규화 좌표다. `rotation`은 중심을 축으로 이미지에서
시계 방향 0–359 정수 도다. 직사각형 이미지에서도 이미지 비율을 사용해 미리 보기의
윤곽을 웹 편집기와 워프 플레이에 표시한다. 웹에서는 해당 영역을 통과할 수 있고 포털
동작에도 영향이 없다. 실제 충돌은 같은 메타에서 Unity의 Collider2D를 구성해 처리한다. 메타는 다른 맵 편집과 동일하게 적용 시 정식 수정 요청으로 보낸다.

### 맵 목록과 탭별 적용

맵 이름은 생성 시 입력하며 게시 후에는 바꾸지 않는다. 시작 맵, 이동 연결(배경·구역 구성
포함), 충돌 영역은 탭별로 편집하고, 적용은 해당 탭의 필드만 현재 게시본에 합쳐
`map.update`로 요청한다. 적용 중에는 같은 맵의 다음 적용을 잠시 잠근다. 확정본이
도착하면 다른 탭의 세션 초안을 유지한다. 구역을 없애려면 기존 시작 지점·연결·충돌
참조를 먼저 해당 탭에서 정리해야 한다.

목록은 이름 검색과 편집 아이콘을 제공한다. 선택한 맵마다 활성 리비전과 작성 요청
ID를 고정한 공용 `file.delete` 한 건을 접수한다. 대상은 맵 폴더 하나이며 참조한
배경 자산은 삭제하지 않는다. 목록과 열린 맵은 복제 완료 후 자동 갱신된다.

맵 그룹은 제목과 배경 구역 목록을 갖는다. 새 저장본은 리비전 매니페스트와 시작 맵,
포털, 충돌 영역 파일로 나뉜다. 매니페스트가 가리키는 세 파일의 해시가 확인돼야
새 리비전을 표시하며, 전송 중에는 이전 완결 리비전을 유지한다. 기존 단일 메타도
읽을 수 있다. 웹과 Unity의 기존 입력 API는 세 파일을 합친 그래프를 계속 반환한다.

새 생성 팝업은 그룹 배경·제작 의도와 시작 구역 선택, 방향 연결, 충돌 방식을 받는다.
시작·포털·충돌마다 별도 요청 사항을 입력할 수 있고, 새 요청은 차례로 문서 작업 세
건을 실행한다. 시작 위치와 포털 좌표, 충돌 도형을 세 번째 작업에서 묶어 게시한다.
시작 구역 및 연결 방향은 선택 그대로 고정된다. 수동 적용은 CLI를 실행하지 않는다.

## 파일 수정

새 맵 제작은 기존 생성 워크플로를 사용합니다. 게시된 맵 편집은 공용 `file.update` 한 건으로 처리합니다. 현재 탭의 변경을 게시본 위에 적용한 뒤, 시작 위치·구역·포털·충돌을 포함한 완성된 메타 전체를 전달합니다. 다른 탭의 임시 편집은 보내지 않습니다. 대상 ID와 기존 리비전 및 작성 요청 ID가 맞지 않으면 저장하지 않습니다. 파일 워커는 모델을 호출하지 않으며 세 파트와 매니페스트는 하나의 리비전으로 게시됩니다. 출범 시에는 이미 큐에 있는 구형 맵 수정 요청을 계속 처리할 수 있습니다.

### Map decoration metadata

The fourth editor tab applies a complete map snapshot using the existing
`file.update` pipeline. Its placement draft is independent from start, portal
and collision drafts. Each placement pins a published prop revision, uses a
bottom-center anchor in natural-canvas thousandths, and scales the reduced prop
relative to natural map pixels. `both` swaps pixel and cinematic variants with
the ability switch; `pixel` (OFF) and `cinematic` (ON) are absent in the other
mode. Decorations never register a puzzle interaction, collision, or portal.
Warp and assembled puzzle playback read these map-level placements.

New-map `ngs.map-generate.v3` adds a separate `decorationDesign` choice.
`none` keeps the three existing document steps. `suggest` adds a fourth that
uses only the selected pinned prop candidates, visibility settings, and
placement notes. The saved placement list is an independently hashed optional
map group part, not a duplicate assembly or background.
