// 定义配置
const CONFIG = {
    // 允许的访问源（CORS）
    allowedOrigins: ['https://s.niu.one'],
    // 默认重定向地址（未匹配任何路由时）
    defaultRedirect: 'https://google.com',
    // 静态路由规则（除了 KV 存储外的固定映射，可自行扩展）
    staticRoutes: {
        // 例如：'home': 'https://yourdomain.com/home'
    },
    // API 路径前缀
    apiPathPrefix: '/api',
};

// 通用 CORS 响应头
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// 处理预检 OPTIONS 请求
async function handleOptions(request) {
    const origin = request.headers.get('Origin');
    if (origin && CONFIG.allowedOrigins.includes(origin)) {
        corsHeaders['Access-Control-Allow-Origin'] = origin;
    }
    return new Response(null, { status: 204, headers: corsHeaders });
}

// 处理短链接重定向请求
async function handleRedirect(request, pathname) {
    // 路径为空，重定向到默认地址
    if (!pathname || pathname.trim() === '') {
        return Response.redirect(CONFIG.defaultRedirect, 302);
    }
    // 静态路由优先
    if (pathname in CONFIG.staticRoutes) {
        return Response.redirect(CONFIG.staticRoutes[pathname], 302);
    }
    try {
        // 从 KV 获取重定向 URL
        const redirectUrl = await REDIRECT_ROUTES.get(pathname);
        if (redirectUrl) {
            // 异步记录点击量
            recordClick(pathname).catch(console.error);
            return Response.redirect(redirectUrl, 302);
        }
        // 未找到对应路由，使用默认地址
        return Response.redirect(CONFIG.defaultRedirect, 302);
    } catch (err) {
        console.error('Error handling redirect:', err);
        return Response.redirect(CONFIG.defaultRedirect, 302);
    }
}

// 记录短链接点击量
async function recordClick(pathname) {
    if (!pathname || pathname.trim() === '') return;
    try {
        const clicksRaw = await REDIRECT_ROUTES.get(`clicks:${pathname}`, 'json') || { count: 0, lastClicked: null };
        const updatedClicks = {
            count: clicksRaw.count + 1,
            lastClicked: new Date().toISOString(),
        };
        await REDIRECT_ROUTES.put(`clicks:${pathname}`, JSON.stringify(updatedClicks));
    } catch (err) {
        console.error('Error recording click:', err);
    }
}

// 生成随机短路径
async function generateShortPath(length = 6) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // 确认短路径未被占用，否则递归重试
    const existingUrl = await REDIRECT_ROUTES.get(result);
    if (existingUrl) {
        return generateShortPath(length);
    }
    return result;
}

