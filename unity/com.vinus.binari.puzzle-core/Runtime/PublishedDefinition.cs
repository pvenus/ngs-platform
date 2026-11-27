using System;
using System.Linq;
using UnityEngine;

namespace Vinus.Binari.Puzzles.Unity
{
    // Unity's JSON adapter does not own the rule engine.
    public static class PublishedDefinition
    {
        [Serializable] class Wire { public string schemaVersion; public WEntity[] entities; public WRule[] rules; public WFact goal; public WStep[] solution; }
        [Serializable] class WEntity { public string role, initial; public WState[] states; }
        [Serializable] class WState { public string id, payload; public bool held; }
        [Serializable] class WRule { public string module; public WStep action; public WFact from, to; public WFact[] requires; }
        [Serializable] class WFact { public string role, state; }
        [Serializable] class WStep { public string kind, target, item; }

        static Fact Fact(WFact f) => new Fact(f.role, f.state);
        static Step Step(WStep a) => new Step(a.kind switch
        {
            "pickup" => ActionKind.Pickup, "drop" => ActionKind.Drop, "activate" => ActionKind.Activate,
            _ => throw new FormatException("Unknown puzzle action")
        }, a.target, string.IsNullOrEmpty(a.item) ? null : a.item);
        static Rule Rule(WRule r) => new Rule(r.module switch
        {
            "inventory.move.v1" => Module.InventoryMove, "prop.interact.v1" => Module.PropInteract, "switch.v1" => Module.Switch,
            _ => throw new FormatException("Unknown puzzle module")
        }, Step(r.action), Fact(r.from), Fact(r.to), r.requires.Select(Fact).ToArray());

        public static Puzzle Create(string json)
        {
            if (json == null || System.Text.Encoding.UTF8.GetByteCount(json)>64*1024) throw new ArgumentException("Invalid definition size");
            var w = JsonUtility.FromJson<Wire>(json);
            if (w?.schemaVersion != "ngs.puzzle-definition.v1") throw new FormatException("Unknown puzzle definition");
            var e = w.entities.Select(x => new Entity(x.role, x.initial, x.states.Select(s => new State(s.id, s.held, s.payload)).ToArray())).ToArray();
            var r = w.rules.Select(Rule).ToArray();
            var goal = Fact(w.goal);
            if (!Puzzle.ProvesSolution(new Puzzle(e, r, goal), w.solution.Select(Step).ToArray()))
                throw new FormatException("Published puzzle proof did not reach the goal");
            return new Puzzle(e, r, goal);
        }
    }
}
