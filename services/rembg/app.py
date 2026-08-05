from __future__ import annotations

import asyncio
import io
import json
import logging
import math
import multiprocessing
import os
import secrets
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import AsyncIterator, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageChops, ImageOps, UnidentifiedImageError
from rembg import new_session, remove
from rembg.bg import apply_background_color, post_process
from scipy.ndimage import find_objects, label


LOGGER = logging.getLogger("dq-rembg")


class InferenceCancelledError(Exception):
    pass

# The wrapper performs its own pixel check before inference. Disable Pillow's
# lower default warning threshold so valid inputs up to the project limit are
# not rejected by a dependency-specific limit.
Image.MAX_IMAGE_PIXELS = None

# Keep these limits aligned with the canvas API. They are intentionally fixed
# here as a second boundary in front of Pillow and ONNX Runtime.
MAX_INPUT_BYTES = 30 * 1024 * 1024
MAX_INPUT_PIXELS = 64_000_000
MODEL_MAX_EDGE = 2048
# Alpha matting stays at source resolution, but each closed-form solve is kept
# near 1024 square and receives overlapping source/mask context.  This is a
# per-tile work budget, not a total-image limit.
ALPHA_MATTING_TILE_PIXELS = 1_048_576
# This gate is global to one sidecar process. Deployments with multiple
# replicas must account for the sum of their configured concurrency.
MAX_CONCURRENCY = 1
MAX_ALPHA_MATTING_CONCURRENCY = 1
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
DEFAULT_MODEL = "silueta"
LEGACY_MODEL = "u2net"
SUPPORTED_MODELS = {
    "isnet-general-use",
    "isnet-anime",
    "silueta",
    "u2net",
    "u2net_human_seg",
}
HIGH_MEMORY_MODELS = {"isnet-general-use", "isnet-anime"}

OPTIONS_HEADER = "x-dq-rembg-options"
TASK_ID_HEADER = "x-dq-rembg-task-id"
CANCELLATION_TOMBSTONE_SECONDS = 600
MAX_CANCELLATION_TOMBSTONES = 4096
COMMON_OPTION_KEYS = {
    "version",
    "preset",
    "alphaMatting",
    "foregroundThreshold",
    "backgroundThreshold",
    "refineRange",
    "cleanMask",
}
V1_OPTION_KEYS = COMMON_OPTION_KEYS | {
    "outputMask",
}
V2_OPTION_KEYS = COMMON_OPTION_KEYS | {"outputMode", "backgroundColor"}
V3_OPTION_KEYS = V2_OPTION_KEYS | {"model"}
PRESET_TUNING = {
    "standard": (False, 240, 10, 10, False),
    "official-fine": (True, 240, 10, 40, True),
    "hair": (True, 240, 10, 10, False),
    "hard-edge": (False, 240, 10, 10, True),
    "custom": (False, 240, 10, 10, False),
}


def _positive_int(name: str, default: int, maximum: Optional[int] = None) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as error:
        raise RuntimeError(f"{name} must be an integer") from error
    if value <= 0 or (maximum is not None and value > maximum):
        suffix = f" and <= {maximum}" if maximum is not None else ""
        raise RuntimeError(f"{name} must be > 0{suffix}")
    return value


