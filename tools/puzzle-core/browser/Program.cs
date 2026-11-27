using System;
using System.Collections.Generic;
using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;
using Vinus.Binari.Puzzles;

[SupportedOSPlatform("browser")]
public static partial class Program
{
    static readonly Dictionary<int, Puzzle> puzzles = new Dictionary<int, Puzzle>();
    static int next = 0;
    public static void Main() { }
    [JSExport]
    public static int Open(string definition)
    {
        if (puzzles.Count >= 32 || next == int.MaxValue) throw new InvalidOperationException("Puzzle session limit");
        var p = DefinitionJson.Read(definition);
        puzzles.Add(++next, p);
        return next;
    }
    [JSExport]
    public static void Close(int handle) => puzzles.Remove(handle);
    [JSExport]
    public static string StateOf(int handle, string role) => puzzles[handle].GetState(role) ?? "";
    [JSExport]
    public static bool Complete(int handle) => puzzles[handle].Complete;
    [JSExport]
    public static string Dispatch(int handle, int kind, string target, string item)
    {
        var result = puzzles[handle].Dispatch(new Step((ActionKind)kind, target, item == "" ? null : item));
        return result.Verdict.ToString() + (result.CompletedNow ? ":complete" : "");
    }
}
