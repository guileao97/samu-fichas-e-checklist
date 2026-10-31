using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Printing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;
using Windows.Data.Pdf;
using Windows.Storage.Streams;

[assembly: AssemblyTitle("SAMU 192 Orlandia-SP - Servidor de Impressao da Base")]
[assembly: AssemblyDescription("Servidor automatico de impressao em nuvem (Google Drive -> Impressora da Base SAMU 192)")]
[assembly: AssemblyCompany("SAMU 192 - Orlandia-SP")]
[assembly: AssemblyProduct("SAMU 192 Impressora Base")]
[assembly: AssemblyVersion("1.0.7.0")]

namespace Samu192PrintServer
{
    internal sealed class LocalServerConfig
    {
        public string ScriptUrl;
        public string PrinterName;
        public string DuplexOverride; // "app", "duplex", "simplex"
        public bool Paused;

        public LocalServerConfig()
        {
            ScriptUrl = Program.DefaultScriptUrl;
            PrinterName = "";
            DuplexOverride = "app";
            Paused = false;
        }
    }

    internal sealed class LocalPrintHistory
    {
        public List<string> PrintedJobIds;
        public string TodayDate;
        public int PrintedCountToday;
        public string LastPrintedTitle;
        public string LastPrintedAt;

        public LocalPrintHistory()
        {
            PrintedJobIds = new List<string>();
            TodayDate = DateTime.Now.ToString("yyyy-MM-dd");
            PrintedCountToday = 0;
            LastPrintedTitle = "";
            LastPrintedAt = "";
        }
    }

    internal sealed class CloudPrintJob
    {
        public string SlotKey;
        public string JobId;
        public string RecordId;
        public string RecordType;
        public string Title;
        public string Date;
        public string DriveFileId;
        public string DriveUrl;
        public bool IsTestPage;
        public string DuplexMode;
        public int Copies;
        public string Trigger;
        public string RequestedBy;
        public string RequestedByName;
        public string CreatedAt;
        public string Status;
        public string UpdatedAt;
        public Dictionary<string, object> RawDict;
    }

    internal sealed class PrinterComboItem
    {
        public string PrinterName;
        public string DisplayText;
        public bool CanDuplex;
        public bool IsDefault;

        public override string ToString()
        {
            return DisplayText;
        }
    }

    internal sealed class DuplexComboItem
    {
        public string Code;
        public string Label;

        public DuplexComboItem(string code, string label)
        {
            Code = code;
            Label = label;
        }

        public override string ToString()
        {
            return Label;
        }
    }

    internal static class WinRtHelper
    {
        public static T WaitOp<T>(Windows.Foundation.IAsyncOperation<T> op, int timeoutMs)
        {
            int waited = 0;
            while (op.Status == Windows.Foundation.AsyncStatus.Started)
            {
                Thread.Sleep(8);
                waited += 8;
                if (timeoutMs > 0 && waited > timeoutMs)
                {
                    try { op.Cancel(); } catch { }
                    throw new TimeoutException("Tempo esgotado na operacao WinRT PDF.");
                }
            }
            if (op.Status == Windows.Foundation.AsyncStatus.Error)
            {
                if (op.ErrorCode != null) throw op.ErrorCode;
                throw new Exception("Falha interna WinRT ao processar PDF.");
            }
            return op.GetResults();
        }

        public static void WaitAction(Windows.Foundation.IAsyncAction act, int timeoutMs)
        {
            int waited = 0;
            while (act.Status == Windows.Foundation.AsyncStatus.Started)
            {
                Thread.Sleep(8);
                waited += 8;
                if (timeoutMs > 0 && waited > timeoutMs)
                {
                    try { act.Cancel(); } catch { }
                    throw new TimeoutException("Tempo esgotado ao renderizar pagina do PDF.");
                }
            }
            if (act.Status == Windows.Foundation.AsyncStatus.Error)
            {
                if (act.ErrorCode != null) throw act.ErrorCode;
                throw new Exception("Falha interna WinRT ao renderizar pagina A4.");
            }
            act.GetResults();
        }

        private static readonly Regex PagesCountRegex = new Regex(
            @"/Type\s+/Pages\b[^>]*?/Count\s+(\d+)",
            RegexOptions.Compiled | RegexOptions.CultureInvariant
        );

        private static readonly Regex SamuJpegStreamRegex = new Regex(
            @"/Subtype\s+/Image\s+/Width\s+(\d+)\s+/Height\s+(\d+)\s+/ColorSpace\s+/DeviceRGB\s+/BitsPerComponent\s+8\s+/Filter\s+/DCTDecode\s+/Length\s+(\d+)\s*>>\s*stream\r?\n",
            RegexOptions.Compiled | RegexOptions.CultureInvariant
        );

        public static List<Bitmap> TryExtractDirectJpegPagesFromSamuPdf(byte[] pdfBytes)
        {
            if (pdfBytes == null || pdfBytes.Length < 256) return null;
            var extracted = new List<Bitmap>();
            try
            {
                Encoding latin1 = Encoding.GetEncoding(28591);
                string raw = latin1.GetString(pdfBytes);

                Match pm = PagesCountRegex.Match(raw);
                if (!pm.Success) return null;
                int expectedPages;
                if (!int.TryParse(pm.Groups[1].Value, out expectedPages) || expectedPages <= 0 || expectedPages > 20)
                {
                    return null;
                }

                MatchCollection matches = SamuJpegStreamRegex.Matches(raw);
                if (matches.Count != expectedPages) return null;

                for (int i = 0; i < matches.Count; i++)
                {
                    Match m = matches[i];
                    int imgW;
                    int imgH;
                    int byteLen;
                    if (!int.TryParse(m.Groups[1].Value, out imgW) ||
                        !int.TryParse(m.Groups[2].Value, out imgH) ||
                        !int.TryParse(m.Groups[3].Value, out byteLen))
                    {
                        DisposeBitmapList(extracted);
                        return null;
                    }
                    if (imgW < 600 || imgH < 600 || byteLen <= 128)
                    {
                        DisposeBitmapList(extracted);
                        return null;
                    }

                    int streamOffset = m.Index + m.Length;
                    if (streamOffset < 0 || streamOffset + byteLen > pdfBytes.Length)
                    {
                        DisposeBitmapList(extracted);
                        return null;
                    }
                    // Confirma assinatura JPEG SOI (0xFF 0xD8)
                    if (pdfBytes[streamOffset] != 0xFF || pdfBytes[streamOffset + 1] != 0xD8)
                    {
                        DisposeBitmapList(extracted);
                        return null;
                    }

                    using (var ms = new MemoryStream(pdfBytes, streamOffset, byteLen, false))
                    using (var tmpImg = Image.FromStream(ms))
                    {
                        extracted.Add(new Bitmap(tmpImg));
                    }
                }
                return extracted;
            }
            catch
            {
                DisposeBitmapList(extracted);
                return null;
            }
        }

        private static void DisposeBitmapList(List<Bitmap> list)
        {
            if (list == null) return;
            for (int i = 0; i < list.Count; i++)
            {
                try { if (list[i] != null) list[i].Dispose(); } catch { }
            }
            list.Clear();
        }

        public static List<Bitmap> RenderPdfPagesToBitmaps(byte[] pdfBytes, uint targetWidthPx)
        {
            // Fast-path (~18ms): extrai os JPEGs nativos 200 DPI diretamente dos PDFs gerados pelo SAMU sem re-rasterizar em PNG!
            List<Bitmap> directPages = TryExtractDirectJpegPagesFromSamuPdf(pdfBytes);
            if (directPages != null && directPages.Count > 0)
            {
                return directPages;
            }

            var pages = new List<Bitmap>();
            using (var rasIn = new InMemoryRandomAccessStream())
            {
                using (var writer = new DataWriter(rasIn))
                {
                    writer.WriteBytes(pdfBytes);
                    WaitOp(writer.StoreAsync(), 20000);
                    WaitOp(writer.FlushAsync(), 20000);
                    writer.DetachStream();
                }
                rasIn.Seek(0);
                PdfDocument pdfDoc = WaitOp(PdfDocument.LoadFromStreamAsync(rasIn), 30000);
                uint count = pdfDoc.PageCount;
                for (uint i = 0; i < count; i++)
                {
                    using (PdfPage page = pdfDoc.GetPage(i))
                    using (var rasOut = new InMemoryRandomAccessStream())
                    {
                        var opts = new PdfPageRenderOptions();
                        double w = page.Size.Width > 1.0 ? page.Size.Width : 595.0;
                        double h = page.Size.Height > 1.0 ? page.Size.Height : 842.0;
                        uint pageTargetW = (w > h) ? Math.Max(targetWidthPx, 2339u) : targetWidthPx;
                        opts.DestinationWidth = pageTargetW;
                        opts.DestinationHeight = (uint)Math.Round((double)pageTargetW * (h / w));

                        WaitAction(page.RenderToStreamAsync(rasOut, opts), 30000);
                        uint byteLen = (uint)rasOut.Size;
                        byte[] pngBytes = new byte[byteLen];
                        using (var reader = new DataReader(rasOut.GetInputStreamAt(0)))
                        {
                            WaitOp(reader.LoadAsync(byteLen), 20000);
                            reader.ReadBytes(pngBytes);
                        }
                        using (var ms = new MemoryStream(pngBytes))
                        using (var tmpImg = Image.FromStream(ms))
                        {
                            pages.Add(new Bitmap(tmpImg));
                        }
                    }
                }
            }
            return pages;
        }
    }

