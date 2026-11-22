// 从 TVBox 配置文件中提取 Apple CMS API URL（支持单仓/一层多仓展开 + 搜索关键词验证）
import { domainToASCII } from 'node:url';

// 配置地址：来自 https://github.com/laoma528/awesome-zhuiju-free（tvbox_config 分类）
const CONFIG_URLS = [
    'http://www.饭太硬.net/tv',
    'http://www.y456y.com',
    'http://new.王二小放牛娃.top',
    'http://肥猫.net/',
    'http://xhztv.top/4k.json',
    'https://ys.cxkjg.cn/api/provide/tvbox',
    'https://raw.liucn.cc/box/m.json',
    'https://szyyds.cn/tv/x.json',
    'http://xhztv.top/xhz',
    'https://6800.kstore.vip/fish.json',
    'http://xhztv.top/dc',
    'http://xmbjm.fh4u.org/dc.txt',
    'http://ztha.top/TVBox/GYCK.json',
];

const SEARCH_KEYWORD = '斗破苍穹'; // 用具体剧名验证搜索是否按关键词过滤
const MAX_EXPAND = 60; // 多仓展开上限，避免垃圾 URL 爆炸
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const TIMEOUT = 8000;

// 中文域名转 punycode
function normalizeUrl(u) {
    try {
        const parsed = new URL(u);
        parsed.hostname = domainToASCII(parsed.hostname);
        return parsed.toString();
    } catch {
        return u;
    }
}

// 判断 URL 是否值得展开（是单仓配置，而非 drpy 脚本/直播源/token 等垃圾）
function isWorthExpanding(u) {
    if (!u || !/^https?:\/\//.test(u)) return false;
    const lower = u.toLowerCase();
    if (lower.includes('127.0.0.1') || lower.includes('localhost')) return false;
    if (lower.includes('@')) return false; // 带凭据
    if (lower.includes('/api.php/provide/vod')) return true; // 直接是采集接口
    if (lower.includes('token')) return false;
    if (/\.(js|txt|m3u|m3u8|md5|png|jpe?g|gif|webp|html?)($|\?)/.test(lower)) return false;
    return true; // 纯路径或 .json，可能是单仓
}

async function fetchText(url, timeout = TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const resp = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': UA, 'Accept': 'application/json, text/plain, */*' },
            redirect: 'follow',
        });
        clearTimeout(timer);
        if (!resp.ok) return { ok: false, reason: `HTTP ${resp.status}` };
        const text = await resp.text();
        return { ok: true, text };
    } catch (e) {
        clearTimeout(timer);
        return { ok: false, reason: e.name === 'AbortError' ? '超时' : e.message };
    }
}

// 从任意 JSON 结构递归提取 sites[].api（仅苹果 CMS 采集接口）
function extractApis(obj, out, seen, depth = 0) {
    if (depth > 4 || !obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
        for (const item of obj) {
            if (item && typeof item.api === 'string' && item.api.includes('/api.php/provide/vod')) {
                const api = item.api.replace(/\/+$/, '');
                if (!seen.has(api)) {
                    seen.add(api);
                    out.push({ key: item.key || '', name: item.name || '?', api });
                }
            }
            extractApis(item, out, seen, depth + 1);
        }
    } else {
        for (const val of Object.values(obj)) {
            extractApis(val, out, seen, depth + 1);
        }
    }
}

// 从纯文本（多仓 txt / HTML 分发页）里只提取采集接口或 .json
function extractUrlsFromText(text) {
    const urls = new Set();
    for (const m of text.matchAll(/https?:\/\/[^\s"'<>()]+/g)) {
        let u = m[0].replace(/[),;]+$/, '');
        if (u.includes('/api.php/provide/vod') || /\.json($|\?)/.test(u)) urls.add(normalizeUrl(u));
    }
    return [...urls];
}

// 展开一个配置地址：单仓提取 api，多仓返回待 fetch 的子地址
async function expandConfig(url, depth = 0) {
    const apis = new Map();
    const childUrls = new Set();
    const norm = normalizeUrl(url);
    const r = await fetchText(norm);
    if (!r.ok) {
        console.log(`  ${'  '.repeat(depth)}⚠️  ${norm} → ${r.reason}`);
        return { apis, childUrls };
    }

    const text = r.text.trim();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON */ }

    if (json) {
        // 多仓：{ urls: [...] }
        if (Array.isArray(json.urls)) {
            for (const item of json.urls) {
                const child = typeof item === 'string' ? item : item?.url;
                if (isWorthExpanding(child)) childUrls.add(normalizeUrl(child));
            }
        }
        // 单仓 / 内嵌：递归提取 api
        const out = [];
        const seen = new Set();
        extractApis(json, out, seen);
        for (const a of out) apis.set(a.api, a);
    } else if (text.includes('http')) {
        for (const u of extractUrlsFromText(text)) {
            if (isWorthExpanding(u)) childUrls.add(u);
        }
    } else {
        console.log(`  ${'  '.repeat(depth)}⚠️  ${norm} → 无法解析（${text.slice(0, 40)}...）`);
    }
    return { apis, childUrls };
}

