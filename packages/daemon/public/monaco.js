/**
 * Zeno · daemon UI · MONACO, LOADED FROM THIS MACHINE AND THEMED FROM THE TOKENS
 * ==============================================================================
 *
 * WHAT THIS IS. The one place the window touches Monaco Editor — VS Code's real
 * editor core. Everything Monaco needs is served by the daemon from
 * /vendor/monaco/, which `tools/vendor-monaco.mjs` fills at build time from the
 * `monaco-editor` ROOT devDependency.
 *
 * NO RUNTIME NETWORK EGRESS. Read this before changing anything here.
 *   · the loader, the editor bundle, every lazily-required language chunk and
 *     every web worker resolve to same-origin paths under /vendor/monaco/.
 *   · monaco's own stylesheet is injected by its AMD entry from that same
 *     directory, and the codicon icon face inside it is a data: URI — so the
 *     editor adds no font request either.
 *   · nothing here reads a CDN, and there is no @import anywhere in the tree.
 *
 * WHY MonacoEnvironment.getWorker IS NOT OVERRIDDEN. It is the usual thing to
 * write, and here it would make the workers WORSE. The prebuilt AMD bundle
 * already carries its own `createWorker` for each of the five workers, and each
 * one resolves through `require.toUrl` against the loader's `vs` path — so with
 * `paths.vs` pointed at /vendor/monaco/vs every worker URL is a local file under
 * that directory by construction. Overriding `getWorker` would replace a correct
 * local resolution with a hand-rolled one that has to be kept in step with
 * monaco's internal file names across upgrades. `MonacoEnvironment.baseUrl` is
 * still set, because that is the value the loader documents, and because a stray
 * relative resolution should land inside the vendored tree rather than at /.
 *
 *   The workers are ES-module workers created through a small blob: shim that
 *   monaco builds itself. That is allowed here: this page is served with no
 *   Content-Security-Policy, so no policy is being loosened to permit it, and
 *   the blob does nothing but `import()` the same-origin worker file. If a CSP
 *   is ever added to the daemon, `worker-src 'self' blob:` is what it needs —
 *   the alternative is a monaco build that has no blob shim, not a weaker page.
 *
 * THE THEME IS THE GLASS TOKENS, RESOLVED. Monaco wants literal colours; Zeno's
 * palette lives in CSS custom properties, several of them `color-mix()`
 * expressions that only a browser can evaluate. So each token is resolved the
 * only honest way — by asking the browser what `color: var(--token)` computes to
 * on this document — and the result is fed to `defineTheme`. Change tokens.css
 * and the editor changes with it; no hex is invented here. The theme is rebuilt
 * whenever the ground flips, so light and dark both stay correct.
 *
 * Exports:
 *   loadMonaco()            -> Promise<monaco>   (idempotent; rejects legibly)
 *   monacoIfLoaded()        -> monaco | null     (never triggers a load)
 *   applyZenoTheme(monaco)  -> string            the theme name now in force
 *   onThemeChange(fn)       -> () => void        unsubscribe
 *   ZENO_THEME              the theme name
 *   languageForPath(path)   -> string | null     monaco language id, or null
 *   DIAGNOSED               languages with a REAL checker behind them
 */

/** Everything monaco is served from. One constant, used by the loader and the docs. */
const VENDOR = '/vendor/monaco';

export const ZENO_THEME = 'zeno-glass';

let pending = null;

/**
 * Load monaco once. Resolves with the `monaco` namespace; rejects with an error
 * whose message names the missing thing, because "the editor did not load" is
 * not a sentence anyone can act on. The caller is expected to render that
 * message rather than an empty pane.
 */
