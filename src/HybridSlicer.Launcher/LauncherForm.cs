using System.Diagnostics;
using System.Drawing.Drawing2D;

namespace HybridSlicer.Launcher;

[System.Runtime.Versioning.SupportedOSPlatform("windows")]
public sealed class LauncherForm : Form
{
    private readonly Process _server;
    private readonly string  _networkIp;
    private readonly string? _curaPath;
    private readonly System.Windows.Forms.Timer _healthTimer;

    // dark-mode palette
    private static readonly Color BgDark    = Color.FromArgb(24,  24,  27);
    private static readonly Color BgCard    = Color.FromArgb(39,  39,  42);
    private static readonly Color Accent    = Color.FromArgb(99,  207, 134);
    private static readonly Color AccentNet = Color.FromArgb(251, 146, 60);
    private static readonly Color Muted     = Color.FromArgb(161, 161, 170);
    private static readonly Color BtnBlue   = Color.FromArgb(59,  130, 246);
    private static readonly Color BtnRed    = Color.FromArgb(220, 38,  38);
    private static readonly Color BtnGray   = Color.FromArgb(63,  63,  70);

    private Label _statusDot = null!;

    public LauncherForm(Process server, string networkIp, string? curaPath)
    {
        _server    = server;
        _networkIp = networkIp;
        _curaPath  = curaPath;

        _healthTimer = new System.Windows.Forms.Timer { Interval = 2000 };
        _healthTimer.Tick += (_, _) => UpdateStatus();

        BuildUi();
        _healthTimer.Start();
    }

    private void BuildUi()
    {
        Text            = "HybridSlicer Launcher";
        Size            = new Size(460, 310);
        MinimumSize     = Size;
        MaximumSize     = Size;
        MaximizeBox     = false;
        StartPosition   = FormStartPosition.CenterScreen;
        BackColor       = BgDark;
        ForeColor       = Color.White;
        FormBorderStyle = FormBorderStyle.FixedSingle;

        // ── Title bar area ────────────────────────────────────────────────────
        var titleLabel = MakeLabel("HybridSlicer", new Point(20, 20),
            new Font("Segoe UI", 14, FontStyle.Bold));
        titleLabel.ForeColor = Color.White;

        _statusDot = MakeLabel("● Starting…", new Point(20, 52));
        _statusDot.ForeColor = Color.Yellow;

        // ── URL card ──────────────────────────────────────────────────────────
        var card = new Panel
        {
            Location  = new Point(14, 82),
            Size      = new Size(416, 100),
            BackColor = BgCard,
        };
        RoundPanel(card, 8);
        Controls.Add(card);

        var localLabel = MakeLabel("Local :", new Point(14, 14), parent: card);
        localLabel.ForeColor = Muted;
        localLabel.Size      = new Size(60, 20);

        var localLink = MakeLink("http://localhost:5000",
            new Point(80, 14), "http://localhost:5000", card);
        localLink.ForeColor = Accent;

        var netLabel = MakeLabel("Network :", new Point(14, 48), parent: card);
        netLabel.ForeColor = Muted;
        netLabel.Size      = new Size(60, 20);

        var netText = $"http://{_networkIp}:5000";
        var netLink = MakeLink(netText, new Point(80, 48), netText, card);
        netLink.Font      = new Font("Segoe UI", 9.5f, FontStyle.Bold);
        netLink.ForeColor = AccentNet;

        // ── Cura status ───────────────────────────────────────────────────────
        var curaLabel = MakeLabel(
            _curaPath is not null
                ? $"CuraEngine: auto-detected ✓"
                : "CuraEngine: not found — set path manually in appsettings.json",
            new Point(20, 192));
        curaLabel.ForeColor = _curaPath is not null ? Accent : Color.FromArgb(248, 113, 113);
        curaLabel.Size      = new Size(420, 18);

        // ── Buttons ───────────────────────────────────────────────────────────
        var btnOpen = MakeButton("Open in Browser", new Point(20, 222), BtnBlue, 140);
        btnOpen.Click += (_, _) => OpenUrl($"http://{_networkIp}:5000");

        var btnCopy = MakeButton("Copy URL", new Point(168, 222), BtnGray, 100);
        btnCopy.Click += (_, _) =>
        {
            Clipboard.SetText($"http://{_networkIp}:5000");
            btnCopy.Text = "Copied!";
            Task.Delay(1500).ContinueWith(_ => Invoke(() => btnCopy.Text = "Copy URL"));
        };

        var btnLogs = MakeButton("View Logs", new Point(276, 222), BtnGray, 90);
        btnLogs.Click += (_, _) =>
        {
            var logPath = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "logs", "server.log");
            if (File.Exists(logPath))
                Process.Start(new ProcessStartInfo("notepad.exe", logPath) { UseShellExecute = true });
            else
                MessageBox.Show("No log file found.", "Logs", MessageBoxButtons.OK, MessageBoxIcon.Information);
        };

