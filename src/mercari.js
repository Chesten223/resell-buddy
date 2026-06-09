// ResellBuddy — Mercari Content Script
// Automates liking and following on Mercari

(function () {
  "use strict";
  if (window.__resellbuddy_mercari) return;
  window.__resellbuddy_mercari = true;

  // ── Helpers ──

  function randomDelay(min, max) {
    return new Promise((r) => setTimeout(r, (min + Math.random() * (max - min)) * 1000));
  }

  function log(msg) {
    console.log(`[ResellBuddy Mercari] ${msg}`);
  }

  async function getSettings() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "getSettings" }, (settings) => resolve(settings));
    });
  }

  const FREE_DAILY_LIMIT = 50;

  async function isPremium() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "isPremium" }, (r) => resolve(r?.premium === true));
    });
  }

  async function getUsage() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "getUsage" }, (r) => resolve(r?.usage || 0));
    });
  }

  async function incrementUsage() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "incrementUsage" }, (r) => resolve(r?.usage || 0));
    });
  }

  async function checkLimit() {
    const premium = await isPremium();
    if (premium) return true;
    const usage = await getUsage();
    if (usage >= FREE_DAILY_LIMIT) {
      alert(`ResellBuddy: You've used ${usage}/${FREE_DAILY_LIMIT} free actions today. Upgrade to Pro for unlimited!`);
      chrome.runtime.sendMessage({ type: "openPaymentPage" });
      return false;
    }
    return true;
  }

  // ── Selector helpers ──

  function findLikeButtons() {
    // Mercari like button variants
    const selectors = [
      'button[data-testid="like-button"]',
      'button[aria-label*="Like"]',
      'button[aria-label*="like"]',
      '.item-like-button',
      'button[data-testid="item-like"]',
    ];
    for (const sel of selectors) {
      const btns = document.querySelectorAll(sel);
      if (btns.length) return Array.from(btns);
    }
    return [];
  }

  function findFollowButtons() {
    const selectors = [
      'button[data-testid="follow-button"]',
      'button[aria-label*="Follow"]',
      'button[aria-label*="follow"]',
      'button[data-testid="user-follow"]',
    ];
    for (const sel of selectors) {
      const btns = document.querySelectorAll(sel);
      if (btns.length) return Array.from(btns);
    }
    return [];
  }

  function isAlreadyLiked(btn) {
    return (
      btn.getAttribute("aria-checked") === "true" ||
      btn.classList.contains("liked") ||
      btn.getAttribute("aria-pressed") === "true" ||
      btn.querySelector('svg[fill="currentColor"]') !== null ||
      btn.dataset.liked === "true"
    );
  }

  function isAlreadyFollowing(btn) {
    return (
      btn.textContent?.trim().toLowerCase().includes("following") ||
      btn.textContent?.trim().toLowerCase().includes("unfollow") ||
      btn.getAttribute("aria-pressed") === "true" ||
      btn.classList.contains("following")
    );
  }

  function highlightElement(el) {
    const orig = el.style.outline;
    const origTransition = el.style.transition;
    el.style.transition = "outline 0.15s";
    el.style.outline = "3px solid #7c3aed";
    setTimeout(() => {
      el.style.outline = orig || "";
      el.style.transition = origTransition || "";
    }, 1500);
  }

  // ── Floating Action Panel ──

  function createPanel() {
    const panel = document.createElement("div");
    panel.id = "resellbuddy-mercari-panel";
    panel.innerHTML = `
      <div id="rbm-header">
        <span>⚡ ResellBuddy <small style="opacity:.6">(Mercari)</small></span>
        <button id="rbm-minimize">_</button>
      </div>
      <div id="rbm-body">
        <button class="rbm-btn" id="rbm-like">❤️ Like Feed Items</button>
        <button class="rbm-btn" id="rbm-follow">👤 Follow Users</button>
        <button class="rbm-btn" id="rbm-stop" style="display:none;background:#ef4444;color:white;border-color:#ef4444">⏹ Stop</button>
        <div id="rbm-status">Ready</div>
        <div id="rbm-counter">0 actions</div>
      </div>
    `;
    document.body.appendChild(panel);

    // Styling — namespaced to avoid clashes with poshmark panel
    const style = document.createElement("style");
    style.textContent = `
      #resellbuddy-mercari-panel {
        position: fixed; bottom: 20px; right: 20px; z-index: 99999;
        background: #1a1a2e; color: #eee; border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0,0,0,.4); font-family: -apple-system, sans-serif;
        min-width: 220px; overflow: hidden; font-size: 13px;
      }
      #rbm-header {
        background: #7c3aed; padding: 8px 12px; display: flex;
        justify-content: space-between; align-items: center; font-weight: 700;
      }
      #rbm-minimize { background: none; border: none; color: white; cursor: pointer; font-size: 16px; }
      #rbm-body { padding: 12px; }
      .rbm-btn {
        display: block; width: 100%; padding: 8px; margin-bottom: 6px;
        border: 1px solid #333; border-radius: 6px; background: #16213e;
        color: #ccc; cursor: pointer; text-align: left; font-size: 12px;
        transition: all .15s;
      }
      .rbm-btn:hover { background: #7c3aed; color: white; border-color: #7c3aed; }
      .rbm-btn:disabled { opacity: .5; cursor: not-allowed; }
      #rbm-status { color: #888; font-size: 11px; margin-top: 8px; }
      #rbm-counter { color: #22c55e; font-size: 12px; font-weight: 600; }
    `;
    document.head.appendChild(style);

    let actionCount = 0;
    let running = false;
    let abortController = new AbortController();

    const statusEl = panel.querySelector("#rbm-status");
    const counterEl = panel.querySelector("#rbm-counter");

    function updateStatus(msg) { statusEl.textContent = msg; }
    function incrementCounter() { actionCount++; counterEl.textContent = `${actionCount} actions`; }

    function disableButtons() {
      panel.querySelectorAll(".rbm-btn").forEach((b) => (b.disabled = true));
    }
    function enableButtons() {
      panel.querySelectorAll(".rbm-btn").forEach((b) => (b.disabled = false));
    }

    function setRunning(isRunning) {
      running = isRunning;
      const stopBtn = panel.querySelector("#rbm-stop");
      if (isRunning) {
        disableButtons();
        stopBtn.style.display = "block";
      } else {
        enableButtons();
        stopBtn.style.display = "none";
      }
    }

    // Minimize toggle
    panel.querySelector("#rbm-minimize").addEventListener("click", () => {
      const body = panel.querySelector("#rbm-body");
      const btn = panel.querySelector("#rbm-minimize");
      if (body.style.display === "none") {
        body.style.display = "block";
        btn.textContent = "_";
      } else {
        body.style.display = "none";
        btn.textContent = "□";
      }
    });

    // Stop
    panel.querySelector("#rbm-stop").addEventListener("click", () => {
      abortController.abort();
      updateStatus("⏹ Stopping...");
    });

    // ── Like Feed Items ──

    panel.querySelector("#rbm-like").addEventListener("click", async () => {
      if (running) return;
      if (!(await checkLimit())) return;
      abortController = new AbortController();
      setRunning(true);
      const settings = await getSettings();
      const count = settings?.mercari?.autoLikeCount || 30;
      const [delayMin, delayMax] = settings?.mercari?.autoLikeDelay || [3, 8];

      updateStatus(`Scrolling to load items...`);
      log(`Starting like feed — target: ${count}`);

      // Scroll to load more items (Mercari lazy-loads search results)
      const scrollContainer =
        document.querySelector('main') ||
        document.querySelector('.search-results') ||
        document.querySelector('[data-testid="search-results"]') ||
        window;

      let lastItemCount = 0;
      let stableCount = 0;
      let scrollAttempts = 0;
      const maxScrollAttempts = 20;

      while (stableCount < 2 && scrollAttempts < maxScrollAttempts) {
        scrollAttempts++;
        const items = document.querySelectorAll('a[href*="/item/"], .item-box');
        if (items.length === lastItemCount) {
          stableCount++;
        } else {
          stableCount = 0;
          lastItemCount = items.length;
          const last = items[items.length - 1];
          if (last) last.scrollIntoView({ behavior: "smooth" });
        }
        await randomDelay(2, 3);
      }

      // Now find like buttons on listing cards
      let likeBtns = findLikeButtons().filter((btn) => !isAlreadyLiked(btn));

      // If no dedicated like buttons found, try opening each listing card
      // and liking from the item page (Mercari search/feed may require this)
      if (likeBtns.length === 0) {
        updateStatus(`No like buttons found on current view. Try running on an item page or feed with visible like buttons.`);
        setRunning(false);
        return;
      }

      const toLike = likeBtns.slice(0, count);
      updateStatus(`Found ${toLike.length} items to like.`);
      let liked = 0;

      for (let i = 0; i < toLike.length; i++) {
        if (abortController.signal.aborted) break;
        try {
          highlightElement(toLike[i]);
          toLike[i].click();
          liked++;
          incrementCounter();
          incrementUsage();
          updateStatus(`Liked ${liked}/${toLike.length}`);
          await randomDelay(delayMin, delayMax);
        } catch (e) {
          log(`Error liking item ${i}: ${e.message}`);
        }
      }

      updateStatus(`✅ Done! Liked ${liked} items.`);
      setRunning(false);
    });

    // ── Follow Users ──

    panel.querySelector("#rbm-follow").addEventListener("click", async () => {
      if (running) return;
      if (!(await checkLimit())) return;
      abortController = new AbortController();
      setRunning(true);
      const settings = await getSettings();
      const count = settings?.mercari?.autoFollowCount || 20;
      const [delayMin, delayMax] = settings?.mercari?.autoFollowDelay || [3, 8];

      updateStatus(`Scrolling to load users...`);
      log(`Starting follow — target: ${count}`);

      // Scroll to load more user cards
      const scrollContainer =
        document.querySelector('main') ||
        document.querySelector('.search-results') ||
        window;

      let lastBtnCount = 0;
      let stableCount = 0;
      let scrollAttempts = 0;
      const maxScrollAttempts = 15;

      while (stableCount < 2 && scrollAttempts < maxScrollAttempts) {
        scrollAttempts++;
        const btns = findFollowButtons();
        if (btns.length === lastBtnCount) {
          stableCount++;
        } else {
          stableCount = 0;
          lastBtnCount = btns.length;
          // Scroll the last follow button into view
          const last = btns[btns.length - 1];
          if (last) last.scrollIntoView({ behavior: "smooth" });
        }
        await randomDelay(2, 3);
      }

      let followBtns = findFollowButtons().filter((btn) => !isAlreadyFollowing(btn));

      if (followBtns.length === 0) {
        updateStatus(`No follow buttons found. Navigate to a page with user listings (e.g. search users).`);
        setRunning(false);
        return;
      }

      const toFollow = followBtns.slice(0, count);
      updateStatus(`Found ${toFollow.length} users to follow.`);
      let followed = 0;

      for (let i = 0; i < toFollow.length; i++) {
        if (abortController.signal.aborted) break;
        try {
          highlightElement(toFollow[i]);
          toFollow[i].click();
          followed++;
          incrementCounter();
          incrementUsage();
          updateStatus(`Followed ${followed}/${toFollow.length}`);
          await randomDelay(delayMin, delayMax);
        } catch (e) {
          log(`Error following user ${i}: ${e.message}`);
        }
      }

      updateStatus(`✅ Done! Followed ${followed} users.`);
      setRunning(false);
    });

    log("ResellBuddy panel injected on Mercari");
  }

  // Wait for page load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createPanel);
  } else {
    createPanel();
  }
})();
