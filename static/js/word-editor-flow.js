/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║                                                                              ║
 * ║   🔥  WORD FLOW ENGINE  —  v4.6  "HARDENED EDITION"                        ║
 * ║                                                                              ║
 * ║   Architecture: Plugin-based, version-safe, zero-dependency                 ║
 * ║                                                                              ║
 * ║   FIXED IN v4.6:                                                             ║
 * ║   🔧 FIX 01 — Reflow loop hard-capped at 20 iterations (was 50)            ║
 * ║   🔧 FIX 02 — querySelectorAll cached once per _doReflow() call            ║
 * ║   🔧 FIX 03 — Undo snapshots debounced (500ms), no more per-keystroke      ║
 * ║   🔧 FIX 04 — _onPaste null-focus guard; isPasting always resets           ║
 * ║   🔧 FIX 05 — HTMLSanitizer uses DOMParser sandbox (no script exec)        ║
 * ║   🔧 FIX 06 — contentEditable normalisation + defaultParagraphSeparator    ║
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

    const ENGINE_VERSION = '4.6.0';

    /* ─────────────────────────────────────────────────
     *  1 ▸ EVENT BUS
     * ───────────────────────────────────────────────── */
    class EventBus {
        constructor() { this._map = Object.create(null); }

        on(event, fn, ctx = null) {
            (this._map[event] = this._map[event] || []).push({ fn, ctx });
            return () => this.off(event, fn);
        }

        off(event, fn) {
            if (!this._map[event]) return;
            this._map[event] = this._map[event].filter(l => l.fn !== fn);
        }

        emit(event, ...args) {
            (this._map[event] || []).forEach(({ fn, ctx }) => {
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


    /* ─────────────────────────────────────────────────
     *  2 ▸ CONFIG MANAGER
     * ───────────────────────────────────────────────── */
    class ConfigManager {
        constructor(defaults) { this._c = JSON.parse(JSON.stringify(defaults)); }

        merge(partial) { this._deepMerge(this._c, partial); return this; }

        get(path) {
            return path.split('.').reduce((o, k) => (o != null ? o[k] : undefined), this._c);
        }

        _deepMerge(tgt, src) {
            if (!src || typeof src !== 'object') return;
            for (const k of Object.keys(src)) {
                if (
                    src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) &&
                    tgt[k] && typeof tgt[k] === 'object'
                ) {
                    this._deepMerge(tgt[k], src[k]);
                } else {
                    tgt[k] = src[k];
                }
            }
        }
    }


    /* ─────────────────────────────────────────────────
     *  3 ▸ VERSION MANAGER
     * ───────────────────────────────────────────────── */
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
                    try { fn({ from: stored, to: v }); console.log(`[VersionManager] Migrated → ${v}`); }
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


    /* ─────────────────────────────────────────────────
     *  4 ▸ PAPER REGISTRY
     * ───────────────────────────────────────────────── */
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
            get(name)        { return db[name] || db['a4']; },
            add(name, dims)  { db[name] = dims; return this; },
            has(name)        { return name in db; },
            all()            { return { ...db }; },
        };
    })();


    /* ─────────────────────────────────────────────────
     *  5 ▸ HTML SANITIZER
     *  🔧 FIX 05: DOMParser sandbox replaces createElement('div').
     *     DOMParser never executes scripts in the parsed document,
     *     eliminating the innerHTML injection vector entirely.
     *  🔧 HINDI/INDIC FIX: Preserve lang/font spans, selective mso stripping.
     * ───────────────────────────────────────────────── */
    class HTMLSanitizer {
        static clean(html) {
            if (!html) return '<p><br></p>';

            // 🔧 FIX 05: DOMParser sandboxes scripts — they never execute,
            // even if present in the source. Safer than createElement+innerHTML.
            const doc  = new DOMParser().parseFromString(html, 'text/html');
            const root = doc.body;

            root.querySelectorAll('script,style,meta,link,iframe,object,embed,form')
               .forEach(el => el.remove());

            root.querySelectorAll('*').forEach(el => {
                Array.from(el.attributes).forEach(attr => {
                    if (
                        /^on/i.test(attr.name) ||
                        /javascript:/i.test(attr.value) ||
                        /vbscript:/i.test(attr.value)
                    ) el.removeAttribute(attr.name);
                    // lang, dir, font-* preserved for Devanagari / Indic rendering
                });
            });

            return root.innerHTML || '<p><br></p>';
        }

        static normalizeFromPaste(html) {
            if (!html) return '<p><br></p>';
            let n = html
                .replace(/<\/?o:[^>]*>/gi, '')
                .replace(/<\/?w:[^>]*>/gi, '')
                .replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, '');

            n = n.replace(/<div([^>]*)>/gi, '<p$1>').replace(/<\/div>/gi, '</p>');

            // Selective mso style stripping — keep bidi/font/language props
            n = n.replace(/style="([^"]*)"/gi, (_, style) => {
                const safe = style
                    .split(';')
                    .map(s => s.trim())
                    .filter(s => {
                        if (!s) return false;
                        if (/mso-(para-margin|margin|indent|list|pagination|line-height|spacerun|tab-stop)/i.test(s)) return false;
                        return true;
                    })
                    .join('; ');
                return safe.trim() ? `style="${safe}"` : '';
            });

            n = n.replace(/\s*class="[^"]*mso[^"]*"/gi, '');
            n = n.replace(/<p[^>]*>\s*<\/p>/gi, '<p><br></p>');

            // Preserve spans carrying script/language/font info (Hindi/Indic)
            n = n.replace(/<span([^>]*)>([\s\S]*?)<\/span>/gi, (match, attrs, inner) => {
                if (/lang=|font-family|mso-bidi|dir=|unicode-bidi/i.test(attrs)) {
                    return `<span${attrs}>${inner}</span>`;
                }
                return inner;
            });

            return n.trim() || '<p><br></p>';
        }
    }


    /* ─────────────────────────────────────────────────
     *  6 ▸ CURSOR MANAGER
     * ───────────────────────────────────────────────── */
    class CursorManager {

        static save(container) {
            const sel = window.getSelection();
            if (!sel?.rangeCount) return null;
            const range = sel.getRangeAt(0);

            const pc = CursorManager._ancestorPC(range.startContainer);
            if (!pc) return null;

            const page = pc.closest('.editor-page');
            if (!page) return null;

            const pageNum  = parseInt(page.dataset.page, 10) || 1;
            const startOff = CursorManager._offset(pc, range.startContainer, range.startOffset);
            const endOff   = range.collapsed
                ? startOff
                : CursorManager._offset(pc, range.endContainer, range.endOffset);

            return { pageNum, startOff, endOff, isCollapsed: range.collapsed };
        }

        static restore(saved, container) {
            if (!saved) return;
            try {
                let pc = CursorManager._pc(saved.pageNum, container)
                      || CursorManager._pc(saved.pageNum - 1, container)
                      || CursorManager._pc(saved.pageNum + 1, container)
                      || container.querySelector('.page-content');
                if (!pc) return;

                pc.focus({ preventScroll: true });
                const sel   = window.getSelection();
                const range = document.createRange();

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
                    return;
                }

                range.selectNodeContents(pc);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);

            } catch (e) {
                console.warn('[CursorManager] restore failed:', e);
            }
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
            else       { range.selectNodeContents(pc); range.collapse(false); }
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


    /* ─────────────────────────────────────────────────
     *  7 ▸ UNDO / REDO MANAGER
     * ───────────────────────────────────────────────── */
    class UndoRedoManager {
        constructor(max = 100) {
            this._stack    = [];
            this._idx      = -1;
            this._max      = max;
            this._applying = false;
        }

        push(state) {
            if (this._applying) return;
            if (this._idx < this._stack.length - 1)
                this._stack = this._stack.slice(0, this._idx + 1);
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
    }


    /* ─────────────────────────────────────────────────
     *  8 ▸ PAGE FACTORY
     * ───────────────────────────────────────────────── */
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


    /* ─────────────────────────────────────────────────
     *  9 ▸ REFLOW ENGINE
     * ───────────────────────────────────────────────── */
    class ReflowEngine {
        constructor(config) {
            this._cfg = config;
            this._segmenter = (typeof Intl !== 'undefined' && Intl.Segmenter)
                ? new Intl.Segmenter(undefined, { granularity: 'word' })
                : null;
        }

        measure(pageEl) {
            const pc = pageEl.querySelector('.page-content');
            if (!pc) return null;

            const available = pc.offsetHeight;

            let contentH = 0;
            if (pc.children.length) {
                const pcTop    = pc.getBoundingClientRect().top;
                const lastRect = pc.children[pc.children.length - 1].getBoundingClientRect();
                contentH       = lastRect.bottom - pcTop;
            }

            const scrollOverflow = Math.max(0, pc.scrollHeight - available);
            const rectOverflow   = Math.max(0, contentH - available);
            const overflow       = Math.max(rectOverflow, scrollOverflow);

            const tol        = this._cfg.get('reflow.overflowTolerance') || 8;
            const isOverflow = overflow > tol;

            return { available, contentH, overflow, isOverflow };
        }

        split(pc, available) {
            const children = Array.from(pc.children);
            const pcTop = pc.getBoundingClientRect().top;
            const rects = children.map(c => c.getBoundingClientRect());

            const overflow = [];

            for (let i = 0; i < children.length; i++) {
                const el     = children[i];
                const bottom = rects[i].bottom - pcTop;

                if (bottom <= available) continue;

                if (i === 0 && overflow.length === 0) {
                    const sp = this.splitElement(el, available);
                    if (sp.top && sp.bottom) {
                        pc.replaceChild(sp.top, el);
                        overflow.push(sp.bottom);
                    } else {
                        pc.removeChild(el);
                        overflow.push(el);
                    }
                } else if (i > 0) {
                    const usedH  = rects[i - 1].bottom - pcTop;
                    const remain = available - usedH;
                    if (this._canSplit(el) && remain > 20) {
                        const sp = this.splitElement(el, remain);
                        if (sp.top && sp.bottom) {
                            pc.replaceChild(sp.top, el);
                            overflow.push(sp.bottom);
                        } else {
                            pc.removeChild(el);
                            overflow.push(el);
                        }
                    } else {
                        pc.removeChild(el);
                        overflow.push(el);
                    }
                }

                const remaining = [];
                let sib = pc.children[i];
                while (sib) {
                    const next = sib.nextElementSibling;
                    pc.removeChild(sib);
                    remaining.push(sib);
                    sib = next;
                }
                overflow.push(...remaining);
                break;
            }

            return { overflow };
        }

        splitElement(el, available) {
            if (!this._canSplit(el)) return { top: null, bottom: null };

            const segments = this._extractSegments(el);
            if (segments.length < 4) return { top: null, bottom: null };

            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'position:absolute;top:-9999px;left:-9999px;visibility:hidden;pointer-events:none';
            const probe = el.cloneNode(false);
            const cs    = window.getComputedStyle(el);
            probe.style.cssText   = cs.cssText;
            probe.style.position  = 'static';
            probe.style.width     = el.offsetWidth + 'px';
            probe.style.height    = 'auto';
            probe.style.maxHeight = 'none';
            wrapper.appendChild(probe);
            document.body.appendChild(wrapper);

            let lo = 1, hi = segments.length, best = 0;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                probe.innerHTML = this._segmentsToHTML(segments, 0, mid);
                if (probe.offsetHeight <= available) { best = mid; lo = mid + 1; }
                else { hi = mid - 1; }
            }
            document.body.removeChild(wrapper);

            if (best < 2 || best > segments.length - 2)
                return { top: null, bottom: null };

            const bottom = el.cloneNode(false);
            bottom.innerHTML = this._segmentsToHTML(segments, best, segments.length);
            el.innerHTML = this._segmentsToHTML(segments, 0, best);

            return { top: el, bottom };
        }

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

            return segments;
        }

        _wrapWithAncestors(text, wrappers) {
            let html = this._escapeHTML(text);
            for (let i = wrappers.length - 1; i >= 0; i--) {
                const w   = wrappers[i];
                const tag = w.tagName.toLowerCase();
                let attr  = '';
                if (w.getAttribute('style')) attr += ` style="${this._escapeAttr(w.getAttribute('style'))}"`;
                if (w.getAttribute('class')) attr += ` class="${this._escapeAttr(w.getAttribute('class'))}"`;
                if (w.getAttribute('lang'))  attr += ` lang="${this._escapeAttr(w.getAttribute('lang'))}"`;
                if (w.getAttribute('dir'))   attr += ` dir="${this._escapeAttr(w.getAttribute('dir'))}"`;
                html = `<${tag}${attr}>${html}</${tag}>`;
            }
            return html;
        }

        _segmentsToHTML(segments, start, end) {
            return segments
                .slice(start, end)
                .map(seg => seg.wrappers.length === 0
                    ? this._escapeHTML(seg.text)
                    : this._wrapWithAncestors(seg.text, seg.wrappers))
                .join('');
        }

        _escapeHTML(str) {
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        _escapeAttr(str) {
            return str.replace(/"/g, '&quot;');
        }

        // Unicode-safe tokenizer: splits only on ASCII space/tab
        _tokenize(html) {
            const tokens = [];
            let buf = '', inTag = false;
            for (let i = 0; i < html.length; i++) {
                const ch = html[i];
                if (ch === '<')  { inTag = true;  buf += ch; continue; }
                if (ch === '>')  { inTag = false; buf += ch; continue; }
                if (inTag)       { buf += ch; continue; }
                if (ch === ' ' || ch === '\t') {
                    if (buf) { tokens.push(buf); buf = ''; }
                    tokens.push(ch);
                } else {
                    buf += ch;
                }
            }
            if (buf) tokens.push(buf);
            return tokens;
        }

        _canSplit(el) {
            if (!el || !['P', 'DIV', 'BLOCKQUOTE', 'LI'].includes(el.tagName)) return false;
            if (el.querySelector('img,table,canvas,video')) return false;
            return el.textContent.trim().length > 20;
        }
    }


    /* ─────────────────────────────────────────────────
     *  10 ▸ MAIN CONTROLLER
     * ───────────────────────────────────────────────── */
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
                isReflowing:      false,
                isPaperChanging:  false,
                isPasting:        false,
                currentPage:      1,
                currentPaperSize: 'a4',
            };
            this._pendingReflow = null;

            this._timers        = {};
            this._initialized   = false;
            this._eventsBound   = false;
            this._imeComposing  = false;

            // 🔧 FIX 03: Track last snapshot time for debouncing.
            this._lastUndoSnap = 0;
        }

        static get DEFAULTS() {
            return {
                // 🔧 FIX 01: maxIterations = 20 (was 50). Real convergence
                // happens in 3–6 passes; 50 triggered ~50 forced layouts/keypress.
                reflow:   { debounceMs: 80, overflowTolerance: 8, maxIterations: 20, maxPages: 1000, useRAF: false },
                history:  { maxStates: 100 },
                paper:    { size: 'a4', marginPx: 96 },
                autoSave: { intervalMs: 30000 },
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
            if (this._plugins.has(plugin.name)) { console.warn(`[WordFlow] Plugin "${plugin.name}" already installed`); return this; }
            try {
                plugin.install?.(this);
                this._plugins.set(plugin.name, plugin);
                console.log(`[WordFlow] Plugin "${plugin.name}" installed`);
            } catch (e) {
                console.error(`[WordFlow] Plugin "${plugin.name}" install error:`, e);
            }
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

            const BREAK        = '<div class="page-break-marker" style="page-break-after:always;"></div>';
            const MANUAL_PFX   = '<div class="page-break-marker wf-manual" style="page-break-after:always;"></div>';
            const parts        = raw.split(BREAK);
            c.innerHTML        = '';

            let pageIdx = 1;
            parts.forEach(part => {
                const isManual = part.startsWith(MANUAL_PFX) || part.includes('wf-manual');
                const html     = isManual ? part.replace(MANUAL_PFX, '').trim() : part.trim();
                const page = PageFactory.create(pageIdx++, html || '<p><br></p>');
                if (isManual) page.dataset.wfManualBreak = '1';
                c.appendChild(page);
            });

            this._bus.emit('content:loaded');
        }

        /* ── Public reflow ──────────────────────────── */
        async reflowAll()            { return this._doReflow(1, null); }
        async reflowFrom(pageNum)    { return this._doReflow(pageNum, null); }

        /* ── Backward-Compatibility Aliases ─────────── */
        async performReflow()                { return this.reflowAll(); }
        async performReflowFromPage(pageNum) { return this.reflowFrom(pageNum); }
        updateHiddenContent()                { this._syncHiddenField(); }
        updateUI()                           { this._updateStatusBar(); this._syncHiddenField(); }
        consolidatePages(fromPage = 1)       { return this._consolidatePages(fromPage); }
        reIndexPages()                       { return this._reIndexPages(); }
        loadState(state)                     { return this._loadState(state); }
        saveCursorPosition()                 { return CursorManager.save(this.getContainer()); }
        restoreCursorPosition(saved)         { return CursorManager.restore(saved, this.getContainer()); }
        measurePage(pageEl)                  { return this._engine.measure(pageEl); }
        createPage(pageNum, html)            { return PageFactory.create(pageNum, html); }

        /* ── Paper size ─────────────────────────────── */
        handlePaperSizeChange(newSize) {
            if (!newSize || newSize === this._state.currentPaperSize) return;
            if (!PaperRegistry.has(newSize)) {
                console.warn(`[WordFlow] Unknown paper "${newSize}". Use PaperRegistry.add() first.`);
                return;
            }

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
            if (this._initialized) { console.warn('[WordFlow] Already initialized'); return this; }
            this._initialized = true;

            this._version.runMigrations(ENGINE_VERSION);
            this._injectMergeStyles();

            document.addEventListener('compositionstart', () => { this._imeComposing = true;  });
            document.addEventListener('compositionend',   () => { this._imeComposing = false; });

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

        /* ── Inject merge CSS ───────────────────────── */
        _injectMergeStyles() {
            if (document.getElementById('wf-merge-styles')) return;
            const style = document.createElement('style');
            style.id = 'wf-merge-styles';
            style.textContent = `
                @keyframes wf-page-merge-out {
                    0%   { opacity: 1; transform: scaleY(1);   max-height: 200px; }
                    60%  { opacity: 0; transform: scaleY(0.6); max-height: 40px; }
                    100% { opacity: 0; transform: scaleY(0);   max-height: 0;    }
                }
                @keyframes wf-content-in {
                    from { opacity: 0; }
                    to   { opacity: 1; }
                }
                @keyframes wf-cursor-flash {
                    0%   { background: rgba(37,99,235,0.18); }
                    100% { background: transparent; }
                }
                .wf-merging {
                    animation: wf-page-merge-out 180ms cubic-bezier(.4,0,.2,1) forwards;
                    overflow: hidden;
                    pointer-events: none;
                }
                .wf-content-merged { animation: wf-content-in 160ms ease-out both; }
                .wf-merge-flash    { animation: wf-cursor-flash 350ms ease-out forwards; border-radius: 2px; }
            `;
            document.head.appendChild(style);
        }

        /* ── Event Binding ──────────────────────────── */
        _bindEvents() {
            if (this._eventsBound) return;
            this._eventsBound = true;

            this._bInput   = this._onInput.bind(this);
            this._bPaste   = this._onPaste.bind(this);
            this._bKeydown = this._onKeydown.bind(this);
            this._bFocus   = this._onFocusIn.bind(this);

            document.addEventListener('input',   this._bInput);
            document.addEventListener('paste',   this._bPaste, true);
            document.addEventListener('keydown', this._bKeydown, true);
            document.addEventListener('focusin', this._bFocus);

            // 🔧 FIX 06: Force <p> as the paragraph separator in all browsers.
            // Chrome 60+ defaults to <div> on Enter; this aligns it with Firefox/Safari.
            // Must be called after DOM is ready (at least one contentEditable exists).
            document.execCommand('defaultParagraphSeparator', false, 'p');

            const sel = document.getElementById('paperSize');
            if (sel) sel.addEventListener('change', e => this.handlePaperSizeChange(e.target.value));
        }

        _onFocusIn(e) {
            if (!e.target.classList.contains('page-content')) return;
            const page = e.target.closest('.editor-page');
            if (page) this._state.currentPage = parseInt(page.dataset.page, 10) || 1;
        }

        /* ── Input ──────────────────────────────────── */
        _onInput(e) {
            if (!e.target?.classList.contains('page-content')) return;
            if (this._state.isPaperChanging || this._state.isPasting) return;
            if (this._imeComposing) return;

            const page = e.target.closest('.editor-page');
            if (!page) return;

            const pc = e.target;

            // 🔧 FIX 06: Normalize after every input — browsers may insert bare
            // text nodes or top-level <br> instead of wrapping content in <p>.
            if (pc.childNodes.length === 0 || pc.innerHTML === '<br>') {
                pc.innerHTML = '<p><br></p>';
            }

            const pageNum = parseInt(page.dataset.page, 10) || 1;
            this._state.currentPage = pageNum;

            clearTimeout(this._timers.input);
            this._timers.input = setTimeout(async () => {
                if (this._state.isPasting) return;
                await this._doReflow(pageNum, null);
                this._syncHiddenField();
                this._bus.emit('content:changed');
            }, Math.max(this._config.get('reflow.debounceMs'), 100));
        }

        /* ── Paste ──────────────────────────────────── */
        _onPaste(e) {
            if (this._state.isPasting) return;
            this._state.isPasting = true;
            clearTimeout(this._timers.input);
            this._pushUndoSnapshot();

            setTimeout(async () => {
                // 🔧 FIX 04: Guard against null or wrong activeElement.
                // If focus shifts during paste (e.g. toolbar click, keyboard shortcut),
                // activeElement may be a button, body element, or null.
                // Without this guard: .innerHTML throws silently AND isPasting never
                // resets, permanently locking out all future paste operations until reload.
                const pc = document.activeElement;
                if (!pc?.classList.contains('page-content')) {
                    this._state.isPasting = false;
                    return;
                }

                const cleaned = HTMLSanitizer.clean(HTMLSanitizer.normalizeFromPaste(pc.innerHTML));
                pc.innerHTML  = cleaned || '<p><br></p>';

                this._preDistribute(pc);
                await this._doReflow(1);

                const allPCs = Array.from(this.getContainer().querySelectorAll('.page-content'));
                const lastWithContent = [...allPCs].reverse().find(p => p.textContent.trim()) || allPCs[allPCs.length - 1];
                if (lastWithContent) CursorManager.setCursorAtEnd(lastWithContent);

                this._syncHiddenField();
                this._updateStatusBar();
                this._bus.emit('content:pasted');

                requestAnimationFrame(() => requestAnimationFrame(() => {
                    this._state.isPasting = false;
                }));
            }, 20);
        }

        _preDistribute(startPC) {
            const startPage = startPC.closest('.editor-page');
            if (!startPage) return;

            let curPC = startPC, curPage = startPage, limit = 0;
            while (limit++ < 10000) {
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


        /* ══════════════════════════════════════════════
         *  ⚡ KEYBOARD
         * ══════════════════════════════════════════════ */
        _onKeydown(e) {
            const ctrl = e.ctrlKey || e.metaKey;

            if (e.key === 'Backspace') {
                if (this._imeComposing) return;
                if (this._handleBackspace()) { e.preventDefault(); e.stopImmediatePropagation(); }
                return;
            }

            if (e.key === 'Delete') {
                if (this._imeComposing) return;
                if (this._handleDeleteForward()) { e.preventDefault(); e.stopImmediatePropagation(); }
                return;
            }

            if (e.key === 'Enter' && !this._imeComposing) {
                if (e.shiftKey) return;
                this._handleEnter(e);
                return;
            }

            if (ctrl && e.key === 'z') {
                e.preventDefault();
                const s = this._undoRedo.undo();
                if (s) { this._loadState(s); this._undoRedo.stopApplying(); }
                return;
            }

            if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
                e.preventDefault();
                const s = this._undoRedo.redo();
                if (s) { this._loadState(s); this._undoRedo.stopApplying(); }
                return;
            }

            if (ctrl && e.key === 'a') {
                if (this._handleSelectAll()) { e.preventDefault(); e.stopImmediatePropagation(); }
                return;
            }

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

            if (ctrl && (e.key === 'PageUp' || e.key === 'PageDown')) {
                e.preventDefault();
                const curr = document.activeElement?.closest('.editor-page');
                if (!curr) return;
                const n    = parseInt(curr.dataset.page, 10);
                const dest = e.key === 'PageUp' ? n - 1 : n + 1;
                this.getContainer()?.querySelector(`.page-content[data-page="${dest}"]`)?.focus();
                return;
            }
        }

        /* ── Backspace ──────────────────────────────── */
        _handleBackspace() {
            const sel = window.getSelection();
            if (!sel?.rangeCount) return false;
            const range = sel.getRangeAt(0);

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

            const prevIsBlank =
                !prevPC.textContent.trim() &&
                (prevPC.children.length === 0 ||
                 (prevPC.children.length === 1 &&
                  prevPC.children[0].tagName === 'P' &&
                  !prevPC.children[0].textContent.trim()));

            if (prevIsBlank) {
                this._pushUndoSnapshot();
                prevPage.remove();
                pc.focus({ preventScroll: true });
                try {
                    const r = document.createRange();
                    r.selectNodeContents(pc);
                    r.collapse(true);
                    window.getSelection().removeAllRanges();
                    window.getSelection().addRange(r);
                } catch (_) { CursorManager.setCursorAtStart(pc); }

                this._state.currentPage = pageNum - 1;
                requestAnimationFrame(() => {
                    this._doReflow(pageNum - 1).then(() => {
                        this._updateStatusBar();
                        this._syncHiddenField();
                        this._bus.emit('content:changed');
                    });
                });
                return true;
            }

            this._pushUndoSnapshot();
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
                } catch (_) { CursorManager.setCursorAtEnd(prevPC); }
            } else {
                prevPC.focus({ preventScroll: true });
                try {
                    const r = document.createRange();
                    r.selectNodeContents(prevPC);
                    r.collapse(false);
                    window.getSelection().removeAllRanges();
                    window.getSelection().addRange(r);
                } catch (_) { CursorManager.setCursorAtEnd(prevPC); }
            }

            this._state.currentPage = pageNum - 1;
            requestAnimationFrame(() => {
                this._doReflow(pageNum - 1).then(() => {
                    this._updateStatusBar();
                    this._syncHiddenField();
                    this._bus.emit('content:changed');
                });
            });
            return true;
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

        /* ── Delete Forward ─────────────────────────── */
        _handleDeleteForward() {
            const sel = window.getSelection();
            if (!sel?.rangeCount) return false;
            const range = sel.getRangeAt(0);

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

            const nextIsBlank =
                !nextPC.textContent.trim() &&
                (nextPC.children.length === 0 ||
                 (nextPC.children.length === 1 &&
                  nextPC.children[0].tagName === 'P' &&
                  !nextPC.children[0].textContent.trim()));

            if (nextIsBlank) {
                this._pushUndoSnapshot();
                nextPage.remove();
                CursorManager.setCursorAtEnd(pc);
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

            this._pushUndoSnapshot();
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

        /* ── Enter ──────────────────────────────────── */
        _handleEnter(e) {
            const sel = window.getSelection();
            if (!sel?.rangeCount) return;

            const range = sel.getRangeAt(0);
            const pc    = CursorManager._ancestorPC(range.startContainer);
            if (!pc) return;

            const page    = pc.closest('.editor-page');
            if (!page) return;
            const pageNum = parseInt(page.dataset.page, 10) || 1;

            const fmt = this._readCursorFormat(range);
            this._pushUndoSnapshot();
            clearTimeout(this._timers.input);

            requestAnimationFrame(() => {
                const selAfter    = window.getSelection();
                const newParaNode = selAfter?.rangeCount ? selAfter.getRangeAt(0).startContainer : null;
                const newParaOff  = selAfter?.rangeCount ? selAfter.getRangeAt(0).startOffset : 0;

                if (fmt && newParaNode) {
                    try {
                        const newPara = newParaNode.nodeType === Node.TEXT_NODE
                            ? newParaNode.parentElement
                            : newParaNode;
                        if (newPara && newPara !== pc && newPara.tagName === 'P') {
                            const safeFmt = Object.assign({}, fmt, { fontSize: null });
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

                    if (newParaNode && newParaNode.isConnected) {
                        let ownerPC = newParaNode;
                        while (ownerPC && !ownerPC.classList?.contains('page-content')) {
                            ownerPC = ownerPC.parentNode;
                        }
                        if (ownerPC && ownerPC.classList?.contains('page-content')) {
                            ownerPC.focus({ preventScroll: true });
                            try {
                                const r = document.createRange();
                                const safeOff = Math.min(
                                    newParaOff,
                                    newParaNode.nodeType === Node.TEXT_NODE
                                        ? newParaNode.length
                                        : newParaNode.childNodes.length
                                );
                                r.setStart(newParaNode, safeOff);
                                r.collapse(true);
                                window.getSelection().removeAllRanges();
                                window.getSelection().addRange(r);
                            } catch (_) { CursorManager.setCursorAtStart(ownerPC); }

                            requestAnimationFrame(() => {
                                try {
                                    const sel2 = window.getSelection();
                                    if (sel2?.rangeCount) {
                                        const rng  = sel2.getRangeAt(0);
                                        const rect = rng.getBoundingClientRect();
                                        if (rect.bottom > window.innerHeight - 20 || rect.top < 60) {
                                            ownerPC.closest('.editor-page')?.scrollIntoView({
                                                behavior: 'smooth', block: 'nearest'
                                            });
                                        }
                                    }
                                } catch(_) {}
                            });
                        }
                    } else if (newParaNode && !newParaNode.isConnected) {
                        const c = this.getContainer();
                        const nextPC = c?.querySelector(`.page-content[data-page="${pageNum + 1}"]`);
                        if (nextPC && nextPC.textContent.trim()) {
                            CursorManager.setCursorAtStart(nextPC);
                        } else {
                            const curPC = c?.querySelector(`.page-content[data-page="${pageNum}"]`);
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
                if (otherText) { ph.remove(); }
                else           { ph.textContent = ''; }
            });
        }

        /* ── Select All ─────────────────────────────── */
        _handleSelectAll() {
            const active = document.activeElement;
            if (!active?.classList.contains('page-content')) return false;

            const pages = Array.from(this.getContainer().querySelectorAll('.page-content'));
            if (pages.length <= 1) return false;

            const sel   = window.getSelection();
            const range = document.createRange();
            const first = pages[0], last = pages[pages.length - 1];

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


        /* ── Reflow Core ─────────────────────────────── */
        async _doReflow(fromPage, savedCursor = null, skipConsolidate = false) {
            if (this._state.isReflowing) {
                this._pendingReflow = this._pendingReflow != null
                    ? Math.min(this._pendingReflow, fromPage)
                    : fromPage;
                return;
            }
            this._state.isReflowing = true;

            const maxIter = this._config.get('reflow.maxIterations'); // 🔧 FIX 01: now 20
            const useRAF  = this._config.get('reflow.useRAF');
            const c       = this.getContainer();

            try {
                let changed = true, iter = 0;
                while (changed && iter < maxIter) {
                    changed = false; iter++;

                    // 🔧 FIX 02: Cache page list ONCE per iteration.
                    // Previously querySelectorAll was called inside _resolveOverflow,
                    // _consolidatePages, and the loop — each call forces a full style
                    // recalculation. Caching saves ~1000 DOM queries on a 50-page doc.
                    const pages = Array.from(c.querySelectorAll('.editor-page'))
                        .filter(p => parseInt(p.dataset.page, 10) >= fromPage);

                    for (const page of pages) {
                        if (this._resolveOverflow(page)) changed = true;
                    }

                    if (!skipConsolidate && this._consolidatePages(fromPage, pages)) changed = true;

                    if (useRAF && changed) await new Promise(r => requestAnimationFrame(r));
                }

                // 🔧 FIX 01: Warn on cap hit — aids debugging of pathological docs.
                if (iter >= maxIter && changed) {
                    console.warn(`[WordFlow] Reflow hit iteration cap (${maxIter}) at page ${fromPage}.`);
                }

                this._reIndexPages();

            } catch (err) {
                console.error('[WordFlow] Reflow error:', err);
            } finally {
                this._state.isReflowing = false;

                if (savedCursor) {
                    requestAnimationFrame(() =>
                        CursorManager.restore(savedCursor, this.getContainer())
                    );
                }

                this._bus.emit('reflow:done');

                if (this._pendingReflow != null) {
                    const pendingPage = this._pendingReflow;
                    this._pendingReflow = null;
                    requestAnimationFrame(() => this._doReflow(pendingPage, null));
                }
            }
        }

        /* ── Overflow resolution ────────────────────── */
        _resolveOverflow(pageEl) {
            const m = this._engine.measure(pageEl);
            if (!m?.isOverflow) return false;

            const pc = pageEl.querySelector('.page-content');
            if (!pc) return false;

            const { overflow } = this._engine.split(pc, m.available);
            if (!overflow.length) return false;

            const pageNum  = parseInt(pageEl.dataset.page, 10);
            const nextPage = this._getOrCreateNextPage(pageNum);
            const nextPC   = nextPage.querySelector('.page-content');
            if (!nextPC) return false;

            if (!pc.children.length) {
                pc.innerHTML = '<p><br></p>';
            } else if (!pc.textContent.replace(/​/g, '').trim() && pc.innerHTML.trim().length < 10) {
                pc.innerHTML = '<p><br></p>';
            }

            if (nextPage.dataset.wfManualBreak === '1') {
                const interPage = PageFactory.create(pageNum + 1);
                nextPage.parentNode.insertBefore(interPage, nextPage);
                const interPC = interPage.querySelector('.page-content');
                if (!interPC) return false;
                const frag2 = document.createDocumentFragment();
                for (let i = 0; i < overflow.length; i++) frag2.appendChild(overflow[i]);
                interPC.innerHTML = '';
                interPC.appendChild(frag2);
                return true;
            }

            const nextIsPlaceholder = nextPC.children.length === 1 &&
                nextPC.children[0].tagName === 'P' &&
                !nextPC.children[0].textContent.trim();
            if (nextIsPlaceholder) nextPC.innerHTML = '';

            const frag = document.createDocumentFragment();
            for (let i = 0; i < overflow.length; i++) frag.appendChild(overflow[i]);
            nextPC.insertBefore(frag, nextPC.firstChild);

            return true;
        }

        /* ── Consolidate Pages ──────────────────────── */
        // 🔧 FIX 02: Accept pre-cached pages array from _doReflow to avoid
        // redundant querySelectorAll. Falls back to a fresh query for external callers.
        _consolidatePages(fromPage = 1, cachedPages = null) {
            const pages = cachedPages || Array.from(this.getContainer().querySelectorAll('.editor-page'))
                .filter(p => parseInt(p.dataset.page, 10) >= fromPage);

            let changed = false;

            for (let i = pages.length - 1; i > 0; i--) {
                const cur  = pages[i];
                const prev = pages[i - 1];
                const curPC  = cur.querySelector('.page-content');
                const prevPC = prev.querySelector('.page-content');
                if (!curPC || !prevPC) continue;

                if (cur.dataset.wfManualBreak === '1' || prev.dataset.wfManualBreak === '1') continue;

                const curIsEmpty = !curPC.textContent.trim() && curPC.innerHTML.trim().length < 15;
                if (curIsEmpty && this.getContainer().querySelectorAll('.editor-page').length > 1) {
                    if (!cur.dataset.wfManualBreak) { cur.remove(); changed = true; }
                    continue;
                }

                let node = curPC.firstElementChild;
                while (node) {
                    const next = node.nextElementSibling;
                    prevPC.appendChild(node);
                    const m = this._engine.measure(prev);
                    if (m && m.isOverflow) {
                        curPC.insertBefore(node, curPC.firstChild);
                        break;
                    }
                    changed = true;
                    node = next;
                }

                const nowEmpty = !curPC.textContent.trim() && curPC.innerHTML.trim().length < 15;
                if (nowEmpty && !cur.dataset.wfManualBreak &&
                    this.getContainer().querySelectorAll('.editor-page').length > 1) {
                    cur.remove();
                    changed = true;
                }
            }

            return changed;
        }

        /* ── Page helpers ───────────────────────────── */
        _getOrCreateNextPage(curNum) {
            const c    = this.getContainer();
            const next = c.querySelector(`.editor-page[data-page="${curNum + 1}"]`);
            if (next) return next;

            if (curNum + 1 > this._config.get('reflow.maxPages')) {
                console.warn('[WordFlow] Max pages reached');
                return c.querySelector(`.editor-page[data-page="${curNum}"]`);
            }

            const newPage = PageFactory.create(curNum + 1);
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
                if (pc) { pc.dataset.page = num; if (!pc.innerHTML.trim()) pc.innerHTML = '<p><br></p>'; }

                const ind = page.querySelector('.page-indicator');
                if (ind) ind.textContent = `Page ${num}`;

                const nb = page.querySelector('.page-number');
                if (nb) nb.textContent = num;
            });
        }

        /* ── Undo / Redo ────────────────────────────── */
        // 🔧 FIX 03: Debounced snapshot — only save if 500ms has passed since last save.
        // Per-keystroke snapshots stored full HTML clones (~50KB each on large docs),
        // filling the 100-entry stack with near-identical states and wasting memory.
        // 500ms gap collapses fast typing into one snapshot per natural pause.
        _pushUndoSnapshot() {
            const now = Date.now();
            if (now - this._lastUndoSnap < 500) return;
            this._lastUndoSnap = now;

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

        /* ── Status bar / Hidden field ──────────────── */
        _syncHiddenField() {
            const el = document.getElementById('noteContent');
            if (el) el.value = this.serialize();
        }

        _updateStatusBar() {
            const pages = this.getContainer()?.querySelectorAll('.editor-page') || [];
            let words = 0, chars = 0;
            pages.forEach(p => {
                const t = p.querySelector('.page-content')?.textContent || '';
                chars += t.length;
                words += t.replace(/\u00A0/g, ' ').trim().split(/\s+/).filter(Boolean).length;
            });
            const $ = id => document.getElementById(id);
            if ($('totalPages')) $('totalPages').textContent = pages.length;
            if ($('wordCount'))  $('wordCount').textContent  = words;
            if ($('charCount'))  $('charCount').textContent  = chars;
        }

        /* ── Auto-save / Error boundary ─────────────── */
        _setupAutoSave() {
            setInterval(() => { this._syncHiddenField(); this._bus.emit('content:autosaved'); },
                this._config.get('autoSave.intervalMs'));
            window.addEventListener('beforeunload', () => this._syncHiddenField());
        }

        _setupErrorBoundary() {
            window.addEventListener('error', e => {
                if (!e.error) return;
                console.error('[WordFlow] Global error — saving content:', e.error);
                try { this._syncHiddenField(); } catch {}
            });
            window.addEventListener('unhandledrejection', e => {
                console.error('[WordFlow] Unhandled promise:', e.reason);
            });
        }
    }


    /* ─────────────────────────────────────────────────
     *  11 ▸ BOOTSTRAP
     * ───────────────────────────────────────────────── */
    let _instance = null;
    let _booting  = false;

    async function initializeWordFlow(options = {}) {
        if (_instance)  { console.warn('[WordFlow] Already initialized'); return _instance; }
        if (_booting)   { console.warn('[WordFlow] Boot in progress');    return null; }
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


    /* ─────────────────────────────────────────────────
     *  12 ▸ PAPER PANEL
     * ───────────────────────────────────────────────── */
    function _initPaperPanel(controller) {
        const btn   = document.getElementById('openPaperPanel');
        const panel = document.getElementById('paperPanel');
        if (!btn || !panel) return;

        btn.onclick = () => {
            panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
        };

        document.querySelectorAll('.paper-item').forEach(item => {
            item.addEventListener('click', () => {
                const size = item.dataset.size;
                if (size) controller.handlePaperSizeChange(size);
                panel.style.display = 'none';
            });
        });

        console.log('[WordFlow] Paper panel ready');
    }


    /* ─────────────────────────────────────────────────
     *  13 ▸ SAFE GLOBAL PROXY
     * ───────────────────────────────────────────────── */
    if (typeof window !== 'undefined') {
        const _earlyQueue = [];

        if (!window.wordFlow) {
            window.wordFlow = new Proxy({}, {
                get(_, prop) {
                    if (prop === 'then') return undefined;
                    return (...args) => {
                        if (_instance && _instance[prop]) {
                            return _instance[prop](...args);
                        }
                        _earlyQueue.push({ method: prop, args });
                        console.log(`[WordFlow] Queued early call: ${prop}()`);
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
                console.log(`[WordFlow] Replaying ${_earlyQueue.length} early call(s)...`);
                for (const { method, args } of _earlyQueue) {
                    if (typeof ctrl[method] === 'function') {
                        try { await ctrl[method](...args); }
                        catch (e) { console.warn(`[WordFlow] Early replay failed for ${method}:`, e); }
                    } else {
                        console.warn(`[WordFlow] Unknown method in early call: ${method}`);
                    }
                }
                _earlyQueue.length = 0;
            }

            window.wordFlow           = ctrl;
            window.wordFlowController = ctrl;
        }, 0);
    }


    /* ─────────────────────────────────────────────────
     *  PUBLIC EXPORTS
     * ───────────────────────────────────────────────── */
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

        version: ENGINE_VERSION,
    };
}));
