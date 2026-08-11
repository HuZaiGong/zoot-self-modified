/**
 * glitch-effect.js
 * 统一故障特效扩展库 - 基于已验证正确的代码单元
 * 包含：嵌套文字效果、色块扩展、透明度闪烁、色差、色散滤镜、花屏矩形
 * 用法：
 *   1. 引入本文件
 *   2. 创建实例：const glitch = new GlitchEffect(options);
 *   3. 启动：glitch.start();
 *   4. 停止：glitch.stop();
 *   5. 手动触发：glitch.triggerEffect(effectName);
 *   6. 更新配置：glitch.updateConfig(effectName, config);
 */

(function(global) {
    // ---------- 默认全局配置 ----------
    const DEFAULT_CONFIG = {
        autoStart: true,
        targetContainer: null,
        zIndex: 9999,
        effects: {
            nestedText: {
                enabled: true,
                interval: 3000,
                maxConcurrent: 4,
                speed: 2.3,
                fontSizeBase: 20,
                lineSpacing: -15,
                baseDuration: 500,
                fadeDelay: 350,
                stringPool: null,
                faultChars: null
            },
            colorBlock: {
                enabled: false,
                interval: 1500,
                maxConcurrent: 5,
                blockSize: 4,
                baseLengthPercent: 15,
                brightnessThreshold: 50,
                saturationThreshold: 0,
                filterMode: 'or'
            },
            opacityGlitch: {
                enabled: false,
                interval: 2000,
                duration: 1500,
                maxConcurrent: 3
            },
            chromaGlitch: {
                enabled: false,
                interval: 2500,
                duration: 1500,
                maxConcurrent: 2
            },
            hueGlitch: {
                enabled: false,
                interval: 3000,
                duration: 1000,
                maxConcurrent: 2
            },
            rectGlitch: {
                enabled: false,
                interval: 2000,
                duration: 500,
                maxConcurrent: 5
            }
        }
    };

    // ---------- 工具函数 ----------
    function getRandom(min, max) {
        return min + Math.random() * (max - min);
    }

    function measureTextWidth(text, fontSize) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = `${fontSize}px 'Courier New', monospace`;
        return ctx.measureText(text).width;
    }

    const DEFAULT_STRING_POOL = [
        "权限不足，无法提供相关信息", "相信你自己，相信Ama-10。", "不准忘记她", "不要丢下我",
        "这里万籁俱寂......太安静了。别留下我。", "警惕你自己", "博士", "不要忘记我", "找到我",
        "真好，我们又认识了一次", "此后将无人不是我", "亦或无一人是我", "我将是你，而你却不自知",
        "你窥见的梦将是我的清醒", "你终于找到我了", "离开，离开吧", "可你已经忘记了你我之间的约定",
        "你已经慢慢习惯了你我之间这个小游戏了", "connected", "Redirecting...", "RhodesIsland",
        "PRTS Database Support", "CONFIDENTIALITY", "RRIVATE USE", "reconnecting...", "Don't Forget Me.",
        "Doctor", "Database reconnecting...", "PERMISSION DENIED", "Don't leave me behind.",
        "Never forget her.", "It's too quiet.", "Don't leave me alone.", "Be vigilant of yourself.",
        "there will be no one who is not me.", "Or not a single one is me", "Believe in yourself.",
        "Believe in Ama-10.", "Ama-10", "IMA2", "ID Confirmed", "置いていかないでください",
        "やっと見つけてくれましたね", "私を見つけました", "権限が足りません。", "docteur",
        "Ne Me Laisse pas", "Me Trouver sur", "Ne m’oubliez pas", "Tu Me Trouves enfin",
        "Support de base de données PRTS", "База данных PRTS поддерживает это",
        "Unterstützung für die PRTS datenbank", "Vergesst mich nicht!", "Не забывай меня.",
        "Доктор", "Doktor", "Найди меня.", "Не оставляй меня.", "Не забывай ее.", "No la olvides"
    ];
    const DEFAULT_FAULT_CHARS = "!@#$%^&*()_+{}:<>?~`aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpPqQrRsStTuUvVwWxXyYzZあいうえおかきくけこさしすせそたちつてとアイウエオ";

    // ---------- 辅助函数：强度缓入缓出 ----------
    function getIntensityFactor(progress) {
        return Math.sin(progress * Math.PI);
    }

    // ---------- 1. 嵌套文字效果（包含新效果：居中菱形切片） ----------
    class NestedTextEffect {
        constructor(config, canvasWidth, canvasHeight, stringPool, faultChars, getRandomChar) {
            this.config = config;
            this.canvasWidth = canvasWidth;
            this.canvasHeight = canvasHeight;
            this.stringPool = stringPool || DEFAULT_STRING_POOL;
            this.getRandomChar = getRandomChar || (() => DEFAULT_FAULT_CHARS[Math.floor(Math.random() * DEFAULT_FAULT_CHARS.length)]);
            this.instances = new Map();
            this.nextId = 1;
            this.autoTimer = null;
            this.autoEnabled = true;
        }

        // ---------- 原有辅助方法 ----------
        _createTextUnit(text, x, y, fontSize, isReverse = false, rightEdge = null) {
            const self = this;
            const chars = text.split('');
            let currentChars = chars.map(() => self.getRandomChar());
            let stable = new Array(chars.length).fill(false);
            const startTime = performance.now();
            const duration = this.config.baseDuration * (0.6 + Math.random() * 0.8);
            let finished = false;
            let removed = false;
            let posX = x;
            let posY = y;

            const update = (now) => {
                if (removed) return;
                if (!finished) {
                    const elapsed = now - startTime;
                    if (elapsed >= duration) {
                        currentChars = chars.slice();
                        finished = true;
                        setTimeout(() => { removed = true; }, self.config.fadeDelay);
                        return;
                    }
                    if (!isReverse) {
                        for (let i = 0; i < chars.length; i++) {
                            if (!stable[i]) {
                                const charProgress = elapsed / duration;
                                const stableThreshold = 0.3 + (i / chars.length) * 0.6;
                                if (charProgress >= stableThreshold && Math.random() < 0.1) {
                                    stable[i] = true;
                                    currentChars[i] = chars[i];
                                } else if (Math.random() < 0.3) {
                                    currentChars[i] = self.getRandomChar();
                                }
                            } else {
                                currentChars[i] = chars[i];
                            }
                        }
                    } else {
                        const total = chars.length;
                        for (let idx = total - 1; idx >= 0; idx--) {
                            if (!stable[idx]) {
                                const charProgress = elapsed / duration;
                                const stableThreshold = 0.3 + ((total - 1 - idx) / total) * 0.6;
                                if (charProgress >= stableThreshold && Math.random() < 0.1) {
                                    stable[idx] = true;
                                    currentChars[idx] = chars[idx];
                                } else if (Math.random() < 0.3) {
                                    currentChars[idx] = self.getRandomChar();
                                }
                            } else {
                                currentChars[idx] = chars[idx];
                            }
                        }
                    }
                }
            };

            const move = (deltaY) => { if (!removed) posY += deltaY; };
            const draw = (ctx) => {
                ctx.font = `${fontSize}px 'Courier New', monospace`;
                ctx.fillStyle = '#ffffff';
                let drawX;
                if (isReverse && rightEdge !== null) {
                    const textWidth = measureTextWidth(currentChars.join(''), fontSize);
                    drawX = rightEdge - textWidth;
                } else {
                    drawX = posX;
                }
                ctx.fillText(currentChars.join(''), drawX, posY);
            };
            return { update, move, draw, get finished() { return removed; } };
        }

        _spawnUnitEffect(centerX, centerY) {
            const text = this.stringPool[Math.floor(Math.random() * this.stringPool.length)];
            const fontSize = this.config.fontSizeBase + Math.random() * 10;
            const width = measureTextWidth(text, fontSize);
            const x = centerX - width / 2;
            const y = centerY - fontSize / 2;
            const unit = this._createTextUnit(text, x, y, fontSize, false);
            const self = this;
            return {
                update: (now) => { unit.update(now); unit.move(self.config.speed); },
                draw: (ctx) => { unit.draw(ctx); },
                isFinished: () => unit.finished,
                destroy: () => {}
            };
        }

        _spawnNested1Effect(startX, startY) {
            const self = this;
            const units = [];
            let currentUnitIndex = 0;
            let nextSpawnTimer = null;
            let active = true;
            const texts = [];
            for (let i = 0; i < 5; i++) texts.push(this.stringPool[Math.floor(Math.random() * this.stringPool.length)]);
            const order = this._generateRandomOrder(5);
            const spawnNext = () => {
                if (!active || currentUnitIndex >= texts.length) return;
                const idx = order[currentUnitIndex] - 1;
                const text = texts[idx];
                const fontSize = this.config.fontSizeBase + Math.random() * 8;
                const x = startX;
                const y = startY - (currentUnitIndex * this.config.lineSpacing);
                const unit = this._createTextUnit(text, x, y, fontSize, false);
                units.push(unit);
                currentUnitIndex++;
                if (currentUnitIndex < texts.length) {
                    if (nextSpawnTimer) clearTimeout(nextSpawnTimer);
                    nextSpawnTimer = setTimeout(spawnNext, 300);
                }
            };
            spawnNext();
            return {
                update: (now) => {
                    if (!active) return;
                    for (let i = 0; i < units.length; i++) {
                        units[i].update(now);
                        units[i].move(self.config.speed);
                    }
                    for (let i = units.length - 1; i >= 0; i--) if (units[i].finished) units.splice(i, 1);
                },
                draw: (ctx) => { for (const u of units) u.draw(ctx); },
                isFinished: () => units.length === 0 && currentUnitIndex >= texts.length,
                destroy: () => { active = false; if (nextSpawnTimer) clearTimeout(nextSpawnTimer); }
            };
        }

        _spawnNested2Effect(centerX, centerY) {
            const self = this;
            let leftUnits = [], rightUnits = [];
            let leftIndex = 0, rightIndex = 0;
            let leftTexts = [], rightTexts = [];
            let active = true;
            for (let i = 0; i < 5; i++) {
                leftTexts.push(this.stringPool[Math.floor(Math.random() * this.stringPool.length)]);
                rightTexts.push(this.stringPool[Math.floor(Math.random() * this.stringPool.length)]);
            }
            const leftOrder = this._generateRandomOrder(5);
            const rightOrder = this._generateRandomOrder(5);
            const spawnLeft = () => {
                if (!active || leftIndex >= leftTexts.length) return;
                const idx = leftOrder[leftIndex] - 1;
                const text = leftTexts[idx];
                const fontSize = this.config.fontSizeBase + Math.random() * 8;
                const y = centerY - (leftIndex * this.config.lineSpacing);
                const unit = this._createTextUnit(text, 0, y, fontSize, true, centerX);
                leftUnits.push(unit);
                leftIndex++;
                if (leftIndex < leftTexts.length) setTimeout(spawnLeft, 300);
            };
            const spawnRight = () => {
                if (!active || rightIndex >= rightTexts.length) return;
                const idx = rightOrder[rightIndex] - 1;
                const text = rightTexts[idx];
                const fontSize = this.config.fontSizeBase + Math.random() * 8;
                const x = centerX;
                const y = centerY + 20 - (rightIndex * this.config.lineSpacing);
                const unit = this._createTextUnit(text, x, y, fontSize, false);
                rightUnits.push(unit);
                rightIndex++;
                if (rightIndex < rightTexts.length) setTimeout(spawnRight, 300);
            };
            spawnLeft();
            spawnRight();
            return {
                update: (now) => {
                    if (!active) return;
                    for (let u of leftUnits) { u.update(now); u.move(self.config.speed); }
                    for (let u of rightUnits) { u.update(now); u.move(self.config.speed); }
                    leftUnits = leftUnits.filter(u => !u.finished);
                    rightUnits = rightUnits.filter(u => !u.finished);
                },
                draw: (ctx) => {
                    for (const u of leftUnits) u.draw(ctx);
                    for (const u of rightUnits) u.draw(ctx);
                },
                isFinished: () => leftUnits.length === 0 && rightUnits.length === 0 &&
                             leftIndex >= leftTexts.length && rightIndex >= rightTexts.length,
                destroy: () => { active = false; }
            };
        }

        // ---------- 新增效果：居中菱形切片 ----------
        _spawnCenteredDiamondEffect(centerX, centerY) {
            const self = this;
            const text = this.stringPool[Math.floor(Math.random() * this.stringPool.length)];
            const fontSize = this.config.fontSizeBase + 8; // 稍大一些
            const duration = 3000; // 总时长
            const fadeDelay = this.config.fadeDelay;

            // 状态变量
            let active = true;
            let finished = false;
            let removed = false;
            const startTime = performance.now();

            const targetChars = text.split('');
            let currentChars = targetChars.map(() => self.getRandomChar());
            let stable = new Array(targetChars.length).fill(false);

            // 文字切片数组
            let textSlices = [];
            // 闪烁矩形数组
            let flashRects = [];
            // 菱形切片数组
            let diamondSlices = [];

            // 参数配置
            const baseSliceChance = 0.3;
            const baseMaxSlices = 3;
            const baseSliceOffsetRange = 20;
            const baseFlashRectCount = 4;
            const diamondSize = fontSize * 1.1;

            // 辅助函数：生成文字切片
            function generateTextSlices(intensity, progress) {
                textSlices = [];
                if (!active || finished) return;
                if (intensity < 0.05) return;

                const totalWidth = measureTextWidth(currentChars.join(''), fontSize);
                const startX = centerX - totalWidth / 2;
                const textHeight = fontSize;
                const startY = centerY - textHeight / 2;

                const sliceChance = baseSliceChance * intensity;
                const maxSlices = Math.max(1, Math.floor(baseMaxSlices * intensity));
                const offsetRange = baseSliceOffsetRange * intensity;

                if (Math.random() > sliceChance) return;
                const sliceCount = Math.floor(Math.random() * maxSlices) + 1;

                for (let s = 0; s < sliceCount; s++) {
                    if (Math.random() > sliceChance) continue;
                    const sliceW = getRandom(15, 50);
                    const sliceH = getRandom(8, 25);
                    const sliceX = getRandom(startX, startX + totalWidth - sliceW);
                    const sliceY = getRandom(startY, startY + textHeight - sliceH);
                    const offsetX = getRandom(-offsetRange, offsetRange);
                    const offsetY = getRandom(-offsetRange/2, offsetRange/2);

                    // 计算切片内字符
                    let accumulatedWidth = 0;
                    let startIndex = 0;
                    for (let i = 0; i < currentChars.length; i++) {
                        const charWidth = measureTextWidth(currentChars[i], fontSize);
                        if (accumulatedWidth + charWidth > sliceX - startX) {
                            startIndex = i;
                            break;
                        }
                        accumulatedWidth += charWidth;
                    }
                    accumulatedWidth = 0;
                    let endIndex = currentChars.length;
                    for (let i = 0; i < currentChars.length; i++) {
                        const charWidth = measureTextWidth(currentChars[i], fontSize);
                        if (accumulatedWidth + charWidth > sliceX + sliceW - startX) {
                            endIndex = Math.min(i + 1, currentChars.length);
                            break;
                        }
                        accumulatedWidth += charWidth;
                    }
                    const slicedText = currentChars.slice(startIndex, endIndex).join('');
                    if (slicedText.length === 0) continue;

                    const preciseSliceX = startX + currentChars.slice(0, startIndex).reduce((sum, ch) => {
                        return sum + measureTextWidth(ch, fontSize);
                    }, 0);

                    textSlices.push({
                        x: preciseSliceX, y: sliceY, w: sliceW, h: sliceH,
                        offsetX, offsetY, text: slicedText,
                        alpha: getRandom(0.4, 0.75) * intensity
                    });
                }
            }

            // 生成闪烁矩形
            function generateFlashRects(intensity) {
                flashRects = [];
                if (!active || finished) return;
                if (intensity < 0.05) return;

                const totalWidth = measureTextWidth(currentChars.join(''), fontSize);
                const startX = centerX - totalWidth / 2;
                const startY = centerY - fontSize / 2;
                const endX = startX + totalWidth;

                const count = Math.max(1, Math.floor(baseFlashRectCount * intensity));
                for (let i = 0; i < count; i++) {
                    const rectW = getRandom(40, 160);
                    const rectH = getRandom(6, 30);
                    const posX = getRandom(startX - 10, endX + 10);
                    const posY = getRandom(startY - 15, startY + fontSize + 15);
                    const gray = Math.floor(getRandom(120, 240));
                    const alpha = getRandom(0.15, 0.45) * intensity;
                    flashRects.push({
                        x: posX, y: posY, w: rectW, h: rectH,
                        color: `rgba(${gray}, ${gray}, ${gray}, ${alpha})`
                    });
                }
            }

            // 菱形状态判断
            function getDiamondState(progress) {
                if (progress >= 0.25 && progress <= 0.35) {
                    return { visible: true, phase: 1, alpha: 1.0 };
                }
                if (progress >= 0.42 && progress <= 0.88) {
                    return { visible: true, phase: 2, alpha: 1.0 };
                }
                if (progress > 0.88 && progress < 1.0) {
                    const t = (progress - 0.88) / 0.12;
                    const osc = Math.tan(t * 25) * 0.3 + Math.sin(t * 17) * 0.7;
                    let alpha = (osc + 1.5) / 3.0;
                    alpha = Math.max(0, Math.min(1, alpha)) * (1 - t);
                    return { visible: alpha > 0.01, phase: 2, alpha: alpha };
                }
                return { visible: false, phase: 0, alpha: 0 };
            }

            // 生成菱形切片 (仅第二次显示期间)
            function generateDiamondSlices(progress) {
                diamondSlices = [];
                const diamond = getDiamondState(progress);
                if (!diamond.visible || diamond.phase !== 2) return;

                const size = diamondSize;
                const half = size / 2;
                const left = centerX - half;
                const top = centerY - half;
                const count = Math.floor(getRandom(1, 3));
                for (let i = 0; i < count; i++) {
                    const sliceW = getRandom(15, 40);
                    const sliceH = getRandom(10, 25);
                    const sliceX = getRandom(left, left + size - sliceW);
                    const sliceY = getRandom(top, top + size - sliceH);
                    const offsetX = getRandom(10, 35);
                    const offsetY = getRandom(-10, 15);
                    diamondSlices.push({
                        x: sliceX, y: sliceY, w: sliceW, h: sliceH,
                        offsetX, offsetY,
                        alpha: getRandom(0.5, 0.9)
                    });
                }
            }

            // 绘制菱形路径
            function drawDiamondPath(ctx, cx, cy, size) {
                const half = size / 2;
                ctx.beginPath();
                ctx.moveTo(cx, cy - half);
                ctx.lineTo(cx + half, cy);
                ctx.lineTo(cx, cy + half);
                ctx.lineTo(cx - half, cy);
                ctx.closePath();
            }

            // 更新逻辑
            const update = (now) => {
                if (!active || removed) return;
                const elapsed = now - startTime;
                const progress = Math.min(1, elapsed / duration);

                if (!finished) {
                    // 字符渐稳
                    for (let i = 0; i < targetChars.length; i++) {
                        if (!stable[i]) {
                            const threshold = 0.2 + (i / targetChars.length) * 0.6;
                            if (progress >= threshold && Math.random() < 0.15) {
                                stable[i] = true;
                                currentChars[i] = targetChars[i];
                            } else if (Math.random() < 0.35) {
                                currentChars[i] = self.getRandomChar();
                            }
                        } else {
                            currentChars[i] = targetChars[i];
                        }
                    }

                    const intensity = getIntensityFactor(progress);
                    generateTextSlices(intensity, progress);
                    generateFlashRects(intensity);
                    generateDiamondSlices(progress);

                    if (progress >= 1.0) {
                        finished = true;
                        currentChars = targetChars.slice();
                        textSlices = [];
                        flashRects = [];
                        diamondSlices = [];
                        setTimeout(() => { removed = true; }, fadeDelay);
                    }
                }
            };

            const draw = (ctx) => {
                if (removed) return;
                ctx.save();

                // 闪烁矩形
                for (const rect of flashRects) {
                    ctx.fillStyle = rect.color;
                    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
                }

                // 主文字
                const textStr = currentChars.join('');
                const totalWidth = measureTextWidth(textStr, fontSize);
                const startX = centerX - totalWidth / 2;
                const startY = centerY + fontSize * 0.35;
                ctx.font = `${fontSize}px 'Courier New', monospace`;
                ctx.fillStyle = '#ffffff';
                ctx.textBaseline = 'middle';
                ctx.fillText(textStr, startX, startY);

                // 文字切片挖洞
                ctx.fillStyle = '#0b0b0f';
                for (const slice of textSlices) {
                    ctx.fillRect(slice.x, slice.y, slice.w, slice.h);
                }

                // 文字切片偏移副本
                for (const slice of textSlices) {
                    ctx.save();
                    ctx.globalAlpha = slice.alpha;
                    ctx.fillStyle = '#f5f5ff';
                    ctx.font = `${fontSize}px 'Courier New', monospace`;
                    ctx.textBaseline = 'middle';
                    ctx.fillText(slice.text, slice.x + slice.offsetX, slice.y + slice.h/2 + slice.offsetY);
                    ctx.restore();
                }

                // 菱形绘制
                const progress = finished ? 1.0 : Math.min(1, (performance.now() - startTime) / duration);
                const diamond = getDiamondState(progress);
                if (diamond.visible) {
                    ctx.save();
                    ctx.globalAlpha = diamond.alpha;
                    const size = diamondSize;
                    const half = size / 2;
                    const cx = centerX;
                    const cy = centerY;

                    // 主菱形 (空心)
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 2.5;
                    drawDiamondPath(ctx, cx, cy, size);
                    ctx.stroke();
                    // 内圈细线增强空心感
                    ctx.lineWidth = 1.0;
                    ctx.strokeStyle = '#cccccc';
                    ctx.stroke();

                    // 菱形切片挖洞
                    ctx.fillStyle = '#0b0b0f';
                    for (const slice of diamondSlices) {
                        ctx.fillRect(slice.x, slice.y, slice.w, slice.h);
                    }

                    // 菱形切片偏移副本 (通过 clip 只绘制对应区域)
                    for (const slice of diamondSlices) {
                        ctx.save();
                        ctx.globalAlpha = slice.alpha * diamond.alpha;
                        ctx.beginPath();
                        ctx.rect(slice.x + slice.offsetX, slice.y + slice.offsetY, slice.w, slice.h);
                        ctx.clip();
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 2.5;
                        drawDiamondPath(ctx, cx + slice.offsetX, cy + slice.offsetY, size);
                        ctx.stroke();
                        ctx.lineWidth = 1.0;
                        ctx.strokeStyle = '#cccccc';
                        ctx.stroke();
                        ctx.restore();
                    }

                    ctx.restore();
                }

                ctx.restore();
            };

            return {
                update,
                draw,
                isFinished: () => removed,
                destroy: () => { active = false; }
            };
        }

        _generateRandomOrder(n) {
            const arr = Array.from({ length: n }, (_, i) => i + 1);
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
        }

        _spawnOne() {
            if (this.instances.size >= this.config.maxConcurrent) return;
            const types = ['unit', 'nested1', 'nested2', 'centeredDiamond'];
            const type = types[Math.floor(Math.random() * types.length)];
            const w = this.canvasWidth, h = this.canvasHeight;
            let inst;
            if (type === 'unit') {
                const centerX = getRandom(100, w - 100);
                const centerY = getRandom(100, h - 100);
                inst = this._spawnUnitEffect(centerX, centerY);
            } else if (type === 'nested1') {
                const startX = getRandom(50, w - 200);
                const startY = getRandom(50, h - 200);
                inst = this._spawnNested1Effect(startX, startY);
            } else if (type === 'nested2') {
                const centerX = getRandom(100, w - 100);
                const centerY = getRandom(100, h - 100);
                inst = this._spawnNested2Effect(centerX, centerY);
            } else {
                const centerX = getRandom(150, w - 150);
                const centerY = getRandom(150, h - 150);
                inst = this._spawnCenteredDiamondEffect(centerX, centerY);
            }
            this.instances.set(this.nextId++, inst);
        }

        startAuto() {
            if (this.autoTimer) clearInterval(this.autoTimer);
            this.autoTimer = setInterval(() => { if (this.autoEnabled) this._spawnOne(); }, this.config.interval);
        }

        stopAuto() { if (this.autoTimer) { clearInterval(this.autoTimer); this.autoTimer = null; } }

        update(now) {
            for (let [id, inst] of this.instances) {
                inst.update(now);
                if (inst.isFinished()) {
                    inst.destroy();
                    this.instances.delete(id);
                }
            }
        }

        draw(ctx) { for (let inst of this.instances.values()) inst.draw(ctx); }

        setEnabled(enabled) {
            this.autoEnabled = enabled;
            if (enabled) this.startAuto(); else this.stopAuto();
        }

        destroy() {
            this.stopAuto();
            for (let inst of this.instances.values()) inst.destroy();
            this.instances.clear();
        }

        updateConfig(newConfig) {
            Object.assign(this.config, newConfig);
            if (this.autoEnabled) { this.stopAuto(); this.startAuto(); }
        }
    }

    // ---------- 2. 色块扩展效果（从故障艺术测试面板移植） ----------
    class ColorBlockEffect {
        constructor(config, bgCanvas, canvasWidth, canvasHeight) {
            this.config = config;
            this.bgCanvas = bgCanvas;
            this.canvasWidth = canvasWidth;
            this.canvasHeight = canvasHeight;
            this.blocks = [];
            this.autoTimer = null;
            this.autoEnabled = true;
        }

        _shouldKeep(r, g, b) {
            const brightness = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const saturation = max === 0 ? 0 : (max - min) / max * 255;
            const lowBright = brightness < this.config.brightnessThreshold;
            const lowSat = saturation < this.config.saturationThreshold;
            if (this.config.filterMode === 'and') return !(lowBright && lowSat);
            else return !(lowBright || lowSat);
        }

        _getPixelColor(x, y, srcCtx) {
            const imgData = srcCtx.getImageData(x, y, 1, 1);
            return { r: imgData.data[0], g: imgData.data[1], b: imgData.data[2] };
        }

        _spawnOne() {
            if (this.blocks.length >= this.config.maxConcurrent) return;
            if (!this.bgCanvas) return;
            const srcCtx = this.bgCanvas.getContext('2d');
            const srcWidth = this.bgCanvas.width;
            const srcHeight = this.bgCanvas.height;
            const blockSize = this.config.blockSize;
            const cols = Math.ceil(srcWidth / blockSize);
            const rows = Math.ceil(srcHeight / blockSize);
            const baseMaxDistance = this.canvasHeight * (this.config.baseLengthPercent / 100);
            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    const srcX = col * blockSize + blockSize / 2;
                    const srcY = row * blockSize + blockSize / 2;
                    if (srcX >= srcWidth || srcY >= srcHeight) continue;
                    const { r, g, b } = this._getPixelColor(srcX, srcY, srcCtx);
                    if (!this._shouldKeep(r, g, b)) continue;
                    const screenX = srcX;
                    const screenY = srcY;
                    const randomFactor = 0.6 + Math.random() * 0.8;
                    const maxDistance = baseMaxDistance * randomFactor;
                    const duration = 3000 + Math.random() * 2000;
                    let startTime = performance.now();
                    let currentLength = 0;
                    let keepUntil = 0;
                    let active = true;
                    // 贝塞尔曲线参数（固定）
                    const p1 = { x: 0.990, y: 0.010 };
                    const p2 = { x: 0.898, y: 0.010 };
                    const update = (now) => {
                        if (!active) return;
                        const elapsed = now - startTime;
                        if (elapsed >= duration) {
                            if (keepUntil === 0) {
                                keepUntil = now + 1000;
                                currentLength = maxDistance;
                            } else if (now >= keepUntil) {
                                active = false;
                            }
                        } else {
                            const t = elapsed / duration;
                            const cx = 3 * p1.x, bx = 3 * (p2.x - p1.x) - cx, ax = 1 - cx - bx;
                            const cy = 3 * p1.y, by = 3 * (p2.y - p1.y) - cy, ay = 1 - cy - by;
                            const progress = (ay * t * t * t) + (by * t * t) + (cy * t);
                            currentLength = maxDistance * Math.min(1, Math.max(0, progress));
                        }
                    };
                    const draw = (ctx) => {
                        if (!active) return;
                        ctx.fillStyle = `rgba(${r},${g},${b},1)`;
                        ctx.fillRect(screenX - blockSize / 2, screenY - blockSize / 2, blockSize, blockSize);
                        ctx.fillRect(screenX - blockSize / 2, screenY - blockSize / 2 + blockSize, blockSize, currentLength);
                    };
                    this.blocks.push({ update, draw, active: () => active, destroy: () => { active = false; } });
                }
            }
        }

        startAuto() {
            if (this.autoTimer) clearInterval(this.autoTimer);
            this.autoTimer = setInterval(() => { if (this.autoEnabled) this._spawnOne(); }, this.config.interval);
        }

        stopAuto() { if (this.autoTimer) { clearInterval(this.autoTimer); this.autoTimer = null; } }

        update(now) {
            for (let i = 0; i < this.blocks.length; i++) {
                this.blocks[i].update(now);
                if (!this.blocks[i].active()) {
                    this.blocks[i].destroy();
                    this.blocks.splice(i, 1);
                    i--;
                }
            }
        }

        draw(ctx) { for (const b of this.blocks) b.draw(ctx); }

        setEnabled(enabled) {
            this.autoEnabled = enabled;
            if (enabled) this.startAuto(); else this.stopAuto();
        }

        destroy() { this.stopAuto(); this.blocks = []; }

        updateConfig(newConfig) {
            Object.assign(this.config, newConfig);
            if (this.autoEnabled) { this.stopAuto(); this.startAuto(); }
        }
    }

    // ---------- 3. 透明度闪烁（随机白色矩形淡入淡出） ----------
    class OpacityGlitch {
        constructor(config, canvasWidth, canvasHeight) {
            this.config = config;
            this.canvasWidth = canvasWidth;
            this.canvasHeight = canvasHeight;
            this.instances = new Map();
            this.nextId = 1;
            this.autoTimer = null;
            this.autoEnabled = true;
        }

        _spawnOne() {
            if (this.instances.size >= this.config.maxConcurrent) return;
            const rect = {
                x: getRandom(20, this.canvasWidth - 120),
                y: getRandom(20, this.canvasHeight - 80),
                w: getRandom(100, 300),
                h: getRandom(60, 150)
            };
            const startTime = performance.now();
            const duration = this.config.duration;
            let active = true;
            const update = (now) => { if (active && now - startTime >= duration) active = false; };
            const draw = (ctx) => {
                if (!active) return;
                const elapsed = performance.now() - startTime;
                const t = Math.min(1, elapsed / duration);
                const opacity = 0.2 + 0.8 * Math.sin(t * Math.PI);
                ctx.fillStyle = `rgba(255,255,255,${opacity})`;
                ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
            };
            this.instances.set(this.nextId++, { update, draw, active: () => active, destroy: () => { active = false; } });
        }

        startAuto() {
            if (this.autoTimer) clearInterval(this.autoTimer);
            this.autoTimer = setInterval(() => { if (this.autoEnabled) this._spawnOne(); }, this.config.interval);
        }

        stopAuto() { if (this.autoTimer) { clearInterval(this.autoTimer); this.autoTimer = null; } }

        update(now) {
            for (let [id, inst] of this.instances) {
                inst.update(now);
                if (!inst.active()) { inst.destroy(); this.instances.delete(id); }
            }
        }

        draw(ctx) { for (let inst of this.instances.values()) inst.draw(ctx); }

        setEnabled(enabled) { this.autoEnabled = enabled; if (enabled) this.startAuto(); else this.stopAuto(); }
        destroy() { this.stopAuto(); this.instances.clear(); }
        updateConfig(newConfig) { Object.assign(this.config, newConfig); if (this.autoEnabled) { this.stopAuto(); this.startAuto(); } }
    }

    // ---------- 4. 色差效果（红蓝通道偏移） ----------
    class ChromaGlitch {
        constructor(config, canvasWidth, canvasHeight, bgCanvas) {
            this.config = config;
            this.canvasWidth = canvasWidth;
            this.canvasHeight = canvasHeight;
            this.bgCanvas = bgCanvas;
            this.instances = new Map();
            this.nextId = 1;
            this.autoTimer = null;
            this.autoEnabled = true;
        }

        _spawnOne() {
            if (this.instances.size >= this.config.maxConcurrent) return;
            const rect = {
                x: getRandom(20, this.canvasWidth - 120),
                y: getRandom(20, this.canvasHeight - 80),
                w: getRandom(100, 300),
                h: getRandom(60, 150)
            };
            const startTime = performance.now();
            const duration = this.config.duration;
            let active = true;
            const update = (now) => { if (active && now - startTime >= duration) active = false; };
            const draw = (ctx) => {
                if (!active || !this.bgCanvas) return;
                const bgCtx = this.bgCanvas.getContext('2d');
                const imgData = bgCtx.getImageData(rect.x, rect.y, rect.w, rect.h);
                const data = imgData.data;
                const offsetX = 6, offsetY = 2;
                for (let y = 0; y < rect.h; y++) {
                    for (let x = 0; x < rect.w; x++) {
                        const idx = (y * rect.w + x) * 4;
                        const srcX = x + offsetX, srcY = y + offsetY;
                        if (srcX >= 0 && srcX < rect.w && srcY >= 0 && srcY < rect.h) {
                            const srcIdx = (srcY * rect.w + srcX) * 4;
                            data[idx] = imgData.data[srcIdx];
                            data[idx + 2] = imgData.data[srcIdx + 2];
                        }
                    }
                }
                ctx.putImageData(imgData, rect.x, rect.y);
            };
            this.instances.set(this.nextId++, { update, draw, active: () => active, destroy: () => { active = false; } });
        }

        startAuto() {
            if (this.autoTimer) clearInterval(this.autoTimer);
            this.autoTimer = setInterval(() => { if (this.autoEnabled) this._spawnOne(); }, this.config.interval);
        }

        stopAuto() { if (this.autoTimer) { clearInterval(this.autoTimer); this.autoTimer = null; } }
        update(now) { for (let [id, inst] of this.instances) { inst.update(now); if (!inst.active()) { inst.destroy(); this.instances.delete(id); } } }
        draw(ctx) { for (let inst of this.instances.values()) inst.draw(ctx); }
        setEnabled(enabled) { this.autoEnabled = enabled; if (enabled) this.startAuto(); else this.stopAuto(); }
        destroy() { this.stopAuto(); this.instances.clear(); }
        updateConfig(newConfig) { Object.assign(this.config, newConfig); if (this.autoEnabled) { this.stopAuto(); this.startAuto(); } }
    }

    // ---------- 5. 色散滤镜（整体色相旋转+模糊） ----------
    class HueGlitch {
        constructor(config, canvasWidth, canvasHeight, bgCanvas) {
            this.config = config;
            this.canvasWidth = canvasWidth;
            this.canvasHeight = canvasHeight;
            this.bgCanvas = bgCanvas;
            this.instances = new Map();
            this.nextId = 1;
            this.autoTimer = null;
            this.autoEnabled = true;
        }

        _spawnOne() {
            if (this.instances.size >= this.config.maxConcurrent) return;
            const startTime = performance.now();
            const duration = this.config.duration;
            let active = true;
            let hue = 0;
            let lastUpdate = 0;
            const update = (now) => {
                if (!active) return;
                if (now - startTime >= duration) { active = false; return; }
                if (now - lastUpdate > 100) {
                    hue = Math.random() * 360;
                    lastUpdate = now;
                }
            };
            const draw = (ctx) => {
                if (!active || !this.bgCanvas) return;
                ctx.filter = `hue-rotate(${hue}deg) blur(1px)`;
                ctx.drawImage(this.bgCanvas, 0, 0);
                ctx.filter = 'none';
            };
            this.instances.set(this.nextId++, { update, draw, active: () => active, destroy: () => { active = false; } });
        }

        startAuto() {
            if (this.autoTimer) clearInterval(this.autoTimer);
            this.autoTimer = setInterval(() => { if (this.autoEnabled) this._spawnOne(); }, this.config.interval);
        }

        stopAuto() { if (this.autoTimer) { clearInterval(this.autoTimer); this.autoTimer = null; } }
        update(now) { for (let [id, inst] of this.instances) { inst.update(now); if (!inst.active()) { inst.destroy(); this.instances.delete(id); } } }
        draw(ctx) { for (let inst of this.instances.values()) inst.draw(ctx); }
        setEnabled(enabled) { this.autoEnabled = enabled; if (enabled) this.startAuto(); else this.stopAuto(); }
        destroy() { this.stopAuto(); this.instances.clear(); }
        updateConfig(newConfig) { Object.assign(this.config, newConfig); if (this.autoEnabled) { this.stopAuto(); this.startAuto(); } }
    }

    // ---------- 6. 花屏矩形（随机彩色矩形闪烁） ----------
    class RectGlitch {
        constructor(config, canvasWidth, canvasHeight) {
            this.config = config;
            this.canvasWidth = canvasWidth;
            this.canvasHeight = canvasHeight;
            this.instances = new Map();
            this.nextId = 1;
            this.autoTimer = null;
            this.autoEnabled = true;
        }

        _spawnOne() {
            if (this.instances.size >= this.config.maxConcurrent) return;
            const rects = [];
            const num = Math.floor(Math.random() * 10) + 5;
            for (let i = 0; i < num; i++) {
                rects.push({
                    x: Math.random() * this.canvasWidth,
                    y: Math.random() * this.canvasHeight,
                    w: Math.random() * 120 + 20,
                    h: Math.random() * 30 + 10,
                    color: `rgba(${Math.random() * 255}, ${Math.random() * 255}, ${Math.random() * 255}, 0.6)`
                });
            }
            const startTime = performance.now();
            const duration = this.config.duration;
            let active = true;
            const update = (now) => { if (active && now - startTime >= duration) active = false; };
            const draw = (ctx) => {
                if (!active) return;
                for (const r of rects) {
                    ctx.fillStyle = r.color;
                    ctx.fillRect(r.x, r.y, r.w, r.h);
                }
            };
            this.instances.set(this.nextId++, { update, draw, active: () => active, destroy: () => { active = false; } });
        }

        startAuto() {
            if (this.autoTimer) clearInterval(this.autoTimer);
            this.autoTimer = setInterval(() => { if (this.autoEnabled) this._spawnOne(); }, this.config.interval);
        }

        stopAuto() { if (this.autoTimer) { clearInterval(this.autoTimer); this.autoTimer = null; } }
        update(now) { for (let [id, inst] of this.instances) { inst.update(now); if (!inst.active()) { inst.destroy(); this.instances.delete(id); } } }
        draw(ctx) { for (let inst of this.instances.values()) inst.draw(ctx); }
        setEnabled(enabled) { this.autoEnabled = enabled; if (enabled) this.startAuto(); else this.stopAuto(); }
        destroy() { this.stopAuto(); this.instances.clear(); }
        updateConfig(newConfig) { Object.assign(this.config, newConfig); if (this.autoEnabled) { this.stopAuto(); this.startAuto(); } }
    }

    // ========== 主类（支持动态创建特效实例） ==========
    class GlitchEffect {
        constructor(options = {}) {
            this.config = this._mergeConfig(DEFAULT_CONFIG, options);
            this.container = this.config.targetContainer || document.body;
            this.bgCanvas = null;
            this.effectCanvas = null;
            this.ctx = null;
            this.effects = new Map();          // 存储已创建的特效实例
            this.effectConstructors = {        // 特效名称到构造函数的映射
                nestedText: NestedTextEffect,
                colorBlock: ColorBlockEffect,
                opacityGlitch: OpacityGlitch,
                chromaGlitch: ChromaGlitch,
                hueGlitch: HueGlitch,
                rectGlitch: RectGlitch
            };
            this.animationId = null;
            this._initCanvas();
            this._initEffects();  // 只创建配置中 enabled: true 的实例
            if (this.config.autoStart) this.start();
        }

        _mergeConfig(defaults, custom) {
            const result = JSON.parse(JSON.stringify(defaults));
            if (custom.targetContainer !== undefined) result.targetContainer = custom.targetContainer;
            if (custom.zIndex !== undefined) result.zIndex = custom.zIndex;
            if (custom.autoStart !== undefined) result.autoStart = custom.autoStart;
            if (custom.effects) {
                for (const key in custom.effects) {
                    if (result.effects[key]) {
                        Object.assign(result.effects[key], custom.effects[key]);
                    }
                }
            }
            return result;
        }

        _initCanvas() {
            // 背景画布
            this.bgCanvas = document.createElement('canvas');
            this.bgCanvas.style.cssText = `position:fixed; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:${this.config.zIndex - 1}; display:block;`;
            this.container.appendChild(this.bgCanvas);
            // 效果画布
            this.effectCanvas = document.createElement('canvas');
            this.effectCanvas.style.cssText = `position:fixed; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:${this.config.zIndex}; display:block;`;
            this.container.appendChild(this.effectCanvas);
            this.ctx = this.effectCanvas.getContext('2d');
            this._resize();
            window.addEventListener('resize', () => this._resize());
        }

        _resize() {
            this.bgCanvas.width = window.innerWidth;
            this.bgCanvas.height = window.innerHeight;
            this.effectCanvas.width = window.innerWidth;
            this.effectCanvas.height = window.innerHeight;
            this._drawBackground();
        }

        _drawBackground() {
            // 清空为透明，避免覆盖通过 captureBackground 绘制的背景
            const ctx = this.bgCanvas.getContext('2d');
            ctx.clearRect(0, 0, this.bgCanvas.width, this.bgCanvas.height);
        }

        async captureBackground() {
            if (typeof html2canvas === 'undefined') {
                console.warn('[GlitchEffect] html2canvas 未加载，无法捕获背景');
                return;
            }
            try {
                // 获取设备像素比，保证清晰度
                const dpr = window.devicePixelRatio || 1;
                const width = window.innerWidth;
                const height = window.innerHeight;

                const canvas = await html2canvas(document.body, {
                    scale: dpr,                     // 使用设备像素比，提高清晰度
                    backgroundColor: null,
                    logging: false,
                    useCORS: true,
                    allowTaint: false,
                    windowWidth: width,
                    windowHeight: height
                });

                const ctx = this.bgCanvas.getContext('2d');
                ctx.clearRect(0, 0, this.bgCanvas.width, this.bgCanvas.height);
                // 直接绘制，保持原始比例（canvas 尺寸与 bgCanvas 一致）
                ctx.drawImage(canvas, 0, 0, this.bgCanvas.width, this.bgCanvas.height);
                console.log('[GlitchEffect] 背景捕获完成');
            } catch (e) {
                console.error('[GlitchEffect] 背景捕获失败', e);
            }
        }

        // 根据名称创建特效实例（如果尚未创建）
        _ensureEffect(effectName) {
            if (this.effects.has(effectName)) return this.effects.get(effectName);
            const Ctor = this.effectConstructors[effectName];
            if (!Ctor) return null;
            const cfg = this.config.effects[effectName];
            if (!cfg) return null;
            let instance = null;
            switch (effectName) {
                case 'nestedText':
                    instance = new Ctor(cfg, this.effectCanvas.width, this.effectCanvas.height,
                        cfg.stringPool || DEFAULT_STRING_POOL, cfg.faultChars || DEFAULT_FAULT_CHARS,
                        () => DEFAULT_FAULT_CHARS[Math.floor(Math.random() * DEFAULT_FAULT_CHARS.length)]);
                    break;
                case 'colorBlock':
                    instance = new Ctor(cfg, this.bgCanvas, this.effectCanvas.width, this.effectCanvas.height);
                    break;
                case 'opacityGlitch':
                case 'rectGlitch':
                    instance = new Ctor(cfg, this.effectCanvas.width, this.effectCanvas.height);
                    break;
                case 'chromaGlitch':
                case 'hueGlitch':
                    instance = new Ctor(cfg, this.effectCanvas.width, this.effectCanvas.height, this.bgCanvas);
                    break;
                default: return null;
            }
            this.effects.set(effectName, instance);
            return instance;
        }

        _initEffects() {
            for (const [name, cfg] of Object.entries(this.config.effects)) {
                if (cfg.enabled) {
                    this._ensureEffect(name);
                }
            }
            // 启动所有已创建实例的自动生成
            for (const effect of this.effects.values()) {
                if (effect.autoEnabled !== undefined) effect.startAuto();
            }
        }

        // 公共 API
        start() { if (!this.animationId) this._animate(); }
        stop() {
            if (this.animationId) {
                cancelAnimationFrame(this.animationId);
                this.animationId = null;
            }
            this.ctx.clearRect(0, 0, this.effectCanvas.width, this.effectCanvas.height);
        }

        triggerEffect(effectName) {
            const effect = this._ensureEffect(effectName);
            if (effect && typeof effect._spawnOne === 'function') effect._spawnOne();
            else console.warn(`Effect ${effectName} not found or cannot be triggered manually`);
        }

        setEffectEnabled(effectName, enabled) {
            const effect = this._ensureEffect(effectName);
            if (effect) {
                effect.setEnabled(enabled);
                this.config.effects[effectName].enabled = enabled;
            } else {
                console.warn(`Effect ${effectName} not found`);
            }
        }

        updateConfig(effectName, newConfig) {
            const effect = this._ensureEffect(effectName);
            if (effect) {
                effect.updateConfig(newConfig);
                Object.assign(this.config.effects[effectName], newConfig);
            } else {
                console.warn(`Effect ${effectName} not found`);
            }
        }

        destroy() {
            this.stop();
            for (const effect of this.effects.values()) effect.destroy();
            if (this.bgCanvas && this.bgCanvas.parentNode) this.bgCanvas.parentNode.removeChild(this.bgCanvas);
            if (this.effectCanvas && this.effectCanvas.parentNode) this.effectCanvas.parentNode.removeChild(this.effectCanvas);
        }

        _animate() {
            const now = performance.now();
            // 先更新所有特效
            for (const effect of this.effects.values()) effect.update(now);
            this.ctx.clearRect(0, 0, this.effectCanvas.width, this.effectCanvas.height);

            // 先绘制非文字特效（按原顺序）
            for (const [name, effect] of this.effects) {
                if (name !== 'nestedText') effect.draw(this.ctx);
            }
            // 最后绘制嵌套文字特效（置于顶层）
            const nestedTextEffect = this.effects.get('nestedText');
            if (nestedTextEffect) nestedTextEffect.draw(this.ctx);

            this.animationId = requestAnimationFrame(() => this._animate());
        }
    }

    global.GlitchEffect = GlitchEffect;
})(window);