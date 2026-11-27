using System;
using System.Collections.Generic;

namespace Vinus.Binari
{
    [Serializable] public sealed class MapColliderMetadata { public string schemaVersion; public MapColliderGraph graph; }
    [Serializable] public sealed class MapColliderGraph { public MapColliderRecord[] colliders; public MapColliderRegion[] regions; }
    [Serializable] public sealed class MapColliderRegion { public string id; }
    [Serializable] public sealed class MapColliderRecord
    {
        public string id, regionId, shape;
        public int rotation;
        public MapColliderRect rect;
    }
    [Serializable] public sealed class MapColliderRect { public int x, y, width, height; }

    public enum MapColliderShape { Rectangle, Circle, Ellipse }
    public readonly struct MapColliderSpec
    {
        public readonly string Id;
        public readonly MapColliderShape Shape;
        public readonly double CenterX, CenterY, Width, Height, RotationDegrees;

        internal MapColliderSpec(string id, MapColliderShape shape, double centerX, double centerY,
                                 double width, double height, double rotationDegrees)
        {
            Id = id; Shape = shape; CenterX = centerX; CenterY = centerY;
            Width = width; Height = height; RotationDegrees = rotationDegrees;
        }
    }

    // No Unity or physics dependencies. The caller supplies the actual rectangle in a Y-up coordinate system.
    public static class MapColliderGeometry
    {
        public const int EllipseSegments = 48;

        public static IReadOnlyList<MapColliderSpec> Project(MapColliderMetadata meta, string regionId,
                                                             double left, double bottom, double width, double height)
        {
            if (string.IsNullOrWhiteSpace(regionId) || meta?.schemaVersion != "ngs.map-metadata.v1" ||
                meta.graph?.regions == null || !Array.Exists(meta.graph.regions, r => r?.id == regionId))
                throw new ArgumentException("Invalid map metadata or unknown region.");
            if (!Finite(left) || !Finite(bottom) || !Finite(width) || !Finite(height) ||
                !Finite(left + width) || !Finite(bottom + height) || width <= 0 || height <= 0)
                throw new ArgumentException("Positive finite image bounds are required.");
            var result = new List<MapColliderSpec>();
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var wall in meta.graph.colliders ?? Array.Empty<MapColliderRecord>())
            {
                if (wall == null || wall.regionId != regionId) continue;
                var r = wall.rect;
                var legacy = string.IsNullOrEmpty(wall.shape);
                if (r == null || r.x < 0 || r.y < 0 || r.x >= 1000 || r.y >= 1000 ||
                    r.width <= 0 || r.height <= 0 || r.width > 1000 - r.x || r.height > 1000 - r.y ||
                    wall.rotation < 0 || wall.rotation > 359 || (legacy && wall.rotation != 0) ||
                    !(legacy || wall.shape == "rect" || wall.shape == "ellipse") ||
                    string.IsNullOrEmpty(wall.id) || !ids.Add(wall.id))
                    throw new ArgumentException("Invalid or duplicate collider metadata in selected region.");
                var wallWidth = (r.width / 1000d) * width;
                var wallHeight = (r.height / 1000d) * height;
                var shape = wall.shape != "ellipse" ? MapColliderShape.Rectangle :
                    Math.Abs(wallWidth - wallHeight) <= Math.Max(wallWidth, wallHeight) * 1e-7
                        ? MapColliderShape.Circle : MapColliderShape.Ellipse;
                result.Add(new MapColliderSpec(wall.id, shape,
                    left + (r.x + r.width * .5d) / 1000d * width,
                    bottom + (1d - (r.y + r.height * .5d) / 1000d) * height,
                    wallWidth, wallHeight, -wall.rotation));
            }
            return result;
        }

        public static (double X, double Y) EllipsePoint(MapColliderSpec collider, int index)
        {
            if (index < 0 || index >= EllipseSegments) throw new ArgumentOutOfRangeException(nameof(index));
            var angle = 2d * Math.PI * index / EllipseSegments;
            return (Math.Cos(angle) * collider.Width * .5d, Math.Sin(angle) * collider.Height * .5d);
        }

        private static bool Finite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
    }
}
