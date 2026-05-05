using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Win32;
using AgentRelay.Core;

namespace AgentRelay.Gui.Views;

public partial class MainWindow : Window
{
    private readonly ObservableCollection<ModbusReading> _readings = new();
    private readonly ObservableCollection<DeviceAlertEvent> _alerts = new();
    private readonly ObservableCollection<SiteThreshold> _thresholds = new();
    private readonly ObservableCollection<DeviceSiteAssignment> _assignments = new();
    private readonly ObservableCollection<ModbusDeviceConfig> _modbusDevices = new();

    private CancellationTokenSource? _relayCts;
    private CancellationTokenSource? _liveTailCts;

    public MainWindow()
    {
        InitializeComponent();
        ApiUrlLabel.Text = App.Settings.ApiBaseUrl;
        UserLabel.Text = $"{App.Settings.UserName} ({App.Settings.UserRole})";
        SettingsUrlBox.Text = App.Settings.ApiBaseUrl;
        SettingsTokenBox.Password = App.Settings.IngestToken ?? "";
        ReadingsGrid.ItemsSource = _readings;
        AlertsGrid.ItemsSource = _alerts;
        ThresholdsGrid.ItemsSource = _thresholds;
        AssignmentsGrid.ItemsSource = _assignments;
        ModbusGrid.ItemsSource = _modbusDevices;
        foreach (var d in App.Settings.Devices) _modbusDevices.Add(d);
        Loaded += async (_, _) =>
        {
            await RefreshConnAsync();
            await LoadAllAsync();
            StartLiveTail();
        };
        Closed += (_, _) =>
        {
            _liveTailCts?.Cancel();
            _relayCts?.Cancel();
        };
    }

    private void SetStatus(string text) => StatusBarText.Text = text;

    private async Task RefreshConnAsync()
    {
        try
        {
            var ping = await App.Api.PingAsync();
            ConnStatus.Text = ping.Authenticated
                ? $"Connected as {ping.User?.Email} ({ping.User?.Role})"
                : "Reachable, but not authenticated. Try signing out and back in.";
        }
        catch (System.Exception ex)
        {
            ConnStatus.Text = "Connection failed: " + ex.Message;
        }
    }

    private async void RefreshStatus_Click(object sender, RoutedEventArgs e) => await RefreshConnAsync();

    private async Task LoadAllAsync()
    {
        await LoadReadingsAsync();
        await LoadAlertsAsync();
        await LoadThresholdsAsync();
        await LoadAssignmentsAsync();
    }

    // -------- Readings --------
    private async Task LoadReadingsAsync()
    {
        try
        {
            var list = await App.Api.ListReadingsAsync(200);
            _readings.Clear();
            foreach (var r in list.Readings) _readings.Add(r);
            SetStatus($"Loaded {_readings.Count} readings");
        }
        catch (System.Exception ex) { SetStatus("Readings load failed: " + ex.Message); }
    }

    private async void LoadReadings_Click(object sender, RoutedEventArgs e) => await LoadReadingsAsync();

