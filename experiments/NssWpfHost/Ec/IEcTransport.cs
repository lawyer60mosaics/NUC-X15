using System;
using System.Threading.Tasks;

namespace NssWpfHost.Ec
{
    internal interface IEcTransport : IDisposable
    {
        Task<long> ExecuteAsync(string payload);
    }
}
