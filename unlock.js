// TextCapture 文字捕获 - 解除复制限制
// 以 MAIN world 在 document_start 运行，抢在页面脚本注册监听器之前生效。
// 原理：拦截 addEventListener 与 on* 属性赋值，丢弃网站针对
// copy / cut / contextmenu / selectstart / dragstart 的拦截逻辑。

(function () {
  'use strict';

  const BLOCKED_EVENTS = ['copy', 'cut', 'contextmenu', 'selectstart', 'dragstart'];

  // 1) 包装 addEventListener：页面后续注册的相关监听器直接丢弃
  const originalAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (BLOCKED_EVENTS.indexOf(String(type)) !== -1) {
      return; // 静默丢弃防复制监听
    }
    return originalAdd.call(this, type, listener, options);
  };

  // 2) 拦截 oncopy / oncontextmenu 等属性赋值
  BLOCKED_EVENTS.forEach(function (evt) {
    const prop = 'on' + evt;
    [Window.prototype, Document.prototype, HTMLElement.prototype].forEach(function (proto) {
      try {
        Object.defineProperty(proto, prop, {
          configurable: true,
          get: function () { return null; },
          set: function () { /* 吞掉赋值 */ }
        });
      } catch (e) { /* 某些原型不可重定义时忽略 */ }
    });
  });

  // 3) 兜底：捕获阶段拦截，阻止已注册监听器收到事件
  BLOCKED_EVENTS.forEach(function (evt) {
    originalAdd.call(window, evt, function (e) {
      e.stopImmediatePropagation();
      // 注意：不调用 preventDefault，让浏览器默认行为（复制/右键菜单）正常执行
    }, true);
  });

  // 4) 强制允许文本选择（对抗 CSS user-select:none）
  function injectStyle() {
    const css =
      '* { -webkit-user-select: text !important; -moz-user-select: text !important; user-select: text !important; }';
    const style = document.createElement('style');
    style.id = 'textcapture-unlock-style';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }
  if (document.documentElement) {
    injectStyle();
  } else {
    originalAdd.call(document, 'DOMContentLoaded', injectStyle, { once: true });
  }
})();
