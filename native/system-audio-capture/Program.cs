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
sealed class Source { public IAudioClient Client=null!; public ICapture Capture=null!; public IntPtr Signal; public readonly List<short> Queue=new(); public bool Priming=true; }

[ComVisible(true), ClassInterface(ClassInterfaceType.None)] sealed class Completion : ICompletion, IAgile {
  public readonly ManualResetEvent Done=new(false); public int Result; public IAudioClient? Client;
  public int ActivateCompleted(IActivationOperation op) { try { object value; var call=op.GetActivateResult(out var result,out value); Result=call<0?call:result; Client=value as IAudioClient; if(Result>=0&&Client==null) Result=unchecked((int)0x80004002); } catch { Result=unchecked((int)0x80004005); } Done.Set(); return 0; }
}

static class Program {
  const uint Loopback=0x80060000, Silent=2;
  const int Cushion=2880, RetryMs=15000;
  // Process IDs whose capture failed, with the time of the attempt. Anti-cheat can refuse a game while it starts; retry later.
  static readonly Dictionary<uint,long> Failed=new();
  // Launch fallback never climbs to these: their trees hold the whole desktop, including Discord and zodiak.
  static readonly HashSet<string> Shell=new(StringComparer.OrdinalIgnoreCase){"explorer.exe","sihost.exe","userinit.exe","winlogon.exe","wininit.exe","services.exe","svchost.exe","System"};
  [DllImport("ole32.dll")] static extern int CoInitializeEx(IntPtr reserved,uint mode);
  [DllImport("mmdevapi.dll",ExactSpelling=true)] static extern int ActivateAudioInterfaceAsync([MarshalAs(UnmanagedType.LPWStr)]string path,ref Guid iid,IntPtr parameters,ICompletion handler,out IActivationOperation operation);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateEvent(IntPtr attributes,bool manual,bool state,IntPtr name);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("ntdll.dll")] static extern int NtQuerySystemInformation(int type,IntPtr buffer,int length,out int needed);
  [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint period);
  [MTAThread] static int Main(string[] args) { CoInitializeEx(IntPtr.Zero,0); try { if(args.Length==0)return Diagnose(); if(args.Length>2||!uint.TryParse(args[0],out var pid)||pid==0||(args.Length==2&&args[1]!="discord"))return Fail("A Zodiak process ID is required."); if(args.Length==2)return Mix(pid); var client=ActivateLoopback(pid,1,out _); if(client==null)return Fail("Windows process-loopback exclusion is unavailable."); if(Prepare(client,out var capture,out var signal)<0)return Fail("Could not initialize protected system-audio capture."); Console.Error.WriteLine($"ready exclude {pid}"); Console.Error.Flush(); if(client.Start()<0)return Fail("Could not start protected system-audio capture."); return Pump(capture,signal); }catch(Exception e){return Fail(e.Message);} }
  static int Fail(string text){Console.Error.WriteLine("error "+text);return 1;}
  static int Mix(uint self){
    timeBeginPeriod(1);var sources=new Dictionary<uint,Source>();
    // Activation can block for seconds (anti-cheat, a hung process); scanning on its own thread never stalls the mix.
    new Thread(()=>{CoInitializeEx(IntPtr.Zero,0);while(true){try{Refresh(self,sources);}catch{}Thread.Sleep(1000);}}){IsBackground=true}.Start();
    Console.Error.WriteLine($"ready mix {self}");Console.Error.Flush();
    var output=Console.OpenStandardOutput();var clock=Stopwatch.StartNew();long written=0;var read=Array.Empty<short>();var sum=Array.Empty<int>();var bytes=Array.Empty<byte>();var dead=new List<uint>();
    while(true){
      // WASAPI delivers 10 ms packets; waking at that rate halves wake-ups and pipe/IPC writes versus 5 ms.
      Thread.Sleep(10);
      long due;var samples=0;
      lock(sources){
        foreach(var (pid,s) in sources){try{while(true){s.Capture.GetNextPacketSize(out var next);if(next==0)break;s.Capture.GetBuffer(out var data,out var frames,out var flags,out _,out _);var count=checked((int)frames*2);if(read.Length<count)read=new short[count];if((flags&Silent)!=0||data==IntPtr.Zero)Array.Clear(read,0,count);else Marshal.Copy(data,read,0,count);s.Capture.ReleaseBuffer(frames);s.Queue.AddRange(new ArraySegment<short>(read,0,count));}}catch{dead.Add(pid);}}
        due=clock.ElapsedTicks*48000/Stopwatch.Frequency-written;if(due>4800){written+=due-480;due=480;}
        if(due>0){
          samples=(int)due*2;if(sum.Length<samples){sum=new int[samples];bytes=new byte[samples*2];}Array.Clear(sum,0,samples);
          foreach(var s in sources.Values){var q=s.Queue;if(s.Priming&&q.Count>=Cushion)s.Priming=false;if(s.Priming)continue;var n=Math.Min(samples,q.Count);for(var i=0;i<n;i++)sum[i]+=q[i];q.RemoveRange(0,n);if(n<samples)s.Priming=true;else if(q.Count>Cushion*5)q.RemoveRange(0,q.Count-Cushion);}
        }
      }
      foreach(var pid in dead)Remove(sources,pid);dead.Clear();
      if(due<=0)continue;
      for(var i=0;i<samples;i++){var v=Math.Clamp(sum[i],short.MinValue,short.MaxValue);bytes[i*2]=(byte)v;bytes[i*2+1]=(byte)(v>>8);}
      output.Write(bytes,0,samples*2);output.Flush();written+=due;
    }
  }
  sealed record Scan(Dictionary<uint,(uint parent,string name,long start)> All,HashSet<uint> Sessions,List<uint> Discord,List<uint> Audible,uint Self);
  static Scan Survey(uint self){var all=Processes();var sessions=SessionPids();var discord=all.Where(p=>p.Value.name.StartsWith("Discord",StringComparison.OrdinalIgnoreCase)).Select(p=>p.Key).ToList();return new Scan(all,sessions,discord,discord.Where(sessions.Contains).ToList(),self);}
  // Capturing a process captures its whole tree. Exclude a process only when that tree would carry zodiak or Discord
  // audio: it belongs to them, or it launched zodiak or a Discord process that is actually playing audio. Silent
  // Discord helpers (DiscordSystemHelper.exe, crash handlers) must not drag the game or its launcher out with them.
  static string? Excluded(uint pid,Scan scan){
    var all=scan.All;
    if(Under(pid,scan.Self,all))return "part of zodiak";
    if(Under(scan.Self,pid,all))return "launched zodiak";
    foreach(var d in scan.Discord)if(Under(pid,d,all))return $"part of Discord ({Name(d,all)})";
    foreach(var d in scan.Audible)if(Under(d,pid,all))return $"launched {Name(d,all)}, which plays Discord audio";
    return null;
  }
  static void Refresh(uint self,Dictionary<uint,Source> sources){
    var scan=Survey(self);var all=scan.All;var now=Environment.TickCount64;HashSet<uint> live;
    foreach(var pid in Failed.Keys.ToList())if(!all.ContainsKey(pid)||now-Failed[pid]>=RetryMs)Failed.Remove(pid);
    lock(sources)live=sources.Keys.ToHashSet();
    foreach(var pid in live.ToList())if(!all.ContainsKey(pid)||Excluded(pid,scan)!=null){Remove(sources,pid);live.Remove(pid);}
    // Like OBS's application capture, capture the process that actually plays audio rather than an ancestor, deepest
    // first: a launcher's tree capture may not reach a game it started, while the game's own capture always does.
    foreach(var pid in scan.Sessions.Where(all.ContainsKey).OrderByDescending(pid=>Depth(pid,all))){
      if(live.Contains(pid)||Failed.ContainsKey(pid)||Excluded(pid,scan)!=null||live.Any(c=>Under(c,pid,all)))continue;
      var covering=live.Where(c=>Under(pid,c,all)).ToList();
      // The ancestor's tree capture would now double this process; drop it.
      if(Add(pid,sources)){live.Add(pid);foreach(var c in covering){Remove(sources,c);live.Remove(c);}continue;}
      Failed[pid]=now;
      if(covering.Count>0)continue;
      // Anti-cheat drivers can refuse process loopback on the game itself. Capture the nearest launcher instead
      // (Battle.net, Steam, ...): its tree includes the game. Stop where a launcher's tree would include zodiak or
      // Discord audio, or would double a process already captured.
      for(uint up=pid,depth=0;depth<4&&all.TryGetValue(up,out var p)&&p.parent!=up&&all.TryGetValue(p.parent,out var launcher)&&IsParent(up,p.parent,all)&&!Shell.Contains(launcher.name);depth++){
        up=p.parent;
        if(Excluded(up,scan)!=null||live.Any(c=>Under(c,up,all)))break;
        if(Failed.ContainsKey(up))continue;
        if(Add(up,sources)){live.Add(up);break;}
        Failed[up]=now;
      }
    }
  }
  static bool Add(uint pid,Dictionary<uint,Source> sources){var source=Open(pid,out _);if(source==null)return false;lock(sources)sources[pid]=source;return true;}
  static Source? Open(uint pid,out int result){try{var client=ActivateLoopback(pid,0,out result);if(client==null)return null;var hr=Prepare(client,out var capture,out var signal,2_000_000);if(hr>=0)hr=client.Start();if(hr<0){result=hr;if(signal!=IntPtr.Zero)CloseHandle(signal);return null;}return new Source{Client=client,Capture=capture,Signal=signal};}catch(Exception e){result=e.HResult;return null;}}
  static void Remove(Dictionary<uint,Source> sources,uint pid){Source? s;lock(sources){if(!sources.Remove(pid,out s))return;}try{s.Client.Stop();}catch{}CloseHandle(s.Signal);}
  // Windows reuses the IDs of exited processes, so a recorded parent ID can name an unrelated newer process
  // (zodiak relaunched by the exited installer, Discord started by its exited updater). A real parent is never
  // younger than its child; creation times come from the system process list, which anti-cheat cannot hide.
  static bool Under(uint pid,uint root,Dictionary<uint,(uint parent,string name,long start)> all){for(var depth=0;depth<64;depth++){if(pid==root)return true;if(pid==0||!all.TryGetValue(pid,out var p)||p.parent==pid||!IsParent(pid,p.parent,all))return false;pid=p.parent;}return false;}
  static bool IsParent(uint child,uint parent,Dictionary<uint,(uint parent,string name,long start)> all)=>all.TryGetValue(child,out var c)&&all.TryGetValue(parent,out var p)&&p.start<=c.start;
  static int Depth(uint pid,Dictionary<uint,(uint parent,string name,long start)> all){var depth=0;while(depth<64&&all.TryGetValue(pid,out var p)&&p.parent!=pid&&IsParent(pid,p.parent,all)){pid=p.parent;depth++;}return depth;}
  static string Name(uint pid,Dictionary<uint,(uint parent,string name,long start)> all)=>all.TryGetValue(pid,out var p)?$"{p.name} ({pid})":$"exited ({pid})";
  static Dictionary<uint,(uint parent,string name,long start)> Processes(){
    var all=new Dictionary<uint,(uint parent,string name,long start)>();var size=1<<20;
    while(true){
      var buffer=Marshal.AllocHGlobal(size);
      try{
        var status=NtQuerySystemInformation(5,buffer,size,out var needed);
        if(status==unchecked((int)0xC0000004)){size=Math.Max(size*2,needed+(1<<16));continue;}
        if(status<0)return all;
        // SYSTEM_PROCESS_INFORMATION (x64): next entry, create time, image name, process ID, parent ID.
        for(var at=buffer;;){var length=(ushort)Marshal.ReadInt16(at,0x38);var name=length>0?Marshal.PtrToStringUni(Marshal.ReadIntPtr(at,0x40),length/2):"System";all[(uint)(ulong)Marshal.ReadIntPtr(at,0x50)]=((uint)(ulong)Marshal.ReadIntPtr(at,0x58),name,Marshal.ReadInt64(at,0x20));var next=Marshal.ReadInt32(at,0);if(next==0)break;at+=next;}
        return all;
      }finally{Marshal.FreeHGlobal(buffer);}
    }
  }
  // Double-clicking the helper writes a report of what Exclude Discord would capture, for troubleshooting a game.
  static int Diagnose(){
    var report=new List<string>();void Log(string line){Console.WriteLine(line);report.Add(line);}
    // Judge exclusions against the running zodiak (its main process is the one not started by zodiak), as the app does.
    var processes=Processes();var self=processes.Where(p=>p.Value.name.Equals("zodiak.exe",StringComparison.OrdinalIgnoreCase)&&!(processes.TryGetValue(p.Value.parent,out var up)&&up.name.Equals("zodiak.exe",StringComparison.OrdinalIgnoreCase))).Select(p=>p.Key).FirstOrDefault();
    if(self==0)self=(uint)Environment.ProcessId;var scan=Survey(self);var all=scan.All;
    string Chain(uint pid){var parts=new List<string>{Name(pid,all)};for(var depth=0;depth<8&&all.TryGetValue(pid,out var p)&&p.parent!=pid;depth++){if(!all.ContainsKey(p.parent)){parts.Add($"exited ({p.parent})");break;}if(!IsParent(pid,p.parent,all)){parts.Add($"reused ID {p.parent}, ignored");break;}pid=p.parent;parts.Add(Name(pid,all));}return string.Join(" <- ",parts);}
    Log($"zodiak system-audio diagnostics, {DateTime.Now:yyyy-MM-dd HH:mm:ss}, Windows {Environment.OSVersion.Version}");
    Log("");Log("Discord processes (* = playing audio):");foreach(var d in scan.Discord)Log($"  {(scan.Audible.Contains(d)?"*":" ")} {Chain(d)}");
    Log("");Log("Apps with audio sessions:");
    foreach(var pid in scan.Sessions.Where(all.ContainsKey).OrderByDescending(pid=>Depth(pid,all))){
      var reason=Excluded(pid,scan);var hr=0;var probe=reason==null?Open(pid,out hr):null;
      Log($"  {Chain(pid)}");Log($"      {(reason!=null?"excluded: "+reason:probe!=null?"direct capture OK":$"direct capture FAILED 0x{hr:X8}")}");
      if(probe!=null){try{probe.Client.Stop();}catch{}CloseHandle(probe.Signal);}
    }
    var sources=new Dictionary<uint,Source>();Refresh(self,sources);
    Log("");Log("Exclude Discord would capture (peak level over 3 seconds, 0-32767):");
    var peaks=sources.Keys.ToDictionary(pid=>pid,_=>0);var clock=Stopwatch.StartNew();var read=new short[0];
    while(clock.ElapsedMilliseconds<3000){Thread.Sleep(10);foreach(var (pid,s) in sources){try{while(true){s.Capture.GetNextPacketSize(out var next);if(next==0)break;s.Capture.GetBuffer(out var data,out var frames,out var flags,out _,out _);var count=(int)frames*2;if(read.Length<count)read=new short[count];if((flags&Silent)==0&&data!=IntPtr.Zero){Marshal.Copy(data,read,0,count);for(var i=0;i<count;i++)peaks[pid]=Math.Max(peaks[pid],Math.Abs((int)read[i]));}s.Capture.ReleaseBuffer(frames);}}catch{}}}
    foreach(var (pid,peak) in peaks)Log($"  {Name(pid,all)}: {peak}");
    if(peaks.Count==0)Log("  nothing");
    foreach(var pid in sources.Keys.ToList())Remove(sources,pid);
    var file=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"zodiak-audio-diagnostics.txt");
    try{File.WriteAllLines(file,report);Console.WriteLine($"\nSaved to {file}");}catch(Exception e){Console.WriteLine($"\nCould not save the report: {e.Message}");}
    Console.WriteLine("Press Enter to close.");Console.ReadLine();return 0;
  }
  static HashSet<uint> SessionPids(){
    var pids=new HashSet<uint>();var iid=typeof(ISessionManager).GUID;
    try{((IDeviceEnumerator)new DeviceEnumerator()).EnumAudioEndpoints(0,1,out var devices);devices.GetCount(out var count);
      for(uint i=0;i<count;i++){try{devices.Item(i,out var device);device.Activate(ref iid,23,IntPtr.Zero,out var value);((ISessionManager)value).GetSessionEnumerator(out var sessions);sessions.GetCount(out var n);
        for(var j=0;j<n;j++){sessions.GetSession(j,out var item);if(item is not ISessionControl session)continue;session.GetState(out var state);session.GetProcessId(out var pid);if(state!=2&&pid!=0)pids.Add(pid);}}catch{}}
    }catch{}
    return pids;
  }
  static IAudioClient? ActivateLoopback(uint pid,int mode,out int result){var activation=new Activation{type=1,pid=pid,mode=mode};var size=Marshal.SizeOf<Activation>();var blob=Marshal.AllocCoTaskMem(size);Marshal.StructureToPtr(activation,blob,false);var variant=new Variant{type=65,blob=new Blob{size=(uint)size,data=blob}};var memory=Marshal.AllocCoTaskMem(Marshal.SizeOf<Variant>());Marshal.StructureToPtr(variant,memory,false);var handler=new Completion();var iid=typeof(IAudioClient).GUID;var hr=ActivateAudioInterfaceAsync("VAD\\Process_Loopback",ref iid,memory,handler,out var operation);var done=hr>=0&&handler.Done.WaitOne(8000);Marshal.FreeCoTaskMem(memory);Marshal.FreeCoTaskMem(blob);GC.KeepAlive(operation);result=hr<0?hr:!done?unchecked((int)0x800705B4):handler.Result;return done&&handler.Result>=0?handler.Client:null;}
  static int Prepare(IAudioClient client,out ICapture capture,out IntPtr signal,long duration=0){capture=null!;signal=IntPtr.Zero;var f=new WaveFormat{tag=1,channels=2,rate=48000,bits=16,align=4,average=192000};var hr=client.Initialize(0,Loopback,duration,0,ref f,IntPtr.Zero);if(hr<0)return hr;signal=CreateEvent(IntPtr.Zero,false,false,IntPtr.Zero);if(signal==IntPtr.Zero)return -1;hr=client.SetEventHandle(signal);if(hr<0)return hr;var iid=typeof(ICapture).GUID;hr=client.GetService(ref iid,out var service);capture=service as ICapture??null!;return capture==null?-1:hr;}
  static int Pump(ICapture c,IntPtr signal){var output=Console.OpenStandardOutput();var buffer=Array.Empty<byte>();while(true){WaitForSingleObject(signal,200);while(true){var hr=c.GetNextPacketSize(out var next);if(hr<0)return Fail("Audio capture failed.");if(next==0)break;hr=c.GetBuffer(out var data,out var frames,out var flags,out _,out _);if(hr<0)return Fail("Audio capture failed.");var bytes=checked((int)frames*4);if(buffer.Length<bytes)buffer=new byte[bytes];if((flags&Silent)!=0||data==IntPtr.Zero)Array.Clear(buffer,0,bytes);else Marshal.Copy(data,buffer,0,bytes);c.ReleaseBuffer(frames);output.Write(buffer,0,bytes);}output.Flush();}}
}
