import { useEffect, useState } from 'react';

export interface ThemeTokens {
  textPrimary: string;
  textSecondary: string;
  chartGrid: string;
  chartTick: string;
  chartTooltipBg: string;
  chartTooltipText: string;
  borderSoft: string;
}

const FALLBACK_TOKENS: ThemeTokens = {
  textPrimary: 'rgba(255, 255, 255, 0.94)',
  textSecondary: 'rgba(255, 255, 255, 0.65)',
  chartGrid: 'rgba(255, 255, 255, 0.06)',
  chartTick: 'rgba(255, 255, 255, 0.66)',
  chartTooltipBg: 'rgba(4, 8, 18, 0.90)',
  chartTooltipText: 'rgba(255, 255, 255, 0.92)',
  borderSoft: 'rgba(255, 255, 255, 0.10)',
};

const readToken = (styles: CSSStyleDeclaration, name: string, fallback: string) => {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
};

const readThemeTokens = (): ThemeTokens => {
  if (typeof window === 'undefined') return FALLBACK_TOKENS;
  const styles = window.getComputedStyle(document.documentElement);
  return {
    textPrimary: readToken(styles, '--text-primary', FALLBACK_TOKENS.textPrimary),
    textSecondary: readToken(styles, '--text-secondary', FALLBACK_TOKENS.textSecondary),
    chartGrid: readToken(styles, '--chart-grid', FALLBACK_TOKENS.chartGrid),
    chartTick: readToken(styles, '--chart-tick', FALLBACK_TOKENS.chartTick),
    chartTooltipBg: readToken(styles, '--chart-tooltip-bg', FALLBACK_TOKENS.chartTooltipBg),
    chartTooltipText: readToken(styles, '--chart-tooltip-text', FALLBACK_TOKENS.chartTooltipText),
    borderSoft: readToken(styles, '--border-soft', FALLBACK_TOKENS.borderSoft),
  };
};

export const useThemeTokens = () => {
  const [tokens, setTokens] = useState<ThemeTokens>(readThemeTokens);

  useEffect(() => {
    const sync = () => setTokens(readThemeTokens());
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-time-theme', 'data-scenario', 'style', 'class'],
    });

    window.addEventListener('focus', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('focus', sync);
    };
  }, []);

  return tokens;
};