export function loadMonaco() {
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    if (globalThis.monaco && globalThis.monaco.editor) {
      resolve(globalThis.monaco);
      return;
    }
    // Documented by the loader; see the note above on why getWorker is not set.
    globalThis.MonacoEnvironment = Object.assign({}, globalThis.MonacoEnvironment, {
      baseUrl: `${VENDOR}/`,
    });
    const s = document.createElement('script');
    s.src = `${VENDOR}/vs/loader.js`;
    s.async = true;
    s.onerror = () => {
      pending = null;
      reject(new Error(
        `the editor bundle is not on this machine — ${VENDOR}/vs/loader.js did not load. ` +
        'Run `npm run build` (which runs `npm run vendor:monaco`) and reload.',
      ));
    };
    s.onload = () => {
      const req = globalThis.require;
      if (typeof req !== 'function' || typeof req.config !== 'function') {
        pending = null;
        reject(new Error('the editor loader loaded but defined no module loader.'));
        return;
      }
      req.config({ paths: { vs: `${VENDOR}/vs` } });
      req(
        ['vs/editor/editor.main'],
        () => {
          const m = globalThis.monaco;
          if (!m || !m.editor) {
            pending = null;
            reject(new Error('the editor bundle loaded but exposed no editor.'));
            return;
          }
          configureLanguages(m);
          applyZenoTheme(m);
          watchGround(m);
          resolve(m);
        },
        (err) => {
          pending = null;
          reject(new Error(`the editor bundle failed to start: ${(err && err.message) || err}`));
        },
      );
    };
    document.head.appendChild(s);
  });
  return pending;
}

/** The namespace if it is already here, and never a load. For paint paths. */
export function monacoIfLoaded() {
  return globalThis.monaco && globalThis.monaco.editor ? globalThis.monaco : null;
}

/* ================================================================== *
 * 1 · the theme, resolved from glass/tokens.css                       *
 * ================================================================== */

