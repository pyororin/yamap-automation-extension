document.addEventListener('DOMContentLoaded', () => {
  const action1Button = document.getElementById('action-1');
  const action2Button = document.getElementById('action-2');
  const action3Button = document.getElementById('action-3');
  const stopButton = document.getElementById('stop-button');
  const statusArea = document.getElementById('status-area');

  // ボタンクリック時の処理
  action1Button.addEventListener('click', () => {
    sendMessageToBackground({ action: 'start', task: 'action1' });
  });

  action2Button.addEventListener('click', () => {
    sendMessageToBackground({ action: 'start', task: 'action2' });
  });

  action3Button.addEventListener('click', () => {
    sendMessageToBackground({ action: 'start', task: 'action3' });
  });

  stopButton.addEventListener('click', () => {
    sendMessageToBackground({ action: 'stop' });
  });

  // background.jsにメッセージを送信する関数
  function sendMessageToBackground(message) {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        statusArea.textContent = 'エラー: 拡張機能の再読み込みが必要です。';
        console.error(chrome.runtime.lastError.message);
      } else if (response) {
        updateStatus(response.status);
      }
    });
  }

  // background.jsからメッセージを受信してステータスを更新
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'status_update') {
      updateStatus(message.status);
    }
  });

  // ステータス表示を更新する関数
  function updateStatus(statusText) {
    statusArea.textContent = statusText;
  }

  // ポップアップ表示時に現在の状態を問い合わせる
  sendMessageToBackground({ action: 'getStatus' });
});