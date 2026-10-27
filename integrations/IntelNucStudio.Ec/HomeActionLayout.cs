using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace IntelNucStudio.Ec
{
    // Own a row in the real ProfilesView; never position home actions in shell coordinates.
    internal sealed class HomeActionLayout
    {
        private readonly Button _entry;
        private readonly AutoStartControl _startup;
        private Grid _footer;
        private ItemsControl _nativeButtons;
        internal HomeActionLayout(Button entry, AutoStartControl startup) { _entry = entry; _startup = startup; }

        internal bool Attach(FrameworkElement home)
        {
            var buttons = FindButtons(home);
            if (buttons == null || !(buttons.Parent is Grid footer)) return false;
            if (ReferenceEquals(footer, _footer)) return true;
            if (_footer != null) _footer.SizeChanged -= OnSizeChanged;
            Detach(_entry); Detach(_startup);
            _footer = footer; _nativeButtons = buttons;
            // Keep the official controls, Prism regions, parents and bindings.
            foreach (UIElement child in footer.Children)
                if (!ReferenceEquals(child, buttons)) Grid.SetColumn(child, 4);
            footer.ColumnDefinitions.Clear();
            foreach (var width in new[] { GridLength.Auto, GridLength.Auto, new GridLength(1, GridUnitType.Star), GridLength.Auto, GridLength.Auto })
                footer.ColumnDefinitions.Add(new ColumnDefinition { Width = width });
            footer.RowDefinitions.Clear();
            footer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            footer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            if (footer.Parent is Grid data && Grid.GetRow(footer) < data.RowDefinitions.Count)
            {
                var row = data.RowDefinitions[Grid.GetRow(footer)];
                row.SetCurrentValue(RowDefinition.HeightProperty, GridLength.Auto);
                row.MinHeight = 88;
            }
            buttons.SetCurrentValue(FrameworkElement.HeightProperty, 72d);
            buttons.VerticalAlignment = VerticalAlignment.Center;
            _entry.Width = 116; _entry.Height = 72;
            _entry.Margin = new Thickness(12, 0, 0, 0);
            _entry.VerticalAlignment = VerticalAlignment.Center;
            _startup.Margin = new Thickness(16, 0, 0, 0);
            _startup.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(_entry, 1); footer.Children.Add(_entry);
            Grid.SetColumn(_startup, 3); footer.Children.Add(_startup);
            footer.SizeChanged += OnSizeChanged;
            Arrange();
            return true;
        }

        private void Arrange()
        {
            if (_footer == null) return;
            _nativeButtons.Width = Math.Max(1, _nativeButtons.Items.Count) * 104d;
            var branding = 0d;
            foreach (UIElement child in _footer.Children)
                if (Grid.GetColumn(child) == 4) branding = Math.Max(branding, child.DesiredSize.Width);
            var compact = _footer.ActualWidth > 0 && _footer.ActualWidth < Math.Max(720, _nativeButtons.Width + 128 + 352 + branding + 16);
            Grid.SetRow(_startup, compact ? 1 : 0);
            Grid.SetColumn(_startup, compact ? 0 : 3);
            Grid.SetColumnSpan(_startup, compact ? 4 : 1);
            _startup.HorizontalAlignment = compact ? HorizontalAlignment.Left : HorizontalAlignment.Right;
            _startup.Margin = compact ? new Thickness(0, 6, 0, 0) : new Thickness(16, 0, 0, 0);
            _startup.Width = Math.Min(336, Math.Max(220, _footer.ActualWidth - 16));
        }

        private void OnSizeChanged(object sender, SizeChangedEventArgs args) => Arrange();

        private static void Detach(FrameworkElement element) { if (element.Parent is Panel panel) panel.Children.Remove(element); }
        private static ItemsControl FindButtons(DependencyObject node)
        {
            if (node == null) return null;
            if (node is ItemsControl items && items.Name == "ButtonContent") return items;
            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
            { var found = FindButtons(VisualTreeHelper.GetChild(node, i)); if (found != null) return found; }
            return null;
        }
    }
}
