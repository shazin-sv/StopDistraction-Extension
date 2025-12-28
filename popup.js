
// Default settings if missing
const DEFAULT_SETTINGS = {
    dailyLimitMinutes: 30,
    blurEnabled: true,
    floatingCounter: true,
    mode: 'normal',
    alertInterval: 10
};

// DOM Elements
const tabs = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// Inputs
const els = {
    homeYtCount: document.getElementById('home-yt-count'),
    homeYtTime: document.getElementById('home-yt-time'),
    homeIgCount: document.getElementById('home-ig-count'),
    homeIgTime: document.getElementById('home-ig-time'),

    scoreVal: document.getElementById('score-val'),
    motivationalMsg: document.getElementById('motivational-msg'),

    limitFill: document.getElementById('limit-fill'),
    limitText: document.getElementById('limit-progress-text'),

    yesterdayTotal: document.getElementById('yesterday-total-time'),
    todayTotal: document.getElementById('today-total-time'),
    peakHour: document.getElementById('peak-hour'),
    wastedTime: document.getElementById('wasted-time'),

    settingLimit: document.getElementById('setting-limit'),
    settingAlert: document.getElementById('setting-alert'),
    settingBlur: document.getElementById('setting-blur'),
    settingFloating: document.getElementById('setting-floating'),
    settingMode: document.getElementById('setting-mode'),

    resetBtn: document.getElementById('reset-session-btn')
};

// Utils
function formatTime(seconds) {
    if (!seconds) return '0m';
    const m = Math.floor(seconds / 60);
    // if less than a minute, show seconds roughly?
    if (m < 1) return '<1m';
    const h = Math.floor(m / 60);
    const min = m % 60;
    if (h > 0) return `${h}h ${min}m`;
    return `${min}m`;
}

function getDistractionScore(timeSeconds, count) {
    // 1 pt per minute, 0.5 pt per video
    return Math.floor((timeSeconds / 60) + (count * 0.5));
}

function getMotivationalMessage(score) {
    if (score < 5) return "Clean sheet. Stay sharp.";
    if (score < 20) return "Don't get sucked in.";
    if (score < 50) return "You are wasting precious time.";
    if (score < 80) return "Stop scrolling. Do real work.";
    return "You have lost control. Close tab!";
}

function getPeakHour(hourlyArray) {
    if (!hourlyArray || hourlyArray.length === 0) return '--';
    let max = -1;
    let index = -1;
    hourlyArray.forEach((val, i) => {
        if (val > max) {
            max = val;
            index = i;
        }
    });
    if (max === 0) return '--';
    // convert 13 -> 1 PM
    const suffix = index >= 12 ? 'PM' : 'AM';
    const h = index % 12 || 12;
    return `${h} ${suffix}`;
}

// Logic
async function loadData() {
    const data = await chrome.storage.local.get(['dailyStats', 'sessionStats', 'settings', 'history']);
    const today = new Date().toDateString();

    const daily = data.dailyStats || { date: today, instagram: 0, youtube: 0, instagramTime: 0, youtubeTime: 0, hourly: [] };
    const history = data.history || {};

    // Find yesterday
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = yesterdayDate.toDateString();
    const yesterday = history[yesterdayStr]; // might be undefined

    const settings = { ...DEFAULT_SETTINGS, ...data.settings };

    renderHome(daily, settings);
    renderStats(daily, yesterday);
    renderSettings(settings);
}


function renderHome(daily, settings) {
    // Counts
    els.homeYtCount.textContent = daily.youtube || 0;
    els.homeIgCount.textContent = daily.instagram || 0;

    els.homeYtTime.textContent = formatTime(daily.youtubeTime || 0);
    els.homeIgTime.textContent = formatTime(daily.instagramTime || 0);

    // Score
    const totalTime = (daily.youtubeTime || 0) + (daily.instagramTime || 0);
    const totalCount = (daily.youtube || 0) + (daily.instagram || 0);
    const score = getDistractionScore(totalTime, totalCount);
    els.scoreVal.textContent = score;
    els.motivationalMsg.textContent = getMotivationalMessage(score);

    // Progress Bar
    const limitMins = settings.dailyLimitMinutes || 30;
    const usedMins = Math.floor(totalTime / 60);
    const pct = Math.min((usedMins / limitMins) * 100, 100);

    els.limitFill.style.width = `${pct}%`;
    els.limitText.textContent = `${usedMins}m / ${limitMins}m`;

    if (pct >= 100) els.limitFill.style.backgroundColor = '#ff0000';
    else els.limitFill.style.backgroundColor = ''; // reset to gradient
}



function renderChart(hourlyData) {
    const container = document.getElementById('hourly-chart');
    container.innerHTML = '';

    // Find max value for normalization
    let max = 0;
    if (hourlyData) {
        hourlyData.forEach(v => {
            if (v > max) max = v;
        });
    }

    // Create 24 bars
    for (let i = 0; i < 24; i++) {
        const val = (hourlyData && hourlyData[i]) ? hourlyData[i] : 0;
        const bar = document.createElement('div');
        bar.className = 'chart-bar';

        // Height percentage (min 5% so it shows up)
        let h = 0;
        if (max > 0) {
            h = (val / max) * 100;
        }
        // Add tooltip title
        bar.title = `${i}:00 - ${val} distractions`;
        bar.style.height = `${Math.max(h, 2)}%`;

        // Highlight if peak
        if (val === max && max > 0) {
            bar.style.background = '#ffffff';
            bar.style.opacity = '1';
        }

        container.appendChild(bar);
    }
}

function renderStats(daily, yesterday) {
    const todayTime = (daily.youtubeTime || 0) + (daily.instagramTime || 0);
    const yestTime = yesterday ? (yesterday.youtubeTime || 0) + (yesterday.instagramTime || 0) : 0;

    els.todayTotal.textContent = formatTime(todayTime);
    els.yesterdayTotal.textContent = formatTime(yestTime);

    els.peakHour.textContent = getPeakHour(daily.hourly);
    els.wastedTime.textContent = formatTime(todayTime);

    renderChart(daily.hourly);
}

function renderSettings(settings) {
    // Prevent loops by checking document active element? No, manual update is fine.
    els.settingLimit.value = settings.dailyLimitMinutes;
    els.settingAlert.value = settings.alertInterval;
    els.settingBlur.checked = settings.blurEnabled;
    els.settingFloating.checked = settings.floatingCounter;
    els.settingMode.checked = (settings.mode === 'study'); // simple toggle for now
}


async function saveSettings() {
    const newSettings = {
        dailyLimitMinutes: parseInt(els.settingLimit.value) || 30,
        alertInterval: parseInt(els.settingAlert.value) || 10,
        blurEnabled: els.settingBlur.checked,
        floatingCounter: els.settingFloating.checked,
        mode: els.settingMode.checked ? 'study' : 'normal'
    };

    await chrome.storage.local.set({ settings: newSettings });
    // Reload data to update UI just in case
    loadData();
}


// Event Listeners
tabs.forEach(btn => {
    btn.addEventListener('click', () => {
        tabs.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));

        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
    });
});

[els.settingLimit, els.settingAlert, els.settingBlur, els.settingFloating, els.settingMode].forEach(input => {
    input.addEventListener('change', saveSettings);
});

els.resetBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({
        sessionStats: { instagram: 0, youtube: 0, instagramTime: 0, youtubeTime: 0 }
    });
});


// Init
document.addEventListener('DOMContentLoaded', loadData);

// Listen for updates (when popup is open and user is browsing in another window)
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') loadData();
});