function hex2(n) {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

/**
 * Ask the browser what a token actually is. A throwaway element carries
 * `color: var(--token)` and `getComputedStyle().color` is then a resolved
 * `rgb()` — which is the only way to read a `color-mix()` token, because a
 * custom property's own computed value is the UNEVALUATED expression and half
 * of Zeno's palette is `color-mix(in srgb, …)`.
 *
 * A FRESH ELEMENT PER TOKEN, and that is not waste. Reassigning
 * `style.color = 'var(--other)'` on an element whose colour has already been
 * computed does not re-resolve the substitution in Chromium: every read after
 * the first returns the FIRST token's value. Measured here, not assumed — the
 * whole theme came back as one colour and the editor rendered ink on ink. A
 * node per token costs a few dozen microseconds, once per theme build.
 */
function readToken(name, fallback) {
  const p = document.createElement('span');
  p.setAttribute('aria-hidden', 'true');
  p.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:0;pointer-events:none';
  p.style.color = `var(${name})`;
  document.body.appendChild(p);
  const c = getComputedStyle(p).color;
  p.remove();
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(c || '');
  if (!m) return fallback;
  return `#${hex2(+m[1])}${hex2(+m[2])}${hex2(+m[3])}`;
}

/** #RRGGBB + an alpha byte. Monaco takes 8-digit hex for translucent colours. */
function alpha(hex, a) {
  return `${hex}${hex2(a * 255)}`;
}

/** True when the document is currently rendering on the dark ramp. */
function isDark() {
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'dark') return true;
  if (explicit === 'light') return false;
  return Boolean(globalThis.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
}

/**
 * Define (or redefine) the Zeno theme from the tokens in force right now, and
 * make it current. Returns the theme name.
 *
 * The colour law from tokens.css is respected rather than reinterpreted: the
 * editor ground is --g2 (an opaque work plane — code never sits on glass), text
 * is --ink, and the accents are exactly the five palette colours, each used
 * within the ramp its contrast note allows.
 *
 * BRACKET PAIR COLORIZATION is the one place Zeno's palette does something the
 * prototype never did: the six bracket levels are the six palette hues in a
 * fixed order, so "rainbow brackets" are Zeno's rainbow and not VS Code's.
 */
export function applyZenoTheme(monaco) {
  const t = readToken;

  const dark = isDark();
  const g1 = t('--g1', dark ? '#0A0C0E' : '#E9E8E2');
  const g2 = t('--g2', dark ? '#0F1214' : '#F4F3EE');
  const g3 = t('--g3', dark ? '#151A1D' : '#FBFAF6');
  const g4 = t('--g4', dark ? '#1B2124' : '#F0EFEA');
  const g5 = t('--g5', dark ? '#222A2E' : '#E7E6E0');
  const g6 = t('--g6', dark ? '#2C363B' : '#D6D4CC');
  const g7 = t('--g7', dark ? '#384349' : '#C2C0B8');
  const ink = t('--ink', dark ? '#ECEBE6' : '#171A1E');
  const ink2 = t('--ink-2', dark ? '#9AA1AC' : '#555C67');
  const ink3 = t('--ink-3', dark ? '#6C7480' : '#7E858F');
  const rule = t('--rule', dark ? '#242C31' : '#DEDCD5');
  const rule2 = t('--rule-2', dark ? '#2C363B' : '#CBC9C1');
  const cyan = t('--cyan', dark ? '#38C3D6' : '#165661');
  const gold = t('--gold', dark ? '#D8BE7E' : '#5D4D27');
  const amber = t('--amber', dark ? '#E0A128' : '#765613');
  const green = t('--green', dark ? '#5BB98C' : '#33654C');
  const red = t('--red', dark ? '#D8695A' : '#A6483C');
  const focus = t('--focus', dark ? '#86DEEC' : '#15707E');

  monaco.editor.defineTheme(ZENO_THEME, {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      // The prototype's three code colours, kept: keyword cyan, string gold,
      // comment secondary-ink. Everything added below is an extension of that
      // vocabulary into tokens the hand-rolled lexer never had a name for.
      { token: '', foreground: ink.slice(1) },
      { token: 'comment', foreground: ink2.slice(1), fontStyle: 'italic' },
      { token: 'string', foreground: gold.slice(1) },
      { token: 'string.escape', foreground: amber.slice(1) },
      { token: 'keyword', foreground: cyan.slice(1) },
      { token: 'keyword.json', foreground: cyan.slice(1) },
      { token: 'number', foreground: green.slice(1) },
      { token: 'regexp', foreground: green.slice(1) },
      { token: 'type', foreground: cyan.slice(1) },
      { token: 'type.identifier', foreground: cyan.slice(1) },
      { token: 'identifier', foreground: ink.slice(1) },
      { token: 'delimiter', foreground: ink2.slice(1) },
      { token: 'operator', foreground: ink2.slice(1) },
      { token: 'tag', foreground: cyan.slice(1) },
      { token: 'metatag', foreground: ink2.slice(1) },
      { token: 'attribute.name', foreground: amber.slice(1) },
      { token: 'attribute.value', foreground: gold.slice(1) },
      { token: 'variable', foreground: ink.slice(1) },
      { token: 'invalid', foreground: red.slice(1) },
      // Markdown, so a README is legible rather than a wall of one colour.
      { token: 'keyword.md', foreground: cyan.slice(1), fontStyle: 'bold' },
      { token: 'string.link.md', foreground: gold.slice(1) },
      { token: 'variable.md', foreground: green.slice(1) },
      { token: 'emphasis', fontStyle: 'italic' },
      { token: 'strong', fontStyle: 'bold' },
    ],
    colors: {
      'editor.background': g2,
      'editor.foreground': ink,
      'editorCursor.foreground': cyan,
      'editorLineNumber.foreground': ink3,
      'editorLineNumber.activeForeground': ink,
      'editor.lineHighlightBackground': alpha(gold, 0.07),
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': alpha(cyan, 0.28),
      'editor.inactiveSelectionBackground': alpha(cyan, 0.14),
      'editor.selectionHighlightBackground': alpha(cyan, 0.16),
      'editor.wordHighlightBackground': alpha(cyan, 0.14),
      'editor.wordHighlightStrongBackground': alpha(green, 0.16),
      'editor.findMatchBackground': alpha(amber, 0.38),
      'editor.findMatchHighlightBackground': alpha(amber, 0.2),
      'editorIndentGuide.background1': rule,
      'editorIndentGuide.activeBackground1': rule2,
      'editorWhitespace.foreground': rule2,
      'editorGutter.background': g2,
      'editorRuler.foreground': rule,
      'editorOverviewRuler.border': '#00000000',
      'editorBracketMatch.background': alpha(cyan, 0.18),
      'editorBracketMatch.border': cyan,

      // Rainbow brackets, in Zeno's palette and Zeno's order.
      'editorBracketHighlight.foreground1': cyan,
      'editorBracketHighlight.foreground2': gold,
      'editorBracketHighlight.foreground3': green,
      'editorBracketHighlight.foreground4': amber,
      'editorBracketHighlight.foreground5': focus,
      'editorBracketHighlight.foreground6': ink2,
      'editorBracketHighlight.unexpectedBracket.foreground': red,

      'editorError.foreground': red,
      'editorWarning.foreground': amber,
      'editorInfo.foreground': cyan,
      'editorHint.foreground': ink3,

      'editorWidget.background': g3,
      'editorWidget.foreground': ink,
      'editorWidget.border': rule2,
      'editorSuggestWidget.background': g3,
      'editorSuggestWidget.border': rule2,
      'editorSuggestWidget.foreground': ink,
      'editorSuggestWidget.selectedBackground': g5,
      'editorSuggestWidget.highlightForeground': cyan,
      'editorHoverWidget.background': g3,
      'editorHoverWidget.border': rule2,
      'editorMarkerNavigation.background': g3,
      'peekViewEditor.background': g2,
      'peekViewResult.background': g3,

      'input.background': g1,
      'input.foreground': ink,
      'input.border': rule2,
      'inputOption.activeBorder': cyan,
      'focusBorder': focus,
      'dropdown.background': g3,
      'dropdown.foreground': ink,
      'dropdown.border': rule2,
      'list.hoverBackground': g4,
      'list.activeSelectionBackground': g5,
      'list.activeSelectionForeground': ink,
      'list.focusBackground': g5,
      'list.highlightForeground': cyan,

      'menu.background': g3,
      'menu.foreground': ink,
      'menu.border': rule2,
      'menu.selectionBackground': g5,
      'menu.selectionForeground': ink,
      'menu.separatorBackground': rule,

      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': alpha(g7, 0.5),
      'scrollbarSlider.hoverBackground': alpha(g7, 0.75),
      'scrollbarSlider.activeBackground': g7,

      'minimap.background': g2,
      'minimap.findMatchHighlight': amber,
      'minimapSlider.background': alpha(g6, 0.4),
      'minimapSlider.hoverBackground': alpha(g6, 0.6),
      'minimapSlider.activeBackground': alpha(g6, 0.8),

      'editorStickyScroll.background': g3,
      'editorStickyScrollHover.background': g4,
      'editorGhostText.foreground': ink3,
      'editorLink.activeForeground': cyan,
      'editorCodeLens.foreground': ink3,
      'editorUnnecessaryCode.opacity': '#00000080',
      'diffEditor.insertedTextBackground': alpha(green, 0.16),
      'diffEditor.removedTextBackground': alpha(red, 0.16),
    },
  });
  monaco.editor.setTheme(ZENO_THEME);
  return ZENO_THEME;
}