        var btnStop = MakeButton("Stop", new Point(374, 222), BtnRed, 66);
        btnStop.Click += (_, _) => Close();

        Controls.AddRange(new Control[] { titleLabel, _statusDot, curaLabel, btnOpen, btnCopy, btnLogs, btnStop });

        FormClosed += (_, _) =>
        {
            _healthTimer.Stop();
            try { if (!_server.HasExited) _server.Kill(entireProcessTree: true); } catch { }
        };
    }

    private void UpdateStatus()
    {
        if (_server.HasExited)
        {
            _statusDot.Text      = "● Server stopped";
            _statusDot.ForeColor = Color.FromArgb(248, 113, 113);
            return;
        }

        // Quick TCP check on port 5000
        try
        {
            using var tcp = new System.Net.Sockets.TcpClient();
            var result = tcp.BeginConnect("127.0.0.1", 5000, null, null);
            if (result.AsyncWaitHandle.WaitOne(300))
            {
                tcp.EndConnect(result);
                _statusDot.Text      = "● Running";
                _statusDot.ForeColor = Accent;
                return;
            }
        }
        catch { }

        _statusDot.Text      = "● Starting…";
        _statusDot.ForeColor = Color.Yellow;
    }

    // ── Factory helpers ───────────────────────────────────────────────────────

    private Label MakeLabel(string text, Point loc, Font? font = null, Control? parent = null)
    {
        var lbl = new Label
        {
            Text      = text,
            AutoSize  = true,
            Location  = loc,
            Font      = font ?? new Font("Segoe UI", 9f),
            BackColor = Color.Transparent,
            ForeColor = Color.White,
        };
        (parent ?? this).Controls.Add(lbl);
        return lbl;
    }

    private LinkLabel MakeLink(string text, Point loc, string url, Control parent)
    {
        var lnk = new LinkLabel
        {
            Text      = text,
            AutoSize  = true,
            Location  = loc,
            Font      = new Font("Segoe UI", 9f),
            BackColor = Color.Transparent,
            LinkColor = Accent,
            ActiveLinkColor = Color.White,
        };
        lnk.LinkClicked += (_, _) => OpenUrl(url);
        parent.Controls.Add(lnk);
        return lnk;
    }

    private Button MakeButton(string text, Point loc, Color bg, int width)
    {
        var btn = new Button
        {
            Text      = text,
            Location  = loc,
            Size      = new Size(width, 34),
            BackColor = bg,
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
            Font      = new Font("Segoe UI", 9f),
            Cursor    = Cursors.Hand,
        };
        btn.FlatAppearance.BorderSize = 0;
        Controls.Add(btn);
        return btn;
    }

    private static void RoundPanel(Panel p, int radius)
    {
        var path = new GraphicsPath();
        path.AddArc(0, 0, radius * 2, radius * 2, 180, 90);
        path.AddArc(p.Width - radius * 2, 0, radius * 2, radius * 2, 270, 90);
        path.AddArc(p.Width - radius * 2, p.Height - radius * 2, radius * 2, radius * 2, 0, 90);
        path.AddArc(0, p.Height - radius * 2, radius * 2, radius * 2, 90, 90);
        path.CloseAllFigures();
        p.Region = new Region(path);
    }

    private static void OpenUrl(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _healthTimer.Dispose();
        base.Dispose(disposing);
    }
}
