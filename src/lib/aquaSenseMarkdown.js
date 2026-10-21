import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

export const aquaSenseRemarkPlugins = [remarkGfm, [remarkMath, { singleDollarTextMath: false }]];
export const aquaSenseRehypePlugins = [[rehypeKatex, { throwOnError: false, trust: false }]];

const findUnescapedDelimiter = (text, delimiter, fromIndex) => {
  let index = text.indexOf(delimiter, fromIndex);
  while (index >= 0) {
    let precedingSlashes = 0;
    for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) precedingSlashes += 1;
    if (precedingSlashes % 2 === 0) return index;
    index = text.indexOf(delimiter, index + delimiter.length);
  }
  return -1;
};

const prepareInlineMath = text => {
  let output = '';
  let cursor = 0;
  while (cursor < text.length) {
    const open = findUnescapedDelimiter(text, '\\(', cursor);
    const unmatchedClose = findUnescapedDelimiter(text, '\\)', cursor);
    if (open < 0) {
      output += text.slice(cursor).replace(/\\\)/g, '\\\\)');
      break;
    }
    if (unmatchedClose >= 0 && unmatchedClose < open) {
      output += text.slice(cursor, unmatchedClose) + '\\\\)';
      cursor = unmatchedClose + 2;
      continue;
    }
    output += text.slice(cursor, open);
    const close = findUnescapedDelimiter(text, '\\)', open + 2);
    if (close < 0) {
      output += '\\\\(';
      cursor = open + 2;
      continue;
    }
    const expression = text.slice(open + 2, close);
    output += expression.trim() ? `$$${expression}$$` : `\\\\(${expression}\\\\)`;
    cursor = close + 2;
  }
  return output;
};

const prepareTextOutsideCode = line => {
  let output = '';
  let cursor = 0;
  while (cursor < line.length) {
    const codeStart = line.indexOf('`', cursor);
    if (codeStart < 0) return output + prepareInlineMath(line.slice(cursor));
    output += prepareInlineMath(line.slice(cursor, codeStart));
    let runLength = 1;
    while (line[codeStart + runLength] === '`') runLength += 1;
    const delimiter = '`'.repeat(runLength);
    let close = line.indexOf(delimiter, codeStart + runLength);
    while (close >= 0 && (line[close - 1] === '`' || line[close + runLength] === '`')) {
      close = line.indexOf(delimiter, close + runLength);
    }
    if (close < 0) return output + line.slice(codeStart);
    output += line.slice(codeStart, close + runLength);
    cursor = close + runLength;
  }
  return output;
};

/** Keep currency as literal text while enabling the explicit \(...\) math form. */
export const prepareMarkdownMath = content => {
  const lines = content.split(/(\r\n|\n|\r)/);
  let fenceCharacter = '';
  let fenceLength = 0;
  return lines.map(line => {
    if (line === '\r\n' || line === '\n' || line === '\r') return line;
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1];
      if (!fenceCharacter) {
        fenceCharacter = marker[0];
        fenceLength = marker.length;
      } else if (marker[0] === fenceCharacter && marker.length >= fenceLength && new RegExp(`^\\s*${marker[0]}{${fenceLength},}[\\t ]*$`).test(line)) {
        fenceCharacter = '';
        fenceLength = 0;
      }
      return line;
    }
    return fenceCharacter ? line : prepareTextOutsideCode(line);
  }).join('');
};

export const safeMarkdownUrl = url => {
  try {
    const parsed = new URL(url, 'https://aquasense.invalid');
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? url : '';
  } catch {
    return '';
  }
};