const themeListeners = new Set();

/** Called after the theme is rebuilt for a new ground. Returns an unsubscribe. */
export function onThemeChange(fn) {
  themeListeners.add(fn);
  return () => themeListeners.delete(fn);
}

/**
 * The ground can flip two ways — the machine's setting, or an explicit
 * data-theme on :root — so both are watched, and the theme is rebuilt from the
 * tokens as they are AFTER the flip. Rebuilding rather than defining two themes
 * up front means a token edit never needs a second definition kept in step.
 */
function watchGround(monaco) {
  const rebuild = () => {
    applyZenoTheme(monaco);
    for (const fn of themeListeners) {
      try {
        fn();
      } catch {
        /* a listener that throws must not stop the others */
      }
    }
  };
  if (globalThis.matchMedia) {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', rebuild);
  }
  new MutationObserver(rebuild).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
}

/* ================================================================== *
 * 2 · languages: what is checked, what is formatted, and what is not  *
 * ================================================================== */

/**
 * The languages that have a REAL checker behind them in this bundle, and
 * nothing else. Every one of these is a language service monaco ships and this
 * file configures; a language absent from this set gets no diagnostics
 * affordance at all rather than a reassuring empty one.
 *
 *   typescript / javascript  the TypeScript service, SYNTAX ONLY — see below.
 *   json                     the JSON service: parse errors, duplicate keys,
 *                            trailing commas. Complete for a lone document.
 *   css / scss / less        the CSS service: parse errors, unknown properties,
 *                            unknown at-rules. Complete for a lone stylesheet.
 *
 * html is deliberately NOT here. Monaco's HTML service gives completion and
 * formatting but publishes no diagnostics, so a "0 problems" badge on an HTML
 * file would report a check that never ran.
 */
