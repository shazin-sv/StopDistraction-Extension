
const PLATFORM = window.location.hostname.includes('instagram') ? 'instagram' : 'youtube';

// --- Default Settings ---
const DEFAULT_SETTINGS = {
    dailyLimitMinutes: 30,
    blurEnabled: true,
    floatingCounter: true,
    mode: 'normal',
    alertInterval: 10
};

// --- State ---
let state = {
    daily: null,
    session: null,
    settings: null // Will be loaded
};

let timeInterval = null;
let lastUrl = window.location.href; // Track the last processed URL
let overlayDisplayed = false;
let floatInterval = null;

// --- DOM Elements ---
let floatingCounterEl = null;

// --- Helpers ---
function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
}

// --- Storage Manager ---
async function loadData() {
    try {
        const data = await chrome.storage.local.get(['dailyStats', 'sessionStats', 'settings', 'history']);
        const today = new Date().toDateString();

        // 1. Settings
        state.settings = { ...DEFAULT_SETTINGS, ...data.settings };

        // 2. Daily Stats
        let daily = data.dailyStats;

        // Check if daily stats exist and are for today
        if (!daily || daily.date !== today) {
            if (daily && data.history) {
                const history = data.history || {};
                history[daily.date] = daily;
                chrome.storage.local.set({ history });
            }
            daily = createEmptyStats(today);
        }

        if (!daily.hourly) daily.hourly = new Array(24).fill(0);

        state.daily = daily;
        state.session = data.sessionStats || createEmptyStats(null);
        state.session.hourly = state.session.hourly || new Array(24).fill(0); // Ensure structure

        return state;
    } catch (e) {
        console.error("Stop Distraction: Error loading data", e);
        state.daily = createEmptyStats(new Date().toDateString());
        state.session = createEmptyStats(null);
        state.settings = DEFAULT_SETTINGS;
        return state;
    }
}

function createEmptyStats(date) {
    return {
        date: date, // null for session
        instagram: 0,
        youtube: 0,
        instagramTime: 0,
        youtubeTime: 0,
        hourly: new Array(24).fill(0)
    };
}

async function saveData() {
    await chrome.storage.local.set({
        dailyStats: state.daily,
        sessionStats: state.session
    });
}

// --- Core Logic ---

async function handleNewVideo() {
    console.log('[Stop Distraction] New video detected:', window.location.href);
    await loadData(); // Always sync latest state first

    const hour = new Date().getHours();

    // Increment Counts
    state.daily[PLATFORM] = (state.daily[PLATFORM] || 0) + 1;
    state.session[PLATFORM] = (state.session[PLATFORM] || 0) + 1;

    // Update Hourly
    if (state.daily.hourly && state.daily.hourly[hour] !== undefined) {
        state.daily.hourly[hour]++;
    }

    await saveData();

    updateFloatingCounter();
    checkAlerts(true);
}

async function tickTime() {
    if (document.hidden) return;
    await loadData();

    const timeKey = `${PLATFORM}Time`;
    state.daily[timeKey] = (state.daily[timeKey] || 0) + 1;
    state.session[timeKey] = (state.session[timeKey] || 0) + 1;

    await saveData();

    updateFloatingCounter();
    checkLimits();
}

// --- Enforcements ---

function checkLimits() {
    const totalDailyTime = (state.daily.instagramTime || 0) + (state.daily.youtubeTime || 0);
    const limitSeconds = state.settings.dailyLimitMinutes * 60;

    if (state.settings.blurEnabled && limitSeconds > 0 && totalDailyTime >= limitSeconds) {
        showBlurOverlay(state.settings.dailyLimitMinutes);
    }
}

// ALERT CHECKER MODIFIED HERE
function checkAlerts(isNewContent) {
    if (!isNewContent) return;
    const currentCount = state.session[PLATFORM];

    if (state.settings.alertInterval > 0 && currentCount > 0 && currentCount % state.settings.alertInterval === 0) {
        if (state.settings.blurEnabled) {
            showBlurOverlay(null, `You've watched ${currentCount} ${PLATFORM === 'instagram' ? 'Reels' : 'Shorts'}. Take a breath.`);
        } else {
            showToast(`You've scrolled ${currentCount} ${PLATFORM === 'instagram' ? 'Reels' : 'Shorts'}.`);
        }
    }
}

// --- UI Components ---

function createFloatingCounter() {
    if (document.getElementById('sd-floating-counter')) return;

    const div = document.createElement('div');
    div.id = 'sd-floating-counter';
    div.innerHTML = `
    <span id="sd-fc-count">0</span>
    <span style="opacity:0.5">•</span>
    <span id="sd-fc-time">0m</span>
  `;
    document.body.appendChild(div);
    floatingCounterEl = div;
}

