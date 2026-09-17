// TextCapture 文字捕获 - 后台 Service Worker

// 点击工具栏图标时打开侧边栏
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
});

// 兜底：若行为设置未生效，手动打开侧边栏
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (e) {
    // 部分页面（chrome://、edge://）无法打开，忽略
  }
});

// 处理截图请求（用于"图片：截图嵌入"模式）
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'TEXTCAPTURE_CAPTURE') {
    chrome.tabs.captureVisibleTab(msg.windowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true, dataUrl });
      }
    });
    return true; // 异步响应
  }
});
