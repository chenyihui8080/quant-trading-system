// ==UserScript==
// @name         东财实盘凭证自动同步助手 (Quant Session Sync)
// @namespace    https://github.com/quant-trading-system
// @version      1.2.0
// @description  自动捕获东方财富网页/交易端 Cookie 与 ValidateKey，静默无感同步至本地量化系统，实现长效保活与永不断连
// @author       Chen
// @match        https://jy.sc.eastmoney.com/*
// @match        https://jywg.18.cn/*
// @match        https://trade.eastmoney.com/*
// @match        https://quote.eastmoney.com/*
// @match        https://passport2.eastmoney.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // 本地量化服务接收凭证的 API 地址
    var TARGET_API = 'http://localhost:8000/api/eastmoney/bind-full-credentials';
    var LAST_SYNC_KEY = '_QUANT_LAST_SYNC_TS_';

    function extractCredentials() {
        var cookie = document.cookie || '';
        var vkey = '';

        // 1. 从 URL 或 Hash 提取 validatekey
        var m = (location.search + location.hash + location.href).match(/(?:validatekey|vkey|validate_key)=([^&#\s]+)/i);
        if (m) vkey = m[1];

        // 2. 从 window 变量或 Storage 提取
        if (!vkey && window.validatekey) vkey = window.validatekey;
        if (!vkey && window.ValidateKey) vkey = window.ValidateKey;
        try {
            if (!vkey) vkey = sessionStorage.getItem('validatekey') || localStorage.getItem('validatekey') || '';
        } catch(e){}

        // 3. 从 Cookie 正则提取
        if (!vkey && cookie) {
            var cm = cookie.match(/(?:validatekey|vkey)=([^;\s]+)/i);
            if (cm) vkey = cm[1];
        }

        return { cookie: cookie, validatekey: vkey };
    }

    function showFloatTip(text, isSuccess) {
        var tipId = '_quant_sync_float_tip';
        var el = document.getElementById(tipId);
        if (!el) {
            el = document.createElement('div');
            el.id = tipId;
            el.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:999999;padding:8px 16px;border-radius:8px;font-size:12px;font-family:system-ui,-apple-system,sans-serif;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,0.25);transition:all .3s ease;display:flex;align-items:center;gap:6px;pointer-events:none;';
            document.body.appendChild(el);
        }
        el.style.background = isSuccess ? '#1f6feb' : '#d29922';
        el.style.color = '#fff';
        el.innerHTML = (isSuccess ? '⚡ ' : '⚠️ ') + text;
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';

        setTimeout(function() {
            el.style.opacity = '0';
            el.style.transform = 'translateY(10px)';
        }, 3500);
    }

    function syncToQuantSystem(force) {
        var cred = extractCredentials();
        if (!cred.cookie || cred.cookie.length < 30) return;

        // 节流：默认至少间隔 60 秒同步一次，除非 force 为 true
        var now = Date.now();
        var lastSync = parseInt(sessionStorage.getItem(LAST_SYNC_KEY) || '0', 10);
        if (!force && (now - lastSync < 60000)) return;

        var payload = JSON.stringify({
            cookie: cred.cookie,
            validatekey: cred.validatekey || '',
            user_name: '陈一辉 (浏览器透明同步)'
        });

        function handleSuccess(resText) {
            sessionStorage.setItem(LAST_SYNC_KEY, now.toString());
            showFloatTip('量化系统实盘会话已自动同步续期', true);
            console.log('[QuantSync] ✅ 东方财富凭证已静默回传同步至量化系统', cred.validatekey ? '含validatekey' : '纯Cookie');
        }

        if (typeof GM_xmlhttpRequest !== 'undefined') {
            GM_xmlhttpRequest({
                method: 'POST',
                url: TARGET_API,
                headers: { 'Content-Type': 'application/json' },
                data: payload,
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        handleSuccess(response.responseText);
                    }
                }
            });
        } else {
            fetch(TARGET_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                mode: 'cors'
            }).then(function(r) { return r.json(); }).then(handleSuccess).catch(function(e){});
        }
    }

    // 页面加载完成后立即尝试同步一次
    setTimeout(function() { syncToQuantSystem(false); }, 1500);

    // 监听网络 AJAX 完成事件（交易下单或持仓查询后自动静默同步）
    var originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function() {
        this.addEventListener('load', function() {
            if (this.responseURL && (this.responseURL.indexOf('Search') !== -1 || this.responseURL.indexOf('Trade') !== -1)) {
                setTimeout(function() { syncToQuantSystem(false); }, 500);
            }
        });
        return originalOpen.apply(this, arguments);
    };

})();
