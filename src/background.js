// ResellBuddy — Background Service Worker
// Handles scheduling, license validation, and cross-tab coordination

const DEFAULT_SETTINGS = {
  poshmark: {
    autoShare: false,
    autoShareCount: 50,
    autoShareDelay: [3, 8], // random delay range in seconds
    autoLike: false,
    autoLikeCount: 30,
    autoFollow: false,
    autoFollowCount: 20,
    shareToParty: false,
  },
  mercari: {
    autoLike: false,
    autoLikeCount: 30,
  },
  schedule: {
    enabled: false,
    times: ["09:00", "13:00", "18:00"],
  },
  license: {
    key: "",
    isPremium: false,
    validatedAt: null,
  },
};

// Initialize settings
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("settings", (data) => {
    if (!data.settings) {
      chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    }
  });
});

// License validation via Dodo Payments
async function validateLicense(key) {
  try {
    const resp = await fetch("https://api.dodopayments.com/v1/licenses/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ license_key: key }),
    });
    const data = await resp.json();
    return data.valid === true;
  } catch {
    return false;
  }
}

// Check license on startup
chrome.runtime.onStartup.addListener(async () => {
  const { settings } = await chrome.storage.local.get("settings");
  if (settings?.license?.key) {
    const valid = await validateLicense(settings.license.key);
    settings.license.isPremium = valid;
    settings.license.validatedAt = Date.now();
    await chrome.storage.local.set({ settings });
  }
});

// Message handler for content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "validateLicense") {
    validateLicense(msg.key).then((valid) => sendResponse({ valid }));
    return true; // async
  }
  if (msg.type === "getSettings") {
    chrome.storage.local.get("settings", (data) => {
      sendResponse(data.settings || DEFAULT_SETTINGS);
    });
    return true;
  }
  if (msg.type === "saveSettings") {
    chrome.storage.local.set({ settings: msg.settings }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }
});

// Alarm-based scheduling for auto-actions
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith("resellbuddy-")) {
    // Send wake-up message to matching content script tab
    const platform = alarm.name.replace("resellbuddy-", "");
    chrome.tabs.query({ url: `https://${platform}.com/*` }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "runScheduled", platform });
      }
    });
  }
});
