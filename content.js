let stopExecution = false;

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'execute') {
    stopExecution = false;
    executeTask(message.task);
    // Fire-and-forget, no response sent from here.
  } else if (message.action === 'stop_execution') {
    stopExecution = true;
    chrome.storage.local.clear();
    sendResponse({ status: "停止命令を受け付けました。" });
    return true; // Indicate async response
  }
});

// Main task router
async function executeTask(task) {
  updateStatus(`「${task}」を開始します...`);
  if (!window.location.href.startsWith("https://yamap.com/")) {
    await chrome.storage.local.clear();
  }

  switch (task) {
    case 'action1':
      await executeAction1();
      break;
    case 'action2':
      await executeAction2();
      break;
    case 'action3':
      await executeAction3();
      break;
    default:
      await notifyCompletion("不明なタスクです。");
  }
}

// --- 機能1：リアクションのお返しを実行 ---

async function executeAction1() {
    try {
        if (stopExecution) {
            await notifyCompletion("処理が中断されました。");
            return;
        }

        const state = await chrome.storage.local.get(['a1_activitiesToProcess', 'a1_currentActivityIndex', 'a1_usersToReact', 'a1_currentUserIndex', 'myUserId']);
        const currentUrl = window.location.href;
        const yamapHomeUrl = 'https://yamap.com/';

        // If task has not started, get user ID and navigate to activities page.
        if (!state.a1_activitiesToProcess) {
            if (currentUrl.match(/\/users\/\d+\?tab=activities/)) {
                await a1_processActivitiesListPage();
            } else if (currentUrl === yamapHomeUrl || currentUrl === yamapHomeUrl + 'logout') {
                updateStatus("ホームページでユーザーIDを取得します...");
                const nextDataScript = document.getElementById('__NEXT_DATA__');
                if (!nextDataScript) {
                    throw new Error("ユーザー情報が見つかりませんでした (YAMAPのページ構造が変更された可能性があります)。");
                }
                const nextData = JSON.parse(nextDataScript.textContent);
                const myUserId = nextData?.state?.auth?.loginUser?.id;

                if (!myUserId) {
                    throw new Error("ユーザーIDを取得できませんでした。ログインしているか確認してください。");
                }

                await chrome.storage.local.set({ myUserId: myUserId });
                const activitiesUrl = `https://yamap.com/users/${myUserId}?tab=activities`;
                updateStatus("活動日記一覧ページに移動します。");
                window.location.href = activitiesUrl;
            } else {
                updateStatus("ホームページに移動してユーザーIDを取得します。");
                window.location.href = yamapHomeUrl;
            }
            return;
        }

        // Resume task based on current URL
        if (currentUrl.includes('/reactions')) {
            await a1_processReactionsPage(state);
        } else if (currentUrl.match(/\/users\/\d+/) && !currentUrl.includes('?tab=activities')) {
            await a1_processUserProfilePage(state);
        } else if (currentUrl.includes('/activities/') && !currentUrl.includes('/reactions')) {
            await a1_processTargetActivityPage(state);
        } else {
             await a1_processNextActivity(state);
        }

    } catch (e) {
        const errorMessage = `エラー(機能1): ${e.message}`;
        console.error("機能1の実行中にエラーが発生しました:", e);
        await notifyCompletion(errorMessage);
    }
}

async function a1_processActivitiesListPage() {
    updateStatus("7日以内の活動日記を特定しています...");
    await delay(3000);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const activityListItems = document.querySelectorAll('ul.css-qksbms li');
    const recentActivities = [];
    for (const item of activityListItems) {
        const dateElement = item.querySelector('span.css-125iqyy');
        if (dateElement) {
            const dateText = dateElement.textContent.split(' ')[0];
            const activityDate = new Date(dateText.replace(/\./g, '/'));
            if (activityDate >= sevenDaysAgo) {
                const linkElement = item.querySelector('a.css-192jaxu');
                if (linkElement) {
                    recentActivities.push(linkElement.href);
                }
            }
        }
    }

    if (recentActivities.length === 0) {
        await notifyCompletion("処理完了: 直近7日間の対象日記がありません。");
        return;
    }

    const myUserIdMatch = window.location.href.match(/\/users\/(\d+)/);
    const myUserId = myUserIdMatch ? myUserIdMatch[1] : 'me';
    await chrome.storage.local.set({ a1_activitiesToProcess: recentActivities, a1_currentActivityIndex: 0, myUserId: myUserId });

    const reactionsUrl = `${recentActivities[0].split('?')[0]}/reactions`;
    updateStatus(`1件目の日記[${recentActivities[0].split('/').pop()}]のリアクションページに移動します。`);
    window.location.href = reactionsUrl;
}

