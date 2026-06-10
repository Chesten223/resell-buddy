// ResellBuddy — Popup UI
// Settings, license, and quick actions

document.addEventListener("DOMContentLoaded", () => {
  const settingsDiv = document.getElementById("settings");
  const licenseDiv = document.getElementById("license");
  const statusDiv = document.getElementById("status");

  // Load settings
  chrome.runtime.sendMessage({ type: "getSettings" }, (settings) => {
    document.getElementById("pm-share-count").value = settings?.poshmark?.autoShareCount || 50;
    document.getElementById("pm-like-count").value = settings?.poshmark?.autoLikeCount || 30;
    document.getElementById("pm-follow-count").value = settings?.poshmark?.autoFollowCount || 20;
    document.getElementById("pm-delay-min").value = settings?.poshmark?.autoShareDelay?.[0] || 3;
    document.getElementById("pm-delay-max").value = settings?.poshmark?.autoShareDelay?.[1] || 8;
    document.getElementById("pm-offer-discount").value = settings?.poshmark?.offerDiscount ?? 10;
    document.getElementById("pm-offer-min-price").value = settings?.poshmark?.offerMinPrice ?? 5;
    document.getElementById("pm-offer-max").value = settings?.poshmark?.offerMaxPerRun ?? 20;

    if (settings?.license?.key) {
      document.getElementById("license-key").value = settings.license.key;
    }
    if (settings?.license?.isPremium) {
      statusDiv.textContent = "✅ Pro Active";
      statusDiv.className = "status pro";
    }
  });

  // Load analytics
  chrome.runtime.sendMessage({ type: "getUsage" }, (usage) => {
    const used = usage?.usage || 0;
    const isPremium = document.getElementById("status").textContent.includes("Pro");
    const limit = isPremium ? 999 : 50;
    document.getElementById("analytics-used").textContent = used;
    document.getElementById("analytics-remaining").textContent = isPremium ? "∞" : String(Math.max(0, limit - used));
    // Estimate time saved: ~30 seconds per action
    const hoursSaved = (used * 30 / 3600).toFixed(1);
    document.getElementById("analytics-saved").textContent = hoursSaved + "h";
  });

  // Save settings
  document.getElementById("save-settings").addEventListener("click", () => {
    const settings = {
      poshmark: {
        autoShare: true,
        autoShareCount: parseInt(document.getElementById("pm-share-count").value) || 50,
        autoLike: true,
        autoLikeCount: parseInt(document.getElementById("pm-like-count").value) || 30,
        autoFollow: true,
        autoFollowCount: parseInt(document.getElementById("pm-follow-count").value) || 20,
        autoShareDelay: [
          parseInt(document.getElementById("pm-delay-min").value) || 3,
          parseInt(document.getElementById("pm-delay-max").value) || 8,
        ],
        offerDiscount: parseInt(document.getElementById("pm-offer-discount").value) || 10,
        offerMinPrice: parseInt(document.getElementById("pm-offer-min-price").value) || 5,
        offerMaxPerRun: parseInt(document.getElementById("pm-offer-max").value) || 20,
      },
      mercari: { autoLike: false, autoLikeCount: 30 },
      schedule: {
        enabled: false,
        interval: parseInt(document.getElementById("sched-interval")?.value) || 4,
        actionsPerRun: parseInt(document.getElementById("sched-actions")?.value) || 20,
        startHour: parseInt(document.getElementById("sched-start")?.value) || 8,
        endHour: parseInt(document.getElementById("sched-end")?.value) || 22,
      },
      license: { key: "", isPremium: false, validatedAt: null },
    };

    // Preserve license info
    chrome.runtime.sendMessage({ type: "getSettings" }, (current) => {
      if (current?.license) settings.license = current.license;
      if (current?.schedule) settings.schedule.enabled = current.schedule.enabled;
      chrome.runtime.sendMessage({ type: "saveSettings", settings }, () => {
        statusDiv.textContent = "✅ Settings saved!";
        statusDiv.className = "status pro";
      });
    });
  });

  // License validation
  document.getElementById("activate-license").addEventListener("click", () => {
    const key = document.getElementById("license-key").value.trim();
    if (!key) return;

    statusDiv.textContent = "Validating...";
    chrome.runtime.sendMessage({ type: "validateLicense", key }, (response) => {
      if (response?.valid) {
        statusDiv.textContent = "✅ Pro Activated!";
        statusDiv.className = "status pro";
        chrome.runtime.sendMessage({ type: "getSettings" }, (current) => {
          current.license = { key, isPremium: true, validatedAt: Date.now() };
          chrome.runtime.sendMessage({ type: "saveSettings", settings: current });
        });
      } else {
        statusDiv.textContent = "❌ Invalid license key";
        statusDiv.className = "status err";
      }
    });
  });

  // Scheduler controls
  const schedStatus = document.getElementById("sched-status");

  document.getElementById("sched-enable").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "isPremium" }, (resp) => {
      if (!resp?.premium) {
        schedStatus.textContent = "❌ Pro required for scheduler";
        schedStatus.className = "status err";
        return;
      }
      chrome.runtime.sendMessage({
        type: "startScheduler",
        config: {
          interval: parseInt(document.getElementById("sched-interval").value) || 4,
          actionsPerRun: parseInt(document.getElementById("sched-actions").value) || 20,
          startHour: parseInt(document.getElementById("sched-start").value) || 8,
          endHour: parseInt(document.getElementById("sched-end").value) || 22,
        },
      }, (response) => {
        if (response?.ok) {
          schedStatus.textContent = "✅ Scheduler running";
          schedStatus.className = "status pro";
        }
      });
    });
  });

  document.getElementById("sched-disable").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "stopScheduler" }, (response) => {
      if (response?.ok) {
        schedStatus.textContent = "Scheduler stopped";
        schedStatus.className = "status";
      }
    });
  });

  // Export/Import settings
  document.getElementById("export-settings").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "getSettings" }, (settings) => {
      const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "resellbuddy-settings.json";
      a.click();
      URL.revokeObjectURL(url);
    });
  });

  document.getElementById("import-settings").addEventListener("click", () => {
    document.getElementById("import-file").click();
  });

  document.getElementById("import-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        chrome.runtime.sendMessage({ type: "saveSettings", settings: imported }, () => {
          statusDiv.textContent = "✅ Settings imported!";
          statusDiv.className = "status pro";
        });
      } catch {
        statusDiv.textContent = "❌ Invalid settings file";
        statusDiv.className = "status err";
      }
    };
    reader.readAsText(file);
  });
});
