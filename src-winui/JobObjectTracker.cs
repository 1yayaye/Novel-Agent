using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace NovelAgent.WinUI;

/// <summary>
/// Confinement tracker using Windows Job Objects.
/// Assigns child processes (like the Node.js sidecar) to a job configured with
/// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, guaranteeing zero orphan processes when the host terminates.
/// </summary>
public static class JobObjectTracker
{
    private static readonly IntPtr s_jobHandle;
    private static readonly object s_lock = new();

    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const int JobObjectExtendedLimitInformation = 9;

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryLimit;
        public UIntPtr PeakJobMemoryLimit;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string? lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr hJob,
        int JobObjectInfoClass,
        IntPtr lpJobObjectInfo,
        uint cbJobObjectInfoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr hObject);

    static JobObjectTracker()
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            s_jobHandle = IntPtr.Zero;
            return;
        }

        s_jobHandle = CreateJobObject(IntPtr.Zero, null);
        if (s_jobHandle == IntPtr.Zero)
        {
            Debug.WriteLine($"[JobObjectTracker] Failed to create JobObject. Win32 error: {Marshal.GetLastWin32Error()}");
            return;
        }

        var extendedInfo = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            BasicLimitInformation = new JOBOBJECT_BASIC_LIMIT_INFORMATION
            {
                LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            }
        };

        int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr pExtendedInfo = Marshal.AllocHGlobal(length);
        try
        {
            Marshal.StructureToPtr(extendedInfo, pExtendedInfo, false);
            if (!SetInformationJobObject(s_jobHandle, JobObjectExtendedLimitInformation, pExtendedInfo, (uint)length))
            {
                Debug.WriteLine($"[JobObjectTracker] Failed to set JobObject limit information. Win32 error: {Marshal.GetLastWin32Error()}");
            }
        }
        finally
        {
            Marshal.FreeHGlobal(pExtendedInfo);
        }
    }

    /// <summary>
    /// Assigns the given process to the job object so it will automatically terminate when this process exits.
    /// </summary>
    public static bool TrackProcess(Process process)
    {
        if (s_jobHandle == IntPtr.Zero) return false;

        try
        {
            lock (s_lock)
            {
                if (process.HasExited) return false;
                return AssignProcessToJobObject(s_jobHandle, process.Handle);
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[JobObjectTracker] AssignProcessToJobObject exception: {ex.Message}");
            return false;
        }
    }
}
