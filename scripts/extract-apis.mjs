// 从 TVBox 配置文件中提取 Apple CMS API URL
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_URLS = [
    'http://xhztv.top/4k.json',
    'https://6800.kstore.vip/fish.json',
    'http://ztha.top/TVBox/GYCK.json',
    'https://szyyds.cn/tv/x.json',
    'https://raw.liucn.cc/box/m.json',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const TIMEOUT = 15000;

async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    try {
        const resp = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': UA, 'Accept': 'application/json, text/plain, */*' },
        });
        clearTimeout(timer);
        if (!resp.ok) return null;
        const text = await resp.text();
        return JSON.parse(text);
    } catch {
        clearTimeout(timer);
        return null;
    }
}

function extractApis(obj, depth = 0) {
    if (depth > 10) return [];
    if (!obj || typeof obj !== 'object') return [];

    const results = [];

    // 直接在 sites 数组中查找
    if (Array.isArray(obj)) {
        for (const item of obj) {
            if (item && typeof item.api === 'string') {
                const api = item.api;
                // 匹配 Apple CMS API 格式
                if (api.includes('/api.php/provide/vod')) {
                    results.push({
                        name: item.name || item.key || '?',
                        api: api.replace(/\/+$/, ''),
                    });
                }
            }
            results.push(...extractApis(item, depth + 1));
        }
    } else {
        for (const val of Object.values(obj)) {
            results.push(...extractApis(val, depth + 1));
        }
    }

    return results;
}

console.log('从 TVBox 配置中提取 Apple CMS API...\n');
const allApis = new Map(); // 去重用

for (const url of CONFIG_URLS) {
    process.stdout.write(`${url.padEnd(55)} `);
    const json = await fetchJson(url);
    if (!json) {
        console.log('❌ 无法获取');
        continue;
    }
    const apis = extractApis(json);
    console.log(`✅ ${apis.length} 个API`);

    for (const api of apis) {
        const key = api.api.replace(/^https?:\/\//, '');
        if (!allApis.has(key)) {
            allApis.set(key, api);
        }
    }
}

console.log(`\n===== 去重后 ${allApis.size} 个唯一 API =====\n`);

// 测试每个 API 是否可用
console.log('测试 API 可用性（每个超时8秒）...\n');

const working = [];
let tested = 0;

for (const [key, info] of allApis) {
    tested++;
    process.stdout.write(`[${tested}/${allApis.size}] ${info.name.padEnd(15)} ${info.api.padEnd(55)} `);

    const testUrl = `${info.api}?ac=videolist`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
        const resp = await fetch(testUrl, {
            signal: controller.signal,
            headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        });
        clearTimeout(timer);

        if (!resp.ok) {
            console.log(`❌ HTTP ${resp.status}`);
            continue;
        }

        const text = await resp.text();
        try {
            const json = JSON.parse(text);
            if (json && json.list !== undefined) {
                console.log(`✅ code=${json.code} list=${json.list?.length || 0}`);
                working.push({ ...info, count: json.list?.length || 0 });
            } else if (json && json.code !== undefined) {
                console.log(`⚠️  code=${json.code} (无list)`);
                working.push({ ...info, count: 0 });
            } else {
                console.log(`❓ JSON但格式不符`);
            }
        } catch {
            console.log(`❌ 非JSON响应 (${text.substring(0, 50)}...)`);
        }
    } catch {
        clearTimeout(timer);
        console.log('❌ 超时/网络错误');
    }
}

console.log(`\n===== ${working.length} 个可用 API =====\n`);
working.forEach(w => {
    console.log(`✅ ${w.name}`);
    console.log(`   API: ${w.api}`);
    console.log(`   数据: ${w.count} 条`);
    console.log();
});

// 生成 config.js 配置片段
if (working.length > 0) {
    console.log('\n// ===== 复制到 js/config.js API_SITES =====');
    working.forEach((w, i) => {
        const key = `tvbox_${i + 1}`;
        console.log(`    ${key}: {`);
        console.log(`        api: '${w.api}',`);
        console.log(`        name: '${w.name}',`);
        console.log(`    },`);
    });
}
