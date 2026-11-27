# 비나리 맵 충돌 어댑터

Unity Package Manager의 **Add package from disk**에서 이 폴더의 `package.json`을
선택한다. 별도의 씬이나 NGS 요청은 필요 없다. 이미 게시된 `ngs.map-metadata.v1` JSON에서
현재 구역을 골라 배경과 같은 부모 아래에 Collider2D를 만든다.

```csharp
using Vinus.Binari;

// regionVisual은 배경과 같은 로컬 좌표계, localImageRect는 실제 표시 영역.
// 예: 중앙 피벗의 16×9 월드 배경은 new Rect(-8f, -4.5f, 16f, 9f).
GameObject walls = MapColliders.Create(mapJson, regionId, regionVisual, localImageRect, wallLayer);
```

구역이 바뀌면 반환된 부모를 해제하거나 이전 구역 배경과 함께 비활성화한다. 같은 구역을
여러 번 구성하는 경우 이전 반환 객체를 먼저 정리한다. 이동은 프로젝트의 Rigidbody2D와
충돌 레이어 설정에서 처리한다. 웹 미리보기는 표시만 하고 이 어댑터를 실행하지 않는다.

사각형은 BoxCollider2D, 실제 표시 영역에서 정원인 경우 CircleCollider2D, 타원은 48점
PolygonCollider2D를 사용한다. 회전은 모양 중심 기준이며 기존의 사각형 메타도 호환된다.

## 공용 코드와 Unity 연결

`Core/MapColliderGeometry.cs`는 UnityEngine 없이 DTO, 구역 필터링, 검증, 좌표·크기·회전
변환 및 타원 점 계산을 제공한다. `Runtime/MapColliders.cs`는 Unity에서 JSON을 읽고
Collider2D를 붙이는 선택 어댑터다. 실제 씬이나 게임의 이동 로직은 패키지가 변경하지 않는다.
