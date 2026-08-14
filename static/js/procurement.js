(() => {
    'use strict';

    const state = {
        active: false,
        tab: 'market',
        catalog: null,
        inventory: [],
        flea: null,
        operations: [],
        redemptionStatus: {},
        operators: []
    };

    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));

    const icon = (name) => `<span class="zoot-ui-icon" data-zoot-icon="${escapeHtml(name)}" aria-hidden="true"></span>`;

    const voucherQuantity = () => Number(
        state.inventory.find(item => item.item_id === 'black_market_any_item_voucher')?.quantity || 0
    );

    function confirmAction(title, message, onConfirm) {
        if (typeof window.showConfirmDialog !== 'function') {
            setStatus('确认组件尚未就绪，请稍后重试', 'error');
            return;
        }
        window.showConfirmDialog(title, message, onConfirm);
    }

    async function request(path, options = {}) {
        const response = await fetch(path, {
            ...options,
            headers: {'Content-Type': 'application/json', ...(options.headers || {})}
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detail = payload.detail;
            throw new Error(detail?.message || detail || payload.message || `请求失败（${response.status}）`);
        }
        return payload;
    }

    function setStatus(message, tone = '') {
        const node = document.getElementById('procurement-status');
        if (!node) return;
        node.textContent = message || '';
        node.dataset.tone = tone;
    }

    function updateHeader() {
        const wallet = document.getElementById('procurement-wallet');
        const cycle = document.getElementById('procurement-cycle');
        if (wallet && state.catalog) wallet.textContent = `${Number(state.catalog.wallet_balance || 0).toLocaleString()} 龙门币`;
        if (cycle && state.catalog) cycle.textContent = `${state.catalog.cycle_date} · 今日货架使用稳定轮换`;
    }

    function productCard(product, purchase = true) {
        return `<article class="procurement-product">
            <div class="procurement-product-icon">${icon(product.kind === 'wardrobe' ? 'wardrobe' : product.kind === 'gift' ? 'heart' : 'archive')}</div>
            <div class="procurement-product-copy">
                <small>${escapeHtml(product.kind_label || product.kind)}</small>
                <h4>${escapeHtml(product.name)}</h4>
                <p>${escapeHtml(product.description || '')}</p>
                <div class="procurement-tags">${(product.tags || []).slice(0, 4).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
            </div>
            <div class="procurement-product-action">
                <strong>${Number(product.price || 0).toLocaleString()}</strong>
                ${purchase ? `<button data-procurement-buy="${escapeHtml(product.product_id)}">购买</button>` : ''}
                ${purchase && voucherQuantity() > 0 ? `<button data-procurement-voucher="${escapeHtml(product.product_id)}">使用兑换券</button>` : ''}
            </div>
        </article>`;
    }

    function render() {
        const root = document.getElementById('procurement-content');
        if (!root) return;
        document.querySelectorAll('[data-procurement-tab]').forEach(button => {
            button.classList.toggle('active', button.dataset.procurementTab === state.tab);
        });
        if (state.tab === 'market') {
            const products = state.catalog?.products || [];
            root.innerHTML = `<section class="procurement-section"><header><h3>今日黑市</h3><p>同一天内商品顺序保持稳定；购买会经过钱包与库存事务。</p></header>
                <div class="procurement-product-grid">${products.map(item => productCard(item)).join('') || '<div class="procurement-empty">今日没有可用商品</div>'}</div></section>`;
        } else if (state.tab === 'inventory') {
            root.innerHTML = `<section class="procurement-section"><header><h3>我的库存</h3><p>衣装券购买后保持未绑定；礼物只有确认回应后才会消耗。</p><label class="procurement-gift-target">赠送对象<select id="procurement-gift-operator"><option value="">选择干员</option>${state.operators.map(operator => `<option value="${escapeHtml(operator.eng_name || operator.id)}">${escapeHtml(operator.name || operator.codename || operator.eng_name || operator.id)}</option>`).join('')}</select></label></header>
                <div class="procurement-inventory-grid">${state.inventory.map(item => {
                    const product = item.catalog || {name: item.item_id, description: item.description || '', kind: 'item'};
                    return `<article class="procurement-stock"><div>${icon(product.kind === 'gift' ? 'heart' : product.kind === 'wardrobe' ? 'wardrobe' : 'archive')}<strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.description || '')}</small></div><b>× ${Number(item.quantity || 0)}</b>${product.kind === 'gift' ? `<button data-gift-item="${escapeHtml(item.item_id)}">赠送</button>` : ''}</article>`;
                }).join('') || '<div class="procurement-empty">库存中暂无采购物品</div>'}</div></section>`;
        } else if (state.tab === 'flea') {
            root.innerHTML = `<section class="procurement-section"><header><h3>跳蚤市场</h3><p>当前为明确标识的本地模拟市场，不连接公网玩家。</p></header>
                <div class="procurement-simulation">本地模拟 · ${escapeHtml(state.flea?.cycle_date || '')}</div>
                <div class="procurement-product-grid">${(state.flea?.listings || []).map(listing => {
                    const product = {...listing.product, price: listing.price};
                    return `<article class="procurement-product"><div class="procurement-product-icon">${icon('bank')}</div><div class="procurement-product-copy"><small>${escapeHtml(listing.seller_name)}</small><h4>${escapeHtml(product.name)}</h4><p>${escapeHtml(product.description || '')}</p></div><div class="procurement-product-action"><strong>${Number(listing.price).toLocaleString()}</strong><button data-flea-buy="${escapeHtml(listing.listing_id)}">购买</button></div></article>`;
                }).join('')}</div></section>`;
        } else if (state.tab === 'redeem') {
            root.innerHTML = `<section class="procurement-section"><header><h3>兑换中心</h3><p>支持内置短码、离线签名码和云端码；网络重试不会重复到账。</p></header>
                <form id="procurement-redeem-form" class="procurement-redeem"><label>兑换码<textarea name="code" rows="3" required autocomplete="off" placeholder="粘贴完整兑换码"></textarea></label><button type="submit">验证并兑换</button></form></section>`;
        } else {
            root.innerHTML = `<section class="procurement-section"><header><h3>交易与赠送审计</h3><p>这里只显示业务结果，不包含密钥或聊天正文。</p></header><div class="procurement-audit">${state.operations.map(item => `<article><span data-state="${escapeHtml(item.state)}"></span><div><strong>${escapeHtml(item.operation_type)}</strong><small>${new Date(Number(item.updated_at || 0) * 1000).toLocaleString()}</small></div><b>${escapeHtml(item.state)}</b></article>`).join('') || '<div class="procurement-empty">暂无交易记录</div>'}</div></section>`;
        }
        bindContentActions(root);
        window.ZootIcons?.hydrateTree?.(root);
    }

    async function refresh() {
        setStatus('正在读取采购数据');
        try {
            const [catalog, inventory, flea, audit, redemptionStatus, operators] = await Promise.all([
                request('/procurement/catalog'),
                request('/procurement/inventory'),
                request('/procurement/flea'),
                request('/procurement/operations?limit=50'),
                request('/procurement/redemption/status'),
                request('/operators').catch(() => [])
            ]);
            state.catalog = catalog;
            state.inventory = inventory.items || [];
            state.flea = flea;
            state.operations = audit.operations || [];
            state.redemptionStatus = redemptionStatus || {};
            state.operators = Array.isArray(operators) ? operators : [];
            updateHeader();
            render();
            setStatus('');
        } catch (error) {
            setStatus(error.message, 'error');
        }
    }

    function buyProduct(productId, paymentMethod = 'wallet') {
        const usingVoucher = paymentMethod === 'voucher';
        confirmAction(
            usingVoucher ? '使用兑换券' : '确认购买',
            usingVoucher ? '确认消耗一张黑市任意物品兑换券换取该商品？本次不会扣除龙门币。' : '确认使用博士钱包购买此商品？',
            async () => {
                setStatus(usingVoucher ? '正在核销兑换券并办理入库' : '正在确认钱包与库存事务');
                try {
                    await request('/procurement/purchase', {
                        method: 'POST',
                        body: JSON.stringify({
                            product_id: productId,
                            quantity: 1,
                            payment_method: paymentMethod,
                            client_request_id: crypto.randomUUID?.() || `purchase-${Date.now()}-${Math.random()}`
                        })
                    });
                    setStatus(usingVoucher ? '兑换成功，商品已入库' : '购买成功，物品已入库', 'success');
                    await refresh();
                } catch (error) {
                    setStatus(error.message, 'error');
                }
            }
        );
    }

    function buyFlea(listingId) {
        confirmAction('确认购买', '确认购买此模拟市场挂牌？', async () => {
            setStatus('正在结算挂牌');
            try {
                await request(`/procurement/flea/${encodeURIComponent(listingId)}/purchase`, {
                    method: 'POST',
                    body: JSON.stringify({client_request_id: crypto.randomUUID?.() || `flea-${Date.now()}-${Math.random()}`})
                });
                setStatus('成交完成', 'success');
                await refresh();
            } catch (error) {
                setStatus(error.message, 'error');
            }
        });
    }

    function giveGift(itemId) {
        const operatorId = document.getElementById('procurement-gift-operator')?.value;
        if (!operatorId) { setStatus('请先选择赠送对象', 'error'); return; }
        confirmAction('确认赠送', '确认将礼物交给该干员，并让当前 Chat 服务判断回应？', async () => {
            setStatus('正在预留礼物并等待干员回应');
            try {
                const reservation = await request('/procurement/gifts/reserve', {method: 'POST', body: JSON.stringify({operator_id: operatorId, item_id: itemId, branch_id: 'main'})});
                const result = await request(`/procurement/gifts/${encodeURIComponent(reservation.reservation_id)}/react`, {method: 'POST', body: JSON.stringify({context: '从采购部明确发起的礼物赠送互动'})});
                setStatus(`礼物回应：${result.state}；信赖变化 ${Number(result.trust_delta || 0)}`, 'success');
                await refresh();
            } catch (error) { setStatus(error.message, 'error'); await refresh(); }
        });
    }

    function bindContentActions(root) {
        root.querySelectorAll('[data-procurement-buy]').forEach(button => {
            button.addEventListener('click', () => buyProduct(button.dataset.procurementBuy));
        });
        root.querySelectorAll('[data-procurement-voucher]').forEach(button => {
            button.addEventListener('click', () => buyProduct(button.dataset.procurementVoucher, 'voucher'));
        });
        root.querySelectorAll('[data-flea-buy]').forEach(button => {
            button.addEventListener('click', () => buyFlea(button.dataset.fleaBuy));
        });
        root.querySelectorAll('[data-gift-item]').forEach(button => {
            button.addEventListener('click', () => giveGift(button.dataset.giftItem));
        });
        root.querySelector('#procurement-redeem-form')?.addEventListener('submit', async event => {
            event.preventDefault();
            const form = event.currentTarget;
            const code = new FormData(form).get('code');
            const submitButton = form.querySelector('button[type="submit"]');
            if (submitButton?.disabled) return;
            if (submitButton) submitButton.disabled = true;
            setStatus('正在验证兑换码');
            try {
                const result = await request('/procurement/redemption/redeem', {
                    method: 'POST',
                    body: JSON.stringify({
                        code,
                        client_request_id: crypto.randomUUID?.() || `redeem-${Date.now()}-${Math.random()}`
                    })
                });
                const currency = Number(result.currency_delta || 0);
                const currencyText = currency ? `龙门币 ${currency > 0 ? '+' : ''}${currency.toLocaleString()}` : '';
                const itemText = (result.items || [])
                    .map(item => `${item.name || item.item_id} ×${Number(item.quantity || 0)}`)
                    .join('、');
                const details = [currencyText, itemText].filter(Boolean).join('；') || '兑换记录已确认';
                const prefix = result.idempotent_replay ? '该请求已处理：' : '兑换成功：';
                setStatus(`${prefix}${details}；钱包余额 ${Number(result.wallet_balance || 0).toLocaleString()}`, 'success');
                form.reset();
                await refresh();
            } catch (error) {
                setStatus(error.message, 'error');
            } finally {
                if (submitButton) submitButton.disabled = false;
            }
        });
    }

    function activate() {
        state.active = true;
        refresh();
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-procurement-tab]').forEach(button => {
            button.addEventListener('click', () => {
                state.tab = button.dataset.procurementTab;
                render();
            });
        });
    });
    document.addEventListener('pageShown', event => {
        const pageId = event.detail?.pageId || event.detail?.page;
        state.active = pageId === 'procurement';
        if (state.active) activate();
    });
    window.loadProcurement = activate;
})();
