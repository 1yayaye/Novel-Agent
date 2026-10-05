using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace NovelAgent.WinUI;

/// <summary>
/// Manages the Node.js sidecar process lifetime, stdio NDJSON streams, and Windows Job Object assignment.
/// </summary>
public sealed class SidecarSupervisor : IAsyncDisposable
{
    private Process? _process;
    private StreamWriter? _stdinWriter;
    private readonly CancellationTokenSource _cts = new();
    private bool _isDisposed;

    public event Action<string>? MessageReceived;
    public event Action<string>? ErrorReceived;
    public event Action<int>? ProcessExited;

    public bool IsRunning => _process is { HasExited: false };

    /// <summary>
    /// Launches the Node.js sidecar process, binds it to the Job Object, and starts reading stdio streams.
    /// </summary>
    public bool Start()
    {
        if (IsRunning) return true;

        var (nodeExe, scriptPath, args) = ResolveSidecarLaunchConfig();
        if (string.IsNullOrEmpty(scriptPath) || !File.Exists(scriptPath))
        {
            Debug.WriteLine($"[SidecarSupervisor] Sidecar script not found: {scriptPath}");
            return false;
        }
        if (!File.Exists(nodeExe) && !IsCommandInPath(nodeExe))
        {
            Debug.WriteLine($"[SidecarSupervisor] Node executable not found: {nodeExe}");
            return false;
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = nodeExe,
            Arguments = string.IsNullOrEmpty(args) ? $"\"{scriptPath}\"" : $"\"{scriptPath}\" {args}",
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false),
            StandardOutputEncoding = new UTF8Encoding(false),
            StandardErrorEncoding = new UTF8Encoding(false),
            CreateNoWindow = true
        };

        // Pass working directory as the repository or app base directory
        string workingDir = FindRepositoryRoot() ?? AppContext.BaseDirectory;
        startInfo.WorkingDirectory = workingDir;

        try
        {
            _process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
            _process.Exited += (s, e) =>
            {
                int exitCode = _process?.ExitCode ?? -1;
                Debug.WriteLine($"[SidecarSupervisor] Sidecar process exited with code {exitCode}");
                ProcessExited?.Invoke(exitCode);
            };

            if (!_process.Start())
            {
                Debug.WriteLine("[SidecarSupervisor] Failed to start sidecar process.");
                return false;
            }

            // Bind to Windows Job Object immediately
            bool tracked = JobObjectTracker.TrackProcess(_process);
            Debug.WriteLine($"[SidecarSupervisor] Sidecar process (PID {_process.Id}) tracked by JobObject: {tracked}");

            _stdinWriter = _process.StandardInput;

            // Start background readers for stdout and stderr
            _ = Task.Run(() => ReadStandardOutputAsync(_process.StandardOutput, _cts.Token));
            _ = Task.Run(() => ReadStandardErrorAsync(_process.StandardError, _cts.Token));

            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[SidecarSupervisor] Exception starting sidecar: {ex}");
            return false;
        }
    }

    /// <summary>
    /// Sends a JSON line to the sidecar's stdin.
    /// </summary>
    public async Task SendMessageAsync(string jsonLine)
    {
        if (_stdinWriter == null || !IsRunning)
        {
            throw new InvalidOperationException("Sidecar is not running.");
        }

        await _stdinWriter.WriteLineAsync(jsonLine.AsMemory(), _cts.Token);
        await _stdinWriter.FlushAsync();
    }

    private async Task ReadStandardOutputAsync(StreamReader reader, CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested && !reader.EndOfStream)
            {
                string? line = await reader.ReadLineAsync(ct);
                if (!string.IsNullOrWhiteSpace(line))
                {
                    MessageReceived?.Invoke(line);
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            Debug.WriteLine($"[SidecarSupervisor] Error reading stdout: {ex.Message}");
        }
    }

    private async Task ReadStandardErrorAsync(StreamReader reader, CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested && !reader.EndOfStream)
            {
                string? line = await reader.ReadLineAsync(ct);
                if (!string.IsNullOrWhiteSpace(line))
                {
                    Debug.WriteLine($"[Sidecar-STDERR] {line}");
                    ErrorReceived?.Invoke(line);
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            Debug.WriteLine($"[SidecarSupervisor] Error reading stderr: {ex.Message}");
        }
    }

    /// <summary>
    /// Attempts graceful shutdown by sending system.shutdown, waiting up to 3s, then killing if needed.
    /// </summary>
    public async Task StopAsync()
    {
        if (_process == null || _process.HasExited) return;

        try
        {
            // Send graceful shutdown command (JSON-RPC 2.0)
            string shutdownMsg = "{\"jsonrpc\":\"2.0\",\"id\":\"sys-shutdown\",\"method\":\"system.shutdown\"}";
            if (_stdinWriter != null)
            {
                await _stdinWriter.WriteLineAsync(shutdownMsg);
                await _stdinWriter.FlushAsync();
                _stdinWriter.Close();
                _stdinWriter = null;
            }

            using var waitCts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            await _process.WaitForExitAsync(waitCts.Token);
        }
        catch
        {
            // Timeout or exception; force kill process tree
            try
            {
                if (_process is { HasExited: false })
                {
                    _process.Kill(entireProcessTree: true);
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[SidecarSupervisor] Kill exception: {ex.Message}");
            }
        }
        finally
        {
            _cts.Cancel();
            _process?.Dispose();
            _process = null;
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_isDisposed) return;
        _isDisposed = true;
        await StopAsync();
        _cts.Dispose();
    }

    private static (string nodeExe, string scriptPath, string args) ResolveSidecarLaunchConfig()
    {
        // 1. Environment variable override
        string? envPath = Environment.GetEnvironmentVariable("NOVEL_AGENT_SIDECAR_PATH");
        if (!string.IsNullOrEmpty(envPath) && File.Exists(envPath))
        {
            return ("node", envPath, "");
        }

        // 2. Relative to base directory (packaged app)
        string baseDir = AppContext.BaseDirectory;
        string bundledNode = Path.Combine(baseDir, "node", "node.exe");
        string nodeExe = File.Exists(bundledNode) ? bundledNode : "node";

        string packagedSidecar = Path.Combine(baseDir, "sidecar", "index.cjs");
        if (File.Exists(packagedSidecar))
        {
            return (nodeExe, packagedSidecar, "");
        }

        // 3. Development root resolution
        string? repoRoot = FindRepositoryRoot();
        if (repoRoot != null)
        {
            // Check the bundled development output.
            string distSidecar = Path.Combine(repoRoot, "out", "main", "sidecar.cjs");
            if (File.Exists(distSidecar))
            {
                return (nodeExe, distSidecar, "");
            }
        }

        return (nodeExe, "", "");
    }

    private static string? FindRepositoryRoot()
    {
        string? dir = AppContext.BaseDirectory;
        while (!string.IsNullOrEmpty(dir))
        {
            if (File.Exists(Path.Combine(dir, "package.json")))
            {
                return dir;
            }
            dir = Directory.GetParent(dir)?.FullName;
        }
        return null;
    }

    private static bool IsCommandInPath(string command)
    {
        if (File.Exists(command)) return true;
        string? pathEnv = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrEmpty(pathEnv)) return false;

        foreach (string path in pathEnv.Split(Path.PathSeparator))
        {
            string fullPath = Path.Combine(path.Trim(), command.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? command : command + ".exe");
            if (File.Exists(fullPath)) return true;
        }
        return false;
    }
}