    internal sealed class MainForm : Form
    {
        private readonly string dataDir;
        private readonly string configPath;
        private readonly string historyPath;
        private readonly string exePath;
        private readonly bool startMinimized;

        private LocalServerConfig config;
        private LocalPrintHistory history;
        private readonly HashSet<string> printedSet = new HashSet<string>(StringComparer.Ordinal);
        private readonly object stateLock = new object();

        private ComboBox cmbPrinters;
        private ComboBox cmbDuplex;
        private TextBox txtScriptUrl;
        private CheckBox chkStartup;
        private Label lblStatusBanner;
        private Label lblStats;
        private TextBox txtLog;
        private Button btnPauseResume;
        private Button btnPollNow;
        private Button btnTestPrint;
        private NotifyIcon trayIcon;
        private Icon appIcon;

        private System.Threading.Timer pollTimer;
        private EventWaitHandle showWindowEvent;
        private RegisteredWaitHandle showWindowWaitHandle;
        private readonly object statusPushLock = new object();
        private int isPollingFlag = 0;
        private int pendingImmediatePoll = 0;
        private DateTime lastHeartbeatUtc = DateTime.MinValue;
        private bool allowRealExit = false;
        private bool shownTrayBalloonOnce = false;

        public MainForm(bool minimized, string overrideUrl, bool installMode)
        {
            startMinimized = minimized;
            exePath = Application.ExecutablePath;
            dataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "SAMU192_Impressora_Base"
            );
            if (!Directory.Exists(dataDir))
            {
                Directory.CreateDirectory(dataDir);
            }
            configPath = Path.Combine(dataDir, "config_impressora.json");
            historyPath = Path.Combine(dataDir, "impressos_historico.json");

            bool firstRun = !File.Exists(configPath);
            LoadConfigAndHistory(overrideUrl);
            if (installMode || firstRun)
            {
                EnableWindowsStartupSafe();
                EnsureDesktopShortcutSafe();
            }

            appIcon = BuildSamuIcon();
            BuildUi();
            BuildTrayIcon();
            RegisterSingleInstanceWakeListener();

            LoadInstalledPrinters(config.PrinterName);
            SyncStartupCheckboxState();

            AppendLog("Servidor de Impressao da Base SAMU 192 v1.0.7 (Modo Turbo) iniciado em: " + Environment.MachineName);
            AppendLog("Impressora ativa: " + GetSelectedPrinterName());

            PreWarmDriveConnectionsAsync();
            pollTimer = new System.Threading.Timer(OnPollTimerTick, null, 250, Timeout.Infinite);
        }