def _configured_model() -> str:
    model = os.getenv("DQ_REMBG_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
    if model not in SUPPORTED_MODELS:
        choices = ", ".join(sorted(SUPPORTED_MODELS))
        raise RuntimeError(f"DQ_REMBG_MODEL must be one of: {choices}")
    return model


@dataclass(frozen=True)
class RemovalOptions:
    version: int
    model: str
    preset: str
    alpha_matting: bool
    foreground_threshold: int
    background_threshold: int
    refine_range: int
    clean_mask: bool
    output_mode: str
    background_color: tuple[int, int, int, int]

    @property
    def output_mask(self) -> bool:
        return self.output_mode == "mask"

    @property
    def uses_alpha_matting(self) -> bool:
        return self.alpha_matting and not self.output_mask


def _parse_removal_options(raw: Optional[str]) -> RemovalOptions:
    if not raw:
        payload: dict[str, object] = {}
    else:
        if len(raw) > 4096:
            raise HTTPException(status_code=400, detail="Background removal options are too large")
        try:
            decoded = json.loads(raw)
        except (json.JSONDecodeError, TypeError) as error:
            raise HTTPException(status_code=400, detail="Background removal options are invalid") from error
        if not isinstance(decoded, dict):
            raise HTTPException(status_code=400, detail="Background removal options must be an object")
        payload = decoded

    version = payload.get("version", 1 if "outputMask" in payload else 3)
    if type(version) is not int or version not in (1, 2, 3):
        raise HTTPException(status_code=400, detail="Background removal option version must be 1, 2, or 3")
    allowed_keys = V1_OPTION_KEYS if version == 1 else V2_OPTION_KEYS if version == 2 else V3_OPTION_KEYS
    unknown = sorted(set(payload) - allowed_keys)
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unsupported background removal option: {unknown[0]}")
    preset = payload.get("preset", "standard")
    if not isinstance(preset, str) or preset not in PRESET_TUNING:
        raise HTTPException(status_code=400, detail="Background removal preset is invalid")

    alpha_matting, foreground_threshold, background_threshold, refine_range, clean_mask = PRESET_TUNING[preset]
    alpha_matting = _option_bool(payload, "alphaMatting", alpha_matting)
    foreground_threshold = _option_int(payload, "foregroundThreshold", foreground_threshold, 0, 255)
    background_threshold = _option_int(payload, "backgroundThreshold", background_threshold, 0, 255)
    refine_range = _option_int(payload, "refineRange", refine_range, 0, 255)
    clean_mask = _option_bool(payload, "cleanMask", clean_mask)
    model = LEGACY_MODEL if version < 3 else payload.get("model", DEFAULT_MODEL)
    if not isinstance(model, str) or model not in SUPPORTED_MODELS:
        raise HTTPException(status_code=400, detail="Background removal model is invalid")
    if version == 1:
        output_mode = "mask" if _option_bool(payload, "outputMask", False) else "transparent"
        background_color = (255, 255, 255, 255)
    else:
        output_mode = payload.get("outputMode", "transparent")
        if not isinstance(output_mode, str) or output_mode not in {"transparent", "mask", "color"}:
            raise HTTPException(status_code=400, detail="outputMode must be transparent, mask, or color")
        background_color = _option_rgba(payload, "backgroundColor", (255, 255, 255, 255))
    if background_threshold >= foreground_threshold:
        raise HTTPException(status_code=400, detail="Background threshold must be lower than foreground threshold")
    return RemovalOptions(
        version=version,
        model=model,
        preset=preset,
        alpha_matting=alpha_matting,
        foreground_threshold=foreground_threshold,
        background_threshold=background_threshold,
        refine_range=refine_range,
        clean_mask=clean_mask,
        output_mode=output_mode,
        background_color=background_color,
    )


def _option_bool(payload: dict[str, object], key: str, default: bool) -> bool:
    value = payload.get(key, default)
    if type(value) is not bool:
        raise HTTPException(status_code=400, detail=f"{key} must be a boolean")
    return value


def _option_int(payload: dict[str, object], key: str, default: int, minimum: int, maximum: int) -> int:
    value = payload.get(key, default)
    if type(value) is not int or value < minimum or value > maximum:
        raise HTTPException(status_code=400, detail=f"{key} must be an integer from {minimum} to {maximum}")
    return value


def _option_rgba(payload: dict[str, object], key: str, default: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    value = payload.get(key)
    if value is None:
        return default
    if not isinstance(value, list) or len(value) != 4 or any(type(channel) is not int or channel < 0 or channel > 255 for channel in value):
        raise HTTPException(status_code=400, detail=f"{key} must be an RGBA array with four integers from 0 to 255")
    return value[0], value[1], value[2], value[3]


@dataclass
class RuntimeState:
    model_name: str
    concurrency: int
    alpha_matting_concurrency: int
    timeout_seconds: int
    queue_timeout_seconds: int
    internal_token: str
    alpha_matting_tile_pixels: int = ALPHA_MATTING_TILE_PIXELS
    model_ready: bool = False
    startup_error: str | None = None
    gate: asyncio.Semaphore | None = None
    alpha_matting_gate: asyncio.Semaphore | None = None
    cancellation_tombstone_seconds: int = CANCELLATION_TOMBSTONE_SECONDS
    active_requests: dict[str, asyncio.Task[object]] = field(default_factory=dict)
    cancelled_tasks: dict[str, float] = field(default_factory=dict)
    task_lock: asyncio.Lock | None = None


def _authorize_request(request: Request, state: RuntimeState) -> None:
    if not state.internal_token:
        return
    authorization = request.headers.get("authorization", "")
    scheme, separator, supplied = authorization.partition(" ")
    supplied = supplied.strip() if separator and scheme.lower() == "bearer" else ""
    if not secrets.compare_digest(supplied, state.internal_token):
        raise HTTPException(status_code=401, detail="Invalid rembg service token")


def _validated_task_id(value: Optional[str]) -> str:
    task_id = (value or "").strip()
    if not task_id or len(task_id) > 160 or any(ord(character) < 33 or ord(character) > 126 for character in task_id):
        raise HTTPException(status_code=400, detail="A valid background removal task id is required")
    return task_id


def _task_registry_lock(state: RuntimeState) -> asyncio.Lock:
    if state.task_lock is None:
        state.task_lock = asyncio.Lock()
    return state.task_lock


def _prune_cancellation_tombstones(state: RuntimeState, now: float) -> None:
    for task_id, expires_at in list(state.cancelled_tasks.items()):
        if expires_at <= now:
            state.cancelled_tasks.pop(task_id, None)
    overflow = len(state.cancelled_tasks) - MAX_CANCELLATION_TOMBSTONES + 1
    if overflow > 0:
        for task_id, _expires_at in sorted(state.cancelled_tasks.items(), key=lambda item: item[1])[:overflow]:
            state.cancelled_tasks.pop(task_id, None)


async def _register_active_request(state: RuntimeState, task_id: str, task: asyncio.Task[object]) -> None:
    async with _task_registry_lock(state):
        now = time.monotonic()
        _prune_cancellation_tombstones(state, now)
        if task_id in state.cancelled_tasks:
            raise HTTPException(status_code=409, detail="Background removal task was cancelled")
        existing = state.active_requests.get(task_id)
        if existing is not None and existing is not task and not existing.done():
            raise HTTPException(status_code=409, detail="Background removal task is already active")
        state.active_requests[task_id] = task


async def _unregister_active_request(state: RuntimeState, task_id: str, task: asyncio.Task[object]) -> None:
    async with _task_registry_lock(state):
        if state.active_requests.get(task_id) is task:
            state.active_requests.pop(task_id, None)


async def _cancel_active_request(state: RuntimeState, task_id: str) -> bool:
    async with _task_registry_lock(state):
        now = time.monotonic()
        _prune_cancellation_tombstones(state, now)
        state.cancelled_tasks[task_id] = now + state.cancellation_tombstone_seconds
        target = state.active_requests.get(task_id)
    if target is None or target.done():
        return False
    target.cancel()
    try:
        await target
    except asyncio.CancelledError:
        pass
    except Exception:
        # The request is terminated even if it was already unwinding through
        # an HTTP/provider error when cancellation arrived.
        pass
    return True


def _load_session(model_name: str):
    LOGGER.info("Loading rembg model: %s", model_name)
    # BiRefNet's default ONNX CPU arena can retain several gigabytes after a
    # single 1024x1024 inference. Disable the reusable arenas so repeated
    # requests do not turn the sidecar into an ever-growing process, while
    # keeping the configured thread count explicit for predictable memory use.
    session_options = ort.SessionOptions()
    session_options.enable_cpu_mem_arena = False
    session_options.enable_mem_pattern = False
    threads = _positive_int("DQ_REMBG_OMP_NUM_THREADS", 2, 2)
    session_options.intra_op_num_threads = threads
    session_options.inter_op_num_threads = _positive_int("DQ_REMBG_ONNX_INTER_OP_THREADS", 1, 1)
    return new_session(model_name, sess_opts=session_options)


def _validate_image(data: bytes, content_type: str) -> tuple[int, int, str]:
    if not data:
        raise HTTPException(status_code=400, detail="Image body is empty")
    if len(data) > MAX_INPUT_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the 30MB limit")

    normalized_type = content_type.split(";", 1)[0].strip().lower()
    if normalized_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=415, detail="Only JPEG, PNG, and WebP images are supported")

    try:
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
            image_format = (image.format or "").upper()
            frame_count = int(getattr(image, "n_frames", 1) or 1)
            if image_format not in ALLOWED_FORMATS:
                raise HTTPException(status_code=415, detail="Only JPEG, PNG, and WebP images are supported")
            if width <= 0 or height <= 0 or width * height > MAX_INPUT_PIXELS:
                raise HTTPException(status_code=413, detail=f"Image exceeds the {MAX_INPUT_PIXELS} pixel limit")
            if frame_count > 1:
                raise HTTPException(status_code=422, detail="Animated images are not supported")
            image.verify()

        # Pillow requires verify() to run immediately after Image.open().
        # Read EXIF from a fresh decoder so orientation handling cannot make a
        # valid PNG/JPEG fail verification with "verify must be called directly
        # after open".  The returned dimensions match ImageOps.exif_transpose
        # in _normalize_for_model and therefore the actual output dimensions.
        with Image.open(io.BytesIO(data)) as image:
            orientation = int(image.getexif().get(274, 1) or 1)
        if 5 <= orientation <= 8:
            width, height = height, width
        return width, height, image_format
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, RuntimeError, ValueError) as error:
        raise HTTPException(status_code=415, detail="The image could not be decoded") from error


