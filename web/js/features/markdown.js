// js/features/markdown.js —— 轻量 Markdown 渲染（无外部依赖）
// 支持：标题 / 无序·有序列表 / 引用 / 代码块 / 行内代码 / 粗体 / 斜体 /
//       删除线 / 链接 / 分割线 / 换行。所有内容先转义，链接只允许 http(s)/mailto。
import { escapeHtml } from '../core.js';

function safeUrl(raw) {
  const u = String(raw || '').trim();
  if (!u) return '';
  if (!/^(https?:\/\/|mailto:)/i.test(u)) return '';
  return u.replace(/"/g, '%22').replace(/\s/g, '');
}

/** 行内渲染：不产生块级标签，保留文字语义 */
export function renderInlineMarkdown(src) {
  let s = escapeHtml(src == null ? '' : src);

  // 行内代码先抽出来，避免内部符号被后续规则命中
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (m, code) => {
    codes.push('<code>' + code + '</code>');
    return '\u0000' + (codes.length - 1) + '\u0000';
  });

  // 美元公式抽出来，避免 * _ \ 等被 Markdown 规则改写；后续由 KaTeX 统一渲染
  const maths = [];
  s = s.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, m => {
    maths.push(m);
    return '\u0002' + (maths.length - 1) + '\u0002';
  });

  // 链接 [文本](地址)
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const u = safeUrl(url);
    if (!u) return m;
    return '<a href="' + escapeHtml(u) + '" target="_blank" rel="noreferrer">' + text + '</a>';
  });

  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  s = s.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');

  s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => codes[Number(i)] || '');
  s = s.replace(/\u0002(\d+)\u0002/g, (m, i) => maths[Number(i)] || '');
  return s;
}

/** 行内渲染 + 保留换行（用于 Trick 的短字段） */
export function renderInlineMultiline(src) {
  return renderInlineMarkdown(src).replace(/\n/g, '<br>');
}

const FENCE = /^\s*```([\w+-]*)\s*$/;
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const QUOTE = /^\s*>\s?/;
const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;

/** 块级渲染：返回可直接插入 innerHTML 的安全 HTML */
export function renderMarkdown(src) {
  const text = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
  if (!text.trim()) return '';

  const lines = text.split('\n');
  const out = [];
  let para = [];
  let list = null;

  const flushPara = () => {
    if (!para.length) return;
    out.push('<p>' + para.map(renderInlineMarkdown).join('<br>') + '</p>');
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    out.push('<' + list.type + '>' + list.items.map(it => '<li>' + renderInlineMarkdown(it) + '</li>').join('') + '</' + list.type + '>');
    list = null;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(FENCE);
    if (fence) {
      flushPara(); flushList();
      const lang = fence[1] || '';
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // 跳过结束围栏
      out.push('<pre class="md-code"><code' + (lang ? ' class="lang-' + escapeHtml(lang) + '"' : '') + '>' + escapeHtml(buf.join('\n')) + '</code></pre>');
      continue;
    }

    // 独占一行的 $$ ... $$ 作为块级公式，交给 KaTeX 渲染
    if (/^\s*\$\$/.test(line)) {
      flushPara(); flushList();
      let body = line.replace(/^\s*\$\$/, '');
      const closeSame = body.indexOf('$$');
      if (closeSame !== -1) {
        body = body.slice(0, closeSame);
        i++;
      } else {
        const buf = [body];
        i++;
        while (i < lines.length) {
          const idx = lines[i].indexOf('$$');
          if (idx !== -1) { buf.push(lines[i].slice(0, idx)); i++; break; }
          buf.push(lines[i]); i++;
        }
        body = buf.join('\n');
      }
      out.push('<div class="md-math">$$' + escapeHtml(body) + '$$</div>');
      continue;
    }

    if (!line.trim()) { flushPara(); flushList(); i++; continue; }

    if (HR.test(line)) { flushPara(); flushList(); out.push('<hr>'); i++; continue; }

    const h = line.match(HEADING);
    if (h) {
      flushPara(); flushList();
      const lv = h[1].length;
      out.push('<h' + lv + '>' + renderInlineMarkdown(h[2].trim()) + '</h' + lv + '>');
      i++; continue;
    }

    if (QUOTE.test(line)) {
      flushPara(); flushList();
      const buf = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        buf.push(lines[i].replace(QUOTE, ''));
        i++;
      }
      out.push('<blockquote>' + renderMarkdown(buf.join('\n')) + '</blockquote>');
      continue;
    }

    const ul = line.match(UL);
    const ol = line.match(OL);
    if (ul || ol) {
      flushPara();
      const type = ul ? 'ul' : 'ol';
      if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push((ul ? ul[1] : ol[1]).trim());
      i++; continue;
    }

    flushList();
    para.push(line);
    i++;
  }

  flushPara(); flushList();
  return out.join('\n');
}
