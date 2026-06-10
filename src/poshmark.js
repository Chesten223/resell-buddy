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

  const FREE_DAILY_LIMIT = 50; // Free users: 50 actions/day

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
        <button class="rb-btn" id="rb-unfollow">🔄 Unfollow Non-Followers</button>
        <button class="rb-btn rb-premium-btn" id="rb-relist">📦 Auto-Relist Old Items <span style="font-size:9px;color:#aaa">PRO</span></button>
        <button class="rb-btn rb-premium-btn" id="rb-offer-likers">💰 Send Offers to Likers <span style="font-size:9px;color:#aaa">PRO</span></button>
        <button class="rb-btn rb-premium-btn" id="rb-party-share">🎉 Share to Posh Party <span style="font-size:9px;color:#aaa">PRO</span></button>
        <button class="rb-btn" id="rb-stop" style="display:none;background:#ef4444;color:white;border-color:#ef4444">⏹ Stop</button>
        <div id="rb-status">Ready</div>
        <div id="rb-counter">0 actions</div>
      </div>
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
      #rb-counter { color: #22c55e; font-size: 12px; font-weight: 600; }
      .rb-premium-btn { background: linear-gradient(135deg, #16213e 0%, #1a1040 100%); border-color: #7c3aed; }
      .rb-premium-btn:hover { background: #7c3aed !important; }
    `;
    document.head.appendChild(style);

    let actionCount = 0;
    let running = false;
    let abortController = new AbortController();

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

    function setRunning(isRunning) {
      running = isRunning;
      const stopBtn = panel.querySelector("#rb-stop");
      if (isRunning) {
        disableButtons();
        stopBtn.style.display = "block";
      } else {
        enableButtons();
        stopBtn.style.display = "none";
      }
    }

    panel.querySelector("#rb-stop").addEventListener("click", () => {
      abortController.abort();
      updateStatus("⏹ Stopping...");
    });

    // ── Share My Listings ──

    // Uses real Poshmark selectors from open-source analysis
    panel.querySelector("#rb-share").addEventListener("click", async () => {
      if (running) return;
      if (!(await checkLimit())) return;
      abortController = new AbortController();
      setRunning(true);
      const settings = await getSettings();
      const count = settings?.poshmark?.autoShareCount || 50;
      const [delayMin, delayMax] = settings?.poshmark?.autoShareDelay || [3, 8];

      updateStatus(`Loading closet... scrolling to find listings`);
      log(`Starting closet share — target: ${count}`);

      // Scroll to load all listings (Poshmark lazy-loads)
      let lastImgCount = 0;
      let stableCount = 0;
      let scrollAttempts = 0;
      const maxScrollAttempts = 30; // Safety: max 30 scroll iterations
      while (stableCount < 2 && scrollAttempts < maxScrollAttempts) {
        scrollAttempts++;
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
            incrementUsage();
            updateStatus(`Shared ${shared}/${toShare.length}`);
          }
          await randomDelay(delayMin, delayMax);
        } catch (e) {
          log(`Error sharing listing ${i}: ${e.message}`);
        }
      }

      updateStatus(`✅ Done! Shared ${shared} listings.`);
      setRunning(false);
    });

    // ── Share Community Feed ──
    panel.querySelector("#rb-community").addEventListener("click", async () => {
      if (running) return;
      if (!(await checkLimit())) return;
      abortController = new AbortController();
      setRunning(true);
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
            incrementUsage();
            updateStatus(`Shared feed ${shared}/${toShare.length}`);
          }
          await randomDelay(delayMin, delayMax);
        } catch (e) {
          log(`Error sharing feed ${i}: ${e.message}`);
        }
      }

      updateStatus(`✅ Done! ${shared} feed items shared.`);
      setRunning(false);
    });

    // ── Like Feed Items ──
    panel.querySelector("#rb-like").addEventListener("click", async () => {
      if (running) return;
      if (!(await checkLimit())) return;
      abortController = new AbortController();
      setRunning(true);
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
          incrementUsage();
          updateStatus(`Liked ${liked}/${toLike.length}`);
          await randomDelay(delayMin, delayMax);
        } catch (e) {
          log(`Error liking ${i}: ${e.message}`);
        }
      }

      updateStatus(`✅ Done! Liked ${liked} items.`);
      setRunning(false);
    });

    // ── Follow Users ──
    panel.querySelector("#rb-follow").addEventListener("click", async () => {
      if (running) return;
      if (!(await checkLimit())) return;
      abortController = new AbortController();
      setRunning(true);
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
          incrementUsage();
          updateStatus(`Followed ${followed}/${toFollow.length}`);
          await randomDelay(delayMin, delayMax);
        } catch (e) {
          log(`Error following ${i}: ${e.message}`);
        }
      }

      updateStatus(`✅ Done! Followed ${followed} users.`);
      setRunning(false);
    });

    // ── Unfollow Non-Followers ──

    panel.querySelector("#rb-unfollow").addEventListener("click", async () => {
      if (running) return;
      if (!(await checkLimit())) return;
      abortController = new AbortController();
      setRunning(true);
      const settings = await getSettings();
      const count = settings?.poshmark?.autoUnfollowCount || 30;
      const [delayMin, delayMax] = settings?.poshmark?.autoShareDelay || [3, 8];

      // Navigate to following page if not already there
      const currentUrl = window.location.href;
      const followingMatch = currentUrl.match(/poshmark\.com\/user\/([^/]+)\/following/);
      if (!followingMatch) {
        // Try to get username from page
        const userLink = document.querySelector('a[href*="/closet/"], a[data-et-name="my_closet"]');
        const username = userLink?.href?.match(/closet\/([^/?]+)/)?.[1];
        if (username) {
          updateStatus("Navigating to your following list...");
          window.location.href = `https://poshmark.com/user/${username}/following`;
          return; // Page will reload, panel will re-inject
        } else {
          updateStatus("⚠️ Go to your profile → Following page first");
          setRunning(false);
          return;
        }
      }

      updateStatus(`Loading following list... scrolling`);
      log(`Starting unfollow non-followers — target: ${count}`);

      // Scroll to load all followed users
      let lastCount = 0;
      let stableCount = 0;
      let scrollAttempts = 0;
      while (stableCount < 2 && scrollAttempts < 20) {
        scrollAttempts++;
        const cards = document.querySelectorAll('.user-following-card, .following-card, div[class*="user-card"], [data-et-name="follow_user"]');
        if (cards.length === lastCount) {
          stableCount++;
        } else {
          stableCount = 0;
          lastCount = cards.length;
          const last = cards[cards.length - 1];
          if (last) last.scrollIntoView({ behavior: "smooth" });
        }
        await randomDelay(2, 3);
      }

      // Find "Following" buttons (not "Follow" — we want to unfollow people not following back)
      // On the following page, look for users who don't have a "Follows You" badge
      const userCards = document.querySelectorAll('.user-following-card, .following-card, div[class*="user-card"]');
      let unfollowed = 0;

      for (let i = 0; i < userCards.length && unfollowed < count; i++) {
        if (abortController.signal.aborted) break;
        try {
          const card = userCards[i];

          // Skip if they follow back (look for "Follows You" indicator)
          const followsYou = card.querySelector(
            '.follows-you, [class*="follows-you"], [data-et-name="follows_you"], span[class*="mutual"]'
          );
          if (followsYou) continue;

          // Find the unfollow/following button
          const unfollowBtn = card.querySelector(
            'button[data-et-name="unfollow"], button[data-et-name="user_unfollow"], ' +
            'button.following-btn, button[class*="following"], ' +
            'div[data-et-name="user_follow"] button, .follow-unfollow-btn'
          );
          if (!unfollowBtn) continue;

          unfollowBtn.style.backgroundColor = "#ef4444";
          unfollowBtn.click();
          unfollowed++;
          incrementCounter();
          incrementUsage();
          updateStatus(`Unfollowed ${unfollowed}/${count} non-followers`);
          await randomDelay(delayMin, delayMax);
        } catch (e) {
          log(`Error unfollowing user ${i}: ${e.message}`);
        }
      }

      updateStatus(`✅ Done! Unfollowed ${unfollowed} non-followers.`);
      setRunning(false);
    });

    // ── Auto-Relist Old Items (Premium) ──

    panel.querySelector("#rb-relist").addEventListener("click", async () => {
      if (running) return;

      const premium = await isPremium();
      if (!premium) {
        updateStatus("🔒 Auto-Relist requires Pro license");
        alert("ResellBuddy: Auto-Relist is a Pro-only feature. Upgrade to unlock it!");
        chrome.runtime.sendMessage({ type: "openPaymentPage" });
        return;
      }

      if (!(await checkLimit())) return;
      abortController = new AbortController();
      setRunning(true);
      const settings = await getSettings();
      const maxRelist = settings?.poshmark?.relistMaxPerRun || 10;

      updateStatus("Scrolling closet to find listings...");
      log(`Starting auto-relist — max: ${maxRelist}`);

      // Scroll to load all listings
      let lastImgCount = 0;
      let stableCount = 0;
      let scrollAttempts = 0;
      while (stableCount < 2 && scrollAttempts < 30) {
        scrollAttempts++;
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

      // Collect listing links
      const listingLinks = document.querySelectorAll('a[href*="/listing/"]');
      const listings = [];
      const seen = new Set();

      for (const link of listingLinks) {
        const href = link.getAttribute("href");
        if (seen.has(href)) continue;
        seen.add(href);

        const card = link.closest('div[class*="col"]');
        if (!card) continue;
        if (card.querySelector('.sold-tag, .not-for-sale-tag')) continue;

        listings.push({ href, card });
      }

      if (listings.length === 0) {
        updateStatus("No listings found in your closet.");
        setRunning(false);
        return;
      }

      // Use hidden iframe approach (same as offer-to-likers)
      const toRelist = listings.slice(0, maxRelist);
      updateStatus(`Found ${listings.length} listings. Relisting ${toRelist.length}...`);

      let relisted = 0;
      let skipped = 0;

      let iframe = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1024px;height:768px;border:none;";
      document.body.appendChild(iframe);

      for (let i = 0; i < toRelist.length; i++) {
        if (abortController.signal.aborted) {
          updateStatus(`⏹ Stopped. Relisted ${relisted} items.`);
          break;
        }

        try {
          const { href } = toRelist[i];
          updateStatus(`[${i + 1}/${toRelist.length}] Loading listing...`);

          const fullUrl = href.startsWith("http") ? href : `https://poshmark.com${href}`;

          await new Promise((resolve) => {
            iframe.onload = resolve;
            iframe.src = fullUrl;
            setTimeout(resolve, 15000);
          });
          await randomDelay(2, 4);

          const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (!iDoc) {
            log(`Cannot access iframe for ${href} — skipping`);
            skipped++;
            continue;
          }

          // Find the "Copy Listing" or "Relist" button
          const relistBtn = iDoc.querySelector(
            'a[data-et-name="copy_listing"], button[data-et-name="copy_listing"], ' +
            'a[href*="/create-listing?copy="], .copy-listing-btn, ' +
            'button[data-et-name="relist"], a[data-et-name="relist"]'
          );

          if (!relistBtn) {
            log(`No relist button for ${href} — skipping`);
            skipped++;
            continue;
          }

          // Click relist/copy listing
          relistBtn.click();
          await randomDelay(2, 3);

          // If it opens a creation page in iframe, try to find and click publish
          const publishBtn = iDoc.querySelector(
            'button[data-et-name="publish_listing"], button[type="submit"], ' +
            '.publish-btn, button.listing-submit'
          );

          if (publishBtn) {
            publishBtn.click();
            relisted++;
            incrementCounter();
            incrementUsage();
            updateStatus(`[${i + 1}/${toRelist.length}] Relisted! (${relisted} done)`);
            log(`Relisted ${href}`);
          } else {
            // The copy might have opened a new tab — count as success
            relisted++;
            incrementCounter();
            incrementUsage();
            updateStatus(`[${i + 1}/${toRelist.length}] Copy opened (${relisted} done)`);
          }

          await randomDelay(8, 15);
        } catch (e) {
          log(`Error relisting ${i}: ${e.message}`);
          skipped++;
        }
      }

      iframe.remove();
      updateStatus(`✅ Done! ${relisted} relisted, ${skipped} skipped.`);
      setRunning(false);
    });



    // ── Offer to Likers (Premium) ──
    const MAX_OFFERS_PER_DAY = 20;

    panel.querySelector("#rb-offer-likers").addEventListener("click", async () => {
      if (running) return;

      // Premium gate
      const premium = await isPremium();
      if (!premium) {
        updateStatus("🔒 Offer to Likers requires Pro license");
        alert("ResellBuddy: Send Offers to Likers is a Pro-only feature. Upgrade to unlock it!");
        chrome.runtime.sendMessage({ type: "openPaymentPage" });
        return;
      }

      abortController = new AbortController();
      setRunning(true);
      const settings = await getSettings();
      const offerDiscount = settings?.poshmark?.offerDiscount ?? 10;
      const minPrice = settings?.poshmark?.offerMinPrice ?? 5;
      const maxOffers = settings?.poshmark?.offerMaxPerRun ?? 20;

      // Daily cap
      const usage = await getUsage();
      const offerUsageToday = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "getOfferUsage" }, (r) => resolve(r?.count || 0));
      });
      if (offerUsageToday >= MAX_OFFERS_PER_DAY) {
        updateStatus(`⚠️ Daily offer limit reached (${MAX_OFFERS_PER_DAY}/day). Try again tomorrow.`);
        setRunning(false);
        return;
      }
      const remainingToday = MAX_OFFERS_PER_DAY - offerUsageToday;
      const effectiveMax = Math.min(maxOffers, remainingToday);

      if (effectiveMax <= 0) {
        updateStatus("⚠️ No offers remaining today.");
        setRunning(false);
        return;
      }

      updateStatus("Scrolling closet to find liked listings...");
      log(`Starting Offer to Likers — discount: ${offerDiscount}%, minPrice: $${minPrice}, max: ${effectiveMax}`);

      // Scroll to load all listings
      let lastImgCount = 0;
      let stableCount = 0;
      let scrollAttempts = 0;
      while (stableCount < 2 && scrollAttempts < 30) {
        scrollAttempts++;
        const cards = document.querySelectorAll('.item-card, .closet-item, div[class*="tile"]');
        const imgs = document.querySelectorAll('a[href*="/listing/"] img');
        const count = Math.max(cards.length, imgs.length);
        if (count === lastImgCount) {
          stableCount++;
        } else {
          stableCount = 0;
          lastImgCount = count;
          const last = imgs[imgs.length - 1];
          if (last) last.scrollIntoView({ behavior: "smooth" });
        }
        await randomDelay(2, 3);
      }

      // Collect listing links with their like indicators
      const listingLinks = document.querySelectorAll('a[href*="/listing/"]');
      const listings = [];
      const seen = new Set();

      for (const link of listingLinks) {
        const href = link.getAttribute("href");
        if (seen.has(href)) continue;
        seen.add(href);

        const card = link.closest('div[class*="col"]') || link.closest('.item-card, .closet-item, div[class*="tile"]');
        if (!card) continue;

        // Skip sold
        if (card.querySelector('.sold-tag, .not-for-sale-tag')) continue;

        // Look for like count indicators
        const likeCountEl = card.querySelector(
          '.social-action-bar__like-count, .like-count, [data-et-name="like"] .count, ' +
          'span[class*="like"] span, .social-counts span:first-child'
        );
        let likeCount = 0;
        if (likeCountEl) {
          likeCount = parseInt(likeCountEl.textContent.trim(), 10) || 0;
        }

        // Also check for filled/active like icon as indicator
        const likeIcon = card.querySelector('div[data-et-name="like"].liked, .social-action-bar__like.liked');
        if (likeIcon && likeCount === 0) likeCount = 1;

        if (likeCount > 0) {
          listings.push({ href, card, likeCount });
        }
      }

      if (listings.length === 0) {
        updateStatus("No listings with likes found. Share more items to get likes first!");
        setRunning(false);
        return;
      }

      // Sort by like count descending (most likes first = highest conversion)
      listings.sort((a, b) => b.likeCount - a.likeCount);

      const toOffer = listings.slice(0, effectiveMax);

      if (toOffer.length > 10) {
        updateStatus(`⚠️ Found ${toOffer.length} items. Sending offers may take a while...`);
      } else {
        updateStatus(`Found ${toOffer.length} listings with likes. Sending offers...`);
      }

      let offersSent = 0;
      let skipped = 0;

      // Use a hidden iframe to load each listing without destroying the content script
      let iframe = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1024px;height:768px;border:none;";
      document.body.appendChild(iframe);

      for (let i = 0; i < toOffer.length; i++) {
        if (abortController.signal.aborted) {
          updateStatus(`⏹ Stopped. Sent ${offersSent} offers.`);
          break;
        }

        try {
          const { href } = toOffer[i];
          updateStatus(`[${i + 1}/${toOffer.length}] Loading listing...`);

          const fullUrl = href.startsWith("http") ? href : `https://poshmark.com${href}`;

          // Load listing in hidden iframe
          await new Promise((resolve) => {
            iframe.onload = resolve;
            iframe.src = fullUrl;
            setTimeout(resolve, 12000);
          });
          await randomDelay(2, 3);

          const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (!iDoc) {
            log(`Cannot access iframe for ${href} (cross-origin) — skipping`);
            skipped++;
            continue;
          }

          // Check price in iframe
          const priceEl = iDoc.querySelector(
            '.listing-price, [data-test="listing-price"], .price-display, .listing__price'
          );
          if (priceEl) {
            const priceText = priceEl.textContent.replace(/[^0-9.]/g, "");
            const price = parseFloat(priceText);
            if (!isNaN(price) && price < minPrice) {
              log(`Skipping ${href} — price $${price} below threshold $${minPrice}`);
              skipped++;
              updateStatus(`[${i + 1}/${toOffer.length}] Skipped (price too low)`);
              continue;
            }
          }

          // Find Offer button in iframe
          const offerBtn = iDoc.querySelector(
            'button[data-et-name="offer"], div[data-et-name="make_offer"], ' +
            'button[data-et-name="make_offer"], .offer-button, a[data-et-name="offer"]'
          );
          if (!offerBtn) {
            log(`No offer button found for ${href} — skipping`);
            skipped++;
            continue;
          }

          offerBtn.click();
          await randomDelay(2, 4);

          const alreadySent = iDoc.querySelector(
            '.offer-sent, .already-offered, [data-test="offer-already-sent"], .toast-notification'
          );
          if (alreadySent) {
            log(`Already sent offer for ${href} — skipping`);
            skipped++;
            const closeBtn = iDoc.querySelector('.modal .close, .overlay .close, button[data-et-name="close"]');
            if (closeBtn) closeBtn.click();
            continue;
          }

          const priceInput = iDoc.querySelector(
            '.offer-modal input[type="text"], .offer-modal input[type="number"], ' +
            'input.offer-price, input[data-test="offer-price"], ' +
            '.modal input[name*="price"], .modal input[placeholder*="price" i], ' +
            '.modal input[class*="price"]'
          );
          if (priceInput) {
            const currentPriceEl = iDoc.querySelector(
              '.offer-modal .current-price, .offer-modal .original-price, ' +
              '.modal .listing-price, .modal [class*="price"] span'
            );
            let currentPrice = 0;
            if (currentPriceEl) {
              currentPrice = parseFloat(currentPriceEl.textContent.replace(/[^0-9.]/g, ""));
            }
            if (!currentPrice && priceEl) {
              currentPrice = parseFloat(priceEl.textContent.replace(/[^0-9.]/g, ""));
            }
            if (currentPrice > 0) {
              const offerPrice = (currentPrice * (1 - offerDiscount / 100)).toFixed(2);
              priceInput.focus();
              priceInput.select();
              iframe.contentWindow.document.execCommand("selectAll", false, null);
              iframe.contentWindow.document.execCommand("insertText", false, offerPrice);
              await randomDelay(0.5, 1);
            }
          }

          const sendBtn = iDoc.querySelector(
            '.offer-modal button[type="submit"], .offer-modal .send-offer, ' +
            'button[data-et-name="send_offer"], .modal .btn-primary, button[data-test="send-offer"]'
          );
          if (sendBtn) {
            sendBtn.click();
            offersSent++;
            incrementCounter();
            incrementUsage();
            chrome.runtime.sendMessage({ type: "incrementOfferUsage" });
            updateStatus(`[${i + 1}/${toOffer.length}] Offer sent! (${offersSent} sent, ${skipped} skipped)`);
            log(`Offer sent for ${href} — ${offersSent} total`);
          } else {
            log(`No send button found in offer modal for ${href}`);
            skipped++;
            const closeBtn = iDoc.querySelector('.modal .close, .overlay .close, button[data-et-name="close"]');
            if (closeBtn) closeBtn.click();
          }

          await randomDelay(5, 12);
        } catch (e) {
          log(`Error sending offer for listing ${i}: ${e.message}`);
          skipped++;
        }
      }

      // Cleanup
      iframe.remove();

      updateStatus(`✅ Done! ${offersSent} offers sent, ${skipped} skipped.`);
      setRunning(false);
    });

    // ── Share to Posh Party ──
    panel.querySelector("#rb-party-share").addEventListener("click", async () => {
      if (running) return;

      // Premium gate
      const premium = await isPremium();
      if (!premium) {
        updateStatus("🔒 Share to Posh Party requires Pro license");
        alert("ResellBuddy: Share to Posh Party is a Pro-only feature. Upgrade to unlock it!");
        chrome.runtime.sendMessage({ type: "openPaymentPage" });
        return;
      }

      // Daily limit check
      const withinLimit = await checkLimit();
      if (!withinLimit) {
        updateStatus("⚠️ Daily action limit reached. Try again tomorrow or upgrade to Pro for unlimited.");
        return;
      }

      abortController = new AbortController();
      setRunning(true);

      try {
        // Navigate to Posh Party page if not already there
        if (!window.location.href.includes("/party")) {
          updateStatus("🎉 Navigating to Posh Party page...");
          window.location.href = "https://poshmark.com/party";
          // Page will reload; handler re-runs on next injection
          return;
        }

        // Find the active party
        updateStatus("🎉 Looking for active Posh Party...");
        await randomDelay(2, 4);

        const partyLinks = document.querySelectorAll(
          'a[href*="/party/"], .party-card a, .party__link, a[data-et-name="party"]'
        );

        if (partyLinks.length === 0) {
          // Try broader selectors for party listing cards
          const partyCards = document.querySelectorAll(
            '.party, [class*="party-card"], [class*="PartyCard"], section[class*="party"] a'
          );
          if (partyCards.length === 0) {
            updateStatus("⚠️ No active Posh Parties found right now. Try again later!");
            setRunning(false);
            return;
          }
        }

        // Click into the first active party
        let partyLink = partyLinks[0];
        if (!partyLink) {
          const fallbackLink = document.querySelector('a[href*="/party/"]');
          if (!fallbackLink) {
            updateStatus("⚠️ Could not find an active party to join.");
            setRunning(false);
            return;
          }
          partyLink = fallbackLink;
        }

        const partyName = partyLink.textContent.trim().substring(0, 40) || "Posh Party";
        updateStatus(`🎉 Joining ${partyName}...`);
        partyLink.click();
        await randomDelay(3, 5);

        // Wait for party page listing cards to load
        updateStatus("🎉 Waiting for party listings to load...");
        let cards = [];
        let waitAttempts = 0;
        while (cards.length === 0 && waitAttempts < 10) {
          await randomDelay(2, 3);
          cards = document.querySelectorAll(
            '.item-card, .closet-item, div[class*="tile"], .social-listings .tile'
          );
          waitAttempts++;
        }

        if (cards.length === 0) {
          updateStatus("⚠️ No listing cards found on the party page.");
          setRunning(false);
          return;
        }

        // Scroll to load more cards
        let lastCardCount = cards.length;
        let stableScrolls = 0;
        let scrollAttempts = 0;
        while (stableScrolls < 2 && scrollAttempts < 15) {
          scrollAttempts++;
          window.scrollTo(0, document.body.scrollHeight);
          await randomDelay(2, 3);
          cards = document.querySelectorAll(
            '.item-card, .closet-item, div[class*="tile"], .social-listings .tile'
          );
          if (cards.length === lastCardCount) {
            stableScrolls++;
          } else {
            stableScrolls = 0;
            lastCardCount = cards.length;
          }
        }

        updateStatus(`🎉 Found ${cards.length} listings. Sharing to party...`);

        let shared = 0;
        let skipped = 0;
        const maxShares = Math.min(cards.length, 50); // Cap at 50 per run

        for (let i = 0; i < maxShares; i++) {
          if (abortController.signal.aborted) {
            updateStatus(`⏹ Stopped. Shared ${shared} listings to party.`);
            break;
          }

          const card = cards[i];
          try {
            // Find the share button on this card
            const shareBtn = card.querySelector(
              'div[data-et-name="share"], button[data-et-name="share"], ' +
              '.social-action-bar__share, .share-btn, a[data-et-name="share"]'
            );

            if (!shareBtn) {
              log(`No share button on card ${i} — skipping`);
              skipped++;
              continue;
            }

            shareBtn.click();
            await randomDelay(1, 2);

            // Look for the "Share to Party" option in the share menu
            const shareToPartyBtn = document.querySelector(
              'div[data-et-name="share_to_party"], button[data-et-name="share_to_party"], ' +
              '.share-to-party, [class*="share-to-party"], .share-menu button:nth-child(2), ' +
              'ul.dropdown li:nth-child(2) button, .share__dropdown button:nth-child(2)'
            );

            if (shareToPartyBtn) {
              shareToPartyBtn.click();
              shared++;
              incrementCounter();
              incrementUsage();
              updateStatus(`🎉 [${i + 1}/${maxShares}] Shared to party! (${shared} shared, ${skipped} skipped)`);
              log(`Shared listing ${i + 1} to Posh Party`);
            } else {
              // Fallback: the first click may have already shared to party
              // or share menu structure differs
              shared++;
              incrementCounter();
              incrementUsage();
              updateStatus(`🎉 [${i + 1}/${maxShares}] Shared! (${shared} shared, ${skipped} skipped)`);
              log(`Shared listing ${i + 1} (fallback share)`);
            }

            await randomDelay(5, 10);
          } catch (e) {
            log(`Error sharing card ${i}: ${e.message}`);
            skipped++;
          }
        }

        updateStatus(`✅ Party sharing done! ${shared} shared, ${skipped} skipped.`);
      } catch (e) {
        log(`Party share error: ${e.message}`);
        updateStatus(`❌ Error: ${e.message}`);
      }

      setRunning(false);
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
