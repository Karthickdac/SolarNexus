using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace AgentRelay.Core;

public sealed class ApiException : Exception
{
    public HttpStatusCode StatusCode { get; }
    public ApiException(HttpStatusCode status, string message) : base(message)
    {
        StatusCode = status;
    }
}

/// <summary>
/// Thin REST client for the SolarNexus / Agent_relay API server. Holds the
/// session token in memory and applies it as the Bearer header on every
/// outgoing request. The caller is responsible for persisting the token via
/// <see cref="AppSettings"/>.
/// </summary>
public sealed class ApiClient : IDisposable
{
    private readonly HttpClient _http;
    private string? _bearer;
    private bool _ownsHttp;

    public ApiClient(string baseUrl, string? bearer = null, HttpClient? http = null)
    {
        if (!baseUrl.EndsWith('/')) baseUrl += "/";
        if (http is null)
        {
            _http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
            _ownsHttp = true;
        }
        else
        {
            _http = http;
            _ownsHttp = false;
        }
        _http.BaseAddress = new Uri(baseUrl);
        _bearer = bearer;
    }

    public string BaseUrl => _http.BaseAddress!.ToString();

    public void SetBearer(string? token) => _bearer = token;

    private HttpRequestMessage NewRequest(HttpMethod method, string relative)
    {
        var req = new HttpRequestMessage(method, relative.TrimStart('/'));
        if (!string.IsNullOrEmpty(_bearer))
        {
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _bearer);
        }
        return req;
    }

    private async Task<T> SendAsync<T>(HttpRequestMessage req, CancellationToken ct)
    {
        using var resp = await _http.SendAsync(req, ct).ConfigureAwait(false);
        var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode)
        {
            throw new ApiException(resp.StatusCode,
                $"HTTP {(int)resp.StatusCode} {resp.ReasonPhrase}: {body}");
        }
        if (string.IsNullOrWhiteSpace(body)) return default!;
        try
        {
            return JsonSerializer.Deserialize<T>(body)!;
        }
        catch (JsonException ex)
        {
            throw new ApiException(resp.StatusCode,
                $"Failed to parse response: {ex.Message}. Body: {body}");
        }
    }

    public Task<AuthPingResult> PingAsync(CancellationToken ct = default)
        => SendAsync<AuthPingResult>(NewRequest(HttpMethod.Get, "auth/ping"), ct);

    public async Task<LoginResponse> LoginAsync(string email, string password, CancellationToken ct = default)
    {
        var req = NewRequest(HttpMethod.Post, "auth/login");
        req.Content = JsonContent.Create(new { email, password });
        var result = await SendAsync<LoginResponse>(req, ct).ConfigureAwait(false);
        SetBearer(result.Token);
        return result;
    }

    public Task LogoutAsync(CancellationToken ct = default)
        => SendAsync<JsonElement>(NewRequest(HttpMethod.Post, "auth/logout"), ct);

    public Task<ReadingsList> ListReadingsAsync(int limit = 100, string? deviceId = null, CancellationToken ct = default)
    {
        var qs = $"modbus/readings?limit={limit}";
        if (!string.IsNullOrEmpty(deviceId)) qs += $"&deviceId={Uri.EscapeDataString(deviceId)}";
        return SendAsync<ReadingsList>(NewRequest(HttpMethod.Get, qs), ct);
    }

    public Task<AlertEventsList> ListAlertsAsync(int limit = 100, CancellationToken ct = default)
        => SendAsync<AlertEventsList>(NewRequest(HttpMethod.Get, $"alerts/events?limit={limit}"), ct);

    // NOTE: per-event acknowledge is a Phase 2 endpoint on the server side.
    // The GUI surfaces this control as disabled until then.

    public Task<DeviceSiteAssignmentsList> ListSiteAssignmentsAsync(CancellationToken ct = default)
        => SendAsync<DeviceSiteAssignmentsList>(NewRequest(HttpMethod.Get, "alerts/site-devices"), ct);

    public async Task ReplaceSiteAssignmentsAsync(string siteId, IEnumerable<string> deviceIds, CancellationToken ct = default)
    {
        var req = NewRequest(HttpMethod.Put, $"alerts/site-devices/{Uri.EscapeDataString(siteId)}");
        req.Content = JsonContent.Create(new { deviceIds });
        await SendAsync<JsonElement>(req, ct).ConfigureAwait(false);
    }

    public Task<SiteThresholdsList> ListSiteThresholdsAsync(CancellationToken ct = default)
        => SendAsync<SiteThresholdsList>(NewRequest(HttpMethod.Get, "alerts/site-thresholds"), ct);

    public async Task UpsertSiteThresholdAsync(string siteId, int thresholdMinutes, int? cooldownMinutes, CancellationToken ct = default)
    {
        var req = NewRequest(HttpMethod.Put, "alerts/site-thresholds");
        req.Content = JsonContent.Create(new { siteId, thresholdMinutes, cooldownMinutes });
        await SendAsync<JsonElement>(req, ct).ConfigureAwait(false);
    }

    /// <summary>
    /// POST a Modbus reading using the device-ingest token (NOT the user
    /// session bearer). Used by the relay worker.
    /// </summary>
    public async Task PushReadingAsync(string ingestToken, string deviceId, IDictionary<string, object?> values, CancellationToken ct = default)
    {
        using var http = new HttpClient { BaseAddress = _http.BaseAddress, Timeout = TimeSpan.FromSeconds(15) };
        using var req = new HttpRequestMessage(HttpMethod.Post, "modbus/readings");
        req.Headers.TryAddWithoutValidation("x-device-key", ingestToken);
        req.Content = JsonContent.Create(new
        {
            deviceId,
            timestamp = DateTime.UtcNow,
            values,
        });
        using var resp = await http.SendAsync(req, ct).ConfigureAwait(false);
        if (!resp.IsSuccessStatusCode)
        {
            var body = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            throw new ApiException(resp.StatusCode,
                $"Push reading failed: HTTP {(int)resp.StatusCode}: {body}");
        }
    }

    public void Dispose()
    {
        if (_ownsHttp) _http.Dispose();
    }
}
