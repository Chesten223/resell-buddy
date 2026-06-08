// ResellBuddy — Poshmark Content Script
// Automates sharing, liking, and following on Poshmark

(function () {
  "use strict";
  if (window.__resellbuddy_injected) return;
  window.__resellbuddy_injected = true;

  // ── Helpers ──

  function randomDelay(min, max) {
    return new Promise((r) => setTimeout(r, (min + Math.random() * (max - min)) * 1000));
  }

  function log(msg) {
    console.log(`[ResellBuddy] ${msg}`);
  }

  async function getSettings() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "getSettings" }, (settings) => resolve(settings));
    });
  }

  // ── Floating Action Panel ──

  function createPanel() {
    const panel = document.createElement("div");
    panel.id = "resellbuddy-panel";
    panel.innerHTML = `
      <div id="rb-header">
        <span>⚡ ResellBuddy</span>
        <button id="rb-minimize">_</button>
      </div>
      <div id="rb-body">
        <button class="rb-btn" id="rb-share">📤 Share My Listings</button>
        <button class="rb-btn" id="rb-community">🔄 Share Community Feed</button>
        <button class="rb-btn" id="rb-like">❤️ Like Feed Items</button>
        <button class="rb-btn" id="rb-follow">👤 Follow Users</button>
        <div id="rb-status">Ready</div>
        <div id="rb-counter">0 actions</div>
      </div>
    `;
    document.body.appendChild(panel);

    // Styling
    const style = document.createElement("style");
    style.textContent = `
      #resellbuddy-panel {
        position: fixed; bottom: 20px; right: 20px; z-index: 99999;
        background: #1a1a2e; color: #eee; border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0,0,0,.4); font-family: -apple-system, sans-serif;
        min-width: 220px; overflow: hidden; font-size: 13px;
      }
      #rb-header {
        background: #7c3aed; padding: 8px 12px; display: flex;
        justify-content: space-between; align-items: center; font-weight: 700;
      }
      #rb-minimize { background: none; border: none; color: white; cursor: pointer; font-size: 16px; }
      #rb-body { padding: 12px; }
      .rb-btn {
        display: block; width: 100%; padding: 8px; margin-bottom: 6px;
        border: 1px solid #333; border-radius: 6px; background: #16213e;
        color: #ccc; cursor: pointer; text-align: left; font-size: 12px;
        transition: all .15s;
      }
      .rb-btn:hover { background: #7c3aed; color: white; border-color: #7c3aed; }
      .rb-btn:disabled { opacity: .5; cursor: not-allowed; }
      #rb-status { color: #888; font-size: 11px; margin-top: 8px; }
      #rb-counter { color: #22c55e; font-size: 12px; font-weight: 600; }
    `;
    document.head.appendChild(style);

    let actionCount = 0;
    let running = false;

    const statusEl = panel.querySelector("#rb-status");
    const counterEl = panel.querySelector("#rb-counter");

    function updateStatus(msg) { statusEl.textContent = msg; }
    function incrementCounter() { actionCount++; counterEl.textContent = `${actionCount} actions`; }

    function disableButtons() {
      panel.querySelectorAll(".rb-btn").forEach((b) => (b.disabled = true));
    }
    function enableButtons() {
      panel.querySelectorAll(".rb-btn").forEach((b) => (b.disabled = false));
    }

    // ── Share My Listings ──

    panel.querySelector("#rb-share").addEventListener("click", async () => {
      if (running) return;
      running = true;
      disableButtons();
      const settings = await getSettings();
      const count = settings?.poshmark?.autoShareCount || 50;
      const [delayMin, delayMax] = settings?.poshmark?.autoShareDelay || [3, 8];

      // Navigate to my closet
      const closetLink = document.querySelector('a[href*="/closet/"]');
      if (!closetLink) {
        updateStatus("Go to your closet first!");
        running = false;
        enableButtons();
        return;
      }

      updateStatus(`Sharing ${count} listings...`);
      log(`Starting to share ${count} listings`);

      // Get listing cards from closet
      const listings = document.querySelectorAll(".closet-listings .tile");
      const toShare = Array.from(listings).slice(0, count);

      for (let i = 0; i < toShare.length; i++) {
        try {
          // Click share button on each listing
          const shareBtn = toShare[i].querySelector(".share-action");
          if (shareBtn) {
            shareBtn.click();
            incrementCounter();
            updateStatus(`Shared ${i + 1}/${toShare.length}`);
            await randomDelay(delayMin, delayMax);
          }
        } catch (e) {
          log(`Error sharing listing ${i}: ${e.message}`);
        }
      }

      updateStatus(`Done! Shared ${actionCount} listings.`);
      running = false;
      enableButtons();
    });

    // ── Like Feed Items ──

    panel.querySelector("#rb-like").addEventListener("click", async () => {
      if (running) return;
      running = true;
      disableButtons();
      const settings = await getSettings();
      const count = settings?.poshmark?.autoLikeCount || 30;
      const [delayMin, delayMax] = settings?.poshmark?.autoShareDelay || [3, 8];

      updateStatus(`Liking ${count} items...`);

      const likeButtons = document.querySelectorAll(".like-action");
      const toLike = Array.from(likeButtons)
        .filter((btn) => !btn.classList.contains("liked"))
        .slice(0, count);

      for (let i = 0; i < toLike.length; i++) {
        try {
          toLike[i].click();
          incrementCounter();
          updateStatus(`Liked ${i + 1}/${toLike.length}`);
          await randomDelay(delayMin, delayMax);
        } catch (e) {
          log(`Error liking item ${i}: ${e.message}`);
        }
      }

      updateStatus(`Done! ${actionCount} total actions.`);
      running = false;
      enableButtons();
    });

    // ── Follow Users ──

    panel.querySelector("#rb-follow").addEventListener("click", async () => {
      if (running) return;
      running = true;
      disableButtons();
    // ── Share My Closet Listings ──
    // Uses real Poshmark selectors from open-source analysis
    panel.querySelector("#rb-share").addEventListener("click", async () => {
      if (running) return;
      running = true;
      disableButtons();
      const settings = await getSettings();
      const count = settings?.poshmark?.autoShareCount || 50;
      const [delayMin, delayMax] = settings?.poshmark?.autoShareDelay || [3, 8];

      updateStatus(`Loading closet... scrolling to find listings`);
      log(`Starting closet share — target: ${count}`);

      // Scroll to load all listings (Poshmark lazy-loads)
      let lastImgCount = 0;
      let stableCount = 0;
      while (stableCount < 2) {
        const imgs = document.querySelectorAll('a[href*="/listing/"] img');
        if (imgs.length === lastImgCount) {
          stableCount++;
        } else {
          stableCount = 0;
          lastImgCount = imgs.length;
          imgs[imgs.length - 1]?.scrollIntoView({ behavior: "smooth" });
        }
        await randomDelay(2, 3);
      }

      // Click "available" filter if present
      const availableFilter = document.querySelector('input[value*="available"]');
      if (availableFilter) availableFilter.click();
      await randomDelay(1, 2);

      // Get listing containers via col divs
      const listingImgs = document.querySelectorAll('a[href*="/listing/"] img');
      const toShare = Array.from(listingImgs).slice(0, count);
      updateStatus(`Found ${toShare.length} listings. Sharing...`);

      let shared = 0;
      for (let i = 0; i < toShare.length; i++) {
        try {
          const img = toShare[i];
          const col = img.closest('div[class*="col"]');
          if (!col) continue;

          // Skip sold/unavailable
          if (col.querySelector('.sold-tag, .not-for-sale-tag')) continue;
          // Skip already shared
          if (col.querySelector('.progress-bar-checkmark')) continue;

          const shareBtn = col.querySelector('div[data-et-name="share"]');
          if (!shareBtn) continue;

          // Highlight and click share
          shareBtn.style.backgroundColor = "#7c3aed";
          shareBtn.click();
          await randomDelay(1, 2);

          // Click "Share to My Followers" in the modal
          const followerShare = document.querySelector('a[data-et-name="share_poshmark"] div');
          if (followerShare) {
            followerShare.click();
            shared++;
            incrementCounter();
            updateStatus(`Shared ${shared}/${toShare.length}`);
          }
          await randomDelay(delayMin, delayMax);
        } catch (e) {
          log(`Error sharing listing ${i}: ${e.message}`);
        }
      }

      updateStatus(`✅ Done! Shared ${shared} listings.`);
      running = false;
      enableButtons();
    });

    // ── Share Community Feed ──
    panel.querySelector("#rb-community").addEventListener("click", async () => {
      if (running) return;
      running = true;
      disableButtons();
      const settings = await getSettings();
      const count = settings?.poshmark?.autoShareCount || 50;
      const [delayMin, delayMax] = settings?.poshmark?.autoShareDelay || [3, 8];

      updateStatus(`Sharing ${count} feed items...`);

      const shareBtns = document.querySelectorAll('div[data-et-name="share"]');
      const toShare = Array.from(shareBtns).slice(0, count);
      let shared = 0;

      for (let i = 0; i < toShare.length; i++) {
        try {
          toShare[i].style.backgroundColor = "#22c55e";
          toShare[i].click();
          await randomDelay(1, 2);

          const followerShare = document.querySelector('a[data-et-name="share_poshmark"] div');
          if (followerShare) {
            followerShare.click();
            shared++;
            incrementCounter();
            updateStatus(`Shared feed ${shared}/${toShare.length}`);
          }
          await randomDelay(delayMin, delayMax);
        } catch (e) {
          log(`Error sharing feed ${i}: ${e.message}`);
        }
      }

      updateStatus(`✅ Done! ${shared} feed items shared.`);
      running = false;
      enableButtons();
    });

    // ── Like Feed Items ──
    panel.querySelector("#rb-like").addEventListener("click", async () => {
      if (running) return;
      running = true;
      disableButtons();
      const settings = await getSettings();
      const count = settings?.poshmark?.autoLikeCount || 30;
      const [delayMin, delayMax] = settings?.poshmark?.autoShareDelay || [3, 8];

      updateStatus(`Liking ${count} items...`);

      // Poshmark like button: div[data-et-name="like"] or .social-action-bar__like
      const likeBtns = document.querySelectorAll('div[data-et-name="like"]');
      const toLike = Array.from(likeBtns)
        .filter((btn) => !btn.classList.contains("liked"))
        .slice(0, count);
      let liked = 0;

      for (let i = 0; i < toLike.length; i++) {
        try {
          toLike[i].click();
          liked++;
          incrementCounter();
          updateStatus(`Liked ${liked}/${toLike.length}`);
          await randomDelay(delayMin, delayMax);
        } catch (e) {
          log(`Error liking ${i}: ${e.message}`);
        }
      }

      updateStatus(`✅ Done! Liked ${liked} items.`);
      running = false;
      enableButtons();
    });

    // ── Follow Users ──
    panel.querySelector("#rb-follow").addEventListener("click", async () => {
      if (running) return;
      running = true;
      disableButtons();
      const settings = await getSettings();
      const count = settings?.poshmark?.autoFollowCount || 20;
      const [delayMin, delayMax] = settings?.poshmark?.autoShareDelay || [3, 8];

      updateStatus(`Following ${count} users...`);

      // Poshmark follow: button[data-et-name="follow"] or .follow-btn
      const followBtns = document.querySelectorAll(
        'button[data-et-name="follow"], .follow-btn, [data-et-name="user_follow"]'
      );
      const toFollow = Array.from(followBtns).slice(0, count);
      let followed = 0;

      for (let i = 0; i < toFollow.length; i++) {
        try {
          toFollow[i].click();
          followed++;
          incrementCounter();
          updateStatus(`Followed ${followed}/${toFollow.length}`);
          await randomDelay(delayMin, delayMax);
        } catch (e) {
          log(`Error following ${i}: ${e.message}`);
        }
      }

      updateStatus(`✅ Done! Followed ${followed} users.`);
      running = false;
      enableButtons();
    });

    log("ResellBuddy panel injected on Poshmark");
  }

  // Wait for page load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createPanel);
  } else {
    createPanel();
  }
})();
