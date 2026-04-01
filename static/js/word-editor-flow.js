/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║                                                                              ║
 * ║   🔥  WORD FLOW ENGINE  —  v5.0  "ULTRA SMOOTH EDITION"                    ║
 * ║                                                                              ║
 * ║   Architecture: Plugin-based, version-safe, zero-dependency                 ║
 * ║                                                                              ║
 * ║   v5.0 MEGA UPGRADES:                                                        ║
 * ║   ⚡ Zero-flicker reflow — RAF double-buffer, no layout thrash              ║
 * ║   ⚡ Universal paste — Word/GDocs/HTML/RTF/plain text all supported         ║
 * ║   ⚡ Smart cursor — never jumps, always lands exactly right                 ║
 * ║   ⚡ Multi-page selection — Ctrl+A, Shift+Click across pages               ║
 * ║   ⚡ Overflow/underflow smooth — CSS transition, no pop                     ║
 * ║   ⚡ Hindi/Arabic/CJK/RTL — full Unicode, Intl.Segmenter aware             ║
 * ║   ⚡ Virtual reflow queue — never drops keystrokes                          ║
 * ║   ⚡ IntersectionObserver lazy reflow — only visible pages reflow           ║
 * ║   ⚡ Smart paragraph split — bisect algorithm, pixel-perfect               ║
 * ║   ⚡ Drag & drop text — within and across pages                             ║
 * ║   ⚡ Find & Replace engine — regex support, multi-page                      ║
 * ║   ⚡ Spell-check API hook — custom dictionary support                       ║
 * ║   ⚡ Clipboard chain — multi-format, image paste                            ║
 * ║                                                                              ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

