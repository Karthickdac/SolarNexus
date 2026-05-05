using System.IO;
using System.Text.Json;

namespace AgentRelay.Core;

/// <summary>
/// Persistent settings stored as JSON in %APPDATA%\AgentRelay\settings.json.
/// Saved on every mutation so the worker service and GUI stay in sync.
/// </summary>
public sealed class AppSettings
{
    public string ApiBaseUrl { get; set; } = "http://localhost:8080/api";
    public string? IngestToken { get; set; }
    public string? SessionToken { get; set; }
    public DateTime? SessionExpiresAt { get; set; }
    public string? UserEmail { get; set; }
    public string? UserName { get; set; }
    public string? UserRole { get; set; }
    public List<ModbusDeviceConfig> Devices { get; set; } = new();
    public bool RelayEnabled { get; set; } = false;
    public string LogLevel { get; set; } = "Information";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    /// <summary>
    /// Machine-wide config path so the GUI (running interactively as the
    /// signed-in user) and the Windows Service (running as LocalSystem)
    /// share the same settings.json. On non-Windows hosts the directory
    /// falls back to <see cref="Environment.SpecialFolder.CommonApplicationData"/>
    /// which is /var/lib on Linux.
    /// </summary>
    public static string DefaultPath
    {
        get
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "AgentRelay");
            Directory.CreateDirectory(dir);
            return Path.Combine(dir, "settings.json");
        }
    }

    public static AppSettings Load(string? path = null)
    {
        path ??= DefaultPath;
        if (!File.Exists(path)) return new AppSettings();
        try
        {
            var json = File.ReadAllText(path);
            return JsonSerializer.Deserialize<AppSettings>(json, JsonOptions) ?? new AppSettings();
        }
        catch
        {
            return new AppSettings();
        }
    }

    public void Save(string? path = null)
    {
        path ??= DefaultPath;
        var json = JsonSerializer.Serialize(this, JsonOptions);
        File.WriteAllText(path, json);
    }
}
