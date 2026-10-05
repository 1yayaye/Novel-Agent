using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.Web.WebView2.Core;
using Windows.Storage;
using Windows.Storage.Pickers;

namespace NovelAgent.WinUI;

/// <summary>
/// Bridges IPC messages between WebView2, the WinUI 3 native host, and the Node.js Sidecar.
/// Handles window controls and file pickers natively, translating between the WebView2 wire protocol
/// and JSON-RPC 2.0 for the Node.js Sidecar.
/// </summary>
public sealed class IpcBridge
{
    private readonly Window _window;
    private readonly CoreWebView2 _coreWebView2;
    private readonly SidecarSupervisor _sidecar;
    private readonly DispatcherQueue _dispatcherQueue;
    private readonly IntPtr _hwnd;
    private bool? _lastIsMaximized;

    public IpcBridge(Window window, CoreWebView2 coreWebView2, SidecarSupervisor sidecar)
    {
        _window = window;
        _coreWebView2 = coreWebView2;
        _sidecar = sidecar;
        _dispatcherQueue = window.DispatcherQueue;
        _hwnd = WinRT.Interop.WindowNative.GetWindowHandle(window);

        _coreWebView2.WebMessageReceived += OnWebMessageReceived;
        _sidecar.MessageReceived += OnSidecarMessageReceived;

        _window.AppWindow.Changed += OnAppWindowChanged;
    }

    private void OnAppWindowChanged(AppWindow sender, AppWindowChangedEventArgs args)
    {
        var presenter = sender.Presenter as OverlappedPresenter;
        if (presenter != null)
        {
            bool isMaximized = presenter.State == OverlappedPresenterState.Maximized;
            if (_lastIsMaximized != isMaximized)
            {
                _lastIsMaximized = isMaximized;
                PostPushEvent("window:maximized", JsonValue.Create(isMaximized));
            }
        }
    }

