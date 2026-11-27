using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Vinus.Binari.Puzzles;

internal static class DefinitionJson
{
    internal const int Maximum = 64 * 1024;
    static void Check(bool pass) { if (!pass) throw new FormatException("Invalid definition"); }
    static void Keys(JsonElement row, params string[] names)
    {
        var remaining = new HashSet<string>(names, StringComparer.Ordinal);
        Check(row.ValueKind == JsonValueKind.Object);
        foreach (var p in row.EnumerateObject()) Check(remaining.Remove(p.Name));
        Check(remaining.Count == 0);
    }
    static string Text(JsonElement row, string key) => row.GetProperty(key).GetString() ?? throw new FormatException("Missing string");
    static T[] ArrayOf<T>(JsonElement row, string key, int max, Func<JsonElement, T> convert)
    {
        var array = row.GetProperty(key);
        Check(array.ValueKind == JsonValueKind.Array && array.GetArrayLength() <= max);
        return array.EnumerateArray().Select(convert).ToArray();
    }
    static Fact ReadFact(JsonElement row)
    {
        Keys(row, "role", "state");
        return new Fact(Text(row, "role"), Text(row, "state"));
    }
    static Step ReadStep(JsonElement row)
    {
        Keys(row, "kind", "target", "item");
        var action = Text(row, "kind") switch
        {
            "pickup" => ActionKind.Pickup, "drop" => ActionKind.Drop, "activate" => ActionKind.Activate,
            _ => throw new FormatException("Unknown input")
        };
        return new Step(action, Text(row, "target"), row.GetProperty("item").GetString());
    }
    static State ReadState(JsonElement row)
    {
        Keys(row, "id", "held", "payload");
        return new State(Text(row, "id"), row.GetProperty("held").GetBoolean(), Text(row, "payload"));
    }
    static Entity ReadEntity(JsonElement row)
    {
        Keys(row, "role", "initial", "states");
        return new Entity(Text(row, "role"), Text(row, "initial"), ArrayOf(row, "states", 32, ReadState));
    }
    static Rule ReadRule(JsonElement row)
    {
        Keys(row, "module", "action", "from", "to", "requires");
        var module = Text(row, "module") switch
        {
            "inventory.move.v1" => Module.InventoryMove, "prop.interact.v1" => Module.PropInteract, "switch.v1" => Module.Switch,
            _ => throw new FormatException("Unknown module")
        };
        return new Rule(module, ReadStep(row.GetProperty("action")), ReadFact(row.GetProperty("from")),
            ReadFact(row.GetProperty("to")), ArrayOf(row, "requires", 8, ReadFact));
    }
    internal static Puzzle Read(string json)
    {
        Check(json != null && System.Text.Encoding.UTF8.GetByteCount(json) <= Maximum);
        using var doc = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 12 });
        var root = doc.RootElement;
        Keys(root, "schemaVersion", "entities", "rules", "goal", "solution");
        Check(Text(root, "schemaVersion") == "ngs.puzzle-definition.v1");
        var entities = ArrayOf(root, "entities", 32, ReadEntity);
        var rules = ArrayOf(root, "rules", 64, ReadRule);
        var goal = ReadFact(root.GetProperty("goal"));
        var solution = ArrayOf(root, "solution", 128, ReadStep);

        // Initial migration profile preserves the four existing gameplay
        // interactions. This constraint is not part of the reusable runtime.
        string FactKey(Fact f) => f.Role + "=" + f.State;
        string ActionKey(Step a) => a.Kind + "," + a.Target + "," + (a.Item ?? "-");
        string RuleKey(Rule r) => r.Module + ":" + ActionKey(r.Action) + ":" + FactKey(r.From) + ":" + FactKey(r.To)
            + ":" + string.Join(",", r.Requires.Select(FactKey).OrderBy(x => x, StringComparer.Ordinal));
        string EntityKey(Entity e) => e.Role + ":" + e.Initial + ":" + string.Join(",", e.States
            .Select(s => s.Id + "/" + (s.Held ? "1" : "0") + "/" + s.Payload).OrderBy(x => x, StringComparer.Ordinal));
        Check(FactKey(goal) == FactKey(Water.Goal) && new HashSet<string>(Water.Entities().Select(EntityKey), StringComparer.Ordinal)
            .SetEquals(entities.Select(EntityKey)) && entities.Length == 4 && rules.Length == 4 &&
            new HashSet<string>(Water.Rules().Select(RuleKey), StringComparer.Ordinal).SetEquals(rules.Select(RuleKey)));
        Check(Puzzle.ProvesSolution(new Puzzle(entities, rules, goal), solution));
        return new Puzzle(entities, rules, goal);
    }
}
