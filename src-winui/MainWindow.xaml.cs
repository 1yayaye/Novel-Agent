using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;

namespace NovelAgent.WinUI;

internal static class WindowNativeHelper
{
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    public const int SW_RESTORE = 9;

    public static void BringToForeground(IntPtr hwnd)
    {
        ShowWindow(hwnd, SW_RESTORE);
        SetForegroundWindow(hwnd);
    }
}

public sealed partial class MainWindow : Window
{
    private readonly string? _initialProjectPath;
    private string? _pendingProjectPath;
    private bool _browserReady;
    private SidecarSupervisor? _sidecar;
    private IpcBridge? _ipcBridge;

    public MainWindow(string? initialProjectPath = null)
    {
        _initialProjectPath = initialProjectPath;
        InitializeComponent();

        ConfigureTitleBar();

        Closed += OnWindowClosed;

        // Initialize WebView2 and Sidecar when window is activated/loaded
        _ = InitializeHostAsync();
    }

    public void BringToForeground()
    {
        DispatcherQueue.TryEnqueue(() =>
        {
            AppWindow.Show();
            var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
            WindowNativeHelper.BringToForeground(hwnd);
        });
    }

    public void OpenProjectDirectly(string projectPath)
    {
        _pendingProjectPath = projectPath;
        DispatcherQueue.TryEnqueue(() =>
        {
            BringToForeground();
            FlushPendingProject();
        });
    }

    private void FlushPendingProject()
    {
        if (!_browserReady || _ipcBridge == null || _pendingProjectPath == null) return;
        _ipcBridge.NotifyExternalProjectOpen(_pendingProjectPath);
        _pendingProjectPath = null;
    }

    private void ConfigureTitleBar()
    {
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);

        if (AppWindowTitleBar.IsCustomizationSupported())
        {
            var titleBar = AppWindow.TitleBar;
            titleBar.ButtonBackgroundColor = Colors.Transparent;
            titleBar.ButtonInactiveBackgroundColor = Colors.Transparent;
        }

        string iconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "AppIcon.ico");
        if (File.Exists(iconPath))
        {
            AppWindow.SetIcon(iconPath);
        }
    }

    private async Task InitializeHostAsync()
    {
        try
        {
            // 1. Initialize WebView2 with dedicated profile and CJK anti-shredding flags
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string userDataFolder = Path.Combine(localAppData, "NovelAgent", "WebView2Profile");
            Directory.CreateDirectory(userDataFolder);

            var options = new CoreWebView2EnvironmentOptions
            {
                AdditionalBrowserArguments = "--force-color-profile=srgb --disable-features=CalculateNativeWinOcclusion --enable-features=DirectWriteForwardLocalFonts"
            };

            var environment = await CoreWebView2Environment.CreateWithOptionsAsync(null, userDataFolder, options);
            await Browser.EnsureCoreWebView2Async(environment);

            // 2. Start Node.js Sidecar
            _sidecar = new SidecarSupervisor();
            bool sidecarStarted = _sidecar.Start();
            Debug.WriteLine($"[MainWindow] Sidecar started: {sidecarStarted}");

            // 3. Mount IPC Bridge
            _ipcBridge = new IpcBridge(this, Browser.CoreWebView2, _sidecar);
            Browser.CoreWebView2.NavigationCompleted += (_, _) =>
            {
                _browserReady = true;
                FlushPendingProject();
            };

            // 4. Configure Virtual Host Mapping & Navigation
            string distFolder = ResolveDistFolder();
            if (!string.IsNullOrEmpty(distFolder) && Directory.Exists(distFolder))
            {
                Browser.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    "novel-agent",
                    distFolder,
                    CoreWebView2HostResourceAccessKind.Allow
                );
            }

            string targetUrl = await ResolveInitialNavigationUrlAsync(distFolder, _initialProjectPath);
            Browser.CoreWebView2.Navigate(targetUrl);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[MainWindow] Exception during host initialization: {ex}");
        }
    }

    private static string ResolveDistFolder()
    {
        // 1. AppContext.BaseDirectory/renderer
        string baseRenderer = Path.Combine(AppContext.BaseDirectory, "renderer");
        if (Directory.Exists(baseRenderer)) return baseRenderer;

        // 2. Repository out/renderer
        string? repoRoot = FindRepositoryRoot();
        if (repoRoot != null)
        {
            string outRenderer = Path.Combine(repoRoot, "out", "renderer");
            if (Directory.Exists(outRenderer)) return outRenderer;
        }

        return baseRenderer;
    }

    private static async Task<string> ResolveInitialNavigationUrlAsync(string distFolder, string? initialProjectPath)
    {
        string? envUrl = Environment.GetEnvironmentVariable("NOVEL_AGENT_DEV_URL");
        string baseUrl = !string.IsNullOrEmpty(envUrl) ? envUrl : "https://novel-agent/index.html";

        if (string.IsNullOrEmpty(envUrl))
        {
            // Check if local Vite dev server is running
            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(500) };
                var response = await client.GetAsync("http://localhost:5173");
                if (response.IsSuccessStatusCode)
                {
                    baseUrl = "http://localhost:5173";
                }
            }
            catch
            {
                // Dev server not active, proceed to packaged assets
            }
        }

        if (!string.IsNullOrEmpty(initialProjectPath))
        {
            string separator = baseUrl.Contains('?') ? "&" : "?";
            return $"{baseUrl}{separator}openProject={Uri.EscapeDataString(initialProjectPath)}";
        }

        return baseUrl;
    }

    private static string? FindRepositoryRoot()
    {
        string? dir = AppContext.BaseDirectory;
        while (!string.IsNullOrEmpty(dir))
        {
            if (File.Exists(Path.Combine(dir, "package.json"))) return dir;
            dir = Directory.GetParent(dir)?.FullName;
        }
        return null;
    }

    private async void OnWindowClosed(object sender, WindowEventArgs e)
    {
        if (_sidecar != null)
        {
            await _sidecar.StopAsync();
            await _sidecar.DisposeAsync();
            _sidecar = null;
        }
    }
}
