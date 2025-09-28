let stopExecution = false;

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'execute') {
    stopExecution = false;
    executeTask(message.task)
      .then(status => sendResponse({ status: status }))
      .catch(error => {
        console.error(`Task ${message.task} failed:`, error);
        sendResponse({ status: `エラー: ${error.message}` })
      });
  } else if (message.action === 'stop_execution') {
    stopExecution = true;
    chrome.storage.local.clear();
    sendResponse({ status: "停止命令を受け付けました。" });
  }
  return true; // Indicates that the response is sent asynchronously
});

// Main task router
async function executeTask(task) {
  updateStatus(`「${task}」を開始します...`);
  // Clear storage from previous runs before starting a new task
  await chrome.storage.local.remove(['activitiesToProcess', 'currentActivityIndex', 'usersToReact', 'currentUserIndex', 'myUserId', 'timelineActivities', 'currentTimelineIndex', 'a3_activities', 'a3_currentActivityIndex', 'a3_nearbyUsers', 'a3_currentUserIndex']);


  switch (task) {
    case 'action1':
      return await executeAction1();
    case 'action2':
      return await executeAction2();
    case 'action3':
      return await executeAction3();
    default:
      return "不明なタスクです。";
  }
}

// --- Feature 1: リアクションのお返しを実行 ---

async function executeAction1() {
    try {
        if (stopExecution) {
            await chrome.storage.local.clear();
            return "処理が中断されました。";
        }

        const state = await chrome.storage.local.get(['activitiesToProcess', 'currentActivityIndex', 'usersToReact', 'currentUserIndex', 'myUserId']);
        const currentUrl = window.location.href;

        if (!state.activitiesToProcess) {
            if (currentUrl.includes('/users/me/activities') || currentUrl.match(/\/users\/\d+\?tab=activities/)) {
                return await a1_processActivitiesListPage();
            } else {
                updateStatus("活動日記一覧ページに移動します。");
                window.location.href = 'https://yamap.com/users/me/activities';
                return "ページ移動中...";
            }
        }

        if (currentUrl.includes('/reactions')) {
            return await a1_processReactionsPage(state);
        } else if (currentUrl.match(/\/users\/\d+/) && !currentUrl.includes('?tab=activities')) {
            return await a1_processUserProfilePage(state);
        } else if (currentUrl.includes('/activities/') && !currentUrl.includes('/reactions')) {
            return await a1_processTargetActivityPage(state);
        } else {
             return await a1_processNextActivity(state);
        }

    } catch (e) {
        console.error("機能1の実行中にエラーが発生しました:", e);
        updateStatus(`エラーが発生しました: ${e.message}`);
        await chrome.storage.local.clear();
        return `エラーが発生したため処理を停止しました。`;
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
        return "処理完了: 直近7日間の対象日記がありません。";
    }

    const myUserIdMatch = window.location.href.match(/\/users\/(\d+)/);
    const myUserId = myUserIdMatch ? myUserIdMatch[1] : 'me';
    await chrome.storage.local.set({ activitiesToProcess: recentActivities, currentActivityIndex: 0, myUserId: myUserId });

    const reactionsUrl = `${recentActivities[0].split('?')[0]}/reactions`;
    updateStatus(`1件目の日記[${recentActivities[0].split('/').pop()}]のリアクションページに移動します。`);
    window.location.href = reactionsUrl;
    return "ページ移動中...";
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
        return await a1_processNextActivity(state);
    }

    await chrome.storage.local.set({ usersToReact: smileUsers, currentUserIndex: 0 });
    const firstUserUrl = smileUsers[0];
    updateStatus(`1人目の対象ユーザー[${firstUserUrl.split('/').pop()}]のプロフィールに移動します。`);
    window.location.href = firstUserUrl;
    return "ページ移動中...";
}

async function a1_processUserProfilePage(state) {
    updateStatus("ユーザーの最新の活動日記を探しています...");
    await delay(3000);
    const activityListItems = document.querySelectorAll('ul.css-qksbms li');
    if (activityListItems.length === 0) {
        updateStatus("このユーザーは公開された活動日記がありません。");
        return await a1_processNextUser(state);
    }
    const latestActivityLink = activityListItems[0].querySelector('a.css-192jaxu');
    if (!latestActivityLink) {
        updateStatus("最新の活動日記へのリンクが見つかりませんでした。");
        return await a1_processNextUser(state);
    }
    updateStatus(`ユーザーの最新日記[${latestActivityLink.href.split('/').pop()}]に移動します。`);
    window.location.href = latestActivityLink.href;
    return "ページ移動中...";
}

