using AgentRelay.Core;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace AgentRelay.Service;

/// <summary>
/// Worker host that runs the Modbus relay loop. Designed to be installed
/// as a Windows Service via <c>sc.exe create AgentRelaySvc binPath= ...</c>.
/// Reads the same %APPDATA%\AgentRelay\settings.json file written by the
/// GUI so configuration stays in one place.
/// </summary>
public static class Program
{
    public static async Task Main(string[] args)
    {
        var builder = Host.CreateApplicationBuilder(args);
        builder.Services.AddHostedService<RelayWorker>();
        builder.Services.AddWindowsService(o =>
        {
            o.ServiceName = "AgentRelaySvc";
        });
        await builder.Build().RunAsync();
    }
}

public sealed class RelayWorker : BackgroundService
{
    private readonly ILogger<RelayWorker> _logger;

    public RelayWorker(ILogger<RelayWorker> logger)
    {
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var settings = AppSettings.Load();
        _logger.LogInformation("Loaded settings from {Path}", AppSettings.DefaultPath);
        if (string.IsNullOrEmpty(settings.IngestToken))
        {
            _logger.LogWarning("No ingest token configured. The relay will start but every push will be skipped.");
        }
        using var api = new ApiClient(settings.ApiBaseUrl, settings.SessionToken);
        var relay = new ModbusRelay(settings, api, _logger);
        try
        {
            await relay.RunAsync(stoppingToken);
        }
        catch (OperationCanceledException) { /* graceful shutdown */ }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Relay terminated with an error");
        }
    }
}
