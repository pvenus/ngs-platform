using System;
using UnityEngine;

namespace Vinus.Binari
{
    public static class MapColliders
    {
        // Optional Unity adapter; the game owns when to load or release each region.
        public static GameObject Create(string mapJson, string regionId, Transform parent, Rect imageBounds, int layer)
        {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            if (layer < 0 || layer > 31) throw new ArgumentOutOfRangeException(nameof(layer));
            var specs = MapColliderGeometry.Project(JsonUtility.FromJson<MapColliderMetadata>(mapJson), regionId,
                imageBounds.xMin, imageBounds.yMin, imageBounds.width, imageBounds.height);
            var root = new GameObject("NGS map colliders: " + regionId) { layer = layer };
            root.transform.SetParent(parent, false);
            foreach (var spec in specs)
            {
                var child = new GameObject(spec.Id) { layer = layer };
                var t = child.transform;
                t.SetParent(root.transform, false);
                t.localPosition = new Vector3((float)spec.CenterX, (float)spec.CenterY, 0f);
                t.localRotation = Quaternion.Euler(0f, 0f, (float)spec.RotationDegrees);
                if (spec.Shape == MapColliderShape.Rectangle)
                    child.AddComponent<BoxCollider2D>().size = new Vector2((float)spec.Width, (float)spec.Height);
                else if (spec.Shape == MapColliderShape.Circle)
                    child.AddComponent<CircleCollider2D>().radius = (float)(spec.Width * .5d);
                else
                {
                    var perimeter = new Vector2[MapColliderGeometry.EllipseSegments];
                    for (int i = 0; i < perimeter.Length; i++)
                    {
                        var point = MapColliderGeometry.EllipsePoint(spec, i);
                        perimeter[i] = new Vector2((float)point.X, (float)point.Y);
                    }
                    child.AddComponent<PolygonCollider2D>().SetPath(0, perimeter);
                }
            }
            return root;
        }
    }
}
