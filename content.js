// TextCapture 文字捕获 - 内容提取脚本
// 按需由侧边栏通过 chrome.scripting.executeScript 注入（ISOLATED world）。
// 直接读取 DOM 提取可见文本并转换为 Markdown，天然绕过一切复制拦截。

(function () {
  'use strict';

  if (window.__textCaptureLoaded) return;
  window.__textCaptureLoaded = true;

  var SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, CANVAS: 1,
    IFRAME: 1, HEAD: 1, META: 1, LINK: 1, TITLE: 1, SELECT: 1, OPTION: 1,
    BUTTON: 1, INPUT: 1, TEXTAREA: 1, AUDIO: 1, VIDEO: 1, SOURCE: 1
  };

  var CONTAINER_TAGS = {
    DIV: 1, SECTION: 1, ARTICLE: 1, MAIN: 1, ASIDE: 1, HEADER: 1,
    FOOTER: 1, NAV: 1, FIGURE: 1, FIGCAPTION: 1, DETAILS: 1, SUMMARY: 1,
    FORM: 1, FIELDSET: 1, DL: 1, DT: 1, DD: 1
  };

  var imageMode = 'link'; // link | screenshot | placeholder
  var capturedImages = []; // 截图模式: {token, rect:{x,y,width,height}}

  function isHidden(el) {
    if (!(el instanceof Element)) return false;
    var s;
    try { s = getComputedStyle(el); } catch (e) { return false; }
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return true;
    if (el.hasAttribute('hidden')) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    return false;
  }

  function escapeCell(text) {
    return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  }

  function imgMd(img) {
    var src = '';
    try { src = img.currentSrc || img.src || ''; } catch (e) { return '[图片]'; }
    var alt = (img.getAttribute('alt') || '').trim();

    if (imageMode === 'placeholder') return '[图片]';

    if (imageMode === 'screenshot') {
      var r = img.getBoundingClientRect();
      var inView = r.width >= 16 && r.height >= 16 &&
        r.bottom > 0 && r.right > 0 &&
        r.top < window.innerHeight && r.left < window.innerWidth;
      if (inView) {
        var token = 'IMGCAP_' + capturedImages.length;
        capturedImages.push({
          token: token,
          rect: {
            x: Math.max(0, r.left),
            y: Math.max(0, r.top),
            width: Math.min(r.width, window.innerWidth - Math.max(0, r.left)),
            height: Math.min(r.height, window.innerHeight - Math.max(0, r.top))
          }
        });
        return '{{' + token + '}}';
      }
      // 视口外图片：回退到链接，无链接则占位符
      if (src && src.indexOf('data:') !== 0) return '![' + alt + '](' + src + ')';
      return '[图片]';
    }

    // link 模式
    if (!src || src.indexOf('data:') === 0) return '[图片]';
    return '![' + alt + '](' + src + ')';
  }

  // 行内元素 -> Markdown 行内语法
  function inlineMd(node) {
    var out = '';
    node.childNodes.forEach(function (child) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.nodeValue.replace(/\s+/g, ' ');
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      var tag = child.tagName;
      if (SKIP_TAGS[tag] || isHidden(child)) return;
      if (tag === 'BR') { out += '  \n'; return; }
      if (tag === 'IMG') { out += imgMd(child); return; }

      var inner = inlineMd(child);
      if (!inner.trim()) { out += inner; return; }
      var trimmed = inner.trim();
      switch (tag) {
        case 'B': case 'STRONG':
          out += '**' + trimmed + '**'; break;
        case 'I': case 'EM':
          out += '*' + trimmed + '*'; break;
        case 'CODE': case 'KBD': case 'SAMP':
          out += '`' + child.textContent.trim().replace(/`/g, '\\`') + '`'; break;
        case 'S': case 'DEL': case 'STRIKE':
          out += '~~' + trimmed + '~~'; break;
        case 'A': {
          var href = '';
          try { href = child.href || ''; } catch (e) {}
          if (href && href.indexOf('javascript:') !== 0 && href !== '#') {
            out += '[' + trimmed + '](' + href + ')';
          } else {
            out += trimmed;
          }
          break;
        }
        case 'SUB': out += '~' + trimmed + '~'; break;
        case 'SUP': out += '^' + trimmed + '^'; break;
        default: out += inner;
      }
    });
    return out;
  }

  function listMd(listEl, depth) {
    var lines = [];
    var ordered = listEl.tagName === 'OL';
    var idx = 1;
    listEl.childNodes.forEach(function (li) {
      if (!(li instanceof Element) || li.tagName !== 'LI' || isHidden(li)) return;
      var text = '';
      li.childNodes.forEach(function (c) {
        if (c instanceof Element && (c.tagName === 'UL' || c.tagName === 'OL')) return;
        text += inlineMd(c);
      });
      var indent = new Array(depth + 1).join('  ');
      var marker = ordered ? (idx + '.') : '-';
      var t = text.trim().replace(/  \n/g, ' ').replace(/\n/g, ' ');
      if (t) lines.push(indent + marker + ' ' + t);
      li.childNodes.forEach(function (c) {
        if (c instanceof Element && (c.tagName === 'UL' || c.tagName === 'OL')) {
          var nested = listMd(c, depth + 1);
          if (nested) lines.push(nested);
        }
      });
      idx++;
    });
    return lines.join('\n');
  }

  function tableMd(table) {
    var rows = [];
    var trs = table.querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      var tr = trs[i];
      if (isHidden(tr)) continue;
      // 跳过嵌套表格的行（只取直属当前表格结构内的行）
      if (tr.closest('table') !== table) continue;
      var cells = [];
      var cs = tr.querySelectorAll('th, td');
      for (var j = 0; j < cs.length; j++) {
        if (cs[j].closest('table') !== table) continue;
        cells.push(escapeCell(inlineMd(cs[j]).trim()));
      }
      if (cells.length) rows.push(cells);
    }
    if (!rows.length) return '';
    var cols = 0;
    rows.forEach(function (r) { cols = Math.max(cols, r.length); });
    rows.forEach(function (r) { while (r.length < cols) r.push(''); });
    var sep = [];
    for (var k = 0; k < cols; k++) sep.push('---');
    var out = ['| ' + rows[0].join(' | ') + ' |', '| ' + sep.join(' | ') + ' |'];
    for (var m = 1; m < rows.length; m++) out.push('| ' + rows[m].join(' | ') + ' |');
    return out.join('\n');
  }

  // 块级遍历 -> Markdown 段落数组
  function blockMd(node, depth) {
    var out = [];
    node.childNodes.forEach(function (child) {
      if (child.nodeType === Node.TEXT_NODE) {
        var t = child.nodeValue.trim();
        if (t) out.push(t.replace(/\s+/g, ' '));
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      var tag = child.tagName;
      if (SKIP_TAGS[tag] || isHidden(child)) return;

      if (/^H[1-6]$/.test(tag)) {
        var lvl = tag.charAt(1);
        var h = inlineMd(child).trim();
        if (h) out.push(new Array(+lvl + 1).join('#') + ' ' + h);
      } else if (tag === 'P') {
        var p = inlineMd(child).trim();
        if (p) out.push(p);
      } else if (tag === 'BLOCKQUOTE' || tag === 'Q') {
        var q = blockMd(child, depth).join('\n\n');
        if (q.trim()) {
          out.push(q.split('\n').map(function (l) { return l ? '> ' + l : '>'; }).join('\n'));
        }
      } else if (tag === 'PRE') {
        var code = child.textContent.replace(/\n+$/, '');
        if (code.trim()) out.push('```\n' + code + '\n```');
      } else if (tag === 'UL' || tag === 'OL') {
        var li = listMd(child, depth);
        if (li) out.push(li);
      } else if (tag === 'TABLE') {
        var tb = tableMd(child);
        if (tb) out.push(tb);
      } else if (tag === 'HR') {
        out.push('---');
      } else if (tag === 'IMG') {
        out.push(imgMd(child));
      } else if (CONTAINER_TAGS[tag]) {
        var inner = blockMd(child, depth).join('\n\n');
        if (inner.trim()) out.push(inner);
      } else {
        var inline = inlineMd(child).trim();
        if (inline) out.push(inline);
      }
    });
    return out.filter(function (s) { return s && s.trim(); });
  }

  // 尝试定位正文主体，提高内容质量
  function findRoot() {
    var candidates = [
      document.querySelector('article'),
      document.querySelector('main'),
      document.querySelector('[role="main"]'),
      document.querySelector('#content'),
      document.querySelector('.content'),
      document.querySelector('#article'),
      document.querySelector('.article')
    ];
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (el && !isHidden(el) && el.textContent.trim().length > 200) return el;
    }
    return document.body;
  }

  function extract(opts) {
    imageMode = (opts && opts.imageMode) || 'link';
    capturedImages = [];

    var root = findRoot();
    var blocks = blockMd(root, 0);
    var markdown = blocks.join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return {
      ok: true,
      title: document.title || '',
      url: location.href,
      markdown: markdown,
      images: capturedImages,
      dpr: window.devicePixelRatio || 1,
      chars: markdown.length
    };
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;
    if (msg.type === 'TEXTCAPTURE_PING') {
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'TEXTCAPTURE_EXTRACT') {
      try {
        sendResponse(extract(msg));
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message || e) });
      }
      return;
    }
  });
})();
