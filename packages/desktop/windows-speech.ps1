param([string]$Language = 'en-US', [string]$WaveFile = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech
Add-Type -AssemblyName System.Web.Extensions
Add-Type -ReferencedAssemblies System.Speech,System.Web.Extensions -TypeDefinition @'
using System;
using System.Globalization;
using System.Speech.Recognition;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
public static class ZenoLocalSpeech {
  static readonly object Sync = new object();
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
  static void Emit(object value) { lock (Sync) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); } }
  public static void Run(string language, string waveFile) {
    try {
      using (var engine = new SpeechRecognitionEngine(CultureInfo.GetCultureInfo(language))) {
        engine.LoadGrammar(new DictationGrammar());
        engine.SpeechRecognized += (s, e) => Emit(new { type = "result", text = e.Result.Text, final = true, confidence = e.Result.Confidence });
        engine.SpeechHypothesized += (s, e) => Emit(new { type = "result", text = e.Result.Text, final = false, confidence = e.Result.Confidence });
        using (var ended = new ManualResetEvent(false)) {
          engine.RecognizeCompleted += (s, e) => ended.Set();
          if (String.IsNullOrEmpty(waveFile)) engine.SetInputToDefaultAudioDevice();
          else engine.SetInputToWaveFile(waveFile);
          engine.RecognizeAsync(RecognizeMode.Multiple);
          Emit(new { type = "start" });
          if (!String.IsNullOrEmpty(waveFile)) { ended.WaitOne(15000); return; }
          var command = Task.Factory.StartNew(() => Console.ReadLine());
          while (!ended.WaitOne(50)) {
            if (command.IsCompleted) {
              if (command.Result == "stop") engine.RecognizeAsyncStop();
              else engine.RecognizeAsyncCancel();
              ended.WaitOne(1000);
              break;
            }
          }
        }
      }
    } catch (Exception) {
      Emit(new { type = "error", error = "audio-capture" });
    } finally { Emit(new { type = "end" }); }
  }
}
'@
[ZenoLocalSpeech]::Run($Language, $WaveFile)
