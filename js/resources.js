// 推荐站点模块 — 从 data/resources.json 加载站点目录并渲染卡片
// 全局状态
let resourcesAllData = [];               // 全部资源数据缓存
let resourcesCurrentCategory = 'all';    // 当前选中的分类
let resourcesDataLoaded = false;         // 是否已加载数据

// 分类显示名映射
const CATEGORY_LABELS = {
    all: '全部',
    online_video: '在线影视',
    tvbox_config: '影视仓配置',
    open_source: '开源项目',
    magnet_search: '磁力搜索',
    cloud_search: '网盘搜索',
    video_app: '影视APP',
    subtitles: '字幕下载',
    player: '播放器',
    subscription: 'IPTV订阅'
};

// HTML 转义（防 XSS）
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 评分颜色映射
function scoreColor(val) {
    if (val >= 5) return 'text-emerald-400';
    if (val >= 4) return 'text-emerald-500';
    if (val >= 3) return 'text-yellow-500';
    return 'text-gray-500';
}

// 可访问性状态 → 图标与文案
const AVAILABILITY_META = {
    reachable: { icon: '🟢', label: '可访问' },
    restricted: { icon: '🟡', label: '受限' },
    unreachable: { icon: '🔴', label: '无法访问' }
};
const STATUS_ORDER = { reachable: 0, restricted: 1, unreachable: 2 };

// 推荐指数：四项体验评分（多/快/净/稳）平均后四舍五入
function getRecommendScore(item) {
    const s = item.scores || {};
    return Math.round(((s.more || 0) + (s.speed || 0) + (s.clean || 0) + (s.stable || 0)) / 4);
}

// 按推荐指数降序 + 状态优先排序
function sortResources(list) {
    return [...list].sort((a, b) => {
        const scoreDiff = getRecommendScore(b) - getRecommendScore(a);
        if (scoreDiff !== 0) return scoreDiff;
        const orderA = STATUS_ORDER[a.availability?.status] ?? 3;
        const orderB = STATUS_ORDER[b.availability?.status] ?? 3;
        return orderA - orderB;
    });
}

// 渲染5维评分条
function renderScoreBar(scores) {
    const dims = [
        { key: 'more', label: '资源' },
        { key: 'speed', label: '速度' },
        { key: 'clean', label: '纯净' },
        { key: 'stable', label: '稳定' },
        { key: 'ease', label: '易用' }
    ];
    return dims.map(d => {
        const val = scores[d.key] || 0;
        const color = scoreColor(val);
        const width = Math.round((val / 5) * 100);
        return `<div class="flex items-center gap-1 text-xs">
            <span class="text-gray-500 w-7">${d.label}</span>
            <div class="flex-1 h-1.5 bg-[#333] rounded-full overflow-hidden">
                <div class="h-full ${color} bg-current rounded-full" style="width:${width}%"></div>
            </div>
            <span class="${color} w-4 text-right font-mono">${val}</span>
        </div>`;
    }).join('');
}

// 渲染标签徽章
function renderTags(tags) {
    if (!tags || !tags.length) return '';
    const displayTags = tags.slice(0, 4); // 最多显示4个
    return displayTags.map(t =>
        `<span class="text-xs bg-emerald-500/10 text-emerald-300 rounded px-1.5 py-0.5 whitespace-nowrap">${escapeHtml(t)}</span>`
    ).join('');
}