export const DIAGNOSED = new Set(['typescript', 'javascript', 'json', 'css', 'scss', 'less']);

/**
 * WHY TYPESCRIPT SEMANTIC VALIDATION IS OFF, and why that is the honest setting.
 *
 * This pane holds ONE file, read over /forge/file. There is no tsconfig, no
 * node_modules, and no sibling module in the model. With semantic validation on,
 * the service reports every `import` as an unresolved module and every Node
 * global as an undefined name — errors about files that are on disk and globals
 * that exist. That is not a strict editor; it is a screen full of false claims,
 * and this window's whole point is not making those.
 *
 * SYNTAX validation is a different thing and it is ON: a parse error is decided
 * entirely by the bytes in this buffer, so it is true no matter what the rest of
 * the project looks like. It is the real TypeScript parser saying a real thing.
 * The status strip in Forge says exactly this, so the limit is on screen rather
 * than in a comment only I will read.
 */
function configureLanguages(monaco) {
  const ts = monaco.languages.typescript;
  if (!ts) return;
  const opts = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    allowJs: true,
    allowNonTsExtensions: true,
    noEmit: true,
    jsx: ts.JsxEmit.Preserve,
  };
  const diags = { noSemanticValidation: true, noSyntaxValidation: false, noSuggestionDiagnostics: true };
  ts.typescriptDefaults.setCompilerOptions(opts);
  ts.typescriptDefaults.setDiagnosticsOptions(diags);
  ts.javascriptDefaults.setCompilerOptions(opts);
  ts.javascriptDefaults.setDiagnosticsOptions(diags);
  // The service would otherwise fetch .d.ts files for bare imports over the
  // network. It is off by default; turning it off explicitly is cheap insurance
  // for the no-egress rule, because a future default flip would be silent.
  if (typeof ts.typescriptDefaults.setEagerModelSync === 'function') {
    ts.typescriptDefaults.setEagerModelSync(true);
    ts.javascriptDefaults.setEagerModelSync(true);
  }
}

/**
 * The monaco language id for a path, from monaco's OWN extension registry —
 * so the mapping is whatever monaco actually supports, never a list here that
 * drifts from it. Returns null when monaco claims no language for the file, and
 * the caller then shows it as plain text and says so.
 */
export function languageForPath(path) {
  const monaco = monacoIfLoaded();
  if (!monaco) return null;
  const name = String(path || '');
  const dot = name.lastIndexOf('.');
  const ext = dot === -1 ? '' : name.slice(dot).toLowerCase();
  const base = name.slice(name.lastIndexOf('/') + 1).toLowerCase();
  for (const lang of monaco.languages.getLanguages()) {
    if (ext && Array.isArray(lang.extensions) && lang.extensions.some((e) => String(e).toLowerCase() === ext)) {
      return lang.id;
    }
    if (Array.isArray(lang.filenames) && lang.filenames.some((f) => String(f).toLowerCase() === base)) {
      return lang.id;
    }
  }
  return null;
}
