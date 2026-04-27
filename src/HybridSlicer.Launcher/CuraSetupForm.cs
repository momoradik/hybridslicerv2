using System.Diagnostics;
using System.Runtime.Versioning;

namespace HybridSlicer.Launcher;

/// <summary>
/// First-run dialog: downloads and silently installs UltiMaker Cura 5.12.0 so
/// CuraEngine is available for slicing without any manual user action.
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class CuraSetupForm : Form
{
    // EXE installer (167 MB, NSIS-based, self-elevating)
    private const string InstallerUrl =
        "https://github.com/Ultimaker/Cura/releases/download/5.12.0/UltiMaker-Cura-5.12.0-win64-X64.exe";

    private static readonly string LogPath =
        Path.Combine(Path.GetTempPath(), "HybridSlicer-CuraSetup.log");

    private static readonly Color BgDark  = Color.FromArgb(24, 24, 27);
    private static readonly Color BgCard  = Color.FromArgb(39, 39, 42);
    private static readonly Color Accent  = Color.FromArgb(99, 207, 134);
    private static readonly Color Muted   = Color.FromArgb(161, 161, 170);
    private static readonly Color BtnGray = Color.FromArgb(63, 63, 70);
    private static readonly Color BtnRed  = Color.FromArgb(220, 38, 38);

    private readonly Label       _statusLabel;
    private readonly Label       _detailLabel;
    private readonly ProgressBar _progress;
    private readonly Button      _skipBtn;
    private readonly Button      _detailsBtn;
    private readonly CancellationTokenSource _cts = new();

    private string _lastError = "";

    public bool Succeeded { get; private set; }

    public CuraSetupForm(string reason)
    {
        Text            = "HybridSlicer — First-time Setup";
        Size            = new Size(520, 310);
        MinimumSize     = Size;
        MaximumSize     = Size;
        MaximizeBox     = false;
        StartPosition   = FormStartPosition.CenterScreen;
        BackColor       = BgDark;
        ForeColor       = Color.White;
        FormBorderStyle = FormBorderStyle.FixedSingle;

        var title = new Label
        {
            Text      = "Setting up CuraEngine",
            Font      = new Font("Segoe UI", 13, FontStyle.Bold),
            ForeColor = Color.White,
            BackColor = Color.Transparent,
            AutoSize  = true,
            Location  = new Point(20, 18),
        };
        Controls.Add(title);

        var reasonLabel = new Label
        {
            Text      = reason,
            Font      = new Font("Segoe UI", 9f),
            ForeColor = Muted,
            BackColor = Color.Transparent,
            Size      = new Size(475, 36),
            Location  = new Point(20, 52),
        };
        Controls.Add(reasonLabel);

        var card = new Panel
        {
            Location  = new Point(14, 95),
            Size      = new Size(480, 110),
            BackColor = BgCard,
        };
        Controls.Add(card);

        _statusLabel = new Label
        {
            Text      = "Preparing download…",
            Font      = new Font("Segoe UI", 9.5f, FontStyle.Bold),
            ForeColor = Color.White,
            BackColor = Color.Transparent,
            AutoSize  = true,
            Location  = new Point(14, 14),
        };
        card.Controls.Add(_statusLabel);

        _detailLabel = new Label
        {
            Text      = "",
            Font      = new Font("Segoe UI", 8.5f),
            ForeColor = Muted,
            BackColor = Color.Transparent,
            Size      = new Size(452, 18),
            Location  = new Point(14, 36),
        };
        card.Controls.Add(_detailLabel);

        _progress = new ProgressBar
        {
            Location = new Point(14, 62),
            Size     = new Size(452, 20),
            Style    = ProgressBarStyle.Blocks,
            Minimum  = 0,
            Maximum  = 100,
        };
        card.Controls.Add(_progress);

        var noteLabel = new Label
        {
            Text      = "You will be asked for administrator permission and to complete the Cura installer.",
            Font      = new Font("Segoe UI", 8.5f),
            ForeColor = Muted,
            BackColor = Color.Transparent,
            Size      = new Size(475, 18),
            Location  = new Point(20, 218),
        };
        Controls.Add(noteLabel);

        _detailsBtn = new Button
        {
            Text      = "View Error Details",
            Location  = new Point(20, 268),
            Size      = new Size(140, 28),
            BackColor = BtnGray,
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
            Font      = new Font("Segoe UI", 8.5f),
            Cursor    = Cursors.Hand,
            Visible   = false,
        };
        _detailsBtn.FlatAppearance.BorderSize = 0;
        _detailsBtn.Click += (_, _) => ShowErrorDetails();
        Controls.Add(_detailsBtn);

        _skipBtn = new Button
        {
            Text      = "Skip (slicing won't work)",
            Location  = new Point(335, 268),
            Size      = new Size(169, 28),
            BackColor = BtnGray,
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
            Font      = new Font("Segoe UI", 8.5f),
            Cursor    = Cursors.Hand,
        };
        _skipBtn.FlatAppearance.BorderSize = 0;
        _skipBtn.Click += (_, _) => Cancel();
        Controls.Add(_skipBtn);

        Load += async (_, _) => await RunSetupAsync();
    }

    private async Task RunSetupAsync()
    {
        var installerPath = Path.Combine(Path.GetTempPath(), "UltiMaker-Cura-5.12.0-win64-X64.exe");
        Log("=== HybridSlicer Cura Setup ===");
        Log($"Timestamp: {DateTime.Now:yyyy-MM-dd HH:mm:ss}");

        try
        {
            await DownloadAsync(installerPath);
            await InstallAsync(installerPath);

            Succeeded = true;
            Log("SUCCESS: Cura 5.12.0 installed.");
            Invoke(() =>
            {
                _statusLabel.Text      = "Installation complete!";
                _statusLabel.ForeColor = Accent;
                _detailLabel.Text      = "CuraEngine 5.12.0 is ready. Launching HybridSlicer…";
                _progress.Value        = 100;
                _skipBtn.Text          = "Continue";
                _skipBtn.BackColor     = Color.FromArgb(22, 163, 74);
            });

            await Task.Delay(1500, _cts.Token);
            Invoke(Close);
        }
        catch (OperationCanceledException)
        {
            Log("Cancelled by user.");
        }
        catch (Exception ex)
        {
            _lastError = ex.ToString();
            Log($"ERROR: {ex}");
            Invoke(() =>
            {
                _statusLabel.Text      = "Setup failed";
                _statusLabel.ForeColor = BtnRed;

                // Show first line of error (up to 80 chars)
                var firstLine = ex.Message.Split('\n')[0].Trim();
                _detailLabel.Text = firstLine.Length > 80 ? firstLine[..77] + "…" : firstLine;

                _detailsBtn.Visible = true;
                _skipBtn.Text       = "Close (slicing won't work)";
            });
        }
        finally
        {
            try { if (File.Exists(installerPath)) File.Delete(installerPath); } catch { }
        }
    }

    private async Task DownloadAsync(string destPath)
    {
        SetStatus("Downloading UltiMaker Cura 5.12.0…", "Connecting…");
        Log($"Downloading from: {InstallerUrl}");

        // HttpClient follows redirects (GitHub → CDN) automatically
        using var handler = new HttpClientHandler { AllowAutoRedirect = true, MaxAutomaticRedirections = 10 };
        using var http    = new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(30) };
        http.DefaultRequestHeaders.Add("User-Agent", "HybridSlicer/1.0");

        using var response = await http.GetAsync(InstallerUrl, HttpCompletionOption.ResponseHeadersRead, _cts.Token);
        Log($"HTTP status: {(int)response.StatusCode} {response.StatusCode}");
        Log($"Final URL: {response.RequestMessage?.RequestUri}");
        response.EnsureSuccessStatusCode();

        var total    = response.Content.Headers.ContentLength ?? -1;
        var totalMb  = total > 0 ? $"{total / 1_048_576.0:F0} MB" : "?? MB";
        Log($"Content-Length: {total} bytes ({totalMb})");

        var  buf        = new byte[131_072];
        long downloaded = 0;

        await using var src  = await response.Content.ReadAsStreamAsync(_cts.Token);
        await using var dest = File.Create(destPath);

        int read;
        while ((read = await src.ReadAsync(buf, _cts.Token)) > 0)
        {
            await dest.WriteAsync(buf.AsMemory(0, read), _cts.Token);
            downloaded += read;

            if (total > 0)
            {
                var pct  = (int)(downloaded * 100 / total);
                var dlMb = downloaded / 1_048_576.0;
                SetStatus("Downloading UltiMaker Cura 5.12.0…",
                    $"{dlMb:F1} MB / {totalMb}  ({pct}%)", pct);
            }
        }

        Log($"Download complete: {downloaded / 1_048_576.0:F1} MB saved to {destPath}");
    }

    private async Task InstallAsync(string installerPath)
    {
        Log($"Running installer: {installerPath}");

        // Warn user BEFORE the UAC prompt so they know to click Yes
        var confirmed = false;
        Invoke(() =>
        {
            SetStatus("Ready to install…", "Please read the message below, then click OK.");
            var result = MessageBox.Show(
                "Windows is about to ask for administrator permission to install UltiMaker Cura 5.12.0.\n\n" +
                "► Click YES on the next Windows security prompt to allow the installation.\n\n" +
                "The Cura installer window will then open — click through it to finish.",
                "Administrator permission required",
                MessageBoxButtons.OKCancel,
                MessageBoxIcon.Information);
            confirmed = result == DialogResult.OK;
        });

        if (!confirmed)
            throw new Exception("Installation cancelled. Click 'Skip' to continue without slicing, or reopen HybridSlicer to try again.");

        SetStatus("Installing UltiMaker Cura 5.12.0…",
            "Cura installer is running — complete it to continue.", 96);

        // Run without silent flag so Cura's own installer UI handles elevation cleanly.
        // After the user finishes the installer, WaitForExit returns.
        Process proc;
        try
        {
            proc = Process.Start(new ProcessStartInfo
            {
                FileName        = installerPath,
                UseShellExecute = true,   // required for UAC elevation
            })!;
        }
        catch (System.ComponentModel.Win32Exception ex) when (ex.NativeErrorCode == 1223)
        {
            throw new Exception(
                "Windows administrator access was denied (you clicked No on the UAC prompt).\n\n" +
                "Please reopen HybridSlicer and click YES when Windows asks for permission.");
        }

        Log($"Installer PID: {proc.Id}");
        await proc.WaitForExitAsync(_cts.Token);
        Log($"Installer exit code: {proc.ExitCode}");

        // NSIS: 0 = success, 2 = user cancelled mid-install (not UAC)
        if (proc.ExitCode != 0)
            throw new Exception(
                $"The Cura installer did not complete successfully (exit {proc.ExitCode}).\n" +
                "Please try installing UltiMaker Cura 5.12.0 manually from ultimaker.com/software/ultimaker-cura/");
    }

    private void ShowErrorDetails()
    {
        var msg = $"Full error log saved to:\n{LogPath}\n\n{_lastError}";
        MessageBox.Show(msg, "Setup Error Details",
            MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    private void SetStatus(string status, string detail, int progressPct = -1)
    {
        if (IsDisposed) return;
        try
        {
            Invoke(() =>
            {
                _statusLabel.Text = status;
                _detailLabel.Text = detail;
                if (progressPct >= 0)
                    _progress.Value = Math.Min(progressPct, 100);
            });
        }
        catch { }
    }

    private static void Log(string msg)
    {
        try { File.AppendAllText(LogPath, msg + Environment.NewLine); } catch { }
    }

    private void Cancel()
    {
        _cts.Cancel();
        DialogResult = DialogResult.Cancel;
        Close();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _cts.Dispose();
        base.Dispose(disposing);
    }
}
