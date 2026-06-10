// ResellBuddy — Popup UI
// Settings, analytics dashboard, license, and quick actions

document.addEventListener("DOMContentLoaded", () => {
  const statusDiv = document.getElementById("status");

  // ── Tab switching ──
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "analytics") loadAnalytics();
    });
  });

  // ── Load settings ──
  chrome.runtime.sendMessage({ type: "getSettings" }, (settings) => {
    document.getElementById("pm-share-count").value = settings?.poshmark?.autoShareCount || 50;
    document.getElementById("pm-like-count").value = settings?.poshmark?.autoLikeCount || 30;
    document.getElementById("pm-follow-count").value = settings?.poshmark?.autoFollowCount || 20;
    document.getElementById("pm-delay-min").value = settings?.poshmark?.autoShareDelay?.[0] || 3;
    document.getElementById("pm-delay-max").value = settings?.poshmark?.autoShareDelay?.[1] || 8;
    document.getElementById("pm-offer-discount").value = settings?.poshmark?.offerDiscount ?? 10;
    document.getElementById("pm-offer-min-price").value = settings?.poshmark?.offerMinPrice ?? 5;
    document.getElementById("pm-offer-max").value = settings?.poshmark?.offerMaxPerRun ?? 20;
    document.getElementById("pm-relist-max").value = settings?.poshmark?.relistMaxPerRun ?? 10;
    document.getElementById("pm-unfollow-count").value = settings?.poshmark?.autoUnfollowCount ?? 30;

    if (settings?.license?.key) {
      document.getElementById("license-key").value = settings.license.key;
    }
    if (settings?.license?.isPremium) {
      statusDiv.textContent = "✅ Pro Active";
      statusDiv.className = "status pro";
    }
  });

  // ── Save settings ──
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
        relistMaxPerRun: parseInt(document.getElementById("pm-relist-max")?.value) || 10,
        autoUnfollowCount: parseInt(document.getElementById("pm-unfollow-count")?.value) || 30,
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

    chrome.runtime.sendMessage({ type: "getSettings" }, (current) => {
      if (current?.license) settings.license = current.license;
      if (current?.schedule) settings.schedule.enabled = current.schedule.enabled;
      chrome.runtime.sendMessage({ type: "saveSettings", settings }, () => {
        statusDiv.textContent = "✅ Settings saved!";
        statusDiv.className = "status pro";
      });
    });
  });

  // ── License ──
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

  // ── Scheduler ──
  const schedStatus = document.getElementById("sched-status");
  document.getElementById("sched-enable").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "isPremium" }, (resp) => {
      if (!resp?.premium) {
        schedStatus.textContent = "❌ Pro required for scheduler";
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

  // ── Export / Import ──
  document.getElementById("export-settings").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "getSettings" }, (settings) => {
      const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "resellbuddy-settings.json"; a.click();
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

  // ── Analytics Dashboard ──
  function loadAnalytics() {
    // Get today's usage
    chrome.runtime.sendMessage({ type: "getUsage" }, (usage) => {
      const todayUsed = usage?.usage || 0;
      document.getElementById("dash-total").textContent = todayUsed;
      // Time saved: ~30 sec per action
      document.getElementById("dash-saved").textContent = (todayUsed * 30 / 3600).toFixed(1) + "h";
    });

    // Get action history
    chrome.runtime.sendMessage({ type: "getActionHistory" }, (data) => {
      const history = data?.history || {};
      const days = Object.keys(history).sort().slice(-7);

      // Week total
      let weekTotal = 0;
      const trendData = [];
      for (const day of days) {
        const dayActions = history[day] || [];
        weekTotal += dayActions.length;
        trendData.push({ date: day, count: dayActions.length });
      }
      document.getElementById("dash-week").textContent = weekTotal;

      // 7-day trend bar chart
      const chart = document.getElementById("trend-chart");
      const maxCount = Math.max(...trendData.map(d => d.count), 1);
      chart.innerHTML = "";
      for (const d of trendData) {
        const height = Math.max(4, (d.count / maxCount) * 80);
        const dayLabel = d.date.slice(5); // MM-DD
        const bar = document.createElement("div");
        bar.style.cssText = `flex:1;height:${height}px;background:linear-gradient(to top,#7c3aed,#22c55e);border-radius:3px 3px 0 0;position:relative;min-width:0`;
        bar.title = `${dayLabel}: ${d.count} actions`;
        const label = document.createElement("div");
        label.style.cssText = "font-size:8px;color:#666;text-align:center;margin-top:2px";
        label.textContent = dayLabel.slice(3); // DD
        const wrapper = document.createElement("div");
        wrapper.style.cssText = "flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end";
        wrapper.appendChild(bar);
        wrapper.appendChild(label);
        chart.appendChild(wrapper);
      }

      // Action breakdown (last 7 days)
      const breakdown = { share: 0, like: 0, follow: 0, offer: 0, relist: 0, unfollow: 0 };
      for (const day of days) {
        for (const action of (history[day] || [])) {
          const a = action.action || "";
          if (a.includes("share")) breakdown.share++;
          else if (a.includes("like")) breakdown.like++;
          else if (a.includes("follow") && !a.includes("unfollow")) breakdown.follow++;
          else if (a.includes("offer")) breakdown.offer++;
          else if (a.includes("relist")) breakdown.relist++;
          else if (a.includes("unfollow")) breakdown.unfollow++;
        }
      }

      const maxAction = Math.max(...Object.values(breakdown), 1);
      for (const [key, val] of Object.entries(breakdown)) {
        const el = document.getElementById("bd-" + key);
        if (el) el.textContent = val;
        const barEl = document.getElementById("bd-" + key + "-bar");
        if (barEl) barEl.style.width = (val / maxAction * 100) + "%";
      }

      // Recent history (last 20 actions)
      const historyList = document.getElementById("history-list");
      historyList.innerHTML = "";
      const allActions = [];
      for (const day of days) {
        for (const a of (history[day] || [])) {
          allActions.push({ ...a, date: day });
        }
      }
      const recent = allActions.slice(-20).reverse();
      for (const action of recent) {
        const time = new Date(action.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
        const row = document.createElement("div");
        row.className = "history-row";
        row.innerHTML = `<span style="color:#666">${action.date} ${time}</span><span>${action.action || "action"}</span>`;
        historyList.appendChild(row);
      }
      if (recent.length === 0) {
        historyList.innerHTML = '<div style="text-align:center;color:#444;padding:12px">No activity yet. Start using ResellBuddy!</div>';
      }
    });
  }

  // Load analytics on initial open (in case user is on analytics tab)
  // Will be loaded when tab is clicked
});