def _model_dimensions(width: int, height: int) -> tuple[int, int]:
    scale = min(1.0, MODEL_MAX_EDGE / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale))


async def _read_body(request: Request) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            parsed_length = int(content_length)
            if parsed_length < 0:
                raise HTTPException(status_code=400, detail="Invalid content length")
            if parsed_length > MAX_INPUT_BYTES:
                raise HTTPException(status_code=413, detail="Image exceeds the 30MB limit")
        except ValueError as error:
            raise HTTPException(status_code=400, detail="Invalid content length") from error

    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_INPUT_BYTES:
            raise HTTPException(status_code=413, detail="Image exceeds the 30MB limit")
        chunks.append(chunk)
    return b"".join(chunks)


class _StaticMaskSession:
    """Feeds already-predicted masks through rembg's official cutout path."""

    def __init__(self, masks: list[Image.Image]):
        self.masks = masks

    def predict(self, _image: Image.Image, *_args: object, **_kwargs: object) -> list[Image.Image]:
        return [mask.copy() for mask in self.masks]


def _clean_background_mask(image: Image.Image, mask: Image.Image, seed_threshold: int = 10) -> Image.Image:
    """Remove only large, low-confidence regions matching the border background.

    Requiring both source-color agreement and overwhelming raw-mask background
    evidence protects hair and genuine translucent foreground from a global
    alpha cutoff. Enclosed holes are considered as well as the outer component.
    """
    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    mask_array = np.asarray(mask.convert("L"), dtype=np.uint8)
    if mask_array.shape != rgb.shape[:2]:
        mask_array = np.asarray(mask.convert("L").resize(image.size, Image.Resampling.LANCZOS), dtype=np.uint8)

    border = np.concatenate((rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]), axis=0)
    background = np.median(border, axis=0)
    color_distance = np.max(np.abs(rgb.astype(np.int16) - background.astype(np.int16)), axis=2)
    near_background = color_distance <= 12
    components, count = label(near_background)
    minimum_area = max(16, int(image.width * image.height * 0.001))
    cleaned = mask_array.copy()
    component_slices = find_objects(components)
    for component_id in range(1, count + 1):
        component_slice = component_slices[component_id - 1]
        if component_slice is None:
            continue
        local_labels = components[component_slice]
        selected = local_labels == component_id
        area = int(np.count_nonzero(selected))
        if area < minimum_area:
            continue
        values = mask_array[component_slice][selected]
        # A real foreground-colored translucent region can have a mid-range
        # mask. A background region must contain definite background seeds and
        # be dominated by scores below the foreground half-range.
        if not np.any(values < seed_threshold):
            continue
        if float(np.median(values)) >= 128 or float(np.mean(values < 128)) < 0.85:
            continue
        local_cleaned = cleaned[component_slice]
        local_cleaned[selected] = 0

    return Image.fromarray(cleaned, mode="L")


