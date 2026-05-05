using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;

namespace AgentRelay.Core;

/// <summary>
/// Minimal RFC4180-ish CSV writer (no external deps). Used to export
/// readings filtered by site + date range.
/// </summary>
public static class CsvExporter
{
    public static void ExportReadings(string path, IEnumerable<ModbusReading> readings)
    {
        using var stream = new FileStream(path, FileMode.Create, FileAccess.Write);
        // BOM so Excel opens UTF-8 cleanly.
        using var writer = new StreamWriter(stream, new UTF8Encoding(true));
        writer.WriteLine("id,deviceId,source,parsingStatus,receivedAt,registers");
        foreach (var r in readings)
        {
            var registers = "";
            if (r.DecodedValues is { ValueKind: JsonValueKind.Object } el)
            {
                registers = el.GetRawText();
            }
            else if (r.RawPayload is { ValueKind: JsonValueKind.Object } raw)
            {
                registers = raw.GetRawText();
            }
            writer.Write(r.Id.ToString(CultureInfo.InvariantCulture));
            writer.Write(',');
            writer.Write(Escape(r.DeviceId));
            writer.Write(',');
            writer.Write(Escape(r.Source ?? ""));
            writer.Write(',');
            writer.Write(Escape(r.ParsingStatus));
            writer.Write(',');
            writer.Write(r.ReceivedAt.ToString("o", CultureInfo.InvariantCulture));
            writer.Write(',');
            writer.Write(Escape(registers));
            writer.WriteLine();
        }
    }

    private static string Escape(string value)
    {
        if (value.IndexOfAny(new[] { ',', '"', '\n', '\r' }) < 0) return value;
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }
}
