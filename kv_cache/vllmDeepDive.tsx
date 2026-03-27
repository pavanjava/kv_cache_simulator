import { useState } from "react";

const sections = [
    {
        id: "overview",
        title: "1. Executive Overview",
        color: "#1e40af",
        content: `
      <h2>vLLM Server Startup — Deep Dive Analysis</h2>
      <p><strong>Model:</strong> openai/whisper-large-v3 (Encoder-Decoder ASR)</p>
      <p><strong>vLLM Version:</strong> 0.17.0</p>
      <p><strong>Hardware:</strong> 4× PCIe GPU (compute capability 8.6 — likely NVIDIA A10G or RTX 3090/A5000)</p>
      <p><strong>Parallelism:</strong> Tensor Parallel across 4 GPUs</p>
      <p><strong>Task:</strong> Audio transcription (Speech-to-Text)</p>
      <p><strong>API Endpoint:</strong> http://0.0.0.0:8000/v1/audio/transcriptions</p>
      <hr/>
      <p>This document walks through every phase of the vLLM startup log, from process spawning to the server going live, explaining what each component does, why decisions were made, and what the numbers mean.</p>
    `
    },
    {
        id: "phase1",
        title: "2. Process Architecture",
        color: "#065f46",
        content: `
      <h2>Phase 1: Process Spawning & Architecture</h2>

      <h3>Key Processes</h3>
      <table>
        <tr><th>PID</th><th>Role</th><th>Description</th></tr>
        <tr><td>35610</td><td>APIServer</td><td>HTTP-facing FastAPI server (handles all client requests)</td></tr>
        <tr><td>35961</td><td>EngineCore_DP0</td><td>Data Parallel group 0 orchestrator — schedules inference</td></tr>
        <tr><td>36130</td><td>Worker_TP0</td><td>Tensor Parallel rank 0 (GPU 0) — primary compute worker</td></tr>
        <tr><td>36131</td><td>Worker_TP1</td><td>Tensor Parallel rank 1 (GPU 1)</td></tr>
        <tr><td>36132</td><td>Worker_TP2</td><td>Tensor Parallel rank 2 (GPU 2)</td></tr>
        <tr><td>36133</td><td>Worker_TP3</td><td>Tensor Parallel rank 3 (GPU 3)</td></tr>
      </table>

      <h3>Why This Architecture?</h3>
      <p>vLLM uses a <strong>multi-process design</strong> rather than threads to avoid Python's GIL. Each GPU gets its own OS process. The APIServer is completely decoupled from engine execution — it can serve HTTP while inference runs in the background.</p>

      <h3>Tensor Parallelism (TP=4) — What It Means</h3>
      <p>With TP=4, each attention layer's weight matrix is <em>sharded column-wise or row-wise</em> across 4 GPUs. For a weight matrix W of shape [d_model, d_ffn]:</p>
      <pre>GPU0: W[:, 0:d_ffn/4]
GPU1: W[:, d_ffn/4:d_ffn/2]
GPU2: W[:, d_ffn/2:3*d_ffn/4]
GPU3: W[:, 3*d_ffn/4:d_ffn]</pre>
      <p>After each partial matmul, an <strong>AllReduce</strong> over NCCL synchronizes results. This lets Whisper-large-v3 (1.5B params) fit comfortably with low per-GPU memory pressure.</p>

      <h3>Rank Assignment Log</h3>
      <pre>rank 0 → DP rank 0, PP rank 0, TP rank 0
rank 1 → DP rank 0, PP rank 0, TP rank 1
rank 2 → DP rank 0, PP rank 0, TP rank 2
rank 3 → DP rank 0, PP rank 0, TP rank 3</pre>
      <p>All workers share the same DP and PP group (no data parallelism or pipeline parallelism is active). Only TP differs — the 4 GPUs collectively process one model instance.</p>
    `
    },
    {
        id: "phase2",
        title: "3. Model Resolution & Config",
        color: "#7c2d12",
        content: `
      <h2>Phase 2: Model Architecture Resolution</h2>

      <h3>Architecture Detection</h3>
      <pre>Resolved architecture: WhisperForConditionalGeneration
Using max model len 448</pre>
      <p>vLLM maps the HuggingFace model ID to an internal class. <code>WhisperForConditionalGeneration</code> is an encoder-decoder: the encoder processes mel-spectrogram audio features, and the decoder auto-regressively generates text tokens.</p>

      <h3>Why max_seq_len = 448?</h3>
      <p>Whisper's decoder has a hard-coded max position embedding of <strong>448 tokens</strong>. This corresponds to approximately 30 seconds of audio (Whisper segments audio into 30s chunks). At ~3 tokens/word, this supports transcripts of ~150 words per chunk. This is NOT configurable without retraining.</p>

      <h3>Encoder-Decoder Implications</h3>
      <pre>Encoder-decoder model detected, disabling mm processor cache.
Encoder-decoder models do not support chunked prefill nor prefix caching; disabling both.</pre>

      <table>
        <tr><th>Feature</th><th>Status</th><th>Why</th></tr>
        <tr><td>MM Processor Cache</td><td>❌ Disabled</td><td>Audio inputs vary per request; caching mel features would waste memory</td></tr>
        <tr><td>Chunked Prefill</td><td>❌ Disabled</td><td>Encoder output must be fully computed before decoder starts</td></tr>
        <tr><td>Prefix Caching</td><td>❌ Disabled</td><td>No shared KV-cache prefix possible between encoder-decoder cross-attention</td></tr>
        <tr><td>Async Scheduling</td><td>✅ Enabled</td><td>Decouples HTTP I/O from engine scheduling for higher throughput</td></tr>
      </table>

      <h3>dtype = float16</h3>
      <p>All weights and activations use FP16 (half precision). Whisper-large-v3 has ~1.55B parameters. At FP16 (2 bytes/param): <strong>~3.1 GB</strong> per full model copy. Sharded across 4 GPUs: ~0.83 GB per GPU — which exactly matches the log: <em>"Model loading took 0.83 GiB"</em>.</p>
    `
    },
    {
        id: "phase3",
        title: "4. Distributed Init & NCCL",
        color: "#4a1d96",
        content: `
      <h2>Phase 3: Distributed Communication Setup</h2>

      <h3>NCCL Initialization</h3>
      <pre>distributed_init_method=tcp://127.0.0.1:50835 backend=nccl
vLLM is using nccl==2.27.5</pre>
      <p>NCCL (NVIDIA Collective Communications Library) is the backbone of inter-GPU communication. Workers rendezvous over TCP at port 50835. The rank=0 worker acts as the <em>coordinator</em> for collective ops.</p>

      <h3>SymmMemCommunicator Warning</h3>
      <pre>SymmMemCommunicator: Device capability 8.6 not supported</pre>
      <p>Symmetric Memory (SymmMem) is a NCCL optimization using <em>CUDA symmetric memory</em> for zero-copy AllReduce — only available on Hopper (H100, capability 9.0+) and newer. With capability 8.6 (Ampere A10G/A30), vLLM falls back to standard NCCL AllReduce, which is still fast but involves an extra memory copy.</p>

      <h3>Custom AllReduce Disabled</h3>
      <pre>Custom allreduce is disabled because it's not supported on more than two PCIe-only GPUs.</pre>
      <p>vLLM has a custom AllReduce kernel (faster than NCCL for small tensors with 2 GPUs on NVLink). With 4 PCIe-connected GPUs (no NVLink), it falls back to NCCL's built-in AllReduce. This is correct behavior — forced NVLink paths would deadlock or give wrong results on PCIe topologies.</p>

      <h3>Thread Count Reduction</h3>
      <pre>Reducing Torch parallelism from 48 threads to 1</pre>
      <p>By default, PyTorch uses 48 CPU threads (= vCPU count on this instance, likely c5.12xlarge or similar). With 4 GPU workers each running their own Python process, 4×48=192 threads would thrash CPU caches. vLLM sets OMP_NUM_THREADS=1 per worker. GPU compute is parallelized via CUDA, not OpenMP.</p>
    `
    },
    {
        id: "phase4",
        title: "5. Attention Backend Selection",
        color: "#134e4a",
        content: `
      <h2>Phase 4: Attention Backend Selection</h2>

      <h3>Backend Candidates</h3>
      <pre>FLASH_ATTN, FLASHINFER, TRITON_ATTN, FLEX_ATTENTION</pre>

      <h3>Selection Logic</h3>
      <table>
        <tr><th>Backend</th><th>Selected For</th><th>Reason</th></tr>
        <tr><td>FlashAttention v2</td><td>Encoder (ViT-style) self-attention</td><td>Best performance for fixed-length audio encoder sequences</td></tr>
        <tr><td>FlashAttention v2</td><td>Decoder cross-attention</td><td>Standard choice for causal decoding on Ampere</td></tr>
        <tr><td>FlashInfer</td><td>Not selected</td><td>Typically for dynamic decode batching; less optimal for Whisper's short sequences</td></tr>
      </table>

      <h3>What is FlashAttention v2?</h3>
      <p>FlashAttention rewrites the attention computation to be <em>IO-aware</em>. Standard attention:</p>
      <pre>S = QK^T / √d   → written to HBM
P = softmax(S)   → read from HBM, written again
O = PV           → read from HBM</pre>
      <p>FlashAttention v2 fuses all three into one kernel, keeping intermediates in SRAM (L1 cache). For Whisper's 1500-token encoder output, this saves ~3 HBM reads/writes per layer.</p>

      <h3>Encoder vs Decoder Backends</h3>
      <pre>Using AttentionBackendEnum.FLASH_ATTN for vit attention  ← Encoder
Using FLASH_ATTN attention backend out of potential backends  ← Decoder</pre>
      <p>vLLM selects backends separately for the encoder and decoder because they have different access patterns: the encoder runs <em>full bidirectional</em> attention once, while the decoder uses <em>causal masked</em> attention autoregressively, with KV-cache lookups.</p>
    `
    },
    {
        id: "phase5",
        title: "6. Weight Loading",
        color: "#1c1917",
        content: `
      <h2>Phase 5: Safetensors Weight Loading</h2>

      <h3>Log</h3>
      <pre>No model.safetensors.index.json found in remote.
Loading safetensors checkpoint shards: 100% | 3/3 [00:00, 4.74it/s]
Loading weights took 0.68 seconds
Model loading took 0.83 GiB memory and 1.899785 seconds</pre>

      <h3>Sharding Explained</h3>
      <p>The absence of <code>safetensors.index.json</code> means the weights are <em>not split into named shards</em> — vLLM loads all 3 <code>.safetensors</code> files directly. The 3-shard structure of Whisper-large-v3:</p>
      <table>
        <tr><th>Shard</th><th>Contents (approx)</th></tr>
        <tr><td>model-00001</td><td>Encoder conv layers + first N transformer blocks</td></tr>
        <tr><td>model-00002</td><td>Remaining encoder blocks + decoder embedding</td></tr>
        <tr><td>model-00003</td><td>Decoder transformer blocks + LM head</td></tr>
      </table>

      <h3>Memory Math</h3>
      <pre>Whisper-large-v3 params: ~1.544B
FP16 per param: 2 bytes
Total: 1.544B × 2 = 3.088 GB full model
Per GPU (TP=4): 3.088 / 4 ≈ 0.772 GB
Overhead (buffers, etc): ~0.06 GB
→ Logged: 0.83 GiB ✓</pre>

      <h3>Speed: 4.74 shards/sec</h3>
      <p>This is fast because the model was <em>already cached locally</em> in <code>~/.cache/huggingface/hub/</code> from a prior download. Safetensors (vs pickle/pytorch) uses memory-mapped file I/O — zero-copy loading directly from disk to GPU via <code>mmap()</code> + <code>cudaMemcpy</code>.</p>
    `
    },
    {
        id: "phase6",
        title: "7. Torch Compile & AOT",
        color: "#0f172a",
        content: `
      <h2>Phase 6: torch.compile and AOT Cache</h2>

      <h3>Compilation Strategy</h3>
      <pre>CompilationMode.VLLM_COMPILE (mode 3)
backend: inductor
CUDAGraphMode: FULL_DECODE_ONLY</pre>

      <h3>What is torch.compile?</h3>
      <p>PyTorch 2.x's <code>torch.compile</code> traces the model graph and compiles it via <strong>TorchInductor</strong> into optimized CUDA kernels. It enables:</p>
      <ul>
        <li><strong>Kernel fusion:</strong> fuse norm+matmul, activation+quant into single CUDA kernels</li>
        <li><strong>Memory planning:</strong> eliminate unnecessary tensor allocations</li>
        <li><strong>Auto-tuning:</strong> select optimal GEMM tile sizes for your GPU</li>
      </ul>

      <h3>AOT (Ahead-of-Time) Cache Hit</h3>
      <pre>Directly load AOT compilation from path:
/home/ubuntu/.cache/vllm/torch_compile_cache/torch_aot_compile/
9d3112af8c116d2645d90d7f9cb43bc78ee5e1ec7cb98818e35ae51161d20a63/rank_0_0/model

Dynamo bytecode transform time: 1.38 s
Directly load the compiled graph(s) for compile range (1, 2048) took 1.684 s
torch.compile takes 3.69 s in total</pre>

      <p>The hash <code>9d3112af...</code> is a fingerprint of the model config + GPU arch + vLLM version. Since it matches a prior run, vLLM skips full recompilation (which would take 60-300s) and loads prebuilt binaries. <strong>Cold start (first ever run) would take ~5 minutes</strong>; warm cache takes 3.69s.</p>

      <h3>FULL_DECODE_ONLY CUDAGraph Mode</h3>
      <pre>Encoder-decoder models do not support FULL_AND_PIECEWISE. 
Overriding cudagraph_mode to FULL_DECODE_ONLY.</pre>
      <p>CUDAGraphs record GPU kernel launch sequences and replay them — eliminating CPU-side kernel launch overhead (~5-10µs per kernel). For encoder-decoder models, only the <em>decode phase</em> (autoregressive token generation) is graph-captured, because the encoder input shapes vary per audio file.</p>
    `
    },
    {
        id: "phase7",
        title: "8. KV Cache Sizing",
        color: "#064e3b",
        content: `
      <h2>Phase 7: KV Cache Allocation</h2>

      <h3>Log</h3>
      <pre>Available KV cache memory: 16.47 GiB
GPU KV cache size: 215,920 tokens
Maximum concurrency for 448 tokens per request: 173.01x</pre>

      <h3>How KV Cache Memory is Calculated</h3>
      <p>After loading weights (0.83 GiB/GPU) and activations budget, the remaining GPU memory is dedicated to KV cache:</p>
      <pre>GPU total memory (GPU VRAM assumed): ~24 GB (A10G)
gpu_memory_utilization = 0.8 → usable = 19.2 GB
Model weights: ~0.83 GB
CUDA runtime + framework: ~1.5 GB
Activations/scratch: ~0.4 GB
─────────────────────────────────
KV cache budget: ≈ 16.47 GB ✓</pre>

      <h3>KV Cache Token Count</h3>
      <pre>215,920 tokens / 448 tokens per request = 482 simultaneous requests (theoretical)</pre>
      <p>The log says 173.01× concurrency — this accounts for the fact that KV cache is needed for <em>both encoder and decoder</em> cross-attention layers (decoder cross-attention KV entries are derived from encoder output, consuming additional blocks).</p>

      <h3>Paged Attention & KV Blocks</h3>
      <p>vLLM stores KV cache in <strong>fixed-size pages</strong> (like OS virtual memory), not contiguous allocations. A block holds tokens for one layer's K and V tensors. Pages are allocated on-demand and freed when a request finishes — enabling high concurrency without memory fragmentation.</p>
      <pre>Example block layout (per GPU, simplified):
┌────────────────────────────────────┐
│ Block 0: K[layer0,tokens 0-15]    │
│          V[layer0,tokens 0-15]    │
├────────────────────────────────────┤
│ Block 1: K[layer0,tokens 16-31]   │
│          V[layer0,tokens 16-31]   │
├────────────────────────────────────┤
│ ...215,920 tokens worth of blocks │
└────────────────────────────────────┘</pre>
    `
    },
    {
        id: "phase8",
        title: "9. CUDA Graph Capture",
        color: "#1e3a5f",
        content: `
      <h2>Phase 8: CUDA Graph Capture</h2>

      <h3>Log</h3>
      <pre>Capturing CUDA graphs (decode, FULL): 100% | 35/35 [00:02, 12.59it/s]
Graph capturing finished in 3 secs, took 0.49 GiB</pre>

      <h3>What are CUDA Graphs?</h3>
      <p>Normally, each forward pass requires the CPU to <em>launch</em> hundreds of CUDA kernels sequentially. Each launch has ~5-15µs overhead. For small batch sizes (common in decode), this CPU overhead dominates over GPU compute time.</p>
      <p>CUDA Graphs record an entire sequence of kernel launches into a <em>graph object</em>. Replay is a single CUDA API call, bypassing all CPU overhead.</p>

      <h3>35 Graph Sizes Captured</h3>
      <pre>Capture sizes: [1, 2, 4, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96, 
                104, 112, 120, 128, 136, 144, 152, 160, 168, 176, 184, 192, 
                200, 208, 216, 224, 232, 240, 248, 256, 272, 288, 304, 320, 
                336, 352, 368, 384, 400, 416, 432, 448, 464, 480, 496, 512]</pre>
      <p>A separate graph is needed for each <strong>batch size</strong> because CUDA graphs are static — tensor shapes must match exactly at replay time. With 35 graphs × ~14 MB each ≈ 0.49 GiB. This matches the log.</p>

      <h3>Runtime Batch Selection</h3>
      <pre>Example: 3 concurrent requests decoding simultaneously
→ vLLM pads batch to nearest capture size (4)
→ Replays the batch-size-4 CUDA graph
→ Ignores padded slot outputs</pre>
      <p>This is the <strong>padding strategy</strong>: always run a valid graph size, discard padding. Slight compute waste, but massive latency improvement on small batches.</p>
    `
    },
    {
        id: "phase9",
        title: "10. API Server & Routes",
        color: "#3f1f69",
        content: `
      <h2>Phase 9: API Server Startup</h2>

      <h3>Supported Tasks</h3>
      <pre>Supported tasks: ['transcription']</pre>
      <p>Unlike LLM models which support <code>generate</code>, <code>embed</code>, etc., Whisper only exposes <code>transcription</code>. The vLLM task registry maps this to the audio pipeline.</p>

      <h3>Multimodal Input Processor Warmup</h3>
      <pre>Warming up multimodal input processor...
Input processor warmup completed in 0.01s (×2)</pre>
      <p>The warmup runs a dummy audio tensor through the mel-spectrogram feature extractor to pre-JIT compile any lazy operations. It runs twice — once for the transcription route and once for the translation route. The 0.01s warmup indicates all numpy/torch ops were already compiled.</p>

      <h3>Available Routes</h3>
      <table>
        <tr><th>Route</th><th>Method</th><th>Purpose</th></tr>
        <tr><td>/v1/audio/transcriptions</td><td>POST</td><td>Transcribe audio to text (same language)</td></tr>
        <tr><td>/v1/audio/translations</td><td>POST</td><td>Transcribe and translate to English</td></tr>
        <tr><td>/v1/models</td><td>GET</td><td>List served models (OpenAI-compatible)</td></tr>
        <tr><td>/health</td><td>GET</td><td>Liveness probe</td></tr>
        <tr><td>/metrics</td><td>GET</td><td>Prometheus metrics (request count, latency, GPU util)</td></tr>
        <tr><td>/load</td><td>GET</td><td>Current engine load factor</td></tr>
        <tr><td>/tokenize</td><td>POST</td><td>Tokenize text without inference</td></tr>
      </table>

      <h3>First Request Observed</h3>
      <pre>172.18.0.3:53428 - "GET /metrics HTTP/1.1" 200 OK</pre>
      <p>IP 172.18.0.3 is a Docker bridge network address — this is a <strong>Prometheus scraper</strong> (e.g., from a monitoring sidecar or AWS CloudWatch agent) immediately hitting the metrics endpoint. The server is already production-ready at this point.</p>
    `
    }
];

