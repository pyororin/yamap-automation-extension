let isProcessing = false;
let currentTask = null;
let status = "待機中...";
let activeTabId = null; // To track the tab where the task is running

// --- Message Listeners ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'start') {
    handleStart(message.task, sendResponse);
  } else if (message.action === 'stop') {
    handleStop(sendResponse);
  } else if (message.action === 'getStatus') {
    sendResponse({ status: status });
  } else if (message.action === 'update_status') {
    status = message.status;
    updatePopupStatus(status);
  } else if (message.action === 'task_complete') {
    handleTaskComplete(message.status);
  }
  return true; // Keep the message channel open for async responses
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // If a task is running in a specific tab and that tab finishes loading a new page
  if (tabId === activeTabId && changeInfo.status === 'complete' && isProcessing) {
    console.log(`[background.js] Detected page load completion in active tab ${tabId}. Re-injecting script.`);
    // Re-inject the content script to continue the task on the new page
    injectAndExecute(tabId, currentTask);
  }
});

// --- Task Management Functions ---

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

  // Set global state
  isProcessing = true;
  currentTask = task;
  activeTabId = activeTab.id;
  status = "処理を開始します...";
  sendResponse({ status: status });
  updatePopupStatus(status);

  // Clear any old data and start the process
  await chrome.storage.local.clear();
  console.log('[background.js] Cleared storage for a new task.');
  injectAndExecute(activeTab.id, task);
}

function handleStop(sendResponse) {
  if (!isProcessing) {
    sendResponse({ status: "処理は実行されていません。" });
    return;
  }

  // Tell content script to stop (if it's listening)
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, { action: 'stop_execution' });
  }

  // Reset state
  status = "処理を停止しました。";
  isProcessing = false;
  currentTask = null;
  activeTabId = null;

  sendResponse({ status: status });
  updatePopupStatus(status);
}

function handleTaskComplete(finalStatus) {
  console.log(`[background.js] Received task_complete. Final status: ${finalStatus}`);
  status = finalStatus;
  isProcessing = false;
  currentTask = null;
  activeTabId = null; // Stop tracking the tab
  updatePopupStatus(status);
}

function injectAndExecute(tabId, task) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ['content.js']
  }, () => {
    if (chrome.runtime.lastError) {
      const errorMsg = "スクリプトの読み込みに失敗しました: " + chrome.runtime.lastError.message;
      console.error(`[background.js] ${errorMsg}`);
      handleTaskComplete(errorMsg); // End the task with an error
      return;
    }

    // After successful injection, send the message to start or continue the task
    chrome.tabs.sendMessage(tabId, { action: 'execute', task: task }, () => {
      if (chrome.runtime.lastError) {
        // This can happen if the content script immediately navigates.
        // It's not a fatal error because our onUpdated listener will handle the next page.
        console.log("[background.js] Message sending failed, but this is expected during navigation. Error: " + chrome.runtime.lastError.message);
      }
    });
  });
}

// ポップアップのステータス表示を更新する
function updatePopupStatus(newStatus) {
  status = newStatus;
  chrome.runtime.sendMessage({ type: 'status_update', status: status });
}