async function a1_processTargetActivityPage(state) {
    updateStatus("リアクション済みか確認しています...");
    await delay(4000);

    const toolBar = document.querySelector('.ActivityToolBar');
    if (!toolBar) {
        updateStatus("ツールバーが見つかりません。スキップします。");
        return await a1_processNextUser(state);
    }

    const thumbsUpButton = toolBar.querySelector('button.emoji-button[data-emoji-key="thumbs_up"]');
    if (!thumbsUpButton) {
        updateStatus("「👍」ボタンが見つかりません。スキップします。");
        return await a1_processNextUser(state);
    }

    if (thumbsUpButton.classList.contains('viewer-has-reacted')) {
        updateStatus("リアクション済みのためスキップします。");
    } else {
        updateStatus("「👍」を送信します...");
        thumbsUpButton.click();
        await delay(Math.random() * 2000 + 3000);
    }

    return await a1_processNextUser(state);
}

async function a1_processNextUser(state) {
    let { usersToReact, currentUserIndex } = state;
    currentUserIndex++;

    if (usersToReact && currentUserIndex < usersToReact.length) {
        await chrome.storage.local.set({ currentUserIndex });
        const nextUserUrl = usersToReact[currentUserIndex];
        updateStatus(`${currentUserIndex + 1}人目のユーザー[${nextUserUrl.split('/').pop()}]のプロフィールに移動します。`);
        window.location.href = nextUserUrl;
        return "ページ移動中...";
    } else {
        return await a1_processNextActivity(state);
    }
}

async function a1_processNextActivity(state) {
    let { activitiesToProcess, currentActivityIndex } = state;
    currentActivityIndex++;

    if (currentActivityIndex < activitiesToProcess.length) {
        await chrome.storage.local.set({ currentActivityIndex, usersToReact: [], currentUserIndex: 0 });
        const nextActivityUrl = activitiesToProcess[currentActivityIndex];
        const reactionsUrl = `${nextActivityUrl.split('?')[0]}/reactions`;
        updateStatus(`${currentActivityIndex + 1}件目の日記[${nextActivityUrl.split('/').pop()}]のリアクションページに移動します。`);
        window.location.href = reactionsUrl;
        return "ページ移動中...";
    } else {
        updateStatus("全ての処理が完了しました。");
        await chrome.storage.local.clear();
        return "リアクションのお返しが完了しました。";
    }
}


// --- 機能2：フォロー中タイムラインを巡回 ---
async function executeAction2() {
  try {
    if (stopExecution) {
        await chrome.storage.local.clear();
        return "処理が中断されました。";
    }

    const state = await chrome.storage.local.get(['timelineActivities', 'currentTimelineIndex']);
    const currentUrl = window.location.href;

    if (!state.timelineActivities) {
        const timelineUrl = "https://yamap.com/search/activities?follow=1";
        if (!currentUrl.startsWith(timelineUrl)) {
             updateStatus("フォロー中タイムラインに移動します...");
             window.location.href = timelineUrl;
             return "ページ移動中...";
        } else {
            return await a2_processTimelineListPage();
        }
    } else {
        return await a2_processTimelineActivityPage(state);
    }
  } catch (e) {
    console.error("機能2の実行中にエラーが発生しました:", e);
    updateStatus(`エラーが発生しました: ${e.message}`);
    await chrome.storage.local.clear();
    return `エラーが発生したため処理を停止しました。`;
  }
}

