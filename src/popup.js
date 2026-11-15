'use strict';
async function send(action) {
  const status = document.getElementById('status');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await chrome.tabs.sendMessage(tab.id, { action });
    status.textContent = action === 'caton:toggle' ? `面板已${result.visible ? '显示' : '隐藏'}。` : '已重新扫描可见日志。';
  } catch { status.textContent = '请打开 BGA 卡坦岛对局并刷新页面，再使用资源追踪。'; }
}
document.getElementById('toggle').addEventListener('click', () => send('caton:toggle'));
document.getElementById('scan').addEventListener('click', () => send('caton:scan'));
