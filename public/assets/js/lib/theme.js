/**
 * Dark by default, light on toggle, and the system preference honoured in both
 * directions.
 *
 * Shared by the sheet and the dashboard, which had grown two copies of this.
 * The subtlety worth keeping in one place: once a person has used the toggle,
 * their choice wins over the system preference until they clear it, but a
 * person who has never touched it follows the system as it changes.
 */
const KEY = 'off-guard:theme';

const read = () => {
  try { return localStorage.getItem(KEY); } catch { return null; }
};

const write = (value) => {
  try { localStorage.setItem(KEY, value); } catch { /* private mode: this session only */ }
};

export function prefersLight(theme = read()) {
  if (theme === 'light') return true;
  if (theme === 'dark') return false;
  return matchMedia('(prefers-color-scheme: light)').matches;
}

/**
 * @param {HTMLElement} button       the toggle
 * @param {(isLight: boolean) => void} onChange  redraws the button's icon
 */
export function setUpTheme(button, onChange) {
  const apply = (theme) => {
    const root = document.documentElement;
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
    else delete root.dataset.theme;

    const isLight = prefersLight(theme);
    button?.setAttribute('aria-pressed', String(isLight));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = isLight ? '#F6F4FB' : '#1A1033';
    onChange?.(isLight);
  };

  apply(read());

  button?.addEventListener('click', () => {
    const next = button.getAttribute('aria-pressed') === 'true' ? 'dark' : 'light';
    write(next);
    apply(next);
  });

  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (!read()) apply(null);
  });
}