// 处理 API 请求
async function handleApi(request, pathname) {
    // 路径无效
    if (!pathname || pathname.trim() === '') {
        return new Response(JSON.stringify({ error: '无效的路径' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
    }
    // 验证 API 密钥（需要在 Worker 配置中设置 API_KEY 环境变量）
    const apiKeyHeader = request.headers.get('Authorization');
    if (apiKeyHeader !== `Bearer ${API_KEY}`) {
        return new Response(JSON.stringify({ error: '未授权' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
    }
    // 移除前缀，得到实际API路径
    const apiPath = pathname.replace(CONFIG.apiPathPrefix, '');
    if (request.method === 'GET') {
        // 列出所有路由
        if (apiPath === '/routes') {
            const routes = {};
            const list = await REDIRECT_ROUTES.list();
            for (const key of list.keys) {
                const name = key.name;
                if (!name.startsWith('clicks:') && !name.startsWith('admin:')) {
                    routes[name] = await REDIRECT_ROUTES.get(name);
                }
            }
            return new Response(JSON.stringify({ routes }), {
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }
        // 获取特定路由信息
        else if (apiPath.startsWith('/route/')) {
            const routeKey = apiPath.replace('/route/', '');
            const redirectUrl = await REDIRECT_ROUTES.get(routeKey);
            if (redirectUrl) {
                const clicksData = await REDIRECT_ROUTES.get(`clicks:${routeKey}`, 'json') || { count: 0, lastClicked: null };
                return new Response(JSON.stringify({
                    path: routeKey,
                    url: redirectUrl,
                    clicks: clicksData.count,
                    lastClicked: clicksData.lastClicked,
                }), {
                    headers: { 'Content-Type': 'application/json', ...corsHeaders },
                });
            } else {
                return new Response(JSON.stringify({ error: '路由未找到' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders },
                });
            }
        }
    } else if (request.method === 'POST') {
        // 创建新路由
        if (apiPath === '/route') {
            try {
                const body = await request.json();
                if (!body.url) {
                    return new Response(JSON.stringify({ error: '缺少必要的URL字段' }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders },
                    });
                }
                const path = body.customPath || await generateShortPath();
                if (body.customPath) {
                    const existingUrl = await REDIRECT_ROUTES.get(body.customPath);
                    if (existingUrl) {
                        return new Response(JSON.stringify({ error: '自定义路径已存在' }), {
                            status: 400,
                            headers: { 'Content-Type': 'application/json', ...corsHeaders },
                        });
                    }
                }
                await REDIRECT_ROUTES.put(path, body.url);
                await REDIRECT_ROUTES.put(`clicks:${path}`, JSON.stringify({ count: 0, lastClicked: null }));
                return new Response(JSON.stringify({ success: true, path: path, url: body.url }), {
                    headers: { 'Content-Type': 'application/json', ...corsHeaders },
                });
            } catch (err) {
                return new Response(JSON.stringify({ error: '请求体无效' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders },
                });
            }
        }
    } else if (request.method === 'PUT') {
        // 更新路由目标 URL
        if (apiPath.startsWith('/route/')) {
            try {
                const routeKey = apiPath.replace('/route/', '');
                const body = await request.json();
                if (!body.url) {
                    return new Response(JSON.stringify({ error: '缺少必填字段' }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders },
                    });
                }
                const existingUrl = await REDIRECT_ROUTES.get(routeKey);
                if (!existingUrl) {
                    return new Response(JSON.stringify({ error: '路由未找到' }), {
                        status: 404,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders },
                    });
                }
                await REDIRECT_ROUTES.put(routeKey, body.url);
                return new Response(JSON.stringify({ success: true, path: routeKey, url: body.url }), {
                    headers: { 'Content-Type': 'application/json', ...corsHeaders },
                });
            } catch (err) {
                return new Response(JSON.stringify({ error: '请求体无效' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders },
                });
            }
        }
    } else if (request.method === 'DELETE') {
        // 删除路由
        if (apiPath.startsWith('/route/')) {
            const routeKey = apiPath.replace('/route/', '');
            const existingUrl = await REDIRECT_ROUTES.get(routeKey);
            if (!existingUrl) {
                return new Response(JSON.stringify({ error: '路由未找到' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders },
                });
            }
            await REDIRECT_ROUTES.delete(routeKey);
            await REDIRECT_ROUTES.delete(`clicks:${routeKey}`);
            return new Response(JSON.stringify({ success: true, path: routeKey }), {
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }
    }
    // 未匹配任何已知 API 路径
    return new Response(JSON.stringify({ error: '未找到' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
}

// 监听 Fetch 事件入口
addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

// 主请求处理函数
async function handleRequest(request) {
    const url = new URL(request.url);
    const pathname = url.pathname.slice(1);  // 去掉开头的 '/'
    // 管理页面请求（需 Basic Auth）
    if (pathname === 'admin' || pathname === 'admin/') {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            return new Response('未授权', {
                status: 401,
                headers: {
                    'WWW-Authenticate': 'Basic realm="Admin Access"',
                    ...corsHeaders
                }
            });
        }
        const credentials = atob(authHeader.split(' ')[1]);
        const [username, password] = credentials.split(':');
        if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
            return new Response('未授权', { status: 401, headers: corsHeaders });
        }
        try {
            const adminHtml = await REDIRECT_ROUTES.get('admin:html', { type: 'text' });
            if (!adminHtml) {
                return new Response('未找到管理页面', { status: 404 });
            }
            return new Response(adminHtml, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        } catch (error) {
            console.error('获取管理页面失败：', error);
            return new Response('服务器错误', { status: 500 });
        }
    }
    // 处理 CORS 预检
    if (request.method === 'OPTIONS') {
        return handleOptions(request);
    }
    // 处理 API 请求
    if (pathname.startsWith(CONFIG.apiPathPrefix.slice(1))) {
        return handleApi(request, '/' + pathname);
    }
    // 非 API 请求，当作短链接重定向处理
    return handleRedirect(request, pathname);
}
