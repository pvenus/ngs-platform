using System;
using System.IO;
using System.Text;
using System.Text.Json;
try
{
    using var stream = Console.OpenStandardInput();
    var buffer = new byte[DefinitionJson.Maximum + 1];
    var count = stream.ReadAtLeast(buffer, buffer.Length, false);
    if (count == buffer.Length) return 1;
    DefinitionJson.Read(new UTF8Encoding(false, true).GetString(buffer, 0, count));
    Console.WriteLine("{\"ok\":true}");
    return 0;
}
catch (Exception e) when (e is ArgumentException || e is FormatException || e is InvalidOperationException || e is JsonException || e is IOException)
{
    return 1;
}
