// Renders AI-generated / teacher-edited text containing LaTeX math as a
// single autosizing WebView, for screens/coach/MarkdownText.tsx's on-screen
// preview. Reuses lib/formatHtml.ts's formatResponseHtml() — the exact same
// HTML+KaTeX pipeline mobile/src/lib/buildResourcePdfHtml.ts already builds
// for PDF export, and functionally the same output client/src/lib/format.ts
// produces on web — rather than a second, parallel implementation.
//
// This renders the WHOLE block as one WebView rather than one WebView per
// math expression: a real exam paper's question stems and MCQ options can
// carry dozens of expressions, and mounting a WebView (each loading its own
// ~370KB embedded-font CSS payload, see lib/katexEmbeddedCss.ts) per
// expression left many blank/unmeasured and let Android's native WebView
// visually float above sibling views regardless of RN layout order —
// unrelated text visibly overlapped. One WebView per block sidesteps both.
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import { formatResponseHtml } from '../lib/formatHtml';
import { KATEX_EMBEDDED_CSS } from '../lib/katexEmbeddedCss';

interface FormattedHtmlViewProps {
  text: string;
  colors: { text: string; orange: string; border: string; surface2: string };
}

const MIN_HEIGHT = 24;

export function FormattedHtmlView({ text, colors }: FormattedHtmlViewProps) {
  const bodyHtml = useMemo(() => formatResponseHtml(text), [text]);
  const [height, setHeight] = useState(MIN_HEIGHT);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    const measured = Number(event.nativeEvent.data);
    if (Number.isFinite(measured) && measured > 0) setHeight(Math.ceil(measured));
  }, []);

  // Ported from client/src/index.css's .response-body rules (the on-screen
  // rules — buildResourcePdfHtml.ts's BASE_STYLE mirrors the separate print
  // stylesheet instead), themed with this screen's live colors rather than
  // print's fixed black-on-white. Same class names formatResponseHtml
  // already emits (fmt-qnum, fmt-options, fmt-table, ...).
  const page = `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>${KATEX_EMBEDDED_CSS}
html,body{margin:0;padding:0;background:transparent;}
body{font-family:-apple-system, Roboto, 'Segoe UI', sans-serif;color:${colors.text};font-size:15px;line-height:1.7;}
h1,h2,h3,h4,h5,h6{margin:0.9em 0 0.4em;}
h1{font-size:1.3em;color:${colors.text};}
h2{font-size:1.15em;color:${colors.orange};margin-top:1.3em;}
h3,h4,h5,h6{font-size:1.05em;color:${colors.orange};margin-top:1.2em;}
p{margin:0.7em 0;}
ul,ol{padding-left:1.3em;}
li{margin:0.3em 0;}
ol{list-style:none;padding-left:0;}
.fmt-qnum{font-weight:700;}
li.fmt-li-ol{padding-left:1.9em;text-indent:-1.9em;}
.katex{text-indent:0;}
.fmt-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0.25em 1.4em;margin:0.35em 0 0.75em 1.9em;}
.fmt-option{margin:0;}
.fmt-subpart{margin:0.3em 0 0.3em 1.9em;}
.fmt-table{width:100%;border-collapse:collapse;margin:0.6em 0 1em;font-size:0.95em;}
.fmt-table th,.fmt-table td{border:1px solid ${colors.border};padding:0.45em 0.6em;text-align:left;vertical-align:top;}
.fmt-table th{background:${colors.surface2};font-weight:600;}
.fmt-table td:first-child,.fmt-table th:first-child{width:1%;white-space:nowrap;}
strong{font-weight:700;}
</style></head>
<body id="fmt-root">${bodyHtml}
<script>
var fmtRoot = document.getElementById('fmt-root');
function report(){
  window.ReactNativeWebView.postMessage(String(fmtRoot.scrollHeight));
}
// A one-shot report() right after script execution + window.load raced
// against layout that hadn't settled yet on a long, math-heavy document —
// KaTeX's own web-font swap can still be reflowing content after 'load'
// fires, so a single early measurement under-reported the real height and
// the WebView stayed stuck at MIN_HEIGHT, clipping everything below it.
// ResizeObserver reports every time the content's actual size changes,
// however many reflows that takes, so the final report is always correct.
if (window.ResizeObserver) {
  new ResizeObserver(report).observe(fmtRoot);
} else {
  report();
  window.addEventListener('load', report);
}
</script>
</body></html>`;

  return (
    <WebView
      originWhitelist={['*']}
      source={{ html: page }}
      onMessage={onMessage}
      style={[styles.webview, { height }]}
      scrollEnabled={false}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  webview: { backgroundColor: 'transparent', width: '100%' },
});
