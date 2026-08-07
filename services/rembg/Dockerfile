FROM python:3.11-slim@sha256:94c50be2dc994b873b55bc123e95e6dbade08095b3dfd790f51c34de3f08cbb7

ARG DQ_REMBG_MODEL=silueta
ARG DQ_REMBG_MODELS=u2net,isnet-general-use,u2net_human_seg,isnet-anime,silueta

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    U2NET_HOME=/models \
    DQ_REMBG_MODEL=${DQ_REMBG_MODEL} \
    DQ_REMBG_PRELOADED_MODELS=${DQ_REMBG_MODELS} \
    DQ_REMBG_BIND_HOST=0.0.0.0 \
    DQ_REMBG_PORT=7000 \
    DQ_REMBG_CONCURRENCY=1 \
    DQ_REMBG_OMP_NUM_THREADS=2 \
    DQ_REMBG_ONNX_INTER_OP_THREADS=1 \
    OMP_NUM_THREADS=2 \
    OPENBLAS_NUM_THREADS=2 \
    MKL_NUM_THREADS=2 \
    DQ_REMBG_ALPHA_MATTING_CONCURRENCY=1 \
    DQ_REMBG_ALPHA_MATTING_TILE_PIXELS=1048576 \
    DQ_REMBG_TIMEOUT_SECONDS=120 \
    DQ_REMBG_QUEUE_TIMEOUT_SECONDS=30

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN python -m pip install --upgrade pip \
    && python -m pip install -r requirements.txt

# Download and checksum-verify every model exposed by the canvas selector.
# Calling download_models avoids constructing five ONNX sessions during the
# image build. Keep this layer independent from service code so code-only
# changes reuse the model layer.
RUN mkdir -p /models \
    && python -c "from rembg.sessions import sessions; names=tuple(filter(None, '${DQ_REMBG_MODELS}'.split(','))); unknown=[name for name in names if name not in sessions]; assert not unknown, f'Unsupported rembg models: {unknown}'; [sessions[name].download_models() for name in names]"

COPY app.py ./

RUN useradd --create-home --uid 10001 rembg \
    && chown -R rembg:rembg /app /models
USER rembg

EXPOSE 7000

HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=5 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.getenv('DQ_REMBG_PORT','7000')}/readyz\", timeout=3)"

CMD ["python", "app.py"]