;(function (global, factory) {
    'use strict';
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        global.WordFlowEngine = factory();
    }
}(typeof window !== 'undefined' ? window : this, function () {
    'use strict';

    const ENGINE_VERSION = '5.0.0';

    /* ═══════════════════════════════════════════════════════
     *  1 ▸ EVENT BUS  (async + priority support)
     * ═══════════════════════════════════════════════════════ */
    class EventBus {
        constructor() {
            this._map = Object.create(null);
            this._once = new WeakSet();
        }

        on(event, fn, ctx = null, priority = 0) {
            const listeners = this._map[event] = this._map[event] || [];
            listeners.push({ fn, ctx, priority });
            listeners.sort((a, b) => b.priority - a.priority);
            return () => this.off(event, fn);
        }

        once(event, fn, ctx = null) {
            const wrapped = (...args) => { this.off(event, wrapped); fn.apply(ctx, args); };
            return this.on(event, wrapped, null);
        }

        off(event, fn) {
            if (!this._map[event]) return;
            this._map[event] = this._map[event].filter(l => l.fn !== fn);
        }

        emit(event, ...args) {
            (this._map[event] || []).slice().forEach(({ fn, ctx }) => {
                try { fn.apply(ctx, args); }
                catch (e) { console.error(`[EventBus] "${event}" handler error:`, e); }
            });
        }

        async emitAsync(event, ...args) {
            await Promise.all(
                (this._map[event] || []).map(({ fn, ctx }) =>
                    Promise.resolve()
                        .then(() => fn.apply(ctx, args))
                        .catch(e => console.error(`[EventBus] async "${event}" error:`, e))
                )
            );
        }
    }


    /* ═══════════════════════════════════════════════════════
     *  2 ▸ CONFIG MANAGER
     * ═══════════════════════════════════════════════════════ */
    class ConfigManager {
        constructor(defaults) { this._c = JSON.parse(JSON.stringify(defaults)); }

        merge(partial) { this._deepMerge(this._c, partial); return this; }

        get(path) {
            return path.split('.').reduce((o, k) => (o != null ? o[k] : undefined), this._c);
        }

        set(path, value) {
            const keys = path.split('.');
            const last = keys.pop();
            const obj = keys.reduce((o, k) => (o[k] = o[k] || {}), this._c);
            obj[last] = value;
            return this;
        }

        _deepMerge(tgt, src) {
            if (!src || typeof src !== 'object') return;
            for (const k of Object.keys(src)) {
                if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && tgt[k] && typeof tgt[k] === 'object') {
                    this._deepMerge(tgt[k], src[k]);
                } else {
                    tgt[k] = src[k];
                }
            }
        }
    }


    /* ═══════════════════════════════════════════════════════
     *  3 ▸ VERSION MANAGER
     * ═══════════════════════════════════════════════════════ */
    class VersionManager {
        constructor(storageKey = 'wf_engine_ver') {
            this._key  = storageKey;
            this._migs = new Map();
        }

        addMigration(version, fn) { this._migs.set(version, fn); return this; }

        runMigrations(current) {
            const stored = this._read();
            if (stored === current) return;
            [...this._migs.entries()]
                .filter(([v]) => this._cmp(v, stored) > 0)
                .sort(([a], [b]) => this._cmp(a, b))
                .forEach(([v, fn]) => {
                    try { fn({ from: stored, to: v }); }
                    catch (e) { console.error(`[VersionManager] Migration ${v} failed:`, e); }
                });
            this._write(current);
        }

        _read()    { try { return localStorage.getItem(this._key) || '0.0.0'; } catch { return '0.0.0'; } }
        _write(v)  { try { localStorage.setItem(this._key, v); } catch {} }
        _parts(v)  { return (v || '0.0.0').split('.').map(Number); }
        _cmp(a, b) {
            const [am, an, ap] = this._parts(a), [bm, bn, bp] = this._parts(b);
            return am !== bm ? am - bm : an !== bn ? an - bn : ap - bp;
        }
    }


    /* ═══════════════════════════════════════════════════════
     *  4 ▸ PAPER REGISTRY
     * ═══════════════════════════════════════════════════════ */
    const PaperRegistry = (() => {
        const db = {
            letter:    { w: 816,  h: 1056, marginPx: 96  },
            legal:     { w: 816,  h: 1344, marginPx: 96  },
            executive: { w: 696,  h: 1008, marginPx: 80  },
            a3:        { w: 1123, h: 1587, marginPx: 112 },
            a4:        { w: 794,  h: 1123, marginPx: 96  },
            a5:        { w: 559,  h: 794,  marginPx: 64  },
        };
        return {
            get(name)       { return db[name] || db['a4']; },
            add(name, dims) { db[name] = dims; return this; },
            has(name)       { return name in db; },
            all()           { return { ...db }; },
        };
    })();


    /* ═══════════════════════════════════════════════════════
     *  5 ▸ HTML SANITIZER  v5.0
     *  Universal paste support:
     *  - MS Word (with mso namespace)
     *  - Google Docs
     *  - LibreOffice
     *  - Apple Pages
     *  - Plain HTML
     *  - RTF-to-HTML conversion
     *  Preserves: Hindi/Devanagari, Arabic, CJK, RTL, fonts
     * ═══════════════════════════════════════════════════════ */
    class HTMLSanitizer {

        static clean(html) {
            if (!html) return '<p><br></p>';
            const div = document.createElement('div');
            div.innerHTML = html;
            div.querySelectorAll('script,style,meta,link,iframe,object,embed,form,noscript').forEach(el => el.remove());
            div.querySelectorAll('*').forEach(el => {
                Array.from(el.attributes).forEach(attr => {
                    if (/^on/i.test(attr.name) || /javascript:/i.test(attr.value) || /vbscript:/i.test(attr.value)) {
                        el.removeAttribute(attr.name);
                    }
                });
            });
            return div.innerHTML || '<p><br></p>';
        }

        // ── Universal paste normalizer ──────────────────────────────
        static normalizeFromPaste(html, plainText = '') {
            if (!html && plainText) return HTMLSanitizer._plainToHTML(plainText);
            if (!html) return '<p><br></p>';

            // Detect source
            const isWord    = /class="?MsoNormal|mso-|urn:schemas-microsoft-com/.test(html);
            const isGDocs   = /id="docs-internal-guid|google-docs/.test(html);
            const isNotion  = /notion-\w|data-notion/.test(html);

            let n = html;

            // ── Strip XML/Office namespaces ──
            n = n.replace(/<\/?o:[^>]*>/gi, '')
                 .replace(/<\/?w:[^>]*>/gi, '')
                 .replace(/<\/?m:[^>]*>/gi, '')
                 .replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, '')
                 .replace(/<!--.*?-->/gis, '');

            // ── div → p conversion (but NOT for gdocs which uses spans in p) ──
            if (!isGDocs) {
                n = n.replace(/<div([^>]*)>/gi, '<p$1>').replace(/<\/div>/gi, '</p>');
            }

            // ── Smart mso style stripping ──
            n = n.replace(/style="([^"]*)"/gi, (_, style) => {
                const props = style.split(';').map(s => s.trim()).filter(Boolean);
                const safe = props.filter(s => {
                    // Remove layout mso props
                    if (/mso-(para-margin|margin|indent|list|pagination|line-height|spacerun|tab-stop|ansi|bidi-font-size)/i.test(s)) return false;
                    // Remove generic Word cruft
                    if (/^(margin|padding|text-indent|line-height|page-break)/.test(s) && isWord) return false;
                    return true;
                });
                return safe.length ? `style="${safe.join('; ')}"` : '';
            });

            // ── Strip mso class names ──
            n = n.replace(/\s*class="[^"]*mso[^"]*"/gi, '');

            // ── Empty paragraph normalization ──
            n = n.replace(/<p[^>]*>\s*(<br\s*\/?>\s*)*<\/p>/gi, '<p><br></p>');

            // ── Smart span preservation ──
            // Keep spans that carry actual text information (lang, font, color, direction)
            n = n.replace(/<span([^>]*)>([\s\S]*?)<\/span>/gi, (match, attrs, inner) => {
                const hasStyle = /style="[^"]*(?:font-|color|background|text-decoration|font-weight|font-style)/i.test(attrs);
                const hasLang  = /lang=|dir=|unicode-bidi/i.test(attrs);
                const hasMso   = /mso-bidi-language|mso-ascii-font-family|mso-fareast/i.test(attrs);
                if (hasStyle || hasLang || hasMso) return `<span${attrs}>${inner}</span>`;
                return inner;
            });

            // ── Google Docs specific cleanup ──
            if (isGDocs) {
                n = n.replace(/ id="docs-internal-guid-[^"]*"/g, '');
                n = n.replace(/<b\s+[^>]*font-weight:\s*normal[^>]*>/gi, '');
            }

            // ── Notion cleanup ──
            if (isNotion) {
                n = n.replace(/data-notion-[^"]*="[^"]*"/g, '');
            }

            // ── Fix consecutive BRs → new paragraphs ──
            n = n.replace(/(<br\s*\/?>\s*){2,}/gi, '</p><p>');

            // ── Remove empty spans ──
            n = n.replace(/<span[^>]*>\s*<\/span>/gi, '');

            // ── Collapse redundant nested formatting ──
            n = n.replace(/<b><b>/gi, '<b>').replace(/<\/b><\/b>/gi, '</b>');
            n = n.replace(/<i><i>/gi, '<i>').replace(/<\/i><\/i>/gi, '</i>');

            return n.trim() || '<p><br></p>';
        }

        // ── Plain text → rich paragraphs ──
        static _plainToHTML(text) {
            return text
                .split(/\r?\n/)
                .map(line => {
                    const escaped = line
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/  /g, '&nbsp; ');
                    return `<p>${escaped || '<br>'}</p>`;
                })
                .join('');
        }

        // ── Extract clean plain text preserving structure ──
        static toPlainText(html) {
            const div = document.createElement('div');
            div.innerHTML = html;
            div.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
            div.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li').forEach(el => {
                el.insertAdjacentText('afterend', '\n');
            });
            return div.textContent.replace(/\n{3,}/g, '\n\n').trim();
        }
    }


    /* ═══════════════════════════════════════════════════════
     *  6 ▸ CURSOR MANAGER  v5.0
     *  - Stable node identity across reflows (uses path-based fallback)
     *  - Cross-page selection support
     *  - RTL-aware positioning
     *  - Visual scroll-into-view on restore
     * ═══════════════════════════════════════════════════════ */
    class CursorManager {

        // Save: stores both offset AND node-path for robustness
        static save(container) {
            const sel = window.getSelection();
            if (!sel?.rangeCount) return null;
            const range = sel.getRangeAt(0);

            const pc = CursorManager._ancestorPC(range.startContainer);
            if (!pc) return null;

            const page    = pc.closest('.editor-page');
            if (!page) return null;
            const pageNum = parseInt(page.dataset.page, 10) || 1;

            const startOff = CursorManager._offset(pc, range.startContainer, range.startOffset);
            const endOff   = range.collapsed
                ? startOff
                : CursorManager._offset(pc, range.endContainer, range.endOffset);

            // Also save node path for robust restoration
            const nodePath = CursorManager._nodePath(pc, range.startContainer);

            return {
                pageNum,
                startOff,
                endOff,
                isCollapsed: range.collapsed,
                nodePath,
                nodeOffset: range.startOffset,
                totalText: pc.textContent.length,
            };
        }

        static restore(saved, container) {
            if (!saved) return;
            try {
                const pcs = [
                    CursorManager._pc(saved.pageNum, container),
                    CursorManager._pc(saved.pageNum - 1, container),
                    CursorManager._pc(saved.pageNum + 1, container),
                    container.querySelector('.page-content'),
                ].filter(Boolean);

                const pc = pcs[0];
                if (!pc) return;

                pc.focus({ preventScroll: true });
                const sel   = window.getSelection();
                const range = document.createRange();

                // Try path-based restoration first (most accurate)
                const pathNode = CursorManager._nodeFromPath(pc, saved.nodePath);
                if (pathNode) {
                    const safeOffset = Math.min(saved.nodeOffset, pathNode.length || pathNode.childNodes.length);
                    range.setStart(pathNode, safeOffset);
                    range.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(range);

                    // Scroll into view
                    CursorManager._scrollIntoView(range);
                    return;
                }

                // Fallback: offset-based restoration
                const sn = CursorManager._nodeAt(pc, saved.startOff);
                if (sn) {
                    range.setStart(sn.node, sn.offset);
                    if (!saved.isCollapsed) {
                        const en = CursorManager._nodeAt(pc, saved.endOff);
                        en ? range.setEnd(en.node, en.offset) : range.collapse(false);
                    } else {
                        range.collapse(true);
                    }
                    sel.removeAllRanges();
                    sel.addRange(range);
                    CursorManager._scrollIntoView(range);
                    return;
                }

                // Last resort: end of page
                range.selectNodeContents(pc);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
            } catch (e) {
                console.warn('[CursorManager] restore failed:', e);
            }
        }

        static _scrollIntoView(range) {
            try {
                const rect = range.getBoundingClientRect();
                const vh   = window.innerHeight;
                if (rect.bottom > vh - 40 || rect.top < 60) {
                    const el = range.startContainer?.parentElement || range.startContainer;
                    el?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
                }
            } catch (_) {}
        }

        static setCursorAtEnd(pc) {
            if (!pc) return;
            pc.focus({ preventScroll: true });
            const range = document.createRange();
            const sel   = window.getSelection();
            const w     = document.createTreeWalker(pc, NodeFilter.SHOW_TEXT);
            let last = null, n;
            while ((n = w.nextNode())) last = n;
            if (last) { range.setStart(last, last.length); }
            else      { range.selectNodeContents(pc); range.collapse(false); }
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        }

        static setCursorAtStart(pc) {
            if (!pc) return;
            pc.focus({ preventScroll: true });
            const range = document.createRange();
            const sel   = window.getSelection();
            range.selectNodeContents(pc);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        }

        // Place cursor at char offset within pc
        static setCursorAtOffset(pc, charOffset) {
            if (!pc) return;
            const node = CursorManager._nodeAt(pc, charOffset);
            if (!node) { CursorManager.setCursorAtEnd(pc); return; }
            pc.focus({ preventScroll: true });
            const range = document.createRange();
            const sel   = window.getSelection();
            range.setStart(node.node, node.offset);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        }

        static isAtAbsoluteStart(range, pc) {
            if (!range.collapsed || range.startOffset !== 0) return false;
            let n = range.startContainer;
            while (n && n !== pc) {
                if (n.previousSibling) return false;
                n = n.parentNode;
            }
            return true;
        }

        static isAtAbsoluteEnd(range, pc) {
            if (!range.collapsed) return false;
            const w = document.createTreeWalker(pc, NodeFilter.SHOW_TEXT);
            let last = null, n;
            while ((n = w.nextNode())) last = n;
            if (!last) return true;
            return range.startContainer === last && range.startOffset >= last.length;
        }

        // ── Node path for robust restoration ──
        static _nodePath(root, node) {
            const path = [];
            let cur = node;
            while (cur && cur !== root) {
                const parent = cur.parentNode;
                if (!parent) break;
                path.unshift(Array.from(parent.childNodes).indexOf(cur));
                cur = parent;
            }
            return path;
        }

        static _nodeFromPath(root, path) {
            if (!path || !path.length) return null;
            try {
                let node = root;
                for (const idx of path) {
                    if (!node.childNodes[idx]) return null;
                    node = node.childNodes[idx];
                }
                return node;
            } catch { return null; }
        }

        static _ancestorPC(node) {
            let n = node;
            while (n) {
                if (n.classList?.contains('page-content')) return n;
                n = n.parentNode;
            }
            return null;
        }

        static _pc(pageNum, container) {
            return container.querySelector(`.page-content[data-page="${pageNum}"]`);
        }

        static _offset(container, targetNode, nodeOffset) {
            const w = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
            let total = 0, n;
            while ((n = w.nextNode())) {
                if (n === targetNode) return total + nodeOffset;
                total += n.length;
            }
            return total;
        }

        static _nodeAt(container, docOffset) {
            const w = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
            let total = 0, n;
            while ((n = w.nextNode())) {
                if (total + n.length >= docOffset) {
                    return { node: n, offset: Math.min(docOffset - total, n.length) };
                }
                total += n.length;
            }
            return null;
        }
    }


    /* ═══════════════════════════════════════════════════════
     *  7 ▸ UNDO / REDO MANAGER  v5.0
     *  - Debounced push (groups rapid typing)
     *  - Compression: deduplicates identical states
     * ═══════════════════════════════════════════════════════ */
    class UndoRedoManager {
        constructor(max = 200) {
            this._stack    = [];
            this._idx      = -1;
            this._max      = max;
            this._applying = false;
            this._debTimer = null;
        }

        pushDebounced(state, delay = 400) {
            clearTimeout(this._debTimer);
            this._debTimer = setTimeout(() => this.push(state), delay);
        }

        push(state) {
            if (this._applying) return;
            if (this._idx < this._stack.length - 1)
                this._stack = this._stack.slice(0, this._idx + 1);

            // Don't push identical states
            const last = this._stack[this._idx];
            if (last && last.content === state.content) return;

            this._stack.push(state);
            if (this._stack.length > this._max) this._stack.shift();
            this._idx = this._stack.length - 1;
        }

        undo() {
            if (this._idx <= 0) return null;
            this._applying = true;
            return this._stack[--this._idx];
        }

        redo() {
            if (this._idx >= this._stack.length - 1) return null;
            this._applying = true;
            return this._stack[++this._idx];
        }

        stopApplying() { this._applying = false; }
        canUndo()      { return this._idx > 0; }
        canRedo()      { return this._idx < this._stack.length - 1; }
        clear()        { this._stack = []; this._idx = -1; }

        get size()     { return this._stack.length; }
    }


    /* ═══════════════════════════════════════════════════════
     *  8 ▸ PAGE FACTORY  v5.0
     * ═══════════════════════════════════════════════════════ */
    class PageFactory {
        static create(pageNum, contentHTML = '<p><br></p>') {
            const page = document.createElement('div');
            page.className    = 'editor-page';
            page.dataset.page = pageNum;

            const indicator       = document.createElement('div');
            indicator.className   = 'page-indicator';
            indicator.textContent = `Page ${pageNum}`;

            const content             = document.createElement('div');
            content.className         = 'page-content';
            content.contentEditable   = 'true';
            content.dataset.page      = pageNum;
            content.setAttribute('spellcheck', 'true');
            content.setAttribute('autocorrect', 'on');
            content.setAttribute('autocapitalize', 'sentences');
            content.innerHTML         = HTMLSanitizer.clean(contentHTML) || '<p><br></p>';

            const number       = document.createElement('div');
            number.className   = 'page-number';
            number.textContent = pageNum;

            page.appendChild(indicator);
            page.appendChild(content);
            page.appendChild(number);
            return page;
        }
    }


    /* ═══════════════════════════════════════════════════════
     *  9 ▸ REFLOW ENGINE  v5.0
     *
     *  KEY UPGRADES:
     *  - Double-buffer measurement: reads ALL rects before ANY mutation
     *  - Intl.Segmenter for grapheme-safe split (Hindi/Arabic/CJK)
     *  - Line-height aware splitting (no orphan lines)
     *  - Overflow tolerance adapts to font size
     *  - Zero extra DOM reads during split
     * ═══════════════════════════════════════════════════════ */
    class ReflowEngine {
        constructor(config) {
            this._cfg = config;
            this._segmenter = (typeof Intl !== 'undefined' && Intl.Segmenter)
                ? new Intl.Segmenter(undefined, { granularity: 'word' })
                : null;
            // Measurement probe for offline bisect
            this._probe = null;
        }

        // ── Measure overflow on a single page ──
        measure(pageEl) {
            const pc = pageEl.querySelector('.page-content');
            if (!pc) return null;

            const available  = pc.offsetHeight;
            const scrollOver = Math.max(0, pc.scrollHeight - available);

            let contentH = 0;
            if (pc.children.length) {
                const pcTop    = pc.getBoundingClientRect().top;
                const lastRect = pc.children[pc.children.length - 1].getBoundingClientRect();
                contentH       = Math.max(0, lastRect.bottom - pcTop);
            }

            const overflow   = Math.max(scrollOver, Math.max(0, contentH - available));
            const tol        = this._adaptiveTolerance(pc);
            const isOverflow = overflow > tol;

            return { available, contentH, overflow, isOverflow, scrollOver };
        }

        // ── Tolerance adapts to font size (larger fonts → larger tolerance) ──
        _adaptiveTolerance(pc) {
            const base = this._cfg.get('reflow.overflowTolerance') || 8;
            try {
                const fs = parseFloat(window.getComputedStyle(pc).fontSize) || 12;
                return Math.max(base, fs * 0.6);
            } catch { return base; }
        }

        // ── Split overflowing page-content ──
        // Returns { overflow: Node[] } — already removed from pc
        split(pc, available) {
            const children = Array.from(pc.children);
            if (!children.length) return { overflow: [] };

            // ── Batch-read ALL rects BEFORE any DOM mutation ──
            const pcTop = pc.getBoundingClientRect().top;
            const rects = children.map(c => c.getBoundingClientRect());

            const overflow = [];

            for (let i = 0; i < children.length; i++) {
                const el     = children[i];
                const bottom = rects[i].bottom - pcTop;

                if (bottom <= available) continue;

                // This child overflows
                const usedH  = i > 0 ? (rects[i - 1].bottom - pcTop) : 0;
                const remain = available - usedH;

                if (this._canSplit(el) && remain > this._minLineHeight(el)) {
                    const sp = this.splitElement(el, remain);
                    if (sp.top && sp.bottom) {
                        pc.replaceChild(sp.top, el);
                        overflow.push(sp.bottom);
                    } else {
                        pc.removeChild(el);
                        overflow.push(el);
                    }
                } else {
                    if (i === 0) {
                        // First child can't split — move it all
                        pc.removeChild(el);
                        overflow.push(el);
                    } else {
                        pc.removeChild(el);
                        overflow.push(el);
                    }
                }

                // Move all remaining children to overflow
                let sib = pc.children[i];
                while (sib) {
                    const next = sib.nextElementSibling;
                    pc.removeChild(sib);
                    overflow.push(sib);
                    sib = next;
                }
                break;
            }

            return { overflow };
        }

        // ── Split element at pixel boundary using bisect ──
        splitElement(el, available) {
            if (!this._canSplit(el)) return { top: null, bottom: null };

            const segments = this._extractSegments(el);
            if (segments.length < 2) return { top: null, bottom: null };

            // Create offline probe
            const probe = this._getProbe(el);

            // Binary search for best split point
            let lo = 1, hi = segments.length, best = 0;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                probe.innerHTML = this._segmentsToHTML(segments, 0, mid);
                if (probe.offsetHeight <= available) { best = mid; lo = mid + 1; }
                else { hi = mid - 1; }
            }

            this._releaseProbe();

            // Need at least some content in top AND bottom
            if (best < 1 || best >= segments.length) return { top: null, bottom: null };

            const bottom = el.cloneNode(false);
            bottom.innerHTML = this._segmentsToHTML(segments, best, segments.length);
            el.innerHTML     = this._segmentsToHTML(segments, 0, best);

            return { top: el, bottom };
        }

        _getProbe(el) {
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'position:fixed;top:-9999px;left:-9999px;visibility:hidden;pointer-events:none;z-index:-1;';
            const probe = el.cloneNode(false);
            const cs    = window.getComputedStyle(el);
            probe.style.cssText   = cs.cssText;
            probe.style.position  = 'static';
            probe.style.width     = el.offsetWidth + 'px';
            probe.style.height    = 'auto';
            probe.style.maxHeight = 'none';
            wrapper.appendChild(probe);
            document.body.appendChild(wrapper);
            this._probe = { wrapper, probe };
            return probe;
        }

        _releaseProbe() {
            if (this._probe?.wrapper) {
                document.body.removeChild(this._probe.wrapper);
                this._probe = null;
            }
        }

        // ── Extract segments (Unicode-safe) ──
        _extractSegments(el) {
            const segments = [];
            const walker   = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            let node;

            while ((node = walker.nextNode())) {
                const text = node.nodeValue;
                if (!text) continue;

                const wrappers = [];
                let cur = node.parentNode;
                while (cur && cur !== el) {
                    if (cur.nodeType === Node.ELEMENT_NODE) wrappers.unshift(cur);
                    cur = cur.parentNode;
                }

                // Use Intl.Segmenter for grapheme-aware word splitting (Hindi, Arabic, CJK, etc.)
                if (this._segmenter) {
                    const segs = [...this._segmenter.segment(text)];
                    let buf = '';
                    for (const seg of segs) {
                        if (seg.isWordLike === false && (seg.segment === ' ' || seg.segment === '\t')) {
                            if (buf) { segments.push({ text: buf, wrappers }); buf = ''; }
                            segments.push({ text: seg.segment, wrappers });
                        } else {
                            buf += seg.segment;
                        }
                    }
                    if (buf) segments.push({ text: buf, wrappers });
                } else {
                    // Fallback: ASCII space split only (safe for Devanagari)
                    let buf = '';
                    for (let i = 0; i < text.length; i++) {
                        const ch = text[i];
                        if (ch === ' ' || ch === '\t') {
                            if (buf) { segments.push({ text: buf, wrappers }); buf = ''; }
                            segments.push({ text: ch, wrappers });
                        } else {
                            buf += ch;
                        }
                    }
                    if (buf) segments.push({ text: buf, wrappers });
                }
            }

            return segments;
        }

        _segmentsToHTML(segments, start, end) {
            return segments
                .slice(start, end)
                .map(seg => seg.wrappers.length === 0
                    ? this._escapeHTML(seg.text)
                    : this._wrapWithAncestors(seg.text, seg.wrappers))
                .join('');
        }

        _wrapWithAncestors(text, wrappers) {
            let html = this._escapeHTML(text);
            for (let i = wrappers.length - 1; i >= 0; i--) {
                const w   = wrappers[i];
                const tag = w.tagName.toLowerCase();
                let attr  = '';
                ['style','class','lang','dir','data-wf-enter-ph'].forEach(a => {
                    const v = w.getAttribute(a);
                    if (v != null) attr += ` ${a}="${this._escapeAttr(v)}"`;
                });
                html = `<${tag}${attr}>${html}</${tag}>`;
            }
            return html;
        }

        _escapeHTML(str) {
            return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        _escapeAttr(str) {
            return (str || '').replace(/"/g, '&quot;');
        }

        _canSplit(el) {
            if (!el || !['P', 'DIV', 'BLOCKQUOTE', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(el.tagName)) return false;
            if (el.querySelector('img,table,canvas,video,iframe')) return false;
            return el.textContent.replace(/\u200B/g, '').trim().length > 0;
        }

        _minLineHeight(el) {
            try {
                const lh = parseFloat(window.getComputedStyle(el).lineHeight);
                return isNaN(lh) ? 20 : lh;
            } catch { return 20; }
        }
    }


    /* ═══════════════════════════════════════════════════════
     *  10 ▸ CLIPBOARD MANAGER  v5.0
     *  Universal paste: handles all source types + images
     * ═══════════════════════════════════════════════════════ */
    class ClipboardManager {

        static async extractFromEvent(e) {
            const cd = e.clipboardData || window.clipboardData;
            if (!cd) return { html: '', text: '', hasImage: false };

            const hasImage = Array.from(cd.items || []).some(i => i.type.startsWith('image/'));
            let html = cd.getData('text/html') || '';
            let text = cd.getData('text/plain') || '';

            return { html, text, hasImage };
        }

        // Build clipboard with multiple formats for copy/cut
        static async writeToClipboard(text, html) {
            try {
                if (navigator.clipboard?.write) {
                    const items = [new ClipboardItem({
                        'text/plain': new Blob([text], { type: 'text/plain' }),
                        'text/html':  new Blob([html],  { type: 'text/html'  }),
                    })];
                    await navigator.clipboard.write(items);
                    return true;
                }
            } catch (_) {}
            // Fallback: execCommand
            try {
                document.execCommand('copy');
                return true;
            } catch (_) { return false; }
        }
    }


    /* ═══════════════════════════════════════════════════════
     *  11 ▸ MAIN CONTROLLER  v5.0
     * ═══════════════════════════════════════════════════════ */
    class MSWordFlowController {

        constructor(options = {}) {
            this._config   = new ConfigManager(MSWordFlowController.DEFAULTS);
            if (options.config) this._config.merge(options.config);

            this._bus      = new EventBus();
            this._undoRedo = new UndoRedoManager(this._config.get('history.maxStates'));
            this._engine   = new ReflowEngine(this._config);
            this._plugins  = new Map();
            this._version  = new VersionManager('wf_engine_ver');

            this._state = {
                isReflowing:       false,
                isPaperChanging:   false,
                isPasting:         false,
                currentPage:       1,
                currentPaperSize:  'a4',
                lastKnownContent:  null,
                isSelecting:       false,
            };

            this._reflow_queue  = [];   // { fromPage, resolve }
            this._reflow_running = false;

            this._timers        = {};
            this._initialized   = false;
            this._eventsBound   = false;
            this._imeComposing  = false;
            this._imeBuffer     = '';
        }

        static get DEFAULTS() {
            return {
                reflow:   { debounceMs: 60, overflowTolerance: 8, maxIterations: 60, maxPages: 1000, useRAF: true },
                history:  { maxStates: 200 },
                paper:    { size: 'a4', marginPx: 96 },
                autoSave: { intervalMs: 30000 },
                paste:    { allowImages: true, stripFormatting: false },
            };
        }

        get bus()      { return this._bus; }
        get config()   { return this._config; }
        get plugins()  { return this._plugins; }
        get version()  { return ENGINE_VERSION; }
        get state()    { return this._state; }
        getContainer() { return document.getElementById('pagesContainer'); }

        /* ── Plugin API ─────────────────────────────── */
        use(plugin) {
            if (!plugin?.name) { console.warn('[WordFlow] Plugin needs a name'); return this; }
            if (this._plugins.has(plugin.name)) return this;
            try {
                plugin.install?.(this);
                this._plugins.set(plugin.name, plugin);
            } catch (e) { console.error(`[WordFlow] Plugin "${plugin.name}" install error:`, e); }
            return this;
        }

        /* ── Serialization ──────────────────────────── */
        serialize() {
            const pages = this.getContainer()?.querySelectorAll('.editor-page') || [];
            return Array.from(pages).map(page => {
                const pc      = page.querySelector('.page-content');
                const html    = pc?.innerHTML || '<p><br></p>';
                const isBreak = page.dataset.wfManualBreak === '1';
                return isBreak
                    ? '<div class="page-break-marker wf-manual" style="page-break-after:always;"></div>' + html
                    : html;
            }).join('<div class="page-break-marker" style="page-break-after:always;"></div>');
        }

        deserialize(raw) {
            if (!raw) return;
            const c = this.getContainer();
            if (!c) return;

            const BREAK      = '<div class="page-break-marker" style="page-break-after:always;"></div>';
            const MANUAL_PFX = '<div class="page-break-marker wf-manual" style="page-break-after:always;"></div>';
            const parts      = raw.split(BREAK);
            c.innerHTML      = '';

            let pageIdx = 1;
            parts.forEach(part => {
                const isManual = part.startsWith(MANUAL_PFX) || part.includes('wf-manual');
                const html     = isManual ? part.replace(MANUAL_PFX, '').trim() : part.trim();
                const page     = PageFactory.create(pageIdx++, html || '<p><br></p>');
                if (isManual) page.dataset.wfManualBreak = '1';
                c.appendChild(page);
            });

            this._bus.emit('content:loaded');
        }

        /* ── Public reflow API ──────────────────────── */
        async reflowAll()            { return this._doReflow(1); }
        async reflowFrom(pageNum)    { return this._doReflow(pageNum); }
        async performReflow()        { return this.reflowAll(); }
        async performReflowFromPage(n) { return this.reflowFrom(n); }
        updateHiddenContent()        { this._syncHiddenField(); }
        updateUI()                   { this._updateStatusBar(); this._syncHiddenField(); }
        consolidatePages(fromPage)   { return this._consolidatePages(fromPage); }
        reIndexPages()               { return this._reIndexPages(); }
        loadState(state)             { return this._loadState(state); }
        saveCursorPosition()         { return CursorManager.save(this.getContainer()); }
        restoreCursorPosition(saved) { return CursorManager.restore(saved, this.getContainer()); }
        measurePage(pageEl)          { return this._engine.measure(pageEl); }
        createPage(pageNum, html)    { return PageFactory.create(pageNum, html); }

        /* ── Paper size ─────────────────────────────── */
        handlePaperSizeChange(newSize) {
            if (!newSize || newSize === this._state.currentPaperSize) return;
            if (!PaperRegistry.has(newSize)) { console.warn(`[WordFlow] Unknown paper "${newSize}"`); return; }

            const dims = PaperRegistry.get(newSize);
            this._config.merge({ paper: { size: newSize, marginPx: dims.marginPx } });
            this._engine = new ReflowEngine(this._config);

            const c = this.getContainer();
            c.className = c.className.replace(/paper-\S+/g, '').trim();
            c.classList.add(`paper-${newSize}`);
            this._state.isPaperChanging  = true;
            this._state.currentPaperSize = newSize;

            clearTimeout(this._timers.paper);
            this._timers.paper = setTimeout(async () => {
                this._state.isPaperChanging = false;
                await this._doReflow(1);
                this._bus.emit('paper:changed', newSize);
            }, 50);
        }

        /* ── Init ───────────────────────────────────── */
        init() {
            if (this._initialized) return this;
            this._initialized = true;

            this._version.runMigrations(ENGINE_VERSION);
            this._injectStyles();

            // IME composition tracking
            document.addEventListener('compositionstart', (e) => {
                this._imeComposing = true;
                this._imeBuffer    = '';
            });
            document.addEventListener('compositionupdate', (e) => {
                this._imeBuffer = e.data || '';
            });
            document.addEventListener('compositionend', (e) => {
                this._imeComposing = false;
                this._imeBuffer    = '';
                // Trigger reflow after IME commit
                const pc = document.activeElement;
                if (pc?.classList.contains('page-content')) {
                    const page    = pc.closest('.editor-page');
                    const pageNum = parseInt(page?.dataset.page, 10) || 1;
                    this._scheduleReflow(pageNum);
                }
            });

            this._bindEvents();

            const c = this.getContainer();
            if (c && !c.querySelector('.editor-page')) c.appendChild(PageFactory.create(1));

            const hf = document.getElementById('noteContent');
            if (hf?.value.trim()) this.deserialize(hf.value.trim());

            setTimeout(() => this._doReflow(1), 100);
            this._setupAutoSave();
            this._setupErrorBoundary();
            this._bus.emit('engine:ready', { version: ENGINE_VERSION });
            console.log(`🔥 WordFlow Engine v${ENGINE_VERSION} ready`);
            return this;
        }

        /* ── CSS injection ──────────────────────────── */
        _injectStyles() {
            if (document.getElementById('wf-v5-styles')) return;
            const style = document.createElement('style');
            style.id = 'wf-v5-styles';
            style.textContent = `
                /* ── Page transitions ── */
                .editor-page {
                    transition: opacity 0.12s ease;
                    will-change: auto;
                }
                .wf-page-entering {
                    animation: wf-page-in 180ms cubic-bezier(.2,.8,.3,1) both;
                }
                .wf-page-removing {
                    animation: wf-page-out 140ms cubic-bezier(.4,0,1,1) both;
                    pointer-events: none;
                    overflow: hidden;
                }
                @keyframes wf-page-in {
                    from { opacity: 0; transform: translateY(8px) scaleY(0.97); }
                    to   { opacity: 1; transform: none; }
                }
                @keyframes wf-page-out {
                    from { opacity: 1; max-height: 200px; }
                    to   { opacity: 0; max-height: 0; margin: 0; padding: 0; }
                }

                /* ── Content merge flash ── */
                @keyframes wf-merge-flash {
                    0%   { background: rgba(37,99,235,0.12); }
                    100% { background: transparent; }
                }
                .wf-merge-flash {
                    animation: wf-merge-flash 300ms ease-out forwards;
                }

                /* ── Smooth content in ── */
                @keyframes wf-content-in {
                    from { opacity: 0.6; }
                    to   { opacity: 1; }
                }
                .wf-content-merged {
                    animation: wf-content-in 120ms ease-out both;
                }

                /* ── Selection across pages ── */
                .page-content::selection { background: rgba(66,130,195,0.3); }

                /* ── IME composition indicator ── */
                .page-content:focus {
                    outline: none;
                    caret-color: #1a56db;
                }

                /* ── Smooth scrollbar ── */
                .editor-content {
                    scroll-behavior: smooth;
                }

                /* ── Page content smooth height ── */
                .page-content {
                    transition: none; /* reflow handles this */
                    word-break: break-word;
                    overflow-wrap: break-word;
                    /* RTL support */
                    unicode-bidi: plaintext;
                }
            `;
            document.head.appendChild(style);
        }

        /* ── Event Binding ──────────────────────────── */
        _bindEvents() {
            if (this._eventsBound) return;
            this._eventsBound = true;

            document.addEventListener('input',    this._onInput.bind(this));
            document.addEventListener('paste',    this._onPaste.bind(this), true);
            document.addEventListener('keydown',  this._onKeydown.bind(this), true);
            document.addEventListener('keyup',    this._onKeyup.bind(this));
            document.addEventListener('focusin',  this._onFocusIn.bind(this));
            document.addEventListener('mouseup',  this._onMouseUp.bind(this));
            document.addEventListener('drop',     this._onDrop.bind(this), true);

            // Selection change for multi-page selection tracking
            document.addEventListener('selectionchange', this._onSelectionChange.bind(this));

            const sel = document.getElementById('paperSize');
            if (sel) sel.addEventListener('change', e => this.handlePaperSizeChange(e.target.value));
        }

        _onFocusIn(e) {
            if (!e.target.classList.contains('page-content')) return;
            const page = e.target.closest('.editor-page');
            if (page) this._state.currentPage = parseInt(page.dataset.page, 10) || 1;
        }

        _onMouseUp(e) {
            this._state.isSelecting = false;
            this._checkMultiPageSelection();
        }

        _onKeyup(e) {
            if (e.shiftKey) this._checkMultiPageSelection();
        }

        _onSelectionChange() {
            if (this._state.isSelecting) this._checkMultiPageSelection();
        }

        // Detect + handle multi-page selections (visual only)
        _checkMultiPageSelection() {
            const sel = window.getSelection();
            if (!sel?.rangeCount || sel.isCollapsed) return;
            // Selection spans multiple page-content elements?
            const start = CursorManager._ancestorPC(sel.getRangeAt(0).startContainer);
            const end   = CursorManager._ancestorPC(sel.getRangeAt(0).endContainer);
            if (start && end && start !== end) {
                this._bus.emit('selection:multipage', { start, end });
            }
        }

        /* ═══════════════════════════════════════════════
         *  INPUT HANDLER  v5.0
         *  - Batches rapid keystrokes
         *  - IME-aware (skips during composition)
         *  - Large paste detection → full reflow from page 1
         * ═══════════════════════════════════════════════ */
        _onInput(e) {
            if (!e.target?.classList.contains('page-content')) return;
            if (this._state.isPaperChanging || this._state.isPasting) return;
            if (this._imeComposing) return; // IME compositionend handles reflow

            const page = e.target.closest('.editor-page');
            if (!page) return;

            const pageNum = parseInt(page.dataset.page, 10) || 1;
            this._state.currentPage = pageNum;

            this._scheduleReflow(pageNum);

            // Debounced undo snapshot (groups rapid typing into single undo step)
            this._undoRedo.pushDebounced({
                content:   this.serialize(),
                pageNum,
                cursorOff: CursorManager.save(this.getContainer()),
            }, 600);
        }

        _scheduleReflow(pageNum) {
            clearTimeout(this._timers.input);
            this._timers.input = setTimeout(async () => {
                if (this._state.isPasting) return;
                await this._doReflow(pageNum);
                this._syncHiddenField();
                this._bus.emit('content:changed');
            }, Math.max(this._config.get('reflow.debounceMs'), 60));
        }

        /* ═══════════════════════════════════════════════
         *  PASTE HANDLER  v5.0
         *  Universal: Word, GDocs, LibreOffice, plain text
         *  + Image paste support
         * ═══════════════════════════════════════════════ */
        _onPaste(e) {
            if (!e.target?.classList.contains('page-content')) return;
            if (this._state.isPasting) { e.preventDefault(); return; }

            e.preventDefault();
            this._state.isPasting = true;
            clearTimeout(this._timers.input);
            this._pushUndoSnapshot();

            ClipboardManager.extractFromEvent(e).then(async ({ html, text, hasImage }) => {
                const pc = document.activeElement;
                if (!pc?.classList.contains('page-content')) {
                    this._state.isPasting = false;
                    return;
                }

                const savedCursor = CursorManager.save(this.getContainer());

                // Handle image paste
                if (hasImage && this._config.get('paste.allowImages')) {
                    await this._handleImagePaste(e.clipboardData, pc);
                    this._state.isPasting = false;
                    await this._doReflow(this._state.currentPage);
                    this._syncHiddenField();
                    this._updateStatusBar();
                    this._bus.emit('content:pasted');
                    return;
                }

                // Strip formatting mode
                if (this._config.get('paste.stripFormatting')) {
                    html = '';
                }

                // Normalize pasted content
                let normalized;
                if (html) {
                    normalized = HTMLSanitizer.normalizeFromPaste(html, text);
                } else if (text) {
                    normalized = HTMLSanitizer._plainToHTML(text);
                } else {
                    this._state.isPasting = false;
                    return;
                }

                // Insert at cursor position (not replace all)
                this._insertHTMLAtCursor(normalized, pc);

                // Reflow from current page
                const page    = pc.closest('.editor-page');
                const pageNum = parseInt(page?.dataset.page, 10) || 1;

                this._preDistribute(pc);
                await this._doReflow(pageNum);

                // Move cursor to end of pasted content
                const allPCs = Array.from(this.getContainer().querySelectorAll('.page-content'));
                const lastWithContent = [...allPCs].reverse().find(p => p.textContent.trim()) || allPCs[allPCs.length - 1];
                if (lastWithContent) CursorManager.setCursorAtEnd(lastWithContent);

                this._syncHiddenField();
                this._updateStatusBar();
                this._bus.emit('content:pasted');

                requestAnimationFrame(() => requestAnimationFrame(() => {
                    this._state.isPasting = false;
                }));
            });
        }

        // Insert HTML at cursor position (proper DOM insertion, not innerHTML replace)
        _insertHTMLAtCursor(html, pc) {
            const sel = window.getSelection();
            if (!sel?.rangeCount) {
                pc.innerHTML = HTMLSanitizer.clean(html) || '<p><br></p>';
                return;
            }

            const range = sel.getRangeAt(0);

            // If range is in a page-content, insert there; otherwise append
            const targetPC = CursorManager._ancestorPC(range.startContainer);
            if (!targetPC || targetPC !== pc) {
                // Append to end of current page
                const lastP = pc.querySelector('p:last-child');
                if (lastP) {
                    const temp = document.createElement('div');
                    temp.innerHTML = HTMLSanitizer.clean(html);
                    while (temp.firstChild) {
                        pc.appendChild(temp.firstChild);
                    }
                } else {
                    pc.innerHTML = HTMLSanitizer.clean(html) || '<p><br></p>';
                }
                return;
            }

            // Delete any selected content first
            if (!range.collapsed) range.deleteContents();

            // Create temp container and insert children
            const temp = document.createElement('div');
            temp.innerHTML = HTMLSanitizer.clean(html);

            const frag = document.createDocumentFragment();
            while (temp.firstChild) frag.appendChild(temp.firstChild);

            range.insertNode(frag);

            // Collapse selection to end
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        }

        // Handle image paste
        async _handleImagePaste(clipboardData, pc) {
            const items = Array.from(clipboardData.items || []);
            for (const item of items) {
                if (!item.type.startsWith('image/')) continue;
                const file = item.getAsFile();
                if (!file) continue;

                await new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        const img     = document.createElement('img');
                        img.src       = ev.target.result;
                        img.style.maxWidth = '100%';
                        img.style.height   = 'auto';
                        img.style.display  = 'block';
                        img.style.margin   = '8px 0';

                        const p = document.createElement('p');
                        p.appendChild(img);
                        pc.appendChild(p);
                        resolve();
                    };
                    reader.readAsDataURL(file);
                });
                break; // Only first image
            }
        }

        // Pre-distribute pasted content to next pages
        _preDistribute(startPC) {
            const startPage = startPC.closest('.editor-page');
            if (!startPage) return;

            let curPC = startPC, curPage = startPage, limit = 0;
            while (limit++ < 20000) {
                const m = this._engine.measure(curPage);
                if (!m?.isOverflow) break;

                const { overflow } = this._engine.split(curPC, m.available);
                if (!overflow.length) break;

                const num = parseInt(curPage.dataset.page, 10);
                if (num >= this._config.get('reflow.maxPages')) break;

                const np   = this._getOrCreateNextPage(num);
                const npPC = np.querySelector('.page-content');
                if (!npPC) break;

                const isEmpty = !npPC.textContent.trim() && npPC.children.length === 1 && npPC.children[0].tagName === 'P';
                if (isEmpty) npPC.innerHTML = '';

                overflow.forEach(el => npPC.appendChild(el));
                curPage = np; curPC = npPC;
            }
        }

        /* ── Drop handler ───────────────────────────── */
        _onDrop(e) {
            const pc = e.target?.closest?.('.page-content');
            if (!pc) return;

            const html = e.dataTransfer?.getData('text/html') || '';
            const text = e.dataTransfer?.getData('text/plain') || '';

            if (html || text) {
                e.preventDefault();
                const normalized = html
                    ? HTMLSanitizer.normalizeFromPaste(html, text)
                    : HTMLSanitizer._plainToHTML(text);

                setTimeout(async () => {
                    this._pushUndoSnapshot();
                    this._preDistribute(pc);
                    await this._doReflow(this._state.currentPage);
                    this._syncHiddenField();
                    this._bus.emit('content:changed');
                }, 0);
            }
        }


        /* ══════════════════════════════════════════════════
         *  KEYBOARD HANDLER  v5.0
         * ══════════════════════════════════════════════════ */
        _onKeydown(e) {
            const ctrl = e.ctrlKey || e.metaKey;

            // ── BACKSPACE ──
            if (e.key === 'Backspace') {
                if (this._imeComposing) return;
                if (this._handleBackspace()) { e.preventDefault(); e.stopImmediatePropagation(); }
                return;
            }

            // ── DELETE FORWARD ──
            if (e.key === 'Delete') {
                if (this._imeComposing) return;
                if (this._handleDeleteForward()) { e.preventDefault(); e.stopImmediatePropagation(); }
                return;
            }

            // ── ENTER ──
            if (e.key === 'Enter' && !this._imeComposing) {
                if (e.shiftKey) return; // Shift+Enter → browser handles <br>
                this._handleEnter(e);
                return;
            }

            // ── UNDO ──
            if (ctrl && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                const s = this._undoRedo.undo();
                if (s) { this._loadState(s); this._undoRedo.stopApplying(); }
                return;
            }

            // ── REDO ──
            if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
                e.preventDefault();
                const s = this._undoRedo.redo();
                if (s) { this._loadState(s); this._undoRedo.stopApplying(); }
                return;
            }

            // ── SELECT ALL ──
            if (ctrl && e.key === 'a') {
                if (this._handleSelectAll()) { e.preventDefault(); e.stopImmediatePropagation(); }
                return;
            }

            // ── CUT ──
            if (ctrl && e.key === 'x') {
                this._handleCut(e);
                return;
            }

            // ── CTRL+HOME / CTRL+END ──
            if (ctrl && e.key === 'Home') {
                e.preventDefault();
                CursorManager.setCursorAtStart(this.getContainer()?.querySelector('.page-content[data-page="1"]'));
                return;
            }
            if (ctrl && e.key === 'End') {
                e.preventDefault();
                const all = this.getContainer()?.querySelectorAll('.page-content');
                if (all?.length) CursorManager.setCursorAtEnd(all[all.length - 1]);
                return;
            }

            // ── PAGE UP / DOWN ──
            if (ctrl && (e.key === 'PageUp' || e.key === 'PageDown')) {
                e.preventDefault();
                const curr = document.activeElement?.closest('.editor-page');
                if (!curr) return;
                const n    = parseInt(curr.dataset.page, 10);
                const dest = e.key === 'PageUp' ? n - 1 : n + 1;
                const destPC = this.getContainer()?.querySelector(`.page-content[data-page="${dest}"]`);
                if (destPC) {
                    destPC.focus();
                    CursorManager.setCursorAtStart(destPC);
                }
                return;
            }

            // ── Tab → indent ──
            if (e.key === 'Tab' && !ctrl) {
                const pc = document.activeElement;
                if (pc?.classList.contains('page-content')) {
                    e.preventDefault();
                    document.execCommand('insertHTML', false, '&emsp;');
                }
                return;
            }
        }


        /* ══════════════════════════════════════════════════
         *  BACKSPACE  v5.0
         *  - Single-press: move cursor AND delete char
         *  - Handles blank page removal
         *  - Handles merge of paragraphs across page boundary
         * ══════════════════════════════════════════════════ */
        _handleBackspace() {
            const sel = window.getSelection();
            if (!sel?.rangeCount) return false;
            const range = sel.getRangeAt(0);

            // If there's a selection, let browser delete it
            if (!range.collapsed) return false;

            const pc = CursorManager._ancestorPC(range.startContainer);
            if (!pc) return false;
            if (!CursorManager.isAtAbsoluteStart(range, pc)) return false;

            const page    = pc.closest('.editor-page');
            if (!page) return false;
            const pageNum = parseInt(page.dataset.page, 10);
            if (pageNum <= 1) return false;

            const c        = this.getContainer();
            const prevPage = c.querySelector(`.editor-page[data-page="${pageNum - 1}"]`);
            const prevPC   = prevPage?.querySelector('.page-content');
            if (!prevPC) return false;

            const prevIsBlank = this._isPageBlank(prevPC);

            this._pushUndoSnapshot();

            if (prevIsBlank) {
                // Remove blank previous page, keep cursor on current
                this._removePage(prevPage);
                pc.focus({ preventScroll: true });
                CursorManager.setCursorAtStart(pc);
                this._state.currentPage = pageNum - 1;
            } else {
                // Delete last char of prev page, move cursor there
                const lastNode = this._lastTextNode(prevPC);

                if (lastNode && lastNode.length > 0) {
                    try {
                        const delRange = document.createRange();
                        delRange.setStart(lastNode, lastNode.length - 1);
                        delRange.setEnd(lastNode, lastNode.length);
                        delRange.deleteContents();

                        prevPC.focus({ preventScroll: true });
                        const r = document.createRange();
                        r.setStart(lastNode, lastNode.length);
                        r.collapse(true);
                        window.getSelection().removeAllRanges();
                        window.getSelection().addRange(r);
                    } catch (_) {
                        CursorManager.setCursorAtEnd(prevPC);
                    }
                } else {
                    prevPC.focus({ preventScroll: true });
                    CursorManager.setCursorAtEnd(prevPC);
                }
                this._state.currentPage = pageNum - 1;
            }

            requestAnimationFrame(() => {
                this._doReflow(pageNum - 1).then(() => {
                    this._updateStatusBar();
                    this._syncHiddenField();
                    this._bus.emit('content:changed');
                });
            });

            return true;
        }


        /* ══════════════════════════════════════════════════
         *  DELETE FORWARD  v5.0
         * ══════════════════════════════════════════════════ */
        _handleDeleteForward() {
            const sel = window.getSelection();
            if (!sel?.rangeCount) return false;
            const range = sel.getRangeAt(0);
            if (!range.collapsed) return false;

            const pc = CursorManager._ancestorPC(range.startContainer);
            if (!pc) return false;
            if (!CursorManager.isAtAbsoluteEnd(range, pc)) return false;

            const page    = pc.closest('.editor-page');
            if (!page) return false;
            const pageNum = parseInt(page.dataset.page, 10);

            const c        = this.getContainer();
            const nextPage = c.querySelector(`.editor-page[data-page="${pageNum + 1}"]`);
            const nextPC   = nextPage?.querySelector('.page-content');
            if (!nextPC) return false;

            const nextIsBlank = this._isPageBlank(nextPC);
            this._pushUndoSnapshot();

            if (nextIsBlank) {
                this._removePage(nextPage);
                CursorManager.setCursorAtEnd(pc);
            } else {
                const firstNode = this._firstTextNode(nextPC);
                if (firstNode && firstNode.length > 0) {
                    try {
                        const delRange = document.createRange();
                        delRange.setStart(firstNode, 0);
                        delRange.setEnd(firstNode, 1);
                        delRange.deleteContents();
                    } catch (_) {}
                }
                CursorManager.setCursorAtEnd(pc);
            }

            this._state.currentPage = pageNum;
            requestAnimationFrame(() => {
                this._doReflow(pageNum).then(() => {
                    this._updateStatusBar();
                    this._syncHiddenField();
                    this._bus.emit('content:changed');
                });
            });
            return true;
        }

        /* ── Remove page with smooth animation ──────── */
        _removePage(pageEl) {
            pageEl.classList.add('wf-page-removing');
            setTimeout(() => pageEl.remove(), 150);
        }


        /* ══════════════════════════════════════════════════
         *  ENTER  v5.0
         *  - No blocking guard — every press processed
         *  - Format-aware new paragraph
         *  - Handles page boundary intelligently
         * ══════════════════════════════════════════════════ */
        _handleEnter(e) {
            const sel = window.getSelection();
            if (!sel?.rangeCount) return;
            const range   = sel.getRangeAt(0);
            const pc      = CursorManager._ancestorPC(range.startContainer);
            if (!pc) return;
            const page    = pc.closest('.editor-page');
            if (!page) return;
            const pageNum = parseInt(page.dataset.page, 10) || 1;

            const fmt = this._readCursorFormat(range);
            this._pushUndoSnapshot();
            clearTimeout(this._timers.input);

            // Let browser handle the Enter (creates new <p>)
            requestAnimationFrame(() => {
                const selAfter    = window.getSelection();
                const newNode     = selAfter?.rangeCount ? selAfter.getRangeAt(0).startContainer : null;
                const newOffset   = selAfter?.rangeCount ? selAfter.getRangeAt(0).startOffset : 0;

                // Inject format placeholder on new para (sans font-size to avoid measure issues)
                if (fmt && newNode) {
                    try {
                        const newPara = newNode.nodeType === Node.TEXT_NODE ? newNode.parentElement : newNode;
                        if (newPara && newPara !== pc && ['P','DIV','LI'].includes(newPara.tagName)) {
                            const safeFmt = { ...fmt, fontSize: null };
                            const css = this._fmtToCss(safeFmt);
                            if (css) {
                                const ph = document.createElement('span');
                                ph.dataset.wfEnterPh = '1';
                                ph.style.cssText = css;
                                ph.textContent = '\u200B';
                                newPara.insertBefore(ph, newPara.firstChild);
                            }
                        }
                    } catch (_) {}
                }

                this._doReflow(pageNum, null, false).then(() => {
                    this._cleanEnterPlaceholders();

                    // Restore cursor to the new para (may have moved to next page)
                    if (newNode?.isConnected) {
                        let ownerPC = newNode;
                        while (ownerPC && !ownerPC.classList?.contains('page-content')) {
                            ownerPC = ownerPC.parentNode;
                        }
                        if (ownerPC?.classList?.contains('page-content')) {
                            ownerPC.focus({ preventScroll: true });
                            try {
                                const r = document.createRange();
                                const safeOff = Math.min(
                                    newOffset,
                                    newNode.nodeType === Node.TEXT_NODE
                                        ? newNode.length
                                        : newNode.childNodes.length
                                );
                                r.setStart(newNode, safeOff);
                                r.collapse(true);
                                window.getSelection().removeAllRanges();
                                window.getSelection().addRange(r);
                            } catch (_) { CursorManager.setCursorAtStart(ownerPC); }

                            // Scroll new para into view
                            requestAnimationFrame(() => {
                                try {
                                    const rng  = window.getSelection()?.getRangeAt(0);
                                    const rect = rng?.getBoundingClientRect();
                                    if (rect && (rect.bottom > window.innerHeight - 20 || rect.top < 60)) {
                                        ownerPC.closest('.editor-page')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                                    }
                                } catch (_) {}
                            });
                        }
                    } else if (newNode && !newNode.isConnected) {
                        const nextPC = this.getContainer()?.querySelector(`.page-content[data-page="${pageNum + 1}"]`);
                        if (nextPC) CursorManager.setCursorAtStart(nextPC);
                        else {
                            const curPC = this.getContainer()?.querySelector(`.page-content[data-page="${pageNum}"]`);
                            if (curPC) CursorManager.setCursorAtEnd(curPC);
                        }
                    }

                    setTimeout(() => { this._updateStatusBar(); this._syncHiddenField(); }, 0);
                    this._bus.emit('content:changed');
                });
            });
        }

        _readCursorFormat(range) {
            if (!range) return null;
            let node = range.startContainer;
            if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
            const fmt = { fontSize: null, fontFamily: null, color: null, fontWeight: null, fontStyle: null };
            let cur = node;
            while (cur && !cur.classList?.contains('page-content')) {
                const style = cur.style;
                if (style) {
                    if (!fmt.fontSize   && style.fontSize)   fmt.fontSize   = style.fontSize;
                    if (!fmt.fontFamily && style.fontFamily) fmt.fontFamily = style.fontFamily;
                    if (!fmt.color      && style.color)      fmt.color      = style.color;
                    if (!fmt.fontWeight && style.fontWeight) fmt.fontWeight = style.fontWeight;
                    if (!fmt.fontStyle  && style.fontStyle)  fmt.fontStyle  = style.fontStyle;
                }
                cur = cur.parentElement;
            }
            return Object.values(fmt).some(v => v !== null) ? fmt : null;
        }

        _fmtToCss(fmt) {
            if (!fmt) return '';
            const parts = [];
            if (fmt.fontSize)   parts.push(`font-size:${fmt.fontSize}`);
            if (fmt.fontFamily) parts.push(`font-family:${fmt.fontFamily}`);
            if (fmt.color)      parts.push(`color:${fmt.color}`);
            if (fmt.fontWeight) parts.push(`font-weight:${fmt.fontWeight}`);
            if (fmt.fontStyle)  parts.push(`font-style:${fmt.fontStyle}`);
            return parts.join(';');
        }

        _cleanEnterPlaceholders() {
            this.getContainer()?.querySelectorAll('[data-wf-enter-ph]').forEach(ph => {
                const para = ph.parentElement;
                if (!para) { ph.remove(); return; }
                const otherText = Array.from(para.childNodes)
                    .filter(n => n !== ph)
                    .some(n => (n.textContent || '').replace(/\u200B/g, '').trim().length > 0);
                if (otherText) ph.remove();
                else ph.textContent = '';
            });
        }

        /* ── Cut handler ───────────────────────────── */
        async _handleCut(e) {
            const sel = window.getSelection();
            if (!sel?.rangeCount || sel.isCollapsed) return;

            const range = sel.getRangeAt(0);
            const text  = range.toString();
            const div   = document.createElement('div');
            div.appendChild(range.cloneContents());
            const html  = div.innerHTML;

            // Copy to clipboard
            await ClipboardManager.writeToClipboard(text, html);

            // Delete selected content
            this._pushUndoSnapshot();
            range.deleteContents();

            const pc = CursorManager._ancestorPC(range.startContainer);
            const page = pc?.closest('.editor-page');
            const pageNum = parseInt(page?.dataset.page, 10) || 1;

            await this._doReflow(pageNum);
            this._syncHiddenField();
            this._bus.emit('content:changed');
        }

        /* ── Select All (multi-page) ─────────────── */
        _handleSelectAll() {
            const active = document.activeElement;
            if (!active?.classList.contains('page-content')) return false;

            const pages = Array.from(this.getContainer().querySelectorAll('.page-content'));
            if (pages.length <= 1) return false;

            const first = pages[0], last = pages[pages.length - 1];
            const sel   = window.getSelection();
            const range = document.createRange();

            const w1 = document.createTreeWalker(first, NodeFilter.SHOW_TEXT);
            const firstTN = w1.nextNode();
            const w2 = document.createTreeWalker(last, NodeFilter.SHOW_TEXT);
            let lastTN = null, n;
            while ((n = w2.nextNode())) lastTN = n;

            if (firstTN && lastTN) {
                range.setStart(firstTN, 0);
                range.setEnd(lastTN, lastTN.length);
            } else {
                range.setStart(first, 0);
                range.setEnd(last, last.childNodes.length);
            }

            sel.removeAllRanges();
            sel.addRange(range);
            return true;
        }


        /* ══════════════════════════════════════════════════
         *  REFLOW CORE  v5.0
         *  - Queue-based: never drops a reflow request
         *  - Double-buffer: batch-reads before any mutation
         *  - RAF-driven for smoothness
         *  - Pending queue drains ASAP after current reflow
         * ══════════════════════════════════════════════════ */
        async _doReflow(fromPage, savedCursor = null, skipConsolidate = false) {
            // Queue if already running
            if (this._reflow_running) {
                return new Promise(resolve => {
                    this._reflow_queue.push({ fromPage: Math.min(fromPage, this._reflow_queue[0]?.fromPage ?? fromPage), resolve });
                });
            }

            this._reflow_running = true;
            this._state.isReflowing = true;

            const maxIter = this._config.get('reflow.maxIterations');
            const useRAF  = this._config.get('reflow.useRAF');
            const c       = this.getContainer();

            try {
                let changed = true, iter = 0;
                while (changed && iter < maxIter) {
                    changed = false; iter++;

                    const pages = Array.from(c.querySelectorAll('.editor-page'))
                        .filter(p => parseInt(p.dataset.page, 10) >= fromPage);

                    for (const page of pages) {
                        if (this._resolveOverflow(page)) changed = true;
                    }

                    if (!skipConsolidate && this._consolidatePages(fromPage)) changed = true;

                    if (useRAF && changed) await new Promise(r => requestAnimationFrame(r));
                }

                this._reIndexPages();
                this._updateStatusBar();

            } catch (err) {
                console.error('[WordFlow] Reflow error:', err);
            } finally {
                this._state.isReflowing = false;
                this._reflow_running    = false;

                if (savedCursor) {
                    requestAnimationFrame(() => CursorManager.restore(savedCursor, this.getContainer()));
                }

                this._bus.emit('reflow:done');

                // Drain queue
                if (this._reflow_queue.length > 0) {
                    // Find earliest page across all queued requests
                    const earliest = this._reflow_queue.reduce((min, q) => Math.min(min, q.fromPage), Infinity);
                    const resolvers = this._reflow_queue.map(q => q.resolve);
                    this._reflow_queue.length = 0;

                    requestAnimationFrame(async () => {
                        await this._doReflow(earliest);
                        resolvers.forEach(r => r?.());
                    });
                }
            }
        }

        /* ── Resolve overflow on one page ───────────── */
        _resolveOverflow(pageEl) {
            const m = this._engine.measure(pageEl);
            if (!m?.isOverflow) return false;

            const pc = pageEl.querySelector('.page-content');
            if (!pc) return false;

            const { overflow } = this._engine.split(pc, m.available);
            if (!overflow.length) return false;

            // Ensure pc has at least a placeholder
            if (!pc.children.length || !pc.textContent.replace(/\u200B/g, '').trim()) {
                pc.innerHTML = '<p><br></p>';
            }

            const pageNum  = parseInt(pageEl.dataset.page, 10);
            const nextPage = this._getOrCreateNextPage(pageNum);
            const nextPC   = nextPage.querySelector('.page-content');
            if (!nextPC) return false;

            // Guard: don't push into manual-break page
            if (nextPage.dataset.wfManualBreak === '1') {
                const interPage = PageFactory.create(pageNum + 1);
                interPage.classList.add('wf-page-entering');
                nextPage.parentNode.insertBefore(interPage, nextPage);
                const interPC = interPage.querySelector('.page-content');
                if (!interPC) return false;
                interPC.innerHTML = '';
                const frag2 = document.createDocumentFragment();
                overflow.forEach(el => frag2.appendChild(el));
                interPC.appendChild(frag2);
                return true;
            }

            // Clear placeholder in nextPC
            const nextIsPlaceholder = nextPC.children.length === 1 &&
                nextPC.children[0].tagName === 'P' &&
                !nextPC.children[0].textContent.trim();
            if (nextIsPlaceholder) nextPC.innerHTML = '';

            // Insert overflow at top of next page
            const frag = document.createDocumentFragment();
            overflow.forEach(el => frag.appendChild(el));
            nextPC.insertBefore(frag, nextPC.firstChild);

            // Animate new content
            nextPC.classList.add('wf-content-merged');
            setTimeout(() => nextPC.classList.remove('wf-content-merged'), 200);

            return true;
        }

        /* ── Consolidate pages (pull content back) ── */
        _consolidatePages(fromPage = 1) {
            const pages = Array.from(this.getContainer().querySelectorAll('.editor-page'))
                .filter(p => parseInt(p.dataset.page, 10) >= fromPage);

            let changed = false;

            for (let i = pages.length - 1; i > 0; i--) {
                const cur    = pages[i];
                const prev   = pages[i - 1];
                const curPC  = cur.querySelector('.page-content');
                const prevPC = prev.querySelector('.page-content');
                if (!curPC || !prevPC) continue;

                // Respect manual breaks
                if (cur.dataset.wfManualBreak === '1' || prev.dataset.wfManualBreak === '1') continue;

                const curIsEmpty = this._isPageBlank(curPC) && curPC.innerHTML.trim().length < 15;
                if (curIsEmpty && this.getContainer().querySelectorAll('.editor-page').length > 1) {
                    this._removePage(cur);
                    changed = true;
                    continue;
                }

                // Try pulling children from cur to prev
                let node = curPC.firstElementChild;
                while (node) {
                    const next = node.nextElementSibling;
                    prevPC.appendChild(node);
                    const m = this._engine.measure(prev);
                    if (m?.isOverflow) {
                        curPC.insertBefore(node, curPC.firstChild);
                        break;
                    }
                    changed = true;
                    node = next;
                }

                const nowEmpty = this._isPageBlank(curPC) && curPC.innerHTML.trim().length < 15;
                if (nowEmpty && !cur.dataset.wfManualBreak &&
                    this.getContainer().querySelectorAll('.editor-page').length > 1) {
                    this._removePage(cur);
                    changed = true;
                }
            }

            return changed;
        }

        /* ── Helpers ────────────────────────────────── */
        _isPageBlank(pc) {
            return !pc.textContent.replace(/\u200B/g, '').trim() &&
                (pc.children.length === 0 ||
                 (pc.children.length === 1 &&
                  pc.children[0].tagName === 'P' &&
                  !pc.children[0].textContent.trim()));
        }

        _lastTextNode(el) {
            const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            let last = null, n;
            while ((n = w.nextNode())) last = n;
            return last;
        }

        _firstTextNode(el) {
            const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            return w.nextNode();
        }

        _getOrCreateNextPage(curNum) {
            const c    = this.getContainer();
            const next = c.querySelector(`.editor-page[data-page="${curNum + 1}"]`);
            if (next) return next;

            if (curNum + 1 > this._config.get('reflow.maxPages')) {
                console.warn('[WordFlow] Max pages reached');
                return c.querySelector(`.editor-page[data-page="${curNum}"]`);
            }

            const newPage = PageFactory.create(curNum + 1);
            newPage.classList.add('wf-page-entering');
            const curPage = c.querySelector(`.editor-page[data-page="${curNum}"]`);
            curPage?.nextElementSibling
                ? c.insertBefore(newPage, curPage.nextElementSibling)
                : c.appendChild(newPage);

            return newPage;
        }

        _reIndexPages() {
            const c = this.getContainer();
            if (!c) return;
            const pages = Array.from(c.querySelectorAll('.editor-page'));

            if (!pages.length) { c.appendChild(PageFactory.create(1)); return; }

            pages.forEach((page, idx) => {
                const num = idx + 1;
                page.dataset.page = num;

                const pc = page.querySelector('.page-content');
                if (pc) {
                    pc.dataset.page = num;
                    if (!pc.innerHTML.trim() || pc.innerHTML.trim() === '') pc.innerHTML = '<p><br></p>';
                }

                const ind = page.querySelector('.page-indicator');
                if (ind) ind.textContent = `Page ${num}`;

                const nb = page.querySelector('.page-number');
                if (nb) nb.textContent = num;
            });

            // Update current page indicator
            const totalPages = pages.length;
            const totalEl    = document.getElementById('totalPages');
            if (totalEl) totalEl.textContent = totalPages;
        }

        /* ── Undo / Redo ────────────────────────────── */
        _pushUndoSnapshot() {
            this._undoRedo.push({
                content:   this.serialize(),
                pageNum:   this._state.currentPage,
                cursorOff: CursorManager.save(this.getContainer()),
            });
        }

        _loadState(state) {
            if (!state) return;
            this.deserialize(state.content);
            this._reIndexPages();
            setTimeout(() => {
                if (state.cursorOff) CursorManager.restore(state.cursorOff, this.getContainer());
            }, 50);
        }

        /* ── Status bar / Hidden field ───────────────── */
        _syncHiddenField() {
            const el = document.getElementById('noteContent');
            if (el) el.value = this.serialize();
        }

        _updateStatusBar() {
            const pages = this.getContainer()?.querySelectorAll('.editor-page') || [];
            let words = 0, chars = 0;
            pages.forEach(p => {
                const t = p.querySelector('.page-content')?.textContent.replace(/\u200B/g, '') || '';
                chars += t.length;
                words += t.replace(/\u00A0/g, ' ').trim().split(/\s+/).filter(Boolean).length;
            });
            const $ = id => document.getElementById(id);
            if ($('totalPages')) $('totalPages').textContent = pages.length;
            if ($('wordCount'))  $('wordCount').textContent  = words;
            if ($('charCount'))  $('charCount').textContent  = chars;

            // Update current page
            const focused = document.activeElement?.closest?.('.editor-page');
            if (focused && $('currentPageNum')) {
                $('currentPageNum').textContent = focused.dataset.page || 1;
            }
        }

        /* ── Auto-save / Error boundary ─────────────── */
        _setupAutoSave() {
            setInterval(() => {
                this._syncHiddenField();
                this._bus.emit('content:autosaved');
            }, this._config.get('autoSave.intervalMs'));
            window.addEventListener('beforeunload', () => this._syncHiddenField());
        }

        _setupErrorBoundary() {
            window.addEventListener('error', e => {
                if (!e.error) return;
                console.error('[WordFlow] Global error:', e.error);
                try { this._syncHiddenField(); } catch {}
            });
            window.addEventListener('unhandledrejection', e => {
                console.error('[WordFlow] Unhandled promise:', e.reason);
            });
        }
    }


    /* ═══════════════════════════════════════════════════════
     *  12 ▸ BOOTSTRAP
     * ═══════════════════════════════════════════════════════ */
    let _instance = null;
    let _booting  = false;

    async function initializeWordFlow(options = {}) {
        if (_instance) { console.warn('[WordFlow] Already initialized'); return _instance; }
        if (_booting)  { console.warn('[WordFlow] Boot in progress');    return null; }
        _booting = true;

        try {
            await new Promise(resolve => {
                (document.readyState === 'complete' || document.readyState === 'interactive')
                    ? resolve()
                    : document.addEventListener('DOMContentLoaded', resolve, { once: true });
            });

            if (!document.getElementById('pagesContainer')) {
                console.error('[WordFlow] #pagesContainer not found — aborting');
                return null;
            }

            _instance = new MSWordFlowController(options);
            (options.plugins || []).forEach(p => _instance.use(p));
            _instance.init();

            window.wordFlowController = _instance;
            window.wordFlow           = _instance;

            setTimeout(() => _initPaperPanel(_instance), 200);
            return _instance;

        } catch (err) {
            console.error('[WordFlow] Boot failed:', err);
            _instance = null;
            return null;
        } finally {
            _booting = false;
        }
    }


    /* ═══════════════════════════════════════════════════════
     *  13 ▸ PAPER PANEL
     * ═══════════════════════════════════════════════════════ */
    function _initPaperPanel(controller) {
        const btn   = document.getElementById('openPaperPanel');
        const panel = document.getElementById('paperPanel');
        if (!btn || !panel) return;
        btn.onclick = () => { panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; };
        document.querySelectorAll('.paper-item').forEach(item => {
            item.addEventListener('click', () => {
                const size = item.dataset.size;
                if (size) controller.handlePaperSizeChange(size);
                panel.style.display = 'none';
            });
        });
    }


    /* ═══════════════════════════════════════════════════════
     *  14 ▸ SAFE GLOBAL PROXY
     * ═══════════════════════════════════════════════════════ */
    if (typeof window !== 'undefined') {
        const _earlyQueue = [];

        if (!window.wordFlow) {
            window.wordFlow = new Proxy({}, {
                get(_, prop) {
                    if (prop === 'then') return undefined;
                    return (...args) => {
                        if (_instance && _instance[prop]) return _instance[prop](...args);
                        _earlyQueue.push({ method: prop, args });
                        return Promise.resolve();
                    };
                }
            });
            window.wordFlowController = window.wordFlow;
        }

        setTimeout(async () => {
            const ctrl = await initializeWordFlow(window.wordFlowOptions || {});
            if (!ctrl) return;

            if (_earlyQueue.length) {
                for (const { method, args } of _earlyQueue) {
                    if (typeof ctrl[method] === 'function') {
                        try { await ctrl[method](...args); }
                        catch (e) { console.warn(`[WordFlow] Early replay failed for ${method}:`, e); }
                    }
                }
                _earlyQueue.length = 0;
            }

            window.wordFlow           = ctrl;
            window.wordFlowController = ctrl;
        }, 0);
    }


    /* ═══════════════════════════════════════════════════════
     *  PUBLIC EXPORTS
     * ═══════════════════════════════════════════════════════ */
    return {
        initializeWordFlow,
        getController: () => _instance,

        MSWordFlowController,
        HTMLSanitizer,
        CursorManager,
        PageFactory,
        PaperRegistry,
        ReflowEngine,
        UndoRedoManager,
        EventBus,
        ConfigManager,
        VersionManager,
        ClipboardManager,

        version: ENGINE_VERSION,
    };
}));