// 渲染一张资源卡片
function renderCard(item) {
    const safeName = escapeHtml(item.name);
    const safeSummary = escapeHtml(item.summary_short || item.summary || '');
    const safeUrl = escapeHtml(item.url);

    // 状态徽章（无检测记录显示 ⚪ 未检测）
    const meta = AVAILABILITY_META[item.availability?.status];
    const statusBadge = meta
        ? `<span class="text-[11px] px-1.5 py-0.5 rounded bg-[#222] border border-[#333] whitespace-nowrap shrink-0">${meta.icon} ${meta.label}</span>`
        : `<span class="text-[11px] px-1.5 py-0.5 rounded bg-[#222] border border-[#333] text-gray-500 whitespace-nowrap shrink-0">⚪ 未检测</span>`;

    // 推荐指数星级
    const recommend = getRecommendScore(item);
    const stars = '🌟'.repeat(recommend);

    return `
    <div class="resource-card bg-[#111] hover:bg-[#1a1a1a] rounded-lg p-4 border border-[#222] hover:border-emerald-500/30 cursor-pointer transition-all duration-300 hover:shadow-lg hover:shadow-emerald-500/5"
         onclick="window.open('${safeUrl}', '_blank')"
         title="${safeName}&#10;${safeSummary}&#10;点击访问：${safeUrl}">
        <!-- 站点名称 + 状态 -->
        <div class="flex items-center justify-between gap-2 mb-1">
            <h3 class="text-base font-bold text-white line-clamp-1">${safeName}</h3>
            ${statusBadge}
        </div>
        <!-- 推荐指数 -->
        <div class="text-xs text-amber-400 mb-2">${stars} <span class="text-gray-500">推荐 ${recommend}/5</span></div>
        <!-- 简介 -->
        <p class="text-xs text-gray-400 line-clamp-2 mb-3 min-h-[2.5em]">${safeSummary}</p>
        <!-- 评分条 -->
        <div class="space-y-0.5 mb-3">
            ${renderScoreBar(item.scores)}
        </div>
        <!-- 标签 -->
        <div class="flex flex-wrap gap-1 mb-2">
            ${renderTags(item.tags)}
        </div>
        <!-- 底部链接 -->
        <div class="text-xs text-emerald-500/60 truncate">${safeUrl}</div>
    </div>`;
}

// 渲染分类标签栏
function renderCategoryTabs() {
    const container = document.getElementById('resources-category-tabs');
    if (!container) return;

    // 按数据中实际出现的分类生成标签
    const presentCategories = new Set(resourcesAllData.map(r => r.category));
    const tabOrder = ['all', ...Object.keys(CATEGORY_LABELS).filter(c => c !== 'all' && presentCategories.has(c))];

    container.innerHTML = tabOrder.map(cat => {
        const isActive = cat === resourcesCurrentCategory;
        const label = CATEGORY_LABELS[cat] || cat;
        return `<button class="resources-category-tab px-3 py-1.5 text-sm rounded-full whitespace-nowrap transition-colors duration-200
            ${isActive ? 'active bg-emerald-600 text-white' : 'bg-[#222] text-gray-400 hover:bg-[#333] hover:text-white'}"
            onclick="filterResourcesByCategory('${cat}')">${label}</button>`;
    }).join('');
}

// 按分类过滤并渲染卡片
function filterResourcesByCategory(category) {
    resourcesCurrentCategory = category;
    renderCategoryTabs();
    renderCards(category);
}

// 渲染卡片网格
function renderCards(category) {
    const container = document.getElementById('resources-results');
    if (!container) return;

    const filtered = category === 'all'
        ? resourcesAllData
        : resourcesAllData.filter(r => r.category === category);

    if (!filtered.length) {
        container.innerHTML = '<div class="col-span-full text-center text-gray-500 py-8">暂无数据</div>';
        return;
    }

    container.innerHTML = sortResources(filtered).map(renderCard).join('');
}

// 加载 JSON 数据
async function fetchResourcesData() {
    try {
        const resp = await fetch('/data/resources.json');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        resourcesAllData = json.resources || [];
        resourcesDataLoaded = true;

        // 初始渲染
        renderCategoryTabs();
        renderCards('all');
    } catch (err) {
        console.error('推荐站点数据加载失败:', err);
        const container = document.getElementById('resources-results');
        if (container) {
            container.innerHTML = '<div class="col-span-full text-center text-gray-500 py-8">站点数据加载失败，请刷新重试</div>';
        }
    }
}

// 控制区域显隐
function updateResourcesVisibility() {
    const area = document.getElementById('resourcesArea');
    if (!area) return;

    const enabled = localStorage.getItem('resourcesEnabled') !== 'false'; // 默认开启
    const resultsVisible = !document.getElementById('resultsArea')?.classList.contains('hidden');

    if (enabled && !resultsVisible) {
        area.classList.remove('hidden');
        // 首次显示时加载数据
        if (!resourcesDataLoaded) {
            fetchResourcesData();
        }
    } else {
        area.classList.add('hidden');
    }
}

// 初始化入口
function initResources() {
    // 绑定设置面板开关
    const toggle = document.getElementById('resourcesToggle');
    if (toggle) {
        toggle.checked = localStorage.getItem('resourcesEnabled') !== 'false'; // 默认开启
        toggle.addEventListener('change', function () {
            localStorage.setItem('resourcesEnabled', this.checked);
            updateResourcesVisibility();
        });
    }

    // 初始显隐
    updateResourcesVisibility();
}

// DOM 就绪后初始化
document.addEventListener('DOMContentLoaded', initResources);
