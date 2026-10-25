using System;
using System.IO;
using System.Reflection;
using System.Windows;
using System.Linq;
using NssWpfHost.Ec;

namespace NssWpfHost
{
    public partial class MainWindow : Window
    {
        private readonly string _sourceDir;
        private Assembly _module;

        public MainWindow()
        {
            InitializeComponent();
            _sourceDir = Environment.GetEnvironmentVariable("NSS_SOURCE_DIR");
            if (string.IsNullOrWhiteSpace(_sourceDir))
                _sourceDir = System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "OriginalModule");

            SourcePath.Text = "模块目录\n" + _sourceDir;
            AppDomain.CurrentDomain.AssemblyResolve += ResolveOriginalDependency;
        }

        private Assembly ResolveOriginalDependency(object sender, ResolveEventArgs args)
        {
            if (!Directory.Exists(_sourceDir)) return null;
            var simpleName = new AssemblyName(args.Name).Name + ".dll";
            var candidate = Path.Combine(_sourceDir, simpleName);
            return File.Exists(candidate) ? Assembly.LoadFrom(candidate) : null;
        }

        private void LoadOriginalView(object sender, RoutedEventArgs e)
        {
            try
            {
                if (!Directory.Exists(_sourceDir))
                    throw new DirectoryNotFoundException("没有找到原版模块目录。请设置 NSS_SOURCE_DIR 指向 MSIX 提取目录。");

                var modulePath = Path.Combine(_sourceDir, "MobileDisplayModeMgr.dll");
                _module = Assembly.LoadFrom(modulePath);
                var viewType = _module.GetType("MobileDisplayModeMgr.Views.MobileDisplayModeSummaryView", true);
                var dependencies = string.Join("\n", viewType.GetConstructors()
                    .SelectMany(c => c.GetParameters()).Select(p => p.ParameterType.FullName).Distinct());
                OriginalContent.Content = OriginalContentText;
                OriginalContentText.Text = "找到原版视图类型：\n" + viewType.FullName +
                    "\n\n构造函数注入依赖：\n" + (string.IsNullOrEmpty(dependencies) ? "（无）" : dependencies) +
                    "\n\n视图已编译为 WPF BAML 资源；要显示原版页面，需要按原应用启动 Prism，并提供这些服务。";
                Status.Text = "程序集和视图元数据读取成功。没有实例化原版模块或视图，避免触发厂商服务初始化及硬件状态变更。";
            }
            catch (Exception ex)
            {
                var root = ex is TargetInvocationException && ex.InnerException != null ? ex.InnerException : ex;
                Status.Text = "加载未完成：" + root.GetType().Name + "：" + root.Message;
            }
        }

        private void OpenEcFanModule(object sender, RoutedEventArgs e)
        {
            var view = new EcFanControlView();
            OriginalContent.Content = view;
        }
    }
}
