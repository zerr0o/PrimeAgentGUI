try {
  const theme = JSON.parse(localStorage.getItem('prime-studio.preferences') || '{}').theme || 'dark';
  document.documentElement.dataset.theme =
    theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
} catch {}
