# DQ rembg 抠图 Sidecar

该服务为 Canvas 图片节点提供内部 CPU 抠图能力，只能由 DQ-绘图 服务端或生成 Worker 访问，不得直接暴露到公网。

## 功能简述

- `GET /livez`：进程存活检查。
- `GET /readyz`：模型、白名单与推理槽就绪检查。
- `POST /v1/remove`：接收 JPEG、PNG 或 WebP 原始字节，返回透明 PNG。
- `DELETE /v1/tasks/{taskId}`：取消排队或运行中的任务，并等待推理子进程退出。
- 每个推理在独立子进程中运行，超时或取消后先回收进程，再释放全局推理槽。
- 输入与输出各限制 30MB，源图限制 6400 万像素，最长边超过 2048px 时等比缩小；不接受动画图片、任意 URL、multipart 或任意模型名。
- 新任务只输出透明 RGBA PNG；V1/V2 历史参数保持可读，V3 可选择五个画布白名单模型和 Alpha/蒙版后处理参数。

## 模型与资源

镜像预取 `u2net`、`isnet-general-use`、`u2net_human_seg`、`isnet-anime` 和 `silueta`，默认检查 `silueta`。全站持久任务队列只允许一个 rembg 推理；Sidecar 自身也把 `DQ_REMBG_CONCURRENCY` 硬限制为 `1`。

标准资源上限为 2 CPU、5 GiB 内存、2 个 ONNX intra-op 线程和 1 个 inter-op 线程。低内存部署应把 Sidecar 放在另一台内网主机，并配置相同的 `DQ_REMBG_INTERNAL_TOKEN`。

## 本地验证

```bash
python -m pip install -r requirements.txt
python -m unittest test_app.py
```

模型权重会在镜像构建阶段下载。单元测试使用隔离和 mock，不要求调用真实模型渠道；实际镜像仍需验证五模型就绪、2K 图片质量、取消、内存和队列等待时间。

## English technical reference

This service wraps `rembg==2.0.77` for the canvas background-removal action. It
is an internal service and must not be published directly to the internet.

## API

- `GET /livez`: process liveness.
- `GET /readyz`: model readiness. Startup verifies that the configured baseline
  model can be loaded, reports the canvas model allowlist, and keeps each
  inference session isolated in its child process.
- `POST /v1/remove`: raw image bytes in the request body. Set `Content-Type` to
  `image/jpeg`, `image/png`, or `image/webp`; the response is a transparent
  `image/png`. The authenticated BFF sends a validated parameter snapshot in
  `X-DQ-Rembg-Options`. Legacy version 1/2 snapshots remain parseable, while
  the HTTP endpoint accepts only transparent output for new execution. Version
  3 additionally selects one of the five preloaded canvas models through
  `model`. All versions support `preset`,
  `alphaMatting`, `foregroundThreshold`, `backgroundThreshold`, `refineRange`,
  and `cleanMask`. Version 3 also includes the official UI's fine preset:
  Alpha Matting on, thresholds 240/10, erosion 40, and mask post-processing
  on. Cross-version and unknown fields are rejected. URLs, multipart forms,
  arbitrary model names, and arbitrary rembg keyword arguments are not
  accepted.
- `DELETE /v1/tasks/{taskId}`: records a bounded, expiring cancellation
  tombstone and cancels a matching queued or running request. The response
  confirms termination only after the request has released its gates and its
  inference child has been terminated and joined. `POST /v1/remove` requires
  the same task ID in `X-DQ-Rembg-Task-Id`, so cancellation that arrives just
  before request registration still prevents inference from starting.

The wrapper enforces a 30MB request/output limit, a 64,000,000 pixel defensive
limit, rejects animated images, normalizes EXIF orientation, and caps the
model input at 2048 pixels on its longest edge. It gates inference at one
global CPU call. A conservative
source-color and mask-confidence pass removes only large regions matching the
border background, including enclosed holes, then feeds that cleaned mask back
through rembg's official `remove` pipeline.

Alpha matting operates on the normalized 2K model input and solves overlapping
tiles of about 1,048,576 pixels. Existing source transparency is multiplied
into the result.
Each inference runs in an isolated child process; a timeout or cancellation
reclaims that child before releasing its slots. Startup model validation also
runs in a short-lived child, so the API parent retains no ONNX session. The
per-user 30 requests/minute and same-source-node rule belong in the authenticated
Next.js BFF because this service does not receive user or canvas identity.

## Configuration

The image build downloads and checksum-verifies the complete canvas allowlist:
`u2net` (general), `isnet-general-use` (high-detail general),
`u2net_human_seg` (people), `isnet-anime` (anime/illustration), and `silueta`
(lightweight general). The weights stay in the immutable image at `/models`;
the standard Compose profiles deliberately do not mount a volume there because
an existing empty or `u2net`-only volume would hide the preloaded allowlist.
`DQ_REMBG_MODEL` defaults to `silueta` and selects the baseline model checked at
startup; a validated version 3 task selects its actual model independently.
Legacy version 1 and 2 snapshots continue with `u2net`.

The two 1024-input IS-Net models use the same single global inference slot.
BiRefNet, BRIA, SAM, cloth segmentation, and custom model sessions are not part
of the canvas allowlist: they require materially different memory, licensing,
prompt, multi-mask, or local-path contracts.
`DQ_REMBG_CONCURRENCY` defaults to `1` per sidecar instance and is hard-capped
at one. The application scheduler also enforces one global persisted slot.
The standard, local-build, external-database, and Baota Compose topologies give
the sidecar up to `2.0` CPUs and `5g` memory by default. `DQ_REMBG_CPUS` and
`DQ_REMBG_MEMORY_LIMIT` override both the regular Compose `cpus`/`mem_limit`
fields and the matching `deploy.resources.limits` fields, so `docker compose`
and Swarm-style deployments enforce the same ceiling. These values are limits,
not preallocated or guaranteed usage. `DQ_REMBG_OMP_NUM_THREADS` defaults to
`2`; Compose applies it to ONNX Runtime intra-op, OpenMP, OpenBLAS, and MKL,
allowing one inference process to use both assigned CPU cores. ONNX inter-op
threads are fixed at `1`.
`DQ_REMBG_ALPHA_MATTING_CONCURRENCY` defaults to `1` and cannot exceed one. Set
`DQ_REMBG_ALPHA_MATTING_TILE_PIXELS` to tune each full-resolution alpha tile;
the default is `1048576`. This is a per-tile memory budget, not a total input
limit. Higher values provide more surrounding context but consume more CPU and
memory per tile.
`DQ_REMBG_CANCEL_TOMBSTONE_SECONDS` defaults to `600` and is capped at one
hour; the sidecar keeps at most 4,096 cancellation tombstones. The BFF waits up
to `DQ_REMBG_CANCEL_TIMEOUT_MS` (15 seconds by default) for cleanup confirmation.
For a 4-core, 8 GiB host serving about 10 users, keep the sidecar at the default
2 CPUs, 5 GiB, and one global inference slot. All accepted tasks enter the
persisted FIFO queue; the per-user 30 requests/minute guard remains in place.
Set
`DQ_REMBG_INTERNAL_TOKEN` when the service is reached over a network that is
not a private Docker network; callers must send `Authorization: Bearer ...`.

The rembg software is MIT licensed. Model weights have separate terms and must
be checked against each selected model card before distribution or production
use.