def _predict_clean_masks(image: Image.Image, session: object) -> list[Image.Image]:
    predicted = session.predict(image)
    if not isinstance(predicted, list) or not predicted or any(not isinstance(mask, Image.Image) for mask in predicted):
        raise RuntimeError("rembg session returned invalid masks")
    # The conservative residual cleanup is independent of rembg's Alpha
    # Matting thresholds. Those official knobs must remain no-ops when Alpha
    # Matting is disabled.
    return [_clean_background_mask(image, mask) for mask in predicted]


def _post_process_masks(masks: list[Image.Image]) -> list[Image.Image]:
    """Apply rembg's official mask cleanup once at full-image resolution."""
    return [Image.fromarray(post_process(np.asarray(mask.convert("L")))) for mask in masks]


def _encode_png(image: Image.Image) -> bytes:
    encoded = io.BytesIO()
    image.save(encoded, format="PNG", optimize=False)
    return encoded.getvalue()


def _apply_output_mode(image: Image.Image, options: RemovalOptions) -> Image.Image:
    if options.output_mode != "color":
        return image
    return apply_background_color(image.convert("RGBA"), options.background_color)


def _remove_background(data: bytes, session: object, options: RemovalOptions, alpha_matting_tile_pixels: int) -> bytes:
    # Normalize the decoded image before inference. Some CPU model/runtime
    # combinations are unstable with progressive JPEG input even when Pillow
    # can decode it successfully; PNG keeps the pixel data and mode explicit.
    normalized = _normalize_for_model(data)
    with Image.open(io.BytesIO(normalized)) as source:
        source.load()
        original = source.convert("RGBA")
    masks = _predict_clean_masks(original, session)
    if options.clean_mask:
        # rembg normally post-processes each predicted full-size mask before
        # cutout. Do that here before alpha tiles are cropped so morphology can
        # never create tile-boundary differences.
        masks = _post_process_masks(masks)
    static_session = _StaticMaskSession(masks)

    if options.uses_alpha_matting:
        output_image = _remove_with_tiled_alpha_matting(original, masks, options, alpha_matting_tile_pixels)
        # rembg's alpha-matting helper converts RGBA input to RGB, so restore
        # source transparency exactly once after stitching the matte tiles.
        output_image.putalpha(ImageChops.multiply(original.getchannel("A"), output_image.getchannel("A")))
    else:
        output_image = remove(
            original,
            session=static_session,
            alpha_matting=False,
            post_process_mask=False,
            only_mask=options.output_mask,
            force_return_bytes=False,
        )
        if not isinstance(output_image, Image.Image):
            raise RuntimeError("rembg returned a non-image response")

    if options.output_mask:
        return _encode_png(output_image.convert("L"))
    output_image = output_image.convert("RGBA")
    return _encode_png(_apply_output_mode(output_image, options))


