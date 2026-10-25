using System;
using System.Threading.Tasks;

namespace NssWpfHost.Ec
{
    public interface IEcFanController : IDisposable
    {
        bool IsCurveControlRunning { get; }
        bool IsManualControlRequested { get; }
        Task<EcFanSnapshot> ReadSnapshotAsync();
        Task SetManualControlAsync();
        Task StartCurveControlAsync(Action<string> statusChanged, Action<EcFanSnapshot> snapshotUpdated);
        Task StopCurveControlAsync();
        Task<bool> SetFanPercentAsync(int leftPercent, int rightPercent);
        Task ReleaseManualControlOnExitAsync();
    }
}