        private void PreWarmDriveConnectionsAsync()
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    var req = (HttpWebRequest)WebRequest.Create("https://drive.usercontent.google.com/");
                    req.Method = "HEAD";
                    req.AllowAutoRedirect = false;
                    Program.ApplyFastHttpSettings(req, 5000);
                    using (var resp = (HttpWebResponse)req.GetResponse()) { }
                }
                catch { }
            });
        }

        private void RegisterSingleInstanceWakeListener()
        {
            try
            {
                showWindowEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Program.ShowEventName);
                showWindowWaitHandle = ThreadPool.RegisterWaitForSingleObject(
                    showWindowEvent,
                    delegate
                    {
                        if (!allowRealExit && !IsDisposed)
                        {
                            try { BeginInvoke(new Action(RestoreFromTray)); } catch { }
                        }
                    },
                    null,
                    -1,
                    false
                );
            }
            catch { }
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            if (startMinimized)
            {
                HideToTray(false);
            }
            else
            {
                BringWindowToForeground();
            }
        }

        private void BringWindowToForeground()
        {
            try
            {
                ShowInTaskbar = true;
                if (WindowState == FormWindowState.Minimized)
                {
                    WindowState = FormWindowState.Normal;
                }
                TopMost = true;
                Show();
                BringToFront();
                Activate();
                Focus();
                TopMost = false;
            }
            catch { }
        }

        private Icon BuildSamuIcon()
        {
            try
            {
                using (var bmp = new Bitmap(32, 32))
                using (var g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.Clear(Color.Transparent);
                    using (var redBrush = new SolidBrush(Color.FromArgb(200, 16, 46)))
                    using (var whiteBrush = new SolidBrush(Color.White))
                    {
                        g.FillEllipse(redBrush, 1, 1, 30, 30);
                        g.FillRectangle(whiteBrush, 13, 6, 6, 20);
                        g.FillRectangle(whiteBrush, 6, 13, 20, 6);
                    }
                    IntPtr hIcon = bmp.GetHicon();
                    return Icon.FromHandle(hIcon);
                }
            }
            catch
            {
                return SystemIcons.Application;
            }
        }

        private void BuildUi()
        {
            Text = "SAMU 192 - Orlandia-SP | Servidor de Impressao Automatica da Base (v1.0.7 Turbo)";
            Size = new Size(780, 610);
            MinimumSize = new Size(720, 540);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(248, 250, 252);
            Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            Icon = appIcon;

            var headerPanel = new Panel();
            headerPanel.Dock = DockStyle.Top;
            headerPanel.Height = 68;
            headerPanel.BackColor = Color.FromArgb(185, 28, 28);
            headerPanel.Padding = new Padding(16, 10, 16, 10);

            var lblTitle = new Label();
            lblTitle.Text = "SAMU 192 - ORLANDIA-SP | IMPRESSORA AUTOMATICA DA BASE";
            lblTitle.ForeColor = Color.White;
            lblTitle.Font = new Font("Segoe UI", 12.5f, FontStyle.Bold);
            lblTitle.AutoSize = true;
            lblTitle.Location = new Point(16, 10);

            var lblSub = new Label();
            lblSub.Text = "Recebe automaticamente as Fichas e Check Lists enviados pelos celulares (4G / Wi-Fi) e imprime em A4";
            lblSub.ForeColor = Color.FromArgb(254, 226, 226);
            lblSub.Font = new Font("Segoe UI", 8.75f, FontStyle.Regular);
            lblSub.AutoSize = true;
            lblSub.Location = new Point(16, 38);

            headerPanel.Controls.Add(lblTitle);
            headerPanel.Controls.Add(lblSub);

            lblStatusBanner = new Label();
            lblStatusBanner.Dock = DockStyle.Top;
            lblStatusBanner.Height = 36;
            lblStatusBanner.TextAlign = ContentAlignment.MiddleLeft;
            lblStatusBanner.Padding = new Padding(14, 0, 14, 0);
            lblStatusBanner.BackColor = Color.FromArgb(220, 252, 231);
            lblStatusBanner.ForeColor = Color.FromArgb(20, 83, 45);
            lblStatusBanner.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            lblStatusBanner.Text = "Conectando ao Google Drive da Central SAMU...";

            var bodyPanel = new Panel();
            bodyPanel.Dock = DockStyle.Fill;
            bodyPanel.Padding = new Padding(16, 12, 16, 14);

            int y = 8;

            var lblPrinter = new Label();
            lblPrinter.Text = "Impressora Instalada neste Computador da Base:";
            lblPrinter.Font = new Font("Segoe UI", 9.25f, FontStyle.Bold);
            lblPrinter.AutoSize = true;
            lblPrinter.Location = new Point(16, y);
            bodyPanel.Controls.Add(lblPrinter);
            y += 22;

            cmbPrinters = new ComboBox();
            cmbPrinters.DropDownStyle = ComboBoxStyle.DropDownList;
            cmbPrinters.Location = new Point(16, y);
            cmbPrinters.Size = new Size(575, 28);
            cmbPrinters.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            cmbPrinters.SelectedIndexChanged += OnPrinterSelectionChanged;
            bodyPanel.Controls.Add(cmbPrinters);

            var btnRefreshPrinters = new Button();
            btnRefreshPrinters.Text = "Atualizar Lista";
            btnRefreshPrinters.Location = new Point(600, y - 1);
            btnRefreshPrinters.Size = new Size(144, 29);
            btnRefreshPrinters.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            btnRefreshPrinters.BackColor = Color.White;
            btnRefreshPrinters.FlatStyle = FlatStyle.System;
            btnRefreshPrinters.Click += delegate {
                LoadInstalledPrinters(GetSelectedPrinterName());
                AppendLog("Lista de impressoras do Windows atualizada.");
            };
            bodyPanel.Controls.Add(btnRefreshPrinters);
            y += 38;

            var lblDuplex = new Label();
            lblDuplex.Text = "Modo de Impressao das 2 Paginas A4 (Frente e Verso):";
            lblDuplex.Font = new Font("Segoe UI", 9.25f, FontStyle.Bold);
            lblDuplex.AutoSize = true;
            lblDuplex.Location = new Point(16, y);
            bodyPanel.Controls.Add(lblDuplex);
            y += 22;

            cmbDuplex = new ComboBox();
            cmbDuplex.DropDownStyle = ComboBoxStyle.DropDownList;
            cmbDuplex.Location = new Point(16, y);
            cmbDuplex.Size = new Size(728, 28);
            cmbDuplex.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            cmbDuplex.Items.Add(new DuplexComboItem("app", "Automatico (Seguir configuracao do App - Frente e Verso quando suportado)"));
            cmbDuplex.Items.Add(new DuplexComboItem("duplex", "Forcar Sempre Frente e Verso (Duplex Automatico)"));
            cmbDuplex.Items.Add(new DuplexComboItem("simplex", "Forcar Sempre 2 Folhas Separadas (Apenas Frente)"));
            SelectDuplexCombo(config.DuplexOverride);
            cmbDuplex.SelectedIndexChanged += delegate {
                var item = cmbDuplex.SelectedItem as DuplexComboItem;
                if (item != null)
                {
                    config.DuplexOverride = item.Code;
                    SaveConfig();
                    AppendLog("Modo de impressao alterado para: " + item.Label);
                }
            };
            bodyPanel.Controls.Add(cmbDuplex);
            y += 38;

            var lblUrl = new Label();
            lblUrl.Text = "Conexao Google Drive da Central SAMU (Apps Script URL):";
            lblUrl.Font = new Font("Segoe UI", 9.25f, FontStyle.Bold);
            lblUrl.AutoSize = true;
            lblUrl.Location = new Point(16, y);
            bodyPanel.Controls.Add(lblUrl);
            y += 22;

            txtScriptUrl = new TextBox();
            txtScriptUrl.Location = new Point(16, y);
            txtScriptUrl.Size = new Size(595, 26);
            txtScriptUrl.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            txtScriptUrl.Text = config.ScriptUrl;
            bodyPanel.Controls.Add(txtScriptUrl);

            var btnSaveUrl = new Button();
            btnSaveUrl.Text = "Salvar URL";
            btnSaveUrl.Location = new Point(620, y - 1);
            btnSaveUrl.Size = new Size(124, 28);
            btnSaveUrl.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            btnSaveUrl.Click += delegate {
                config.ScriptUrl = (txtScriptUrl.Text ?? "").Trim();
                SaveConfig();
                AppendLog("URL do Google Drive salva com sucesso.");
                TriggerImmediatePoll();
            };
            bodyPanel.Controls.Add(btnSaveUrl);
            y += 34;

            chkStartup = new CheckBox();
            chkStartup.Text = "Iniciar automaticamente junto com o Windows (recomendado para o PC da Base)";
            chkStartup.Font = new Font("Segoe UI", 9.25f, FontStyle.Bold);
            chkStartup.ForeColor = Color.FromArgb(15, 23, 42);
            chkStartup.AutoSize = true;
            chkStartup.Location = new Point(16, y);
            chkStartup.CheckedChanged += OnStartupCheckedChanged;
            bodyPanel.Controls.Add(chkStartup);
            y += 30;

            btnTestPrint = new Button();
            btnTestPrint.Text = "Imprimir Pagina de Teste";
            btnTestPrint.Location = new Point(16, y);
            btnTestPrint.Size = new Size(195, 34);
            btnTestPrint.Font = new Font("Segoe UI", 9.25f, FontStyle.Bold);
            btnTestPrint.Click += OnTestPrintClick;
            bodyPanel.Controls.Add(btnTestPrint);

            btnPollNow = new Button();
            btnPollNow.Text = "Verificar Fila Agora";
            btnPollNow.Location = new Point(219, y);
            btnPollNow.Size = new Size(165, 34);
            btnPollNow.Font = new Font("Segoe UI", 9.25f, FontStyle.Bold);
            btnPollNow.Click += delegate {
                AppendLog("Verificando fila na nuvem manualmente...");
                TriggerImmediatePoll();
            };
            bodyPanel.Controls.Add(btnPollNow);

            btnPauseResume = new Button();
            btnPauseResume.Location = new Point(392, y);
            btnPauseResume.Size = new Size(140, 34);
            btnPauseResume.Click += OnPauseResumeClick;
            UpdatePauseButtonLabel();
            bodyPanel.Controls.Add(btnPauseResume);

            var btnMinimizeTray = new Button();
            btnMinimizeTray.Text = "Minimizar p/ Relogio";
            btnMinimizeTray.Location = new Point(540, y);
            btnMinimizeTray.Size = new Size(118, 34);
            btnMinimizeTray.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            btnMinimizeTray.Click += delegate { HideToTray(true); };
            bodyPanel.Controls.Add(btnMinimizeTray);

            var btnQuit = new Button();
            btnQuit.Text = "Encerrar";
            btnQuit.Location = new Point(664, y);
            btnQuit.Size = new Size(80, 34);
            btnQuit.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            btnQuit.Click += OnQuitServerClick;
            bodyPanel.Controls.Add(btnQuit);
            y += 42;

            lblStats = new Label();
            lblStats.Location = new Point(16, y);
            lblStats.Size = new Size(728, 22);
            lblStats.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            lblStats.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            lblStats.ForeColor = Color.FromArgb(51, 65, 85);
            UpdateStatsLabel();
            bodyPanel.Controls.Add(lblStats);
            y += 24;

            txtLog = new TextBox();
            txtLog.Multiline = true;
            txtLog.ReadOnly = true;
            txtLog.ScrollBars = ScrollBars.Vertical;
            txtLog.BackColor = Color.FromArgb(15, 23, 42);
            txtLog.ForeColor = Color.FromArgb(226, 232, 240);
            txtLog.Font = new Font("Consolas", 9.25f, FontStyle.Regular);
            txtLog.Location = new Point(16, y);
            txtLog.Size = new Size(728, 175);
            txtLog.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            bodyPanel.Controls.Add(txtLog);

            Controls.Add(bodyPanel);
            Controls.Add(lblStatusBanner);
            Controls.Add(headerPanel);
        }

        private void BuildTrayIcon()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add("Abrir Painel da Impressora SAMU 192", null, delegate { RestoreFromTray(); });
            menu.Items.Add("Verificar Fila Agora", null, delegate { TriggerImmediatePoll(); });
            menu.Items.Add("Imprimir Pagina de Teste", null, OnTestPrintClick);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Encerrar Servidor de Impressao", null, OnQuitServerClick);

            trayIcon = new NotifyIcon();
            trayIcon.Icon = appIcon;
            trayIcon.Text = "SAMU 192 - Servidor de Impressao da Base";
            trayIcon.Visible = true;
            trayIcon.ContextMenuStrip = menu;
            trayIcon.DoubleClick += delegate { RestoreFromTray(); };
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!allowRealExit && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                HideToTray(true);
                return;
            }
            base.OnFormClosing(e);
        }

        private void HideToTray(bool showBalloon)
        {
            Hide();
            ShowInTaskbar = false;
            if (showBalloon && !shownTrayBalloonOnce && trayIcon != null)
            {
                shownTrayBalloonOnce = true;
                trayIcon.ShowBalloonTip(
                    4000,
                    "SAMU 192 - Impressora da Base Ativa",
                    "O servidor continua rodando perto do relogio do Windows para imprimir automaticamente as Fichas e Check Lists!",
                    ToolTipIcon.Info
                );
            }
        }

        private void RestoreFromTray()
        {
            BringWindowToForeground();
        }

        private void OnQuitServerClick(object sender, EventArgs e)
        {
            DialogResult dr = MessageBox.Show(
                "Deseja realmente ENCERRAR o Servidor de Impressao da Base SAMU 192?\n\nEnquanto estiver fechado, as fichas enviadas pelos celulares ficarao aguardando na fila da nuvem ate abrir novamente.",
                "Encerrar Servidor de Impressao SAMU 192",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning
            );
            if (dr != DialogResult.Yes) return;

            allowRealExit = true;
            try
            {
                if (pollTimer != null) pollTimer.Dispose();
            }
            catch { }
            try
            {
                if (showWindowWaitHandle != null) showWindowWaitHandle.Unregister(null);
                if (showWindowEvent != null) showWindowEvent.Close();
            }
            catch { }

            // Tenta avisar a nuvem que foi encerrado
            ThreadPool.QueueUserWorkItem(delegate {
                try
                {
                    PushAgentStatusOnly("stopped");
                }
                catch { }
            });
            Thread.Sleep(350);

            if (trayIcon != null)
            {
                trayIcon.Visible = false;
                trayIcon.Dispose();
            }
            Application.Exit();
        }

        private const string RunRegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunRegistryValueName = "SAMU192_Impressora_Base";
        private bool suppressStartupEvent = false;

        private string GetStartupCmdPath()
        {
            string startupDir = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
            return Path.Combine(startupDir, "SAMU192_Impressora_Base.cmd");
        }

        private bool IsRunRegistryEnabled()
        {
            try
            {
                using (RegistryKey rk = Registry.CurrentUser.OpenSubKey(RunRegistryPath, false))
                {
                    if (rk != null)
                    {
                        string val = Convert.ToString(rk.GetValue(RunRegistryValueName, "") ?? "").Trim();
                        return !string.IsNullOrEmpty(val);
                    }
                }
            }
            catch { }
            return false;
        }

        private void EnsureDesktopShortcutSafe()
        {
            try
            {
                string desk = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                if (string.IsNullOrEmpty(desk) || !Directory.Exists(desk)) return;
                string lnkPath = Path.Combine(desk, "Impressora Base SAMU 192.lnk");
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;
                object shell = Activator.CreateInstance(shellType);
                object sc = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
                if (sc == null) return;
                Type scType = sc.GetType();
                scType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { exePath });
                scType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { Path.GetDirectoryName(exePath) ?? dataDir });
                scType.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { "Servidor de Impressao Automatica da Base SAMU 192 - Orlandia-SP" });
                scType.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
            }
            catch { }
        }

        private void EnableWindowsStartupSafe()
        {
            string cmdPath = GetStartupCmdPath();
            bool regOk = false;
            try
            {
                using (RegistryKey rk = Registry.CurrentUser.OpenSubKey(RunRegistryPath, true))
                {
                    if (rk != null)
                    {
                        rk.SetValue(RunRegistryValueName, "\"" + exePath + "\" --minimized", RegistryValueKind.String);
                        regOk = true;
                    }
                }
            }
            catch { }

            if (regOk)
            {
                try { if (File.Exists(cmdPath)) File.Delete(cmdPath); } catch { }
            }
            else
            {
                try
                {
                    string content = "@echo off\r\nstart \"\" \"" + exePath + "\" --minimized\r\n";
                    File.WriteAllText(cmdPath, content, Encoding.Default);
                }
                catch { }
            }
        }

        private void SyncStartupCheckboxState()
        {
            suppressStartupEvent = true;
            try
            {
                chkStartup.Checked = IsRunRegistryEnabled() || File.Exists(GetStartupCmdPath());
            }
            catch
            {
                chkStartup.Checked = false;
            }
            suppressStartupEvent = false;
        }

        private void OnStartupCheckedChanged(object sender, EventArgs e)
        {
            if (suppressStartupEvent) return;
            string cmdPath = GetStartupCmdPath();
            try
            {
                if (chkStartup.Checked)
                {
                    EnableWindowsStartupSafe();
                    AppendLog("Inicializacao automatica junto com o Windows ATIVADA.");
                }
                else
                {
                    try
                    {
                        using (RegistryKey rk = Registry.CurrentUser.OpenSubKey(RunRegistryPath, true))
                        {
                            if (rk != null) rk.DeleteValue(RunRegistryValueName, false);
                        }
                    }
                    catch { }
                    if (File.Exists(cmdPath)) File.Delete(cmdPath);
                    AppendLog("Inicializacao automatica junto com o Windows desativada.");
                }
            }
            catch (Exception ex)
            {
                AppendLog("Aviso ao configurar inicializacao do Windows: " + ex.Message);
            }
        }

        private void SelectDuplexCombo(string code)
        {
            string clean = (code ?? "app").Trim().ToLowerInvariant();
            for (int i = 0; i < cmbDuplex.Items.Count; i++)
            {
                var it = cmbDuplex.Items[i] as DuplexComboItem;
                if (it != null && it.Code == clean)
                {
                    cmbDuplex.SelectedIndex = i;
                    return;
                }
            }
            if (cmbDuplex.Items.Count > 0) cmbDuplex.SelectedIndex = 0;
        }

        private void LoadInstalledPrinters(string preferredName)
        {
            cmbPrinters.Items.Clear();
            string defaultPrinter = "";
            try
            {
                defaultPrinter = new PrinterSettings().PrinterName ?? "";
            }
            catch { }

            int selIdx = -1;
            int defIdx = -1;

            try
            {
                foreach (string pName in PrinterSettings.InstalledPrinters)
                {
                    bool canDup = false;
                    bool isDef = string.Equals(pName, defaultPrinter, StringComparison.OrdinalIgnoreCase);
                    try
                    {
                        var ps = new PrinterSettings();
                        ps.PrinterName = pName;
                        canDup = ps.CanDuplex;
                        if (ps.IsDefaultPrinter) isDef = true;
                    }
                    catch { }

                    var item = new PrinterComboItem();
                    item.PrinterName = pName;
                    item.CanDuplex = canDup;
                    item.IsDefault = isDef;
                    item.DisplayText = pName
                        + (isDef ? " [Padrao do Windows]" : "")
                        + (canDup ? " (Suporta Frente e Verso)" : " (Apenas Frente)");

                    int idx = cmbPrinters.Items.Add(item);
                    if (isDef) defIdx = idx;
                    if (!string.IsNullOrEmpty(preferredName) && string.Equals(pName, preferredName, StringComparison.OrdinalIgnoreCase))
                    {
                        selIdx = idx;
                    }
                }
            }
            catch (Exception ex)
            {
                AppendLog("Aviso ao consultar Spooler de Impressao do Windows: " + ex.Message);
            }

            if (selIdx >= 0) cmbPrinters.SelectedIndex = selIdx;
            else if (defIdx >= 0) cmbPrinters.SelectedIndex = defIdx;
            else if (cmbPrinters.Items.Count > 0) cmbPrinters.SelectedIndex = 0;
        }

        private bool suppressPrinterChange = false;

        private void OnPrinterSelectionChanged(object sender, EventArgs e)
        {
            if (suppressPrinterChange) return;
            var item = cmbPrinters.SelectedItem as PrinterComboItem;
            if (item != null)
            {
                config.PrinterName = item.PrinterName;
                SaveConfig();
                lastHeartbeatUtc = DateTime.MinValue;
                TriggerImmediatePoll();
            }
        }

        private string GetSelectedPrinterName()
        {
            if (InvokeRequired)
            {
                return (string)Invoke(new Func<string>(GetSelectedPrinterName));
            }
            var item = cmbPrinters.SelectedItem as PrinterComboItem;
            if (item != null && !string.IsNullOrEmpty(item.PrinterName)) return item.PrinterName;
            if (!string.IsNullOrEmpty(config.PrinterName)) return config.PrinterName;
            try { return new PrinterSettings().PrinterName ?? ""; }
            catch { return ""; }
        }

        private bool GetSelectedPrinterCanDuplex(string printerName)
        {
            if (string.IsNullOrEmpty(printerName)) return false;
            try
            {
                var ps = new PrinterSettings();
                ps.PrinterName = printerName;
                return ps.CanDuplex;
            }
            catch
            {
                return false;
            }
        }

        private void OnPauseResumeClick(object sender, EventArgs e)
        {
            config.Paused = !config.Paused;
            SaveConfig();
            UpdatePauseButtonLabel();
            AppendLog(config.Paused
                ? "Fila PAUSADA localmente (os documentos aguardarao na nuvem)."
                : "Fila RETOMADA! Verificando impressoes pendentes...");
            lastHeartbeatUtc = DateTime.MinValue;
            TriggerImmediatePoll();
        }

        private void UpdatePauseButtonLabel()
        {
            if (btnPauseResume == null) return;
            btnPauseResume.Text = config.Paused ? "Retomar Fila" : "Pausar Fila";
        }

        private void OnTestPrintClick(object sender, EventArgs e)
        {
            string pName = GetSelectedPrinterName();
            if (string.IsNullOrEmpty(pName))
            {
                MessageBox.Show("Nenhuma impressora selecionada no Windows.", "Impressora", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            btnTestPrint.Enabled = false;
            AppendLog("Enviando Pagina de Teste local para '" + pName + "'...");
            ThreadPool.QueueUserWorkItem(delegate {
                try
                {
                    PrintTestPageDocument(pName, "Teste Local no PC da Base");
                    AppendLog("Pagina de Teste enviada com sucesso para '" + pName + "'!");
                }
                catch (Exception ex)
                {
                    AppendLog("ERRO ao imprimir Pagina de Teste: " + ex.Message);
                }
                finally
                {
                    BeginInvoke(new Action(delegate { btnTestPrint.Enabled = true; }));
                }
            });
        }

        private void LoadConfigAndHistory(string overrideUrl)
        {
            var ser = CreateSerializer();
            config = new LocalServerConfig();
            if (File.Exists(configPath))
            {
                try
                {
                    var dict = ser.Deserialize<Dictionary<string, object>>(File.ReadAllText(configPath, Encoding.UTF8));
                    if (dict != null)
                    {
                        string sUrl = GetStr(dict, "scriptUrl");
                        if (!string.IsNullOrEmpty(sUrl)) config.ScriptUrl = sUrl;
                        config.PrinterName = GetStr(dict, "printerName");
                        string dup = GetStr(dict, "duplexOverride");
                        if (!string.IsNullOrEmpty(dup)) config.DuplexOverride = dup;
                        config.Paused = GetBool(dict, "paused", false);
                    }
                }
                catch { }
            }
            if (!string.IsNullOrEmpty(overrideUrl))
            {
                config.ScriptUrl = overrideUrl.Trim();
                SaveConfig();
            }

            history = new LocalPrintHistory();
            if (File.Exists(historyPath))
            {
                try
                {
                    var hDict = ser.Deserialize<Dictionary<string, object>>(File.ReadAllText(historyPath, Encoding.UTF8));
                    if (hDict != null)
                    {
                        history.TodayDate = GetStr(hDict, "todayDate");
                        history.PrintedCountToday = GetInt(hDict, "printedCountToday", 0);
                        history.LastPrintedTitle = GetStr(hDict, "lastPrintedTitle");
                        history.LastPrintedAt = GetStr(hDict, "lastPrintedAt");
                        object idsObj;
                        if (hDict.TryGetValue("printedJobIds", out idsObj) && idsObj is IEnumerable)
                        {
                            foreach (object item in (IEnumerable)idsObj)
                            {
                                string jid = Convert.ToString(item ?? "").Trim();
                                if (!string.IsNullOrEmpty(jid))
                                {
                                    history.PrintedJobIds.Add(jid);
                                    printedSet.Add(jid);
                                }
                            }
                        }
                    }
                }
                catch { }
            }
            EnsureHistoryDayCurrent();
        }

        private void EnsureHistoryDayCurrent()
        {
            string today = DateTime.Now.ToString("yyyy-MM-dd");
            if (history.TodayDate != today)
            {
                history.TodayDate = today;
                history.PrintedCountToday = 0;
            }
        }

        private void SaveConfig()
        {
            try
            {
                var ser = CreateSerializer();
                var dict = new Dictionary<string, object>();
                dict["scriptUrl"] = config.ScriptUrl ?? "";
                dict["printerName"] = config.PrinterName ?? "";
                dict["duplexOverride"] = config.DuplexOverride ?? "app";
                dict["paused"] = config.Paused;
                File.WriteAllText(configPath, ser.Serialize(dict), Encoding.UTF8);
            }
            catch { }
        }

        private void RecordJobPrintedLocally(string jobId, string title)
        {
            lock (stateLock)
            {
                EnsureHistoryDayCurrent();
                if (!string.IsNullOrEmpty(jobId) && !printedSet.Contains(jobId))
                {
                    printedSet.Add(jobId);
                    history.PrintedJobIds.Add(jobId);
                    while (history.PrintedJobIds.Count > 650)
                    {
                        string oldest = history.PrintedJobIds[0];
                        history.PrintedJobIds.RemoveAt(0);
                        printedSet.Remove(oldest);
                    }
                }
                history.PrintedCountToday++;
                history.LastPrintedTitle = title ?? "";
                history.LastPrintedAt = DateTime.UtcNow.ToString("o");

                try
                {
                    var ser = CreateSerializer();
                    var dict = new Dictionary<string, object>();
                    dict["todayDate"] = history.TodayDate;
                    dict["printedCountToday"] = history.PrintedCountToday;
                    dict["lastPrintedTitle"] = history.LastPrintedTitle;
                    dict["lastPrintedAt"] = history.LastPrintedAt;
                    dict["printedJobIds"] = history.PrintedJobIds;
                    File.WriteAllText(historyPath, ser.Serialize(dict), Encoding.UTF8);
                }
                catch { }
            }
            UpdateStatsLabelSafe();
        }

        private void UpdateStatsLabelSafe()
        {
            if (IsDisposed) return;
            if (InvokeRequired)
            {
                try { BeginInvoke(new Action(UpdateStatsLabel)); } catch { }
                return;
            }
            UpdateStatsLabel();
        }

        private void UpdateStatsLabel()
        {
            if (lblStats == null) return;
            EnsureHistoryDayCurrent();
            string lastTxt = string.IsNullOrEmpty(history.LastPrintedTitle)
                ? "Nenhum documento impresso ainda hoje"
                : ("Ultimo impresso: " + history.LastPrintedTitle);
            lblStats.Text = string.Format("Impressos hoje ({0}): {1}   |   {2}",
                DateTime.Now.ToString("dd/MM/yyyy"),
                history.PrintedCountToday,
                lastTxt);
        }

        private void SetBannerSafe(string text, bool isOk, bool isWarn)
        {
            if (IsDisposed) return;
            if (InvokeRequired)
            {
                try { BeginInvoke(new Action(delegate { SetBannerSafe(text, isOk, isWarn); })); } catch { }
                return;
            }
            lblStatusBanner.Text = text;
            if (isWarn)
            {
                lblStatusBanner.BackColor = Color.FromArgb(254, 243, 199);
                lblStatusBanner.ForeColor = Color.FromArgb(146, 64, 14);
            }
            else if (isOk)
            {
                lblStatusBanner.BackColor = Color.FromArgb(220, 252, 231);
                lblStatusBanner.ForeColor = Color.FromArgb(20, 83, 45);
            }
            else
            {
                lblStatusBanner.BackColor = Color.FromArgb(254, 226, 226);
                lblStatusBanner.ForeColor = Color.FromArgb(153, 27, 27);
            }
        }

        private void AppendLog(string msg)
        {
            if (IsDisposed) return;
            if (InvokeRequired)
            {
                try { BeginInvoke(new Action(delegate { AppendLog(msg); })); } catch { }
                return;
            }
            if (txtLog == null) return;
            string line = "[" + DateTime.Now.ToString("HH:mm:ss") + "] " + msg + "\r\n";
            if (txtLog.TextLength > 28000)
            {
                txtLog.Text = txtLog.Text.Substring(txtLog.TextLength - 16000);
            }
            txtLog.AppendText(line);
        }

        private void ScheduleNextPoll(int delayMs)
        {
            if (allowRealExit) return;
            try
            {
                if (pollTimer != null)
                {
                    pollTimer.Change(Math.Max(50, delayMs), Timeout.Infinite);
                }
            }
            catch { }
        }

        private void TriggerImmediatePoll()
        {
            Interlocked.Exchange(ref pendingImmediatePoll, 1);
            ThreadPool.QueueUserWorkItem(delegate { OnPollTimerTick(null); });
        }

        private void OnPollTimerTick(object state)
        {
            if (allowRealExit) return;
            if (Interlocked.CompareExchange(ref isPollingFlag, 1, 0) != 0) return;
            Interlocked.Exchange(ref pendingImmediatePoll, 0);
            try
            {
                PollCloudQueueOnce();
            }
            catch (Exception ex)
            {
                SetBannerSafe("Sem conexao temporaria com o Google Drive: " + ex.Message, false, true);
            }
            finally
            {
                Interlocked.Exchange(ref isPollingFlag, 0);
                if (!allowRealExit)
                {
                    int fastPending = Interlocked.Exchange(ref pendingImmediatePoll, 0);
                    int nextMs = fastPending != 0 ? 120 : ((config != null && config.Paused) ? 3500 : 1800);
                    ScheduleNextPoll(nextMs);
                }
            }
        }

        private Dictionary<string, object> BuildAgentHeartbeatDict(string printerName, string statusOverride)
        {
            EnsureHistoryDayCurrent();
            var agent = new Dictionary<string, object>();
            agent["key"] = "__print_agent__";
            agent["pcName"] = Environment.MachineName;
            agent["printerName"] = printerName ?? "";
            agent["canDuplex"] = GetSelectedPrinterCanDuplex(printerName);
            agent["printedCountToday"] = history.PrintedCountToday;
            agent["lastPrintedTitle"] = history.LastPrintedTitle ?? "";
            agent["lastPrintedAt"] = history.LastPrintedAt ?? "";
            agent["status"] = !string.IsNullOrEmpty(statusOverride)
                ? statusOverride
                : (config.Paused ? "paused" : "online");
            agent["updatedAt"] = DateTime.UtcNow.ToString("o");
            return agent;
        }

        private void PushAgentStatusOnly(string statusOverride)
        {
            string url = (config.ScriptUrl ?? "").Trim();
            if (string.IsNullOrEmpty(url)) return;
            string pName = config.PrinterName;
            if (string.IsNullOrEmpty(pName))
            {
                try { pName = new PrinterSettings().PrinterName ?? ""; } catch { }
            }
            var avPatch = new Dictionary<string, object>();
            avPatch["__print_agent__"] = BuildAgentHeartbeatDict(pName, statusOverride);

            var clientDb = new Dictionary<string, object>();
            clientDb["viaturaAvarias"] = avPatch;

            var payload = new Dictionary<string, object>();
            payload["action"] = "syncDatabase";
            payload["pushChanges"] = true;
            payload["onlyPrintQueue"] = true;
            payload["clientDb"] = clientDb;

            PostJsonToAppsScript(url, payload);
        }

        private void QueueStatusPushAsync(string url, Dictionary<string, object> avUpdatesCopy)
        {
            if (string.IsNullOrEmpty(url) || avUpdatesCopy == null || avUpdatesCopy.Count == 0) return;
            ThreadPool.QueueUserWorkItem(delegate
            {
                lock (statusPushLock)
                {
                    try
                    {
                        var clientDb = new Dictionary<string, object>();
                        clientDb["viaturaAvarias"] = avUpdatesCopy;

                        var pushPayload = new Dictionary<string, object>();
                        pushPayload["action"] = "syncDatabase";
                        pushPayload["pushChanges"] = true;
                        pushPayload["onlyPrintQueue"] = true;
                        pushPayload["clientDb"] = clientDb;

                        PostJsonToAppsScript(url, pushPayload);
                    }
                    catch { }
                }
            });
        }

        private void PollCloudQueueOnce()
        {
            string url = (config.ScriptUrl ?? "").Trim();
            if (string.IsNullOrEmpty(url))
            {
                SetBannerSafe("Informe a URL do Google Drive SAMU para iniciar o monitoramento.", false, true);
                return;
            }

            string printerName = GetSelectedPrinterName();
            if (string.IsNullOrEmpty(printerName))
            {
                SetBannerSafe("Nenhuma impressora instalada/selecionada neste Windows.", false, true);
                return;
            }

            var pullReq = new Dictionary<string, object>();
            pullReq["action"] = "syncDatabase";
            pullReq["pushChanges"] = false;
            pullReq["onlyPrintQueue"] = true;

            Dictionary<string, object> resp = PostJsonToAppsScript(url, pullReq);
            if (resp == null || !GetBool(resp, "ok", false))
            {
                string err = resp != null ? GetStr(resp, "error") : "Resposta vazia";
                SetBannerSafe("Aviso ao consultar Google Drive: " + err, false, true);
                return;
            }

            var db = GetDict(resp, "db");
            var avMap = db != null ? GetDict(db, "viaturaAvarias") : null;
            var pendingJobs = new List<CloudPrintJob>();

            if (avMap != null)
            {
                foreach (KeyValuePair<string, object> kv in avMap)
                {
                    if (!kv.Key.StartsWith("__pjob_", StringComparison.Ordinal)) continue;
                    var jDict = kv.Value as Dictionary<string, object>;
                    if (jDict == null) continue;
                    string jId = GetStr(jDict, "jobId");
                    string st = GetStr(jDict, "status");
                    if (string.IsNullOrEmpty(jId) || st != "pending") continue;

                    var job = new CloudPrintJob();
                    job.SlotKey = kv.Key;
                    job.JobId = jId;
                    job.RecordId = GetStr(jDict, "recordId");
                    job.RecordType = GetStr(jDict, "recordType");
                    job.Title = GetStr(jDict, "title");
                    job.Date = GetStr(jDict, "date");
                    job.DriveFileId = GetStr(jDict, "driveFileId");
                    job.DriveUrl = GetStr(jDict, "driveUrl");
                    job.IsTestPage = GetBool(jDict, "isTestPage", false) || job.DriveFileId == "__TEST_PAGE__";
                    job.DuplexMode = GetStr(jDict, "duplexMode");
                    job.Copies = Math.Max(1, Math.Min(5, GetInt(jDict, "copies", 1)));
                    job.Trigger = GetStr(jDict, "trigger");
                    job.RequestedBy = GetStr(jDict, "requestedBy");
                    job.RequestedByName = GetStr(jDict, "requestedByName");
                    job.CreatedAt = GetStr(jDict, "createdAt");
                    job.Status = st;
                    job.UpdatedAt = GetStr(jDict, "updatedAt");
                    job.RawDict = jDict;
                    pendingJobs.Add(job);
                }
            }

            pendingJobs.Sort(delegate(CloudPrintJob a, CloudPrintJob b) {
                return string.CompareOrdinal(a.CreatedAt ?? "", b.CreatedAt ?? "");
            });

            var avUpdates = new Dictionary<string, object>();

            if (!config.Paused && pendingJobs.Count > 0)
            {
                foreach (CloudPrintJob job in pendingJobs)
                {
                    bool alreadyDoneLocally;
                    lock (stateLock)
                    {
                        alreadyDoneLocally = printedSet.Contains(job.JobId);
                    }

                    string nowIso = DateTime.UtcNow.ToString("o");
                    var updatedSlot = CloneDict(job.RawDict);
                    updatedSlot["key"] = job.SlotKey;
                    updatedSlot["slotKey"] = job.SlotKey;

                    if (alreadyDoneLocally)
                    {
                        updatedSlot["status"] = "printed";
                        updatedSlot["printedAt"] = nowIso;
                        updatedSlot["printedOn"] = Environment.MachineName;
                        updatedSlot["printerName"] = printerName;
                        updatedSlot["errorMsg"] = "";
                        updatedSlot["updatedAt"] = nowIso;
                        avUpdates[job.SlotKey] = updatedSlot;
                        continue;
                    }

                    string who = !string.IsNullOrEmpty(job.RequestedByName) ? job.RequestedByName : job.RequestedBy;
                    AppendLog(string.Format("Imprimindo: {0}{1} -> {2}...",
                        string.IsNullOrEmpty(job.Title) ? "Documento SAMU" : job.Title,
                        string.IsNullOrEmpty(who) ? "" : (" (por " + who + ")"),
                        printerName));

                    SetBannerSafe("Imprimindo agora: " + job.Title + "...", true, false);
                    Stopwatch swJob = Stopwatch.StartNew();

                    try
                    {
                        if (job.IsTestPage)
                        {
                            PrintTestPageDocument(printerName, string.IsNullOrEmpty(who) ? "Solicitado pelo Aplicativo" : ("Solicitado no App por " + who));
                        }
                        else
                        {
                            byte[] pdfBytes = DownloadPdfFromDrive(url, job.DriveFileId, job.DriveUrl);
                            PrintPdfBytesOnWindowsPrinter(pdfBytes, printerName, job.Title, job.DuplexMode, job.Copies);
                        }

                        swJob.Stop();
                        string doneIso = DateTime.UtcNow.ToString("o");
                        RecordJobPrintedLocally(job.JobId, job.Title);

                        updatedSlot["status"] = "printed";
                        updatedSlot["printedAt"] = doneIso;
                        updatedSlot["printedOn"] = Environment.MachineName;
                        updatedSlot["printerName"] = printerName;
                        updatedSlot["errorMsg"] = "";
                        updatedSlot["updatedAt"] = doneIso;
                        avUpdates[job.SlotKey] = updatedSlot;

                        AppendLog(string.Format("CONCLUIDO em {0:0.0}s: {1} enviado para a impressora!", swJob.Elapsed.TotalSeconds, job.Title));
                    }
                    catch (Exception exJob)
                    {
                        swJob.Stop();
                        string errIso = DateTime.UtcNow.ToString("o");
                        updatedSlot["status"] = "error";
                        updatedSlot["printerName"] = printerName;
                        updatedSlot["printedOn"] = Environment.MachineName;
                        updatedSlot["errorMsg"] = exJob.Message;
                        updatedSlot["updatedAt"] = errIso;
                        avUpdates[job.SlotKey] = updatedSlot;

                        AppendLog("FALHA ao imprimir '" + job.Title + "': " + exJob.Message);
                    }
                }
            }

            bool needHeartbeat = (DateTime.UtcNow - lastHeartbeatUtc).TotalSeconds >= 75.0 || avUpdates.Count > 0;
            if (needHeartbeat)
            {
                avUpdates["__print_agent__"] = BuildAgentHeartbeatDict(printerName, null);
                lastHeartbeatUtc = DateTime.UtcNow;
                QueueStatusPushAsync(url, avUpdates);
            }

            if (config.Paused)
            {
                SetBannerSafe(
                    string.Format("FILA PAUSADA ({0} aguardando na nuvem) | Impressora: {1}", pendingJobs.Count, printerName),
                    false,
                    true
                );
            }
            else
            {
                SetBannerSafe(
                    string.Format("Conectado ao Google Drive SAMU | Fila Turbo (1.8s) | Impressora: {0}", printerName),
                    true,
                    false
                );
            }
        }

        private static string ExtractDriveFileId(string fileId, string driveUrl)
        {
            string clean = (fileId ?? "").Trim();
            if (!string.IsNullOrEmpty(clean)) return clean;
            string u = (driveUrl ?? "").Trim();
            if (string.IsNullOrEmpty(u)) return "";
            Match m1 = Regex.Match(u, @"/d/([a-zA-Z0-9_-]{15,})");
            if (m1.Success) return m1.Groups[1].Value;
            Match m2 = Regex.Match(u, @"[?&]id=([a-zA-Z0-9_-]{15,})");
            if (m2.Success) return m2.Groups[1].Value;
            return "";
        }

        private static bool IsValidPdfHeader(byte[] bytes)
        {
            if (bytes == null || bytes.Length < 100) return false;
            // Procura %PDF- nos primeiros 32 bytes
            int limit = Math.Min(bytes.Length - 5, 32);
            for (int i = 0; i <= limit; i++)
            {
                if (bytes[i] == 0x25 && bytes[i + 1] == 0x50 && bytes[i + 2] == 0x44 && bytes[i + 3] == 0x46 && bytes[i + 4] == 0x2D)
                {
                    return true;
                }
            }
            return false;
        }

        private static byte[] HttpGetBytes(string downloadUrl, int timeoutMs)
        {
            var req = (HttpWebRequest)WebRequest.Create(downloadUrl);
            req.Method = "GET";
            req.AllowAutoRedirect = true;
            req.MaximumAutomaticRedirections = 8;
            req.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SAMU192BasePrinter/1.0.7";
            Program.ApplyFastHttpSettings(req, timeoutMs);

            using (var resp = (HttpWebResponse)req.GetResponse())
            using (Stream s = resp.GetResponseStream())
            using (var ms = new MemoryStream())
            {
                if (s != null)
                {
                    byte[] buf = new byte[32768];
                    int read;
                    while ((read = s.Read(buf, 0, buf.Length)) > 0)
                    {
                        ms.Write(buf, 0, read);
                    }
                }
                return ms.ToArray();
            }
        }

        private byte[] DownloadPdfFromDrive(string scriptUrl, string rawFileId, string rawDriveUrl)
        {
            string fileId = ExtractDriveFileId(rawFileId, rawDriveUrl);
            if (string.IsNullOrEmpty(fileId))
            {
                throw new Exception("O registro nao possui ID de PDF do Google Drive.");
            }

            // CDN direto do Google Drive em primeiro lugar (evita redirecionamentos/HTML lentos de drive.google.com/uc)
            string[] candidateUrls = new string[]
            {
                "https://drive.usercontent.google.com/download?id=" + Uri.EscapeDataString(fileId) + "&export=download&confirm=t",
                "https://drive.google.com/uc?export=download&id=" + Uri.EscapeDataString(fileId)
            };

            Exception lastErr = null;
            for (int i = 0; i < candidateUrls.Length; i++)
            {
                try
                {
                    byte[] data = HttpGetBytes(candidateUrls[i], 15000);
                    if (IsValidPdfHeader(data))
                    {
                        return data;
                    }
                }
                catch (Exception ex)
                {
                    lastErr = ex;
                }
            }

            // Fallback via Apps Script downloadPdf (se implantado)
            if (!string.IsNullOrEmpty(scriptUrl))
            {
                try
                {
                    var req = new Dictionary<string, object>();
                    req["action"] = "downloadPdf";
                    req["driveFileId"] = fileId;
                    Dictionary<string, object> resp = PostJsonToAppsScript(scriptUrl, req);
                    if (resp != null && GetBool(resp, "ok", false))
                    {
                        string b64 = GetStr(resp, "pdfBase64");
                        if (!string.IsNullOrEmpty(b64))
                        {
                            byte[] decoded = Convert.FromBase64String(b64);
                            if (IsValidPdfHeader(decoded)) return decoded;
                        }
                    }
                }
                catch (Exception ex2)
                {
                    lastErr = ex2;
                }
            }

            throw new Exception("Nao foi possivel baixar o PDF do Google Drive (ID " + fileId + ")"
                + (lastErr != null ? (": " + lastErr.Message) : "."));
        }

        private void PrintPdfBytesOnWindowsPrinter(byte[] pdfBytes, string printerName, string docTitle, string jobDuplexMode, int copies)
        {
            List<Bitmap> pageBitmaps = WinRtHelper.RenderPdfPagesToBitmaps(pdfBytes, 1754);
            if (pageBitmaps.Count == 0)
            {
                throw new Exception("O PDF baixado nao contem paginas.");
            }

            try
            {
                using (var pd = new PrintDocument())
                {
                    pd.DocumentName = string.IsNullOrEmpty(docTitle) ? "SAMU 192 - Orlandia-SP" : docTitle;
                    pd.PrintController = new StandardPrintController();
                    pd.PrinterSettings.PrinterName = printerName;

                    if (!pd.PrinterSettings.IsValid)
                    {
                        throw new Exception("A impressora '" + printerName + "' nao esta disponivel no Windows.");
                    }

                    pd.PrinterSettings.Copies = (short)Math.Max(1, Math.Min(5, copies));

                    // Seleciona papel A4 automaticamente quando suportado pelo driver
                    foreach (PaperSize ps in pd.PrinterSettings.PaperSizes)
                    {
                        if (ps.Kind == PaperKind.A4)
                        {
                            pd.DefaultPageSettings.PaperSize = ps;
                            break;
                        }
                    }

                    string ov = (config.DuplexOverride ?? "app").Trim().ToLowerInvariant();
                    bool wantDuplex;
                    if (ov == "duplex") wantDuplex = true;
                    else if (ov == "simplex") wantDuplex = false;
                    else wantDuplex = !string.Equals(jobDuplexMode, "simplex", StringComparison.OrdinalIgnoreCase);

                    if (pd.PrinterSettings.CanDuplex)
                    {
                        pd.PrinterSettings.Duplex = (wantDuplex && pageBitmaps.Count > 1)
                            ? Duplex.Vertical
                            : Duplex.Simplex;
                    }

                    pd.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);

                    int pageIdx = 0;
                    pd.QueryPageSettings += delegate(object s, QueryPageSettingsEventArgs qe) {
                        if (pageIdx >= 0 && pageIdx < pageBitmaps.Count)
                        {
                            Bitmap b = pageBitmaps[pageIdx];
                            qe.PageSettings.Landscape = (b.Width > b.Height);
                            qe.PageSettings.Margins = new Margins(0, 0, 0, 0);
                        }
                    };

                    pd.PrintPage += delegate(object s, PrintPageEventArgs pe) {
                        Bitmap bmp = pageBitmaps[pageIdx];
                        pe.Graphics.PageUnit = GraphicsUnit.Display;
                        pe.Graphics.InterpolationMode = InterpolationMode.HighQualityBilinear;
                        pe.Graphics.SmoothingMode = SmoothingMode.HighQuality;
                        pe.Graphics.PixelOffsetMode = PixelOffsetMode.HighSpeed;
                        pe.Graphics.CompositingQuality = CompositingQuality.HighSpeed;

                        RectangleF area = pe.PageSettings.PrintableArea;
                        if (pe.PageSettings.Landscape && area.Height > area.Width)
                        {
                            area = new RectangleF(area.Y, area.X, area.Height, area.Width);
                        }
                        if (area.Width <= 10f || area.Height <= 10f)
                        {
                            area = pe.PageBounds;
                        }

                        float scale = Math.Min(area.Width / (float)bmp.Width, area.Height / (float)bmp.Height);
                        float drawW = (float)bmp.Width * scale;
                        float drawH = (float)bmp.Height * scale;
                        float drawX = area.X + (area.Width - drawW) / 2f;
                        float drawY = area.Y + (area.Height - drawH) / 2f;

                        pe.Graphics.DrawImage(bmp, drawX, drawY, drawW, drawH);

                        pageIdx++;
                        pe.HasMorePages = (pageIdx < pageBitmaps.Count);
                    };

                    pd.Print();
                }
            }
            finally
            {
                for (int i = 0; i < pageBitmaps.Count; i++)
                {
                    try { pageBitmaps[i].Dispose(); } catch { }
                }
            }
        }

        private void PrintTestPageDocument(string printerName, string subtitle)
        {
            using (var pd = new PrintDocument())
            {
                pd.DocumentName = "SAMU 192 - Pagina de Teste da Base";
                pd.PrintController = new StandardPrintController();
                pd.PrinterSettings.PrinterName = printerName;
                if (!pd.PrinterSettings.IsValid)
                {
                    throw new Exception("Impressora '" + printerName + "' invalida ou desconectada.");
                }
                foreach (PaperSize ps in pd.PrinterSettings.PaperSizes)
                {
                    if (ps.Kind == PaperKind.A4)
                    {
                        pd.DefaultPageSettings.PaperSize = ps;
                        break;
                    }
                }

                bool canDup = pd.PrinterSettings.CanDuplex;
                pd.PrintPage += delegate(object s, PrintPageEventArgs e) {
                    Graphics g = e.Graphics;
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    Rectangle m = e.MarginBounds;
                    if (m.Width < 200) m = new Rectangle(50, 50, 720, 1000);

                    using (var redBrush = new SolidBrush(Color.FromArgb(185, 28, 28)))
                    using (var darkBrush = new SolidBrush(Color.FromArgb(15, 23, 42)))
                    using (var blueBrush = new SolidBrush(Color.FromArgb(18, 72, 196)))
                    using (var borderPen = new Pen(Color.FromArgb(185, 28, 28), 2.5f))
                    using (var fHeader = new Font("Segoe UI", 16f, FontStyle.Bold))
                    using (var fSub = new Font("Segoe UI", 11f, FontStyle.Bold))
                    using (var fBody = new Font("Segoe UI", 10.5f, FontStyle.Regular))
                    {
                        g.DrawRectangle(borderPen, m.X, m.Y, m.Width, 340);
                        g.FillRectangle(redBrush, m.X, m.Y, m.Width, 58);
                        g.DrawString("SAMU 192 - ORLANDIA-SP | TESTE DE IMPRESSAO DA BASE", fHeader, Brushes.White, m.X + 16, m.Y + 14);

                        int ty = m.Y + 78;
                        g.DrawString("CONEXAO COM A IMPRESSORA DA BASE CONFIRMADA COM SUCESSO!", fSub, blueBrush, m.X + 18, ty);
                        ty += 34;
                        g.DrawString("Computador da Base : " + Environment.MachineName, fBody, darkBrush, m.X + 18, ty);
                        ty += 26;
                        g.DrawString("Impressora Ativa   : " + printerName, fBody, darkBrush, m.X + 18, ty);
                        ty += 26;
                        g.DrawString("Suporte Duplex     : " + (canDup ? "SIM (Frente e Verso Automatico Ativo)" : "Apenas Frente (Folhas Separadas)"), fBody, darkBrush, m.X + 18, ty);
                        ty += 26;
                        g.DrawString("Data / Hora        : " + DateTime.Now.ToString("dd/MM/yyyy HH:mm:ss"), fBody, darkBrush, m.X + 18, ty);
                        ty += 26;
                        g.DrawString("Origem do Teste    : " + (subtitle ?? "Painel da Base"), fBody, darkBrush, m.X + 18, ty);
                        ty += 38;
                        g.DrawString("Todas as Fichas de Atendimento e Check Lists enviados pelo APK (4G/Wi-Fi) serao impressos aqui automaticamente.", fBody, blueBrush, new RectangleF(m.X + 18, ty, m.Width - 36, 60));
                    }
                    e.HasMorePages = false;
                };
                pd.Print();
            }
        }

        private static JavaScriptSerializer CreateSerializer()
        {
            var s = new JavaScriptSerializer();
            s.MaxJsonLength = int.MaxValue;
            s.RecursionLimit = 128;
            return s;
        }

        private static Dictionary<string, object> PostJsonToAppsScript(string scriptUrl, Dictionary<string, object> payloadObj)
        {
            var ser = CreateSerializer();
            string jsonBody = ser.Serialize(payloadObj);
            byte[] bodyBytes = Encoding.UTF8.GetBytes(jsonBody);

            var req = (HttpWebRequest)WebRequest.Create(scriptUrl);
            req.Method = "POST";
            req.ContentType = "text/plain;charset=utf-8";
            req.Accept = "application/json";
            req.AllowAutoRedirect = false;
            req.UserAgent = "SAMU192BasePrinter/1.0.7";
            Program.ApplyFastHttpSettings(req, 30000);
            req.ContentLength = bodyBytes.Length;

            using (Stream reqStream = req.GetRequestStream())
            {
                reqStream.Write(bodyBytes, 0, bodyBytes.Length);
            }

            string respText = "";
            using (var resp = (HttpWebResponse)req.GetResponse())
            {
                int code = (int)resp.StatusCode;
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308)
                {
                    string redirectUrl = resp.Headers["Location"];
                    if (string.IsNullOrEmpty(redirectUrl))
                    {
                        throw new Exception("Redirecionamento sem URL do Google Apps Script.");
                    }
                    var getReq = (HttpWebRequest)WebRequest.Create(redirectUrl);
                    getReq.Method = "GET";
                    getReq.AllowAutoRedirect = true;
                    getReq.UserAgent = "SAMU192BasePrinter/1.0.7";
                    Program.ApplyFastHttpSettings(getReq, 30000);
                    using (var getResp = (HttpWebResponse)getReq.GetResponse())
                    using (var sr = new StreamReader(getResp.GetResponseStream(), Encoding.UTF8))
                    {
                        respText = sr.ReadToEnd();
                    }
                }
                else
                {
                    using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    {
                        respText = sr.ReadToEnd();
                    }
                }
            }

            if (string.IsNullOrEmpty(respText)) return null;
            return ser.Deserialize<Dictionary<string, object>>(respText);
        }

        private static Dictionary<string, object> CloneDict(Dictionary<string, object> src)
        {
            var d = new Dictionary<string, object>();
            if (src != null)
            {
                foreach (KeyValuePair<string, object> kv in src)
                {
                    d[kv.Key] = kv.Value;
                }
            }
            return d;
        }

        private static Dictionary<string, object> GetDict(Dictionary<string, object> parent, string key)
        {
            if (parent == null) return null;
            object val;
            if (parent.TryGetValue(key, out val))
            {
                return val as Dictionary<string, object>;
            }
            return null;
        }

        private static string GetStr(Dictionary<string, object> dict, string key)
        {
            if (dict == null) return "";
            object val;
            if (dict.TryGetValue(key, out val) && val != null)
            {
                return Convert.ToString(val).Trim();
            }
            return "";
        }

        private static bool GetBool(Dictionary<string, object> dict, string key, bool defVal)
        {
            if (dict == null) return defVal;
            object val;
            if (dict.TryGetValue(key, out val) && val != null)
            {
                if (val is bool) return (bool)val;
                string s = Convert.ToString(val).Trim().ToLowerInvariant();
                if (s == "true" || s == "1") return true;
                if (s == "false" || s == "0") return false;
            }
            return defVal;
        }

        private static int GetInt(Dictionary<string, object> dict, string key, int defVal)
        {
            if (dict == null) return defVal;
            object val;
            if (dict.TryGetValue(key, out val) && val != null)
            {
                if (val is int) return (int)val;
                int parsed;
                if (int.TryParse(Convert.ToString(val).Trim(), out parsed)) return parsed;
            }
            return defVal;
        }
    }

    internal static class Program
    {
        public const string DefaultScriptUrl = "https://script.google.com/macros/s/AKfycbw1rSjlmgqhQjKsSZSykzi4UAWYQGCvdIDStxDlbFGfln-GrTc2FP8h_R5J18C6Wbz3/exec";
        public const string MutexName = "Local\\SAMU192_Orlandia_PrintServer_Mutex";
        public const string ShowEventName = "Local\\SAMU192_Orlandia_PrintServer_ShowEvent";

        private static void LogFatalError(string context, Exception ex)
        {
            try
            {
                string dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "SAMU192_Impressora_Base"
                );
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                string logFile = Path.Combine(dir, "erro_servidor.log");
                string entry = "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + context + ": " + (ex != null ? ex.ToString() : "Erro desconhecido") + "\r\n";
                File.AppendAllText(logFile, entry, Encoding.UTF8);
            }
            catch { }
        }

        public static bool BypassAutoProxy = false;

        public static void ApplyFastHttpSettings(HttpWebRequest req, int timeoutMs)
        {
            if (req == null) return;
            req.Timeout = timeoutMs;
            req.ReadWriteTimeout = timeoutMs;
            req.KeepAlive = true;
            req.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            if (BypassAutoProxy)
            {
                req.Proxy = null;
            }
            try
            {
                if (req.ServicePoint != null)
                {
                    req.ServicePoint.Expect100Continue = false;
                    req.ServicePoint.UseNagleAlgorithm = false;
                }
            }
            catch { }
        }

        private static void ConfigureFastNetworkStack()
        {
            try
            {
                // Garante TLS 1.2 no .NET Framework 4.x (3072 = Tls12)
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls11 | SecurityProtocolType.Tls;
            }
            catch { }
            try
            {
                ServicePointManager.Expect100Continue = false;
                ServicePointManager.UseNagleAlgorithm = false;
                ServicePointManager.DefaultConnectionLimit = 24;
                ServicePointManager.MaxServicePointIdleTime = 90000;
            }
            catch { }
            try
            {
                // Desativa a descoberta automatica lenta de proxy WPAD do Windows (que atrasava .NET em 10-20s) quando nao ha proxy manual ativo
                bool manualProxyEnabled = false;
                string pacUrl = "";
                using (RegistryKey rk = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Internet Settings", false))
                {
                    if (rk != null)
                    {
                        int pe = Convert.ToInt32(rk.GetValue("ProxyEnable", 0) ?? 0);
                        string ps = Convert.ToString(rk.GetValue("ProxyServer", "") ?? "").Trim();
                        pacUrl = Convert.ToString(rk.GetValue("AutoConfigURL", "") ?? "").Trim();
                        manualProxyEnabled = (pe != 0 && !string.IsNullOrEmpty(ps));
                    }
                }
                if (!manualProxyEnabled && string.IsNullOrEmpty(pacUrl))
                {
                    BypassAutoProxy = true;
                    WebRequest.DefaultWebProxy = null;
                }
            }
            catch { }
        }

        [STAThread]
        private static void Main(string[] args)
        {
            ConfigureFastNetworkStack();

            bool minimized = false;
            bool installMode = false;
            string overrideUrl = "";
            if (args != null)
            {
                for (int i = 0; i < args.Length; i++)
                {
                    string a = (args[i] ?? "").Trim();
                    if (string.Equals(a, "--minimized", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(a, "/minimized", StringComparison.OrdinalIgnoreCase))
                    {
                        minimized = true;
                    }
                    else if (string.Equals(a, "--install", StringComparison.OrdinalIgnoreCase) ||
                             string.Equals(a, "/install", StringComparison.OrdinalIgnoreCase))
                    {
                        installMode = true;
                    }
                    else if (a.StartsWith("--url=", StringComparison.OrdinalIgnoreCase))
                    {
                        overrideUrl = a.Substring(6).Trim();
                    }
                }
            }

            bool createdNew = true;
            Mutex mutex = null;
            try
            {
                mutex = new Mutex(true, MutexName, out createdNew);
            }
            catch { }

            if (!createdNew)
            {
                if (!minimized)
                {
                    bool wokeExisting = false;
                    try
                    {
                        using (EventWaitHandle ewh = EventWaitHandle.OpenExisting(ShowEventName))
                        {
                            ewh.Set();
                            wokeExisting = true;
                        }
                    }
                    catch { }

                    if (!wokeExisting)
                    {
                        MessageBox.Show(
                            "O Servidor de Impressao da Base SAMU 192 ja esta aberto neste computador!\n\nVerifique o icone vermelho com a cruz perto do relogio do Windows (canto inferior direito).",
                            "SAMU 192 - Impressora da Base",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Information
                        );
                    }
                }
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += delegate(object s, ThreadExceptionEventArgs te)
            {
                LogFatalError("ThreadException", te.Exception);
            };
            AppDomain.CurrentDomain.UnhandledException += delegate(object s, UnhandledExceptionEventArgs ue)
            {
                LogFatalError("UnhandledException", ue.ExceptionObject as Exception);
            };

            try
            {
                Application.Run(new MainForm(minimized, overrideUrl, installMode));
            }
            catch (Exception ex)
            {
                LogFatalError("MainFatal", ex);
                MessageBox.Show(
                    "Ocorreu um erro ao iniciar o Servidor de Impressao da Base SAMU 192:\n\n" + ex.Message,
                    "SAMU 192 - Erro de Inicializacao",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
            finally
            {
                if (mutex != null)
                {
                    try { mutex.ReleaseMutex(); } catch { }
                    mutex.Dispose();
                }
            }
        }
    }
}
