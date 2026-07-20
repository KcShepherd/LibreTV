// 扫描 resources.json 中的 online_video 站点，探测 Apple CMS API 可用性
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resources = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'resources.json'), 'utf8'));
const sites = resources.resources.filter(r => r.category === 'online_video');

const API_PATHS = [
    '/api.php/provide/vod/?ac=videolist',
    '/api.php/provide/vod?ac=videolist',
];

const TIMEOUT = 8000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

async function testApi(baseUrl) {
    // 去掉尾部斜杠
    const base = baseUrl.replace(/\/+$/, '');
    // 提取 origin
    let origin;
    try {
        origin = new URL(base).origin;
    } catch {
        return null;
    }

    const results = [];

    for (const apiPath of API_PATHS) {
        const url = origin + apiPath;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT);

        try {
            const resp = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'User-Agent': UA,
                    'Accept': 'application/json, text/html, */*',
                },
            });
            clearTimeout(timer);

            if (!resp.ok) continue;

            const text = await resp.text();
            // 尝试验证是 JSON 格式且包含 vod 相关字段
            try {
                const json = JSON.parse(text);
                if (json && json.list !== undefined) {
                    return {
                        url: origin + '/api.php/provide/vod',
                        name: json.name || '?',
                        count: Array.isArray(json.list) ? json.list.length : 0,
                        sample: Array.isArray(json.list) ? json.list.slice(0, 2).map(i => ({ id: i.vod_id, name: i.vod_name })) : [],
                    };
                }
                if (json && (json.code !== undefined || json.msg !== undefined)) {
                    return {
                        url: origin + '/api.php/provide/vod',
                        format: 'cms',
                        detail: `code=${json.code}, msg=${json.msg}`,
                    };
                }
            } catch {
                // 不是 JSON
            }
        } catch {
            clearTimeout(timer);
        }
    }
    return null;
}

console.log(`开始扫描 ${sites.length} 个 online_video 站点...\n`);
const working = [];
let i = 0;

for (const site of sites) {
    i++;
    process.stdout.write(`[${i}/${sites.length}] ${site.name.padEnd(12)} ${site.url.padEnd(35)} ... `);
    const result = await testApi(site.url);
    if (result) {
        process.stdout.write('✅ 可用\n');
        working.push({ site: site.name, url: site.url, api: result });
    } else {
        process.stdout.write('❌ 无API\n');
    }
}

console.log(`\n===== 结果 =====`);
console.log(`共检测 ${sites.length} 个站点，${working.length} 个可用\n`);
working.forEach(w => {
    console.log(`✅ ${w.site}`);
    console.log(`   站点: ${w.url}`);
    console.log(`   API:  ${w.api.url}`);
    if (w.api.count !== undefined) {
        console.log(`   数据: ${w.api.count} 条, 示例: ${JSON.stringify(w.api.sample)}`);
    } else {
        console.log(`   格式: ${w.api.format}, ${w.api.detail}`);
    }
    console.log();
});

// 生成可直接加入 config.js 的代码
if (working.length > 0) {
    console.log(`\n===== 可用的 API 配置 (复制到 js/config.js 的 API_SITES) =====\n`);
    working.forEach(w => {
        const key = w.site.replace(/[^\w]/g, '_').toLowerCase();
        console.log(`    ${key}: {`);
        console.log(`        api: '${w.api.url}',`);
        console.log(`        name: '${w.site}',`);
        console.log(`    },`);
    });
}
