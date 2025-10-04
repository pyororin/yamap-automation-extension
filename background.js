let isProcessing = false;
let currentTask = null;
let status = "待機中...";

// popup.jsからのメッセージを受信
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'start') {
    handleStart(message.task, sendResponse);
  } else if (message.action === 'stop') {
    handleStop(sendResponse);
  } else if (message.action === 'getStatus') {
    sendResponse({ status: status });
  } else if (message.action === 'update_status') {
    // content.jsからのステータス更新
    status = message.status;
    updatePopupStatus(status);
  }
  // 非同期レスポンスのためにtrueを返す
  return true;
});

async function handleStart(task, sendResponse) {
  if (isProcessing) {
    sendResponse({ status: `処理中です: ${currentTask}` });
    return;
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];

  if (!activeTab || !activeTab.url || !activeTab.url.startsWith("https://yamap.com/")) {
    status = "YAMAPのページで実行してください。";
    sendResponse({ status: status });
    updatePopupStatus(status);
    return;
  }

  isProcessing = true;
  currentTask = task;
  status = "処理を開始します...";
  sendResponse({ status: status });
  updatePopupStatus(status);

  // content.jsにタスク開始を指示（リトライ処理付き）
  sendMessageWithRetry(activeTab.id, { action: 'execute', task: task });
}

// コンテンツスクリプトへのメッセージ送信（リトライ付き）
function sendMessageWithRetry(tabId, message, retries = 5) {
  chrome.tabs.sendMessage(tabId, message, (response) => {
    if (chrome.runtime.lastError) {
      if (retries > 0) {
        console.log(`Content script not ready, retrying... (${retries} left)`);
        setTimeout(() => sendMessageWithRetry(tabId, message, retries - 1), 500);
      } else {
        console.error("Content script failed to respond after retries.");
        status = "ページの読み込みに失敗しました。ページを再読み込みしてから再度お試しください。";
        isProcessing = false;
        currentTask = null;
        updatePopupStatus(status);
      }
    } else {
        // 処理完了またはエラー時のハンドリング
        isProcessing = false;
        currentTask = null;
        if(response && response.status){
            status = response.status;
        } else {
            // content.jsが非同期でナビゲーションを開始した場合、応答がないことがある
            status = "処理を開始しました。";
        }
        updatePopupStatus(status);
    }
  });
}

function handleStop(sendResponse) {
  if (!isProcessing) {
    sendResponse({ status: "処理は実行されていません。" });
    return;
  }

  isProcessing = false;
  currentTask = null;
  status = "処理を停止しています...";
  sendResponse({ status: status });
  updatePopupStatus(status);

  // content.jsに停止を指示
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if(tabs[0]){
      chrome.tabs.sendMessage(tabs[0].id, { action: 'stop_execution' }, (response) => {
        status = "処理を停止しました。";
        updatePopupStatus(status);
      });
    }
  });
}

// ポップアップのステータス表示を更新する
function updatePopupStatus(newStatus) {
  status = newStatus;
  chrome.runtime.sendMessage({ type: 'status_update', status: status });
}