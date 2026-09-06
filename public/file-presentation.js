// Formatting is for the preview only. Original file bytes are never rewritten.
export function formatJson(text) {
  try {
    JSON.parse(text);
  } catch {
    return null;
  }
  // Keep original number/string literals, duplicate keys and key order intact.
  const tokens = text.match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:]+/g) || [];
  const parts = [];
  let depth = 0,
    length = 0;
  const newline = () => '\n' + '  '.repeat(depth);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    let chunk = token;
    if (token === '{' || token === '[') {
      if (++depth > 80) return null;
      if (tokens[i + 1] !== (token === '{' ? '}' : ']')) chunk += newline();
    } else if (token === '}' || token === ']') {
      depth--;
      if (tokens[i - 1] !== (token === '}' ? '{' : '[')) chunk = newline() + token;
    } else if (token === ',') chunk += newline();
    else if (token === ':') chunk += ' ';
    length += chunk.length;
    if (length > 2 * 1024 * 1024) return null;
    parts.push(chunk);
  }
  return parts.join('');
}

export function filePresentation(path, text) {
  if (/\.(md|markdown|mdown|mkd)$/i.test(path)) return { kind: 'markdown', label: 'Markdown', text };
  if (/\.json$/i.test(path)) {
    const formatted = formatJson(text);
    if (formatted !== null) return { kind: 'json', label: 'JSON', text: formatted };
  }
  return { kind: 'text', text };
}
