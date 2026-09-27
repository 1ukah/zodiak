using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class DeviceEnumerator { }
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDeviceEnumerator { int EnumAudioEndpoints(int flow,uint state,out IDeviceCollection devices); int GetDefaultAudioEndpoint(int flow,int role,out IDevice device); }
[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDeviceCollection { int GetCount(out uint count); int Item(uint index,out IDevice device); }
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDevice { int Activate(ref Guid iid,uint context,IntPtr parameters,[MarshalAs(UnmanagedType.IUnknown)] out object value); }
[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ISessionManager { int GetAudioSessionControl(IntPtr group,uint flags,out IntPtr control); int GetSimpleAudioVolume(IntPtr group,uint flags,out IntPtr volume); int GetSessionEnumerator(out ISessionEnumerator sessions); }
[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ISessionEnumerator { int GetCount(out int count); int GetSession(int index,[MarshalAs(UnmanagedType.IUnknown)] out object session); }
[ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ISessionControl { int GetState(out int state); int GetDisplayName(out IntPtr name); int SetDisplayName(IntPtr name,IntPtr context); int GetIconPath(out IntPtr path); int SetIconPath(IntPtr path,IntPtr context); int GetGroupingParam(out Guid group); int SetGroupingParam(ref Guid group,IntPtr context); int RegisterAudioSessionNotification(IntPtr events); int UnregisterAudioSessionNotification(IntPtr events); int GetSessionIdentifier(out IntPtr id); int GetSessionInstanceIdentifier(out IntPtr id); int GetProcessId(out uint pid); }
[ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioClient { int Initialize(int share,uint flags,long duration,long period,ref WaveFormat format,IntPtr session); int GetBufferSize(out uint count); int GetStreamLatency(out long latency); int GetCurrentPadding(out uint padding); int IsFormatSupported(int share,ref WaveFormat format,IntPtr closest); int GetMixFormat(out IntPtr format); int GetDevicePeriod(out long normal,out long minimum); int Start(); int Stop(); int Reset(); int SetEventHandle(IntPtr handle); int GetService(ref Guid iid,[MarshalAs(UnmanagedType.IUnknown)] out object value); }
[ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ICapture { int GetBuffer(out IntPtr data,out uint frames,out uint flags,out ulong device,out ulong qpc); int ReleaseBuffer(uint frames); int GetNextPacketSize(out uint frames); }
[ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IActivationOperation { int GetActivateResult(out int result,[MarshalAs(UnmanagedType.IUnknown)] out object client); }
[ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ICompletion { int ActivateCompleted(IActivationOperation operation); }
[ComImport, Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAgile { }
[StructLayout(LayoutKind.Sequential,Pack=1)] struct WaveFormat { public ushort tag,channels; public uint rate,average; public ushort align,bits,extra; }
[StructLayout(LayoutKind.Sequential)] struct Activation { public int type; public uint pid; public int mode; }
[StructLayout(LayoutKind.Sequential)] struct Blob { public uint size; public IntPtr data; }
[StructLayout(LayoutKind.Sequential)] struct Variant { public ushort type,r1,r2,r3; public Blob blob; }
[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct ProcessEntry { public uint size,usage,pid; public IntPtr heap; public uint module,threads,parent; public int priority; public uint flags; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string name; }
sealed class Source { public IAudioClient Client=null!; public ICapture Capture=null!; public IntPtr Signal; public readonly List<short> Queue=new(); public bool Priming=true; }

[ComVisible(true), ClassInterface(ClassInterfaceType.None)] sealed class Completion : ICompletion, IAgile {
  public readonly ManualResetEvent Done=new(false); public int Result; public IAudioClient? Client;
  public int ActivateCompleted(IActivationOperation op) { try { object value; var call=op.GetActivateResult(out var result,out value); Result=call<0?call:result; Client=value as IAudioClient; if(Result>=0&&Client==null) Result=unchecked((int)0x80004002); } catch { Result=unchecked((int)0x80004005); } Done.Set(); return 0; }
}

static class Program {
  const uint Loopback=0x80060000, Silent=2;
  const int Cushion=2880;
  static readonly HashSet<uint> Failed=new();
  [DllImport("ole32.dll")] static extern int CoInitializeEx(IntPtr reserved,uint mode);
  [DllImport("mmdevapi.dll",ExactSpelling=true)] static extern int ActivateAudioInterfaceAsync([MarshalAs(UnmanagedType.LPWStr)]string path,ref Guid iid,IntPtr parameters,ICompletion handler,out IActivationOperation operation);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateEvent(IntPtr attributes,bool manual,bool state,IntPtr name);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot,ref ProcessEntry entry);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot,ref ProcessEntry entry);
  [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint period);
  [MTAThread] static int Main(string[] args) { CoInitializeEx(IntPtr.Zero,0); try { if(args.Length is <1 or >2||!uint.TryParse(args[0],out var pid)||pid==0||(args.Length==2&&args[1]!="discord"))return Fail("A Zodiak process ID is required."); if(args.Length==2)return Mix(pid); var client=ActivateLoopback(pid,1); if(client==null)return Fail("Windows process-loopback exclusion is unavailable."); if(Prepare(client,out var capture,out var signal)<0)return Fail("Could not initialize protected system-audio capture."); Console.Error.WriteLine($"ready exclude {pid}"); Console.Error.Flush(); if(client.Start()<0)return Fail("Could not start protected system-audio capture."); return Pump(capture,signal); }catch(Exception e){return Fail(e.Message);} }
  static int Fail(string text){Console.Error.WriteLine("error "+text);return 1;}
  static int Mix(uint self){
    if(ActivateLoopback(self,0)==null)return Fail("Windows process-loopback capture is unavailable.");
    timeBeginPeriod(1);var sources=new Dictionary<uint,Source>();Refresh(self,sources);Console.Error.WriteLine($"ready mix {self}");Console.Error.Flush();
    var output=Console.OpenStandardOutput();var clock=Stopwatch.StartNew();long written=0,scanned=0;var read=Array.Empty<short>();var sum=Array.Empty<int>();var bytes=Array.Empty<byte>();var dead=new List<uint>();
    while(true){
      Thread.Sleep(5);
      if(clock.ElapsedMilliseconds-scanned>=1000){scanned=clock.ElapsedMilliseconds;Refresh(self,sources);}
      foreach(var (pid,s) in sources){try{while(true){s.Capture.GetNextPacketSize(out var next);if(next==0)break;s.Capture.GetBuffer(out var data,out var frames,out var flags,out _,out _);var count=checked((int)frames*2);if(read.Length<count)read=new short[count];if((flags&Silent)!=0||data==IntPtr.Zero)Array.Clear(read,0,count);else Marshal.Copy(data,read,0,count);s.Capture.ReleaseBuffer(frames);s.Queue.AddRange(new ArraySegment<short>(read,0,count));}}catch{dead.Add(pid);}}
      foreach(var pid in dead)Remove(sources,pid);dead.Clear();
      var due=clock.ElapsedTicks*48000/Stopwatch.Frequency-written;if(due>4800){written+=due-480;due=480;}if(due<=0)continue;
      var samples=(int)due*2;if(sum.Length<samples){sum=new int[samples];bytes=new byte[samples*2];}Array.Clear(sum,0,samples);
      foreach(var s in sources.Values){var q=s.Queue;if(s.Priming&&q.Count>=Cushion)s.Priming=false;if(s.Priming)continue;var n=Math.Min(samples,q.Count);for(var i=0;i<n;i++)sum[i]+=q[i];q.RemoveRange(0,n);if(n<samples)s.Priming=true;else if(q.Count>Cushion*5)q.RemoveRange(0,q.Count-Cushion);}
      for(var i=0;i<samples;i++){var v=Math.Clamp(sum[i],short.MinValue,short.MaxValue);bytes[i*2]=(byte)v;bytes[i*2+1]=(byte)(v>>8);}
      output.Write(bytes,0,samples*2);output.Flush();written+=due;
    }
  }
  static void Refresh(uint self,Dictionary<uint,Source> sources){
    var all=Processes();var roots=all.Where(p=>p.Value.name.StartsWith("Discord",StringComparison.OrdinalIgnoreCase)).Select(p=>p.Key).Append(self).ToList();
    Failed.RemoveWhere(pid=>!all.ContainsKey(pid));
    foreach(var pid in sources.Keys.ToList())if(!all.ContainsKey(pid)||roots.Any(r=>Related(pid,r,all)))Remove(sources,pid);
    foreach(var pid in SessionPids()){
      if(sources.ContainsKey(pid)||Failed.Contains(pid)||!all.ContainsKey(pid)||roots.Any(r=>Related(pid,r,all))||sources.Keys.Any(c=>Related(pid,c,all)))continue;
      try{var client=ActivateLoopback(pid,0);if(client==null||Prepare(client,out var capture,out var signal,2_000_000)<0||client.Start()<0){Failed.Add(pid);continue;}sources[pid]=new Source{Client=client,Capture=capture,Signal=signal};}catch{Failed.Add(pid);}
    }
  }
  static void Remove(Dictionary<uint,Source> sources,uint pid){var s=sources[pid];sources.Remove(pid);try{s.Client.Stop();}catch{}CloseHandle(s.Signal);}
  static bool Related(uint a,uint b,Dictionary<uint,(uint parent,string name)> all)=>Under(a,b,all)||Under(b,a,all);
  static bool Under(uint pid,uint root,Dictionary<uint,(uint parent,string name)> all){for(var depth=0;depth<64;depth++){if(pid==root)return true;if(pid==0||!all.TryGetValue(pid,out var p)||p.parent==pid)return false;pid=p.parent;}return false;}
  static Dictionary<uint,(uint parent,string name)> Processes(){var all=new Dictionary<uint,(uint parent,string name)>();var snapshot=CreateToolhelp32Snapshot(2,0);if(snapshot==new IntPtr(-1))return all;try{var e=new ProcessEntry{size=(uint)Marshal.SizeOf<ProcessEntry>(),name=""};for(var ok=Process32FirstW(snapshot,ref e);ok;ok=Process32NextW(snapshot,ref e))all[e.pid]=(e.parent,e.name);}finally{CloseHandle(snapshot);}return all;}
  static HashSet<uint> SessionPids(){
    var pids=new HashSet<uint>();var iid=typeof(ISessionManager).GUID;
    try{((IDeviceEnumerator)new DeviceEnumerator()).EnumAudioEndpoints(0,1,out var devices);devices.GetCount(out var count);
      for(uint i=0;i<count;i++){try{devices.Item(i,out var device);device.Activate(ref iid,23,IntPtr.Zero,out var value);((ISessionManager)value).GetSessionEnumerator(out var sessions);sessions.GetCount(out var n);
        for(var j=0;j<n;j++){sessions.GetSession(j,out var item);if(item is not ISessionControl session)continue;session.GetState(out var state);session.GetProcessId(out var pid);if(state!=2&&pid!=0)pids.Add(pid);}}catch{}}
    }catch{}
    return pids;
  }
  static IAudioClient? ActivateLoopback(uint pid,int mode){var activation=new Activation{type=1,pid=pid,mode=mode};var size=Marshal.SizeOf<Activation>();var blob=Marshal.AllocCoTaskMem(size);Marshal.StructureToPtr(activation,blob,false);var variant=new Variant{type=65,blob=new Blob{size=(uint)size,data=blob}};var memory=Marshal.AllocCoTaskMem(Marshal.SizeOf<Variant>());Marshal.StructureToPtr(variant,memory,false);var handler=new Completion();var iid=typeof(IAudioClient).GUID;var hr=ActivateAudioInterfaceAsync("VAD\\Process_Loopback",ref iid,memory,handler,out var operation);if(hr>=0)handler.Done.WaitOne(8000);Marshal.FreeCoTaskMem(memory);Marshal.FreeCoTaskMem(blob);GC.KeepAlive(operation);return hr>=0&&handler.Result>=0?handler.Client:null;}
  static int Prepare(IAudioClient client,out ICapture capture,out IntPtr signal,long duration=0){capture=null!;signal=IntPtr.Zero;var f=new WaveFormat{tag=1,channels=2,rate=48000,bits=16,align=4,average=192000};var hr=client.Initialize(0,Loopback,duration,0,ref f,IntPtr.Zero);if(hr<0)return hr;signal=CreateEvent(IntPtr.Zero,false,false,IntPtr.Zero);if(signal==IntPtr.Zero)return -1;hr=client.SetEventHandle(signal);if(hr<0)return hr;var iid=typeof(ICapture).GUID;hr=client.GetService(ref iid,out var service);capture=service as ICapture??null!;return capture==null?-1:hr;}
  static int Pump(ICapture c,IntPtr signal){var output=Console.OpenStandardOutput();var buffer=Array.Empty<byte>();while(true){WaitForSingleObject(signal,200);while(true){var hr=c.GetNextPacketSize(out var next);if(hr<0)return Fail("Audio capture failed.");if(next==0)break;hr=c.GetBuffer(out var data,out var frames,out var flags,out _,out _);if(hr<0)return Fail("Audio capture failed.");var bytes=checked((int)frames*4);if(buffer.Length<bytes)buffer=new byte[bytes];if((flags&Silent)!=0||data==IntPtr.Zero)Array.Clear(buffer,0,bytes);else Marshal.Copy(data,buffer,0,bytes);c.ReleaseBuffer(frames);output.Write(buffer,0,bytes);}output.Flush();}}
}