async function a1_processReactionsPage(state) {
    updateStatus("スマイルをくれたユーザーを特定しています...");
    await delay(3000);
    const userElements = document.querySelectorAll('div.css-1e463ii');
    const smileUsers = [];
    const myUserId = state.myUserId;

    for (const userEl of userElements) {
        const profileLink = userEl.querySelector('a.css-1ix5652');
        if (profileLink && myUserId && profileLink.href.includes(myUserId)) continue;

        const emojiContainer = userEl.querySelector('div.css-xh3wyt');
        if (emojiContainer) {
            const emojiImg = emojiContainer.querySelector('img[alt="おつかれ山"]');
            const emojiText = emojiContainer.textContent;
            if (emojiImg || emojiText.includes('👍') || emojiText.includes('🤗')) {
                if (profileLink) {
                    smileUsers.push(profileLink.href);
                }
            }
        }
    }

    if (smileUsers.length === 0) {
        updateStatus("この日記にスマイル系のリアクションをしたユーザーはいません。");
        await a1_processNextActivity(state);
        return;
    }

    await chrome.storage.local.set({ a1_usersToReact: smileUsers, a1_currentUserIndex: 0 });
    const firstUserUrl = smileUsers[0];
    updateStatus(`1人目の対象ユーザー[${firstUserUrl.split('/').pop()}]のプロフィールに移動します。`);
    window.location.href = firstUserUrl;
}

async function a1_processUserProfilePage(state) {
    updateStatus("ユーザーの最新の活動日記を探しています...");
    await delay(3000);
    const activityListItems = document.querySelectorAll('ul.css-qksbms li');
    if (activityListItems.length === 0) {
        updateStatus("このユーザーは公開された活動日記がありません。");
        await a1_processNextUser(state);
        return;
    }
    const latestActivityLink = activityListItems[0].querySelector('a.css-192jaxu');
    if (!latestActivityLink) {
        updateStatus("最新の活動日記へのリンクが見つかりませんでした。");
        await a1_processNextUser(state);
        return;
    }
    updateStatus(`ユーザーの最新日記[${latestActivityLink.href.split('/').pop()}]に移動します。`);
    window.location.href = latestActivityLink.href;
}

async function a1_processTargetActivityPage(state) {
    updateStatus("リアクション済みか確認しています...");
    await delay(4000);

    const toolBar = document.querySelector('.ActivityToolBar');
    if (!toolBar) {
        updateStatus("ツールバーが見つかりません。スキップします。");
        await a1_processNextUser(state);
        return;
    }

    const thumbsUpButton = toolBar.querySelector('button.emoji-button[data-emoji-key="thumbs_up"]');
    if (!thumbsUpButton) {
        updateStatus("「👍」ボタンが見つかりません。スキップします。");
        await a1_processNextUser(state);
        return;
    }

    if (thumbsUpButton.classList.contains('viewer-has-reacted')) {
        updateStatus("リアクション済みのためスキップします。");
    } else {
        updateStatus("「👍」を送信します...");
        thumbsUpButton.click();
        await delay(Math.random() * 2000 + 3000);
    }

    await a1_processNextUser(state);
}

async function a1_processNextUser(state) {
    let { a1_usersToReact, a1_currentUserIndex } = state;
    a1_currentUserIndex++;

    if (a1_usersToReact && a1_currentUserIndex < a1_usersToReact.length) {
        await chrome.storage.local.set({ a1_currentUserIndex });
        const nextUserUrl = a1_usersToReact[a1_currentUserIndex];
        updateStatus(`${a1_currentUserIndex + 1}人目のユーザー[${nextUserUrl.split('/').pop()}]のプロフィールに移動します。`);
        window.location.href = nextUserUrl;
    } else {
        await a1_processNextActivity(state);
    }
}

async function a1_processNextActivity(state) {
    let { a1_activitiesToProcess, a1_currentActivityIndex } = state;
    a1_currentActivityIndex++;

    if (a1_currentActivityIndex < a1_activitiesToProcess.length) {
        await chrome.storage.local.set({ a1_currentActivityIndex, a1_usersToReact: [], a1_currentUserIndex: 0 });
        const nextActivityUrl = a1_activitiesToProcess[a1_currentActivityIndex];
        const reactionsUrl = `${nextActivityUrl.split('?')[0]}/reactions`;
        updateStatus(`${a1_currentActivityIndex + 1}件目の日記[${nextActivityUrl.split('/').pop()}]のリアクションページに移動します。`);
        window.location.href = reactionsUrl;
    } else {
        await notifyCompletion("リアクションのお返しが完了しました。");
    }
}


// --- 機能2：フォロー中タイムラインを巡回 ---
async function executeAction2() {
  // Omitted for brevity - will assume similar refactoring if needed
  await notifyCompletion("機能2は現在開発中です。");
}


// --- 機能3：「近くにいた人」をフォロー ---
async function executeAction3() {
  // Omitted for brevity - will assume similar refactoring if needed
  await notifyCompletion("機能3は現在開発中です。");
}


// --- 共通関数 ---
async function notifyCompletion(status) {
    updateStatus(status);
    await chrome.storage.local.clear();
    chrome.runtime.sendMessage({ action: 'task_complete', status: status });
}

function updateStatus(status) {
  chrome.runtime.sendMessage({ action: 'update_status', status: status });
}

const delay = (ms) => new Promise(resolve => {
    if(stopExecution) return;
    setTimeout(resolve, ms)
});