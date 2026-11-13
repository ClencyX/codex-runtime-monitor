using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;

public sealed class CodexProcessInfo {
    public string id;
    public int pid;
    public string name = "codex.exe";
}
public sealed class CodexSocketInfo {
    public string processId;
    public string protocol;
    public bool ambiguous;
    public string localAddress;
    public int localPort;
    public string remoteAddress;
    public int remotePort;
}
public sealed class CodexNetworkSnapshot {
    public bool udpAvailable = true;
    public List<string> localAddresses = new List<string>();
    public List<CodexProcessInfo> processes = new List<CodexProcessInfo>();
    public List<CodexSocketInfo> sockets = new List<CodexSocketInfo>();
}
public static class CodexNetworkNative {
    private static List<string> cachedAddresses;
    private static DateTime addressesAt;
    private static List<string> LocalAddresses() {
        DateTime now = DateTime.UtcNow;
        if (cachedAddresses != null && now >= addressesAt && (now - addressesAt).TotalSeconds < 5) return cachedAddresses;
        HashSet<string> addresses = new HashSet<string>(); addresses.Add("127.0.0.1"); addresses.Add("::1");
        try {
            foreach (NetworkInterface nic in NetworkInterface.GetAllNetworkInterfaces()) {
                try { foreach (UnicastIPAddressInformation entry in nic.GetIPProperties().UnicastAddresses) addresses.Add(entry.Address.ToString()); }
                catch (NetworkInformationException) { }
            }
        } catch (NetworkInformationException) { }
        cachedAddresses = new List<string>(addresses); addressesAt = now; return cachedAddresses;
    }
    [DllImport("iphlpapi.dll", SetLastError = false)]
    private static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool sort, int family, int tableClass, int reserved);
    [DllImport("iphlpapi.dll", SetLastError = false)]
    private static extern uint GetExtendedUdpTable(IntPtr table, ref int size, bool sort, int family, int tableClass, int reserved);
    private sealed class UdpBinding {
        public string address;
        public int port;
        public int pid;
    }
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
                        protocol = "tcp",
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
    private static void ReadUdpTable(int family, List<UdpBinding> result) {
        int size = 0;
        uint code = GetExtendedUdpTable(IntPtr.Zero, ref size, false, family, 1, 0);
        if (code != 0 && code != 122) throw new System.ComponentModel.Win32Exception((int)code);
        for (int attempt = 0; attempt < 3; attempt++) {
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try {
                code = GetExtendedUdpTable(buffer, ref size, false, family, 1, 0);
                if (code == 122) continue;
                if (code != 0) throw new System.ComponentModel.Win32Exception((int)code);
                int count = Marshal.ReadInt32(buffer), rowSize = family == 2 ? 12 : 28;
                for (int i = 0; i < count; i++) {
                    IntPtr row = IntPtr.Add(buffer, 4 + i * rowSize);
                    result.Add(new UdpBinding {
                        address = family == 2 ? new IPAddress((uint)Marshal.ReadInt32(row, 0)).ToString() : Address6(row, 0, 16),
                        port = Port(row, family == 2 ? 4 : 20),
                        pid = Marshal.ReadInt32(row, family == 2 ? 8 : 24)
                    });
                }
                return;
            } finally { Marshal.FreeHGlobal(buffer); }
        }
        throw new InvalidOperationException("UDP table changed repeatedly");
    }
    private static bool Overlap(string a, string b) {
        IPAddress first = IPAddress.Parse(a), second = IPAddress.Parse(b);
        if (first.IsIPv4MappedToIPv6) first = first.MapToIPv4();
        if (second.IsIPv4MappedToIPv6) second = second.MapToIPv4();
        // An IPv6 wildcard may be dual-stack; conservatively retain that ambiguity.
        if (first.Equals(IPAddress.IPv6Any) || second.Equals(IPAddress.IPv6Any)) return true;
        if (first.AddressFamily != second.AddressFamily) return false;
        return first.Equals(IPAddress.Any) || second.Equals(IPAddress.Any) || first.Equals(second);
    }
    private static void AddUdp(Dictionary<int, string> owners, CodexNetworkSnapshot result) {
        List<UdpBinding> rows = new List<UdpBinding>();
        try { ReadUdpTable(2, rows); ReadUdpTable(23, rows); }
        catch (System.ComponentModel.Win32Exception) { result.udpAvailable = false; return; }
        catch (InvalidOperationException) { result.udpAvailable = false; return; }
        Dictionary<int, List<UdpBinding>> byPort = new Dictionary<int, List<UdpBinding>>();
        foreach (UdpBinding row in rows) {
            List<UdpBinding> bucket;
            if (!byPort.TryGetValue(row.port, out bucket)) { bucket = new List<UdpBinding>(); byPort.Add(row.port, bucket); }
            bucket.Add(row);
        }
        foreach (UdpBinding row in rows) {
            string owner;
            if (!owners.TryGetValue(row.pid, out owner)) continue;
            bool ambiguous = false;
            // Include non-Codex owners in this check without exposing their endpoints.
            foreach (UdpBinding other in byPort[row.port]) {
                if (other.pid != row.pid && Overlap(row.address, other.address)) { ambiguous = true; break; }
            }
            result.sockets.Add(new CodexSocketInfo { processId = owner, protocol = "udp", localAddress = row.address,
                localPort = row.port, remoteAddress = "", remotePort = 0, ambiguous = ambiguous });
        }
    }
    private static CodexNetworkSnapshot ReadProcesses(Process[] processes) {
        CodexNetworkSnapshot result = new CodexNetworkSnapshot();
        Dictionary<int, string> owners = new Dictionary<int, string>();
        foreach (Process process in processes) {
            using (process) {
                try {
                    string id = process.Id.ToString() + ":" + process.StartTime.ToUniversalTime().Ticks.ToString();
                    owners.Add(process.Id, id);
                    result.processes.Add(new CodexProcessInfo { id = id, pid = process.Id });
                } catch (InvalidOperationException) { }
            }
        }
        if (owners.Count != 0) { result.localAddresses = LocalAddresses(); ReadTable(2, owners, result.sockets); ReadTable(23, owners, result.sockets); AddUdp(owners, result); }
        return result;
    }
    public static CodexNetworkSnapshot Read() { return ReadProcesses(Process.GetProcessesByName("codex")); }
}
