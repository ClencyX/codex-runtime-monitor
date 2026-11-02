using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net;
using System.Runtime.InteropServices;

public sealed class CodexProcessInfo {
    public string id;
    public int pid;
    public string name = "codex.exe";
}
public sealed class CodexSocketInfo {
    public string processId;
    public string localAddress;
    public int localPort;
    public string remoteAddress;
    public int remotePort;
}
public sealed class CodexNetworkSnapshot {
    public List<CodexProcessInfo> processes = new List<CodexProcessInfo>();
    public List<CodexSocketInfo> sockets = new List<CodexSocketInfo>();
}
public static class CodexNetworkNative {
    [DllImport("iphlpapi.dll", SetLastError = false)]
    private static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool sort, int family, int tableClass, int reserved);
    private static int Port(IntPtr row, int offset) {
        int value = Marshal.ReadInt32(row, offset);
        return ((value & 255) << 8) | ((value >> 8) & 255);
    }
    private static string Address6(IntPtr row, int offset, int scopeOffset) {
        byte[] bytes = new byte[16];
        Marshal.Copy(IntPtr.Add(row, offset), bytes, 0, 16);
        return new IPAddress(bytes, (uint)Marshal.ReadInt32(row, scopeOffset)).ToString();
    }
    private static void ReadTable(int family, Dictionary<int, string> owners, List<CodexSocketInfo> result) {
        int size = 0;
        uint code = GetExtendedTcpTable(IntPtr.Zero, ref size, false, family, 5, 0);
        if (code != 0 && code != 122) throw new System.ComponentModel.Win32Exception((int)code);
        for (int attempt = 0; attempt < 3; attempt++) {
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try {
                code = GetExtendedTcpTable(buffer, ref size, false, family, 5, 0);
                if (code == 122) continue;
                if (code != 0) throw new System.ComponentModel.Win32Exception((int)code);
                int count = Marshal.ReadInt32(buffer), rowSize = family == 2 ? 24 : 56;
                for (int i = 0; i < count; i++) {
                    IntPtr row = IntPtr.Add(buffer, 4 + i * rowSize);
                    int state = Marshal.ReadInt32(row, family == 2 ? 0 : 48);
                    int pid = Marshal.ReadInt32(row, family == 2 ? 20 : 52);
                    string owner;
                    if (state != 5 || !owners.TryGetValue(pid, out owner)) continue;
                    result.Add(new CodexSocketInfo {
                        processId = owner,
                        localAddress = family == 2 ? new IPAddress((uint)Marshal.ReadInt32(row, 4)).ToString() : Address6(row, 0, 16),
                        localPort = Port(row, family == 2 ? 8 : 20),
                        remoteAddress = family == 2 ? new IPAddress((uint)Marshal.ReadInt32(row, 12)).ToString() : Address6(row, 24, 40),
                        remotePort = Port(row, family == 2 ? 16 : 44)
                    });
                }
                return;
            } finally { Marshal.FreeHGlobal(buffer); }
        }
        throw new InvalidOperationException("TCP table changed repeatedly");
    }
    public static CodexNetworkSnapshot Read() {
        CodexNetworkSnapshot result = new CodexNetworkSnapshot();
        Dictionary<int, string> owners = new Dictionary<int, string>();
        foreach (Process process in Process.GetProcessesByName("codex")) {
            using (process) {
                try {
                    string id = process.Id.ToString() + ":" + process.StartTime.ToUniversalTime().Ticks.ToString();
                    owners.Add(process.Id, id);
                    result.processes.Add(new CodexProcessInfo { id = id, pid = process.Id });
                } catch (InvalidOperationException) { }
            }
        }
        if (owners.Count != 0) { ReadTable(2, owners, result.sockets); ReadTable(23, owners, result.sockets); }
        return result;
    }
}