// 验证搜索：搜具体剧名，检查结果是否按关键词过滤
async function verifySearch(api) {
    const testUrl = `${api}?ac=videolist&wd=${encodeURIComponent(SEARCH_KEYWORD)}`;
    const r = await fetchText(testUrl, 8000);
    if (!r.ok) return { ok: false, reason: r.reason };
    let json;
    try { json = JSON.parse(r.text); } catch { return { ok: false, reason: '非JSON: ' + r.text.slice(0, 30) }; }
    const list = json.list;
    if (!Array.isArray(list) || list.length === 0) return { ok: false, reason: '无list' };

    const total = Number(json.total ?? NaN);
    if (Number.isFinite(total) && total > 200) return { ok: false, reason: `忽略搜索词(total=${total})` };

    const names = list.slice(0, 5).map(i => i.vod_name || '');
    const hit = names.some(n => n.includes('斗破') || n.includes('苍穹'));
    if (!hit) return { ok: false, reason: `结果无关: ${names[0] || '(空)'}`, total };

    return { ok: true, total: Number.isFinite(total) ? total : list.length, sample: names[0] };
}

// 分批并发
async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let idx = 0;
    async function worker() {
        while (idx < items.length) {
            const i = idx++;
            results[i] = await fn(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

console.log('=== 第一步：抓取并展开 TVBox 配置 ===\n');
const allApis = new Map();
const pendingUrls = new Set();

for (const url of CONFIG_URLS) {
    console.log(`📦 ${url}`);
    const { apis, childUrls } = await expandConfig(url);
    for (const [api, info] of apis) allApis.set(api, info);
    for (const u of childUrls) pendingUrls.add(u);
}

// 单层多仓展开（并发，不再递归多轮，避免垃圾 URL 爆炸）
if (pendingUrls.size > 0) {
    const urls = [...pendingUrls].slice(0, MAX_EXPAND);
    console.log(`\n🔁 单层展开多仓子地址（${urls.length} 个，并发 8）`);
    const expanded = await mapLimit(urls, 8, async (u) => expandConfig(u, 1));
    for (const { apis, childUrls } of expanded) {
        for (const [api, info] of apis) allApis.set(api, info);
        for (const child of childUrls) pendingUrls.add(child);
    }
}

console.log(`\n=== 第二步：去重后共 ${allApis.size} 个唯一 API，验证搜索 ===\n`);

const apiList = [...allApis.values()];
const verifyResults = await mapLimit(apiList, 8, async (info) => {
    const v = await verifySearch(info.api);
    process.stdout.write(`  ${v.ok ? '✅' : '❌'} ${info.name.padEnd(20)} ${info.api.padEnd(55)} ${v.ok ? `total=${v.total} 首条:${v.sample}` : v.reason}\n`);
    return { ...info, verify: v };
});

const working = verifyResults.filter(x => x.verify.ok);

console.log(`\n===== 结果：${working.length} 个搜索可用的 API =====\n`);
working.forEach(w => {
    console.log(`✅ ${w.name}\n   API: ${w.api}\n   total=${w.verify.total} 首条: ${w.verify.sample}\n`);
});

// 生成 config.js 片段
if (working.length > 0) {
    console.log('\n// ===== 复制到 js/config.js 的 API_SITES =====');
    const usedKeys = new Set();
    working.forEach((w, i) => {
        let key = (w.key || '').replace(/[^\w]/g, '');
        if (!key) {
            try { key = new URL(w.api).hostname.split('.')[0]; } catch { key = ''; }
        }
        key = key || `tvbox_${i + 1}`;
        if (usedKeys.has(key)) key = `${key}_${i + 1}`;
        usedKeys.add(key);
        console.log(`    ${key}: {`);
        console.log(`        api: '${w.api}',`);
        console.log(`        name: '${w.name}',`);
        console.log(`    },`);
    });
}
