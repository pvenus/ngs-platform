using System;
using System.Collections.Generic;
using UnityEngine;

namespace Vinus.Binari
{
    public static class MapColliders
    {
        [Serializable] private sealed class Metadata { public string schemaVersion; public Graph graph; }
        [Serializable] private sealed class Graph { public Wall[] colliders; public Region[] regions; }
        [Serializable] private sealed class Region { public string id; }
        [Serializable] private sealed class Wall
        {
            public string id, regionId, shape;
            public int rotation;
            public Bounds1000 rect;
        }

        [Serializable] private sealed class Bounds1000 { public int x, y, width, height; }
        private const int EllipseSegments = 48;

        // Attach the returned parent to the same lifetime as this region's background.
        // imageBounds describes the visible, unrotated image rectangle in parent-local XY.
        public static GameObject Create(string mapJson, string regionId, Transform parent, Rect imageBounds, int layer)
        {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            if (string.IsNullOrEmpty(regionId)) throw new ArgumentException("A map region is required.", nameof(regionId));
            if (layer < 0 || layer > 31) throw new ArgumentOutOfRangeException(nameof(layer));
            if (!Finite(imageBounds.x) || !Finite(imageBounds.y) || !Finite(imageBounds.width) ||
                !Finite(imageBounds.height) || imageBounds.width <= 0 || imageBounds.height <= 0)
                throw new ArgumentException("Positive finite local image bounds are required.", nameof(imageBounds));
            var meta = JsonUtility.FromJson<Metadata>(mapJson);
            if (meta?.schemaVersion != "ngs.map-metadata.v1" || meta.graph?.regions == null ||
                !Array.Exists(meta.graph.regions, x => x?.id == regionId))
                throw new ArgumentException("Invalid map metadata or unknown region.", nameof(mapJson));

            var chosen = new List<Wall>();
            if (meta.graph.colliders != null)
            {
                var seen = new HashSet<string>(StringComparer.Ordinal);
                foreach (var wall in meta.graph.colliders)
                {
                    if (wall == null || wall.regionId != regionId) continue;
                    var r = wall.rect;
                    var legacy = string.IsNullOrEmpty(wall.shape);
                    if (r == null || r.x < 0 || r.y < 0 || r.x >= 1000 || r.y >= 1000 ||
                        r.width <= 0 || r.height <= 0 || r.width > 1000 - r.x || r.height > 1000 - r.y ||
                        wall.rotation < 0 || wall.rotation > 359 || (legacy && wall.rotation != 0) ||
                        !(legacy || wall.shape == "rect" || wall.shape == "ellipse") ||
                        string.IsNullOrEmpty(wall.id) || !seen.Add(wall.id))
                        throw new ArgumentException("Invalid collider metadata in selected region.", nameof(mapJson));
                    chosen.Add(wall);
                }
            }

            var root = new GameObject("NGS map colliders: " + regionId) { layer = layer };
            root.transform.SetParent(parent, false);
            foreach (var wall in chosen)
            {
                var r = wall.rect;
                var child = new GameObject(wall.id) { layer = layer };
                var t = child.transform;
                t.SetParent(root.transform, false);
                t.localPosition = new Vector3(
                    imageBounds.xMin + (r.x + r.width * .5f) * .001f * imageBounds.width,
                    imageBounds.yMax - (r.y + r.height * .5f) * .001f * imageBounds.height, 0f);
                t.localRotation = Quaternion.Euler(0f, 0f, -wall.rotation);
                var size = new Vector2(r.width * .001f * imageBounds.width,
                                       r.height * .001f * imageBounds.height);
                if (wall.shape != "ellipse")
                {
                    child.AddComponent<BoxCollider2D>().size = size;
                }
                else if (size.x == size.y)
                {
                    child.AddComponent<CircleCollider2D>().radius = size.x * .5f;
                }
                else
                {
                    // CircleCollider2D does not support independent radii.
                    var perimeter = new Vector2[EllipseSegments];
                    for (int i = 0; i < EllipseSegments; i++)
                    {
                        var angle = 2f * Mathf.PI * i / EllipseSegments;
                        perimeter[i] = new Vector2(Mathf.Cos(angle) * size.x * .5f,
                                                   Mathf.Sin(angle) * size.y * .5f);
                    }
                    child.AddComponent<PolygonCollider2D>().SetPath(0, perimeter);
                }
            }
            return root;
        }

        private static bool Finite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);
    }
}