export function VllmAnalysis() {
    const [active, setActive] = useState("overview");
    const current = sections.find(s => s.id === active)!;

    return (
        <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui, sans-serif", fontSize: 14 }}>
            {/* Sidebar */}
            <div style={{ width: 220, background: "#0f172a", color: "#1e293b", overflowY: "auto", flexShrink: 0 }}>
                <div style={{ padding: "16px 12px", borderBottom: "1px solid #1e293b" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", letterSpacing: 1 }}>vLLM DEEP DIVE</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>Whisper Large v3</div>
                </div>
                {sections.map(s => (
                    <div
                        key={s.id}
                        onClick={() => setActive(s.id)}
                        style={{
                            padding: "10px 14px",
                            cursor: "pointer",
                            borderLeft: active === s.id ? `3px solid ${s.color}` : "3px solid transparent",
                            background: active === s.id ? "#1e293b" : "transparent",
                            color: active === s.id ? "#f1f5f9" : "#94a3b8",
                            fontSize: 12,
                            lineHeight: 1.4,
                            transition: "all 0.15s"
                        }}
                    >
                        {s.title}
                    </div>
                ))}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: "auto", background: "#f8fafc" }}>
                <div style={{ maxWidth: 800, margin: "0 auto", padding: "32px 40px" }}>
                    <div
                        style={{ lineHeight: 1.8 }}
                        dangerouslySetInnerHTML={{ __html: current.content.replace(/<table>/g, '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">').replace(/<th>/g, '<th style="text-align:left;padding:8px 12px;background:#1e293b;color:#e2e8f0;border:1px solid #334155">').replace(/<td>/g, '<td style="padding:8px 12px;border:1px solid #e2e8f0;vertical-align:top;color:#1e293b">').replace(/<tr>/g, '<tr style="background:white">').replace(/<pre>/g, '<pre style="background:#1e293b;color:#a5f3fc;padding:14px;border-radius:6px;overflow-x:auto;font-size:12px;line-height:1.6;margin:12px 0">').replace(/<h2>/g, '<h2 style="color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:8px;margin-bottom:16px">').replace(/<h3>/g, '<h3 style="color:#1e40af;margin-top:20px;margin-bottom:8px">').replace(/<p>/g, '<p style="margin:10px 0;color:#334155">').replace(/<ul>/g, '<ul style="color:#334155;margin:8px 0 8px 20px">').replace(/<li>/g, '<li style="margin:4px 0">') }}
                    />

                    <div style={{ marginTop: 32, display: "flex", gap: 10, justifyContent: "space-between" }}>
                        {sections.findIndex(s => s.id === active) > 0 && (
                            <button
                                onClick={() => setActive(sections[sections.findIndex(s => s.id === active) - 1].id)}
                                style={{ padding: "8px 16px", background: "#1e293b", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
                            >
                                ← Previous
                            </button>
                        )}
                        {sections.findIndex(s => s.id === active) < sections.length - 1 && (
                            <button
                                onClick={() => setActive(sections[sections.findIndex(s => s.id === active) + 1].id)}
                                style={{ padding: "8px 16px", background: current.color, color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, marginLeft: "auto" }}
                            >
                                Next →
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}