function updateFloatingCounter() {
    if (!state.settings || !state.settings.floatingCounter) {
        if (floatingCounterEl) floatingCounterEl.style.display = 'none';
        return;
    }

    if (!floatingCounterEl) createFloatingCounter();
    floatingCounterEl.style.display = 'flex';

    const count = state.session[PLATFORM] || 0;
    const time = state.session[`${PLATFORM}Time`] || 0;

    const cInfo = document.getElementById('sd-fc-count');
    const tInfo = document.getElementById('sd-fc-time');
    if (cInfo) cInfo.textContent = count;
    if (tInfo) tInfo.textContent = formatTime(time);

    // Color logic
    const totalTime = (state.daily.instagramTime || 0) + (state.daily.youtubeTime || 0);
    const limit = (state.settings.dailyLimitMinutes || 30) * 60;

    if (limit > 0 && totalTime >= limit) {
        floatingCounterEl.classList.add('limit-reached');
    } else {
        floatingCounterEl.classList.remove('limit-reached');
    }
}


function checkStrictMode() {
    if (state.settings.mode === 'study') {
        // Immediate block if is target content
        if (isTargetContent(window.location.href)) {
            showBlurOverlay(null, 'Study Mode Active. No distractions allowed.', true);
        }
    }
}

function showBlurOverlay(limitMins, customMessage, isStrict) {
    if (overlayDisplayed) return;
    if (document.getElementById('sd-blur-overlay')) return;

    const title = isStrict ? "Study Mode Locked" : (limitMins ? "Daily Limit Reached" : "Breathing Space");
    const message = customMessage || `You've hit your goal of ${limitMins} minutes.`;

    // Different actions based on strict mode
    let actionsHtml = '';

    if (isStrict) {
        actionsHtml = `
       <button class="sd-btn sd-btn-primary" id="sd-go-home">Go Home</button>
       <button class="sd-btn" id="sd-close-tab">Close Tab</button>
     `;
    } else {
        // Normal logic
        actionsHtml = `
       <button class="sd-btn sd-btn-primary" id="sd-close-tab">Close Tab</button>
       <button class="sd-btn" id="sd-extend-5">5 More Mins</button>
       ${!limitMins ? '<button class="sd-btn" id="sd-continue">Continue</button>' : ''}
     `;
    }

    const overlay = document.createElement('div');
    overlay.id = 'sd-blur-overlay';
    overlay.innerHTML = `
    <h1>${title}</h1>
    <p>${message}</p>
    <div style="display:flex; gap:10px;">
       ${actionsHtml}
    </div>
  `;
    document.body.appendChild(overlay);
    overlayDisplayed = true;
    document.body.style.overflow = 'hidden';

    // Common listeners
    const closeTabBtn = document.getElementById('sd-close-tab');
    if (closeTabBtn) {
        closeTabBtn.onclick = () => {
            // Best effort to close or redirect
            window.location.href = 'https://google.com';
        };
    }

    const goHomeBtn = document.getElementById('sd-go-home');
    if (goHomeBtn) {
        goHomeBtn.onclick = () => {
            const home = PLATFORM === 'instagram' ? 'https://www.instagram.com' : 'https://www.youtube.com';
            window.location.href = home;
        };
    }

    const extendBtn = document.getElementById('sd-extend-5');
    if (extendBtn) {
        extendBtn.onclick = async () => {
            state.settings.dailyLimitMinutes += 5;
            await chrome.storage.local.set({ settings: state.settings });
            overlay.remove();
            overlayDisplayed = false;
            document.body.style.overflow = '';
        };
    }

    const continueBtn = document.getElementById('sd-continue');
    if (continueBtn) {
        continueBtn.onclick = () => {
            overlay.remove();
            overlayDisplayed = false;
            document.body.style.overflow = '';
        };
    }
}

function showToast(message) {
    let toast = document.getElementById('sd-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'sd-toast';
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<span class="icon">🛑</span> ${message}`;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 4000);
}

// --- Detection Logic ---

function isTargetContent(url) {
    if (!url) return false;

    if (PLATFORM === 'instagram') {
        return url.includes('/reel/') || url.includes('/reels/');
    } else if (PLATFORM === 'youtube') {
        return url.includes('/shorts/');
    }
    return false;
}

function startTimer() {
    if (!timeInterval) {
        timeInterval = setInterval(tickTime, 1000);
    }
}

function stopTimer() {
    if (timeInterval) {
        clearInterval(timeInterval);
        timeInterval = null;
    }
}

// Main processing function
function processCurrentState() {
    const currentUrl = window.location.href;
    const isTarget = isTargetContent(currentUrl);

    if (isTarget && currentUrl !== lastUrl) {
        handleNewVideo();
    }

    lastUrl = currentUrl;

    if (isTarget) {
        checkStrictMode(); // Immediate check
        startTimer();
        updateFloatingCounter(); // Ensure visible
    } else {
        stopTimer();
        if (floatingCounterEl) floatingCounterEl.style.display = 'none';
    }
}

// --- Initialization & Observers ---

(async function init() {
    await loadData();

    // Initial check
    if (isTargetContent(window.location.href)) {
        handleNewVideo();
        checkStrictMode();
        startTimer();
    }

    const observer = new MutationObserver(() => {
        if (window.location.href !== lastUrl) {
            processCurrentState();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(() => {
        if (window.location.href !== lastUrl) {
            processCurrentState();
        }
    }, 1000);

})();
