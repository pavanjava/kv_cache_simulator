# ⬡ KV Cache Simulator

An interactive, step-by-step visualizer for understanding how **Key-Value (KV) caching** works in Transformer-based language models. Built with React + Vite + TypeScript.

![Dark theme](https://img.shields.io/badge/theme-dark-0f1623?style=flat-square)
![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript)
![Vite](https://img.shields.io/badge/Vite-5-646cff?style=flat-square&logo=vite)

---

## What is KV Caching?

During autoregressive text generation, a Transformer computes **Key (K)** and **Value (V)** vectors for every token at every step. Without caching, this means recomputing all previous tokens' K/V vectors on each new token — an O(n²) operation.

**KV Caching** stores those vectors after they're computed once, so subsequent generation steps only compute K/V for the *new* token and read the rest from cache — reducing complexity to **O(n) per step**.

This simulator makes that process visible, one token at a time.

---

## Features

| Panel | Description |
|---|---|
| **⚡ Step Visualizer** | Shows the active token, phase (Prefill vs Generation), and the full data flow: Input → Compute → Store/Read → Output |
| **📦 KV Cache Memory** | Live table of all cached K/V vectors, with per-token phase labels and NEW entry highlights |
| **📊 Performance Stats** | Cache hits, FLOPs with vs without cache, efficiency percentage, and O(n²) vs O(n) comparison |
| **🔍 Attention Scores** | Per-token attention weights shown as animated bars for the current query token |

---

## Getting Started

### Prerequisites

- Node.js v18+
- Yarn

### Install & Run

```bash
# Clone or copy the project into your Vite React app
cd your-vite-app

# Install dependencies (none beyond React itself)
yarn install

# Start the dev server
yarn dev
```

Then open [http://localhost:5173](http://localhost:5173).

---

## Project Structure

```
src/
├── KVCacheSimulator.tsx   # Full simulator — engine + all UI panels
├── KVCacheSimulator.css   # Dark theme styles and animations
└── App.tsx                # Root component (imports the simulator)
```

The entire simulation engine lives inside `KVCacheSimulator.tsx` — no external state libraries, no extra dependencies.

---

## How to Use

1. **Enter prompt text** — type any space-separated words as your prompt tokens (e.g. `The quick brown fox`)
2. **Set generation steps** — drag the slider to choose how many tokens to generate (1–10)
3. **Click Run Simulation** — the simulator builds all steps
4. **Step through** using Prev / Next buttons, or watch it animate automatically
5. **Observe** how the Prefill phase fills the cache, and how the Generation phase reads from it

---

## Simulation Logic

### Prefill Phase
Every prompt token computes its K and V vectors and writes them to the cache. All prompt tokens are processed together. The active token attends to all previously cached tokens.

### Generation Phase
Only the new generated token computes fresh K/V vectors. All previous tokens' vectors are **read from cache** — no recomputation. This is the core efficiency gain of KV caching.

### K/V Vector Generation
Vectors are generated deterministically using a seeded LCG (Linear Congruential Generator) based on the token character and its index — so the same token always produces the same vectors across runs.

### Attention Scores
Attention scores are simulated as normalized dot-product-like values per cached token, visualized as proportional bars. The formula shown is the standard scaled dot-product attention:

```
Attention(Q, K, V) = softmax(QKᵀ / √d_k) · V
```

---

## Tech Stack

- **React 18** — functional components, hooks only
- **TypeScript** — fully typed simulation engine and component props
- **Vite** — fast dev server and build
- **CSS custom properties** — full dark theme via CSS variables, no CSS-in-JS
- **JetBrains Mono + Syne** — monospace for data, display font for headings
- **Zero external UI dependencies** — no component libraries

---

## Customization

### Change generated tokens
Edit the `GEN_WORDS` array in `KVCacheSimulator.tsx`:
```ts
const GEN_WORDS = ['jumps', 'over', 'the', 'lazy', 'dog', 'and', 'runs', 'away'];
```

### Change vector dimensions
Modify the `Array.from({ length: 4 }, ...)` calls in `makeKV()` to use a different embedding dimension.

### Adjust the color theme
All colors are CSS variables at the top of `KVCacheSimulator.css`:
```css
:root {
  --k: #00c8ff;   /* Key color */
  --v: #9b7aff;   /* Value color */
  --p: #10b981;   /* Prompt phase */
  --g: #f97316;   /* Generation phase */
}
```

---

## Screenshots

> Run `yarn dev` and simulate `"The quick brown fox"` with 5 generation steps to see all panels in action.

---

## License

MIT — free to use, modify, and share.

---

> Built as an educational tool for understanding Transformer inference optimization.
> Inspired by real KV cache implementations in vLLM, HuggingFace Transformers, and TensorRT-LLM.