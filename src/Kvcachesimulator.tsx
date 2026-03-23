import { useState, useCallback } from 'react';
import './KVCacheSimulator.css';

// ─── ENGINE ──────────────────────────────────────────────────────────────────

interface KVEntry {
    token: string;
    index: number;
    key: number[];
    value: number[];
    phase: 'prompt' | 'gen';
    isNew?: boolean;
}

interface Step {
    phase: 'prefill' | 'generation';
    label: string;
    activeToken: string;
    activeIndex: number;
    explanation: string;
    cache: KVEntry[];
    newEntry: KVEntry;
    attentionScores: { token: string; score: number }[];
    cacheHits: number;
    generatedTokens: string[];
    flopsWithout: number;
    flopsWith: number;
}

const GEN_WORDS = ['jumps', 'over', 'the', 'lazy', 'dog', 'and', 'runs', 'away'];

function seeded(seed: number) {
    let s = seed;
    return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

function makeKV(token: string, idx: number) {
    const r = seeded(token.charCodeAt(0) * 31 + idx * 17);
    return {
        key: Array.from({ length: 4 }, () => +((r() * 2 - 1).toFixed(3))),
        value: Array.from({ length: 4 }, () => +((r() * 2 - 1).toFixed(3))),
    };
}

function simulate(promptTokens: string[], genCount: number): Step[] {
    const steps: Step[] = [];
    const cache: KVEntry[] = [];
    const generated: string[] = [];

    for (let i = 0; i < promptTokens.length; i++) {
        const token = promptTokens[i];
        const { key, value } = makeKV(token, i);
        const entry: KVEntry = { token, index: i, key, value, phase: 'prompt', isNew: true };
        const snap = cache.map(e => ({ ...e, isNew: false }));
        const r = seeded(token.charCodeAt(0) * 7);
        steps.push({
            phase: 'prefill',
            label: `Prefill ${i + 1}/${promptTokens.length}`,
            activeToken: token,
            activeIndex: i,
            explanation: `Prefill phase: computing K and V vectors for "${token}" and storing in cache. All prompt tokens are processed in parallel. Token attends to ${snap.length} previous token(s).`,
            cache: [...snap, entry],
            newEntry: entry,
            attentionScores: snap.map(e => ({ token: e.token, score: +((r() * 0.6 + 0.2).toFixed(3)) })),
            cacheHits: 0,
            generatedTokens: [],
            flopsWithout: (i + 1) * (i + 1),
            flopsWith: i + 1,
        });
        cache.push({ ...entry, isNew: false });
    }

    for (let g = 0; g < genCount; g++) {
        const token = GEN_WORDS[g % GEN_WORDS.length];
        const idx = promptTokens.length + g;
        const { key, value } = makeKV(token, idx);
        const entry: KVEntry = { token, index: idx, key, value, phase: 'gen', isNew: true };
        const snap = cache.map(e => ({ ...e, isNew: false }));
        const r = seeded(token.charCodeAt(0) * 13);
        generated.push(token);
        steps.push({
            phase: 'generation',
            label: `Generate ${g + 1}/${genCount}`,
            activeToken: token,
            activeIndex: idx,
            explanation: `Generation phase: only "${token}" needs new K/V computation. All ${snap.length} previous tokens' vectors are READ from cache — zero recomputation. This is O(n) vs O(n²) without cache.`,
            cache: [...snap, entry],
            newEntry: entry,
            attentionScores: snap.map(e => ({ token: e.token, score: +((r() * 0.6 + 0.2).toFixed(3)) })),
            cacheHits: snap.length,
            generatedTokens: [...generated],
            flopsWithout: (idx + 1) * (idx + 1),
            flopsWith: idx + 1,
        });
        cache.push({ ...entry, isNew: false });
    }

    return steps;
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function KVCacheSimulator() {
    const [prompt, setPrompt] = useState('The quick brown fox');
    const [genCount, setGenCount] = useState(5);
    const [steps, setSteps] = useState<Step[]>([]);
    const [idx, setIdx] = useState(0);

    const run = useCallback(() => {
        const tokens = prompt.trim().split(/\s+/).filter(Boolean);
        if (!tokens.length) return;
        const s = simulate(tokens, genCount);
        setSteps(s);
        setIdx(0);
    }, [prompt, genCount]);

    const step = steps[idx];
    const promptTokens = prompt.trim().split(/\s+/).filter(Boolean);

    return (
        <div className="app">
            {/* HEADER */}
            <header className="header">
                <div className="header-left">
                    <span className="logo">⬡</span>
                    <div>
                        <h1>KV Cache and Attention Simulator</h1>
                    </div>
                </div>
                <div className="badges">
                    <span className="badge k">K</span>
                    <span className="badge v">V</span>
                    <span className="badge q">Q</span>
                </div>
            </header>

            {/* CONFIG */}
            <section className="card config-card">
                <div className="card-title"><span className="tag">01</span> Configure</div>
                <div className="config-row">
                    <div className="field">
                        <label>Prompt Tokens <span className="count">{promptTokens.length} tokens</span></label>
                        <input
                            value={prompt}
                            onChange={e => setPrompt(e.target.value)}
                            placeholder="Enter prompt text..."
                            className="text-input"
                        />
                        <div className="chips">
                            {promptTokens.map((t, i) => (
                                <span key={i} className="chip chip-prompt"><span className="chip-i">{i}</span>{t}</span>
                            ))}
                        </div>
                    </div>
                    <div className="field field-sm">
                        <label>Generation Steps <span className="count">{genCount}</span></label>
                        <input type="range" min={1} max={10} value={genCount}
                               onChange={e => setGenCount(+e.target.value)} className="slider" />
                    </div>
                    <button className="run-btn" onClick={run}>⬡ Run Simulation →</button>
                </div>
            </section>

            {/* SIMULATION */}
            {steps.length > 0 && step && (
                <>
                    {/* STEP CONTROLS */}
                    <div className="controls">
                        <button className="nav" onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}>◀ Prev</button>
                        <span className="step-info">
              <span className="cur">{idx + 1}</span>/<span className="tot">{steps.length}</span>
            </span>
                        <button className="nav" onClick={() => setIdx(i => Math.min(steps.length - 1, i + 1))} disabled={idx === steps.length - 1}>Next ▶</button>
                        <span className={`phase-badge ${step.phase}`}>{step.phase === 'prefill' ? '⚡ Prefill' : '🔁 Generation'}</span>
                        <div className="prog-wrap"><div className="prog-bar" style={{ width: `${((idx + 1) / steps.length) * 100}%` }} /></div>
                    </div>

                    <div className="grid">
                        {/* STEP VISUALIZER */}
                        <section className="card">
                            <div className="card-title"><span className="tag">02</span> Step Visualizer</div>
                            <div className="active-row">
                                <span className="active-label">Active Token</span>
                                <span className="active-chip">{step.activeToken}</span>
                                <span className="active-meta">idx: {step.activeIndex}</span>
                            </div>
                            <div className="flow">
                                <div className={`fbox input-box ${step.phase}`}>
                                    <span className="fl">Input</span>
                                    <span className="fv">"{step.activeToken}"</span>
                                </div>
                                <span className="arrow">→</span>
                                <div className="fbox compute-box">
                                    <span className="fl">Compute</span>
                                    <span className="fv">Q · K · V</span>
                                </div>
                                <span className="arrow">→</span>
                                {step.phase === 'prefill'
                                    ? <div className="fbox store-box"><span className="fl">Store</span><span className="fv">Cache[{step.activeIndex}]</span></div>
                                    : <div className="fbox read-box"><span className="fl">Read Cache</span><span className="fv">{step.cacheHits} hits</span></div>}
                                <span className="arrow">→</span>
                                <div className="fbox out-box">
                                    <span className="fl">Output</span>
                                    <span className="fv">{step.phase === 'prefill' ? '→ Cached' : `"${step.activeToken}"`}</span>
                                </div>
                            </div>
                            <div className="explain">💡 {step.explanation}</div>
                            {step.generatedTokens.length > 0 && (
                                <div className="gen-seq">
                                    <span className="gen-label">Generated:</span>
                                    {step.generatedTokens.map((t, i) => (
                                        <span key={i} className={`chip chip-gen ${i === step.generatedTokens.length - 1 ? 'latest' : ''}`}>{t}</span>
                                    ))}
                                </div>
                            )}
                        </section>

                        {/* STATS */}
                        <section className="card">
                            <div className="card-title"><span className="tag">03</span> Performance Stats</div>
                            <div className="stats-grid">
                                <div className="stat"><span className="si">📦</span><span className="sv">{step.cache.length}</span><span className="sl">Cache Size</span></div>
                                <div className="stat"><span className="si">⚡</span><span className="sv">{step.cacheHits}</span><span className="sl">Cache Hits</span></div>
                                <div className="stat hi"><span className="si">🔢</span><span className="sv">{step.flopsWithout.toLocaleString()}</span><span className="sl">FLOPs w/o Cache</span></div>
                                <div className="stat hi"><span className="si">✅</span><span className="sv">{step.flopsWith}</span><span className="sl">FLOPs w/ Cache</span></div>
                            </div>
                            <div className="bar-row"><span>Progress</span><span>{Math.round(((idx + 1) / steps.length) * 100)}%</span></div>
                            <div className="bar-bg"><div className="bar-fill prog" style={{ width: `${((idx + 1) / steps.length) * 100}%` }} /></div>
                            <div className="complexity">
                                <div className="cx-row"><span>Without KV Cache</span><span className="cx-bad">O(n²) = {step.flopsWithout} ops</span></div>
                                <div className="cx-row"><span>With KV Cache</span><span className="cx-good">O(n) = {step.flopsWith} ops</span></div>
                                <div className="cx-saving">🚀 {Math.round((1 - step.flopsWith / step.flopsWithout) * 100)}% FLOPs reduced</div>
                            </div>
                        </section>

                        {/* KV CACHE TABLE */}
                        <section className="card full-width">
                            <div className="card-title"><span className="tag">04</span> KV Cache Memory <span className="size-badge">{step.cache.length} entries</span></div>
                            <div className="table-wrap">
                                <table className="kv-table">
                                    <thead><tr><th>Idx</th><th>Token</th><th>Phase</th><th>Key Vector K</th><th>Value Vector V</th></tr></thead>
                                    <tbody>
                                    {step.cache.map((e, i) => (
                                        <tr key={i} className={`tr ${e.isNew ? 'new-row' : ''} ${e.phase}`}>
                                            <td className="td-idx">{e.index}</td>
                                            <td><span className="tname">{e.token}{e.isNew && <span className="new-tag">NEW</span>}</span></td>
                                            <td><span className={`pbadge ${e.phase}`}>{e.phase}</span></td>
                                            <td className="vec k-vec">[{e.key.map(v => v.toFixed(2)).join(', ')}]</td>
                                            <td className="vec v-vec">[{e.value.map(v => v.toFixed(2)).join(', ')}]</td>
                                        </tr>
                                    ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>

                        {/* ATTENTION */}
                        <section className="card full-width">
                            <div className="card-title">
                                <span className="tag">05</span> Attention Scores
                                <span className="attn-sub">"{step.activeToken}" attends to all cached tokens</span>
                            </div>
                            {step.attentionScores.length === 0
                                ? <p className="empty">No previous tokens yet.</p>
                                : (
                                    <div className="attn-body">
                                        {step.attentionScores.map((s, i) => {
                                            const max = Math.max(...step.attentionScores.map(x => x.score));
                                            const pct = (s.score / max) * 100;
                                            return (
                                                <div key={i} className="attn-row">
                                                    <span className="attn-tok">{s.token}</span>
                                                    <div className="attn-bar-bg">
                                                        <div className="attn-bar" style={{ width: `${pct}%`, opacity: 0.3 + (pct / 100) * 0.7 }} />
                                                    </div>
                                                    <span className="attn-score">{s.score.toFixed(3)}</span>
                                                </div>
                                            );
                                        })}
                                        <div className="formula">Attention(Q,K,V) = softmax(QKᵀ / √d<sub>k</sub>) · V</div>
                                    </div>
                                )}
                        </section>
                    </div>
                </>
            )}

            {steps.length === 0 && (
                <div className="empty-state">
                    <span className="empty-icon">⬡</span>
                    <p>Configure tokens above and click <strong>Run Simulation</strong></p>
                </div>
            )}
        </div>
    );
}