async function a2_processTimelineListPage() {
    updateStatus("タイムラインの投稿を読み込んでいます...");
    for (let i = 0; i < 3; i++) {
        window.scrollTo(0, document.body.scrollHeight);
        await delay(2500);
    }

    const activityListItems = document.querySelectorAll('ul.css-qksbms li article[data-testid="activity-entry"]');
    if (activityListItems.length === 0) {
        return "処理完了: タイムラインに投稿がありません。";
    }

    const activitiesToProcess = [];
    for (const item of activityListItems) {
        const linkElement = item.querySelector('a.css-192jaxu');
        if (linkElement && !item.querySelector('.css-1u2dfat')) {
            activitiesToProcess.push(linkElement.href);
        }
    }

    if (activitiesToProcess.length === 0) {
        return "処理完了: 処理対象の投稿が見つかりませんでした。";
    }

    updateStatus(`${activitiesToProcess.length}件の投稿を処理します。`);
    await chrome.storage.local.set({ timelineActivities: activitiesToProcess, currentTimelineIndex: 0 });

    window.location.href = activitiesToProcess[0];
    return "1件目の投稿に移動します...";
}

async function a2_processTimelineActivityPage(state) {
    let { timelineActivities, currentTimelineIndex } = state;

    if (window.location.href.includes('/activities/')) {
        updateStatus(`${currentTimelineIndex + 1}件目の投稿を処理中...`);
        await delay(3000);

        const toolBar = document.querySelector('.ActivityToolBar');
        if (toolBar) {
            const thumbsUpButton = toolBar.querySelector('button.emoji-button[data-emoji-key="thumbs_up"]');
            if (thumbsUpButton && !thumbsUpButton.classList.contains('viewer-has-reacted')) {
                updateStatus("「👍」を送信します...");
                thumbsUpButton.click();
                await delay(Math.random() * 2000 + 2000);
            } else {
                updateStatus("リアクション済み、またはボタンが見つかりません。");
            }
        }
        currentTimelineIndex++;
    }

    if (currentTimelineIndex < timelineActivities.length) {
        await chrome.storage.local.set({ currentTimelineIndex });
        const nextActivityUrl = timelineActivities[currentTimelineIndex];
        updateStatus(`${currentTimelineIndex + 1}件目の投稿に移動します...`);
        window.location.href = nextActivityUrl;
        return "ページ移動中...";
    } else {
        updateStatus("タイムラインの巡回が完了しました。");
        await chrome.storage.local.clear();
        return "タイムラインの巡回が完了しました。";
    }
}


// --- 機能3：「近くにいた人」をフォロー ---
async function executeAction3() {
    try {
        if (stopExecution) {
            await chrome.storage.local.clear();
            return "処理が中断されました。";
        }

        const state = await chrome.storage.local.get(['a3_activities', 'a3_currentActivityIndex', 'a3_nearbyUsers', 'a3_currentUserIndex']);
        const currentUrl = window.location.href;

        if (!state.a3_activities) {
            if (currentUrl.includes('/users/me/activities') || currentUrl.match(/\/users\/\d+\?tab=activities/)) {
                return await a3_processActivitiesListPage();
            } else {
                updateStatus("活動日記一覧ページに移動します。");
                window.location.href = 'https://yamap.com/users/me/activities';
                return "ページ移動中...";
            }
        }

        if (currentUrl.includes('/activities/') && !currentUrl.includes('/reactions')) {
             return await a3_processSingleActivityPage(state);
        }
        else if (currentUrl.match(/\/users\/\d+/) && !currentUrl.includes('?tab=')) {
            return await a3_processUserProfilePage(state);
        }
        else {
            return await a3_processNextActivity(state);
        }

    } catch (e) {
        console.error("機能3の実行中にエラーが発生しました:", e);
        updateStatus(`エラーが発生しました: ${e.message}`);
        await chrome.storage.local.clear();
        return `エラーが発生したため処理を停止しました。`;
    }
}

async function a3_processActivitiesListPage() {
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
        return "処理完了: 直近7日間の対象日記がありません。";
    }

    await chrome.storage.local.set({ a3_activities: recentActivities, a3_currentActivityIndex: 0 });
    updateStatus(`1件目の日記[${recentActivities[0].split('/').pop()}]に移動します。`);
    window.location.href = recentActivities[0];
    return "ページ移動中...";
}

