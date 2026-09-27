using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class DeviceEnumerator { }
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDeviceEnumerator { int EnumAudioEndpoints(int flow,uint state,out IntPtr devices); int GetDefaultAudioEndpoint(int flow,int role,out IDevice device); }
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDevice { int Activate(ref Guid iid,uint context,IntPtr parameters,[MarshalAs(UnmanagedType.IUnknown)] out object value); }
[ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioClient { int Initialize(int share,uint flags,long duration,long period,ref WaveFormat format,IntPtr session); int GetBufferSize(out uint count); int GetStreamLatency(out long latency); int GetCurrentPadding(out uint padding); int IsFormatSupported(int share,ref WaveFormat format,IntPtr closest); int GetMixFormat(out IntPtr format); int GetDevicePeriod(out long normal,out long minimum); int Start(); int Stop(); int Reset(); int SetEventHandle(IntPtr handle); int GetService(ref Guid iid,[MarshalAs(UnmanagedType.IUnknown)] out object value); }
[ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ICapture { int GetBuffer(out IntPtr data,out uint frames,out uint flags,out ulong device,out ulong qpc); int ReleaseBuffer(uint frames); int GetNextPacketSize(out uint frames); }
[ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IActivationOperation { int GetActivateResult(out int result,[MarshalAs(UnmanagedType.IUnknown)] out object client); }
[ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ICompletion { int ActivateCompleted(IActivationOperation operation); }
[ComImport, Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAgile { }
[StructLayout(LayoutKind.Sequential,Pack=1)] struct WaveFormat { public ushort tag,channels; public uint rate,average; public ushort align,bits,extra; }
[StructLayout(LayoutKind.Sequential)] struct Activation { public int type; public uint pid; public int mode; }
[StructLayout(LayoutKind.Sequential)] struct Blob { public uint size; public IntPtr data; }
[StructLayout(LayoutKind.Sequential)] struct Variant { public ushort type,r1,r2,r3; public Blob blob; }

[ComVisible(true), ClassInterface(ClassInterfaceType.None)] sealed class Completion : ICompletion, IAgile {
  public readonly ManualResetEvent Done=new(false); public int Result; public IAudioClient? Client;
  public int ActivateCompleted(IActivationOperation op) { try { object value; var call=op.GetActivateResult(out var result,out value); Result=call<0?call:result; Client=value as IAudioClient; if(Result>=0&&Client==null) Result=unchecked((int)0x80004002); } catch { Result=unchecked((int)0x80004005); } Done.Set(); return 0; }
}

static class Program {
  const uint Loopback=0x80060000, Silent=2;
  [DllImport("ole32.dll")] static extern int CoInitializeEx(IntPtr reserved,uint mode);
  [DllImport("mmdevapi.dll",ExactSpelling=true)] static extern int ActivateAudioInterfaceAsync([MarshalAs(UnmanagedType.LPWStr)]string path,ref Guid iid,IntPtr parameters,ICompletion handler,out IActivationOperation operation);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateEvent(IntPtr attributes,bool manual,bool state,IntPtr name);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [MTAThread] static int Main() { CoInitializeEx(IntPtr.Zero,0); try { var pid=DiscordRoot(); if(pid==0) return Fail("Discord.exe is not running; start it before using Discord exclusion."); var client=ActivateExcluded(pid); if(client==null)return Fail("Windows process-loopback exclusion is unavailable."); if(Prepare(client,out var capture,out var signal)<0)return Fail("Could not initialize excluded system audio capture."); Console.Error.WriteLine($"ready exclude {pid}"); Console.Error.Flush(); if(client.Start()<0)return Fail("Could not start excluded system audio capture."); return Pump(capture,signal); }catch(Exception e){return Fail(e.Message);} }
  static int Fail(string text){Console.Error.WriteLine("error "+text);return 1;}
  static uint DiscordRoot(){var all=Process.GetProcesses();var ids=new HashSet<int>(all.Where(p=>p.ProcessName.StartsWith("Discord",StringComparison.OrdinalIgnoreCase)).Select(p=>p.Id)); foreach(var p in all){try{if(!ids.Contains(p.Id))continue; try{if(ids.Contains(p.Parent().Id))continue;}catch{} return (uint)p.Id;}finally{p.Dispose();}}return 0;}
  static Process Parent(this Process p){using var search=new System.Management.ManagementObjectSearcher("SELECT ParentProcessId FROM Win32_Process WHERE ProcessId="+p.Id); foreach(System.Management.ManagementObject v in search.Get()) return Process.GetProcessById(Convert.ToInt32(v["ParentProcessId"])); throw new InvalidOperationException();}
  static IAudioClient? ActivateExcluded(uint pid){var activation=new Activation{type=1,pid=pid,mode=1};var size=Marshal.SizeOf<Activation>();var blob=Marshal.AllocCoTaskMem(size);Marshal.StructureToPtr(activation,blob,false);var variant=new Variant{type=65,blob=new Blob{size=(uint)size,data=blob}};var memory=Marshal.AllocCoTaskMem(Marshal.SizeOf<Variant>());Marshal.StructureToPtr(variant,memory,false);var handler=new Completion();var iid=typeof(IAudioClient).GUID;var hr=ActivateAudioInterfaceAsync("VAD\\Process_Loopback",ref iid,memory,handler,out var operation);if(hr>=0)handler.Done.WaitOne(8000);Marshal.FreeCoTaskMem(memory);Marshal.FreeCoTaskMem(blob);GC.KeepAlive(operation);return hr>=0&&handler.Result>=0?handler.Client:null;}
  static int Prepare(IAudioClient client,out ICapture capture,out IntPtr signal){capture=null!;signal=IntPtr.Zero;var f=new WaveFormat{tag=1,channels=2,rate=48000,bits=16,align=4,average=192000};var hr=client.Initialize(0,Loopback,0,0,ref f,IntPtr.Zero);if(hr<0)return hr;signal=CreateEvent(IntPtr.Zero,false,false,IntPtr.Zero);if(signal==IntPtr.Zero)return -1;hr=client.SetEventHandle(signal);if(hr<0)return hr;var iid=typeof(ICapture).GUID;hr=client.GetService(ref iid,out var service);capture=service as ICapture??null!;return capture==null?-1:hr;}
  static int Pump(ICapture c,IntPtr signal){var output=Console.OpenStandardOutput();var buffer=Array.Empty<byte>();while(true){WaitForSingleObject(signal,200);while(true){var hr=c.GetNextPacketSize(out var next);if(hr<0)return Fail("Audio capture failed.");if(next==0)break;hr=c.GetBuffer(out var data,out var frames,out var flags,out _,out _);if(hr<0)return Fail("Audio capture failed.");var bytes=checked((int)frames*4);if(buffer.Length<bytes)buffer=new byte[bytes];if((flags&Silent)!=0||data==IntPtr.Zero)Array.Clear(buffer,0,bytes);else Marshal.Copy(data,buffer,0,bytes);c.ReleaseBuffer(frames);output.Write(buffer,0,bytes);}output.Flush();}}
}