    private void ExportCsv_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new SaveFileDialog
        {
            Filter = "CSV files (*.csv)|*.csv",
            FileName = $"readings_{System.DateTime.Now:yyyyMMdd_HHmmss}.csv",
        };
        if (dlg.ShowDialog() != true) return;
        try
        {
            var site = ReadingsSiteBox.Text.Trim();
            var from = ReadingsFromPicker.SelectedDate;
            var to = ReadingsToPicker.SelectedDate;
            var filtered = _readings.AsEnumerable();
            if (!string.IsNullOrEmpty(site))
            {
                // Site filter is applied client-side: exporting a subset
                // by deviceId is the closest match without a server-side
                // assignment lookup. Expand once /api/readings supports
                // ?siteId= directly.
                filtered = filtered.Where(r => r.DeviceId.Contains(site,
                    System.StringComparison.OrdinalIgnoreCase));
            }
            if (from.HasValue) filtered = filtered.Where(r => r.ReceivedAt >= from.Value.ToUniversalTime());
            if (to.HasValue) filtered = filtered.Where(r => r.ReceivedAt <= to.Value.AddDays(1).ToUniversalTime());
            CsvExporter.ExportReadings(dlg.FileName, filtered);
            SetStatus("Exported to " + dlg.FileName);
        }
        catch (System.Exception ex) { SetStatus("Export failed: " + ex.Message); }
    }

    // -------- Alerts --------
    private async Task LoadAlertsAsync()
    {
        try
        {
            var list = await App.Api.ListAlertsAsync(200);
            _alerts.Clear();
            foreach (var a in list.Events) _alerts.Add(a);
            SetStatus($"Loaded {_alerts.Count} alerts");
        }
        catch (System.Exception ex) { SetStatus("Alerts load failed: " + ex.Message); }
    }

    private async void LoadAlerts_Click(object sender, RoutedEventArgs e) => await LoadAlertsAsync();

    private void AckAlert_Click(object sender, RoutedEventArgs e)
    {
        // Disabled in the XAML — server-side ack endpoint is a Phase 2
        // deliverable. Kept as a no-op handler to satisfy the binding.
        SetStatus("Per-event acknowledge ships with the server-side ack endpoint in Phase 2.");
    }

    // -------- Thresholds --------
    private async Task LoadThresholdsAsync()
    {
        try
        {
            var list = await App.Api.ListSiteThresholdsAsync();
            _thresholds.Clear();
            foreach (var t in list.Thresholds) _thresholds.Add(t);
        }
        catch (System.Exception ex) { SetStatus("Thresholds load failed: " + ex.Message); }
    }

    private async void LoadThresholds_Click(object sender, RoutedEventArgs e) => await LoadThresholdsAsync();

    private async void SaveThreshold_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var site = ThSiteBox.Text.Trim();
            if (string.IsNullOrEmpty(site)) { SetStatus("Site ID required."); return; }
            if (!int.TryParse(ThMinBox.Text, out var min) || min <= 0)
            {
                SetStatus("Threshold must be a positive integer."); return;
            }
            int? cool = int.TryParse(ThCoolBox.Text, out var c) && c >= 0 ? c : null;
            await App.Api.UpsertSiteThresholdAsync(site, min, cool);
            await LoadThresholdsAsync();
            SetStatus("Saved threshold for " + site);
        }
        catch (System.Exception ex) { SetStatus("Save failed: " + ex.Message); }
    }

    // -------- Assignments --------
    private async Task LoadAssignmentsAsync()
    {
        try
        {
            var list = await App.Api.ListSiteAssignmentsAsync();
            _assignments.Clear();
            foreach (var a in list.Assignments) _assignments.Add(a);
        }
        catch (System.Exception ex) { SetStatus("Assignments load failed: " + ex.Message); }
    }

    private async void LoadAssignments_Click(object sender, RoutedEventArgs e) => await LoadAssignmentsAsync();

    private async void SaveAssignments_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var site = AssignSiteBox.Text.Trim();
            if (string.IsNullOrEmpty(site)) { SetStatus("Site ID required."); return; }
            var devices = AssignDevicesBox.Text
                .Split(',', System.StringSplitOptions.RemoveEmptyEntries | System.StringSplitOptions.TrimEntries)
                .ToArray();
            await App.Api.ReplaceSiteAssignmentsAsync(site, devices);
            await LoadAssignmentsAsync();
            SetStatus("Saved assignments for " + site);
        }
        catch (System.Exception ex) { SetStatus("Save failed: " + ex.Message); }
    }

    // -------- Modbus device list --------
    private void AddModbus_Click(object sender, RoutedEventArgs e)
    {
        if (!int.TryParse(ModPortBox.Text, out var port)) port = 502;
        if (!byte.TryParse(ModUnitBox.Text, out var unit)) unit = 1;
        if (!int.TryParse(ModPollBox.Text, out var poll)) poll = 30;
        var dev = new ModbusDeviceConfig
        {
            DeviceId = ModDeviceBox.Text.Trim(),
            Host = ModHostBox.Text.Trim(),
            Port = port,
            UnitId = unit,
            PollIntervalSeconds = poll,
        };
        _modbusDevices.Add(dev);
        App.Settings.Devices = _modbusDevices.ToList();
        App.Settings.Save();
        SetStatus("Added Modbus device " + dev.DeviceId);
    }

    private void RemoveModbus_Click(object sender, RoutedEventArgs e)
    {
        if (ModbusGrid.SelectedItem is ModbusDeviceConfig d)
        {
            _modbusDevices.Remove(d);
            App.Settings.Devices = _modbusDevices.ToList();
            App.Settings.Save();
        }
    }

    // -------- Settings --------
    private void SaveSettings_Click(object sender, RoutedEventArgs e)
    {
        App.Settings.ApiBaseUrl = SettingsUrlBox.Text.Trim();
        App.Settings.IngestToken = string.IsNullOrEmpty(SettingsTokenBox.Password) ? null : SettingsTokenBox.Password;
        App.Settings.LogLevel = (SettingsLogLevel.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? "Information";
        App.Settings.Save();
        App.Api = new ApiClient(App.Settings.ApiBaseUrl, App.Settings.SessionToken);
        ApiUrlLabel.Text = App.Settings.ApiBaseUrl;
        SettingsStatus.Text = " Saved.";
    }

    // -------- Relay --------
    private void StartRelay_Click(object sender, RoutedEventArgs e)
    {
        if (_relayCts is not null) return;
        if (string.IsNullOrEmpty(App.Settings.IngestToken))
        {
            SetStatus("Configure the ingest token in Settings first.");
            return;
        }
        if (App.Settings.Devices.Count == 0)
        {
            SetStatus("Add at least one Modbus device first.");
            return;
        }
        _relayCts = new CancellationTokenSource();
        var relay = new ModbusRelay(App.Settings, App.Api, NullLogger.Instance);
        _ = Task.Run(async () =>
        {
            try { await relay.RunAsync(_relayCts.Token); }
            catch (System.Exception ex)
            {
                Dispatcher.Invoke(() => SetStatus("Relay crashed: " + ex.Message));
            }
        });
        RelayStatus.Text = "Relay is running.";
        StartRelayBtn.IsEnabled = false;
        StopRelayBtn.IsEnabled = true;
    }

    private void StopRelay_Click(object sender, RoutedEventArgs e)
    {
        _relayCts?.Cancel();
        _relayCts = null;
        RelayStatus.Text = "Relay stopped.";
        StartRelayBtn.IsEnabled = true;
        StopRelayBtn.IsEnabled = false;
    }

    // -------- Live tail (polls /modbus/readings every 5s) --------
    private void StartLiveTail()
    {
        _liveTailCts = new CancellationTokenSource();
        var ct = _liveTailCts.Token;
        _ = Task.Run(async () =>
        {
            long lastId = 0;
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    var list = await App.Api.ListReadingsAsync(20, ct: ct);
                    foreach (var r in list.Readings.OrderBy(r => r.Id))
                    {
                        if (r.Id <= lastId) continue;
                        lastId = r.Id;
                        var line = $"[{r.ReceivedAt:HH:mm:ss}] {r.DeviceId} status={r.ParsingStatus}\n";
                        Dispatcher.Invoke(() =>
                        {
                            LiveTailBox.AppendText(line);
                            LiveTailBox.ScrollToEnd();
                        });
                    }
                }
                catch { /* swallow — live tail is best-effort */ }
                try { await Task.Delay(TimeSpan.FromSeconds(5), ct); }
                catch (System.OperationCanceledException) { break; }
            }
        }, ct);
    }

    // -------- Logout --------
    private async void LogoutButton_Click(object sender, RoutedEventArgs e)
    {
        try { await App.Api.LogoutAsync(); } catch { /* ignore */ }
        App.Settings.SessionToken = null;
        App.Settings.SessionExpiresAt = null;
        App.Settings.Save();
        var login = new LoginWindow();
        Application.Current.MainWindow = login;
        login.Show();
        Close();
    }
}
