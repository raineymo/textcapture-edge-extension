// TextCapture 文字捕获 - 侧边栏逻辑
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var btnExtract = $('btnExtract');
  var btnCopy = $('btnCopy');
  var btnExportMd = $('btnExportMd');
  var btnExportTxt = $('btnExportTxt');
  var imageModeSel = $('imageMode');
  var toggleRaw = $('toggleRaw');
  var statusEl = $('status');
  var contentEl = $('content');
  var rawEl = $('raw');

  var currentMarkdown = '';
  var currentTitle = '';

  function setStatus(text, type) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (type ? ' ' + type : '');
  }

  // ---------- 与页面通信 ----------

  function getActiveTab() {
    return new Promise(function (resolve, reject) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!tabs || !tabs.length) return reject(new Error('未找到活动标签页'));
        resolve(tabs[0]);
      });
    });
  }

  function sendToTab(tabId, msg) {
    return new Promise(function (resolve, reject) {
      chrome.tabs.sendMessage(tabId, msg, function (resp) {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(resp);
      });
    });
  }

  function injectContentScript(tabId) {
    return new Promise(function (resolve, reject) {
      chrome.scripting.executeScript(
        { target: { tabId: tabId }, files: ['content.js'] },
        function () {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve();
        }
      );
    });
  }

  function captureTab(windowId) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: 'TEXTCAPTURE_CAPTURE', windowId: windowId }, function (resp) {
        if (chrome.runtime.lastError || !resp || !resp.ok) {
          resolve(null);
        } else {
          resolve(resp.dataUrl);
        }
      });
    });
  }

  // 从整页截图中裁剪出单个图片区域
  function cropImage(pageShot, rect, dpr) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          // 截图按设备像素，rect 按 CSS 像素 -> 乘以 dpr
          var sx = Math.round(rect.x * dpr);
          var sy = Math.round(rect.y * dpr);
          var sw = Math.round(rect.width * dpr);
          var sh = Math.round(rect.height * dpr);
          sw = Math.min(sw, img.naturalWidth - sx);
          sh = Math.min(sh, img.naturalHeight - sy);
          if (sw <= 0 || sh <= 0) return resolve(null);
          var canvas = document.createElement('canvas');
          canvas.width = sw;
          canvas.height = sh;
          canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = function () { resolve(null); };
      img.src = pageShot;
    });
  }

  // ---------- 提取主流程 ----------

  async function extract() {
    btnExtract.classList.add('loading');
    btnExtract.textContent = '提取中…';
    setStatus('正在连接页面…');
    try {
      var tab = await getActiveTab();
      if (!tab.url || /^(chrome|edge|about|chrome-extension|edge-extension|devtools):/.test(tab.url) ||
          /^(https?:\/\/)?(chrome\.google\.com\/webstore|microsoftedge\.microsoft\.com)/.test(tab.url)) {
        throw new Error('浏览器内部页面或扩展商店页面不支持提取');
      }

      // 确保 content.js 已注入
      var pinged = false;
      try {
        var pong = await sendToTab(tab.id, { type: 'TEXTCAPTURE_PING' });
        pinged = pong && pong.ok;
      } catch (e) { /* 未注入 */ }
      if (!pinged) {
        setStatus('正在注入提取脚本…');
        await injectContentScript(tab.id);
      }

      setStatus('正在解析页面内容…');
      var result = await sendToTab(tab.id, {
        type: 'TEXTCAPTURE_EXTRACT',
        imageMode: imageModeSel.value
      });
      if (!result || !result.ok) {
        throw new Error((result && result.error) || '提取失败');
      }

      var markdown = result.markdown;

      // 截图嵌入模式：截取可视区域并裁剪出图片
      if (imageModeSel.value === 'screenshot' && result.images && result.images.length) {
        setStatus('正在截取页面图片（' + result.images.length + ' 张）…');
        var shot = await captureTab(tab.windowId);
        if (shot) {
          for (var i = 0; i < result.images.length; i++) {
            var info = result.images[i];
            var dataUrl = await cropImage(shot, info.rect, result.dpr || 1);
            var replacement = dataUrl ? '![图片](' + dataUrl + ')' : '[图片]';
            markdown = markdown.split('{{' + info.token + '}}').join(replacement);
          }
        } else {
          markdown = markdown.replace(/\{\{IMGCAP_\d+\}\}/g, '[图片]');
        }
      }

      if (!markdown) {
        setStatus('未提取到可见文本内容', 'error');
        btnExtract.classList.remove('loading');
        btnExtract.textContent = '一键提取';
        return;
      }

      currentMarkdown = markdown;
      currentTitle = (result.title || 'extract').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
      renderResult(markdown);
      setStatus('提取完成 · ' + result.chars + ' 字符 · 来源：' + (result.title || result.url), 'ok');
      [btnCopy, btnExportMd, btnExportTxt].forEach(function (b) { b.disabled = false; });
    } catch (e) {
      setStatus('提取失败：' + e.message, 'error');
    }
    btnExtract.classList.remove('loading');
    btnExtract.textContent = '一键提取';
  }

  // ---------- Markdown 渲染 ----------

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function inlineRender(text) {
    var t = escapeHtml(text);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, alt, src) {
      return '<img alt="' + alt + '" src="' + src + '" loading="lazy" onerror="this.outerHTML=\'<span>[图片加载失败]</span>\'">';
    });
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return t;
  }

  function parseCells(row) {
    return row.replace(/^\s*\|/, '').replace(/\|\s*$/, '')
      .split(/(?<!\\)\|/)
      .map(function (c) { return c.trim().replace(/\\\|/g, '|'); });
  }

  function isBlockStart(line) {
    return /^(#{1,6}\s|```|>|\s*([-*+]|\d+\.)\s|\||---\s*$)/.test(line);
  }

  function renderMarkdown(md) {
    var lines = md.split('\n');
    var html = '';
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];

      // 代码块
      if (/^```/.test(line)) {
        var buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        html += '<pre><code>' + escapeHtml(buf.join('\n')) + '</code></pre>';
        continue;
      }

      // 标题
      var hm = line.match(/^(#{1,6})\s+(.*)$/);
      if (hm) {
        var lvl = hm[1].length;
        html += '<h' + lvl + '>' + inlineRender(hm[2]) + '</h' + lvl + '>';
        i++; continue;
      }

      // 表格
      if (/^\s*\|/.test(line)) {
        var rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        if (rows.length >= 2) {
          var head = parseCells(rows[0]);
          html += '<table><thead><tr>' + head.map(function (c) { return '<th>' + inlineRender(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
          rows.slice(2).forEach(function (r) {
            html += '<tr>' + parseCells(r).map(function (c) { return '<td>' + inlineRender(c) + '</td>'; }).join('') + '</tr>';
          });
          html += '</tbody></table>';
        }
        continue;
      }

      // 引用
      if (/^>\s?/.test(line)) {
        var qbuf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { qbuf.push(lines[i].replace(/^>\s?/, '')); i++; }
        html += '<blockquote>' + renderMarkdown(qbuf.join('\n')) + '</blockquote>';
        continue;
      }

      // 列表（支持缩进嵌套）
      if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
        var items = [];
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s/.test(lines[i])) {
          var lm = lines[i].match(/^(\s*)([-*+]|(\d+)\.)\s+(.*)$/);
          items.push({
            indent: Math.floor(lm[1].length / 2),
            ordered: /^\d/.test(lm[2]),
            text: lm[4]
          });
          i++;
        }
        var stack = [];
        items.forEach(function (it) {
          while (stack.length && it.indent < stack[stack.length - 1].indent) {
            html += stack.pop().ordered ? '</ol>' : '</ul>';
          }
          if (!stack.length || it.indent > stack[stack.length - 1].indent ||
              it.ordered !== stack[stack.length - 1].ordered) {
            if (stack.length && it.indent === stack[stack.length - 1].indent) {
              html += stack.pop().ordered ? '</ol>' : '</ul>';
            }
            html += it.ordered ? '<ol>' : '<ul>';
            stack.push({ indent: it.indent, ordered: it.ordered });
          }
          html += '<li>' + inlineRender(it.text) + '</li>';
        });
        while (stack.length) html += stack.pop().ordered ? '</ol>' : '</ul>';
        continue;
      }

      // 分隔线
      if (/^---\s*$/.test(line)) { html += '<hr>'; i++; continue; }

      // 空行
      if (!line.trim()) { i++; continue; }

      // 普通段落
      var pbuf = [];
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) { pbuf.push(lines[i]); i++; }
      html += '<p>' + inlineRender(pbuf.join(' ')) + '</p>';
    }
    return html;
  }

  function renderResult(markdown) {
    contentEl.classList.remove('empty');
    contentEl.innerHTML = renderMarkdown(markdown);
    rawEl.textContent = markdown;
  }

  // ---------- Markdown -> 纯文本 ----------

  function markdownToText(md) {
    var out = md
      .replace(/```[\s\S]*?```/g, function (m) { return m.replace(/```/g, ''); })
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '[图片]')
      .replace(/\[([^\]]+)\]\(([^)]*)\)/g, '$1（$2）')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^>\s?/gm, '')
      .replace(/^---$/gm, '——————')
      .replace(/\\\|/g, '|');
    // 表格行：| a | b | -> a\tb；分隔行移除
    out = out.split('\n').map(function (line) {
      if (/^\s*\|[\s\-|]+\|\s*$/.test(line)) return null;
      if (/^\s*\|/.test(line)) {
        return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|')
          .map(function (c) { return c.trim(); }).join('\t');
      }
      return line;
    }).filter(function (l) { return l !== null; }).join('\n');
    return out;
  }

  // ---------- 复制与导出 ----------

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) {}
      ta.remove();
      return ok;
    }
  }

  function downloadFile(filename, text, mime) {
    var blob = new Blob(['﻿' + text], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  // ---------- 事件绑定 ----------

  btnExtract.addEventListener('click', extract);

  btnCopy.addEventListener('click', async function () {
    if (!currentMarkdown) return;
    var ok = await copyText(currentMarkdown);
    setStatus(ok ? '已复制 Markdown 到剪贴板' : '复制失败，请手动复制', ok ? 'ok' : 'error');
  });

  btnExportMd.addEventListener('click', function () {
    if (!currentMarkdown) return;
    downloadFile(currentTitle + '.md', currentMarkdown, 'text/markdown');
    setStatus('已导出 ' + currentTitle + '.md', 'ok');
  });

  btnExportTxt.addEventListener('click', function () {
    if (!currentMarkdown) return;
    downloadFile(currentTitle + '.txt', markdownToText(currentMarkdown), 'text/plain');
    setStatus('已导出 ' + currentTitle + '.txt', 'ok');
  });

  toggleRaw.addEventListener('change', function () {
    var showRaw = toggleRaw.checked;
    rawEl.classList.toggle('hidden', !showRaw);
    contentEl.classList.toggle('hidden', showRaw);
  });
})();