    private void OnSidecarMessageReceived(string jsonLine)
    {
        try
        {
            var parsedNode = JsonNode.Parse(jsonLine);
            if (parsedNode is not JsonObject node) return;

            // Push event notification from Sidecar: {"jsonrpc":"2.0","method":"event","params":{"channel":"...","payload":...}}
            if (node["method"]?.ToString() == "event")
            {
                string channel = node["params"]?["channel"]?.ToString() ?? "";
                var payload = node["params"]?["payload"]?.DeepClone();
                PostPushEvent(channel, payload);
                return;
            }

            // RPC response with correlation ID
            if (node.ContainsKey("id"))
            {
                string id = node["id"]?.ToString() ?? "";

                // Error response
                if (node.ContainsKey("error") && node["error"] != null)
                {
                    var errObj = node["error"];
                    string domainCode = errObj?["data"]?["domainCode"]?.ToString() ?? "INTERNAL_ERROR";
                    string message = errObj?["message"]?.ToString() ?? "Internal error";

                    SendRpcErrorResponse(id, domainCode, message);
                    return;
                }

                // Success response
                var resultNode = node["result"]?.DeepClone();
                SendRpcSuccessResponse(id, resultNode);
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[IpcBridge] Error translating message from Sidecar: {ex.Message}");
        }
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string rawJson = e.WebMessageAsJson;
        string requestId = TryGetRequestId(rawJson);
        try
        {
            var node = JsonNode.Parse(rawJson)?.AsObject();
            if (node == null)
            {
                SendRpcErrorResponse(requestId, "INVALID_REQUEST", "RPC request must be a JSON object.");
                return;
            }

            string id = node["id"]?.ToString() ?? requestId;
            string channel = node["channel"]?.ToString() ?? "";
            var payload = node["payload"];

            // Normalize channel if using domain/method notation
            if (string.IsNullOrEmpty(channel) && node["domain"] != null && node["method"] != null)
            {
                channel = $"{node["domain"]}.{node["method"]}";
            }

            if (string.IsNullOrEmpty(channel))
            {
                SendRpcErrorResponse(id, "INVALID_REQUEST", "Missing channel in RPC request.");
                return;
            }

            // Native window controls
            if (channel.StartsWith("window.", StringComparison.OrdinalIgnoreCase))
            {
                await HandleWindowChannelAsync(id, channel);
                return;
            }

            // Native dialogs & project.chooseAndOpen
            if (channel.StartsWith("dialog.", StringComparison.OrdinalIgnoreCase) ||
                channel.Equals("project.chooseAndOpen", StringComparison.OrdinalIgnoreCase))
            {
                await HandleDialogChannelAsync(id, channel, payload);
                return;
            }

            // Forward domain request to Node.js Sidecar as JSON-RPC 2.0
            if (_sidecar.IsRunning)
            {
                var rpcReq = new JsonObject
                {
                    ["jsonrpc"] = "2.0",
                    ["id"] = id,
                    ["method"] = channel
                };
                if (payload != null)
                {
                    rpcReq["params"] = payload.DeepClone();
                }
                await _sidecar.SendMessageAsync(rpcReq.ToJsonString());
            }
            else
            {
                SendRpcErrorResponse(id, "SIDECAR_NOT_RUNNING", "Sidecar is not running.");
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[IpcBridge] Exception handling web message: {ex}");
            SendRpcErrorResponse(requestId, "IPC_ERROR", "Unable to process RPC request.");
        }
    }

    private static string TryGetRequestId(string rawJson)
    {
        try
        {
            return JsonNode.Parse(rawJson)?["id"]?.ToString() ?? "";
        }
        catch
        {
            return "";
        }
    }

    private Task HandleWindowChannelAsync(string id, string channel)
    {
        var appWindow = _window.AppWindow;
        var presenter = appWindow.Presenter as OverlappedPresenter;

        switch (channel.ToLowerInvariant())
        {
            case "window.minimize":
                presenter?.Minimize();
                SendRpcSuccessResponse(id, JsonValue.Create(true));
                break;

            case "window.maximize":
                presenter?.Maximize();
                SendRpcSuccessResponse(id, JsonValue.Create(true));
                break;

            case "window.restore":
                presenter?.Restore();
                SendRpcSuccessResponse(id, JsonValue.Create(true));
                break;

            case "window.togglemaximize":
                if (presenter != null)
                {
                    if (presenter.State == OverlappedPresenterState.Maximized)
                    {
                        presenter.Restore();
                    }
                    else
                    {
                        presenter.Maximize();
                    }
                }
                SendRpcSuccessResponse(id, JsonValue.Create(true));
                break;

            case "window.ismaximized":
                bool isMaximized = presenter?.State == OverlappedPresenterState.Maximized;
                SendRpcSuccessResponse(id, JsonValue.Create(isMaximized));
                break;

            case "window.close":
                _window.Close();
                SendRpcSuccessResponse(id, JsonValue.Create(true));
                break;

            default:
                SendRpcErrorResponse(id, "WINDOW_ERROR", $"Unknown window command: {channel}");
                break;
        }

        return Task.CompletedTask;
    }

    private async Task HandleDialogChannelAsync(string id, string channel, JsonNode? payload)
    {
        try
        {
            if (channel.Equals("project.chooseAndOpen", StringComparison.OrdinalIgnoreCase))
            {
                var filePicker = new FileOpenPicker();
                WinRT.Interop.InitializeWithWindow.Initialize(filePicker, _hwnd);
                filePicker.SuggestedStartLocation = PickerLocationId.DocumentsLibrary;
                filePicker.FileTypeFilter.Add(".novelproj");

                StorageFile? file = await filePicker.PickSingleFileAsync();
                if (file == null)
                {
                    // User canceled: return null
                    SendRpcSuccessResponse(id, null);
                    return;
                }

                // Selected file: forward to Sidecar as project.open with { path: file.Path }
                if (_sidecar.IsRunning)
                {
                    var rpcReq = new JsonObject
                    {
                        ["jsonrpc"] = "2.0",
                        ["id"] = id,
                        ["method"] = "project.open",
                        ["params"] = new JsonObject
                        {
                            ["path"] = file.Path
                        }
                    };
                    await _sidecar.SendMessageAsync(rpcReq.ToJsonString());
                }
                else
                {
                    SendRpcErrorResponse(id, "SIDECAR_NOT_RUNNING", "Sidecar is not running.");
                }
            }
            else if (channel.Equals("dialog.openDirectory", StringComparison.OrdinalIgnoreCase))
            {
                var folderPicker = new FolderPicker();
                WinRT.Interop.InitializeWithWindow.Initialize(folderPicker, _hwnd);
                folderPicker.FileTypeFilter.Add("*");

                StorageFolder? folder = await folderPicker.PickSingleFolderAsync();
                if (folder == null)
                {
                    SendRpcSuccessResponse(id, new JsonObject { ["canceled"] = true, ["path"] = null });
                    return;
                }

                SendRpcSuccessResponse(id, new JsonObject { ["canceled"] = false, ["path"] = folder.Path });
            }
            else if (channel.Equals("dialog.openFile", StringComparison.OrdinalIgnoreCase))
            {
                var filePicker = new FileOpenPicker();
                WinRT.Interop.InitializeWithWindow.Initialize(filePicker, _hwnd);
                filePicker.FileTypeFilter.Add("*");

                StorageFile? file = await filePicker.PickSingleFileAsync();
                if (file == null)
                {
                    SendRpcSuccessResponse(id, new JsonObject { ["canceled"] = true, ["path"] = null });
                    return;
                }

                SendRpcSuccessResponse(id, new JsonObject { ["canceled"] = false, ["path"] = file.Path });
            }
            else if (channel.Equals("dialog.saveFile", StringComparison.OrdinalIgnoreCase))
            {
                var savePicker = new FileSavePicker();
                WinRT.Interop.InitializeWithWindow.Initialize(savePicker, _hwnd);
                savePicker.SuggestedStartLocation = PickerLocationId.DocumentsLibrary;
                savePicker.FileTypeChoices.Add("Novel Agent 项目文件 (*.novelproj)", new List<string> { ".novelproj" });
                savePicker.FileTypeChoices.Add("文本文件 (*.txt)", new List<string> { ".txt" });
                savePicker.FileTypeChoices.Add("所有文件 (*.*)", new List<string> { "*" });

                StorageFile? file = await savePicker.PickSaveFileAsync();
                if (file == null)
                {
                    SendRpcSuccessResponse(id, new JsonObject { ["canceled"] = true, ["path"] = null });
                    return;
                }

                SendRpcSuccessResponse(id, new JsonObject { ["canceled"] = false, ["path"] = file.Path });
            }
            else
            {
                // Fallback: forward to Sidecar
                if (_sidecar.IsRunning)
                {
                    var rpcReq = new JsonObject
                    {
                        ["jsonrpc"] = "2.0",
                        ["id"] = id,
                        ["method"] = channel
                    };
                    if (payload != null)
                    {
                        rpcReq["params"] = payload.DeepClone();
                    }
                    await _sidecar.SendMessageAsync(rpcReq.ToJsonString());
                }
                else
                {
                    SendRpcErrorResponse(id, "SIDECAR_NOT_RUNNING", "Sidecar is not running.");
                }
            }
        }
        catch (Exception ex)
        {
            SendRpcErrorResponse(id, "DIALOG_ERROR", ex.Message);
        }
    }

    private void PostPushEvent(string channel, JsonNode? payload)
    {
        var ev = new JsonObject
        {
            ["type"] = "event",
            ["channel"] = channel,
            ["payload"] = payload
        };
        PostWebMessage(ev.ToJsonString());
    }

    private void SendRpcSuccessResponse(string id, JsonNode? value)
    {
        var response = new JsonObject
        {
            ["type"] = "rpc_response",
            ["id"] = id,
            ["ok"] = true,
            ["value"] = value
        };
        PostWebMessage(response.ToJsonString());
    }

    private void SendRpcErrorResponse(string id, string code, string message)
    {
        var response = new JsonObject
        {
            ["type"] = "rpc_response",
            ["id"] = id,
            ["ok"] = false,
            ["error"] = new JsonObject
            {
                ["code"] = code,
                ["message"] = message
            }
        };
        PostWebMessage(response.ToJsonString());
    }

    private void PostWebMessage(string json)
    {
        _dispatcherQueue.TryEnqueue(() =>
        {
            try
            {
                _coreWebView2.PostWebMessageAsJson(json);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[IpcBridge] Error posting message to WebView2: {ex.Message}");
            }
        });
    }
}
