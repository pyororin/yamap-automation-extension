let isProcessing = false;
let currentTask = null;
let status = "待機中...";

// popup.jsやcontent.jsからのメッセージを受信
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
  } else if (message.action === 'task_complete') {
    // content.jsからの処理完了/エラー通知
    status = message.status;
    isProcessing = false;
    currentTask = null;
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

  // content.jsにタスク開始を指示（応答は待たない「Fire and Forget」）
  chrome.tabs.sendMessage(activeTab.id, { action: 'execute', task: task }, () => {
    if (chrome.runtime.lastError) {
      // コンテンツスクリプトが即座に応答しないのは、ページ遷移などで正常な場合がある。
      // ここでエラーが出ても、コンテンツスクリプトが読み込まれていない初期状態の可能性があるため、
      // 処理は続行させる。ユーザーがページをリロードすれば注入される。
      // 致命的なエラーはcontent.js側で検知し、task_completeメッセージで通知される想定。
      console.log("Could not establish connection with content script. It might not be injected yet.");
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