async function a3_processSingleActivityPage(state) {
    updateStatus("「近くにいた人」を探しています...");
    await delay(4000);

    const nearbySection = Array.from(document.querySelectorAll('h2.ActivitiesId__HeadingInline'))
                               .find(h2 => h2.textContent.trim() === '近くにいた人');

    if (!nearbySection) {
        updateStatus("「近くにいた人」セクションが見つかりません。");
        return await a3_processNextActivity(state);
    }

    const parentSection = nearbySection.closest('section.ActivitiesId__Section');
    const userLinks = parentSection.querySelectorAll('a.ActivitiesId__UserLink__Avatar');

    const nearbyUsers = Array.from(userLinks).map(a => a.href);

    if (nearbyUsers.length === 0) {
        updateStatus("「近くにいた人」はいませんでした。");
        return await a3_processNextActivity(state);
    }

    updateStatus(`${nearbyUsers.length}人の「近くにいた人」を見つけました。`);
    await chrome.storage.local.set({ a3_nearbyUsers: nearbyUsers, a3_currentUserIndex: 0 });

    const firstUserUrl = nearbyUsers[0];
    updateStatus(`1人目のユーザー[${firstUserUrl.split('/').pop()}]のプロフィールに移動します。`);
    window.location.href = firstUserUrl;
    return "ページ移動中...";
}

async function a3_processUserProfilePage(state) {
    updateStatus("ユーザーのフォロー情報を確認しています...");
    await delay(3000);

    const followsElement = document.querySelector('a[href*="tab=follows"] span.UsersId__Tab__Count');
    const followersElement = document.querySelector('a[href*="tab=followers"] span.UsersId__Tab__Count');

    if (!followsElement || !followersElement) {
        updateStatus("フォロー/フォロワー数が見つかりません。");
        return await a3_processNextUser(state);
    }

    const followsCount = parseInt(followsElement.textContent, 10);
    const followersCount = parseInt(followersElement.textContent, 10);

    updateStatus(`フォロー: ${followsCount}, フォロワー: ${followersCount}`);

    const followButton = document.querySelector('button.FollowButton');
    if (!followButton) {
        updateStatus("フォローボタンが見つかりません。");
        return await a3_processNextUser(state);
    }

    const isNotFollowing = followButton.textContent.trim() === 'フォローする';
    const condition1 = followsCount >= 10;
    const condition2 = followsCount > followersCount;

    if (condition1 && condition2 && isNotFollowing) {
        updateStatus("フォロー条件を満たしました。フォローします。");
        followButton.click();
        await delay(Math.random() * 2000 + 3000);
    } else {
        let skipReason = "フォロー条件を満たしませんでした：";
        if (!condition1) skipReason += " フォロー数10人未満";
        if (!condition2) skipReason += " フォロワー数がフォロー数以上";
        if (!isNotFollowing) skipReason += " フォロー済み";
        updateStatus(skipReason + "。スキップします。");
    }

    return await a3_processNextUser(state);
}

async function a3_processNextUser(state) {
    let { a3_nearbyUsers, a3_currentUserIndex } = state;
    a3_currentUserIndex++;

    if (a3_nearbyUsers && a3_currentUserIndex < a3_nearbyUsers.length) {
        await chrome.storage.local.set({ a3_currentUserIndex });
        const nextUserUrl = a3_nearbyUsers[a3_currentUserIndex];
        updateStatus(`${a3_currentUserIndex + 1}人目のユーザー[${nextUserUrl.split('/').pop()}]のプロフィールに移動します。`);
        window.location.href = nextUserUrl;
        return "ページ移動中...";
    } else {
        return await a3_processNextActivity(state);
    }
}

async function a3_processNextActivity(state) {
    let { a3_activities, a3_currentActivityIndex } = state;
    a3_currentActivityIndex++;

    if (a3_currentActivityIndex < a3_activities.length) {
        await chrome.storage.local.set({ a3_currentActivityIndex, a3_nearbyUsers: null, a3_currentUserIndex: 0 });
        const nextActivityUrl = a3_activities[a3_currentActivityIndex];
        updateStatus(`${a3_currentActivityIndex + 1}件目の日記[${nextActivityUrl.split('/').pop()}]に移動します。`);
        window.location.href = nextActivityUrl;
        return "ページ移動中...";
    } else {
        updateStatus("全ての処理が完了しました。");
        await chrome.storage.local.clear();
        return "「近くにいた人」のフォロー処理が完了しました。";
    }
}


// --- 共通関数 ---
function updateStatus(status) {
  chrome.runtime.sendMessage({ action: 'update_status', status: status });
}

const delay = (ms) => new Promise(resolve => {
    if(stopExecution) return;
    setTimeout(resolve, ms)
});