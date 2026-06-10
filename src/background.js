// ResellBuddy — Background Service Worker
// Handles scheduling, license validation, and cross-tab coordination

const DEFAULT_SETTINGS = {
  poshmark: {
    autoShare: false,
    autoShareCount: 50,
    autoShareDelay: [3, 8],
    autoLike: false,
    autoLikeCount: 30,
    autoFollow: false,
    autoFollowCount: 20,
    shareToParty: false,
    offerDiscount: 10,
    offerMinPrice: 5,
    offerMaxPerRun: 20,
    autoUnfollowCount: 30,
    relistMaxPerRun: 10,
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

// ExtensionPay — Free open-source payment for Chrome extensions
// Docs: https://github.com/Glench/ExtensionPay
const EXTPAY_ID = "resellbuddy"; // ExtPay extension ID — registered at extensionpay.com
let extpay = null;

try {
  importScripts("src/ExtPay.js");
  extpay = ExtPay(EXTPAY_ID);
  extpay.startBackground();
} catch (e) {
  console.log("[ResellBuddy] ExtPay not available, using free mode:", e.message);
}

async function isPremiumUser() {
  try {
    if (!extpay) return false;
    const user = await extpay.getUser();
    return user.paid;
  } catch {
    // Fallback: check local storage for manual license key
    const { settings } = await chrome.storage.local.get("settings");
    return settings?.license?.isPremium === true;
  }
}

async function validateLicense(key) {
  // For users who prefer manual license key entry
  // In production, validate against your own server or ExtPay
  if (!key || key.length < 10) return false;
  try {
    // Simple client-side validation (replace with server validation in production)
    // For now, accept any key that looks valid (length > 10, alphanumeric)
    const valid = /^[A-Za-z0-9]{10,}$/.test(key);
    return valid;
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
  if (msg.type === "isPremium") {
    isPremiumUser().then((premium) => sendResponse({ premium }));
    return true;
  }
  if (msg.type === "openPaymentPage") {
    if (extpay) {
      extpay.openPaymentPage();
    }
    sendResponse({ ok: !!extpay });
    return true;
  }
  if (msg.type === "incrementUsage") {
    chrome.storage.local.get(["dailyUsage", "usageDate"], (data) => {
      const today = new Date().toDateString();
      let usage = data.usageDate === today ? (data.dailyUsage || 0) + 1 : 1;
      chrome.storage.local.set({ dailyUsage: usage, usageDate: today });
      sendResponse({ usage });
    });
    return true;
  }
  if (msg.type === "getUsage") {
    chrome.storage.local.get(["dailyUsage", "usageDate"], (data) => {
      const today = new Date().toDateString();
      const usage = data.usageDate === today ? (data.dailyUsage || 0) : 0;
      sendResponse({ usage });
    });
    return true;
  }
  if (msg.type === "saveSettings") {
    chrome.storage.local.set({ settings: msg.settings }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg.type === "startScheduler") {
    const { interval, actionsPerRun, startHour, endHour } = msg.config;
    // Create repeating alarm
    chrome.alarms.create("resellbuddy-poshmark", {
      periodInMinutes: interval * 60,
      delayInMinutes: 1,
    });
    // Save schedule config
    chrome.storage.local.get("settings", (data) => {
      const settings = data.settings || DEFAULT_SETTINGS;
      settings.schedule = {
        enabled: true,
        interval,
        actionsPerRun,
        startHour,
        endHour,
      };
      chrome.storage.local.set({ settings });
    });
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === "stopScheduler") {
    chrome.alarms.clear("resellbuddy-poshmark");
    chrome.storage.local.get("settings", (data) => {
      const settings = data.settings || DEFAULT_SETTINGS;
      settings.schedule.enabled = false;
      chrome.storage.local.set({ settings });
    });
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === "getOfferUsage") {
    chrome.storage.local.get(["offerUsage", "offerUsageDate"], (data) => {
      const today = new Date().toDateString();
      const count = data.offerUsageDate === today ? (data.offerUsage || 0) : 0;
      sendResponse({ count });
    });
    return true;
  }
  if (msg.type === "incrementOfferUsage") {
    chrome.storage.local.get(["offerUsage", "offerUsageDate"], (data) => {
      const today = new Date().toDateString();
      let count = data.offerUsageDate === today ? (data.offerUsage || 0) + 1 : 1;
      chrome.storage.local.set({ offerUsage: count, offerUsageDate: today });
      sendResponse({ count });
    });
    return true;
  }
  // Log individual action for analytics
  if (msg.type === "logAction") {
    const { action, platform } = msg;
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    chrome.storage.local.get(["actionLog"], (data) => {
      const log = data.actionLog || {};
      if (!log[today]) log[today] = [];
      log[today].push({ action, platform, ts: Date.now() });
      // Keep only last 30 days
      const keys = Object.keys(log).sort();
      while (keys.length > 30) {
        delete log[keys.shift()];
      }
      chrome.storage.local.set({ actionLog: log });
      sendResponse({ ok: true });
    });
    return true;
  }
  // Get action history for analytics
  if (msg.type === "getActionHistory") {
    chrome.storage.local.get(["actionLog"], (data) => {
      sendResponse({ history: data.actionLog || {} });
    });
    return true;
  }
});

// Alarm-based scheduling for auto-actions
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith("resellbuddy-")) {
    const platform = alarm.name.replace("resellbuddy-", "");

    // Check time window
    chrome.storage.local.get("settings", (data) => {
      const sched = data.settings?.schedule;
      if (!sched?.enabled) return;

      const hour = new Date().getHours();
      if (hour < sched.startHour || hour >= sched.endHour) return;

      // Send wake-up message to matching content script tab
      chrome.tabs.query({ url: `https://${platform}.com/*` }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: "runScheduled",
            platform,
            actionCount: sched.actionsPerRun || 20,
          });
        }
      });
    });
  }
});
