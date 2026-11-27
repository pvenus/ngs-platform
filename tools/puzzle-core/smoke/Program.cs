using System;
using Vinus.Binari.Puzzles;
static void Check(bool condition)
{
    if (!condition) throw new InvalidOperationException("Puzzle smoke check failed");
}
var puzzle = Water.Create();
Check(puzzle.Dispatch(Water.Pickup).Verdict == Verdict.Accepted);
Check(puzzle.Dispatch(Water.Fill).Verdict == Verdict.Conditions);
Check(puzzle.Dispatch(Water.Place).Verdict == Verdict.Conditions);
Check(puzzle.GetState("bowl") == "carried-empty");
Check(puzzle.Dispatch(Water.Open).Verdict == Verdict.Accepted);
Check(puzzle.Dispatch(Water.Fill).After.State == "carried-filled");
Check(puzzle.Dispatch(Water.Place).CompletedNow);
Check(puzzle.Complete && !puzzle.Dispatch(Water.Place).CompletedNow);
Check(Water.Create().GetState("bowl") == "altar-empty");
Check(Puzzle.ProvesSolution(Water.Create(), new[] { Water.Pickup, Water.Open, Water.Fill, Water.Place }));
Check(!Puzzle.ProvesSolution(Water.Create(), new[] { Water.Pickup, Water.Fill, Water.Place }));
Check(!Puzzle.ProvesSolution(Water.Create(true), new[] { Water.Pickup, Water.Open, Water.Fill, Water.Place }));
Console.WriteLine("C# water rules, blocked actions, replay, ambiguity and isolation passed.");
