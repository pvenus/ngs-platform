using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Vinus.Binari.Puzzles
{
    public enum Module { InventoryMove = 1, PropInteract = 2, Switch = 3 }
    public enum ActionKind { Pickup = 1, Drop = 2, Activate = 3 }
    public enum Verdict { Accepted, NotLinked, Conditions, Ambiguous }

    public sealed class State
    {
        public readonly string Id;
        public readonly bool Held;
        // Payload is fixed by the state definition, not a second mutable item variable.
        public readonly string Payload;
        public State(string id, bool held, string payload) { Id = id; Held = held; Payload = payload; }
    }
    public sealed class Entity
    {
        public readonly string Role, Initial;
        public readonly State[] States;
        public Entity(string role, string initial, params State[] states) { Role = role; Initial = initial; States = states; }
    }
    public sealed class Fact
    {
        public readonly string Role, State;
        public Fact(string role, string state) { Role = role; State = state; }
    }
    public sealed class Step
    {
        public readonly ActionKind Kind;
        public readonly string Target, Item;
        public Step(ActionKind kind, string target, string item = null) { Kind = kind; Target = target; Item = item; }
    }
    public sealed class Rule
    {
        public readonly Module Module;
        public readonly Step Action;
        public readonly Fact From, To;
        public readonly Fact[] Requires;
        public Rule(Module module, Step action, Fact from, Fact to, params Fact[] requires)
        { Module = module; Action = action; From = from; To = to; Requires = requires; }
    }
    public sealed class Result
    {
        public readonly Verdict Verdict;
        public readonly Fact Before, After;
        public readonly bool CompletedNow;
        internal Result(Verdict verdict, Fact before = null, Fact after = null, bool completedNow = false)
        { Verdict = verdict; Before = before; After = after; CompletedNow = completedNow; }
    }
    public sealed class Puzzle
    {
        static readonly Regex Id = new Regex(@"\A[a-z][a-z0-9-]{0,63}\z", RegexOptions.CultureInvariant);
        readonly Dictionary<string, Dictionary<string, State>> definitions = new Dictionary<string, Dictionary<string, State>>(StringComparer.Ordinal);
        readonly Dictionary<string, string> current = new Dictionary<string, string>(StringComparer.Ordinal);
        readonly Rule[] rules;
        readonly Fact goal;
        static void Need(bool ok) { if (!ok) throw new ArgumentException("Invalid puzzle definition"); }
        static bool Name(string value) { return value != null && Id.IsMatch(value); }
        State Resolve(Fact f)
        {
            Need(f != null && Name(f.Role) && Name(f.State));
            if (!definitions.TryGetValue(f.Role, out var role) || !role.TryGetValue(f.State, out var state))
                throw new ArgumentException("Unknown puzzle role or state");
            return state;
        }
        public Puzzle(Entity[] entities, Rule[] rules, Fact goal)
        {
            Need(entities != null && entities.Length > 0 && entities.Length <= 32 && rules != null && rules.Length > 0 && rules.Length <= 64);
            foreach (var entity in entities)
            {
                Need(entity != null && Name(entity.Role) && Name(entity.Initial) && !definitions.ContainsKey(entity.Role)
                    && entity.States != null && entity.States.Length > 0 && entity.States.Length <= 32);
                var states = new Dictionary<string, State>(StringComparer.Ordinal);
                foreach (var state in entity.States)
                {
                    Need(state != null && Name(state.Id) && Name(state.Payload) && !states.ContainsKey(state.Id));
                    states.Add(state.Id, state);
                }
                Need(states.ContainsKey(entity.Initial));
                definitions.Add(entity.Role, states);
                current.Add(entity.Role, entity.Initial);
            }
            this.rules = new Rule[rules.Length];
            for (int i = 0; i < rules.Length; i++)
            {
                var rule = rules[i];
                Need(rule != null && rule.Action != null && Name(rule.Action.Target) && definitions.ContainsKey(rule.Action.Target)
                    && rule.Requires != null && rule.Requires.Length <= 8);
                var from = Resolve(rule.From);
                var to = Resolve(rule.To);
                Need(rule.From.Role == rule.To.Role && from.Id != to.Id);
                foreach (var extra in rule.Requires) Resolve(extra);
                var action = rule.Action;
                switch (rule.Module)
                {
                    case Module.InventoryMove:
                        Need(from.Held != to.Held && from.Payload == to.Payload &&
                            (!from.Held
                              ? action.Kind == ActionKind.Pickup && action.Item == null && action.Target == rule.From.Role
                              : action.Kind == ActionKind.Drop && action.Item == rule.From.Role && action.Target != action.Item));
                        break;
                    case Module.PropInteract:
                        Need(from.Held && to.Held && from.Payload != to.Payload && action.Kind == ActionKind.Drop &&
                            action.Item == rule.From.Role && action.Target != action.Item);
                        break;
                    case Module.Switch:
                        Need(!from.Held && !to.Held && action.Kind == ActionKind.Activate && action.Item == null && action.Target == rule.From.Role);
                        break;
                    default: Need(false); break;
                }
                this.rules[i] = new Rule(rule.Module, action, rule.From, rule.To, (Fact[])rule.Requires.Clone());
            }
            Resolve(goal);
            this.goal = goal;
            Need(!Complete);
        }
        public string GetState(string role) { return role != null && current.TryGetValue(role, out var state) ? state : null; }
        bool Matches(Fact f) { return GetState(f.Role) == f.State; }
        public bool Complete { get { return Matches(goal); } }

        public Result Dispatch(Step action)
        {
            if (action == null) return new Result(Verdict.NotLinked);
            Rule winner = null;
            bool linked = false;
            foreach (var candidate in rules)
            {
                var a = candidate.Action;
                if (a.Kind != action.Kind || a.Target != action.Target || a.Item != action.Item) continue;
                linked = true;
                if (!Matches(candidate.From) || !Array.TrueForAll(candidate.Requires, Matches)) continue;
                if (winner != null) return new Result(Verdict.Ambiguous);
                winner = candidate;
            }
            if (winner == null) return new Result(linked ? Verdict.Conditions : Verdict.NotLinked);
            var alreadyComplete = Complete;
            current[winner.To.Role] = winner.To.State;
            return new Result(Verdict.Accepted, winner.From, winner.To, !alreadyComplete && Complete);
        }

        // Use a fresh instance to verify the declared trace with exactly the same rules as gameplay.
        public static bool ProvesSolution(Puzzle fresh, IReadOnlyList<Step> trace)
        {
            if (fresh == null || fresh.Complete || trace == null || trace.Count == 0 || trace.Count > 128) return false;
            for (int i = 0; i < trace.Count; i++)
            {
                var result = fresh.Dispatch(trace[i]);
                if (result.Verdict != Verdict.Accepted || result.CompletedNow != (i == trace.Count - 1)) return false;
            }
            return fresh.Complete;
        }
    }
}
