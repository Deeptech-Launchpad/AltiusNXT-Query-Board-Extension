// 1. POLLING TIMER (Every 1 minute)
chrome.runtime.onInstalled.addListener(() => {
    console.log("Extension Installed. Starting Alarm...");
    // Create alarm immediately on install
    chrome.alarms.create("notificationPolling", { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "notificationPolling") {
        console.log("Alarm fired. Checking server...");
        checkServerForNotifications();
    }
});

function resolveEmailForBackground(callback) {
    // Chrome/Edge path: use the silent profile API if it exists.
    if (chrome.identity && typeof chrome.identity.getProfileUserInfo === 'function') {
        try {
            chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, function(info) {
                if (info && info.email) {
                    callback(info.email.toLowerCase());
                } else {
                    // Fall back to whatever the popup cached on first sign-in.
                    chrome.storage.local.get(['cachedUserEmail'], function(r) {
                        callback(r && r.cachedUserEmail ? r.cachedUserEmail : null);
                    });
                }
            });
            return;
        } catch (e) { /* fall through */ }
    }
    // Firefox path: no silent identity API. Rely on the popup's cache.
    chrome.storage.local.get(['cachedUserEmail'], function(r) {
        callback(r && r.cachedUserEmail ? r.cachedUserEmail : null);
    });
}

function checkServerForNotifications() {
    resolveEmailForBackground(function(userEmail) {
        if (userEmail) {
            const apiUrl = "https://qb.altiusnxt.tech/api/check_notifications";

            fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userEmail: userEmail })
            })
            .then(res => {
                if (res.status === 404) {
                    throw new Error("Route /api/check_notifications not found (404). Ensure server.py is updated and restarted.");
                }
                if (!res.ok) {
                    throw new Error(`HTTP error! status: ${res.status}`);
                }
                return res.json();
            })
            .then(notifications => {
                if (!notifications || !Array.isArray(notifications)) return;

                const validNotifications = notifications.filter(note => 
                    note.message && note.message.trim() !== ""
                );

                if (validNotifications.length === 0) {
                    updateBadge(""); 
                    return;
                }

                // Update Badge Count
                updateBadge(validNotifications.length.toString());

                // 2. DESKTOP NOTIFICATIONS (Prevents duplicate toasts using storage)
                if (chrome.storage && chrome.storage.local) {
                    chrome.storage.local.get(['shownNotifIds'], (result) => {
                        let shownIds = result.shownNotifIds || [];
                        let newShownIds = [...shownIds];
                        let hasNewRecord = false;

                        validNotifications.forEach(note => {
                            const uniqueId = note.id ? String(note.id) : null;

                            if (uniqueId && !shownIds.includes(uniqueId)) {
                                hasNewRecord = true;
                                const notifId = `notif-${uniqueId}`;
                                
                                chrome.notifications.create(notifId, {
                                    type: 'basic',
                                    iconUrl: chrome.runtime.getURL('icon.png'),
                                    title: 'Query Assistant',
                                    message: String(note.message), 
                                    priority: 2,
                                    requireInteraction: true
                                });

                                newShownIds.push(uniqueId);
                            }
                        });

                        // Keep storage clean (max 50 IDs)
                        if (hasNewRecord) {
                            if (newShownIds.length > 50) newShownIds = newShownIds.slice(-50);
                            chrome.storage.local.set({ shownNotifIds: newShownIds });
                        }
                    });
                }
            })
            .catch(err => {
                console.warn("Notification Polling Error:", err.message);
            });
        }
    });
}

function updateBadge(text) {
    chrome.action.setBadgeText({ text: text });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' }); // Red color
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "clear_badge") {
        updateBadge("");
        // Clear history so users can be re-notified if the same query updates later
        if (chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ shownNotifIds: [] });
        }
        sendResponse({ status: "badge_cleared" });
    }
});

// 3. SIDEBAR INJECTION
chrome.action.onClicked.addListener((tab) => {
    if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:")) {
        console.warn("Extension cannot run on this page.");
        return;
    }

    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
    }).then(() => {
        chrome.tabs.sendMessage(tab.id, { action: "toggle_sidebar" });
    }).catch(err => console.error("Script injection failed: ", err));
});