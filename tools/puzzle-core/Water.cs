using Vinus.Binari.Puzzles;

// One reference puzzle definition, not a second implementation of the rules.
internal static class Water
{
    static State S(string name, bool held, string content) => new State(name, held, content);
    static Fact F(string role, string state) => new Fact(role, state);
    internal static Step Pickup => new Step(ActionKind.Pickup, "bowl");
    internal static Step Open => new Step(ActionKind.Activate, "lid");
    internal static Step Fill => new Step(ActionKind.Drop, "well", "bowl");
    internal static Step Place => new Step(ActionKind.Drop, "altar", "bowl");
    internal static Fact Goal => F("bowl", "altar-filled");
    internal static Entity[] Entities() => new[] {
            new Entity("bowl", "altar-empty", S("altar-empty", false, "empty"), S("carried-empty", true, "empty"),
                S("carried-filled", true, "filled"), S("altar-filled", false, "filled")),
            new Entity("well", "ready", S("ready", false, "ready")),
            new Entity("altar", "ready", S("ready", false, "ready")),
            new Entity("lid", "closed", S("closed", false, "closed"), S("open", false, "open"))
        };
    internal static Rule[] Rules(bool ambiguous = false)
    {
        var fill = new Rule(Module.PropInteract, Fill, F("bowl", "carried-empty"), F("bowl", "carried-filled"), F("lid", "open"));
        var rules = new System.Collections.Generic.List<Rule> {
            new Rule(Module.InventoryMove, Pickup, F("bowl", "altar-empty"), F("bowl", "carried-empty")),
            new Rule(Module.Switch, Open, F("lid", "closed"), F("lid", "open")),
            fill,
            new Rule(Module.InventoryMove, Place, F("bowl", "carried-filled"), F("bowl", "altar-filled"))
        };
        if (ambiguous) rules.Add(fill);
        return rules.ToArray();
    }
    internal static Puzzle Create(bool ambiguous = false) => new Puzzle(Entities(), Rules(ambiguous), Goal);
}
