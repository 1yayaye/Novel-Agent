using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;

namespace NovelAgent.WinUI;

/// <summary>
/// Provides application-specific behavior to supplement the default Application class.
/// Enforces single-instance lock and forwards command-line / file activation arguments.
/// </summary>
public partial class App : Application
{
    private MainWindow? _mainWindow;

    public App()
    {
        InitializeComponent();
    }

    /// <summary>
    /// Invoked when the application is launched.
    /// </summary>
    /// <param name="args">Details about the launch request and process.</param>
    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        // 1. Single-instance key registration
        var mainInstance = AppInstance.FindOrRegisterForKey("NovelAgentWinUIInstance");
        var currentInstance = AppInstance.GetCurrent();

        if (!mainInstance.IsCurrent)
        {
            // Redirect activation arguments to the already running main instance
            var activatedArgs = currentInstance.GetActivatedEventArgs();
            await mainInstance.RedirectActivationToAsync(activatedArgs);
            Process.GetCurrentProcess().Kill();
            return;
        }

        // 2. Listen for future activations redirected from other instances
        mainInstance.Activated += OnAppActivated;

        // 3. Extract any project path passed on launch
        string? projectPath = ExtractProjectPathFromArgs(currentInstance.GetActivatedEventArgs(), args.Arguments);

        // 4. Initialize and activate main window with optional project path
        _mainWindow = new MainWindow(projectPath);
        _mainWindow.Activate();
    }

    private void OnAppActivated(object? sender, AppActivationArguments e)
    {
        string? projectPath = ExtractProjectPathFromArgs(e);
        _mainWindow?.DispatcherQueue.TryEnqueue(() =>
        {
            if (!string.IsNullOrEmpty(projectPath))
            {
                _mainWindow.OpenProjectDirectly(projectPath);
            }
            else
            {
                _mainWindow.BringToForeground();
            }
        });
    }

    private static string? ExtractProjectPathFromArgs(AppActivationArguments? activationArgs)
    {
        // 1. Check WinRT file activation event data
        if (activationArgs?.Kind == ExtendedActivationKind.File)
        {
            if (activationArgs.Data is Windows.ApplicationModel.Activation.IFileActivatedEventArgs fileArgs &&
                fileArgs.Files.Count > 0)
            {
                return fileArgs.Files[0].Path;
            }
        }

        // 2. Check redirected launch/command-line activation data.
        if (activationArgs?.Data is Windows.ApplicationModel.Activation.ILaunchActivatedEventArgs launchArgs)
        {
            string? projectPath = FindProjectPath(launchArgs.Arguments);
            if (projectPath != null) return projectPath;
        }
        if (activationArgs?.Data is Windows.ApplicationModel.Activation.ICommandLineActivatedEventArgs commandLineArgs)
        {
            string? projectPath = FindProjectPath(commandLineArgs.Operation.Arguments);
            if (projectPath != null) return projectPath;
        }

        // 3. Check command-line arguments fallback
        string[] cmdArgs = Environment.GetCommandLineArgs();
        return FindProjectPath(cmdArgs);
    }

    private static string? ExtractProjectPathFromArgs(AppActivationArguments? activationArgs, string? launchArguments)
    {
        string? projectPath = ExtractProjectPathFromArgs(activationArgs);
        return projectPath ?? FindProjectPath(launchArguments);
    }

    private static string? FindProjectPath(IEnumerable<string>? args)
    {
        if (args == null) return null;
        foreach (string rawArg in args)
        {
            string arg = rawArg.Trim('"');
            if (arg.EndsWith(".novelproj", StringComparison.OrdinalIgnoreCase) && File.Exists(arg))
            {
                return Path.GetFullPath(arg);
            }
        }
        return null;
    }

    private static string? FindProjectPath(string? arguments)
    {
        if (string.IsNullOrWhiteSpace(arguments)) return null;
        Match match = Regex.Match(arguments, "(?:\\\"(?<path>[^\\\"]+\\.novelproj)|(?<path>[^\\s]+\\.novelproj))", RegexOptions.IgnoreCase);
        return match.Success ? FindProjectPath(new[] { match.Groups["path"].Value }) : null;
    }
}
