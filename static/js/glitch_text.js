/**
 * CenteredGlitchTransition - 居中文字过渡 + 菱形切片特效
 * 支持自定义字体字符串和垂直偏移
 */
(function(global) {
    function getRandom(min, max) {
        return min + Math.random() * (max - min);
    }

    const FAULT_CHARS = "!@#$%^&*()_+{}:<>?~`ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789あいうえおかきくけこさしすせそ";
    function randomFaultChar() {
        return FAULT_CHARS[Math.floor(Math.random() * FAULT_CHARS.length)];
    }

    function getIntensityFactor(progress) {
        return Math.sin(progress * Math.PI);
    }

    const DEFAULT_TARGET_POOL = [
        "不准忘记她", "不要丢下我", "别留下我。", "警惕你自己", "不要忘记我", "找到我",
        "真好，我们又认识了一次", "此后将无人不是我", "亦或无一人是我", "我将是你，而你却不自知",
        "你窥见的梦将是我的清醒", "你终于找到我了", "离开，离开吧", "可你已经忘记了你我之间的约定",
        "你已经慢慢习惯了你我之间这个小游戏了"
    ];

    class CenteredGlitchTransition {
        constructor(canvas, options = {}) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');

            this.startText = options.startText || "…";
            this.fontString = options.fontString || "16px 'Courier New', monospace";
            this.textColor = options.textColor || "#ffffff";
            this.backgroundColor = options.backgroundColor || '#0b0b0f';
            this.verticalOffset = options.verticalOffset || 0;
            this.duration = options.duration || 2800;
            this.fadeDelay = options.fadeDelay || 300;

            this.baseSliceChance = options.sliceChance || 0.3;
            this.baseMaxSlices = options.maxSlices || 3;
            this.baseSliceOffsetRange = options.sliceOffsetRange || 20;
            this.baseFlashRectCount = options.flashRectCount || 4;

            // 从字体字符串中提取字号用于菱形大小
            const fontSizeMatch = this.fontString.match(/(\d+)px/);
            this.fontSize = fontSizeMatch ? parseInt(fontSizeMatch[1]) : 16;
            this.diamondSize = this.fontSize * 1.1;

            this.active = false;
            this.finished = false;
            this.removed = false;
            this.startTime = 0;

            this.targetText = "";
            this.targetChars = [];
            this.currentChars = [];
            this.stable = [];

            this.textSlices = [];
            this.flashRects = [];
            this.diamondSlices = [];

            this.centerX = canvas.width / 2;
            this.centerY = canvas.height / 2;

            this.targetTextPool = options.targetTextPool || DEFAULT_TARGET_POOL;

            this.resetToStart();
        }

        _measureTextWidth(text) {
            this.ctx.font = this.fontString;
            return this.ctx.measureText(text).width;
        }

        setStartText(text) {
            this.startText = text;
            if (!this.active) this.resetToStart();
        }

        resetToStart() {
            this.stop();
            this.targetText = this.startText;
            this.targetChars = this.startText.split('');
            this.currentChars = [...this.targetChars];
            this.stable = new Array(this.targetChars.length).fill(true);
            this.textSlices = [];
            this.flashRects = [];
            this.diamondSlices = [];
            this.active = false;
            this.finished = true;
            this.removed = false;
            this.drawStatic();
        }

        start(targetText = null) {
            this.stop();
            if (targetText) {
                this.targetText = targetText;
            } else {
                const pool = this.targetTextPool;
                this.targetText = pool[Math.floor(Math.random() * pool.length)];
            }
            this.active = true;
            this.finished = false;
            this.removed = false;
            this.startTime = performance.now();

            const currentDisplay = this.currentChars.join('');
            this.targetChars = this.targetText.split('');

            const maxLen = Math.max(currentDisplay.length, this.targetChars.length);
            this.currentChars = currentDisplay.split('');
            while (this.currentChars.length < maxLen) this.currentChars.push(' ');
            while (this.targetChars.length < maxLen) this.targetChars.push('');

            this.stable = new Array(maxLen).fill(false);
            this.textSlices = [];
            this.flashRects = [];
            this.diamondSlices = [];
        }

        stop() {
            this.active = false;
            this.finished = true;
        }

        update(now) {
            if (!this.active || this.removed) return;
            const elapsed = now - this.startTime;
            const progress = Math.min(1, elapsed / this.duration);

            if (!this.finished) {
                const len = this.currentChars.length;
                for (let i = 0; i < len; i++) {
                    if (!this.stable[i]) {
                        const targetChar = this.targetChars[i];
                        if (targetChar === '') {
                            const threshold = 0.5 + (i / len) * 0.4;
                            if (progress >= threshold && Math.random() < 0.2) {
                                this.stable[i] = true;
                                this.currentChars[i] = '';
                            } else if (Math.random() < 0.3) {
                                this.currentChars[i] = randomFaultChar();
                            }
                        } else {
                            const threshold = 0.2 + (i / len) * 0.6;
                            if (progress >= threshold && Math.random() < 0.15) {
                                this.stable[i] = true;
                                this.currentChars[i] = targetChar;
                            } else if (Math.random() < 0.35) {
                                this.currentChars[i] = randomFaultChar();
                            }
                        }
                    } else {
                        this.currentChars[i] = this.targetChars[i];
                    }
                }

                const intensity = getIntensityFactor(progress);
                this._generateTextSlices(intensity);
                this._generateFlashRects(intensity);
                this._generateDiamondSlices(progress);

                if (progress >= 1.0) {
                    this.finished = true;
                    this.currentChars = this.targetChars.map(c => c === '' ? '' : c);
                    this.textSlices = [];
                    this.flashRects = [];
                    this.diamondSlices = [];
                    setTimeout(() => {
                        this.removed = true;
                        this.active = false;
                    }, this.fadeDelay);
                }
            }
        }

        draw() {
            if (this.removed) return;
            const ctx = this.ctx;
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            ctx.save();

            for (const rect of this.flashRects) {
                ctx.fillStyle = rect.color;
                ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
            }

            const textStr = this.currentChars.join('').replace(/ /g, ' ');
            const totalWidth = this._measureTextWidth(textStr);
            const startX = this.centerX - totalWidth / 2;
            const y = this.centerY + this.verticalOffset;

            ctx.font = this.fontString;
            ctx.fillStyle = this.textColor;
            ctx.textBaseline = 'middle';
            ctx.fillText(textStr, startX, y);

            ctx.fillStyle = this.backgroundColor;
            for (const slice of this.textSlices) {
                ctx.fillRect(slice.x, slice.y, slice.w, slice.h);
            }

            for (const slice of this.textSlices) {
                ctx.save();
                ctx.globalAlpha = slice.alpha;
                ctx.fillStyle = this.textColor;
                ctx.font = this.fontString;
                ctx.textBaseline = 'middle';
                ctx.fillText(slice.text, slice.x + slice.offsetX, slice.y + slice.h/2 + slice.offsetY);
                ctx.restore();
            }

            const progress = this.finished ? 1.0 :
                (this.active ? Math.min(1, (performance.now() - this.startTime) / this.duration) : 0);
            const diamond = this._getDiamondState(progress);

            if (diamond.visible) {
                ctx.save();
                ctx.globalAlpha = diamond.alpha;
                const size = this.diamondSize;
                const half = size / 2;
                const cx = this.centerX;
                const cy = this.centerY;

                ctx.strokeStyle = this.textColor;
                ctx.lineWidth = 2.5;
                this._drawDiamondPath(ctx, cx, cy, size);
                ctx.stroke();
                ctx.lineWidth = 1.0;
                ctx.strokeStyle = '#cccccc';
                ctx.stroke();

                ctx.fillStyle = this.backgroundColor;
                for (const slice of this.diamondSlices) {
                    ctx.fillRect(slice.x, slice.y, slice.w, slice.h);
                }

                for (const slice of this.diamondSlices) {
                    ctx.save();
                    ctx.globalAlpha = slice.alpha * diamond.alpha;
                    ctx.beginPath();
                    ctx.rect(slice.x + slice.offsetX, slice.y + slice.offsetY, slice.w, slice.h);
                    ctx.clip();
                    ctx.strokeStyle = this.textColor;
                    ctx.lineWidth = 2.5;
                    this._drawDiamondPath(ctx, cx + slice.offsetX, cy + slice.offsetY, size);
                    ctx.stroke();
                    ctx.lineWidth = 1.0;
                    ctx.strokeStyle = '#cccccc';
                    ctx.stroke();
                    ctx.restore();
                }
                ctx.restore();
            }
            ctx.restore();
        }

        drawStatic() {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.save();
            const textStr = this.startText;
            const totalWidth = this._measureTextWidth(textStr);
            const startX = this.centerX - totalWidth / 2;
            const y = this.centerY + this.verticalOffset;
            this.ctx.font = this.fontString;
            this.ctx.fillStyle = this.textColor;
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(textStr, startX, y);
            this.ctx.restore();
        }

        isFinished() {
            return this.removed || (!this.active && this.finished);
        }

        resize(width, height) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.centerX = width / 2;
            this.centerY = height / 2;
            if (!this.active) this.drawStatic();
        }

        _generateTextSlices(intensity) {
            this.textSlices = [];
            if (!this.active || this.finished) return;
            if (intensity < 0.05) return;

            const textStr = this.currentChars.join('');
            const totalWidth = this._measureTextWidth(textStr);
            const startX = this.centerX - totalWidth / 2;
            const textHeight = this.fontSize;
            const startY = this.centerY - textHeight / 2;

            const sliceChance = this.baseSliceChance * intensity;
            const maxSlices = Math.max(1, Math.floor(this.baseMaxSlices * intensity));
            const offsetRange = this.baseSliceOffsetRange * intensity;

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

                let accumulatedWidth = 0;
                let startIndex = 0;
                for (let i = 0; i < this.currentChars.length; i++) {
                    const charWidth = this._measureTextWidth(this.currentChars[i]);
                    if (accumulatedWidth + charWidth > sliceX - startX) {
                        startIndex = i;
                        break;
                    }
                    accumulatedWidth += charWidth;
                }
                accumulatedWidth = 0;
                let endIndex = this.currentChars.length;
                for (let i = 0; i < this.currentChars.length; i++) {
                    const charWidth = this._measureTextWidth(this.currentChars[i]);
                    if (accumulatedWidth + charWidth > sliceX + sliceW - startX) {
                        endIndex = Math.min(i + 1, this.currentChars.length);
                        break;
                    }
                    accumulatedWidth += charWidth;
                }
                const slicedText = this.currentChars.slice(startIndex, endIndex).join('');
                if (slicedText.length === 0) continue;

                let preciseSliceX = startX;
                for (let i = 0; i < startIndex; i++) {
                    preciseSliceX += this._measureTextWidth(this.currentChars[i]);
                }

                this.textSlices.push({
                    x: preciseSliceX, y: sliceY, w: sliceW, h: sliceH,
                    offsetX, offsetY, text: slicedText,
                    alpha: getRandom(0.4, 0.75) * intensity
                });
            }
        }

        _generateFlashRects(intensity) {
            this.flashRects = [];
            if (!this.active || this.finished) return;
            if (intensity < 0.05) return;

            const textStr = this.currentChars.join('');
            const totalWidth = this._measureTextWidth(textStr);
            const startX = this.centerX - totalWidth / 2;
            const startY = this.centerY - this.fontSize / 2;
            const endX = startX + totalWidth;

            const count = Math.max(1, Math.floor(this.baseFlashRectCount * intensity));
            for (let i = 0; i < count; i++) {
                const rectW = getRandom(40, 160);
                const rectH = getRandom(6, 30);
                const posX = getRandom(startX - 10, endX + 10);
                const posY = getRandom(startY - 15, startY + this.fontSize + 15);
                const gray = Math.floor(getRandom(120, 240));
                const alpha = getRandom(0.15, 0.45) * intensity;
                this.flashRects.push({
                    x: posX, y: posY, w: rectW, h: rectH,
                    color: `rgba(${gray}, ${gray}, ${gray}, ${alpha})`
                });
            }
        }

        _getDiamondState(progress) {
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

        _generateDiamondSlices(progress) {
            this.diamondSlices = [];
            const diamond = this._getDiamondState(progress);
            if (!diamond.visible || diamond.phase !== 2) return;

            const size = this.diamondSize;
            const half = size / 2;
            const left = this.centerX - half;
            const top = this.centerY - half;
            const count = Math.floor(getRandom(1, 3));
            for (let i = 0; i < count; i++) {
                const sliceW = getRandom(15, 40);
                const sliceH = getRandom(10, 25);
                const sliceX = getRandom(left, left + size - sliceW);
                const sliceY = getRandom(top, top + size - sliceH);
                const offsetX = getRandom(10, 35);
                const offsetY = getRandom(-10, 15);
                this.diamondSlices.push({
                    x: sliceX, y: sliceY, w: sliceW, h: sliceH,
                    offsetX, offsetY,
                    alpha: getRandom(0.5, 0.9)
                });
            }
        }

        _drawDiamondPath(ctx, cx, cy, size) {
            const half = size / 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy - half);
            ctx.lineTo(cx + half, cy);
            ctx.lineTo(cx, cy + half);
            ctx.lineTo(cx - half, cy);
            ctx.closePath();
        }
    }

    global.CenteredGlitchTransition = CenteredGlitchTransition;
})(window);