def _alpha_tile_boxes(width: int, height: int, tile_pixels: int, refine_range: int) -> list[tuple[tuple[int, int, int, int], tuple[int, int, int, int]]]:
    tile_side = max(32, int(math.sqrt(tile_pixels)))
    overlap = min(tile_side // 4, max(16, refine_range * 2))
    core_side = max(1, tile_side - overlap * 2)
    boxes: list[tuple[tuple[int, int, int, int], tuple[int, int, int, int]]] = []
    for top in range(0, height, core_side):
        bottom = min(height, top + core_side)
        for left in range(0, width, core_side):
            right = min(width, left + core_side)
            crop = (max(0, left - overlap), max(0, top - overlap), min(width, right + overlap), min(height, bottom + overlap))
            core = (left, top, right, bottom)
            boxes.append((crop, core))
    return boxes


def _remove_with_tiled_alpha_matting(
    original: Image.Image,
    masks: list[Image.Image],
    options: RemovalOptions,
    tile_pixels: int,
) -> Image.Image:
    output = Image.new("RGBA", original.size, 0)
    for crop_box, core_box in _alpha_tile_boxes(original.width, original.height, tile_pixels, options.refine_range):
        tile = original.crop(crop_box)
        tile_masks = [mask.crop(crop_box) for mask in masks]
        tile_output = remove(
            tile,
            session=_StaticMaskSession(tile_masks),
            alpha_matting=True,
            alpha_matting_foreground_threshold=options.foreground_threshold,
            alpha_matting_background_threshold=options.background_threshold,
            alpha_matting_erode_size=options.refine_range,
            post_process_mask=False,
            only_mask=False,
            force_return_bytes=False,
        )
        if not isinstance(tile_output, Image.Image) or tile_output.size != tile.size:
            raise RuntimeError("rembg returned an invalid alpha-matting tile")
        local_core = (
            core_box[0] - crop_box[0],
            core_box[1] - crop_box[1],
            core_box[2] - crop_box[0],
            core_box[3] - crop_box[1],
        )
        output.paste(tile_output.convert("RGBA").crop(local_core), (core_box[0], core_box[1]))
    return output


def _normalize_for_model(data: bytes) -> bytes:
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        image = ImageOps.exif_transpose(image)
        has_alpha = "A" in image.getbands() or "transparency" in image.info
        normalized = image.convert("RGBA" if has_alpha else "RGB")
        normalized.thumbnail((MODEL_MAX_EDGE, MODEL_MAX_EDGE), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        normalized.save(output, format="PNG", optimize=False)
        return output.getvalue()


def _inference_process_entry(
    input_path: str,
    output_path: str,
    error_path: str,
    model_name: str,
    options: RemovalOptions,
    alpha_matting_tile_pixels: int,
) -> None:
    try:
        with open(input_path, "rb") as input_file:
            data = input_file.read()
        session = _load_session(model_name)
        output = _remove_background(data, session, options, alpha_matting_tile_pixels)
        with open(output_path, "wb") as output_file:
            output_file.write(output)
    except BaseException as error:
        try:
            with open(error_path, "w", encoding="utf-8") as error_file:
                error_file.write(f"{type(error).__name__}: {error}")
        finally:
            raise


def _stop_process(process: multiprocessing.Process) -> None:
    if process.is_alive():
        process.terminate()
        process.join(timeout=2)
    if process.is_alive():
        process.kill()
        process.join(timeout=2)
    if not process.is_alive():
        process.join(timeout=0)


def _model_check_entry(model_name: str, error_path: str) -> None:
    try:
        _load_session(model_name)
    except BaseException as error:
        with open(error_path, "w", encoding="utf-8") as error_file:
            error_file.write(f"{type(error).__name__}: {error}")
        raise


def _check_model_process(model_name: str, timeout_seconds: int) -> None:
    context = multiprocessing.get_context("spawn")
    with tempfile.TemporaryDirectory(prefix="dq-rembg-ready-") as directory:
        error_path = os.path.join(directory, "error.txt")
        process = context.Process(target=_model_check_entry, args=(model_name, error_path), name="rembg-readiness")
        process.start()
        process.join(timeout=timeout_seconds)
        try:
            if process.is_alive():
                raise TimeoutError("Background removal model readiness timed out")
            if process.exitcode != 0:
                detail = ""
                if os.path.exists(error_path):
                    with open(error_path, "r", encoding="utf-8") as error_file:
                        detail = error_file.read(2048).strip()
                raise RuntimeError(detail or f"Model readiness subprocess exited with code {process.exitcode}")
        finally:
            _stop_process(process)


def _run_inference_process(
    data: bytes,
    model_name: str,
    options: RemovalOptions,
    alpha_matting_tile_pixels: int,
    timeout_seconds: int,
    cancel_event: threading.Event | None = None,
) -> bytes:
    context = multiprocessing.get_context("spawn")
    process: multiprocessing.Process | None = None
    with tempfile.TemporaryDirectory(prefix="dq-rembg-") as directory:
        input_path = os.path.join(directory, "input")
        output_path = os.path.join(directory, "output.png")
        error_path = os.path.join(directory, "error.txt")
        with open(input_path, "wb") as input_file:
            input_file.write(data)

        process = context.Process(
            target=_inference_process_entry,
            args=(input_path, output_path, error_path, model_name, options, alpha_matting_tile_pixels),
            name="rembg-inference",
        )
        process.start()
        deadline = time.monotonic() + timeout_seconds
        try:
            while process.is_alive():
                if cancel_event is not None and cancel_event.is_set():
                    raise InferenceCancelledError("Background removal was cancelled")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("Background removal timed out")
                process.join(timeout=min(0.1, remaining))

            exitcode = process.exitcode
            error_detail = ""
            if os.path.exists(error_path):
                with open(error_path, "r", encoding="utf-8") as error_file:
                    error_detail = error_file.read(2048).strip()
            if exitcode != 0:
                raise RuntimeError(error_detail or f"Background removal subprocess exited with code {exitcode}")
            if error_detail:
                raise RuntimeError(error_detail)
            if not os.path.isfile(output_path):
                raise RuntimeError("Background removal subprocess produced no output")
            output_size = os.path.getsize(output_path)
            if output_size <= 8 or output_size > MAX_INPUT_BYTES:
                raise RuntimeError("Background removal subprocess produced an invalid output size")
            with open(output_path, "rb") as output_file:
                output = output_file.read()
            if not output.startswith(b"\x89PNG\r\n\x1a\n"):
                raise RuntimeError("Background removal subprocess produced a non-PNG output")
            return output
        finally:
            _stop_process(process)


async def _run_inference(
    data: bytes,
    state: RuntimeState,
    options: RemovalOptions,
) -> bytes:
    # The subprocess runner blocks only an asyncio helper thread.  The actual
    # ONNX/PyMatting work lives in a spawned child that can be terminated.
    cancel_event = threading.Event()
    task = asyncio.create_task(
        asyncio.to_thread(
            _run_inference_process,
            data,
            options.model,
            options,
            state.alpha_matting_tile_pixels,
            state.timeout_seconds,
            cancel_event,
        )
    )
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        cancel_event.set()
        # Do not release a concurrency permit until the helper thread has
        # terminated and joined the child process.
        try:
            await asyncio.shield(task)
        except InferenceCancelledError:
            pass
        raise


async def _acquire_inference_gates(state: RuntimeState, options: RemovalOptions) -> tuple[asyncio.Semaphore, ...]:
    if state.gate is None or state.alpha_matting_gate is None:
        raise HTTPException(status_code=503, detail="Background removal model is not ready")
    loop = asyncio.get_running_loop()
    deadline = loop.time() + state.queue_timeout_seconds
    acquired: tuple[asyncio.Semaphore, ...] = ()
    try:
        exclusive = options.uses_alpha_matting or options.model in HIGH_MEMORY_MODELS
        if exclusive:
            await asyncio.wait_for(state.alpha_matting_gate.acquire(), timeout=max(0.001, deadline - loop.time()))
            acquired += (state.alpha_matting_gate,)
        permits = state.concurrency if exclusive else 1
        for _ in range(permits):
            await asyncio.wait_for(state.gate.acquire(), timeout=max(0.001, deadline - loop.time()))
            acquired += (state.gate,)
        return acquired
    except TimeoutError as error:
        for gate in reversed(acquired):
            gate.release()
        raise HTTPException(status_code=503, detail="Background removal queue is full") from error
    except BaseException:
        for gate in reversed(acquired):
            gate.release()
        raise


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    model_name = _configured_model()
    concurrency = _positive_int("DQ_REMBG_CONCURRENCY", MAX_CONCURRENCY, MAX_CONCURRENCY)
    alpha_matting_concurrency = _positive_int("DQ_REMBG_ALPHA_MATTING_CONCURRENCY", MAX_ALPHA_MATTING_CONCURRENCY, MAX_ALPHA_MATTING_CONCURRENCY)
    timeout_seconds = _positive_int("DQ_REMBG_TIMEOUT_SECONDS", 120)
    queue_timeout_seconds = _positive_int("DQ_REMBG_QUEUE_TIMEOUT_SECONDS", 30)
    cancellation_tombstone_seconds = _positive_int("DQ_REMBG_CANCEL_TOMBSTONE_SECONDS", CANCELLATION_TOMBSTONE_SECONDS, 3600)
    alpha_matting_tile_pixels = _positive_int("DQ_REMBG_ALPHA_MATTING_TILE_PIXELS", ALPHA_MATTING_TILE_PIXELS)
    state = RuntimeState(
        model_name=model_name,
        concurrency=concurrency,
        alpha_matting_concurrency=alpha_matting_concurrency,
        timeout_seconds=timeout_seconds,
        queue_timeout_seconds=queue_timeout_seconds,
        internal_token=os.getenv("DQ_REMBG_INTERNAL_TOKEN", "").strip(),
        alpha_matting_tile_pixels=alpha_matting_tile_pixels,
        gate=asyncio.Semaphore(concurrency),
        alpha_matting_gate=asyncio.Semaphore(alpha_matting_concurrency),
        cancellation_tombstone_seconds=cancellation_tombstone_seconds,
        task_lock=asyncio.Lock(),
    )
    app.state.rembg = state

    try:
        # Validate model availability in a short-lived child. The API parent
        # never retains an ONNX session; each request owns a reclaimable child.
        await asyncio.to_thread(_check_model_process, model_name, timeout_seconds)
        state.model_ready = True
    except Exception as error:  # Keep /readyz reachable so orchestration can report the cause.
        state.startup_error = str(error)
        LOGGER.exception("Failed to load rembg model %s", model_name)

    yield


app = FastAPI(
    title="DQ Background Removal",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


@app.get("/livez")
async def livez() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/readyz")
async def readyz(request: Request):
    state: RuntimeState = request.app.state.rembg
    if not state.model_ready:
        return JSONResponse(
            status_code=503,
            content={"ready": False, "model": state.model_name, "error": state.startup_error or "model_loading"},
            headers={"cache-control": "no-store"},
        )
    return JSONResponse(
        content={
            "ready": True,
            "model": state.model_name,
            "supportedModels": sorted(SUPPORTED_MODELS),
            "concurrency": state.concurrency,
            "alphaMattingConcurrency": state.alpha_matting_concurrency,
            "alphaMattingTilePixels": state.alpha_matting_tile_pixels,
        },
        headers={"cache-control": "no-store"},
    )


@app.post("/v1/remove")
async def remove_background(request: Request):
    state: RuntimeState = request.app.state.rembg
    if not state.model_ready or state.gate is None or state.alpha_matting_gate is None:
        raise HTTPException(status_code=503, detail="Background removal model is not ready")
    _authorize_request(request, state)
    task_id = _validated_task_id(request.headers.get(TASK_ID_HEADER))
    request_task = asyncio.current_task()
    if request_task is None:
        raise HTTPException(status_code=503, detail="Background removal request is unavailable")
    await _register_active_request(state, task_id, request_task)
    try:
        options = _parse_removal_options(request.headers.get(OPTIONS_HEADER))
        if options.output_mode != "transparent":
            raise HTTPException(status_code=400, detail="Background removal only supports transparent PNG output")
        data = await _read_body(request)
        width, height, _ = _validate_image(data, request.headers.get("content-type", ""))
        width, height = _model_dimensions(width, height)
        acquired_gates = await _acquire_inference_gates(state, options)
        try:
            try:
                output = await _run_inference(data, state, options)
            except TimeoutError as error:
                raise HTTPException(status_code=504, detail="Background removal timed out") from error
        except HTTPException:
            raise
        except MemoryError as error:
            raise HTTPException(status_code=503, detail="Background removal ran out of memory") from error
        except Exception as error:
            LOGGER.exception("Background removal inference failed")
            raise HTTPException(status_code=502, detail="Background removal failed") from error
        finally:
            for gate in reversed(acquired_gates):
                gate.release()

        if not output.startswith(b"\x89PNG\r\n\x1a\n"):
            raise HTTPException(status_code=502, detail="Background removal returned an invalid image")
        if len(output) > MAX_INPUT_BYTES:
            raise HTTPException(status_code=502, detail="Background removal output exceeds the 30MB limit")

        # Keep dimensions in headers so the BFF can avoid decoding the response just
        # to size a canvas node. The body remains the authoritative PNG asset.
        return Response(
            content=output,
            media_type="image/png",
            headers={
                "cache-control": "no-store",
                "x-rembg-model": options.model,
                "x-rembg-input-width": str(width),
                "x-rembg-input-height": str(height),
                "x-rembg-output-mode": options.output_mode,
            },
        )
    except asyncio.CancelledError:
        # A DELETE request deliberately cancels this ASGI task after first
        # recording a tombstone. Convert only that managed cancellation into
        # an HTTP response; shutdown and transport cancellations must still
        # propagate to the server.
        if task_id not in state.cancelled_tasks:
            raise
        return JSONResponse(
            status_code=409,
            content={"detail": "Background removal task was cancelled"},
            headers={"cache-control": "no-store"},
        )
    finally:
        await _unregister_active_request(state, task_id, request_task)


@app.delete("/v1/tasks/{task_id}")
async def cancel_background_removal(task_id: str, request: Request):
    state: RuntimeState = request.app.state.rembg
    _authorize_request(request, state)
    normalized_task_id = _validated_task_id(task_id)
    was_active = await _cancel_active_request(state, normalized_task_id)
    return JSONResponse(
        content={"cancelled": True, "terminated": True, "wasActive": was_active},
        headers={"cache-control": "no-store"},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.getenv("DQ_REMBG_BIND_HOST", "0.0.0.0"),
        port=_positive_int("DQ_REMBG_PORT", 7000),
        workers=1,
        log_level=os.getenv("DQ_REMBG_LOG_LEVEL", "info"),
    )
