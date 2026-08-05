import asyncio
import io
import json
import threading
import unittest
from unittest.mock import ANY, MagicMock, patch

from fastapi import HTTPException
from PIL import Image

import app as service


def png(image: Image.Image) -> bytes:
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


class RemovalOptionsTests(unittest.TestCase):
    def test_resource_limits_and_default_model(self):
        self.assertEqual(service.MAX_INPUT_PIXELS, 64_000_000)
        self.assertEqual(service.MODEL_MAX_EDGE, 2048)
        self.assertEqual(service.MAX_CONCURRENCY, 1)
        self.assertEqual(service.ALPHA_MATTING_TILE_PIXELS, 1_048_576)
        self.assertEqual(service.DEFAULT_MODEL, "silueta")
        self.assertEqual(service.SUPPORTED_MODELS, {"u2net", "isnet-general-use", "u2net_human_seg", "isnet-anime", "silueta"})
        with patch.dict("os.environ", {"DQ_REMBG_CONCURRENCY": "2"}):
            with self.assertRaises(RuntimeError):
                service._positive_int("DQ_REMBG_CONCURRENCY", service.MAX_CONCURRENCY, service.MAX_CONCURRENCY)

    def test_onnx_threads_are_limited_to_two_intra_op_and_one_inter_op(self):
        session_options = MagicMock()
        with patch.object(service.ort, "SessionOptions", return_value=session_options), patch.object(
            service, "new_session", return_value="session"
        ) as new_session, patch.dict(
            "os.environ",
            {"DQ_REMBG_OMP_NUM_THREADS": "2", "DQ_REMBG_ONNX_INTER_OP_THREADS": "1"},
        ):
            self.assertEqual(service._load_session("silueta"), "session")

        self.assertFalse(session_options.enable_cpu_mem_arena)
        self.assertFalse(session_options.enable_mem_pattern)
        self.assertEqual(session_options.intra_op_num_threads, 2)
        self.assertEqual(session_options.inter_op_num_threads, 1)
        new_session.assert_called_once_with("silueta", sess_opts=session_options)

        for name, value, default, maximum in (
            ("DQ_REMBG_OMP_NUM_THREADS", "3", 2, 2),
            ("DQ_REMBG_ONNX_INTER_OP_THREADS", "2", 1, 1),
        ):
            with self.subTest(name=name), patch.dict("os.environ", {name: value}):
                with self.assertRaises(RuntimeError):
                    service._positive_int(name, default, maximum)

    def test_v1_options_remain_strictly_compatible(self):
        options = service._parse_removal_options(
            json.dumps(
                {
                    "version": 1,
                    "preset": "hair",
                    "foregroundThreshold": 245,
                    "backgroundThreshold": 8,
                    "refineRange": 18,
                    "cleanMask": True,
                    "outputMask": True,
                }
            )
        )
        self.assertEqual(options.version, 1)
        self.assertEqual(options.model, "u2net")
        self.assertTrue(options.alpha_matting)
        self.assertEqual(options.foreground_threshold, 245)
        self.assertEqual(options.background_threshold, 8)
        self.assertEqual(options.refine_range, 18)
        self.assertTrue(options.clean_mask)
        self.assertEqual(options.output_mode, "mask")

        transparent = service._parse_removal_options('{"version":1,"outputMask":false}')
        self.assertEqual(transparent.output_mode, "transparent")

    def test_v2_supports_transparent_mask_and_rgba_color_outputs(self):
        for mode in ("transparent", "mask"):
            with self.subTest(mode=mode):
                options = service._parse_removal_options(json.dumps({"version": 2, "outputMode": mode}))
                self.assertEqual(options.output_mode, mode)
        colored = service._parse_removal_options(
            json.dumps({"version": 2, "outputMode": "color", "backgroundColor": [12, 34, 56, 78]})
        )
        self.assertEqual(colored.background_color, (12, 34, 56, 78))
        self.assertEqual(colored.model, "u2net")

    def test_v3_selects_only_supported_models_and_official_fine_preset(self):
        for model in sorted(service.SUPPORTED_MODELS):
            with self.subTest(model=model):
                options = service._parse_removal_options(json.dumps({"version": 3, "model": model}))
                self.assertEqual(options.model, model)
        fine = service._parse_removal_options('{"version":3,"model":"u2net","preset":"official-fine"}')
        self.assertEqual((fine.alpha_matting, fine.foreground_threshold, fine.background_threshold, fine.refine_range, fine.clean_mask), (True, 240, 10, 40, True))
        boundary = service._parse_removal_options('{"version":3,"model":"u2net","preset":"custom","refineRange":255}')
        self.assertEqual(boundary.refine_range, 255)

    def test_omitted_version_uses_output_mask_only_for_v1_inference(self):
        legacy = service._parse_removal_options('{"outputMask":true}')
        modern = service._parse_removal_options(
            '{"outputMode":"color","backgroundColor":[1,2,3,4]}'
        )
        defaults = service._parse_removal_options(None)

        self.assertEqual((legacy.version, legacy.output_mode), (1, "mask"))
        self.assertEqual((modern.version, modern.output_mode), (3, "color"))
        self.assertEqual(defaults.version, 3)

    def test_invalid_or_cross_version_options_are_rejected(self):
        invalid_values = [
            '{"version":4}',
            '{"version":3,"model":"birefnet-general"}',
            '{"version":1,"outputMode":"mask"}',
            '{"version":2,"outputMask":true}',
            '{"version":2,"outputMode":"other"}',
            '{"version":2,"outputMode":"color","backgroundColor":[0,0,0]}',
            '{"version":2,"backgroundColor":[0,0,0,256]}',
            '{"alphaMatting":1}',
            '{"foregroundThreshold":10,"backgroundThreshold":10}',
            '{"refineRange":256}',
            '{"extra":true}',
        ]
        for raw in invalid_values:
            with self.subTest(raw=raw), self.assertRaises(HTTPException) as caught:
                service._parse_removal_options(raw)
            self.assertEqual(caught.exception.status_code, 400)

    def test_validation_accepts_an_image_at_the_pixel_limit(self):
        with patch.object(service.Image, "open") as open_image:
            image = MagicMock()
            image.size = (8_000, 8_000)
            image.format = "PNG"
            image.n_frames = 1
            image.getexif.return_value = {}
            open_image.return_value.__enter__.return_value = image
            self.assertEqual(service._validate_image(b"image", "image/png"), (8_000, 8_000, "PNG"))

    def test_validation_rejects_an_image_above_the_pixel_limit(self):
        with patch.object(service.Image, "open") as open_image:
            image = MagicMock()
            image.size = (8_001, 8_000)
            image.format = "PNG"
            image.n_frames = 1
            open_image.return_value.__enter__.return_value = image
            with self.assertRaises(HTTPException) as caught:
                service._validate_image(b"image", "image/png")
            self.assertEqual(caught.exception.status_code, 413)

    def test_validation_verifies_real_png_before_reading_exif(self):
        source = Image.new("RGB", (19, 11), "white")
        self.assertEqual(service._validate_image(png(source), "image/png"), (19, 11, "PNG"))

    def test_exif_orientation_reports_and_normalizes_display_dimensions(self):
        source = Image.new("RGB", (3, 2), "white")
        exif = Image.Exif()
        exif[274] = 6
        encoded = io.BytesIO()
        source.save(encoded, format="JPEG", exif=exif)
        data = encoded.getvalue()

        self.assertEqual(service._validate_image(data, "image/jpeg")[:2], (2, 3))
        with Image.open(io.BytesIO(service._normalize_for_model(data))) as normalized:
            self.assertEqual(normalized.size, (2, 3))

    def test_model_normalization_fits_large_landscape_and_portrait_inputs_inside_2k(self):
        for size, expected in (((2049, 1024), (2048, 1024)), ((1024, 2049), (1024, 2048))):
            with self.subTest(size=size):
                with Image.open(io.BytesIO(service._normalize_for_model(png(Image.new("RGB", size, "white"))))) as normalized:
                    self.assertEqual(normalized.size, expected)

    def test_model_dimensions_do_not_enlarge_small_inputs(self):
        self.assertEqual(service._model_dimensions(640, 480), (640, 480))


class ConservativeMaskCleanupTests(unittest.TestCase):
    def test_large_outer_background_and_enclosed_hole_are_removed(self):
        image = Image.new("RGB", (100, 100), "white")
        for y in range(20, 80):
            for x in range(20, 80):
                if x < 35 or x >= 65 or y < 35 or y >= 65:
                    image.putpixel((x, y), (0, 0, 0))
        mask = Image.new("L", image.size, 0)
        for y in range(20, 80):
            for x in range(20, 80):
                mask.putpixel((x, y), 64 if 35 <= x < 65 and 35 <= y < 65 else 255)
        mask.putpixel((50, 50), 0)

        cleaned = service._clean_background_mask(image, mask, 10)
        self.assertEqual(cleaned.getpixel((5, 5)), 0)
        self.assertEqual(cleaned.getpixel((50, 50)), 0)
        self.assertEqual(cleaned.getpixel((25, 50)), 255)

        # The same cleaned raw mask is intentionally used for transparent,
        # mask, and color outputs, independent of rembg's optional morphology.
        for mode, clean_mask in (("transparent", False), ("mask", False), ("color", True)):
            with self.subTest(mode=mode):
                options = service._parse_removal_options(
                    json.dumps({"version": 2, "outputMode": mode, "cleanMask": clean_mask})
                )
                session = MagicMock()
                session.predict.return_value = [mask]
                predicted = service._predict_clean_masks(image.convert("RGBA"), session)[0]
                self.assertEqual(predicted.getpixel((50, 50)), 0)

    def test_dark_hair_and_colored_translucency_are_preserved(self):
        image = Image.new("RGB", (100, 100), "white")
        mask = Image.new("L", image.size, 0)
        for y in range(10, 90):
            image.putpixel((50, y), (20, 20, 20))
            mask.putpixel((50, y), 52)
        for y in range(30, 70):
            for x in range(60, 90):
                image.putpixel((x, y), (100, 170, 220))
                mask.putpixel((x, y), 96)

        cleaned = service._clean_background_mask(image, mask, 10)
        self.assertEqual(cleaned.getpixel((50, 50)), 52)
        self.assertEqual(cleaned.getpixel((75, 50)), 96)

    def test_small_near_background_detail_is_not_over_cleaned(self):
        image = Image.new("RGB", (100, 100), "white")
        mask = Image.new("L", image.size, 0)
        for y in range(42, 51):
            for x in range(42, 51):
                image.putpixel((x, y), (0, 0, 0))
                mask.putpixel((x, y), 255)
        for y in range(45, 48):
            for x in range(45, 48):
                image.putpixel((x, y), (250, 250, 250))
                mask.putpixel((x, y), 64)
        cleaned = service._clean_background_mask(image, mask, 10)
        self.assertEqual(cleaned.getpixel((46, 46)), 64)


class RemovalPipelineTests(unittest.TestCase):
    def test_alpha_thresholds_do_not_change_standard_output(self):
        source = Image.new("RGB", (16, 16), (20, 30, 40))
        raw_mask = Image.new("L", source.size, 180)

        def run(raw_options):
            session = MagicMock()
            session.predict.return_value = [raw_mask]
            return service._remove_background(png(source), session, service._parse_removal_options(raw_options), 4096)

        baseline = run('{"version":2,"alphaMatting":false,"foregroundThreshold":240,"backgroundThreshold":10,"refineRange":10}')
        changed = run('{"version":2,"alphaMatting":false,"foregroundThreshold":200,"backgroundThreshold":120,"refineRange":80}')
        self.assertEqual(changed, baseline)

    def test_official_mask_path_predicts_once_and_reuses_static_session(self):
        image = Image.new("RGB", (32, 24), "white")
        raw_mask = Image.new("L", image.size, 255)
        session = MagicMock()
        session.predict.return_value = [raw_mask]
        options = service._parse_removal_options('{"version":2,"outputMode":"mask"}')

        def fake_remove(work_image, **kwargs):
            returned = kwargs["session"].predict(work_image)
            self.assertIsNot(kwargs["session"], session)
            self.assertFalse(kwargs["alpha_matting"])
            self.assertTrue(kwargs["only_mask"])
            return returned[0]

        with patch.object(service, "remove", side_effect=fake_remove) as official_remove:
            output = service._remove_background(png(image), session, options, 4096)

        session.predict.assert_called_once()
        official_remove.assert_called_once()
        with Image.open(io.BytesIO(output)) as result:
            self.assertEqual(result.mode, "L")
            self.assertEqual(result.size, image.size)

    def test_tiled_alpha_matting_stays_full_resolution_and_preserves_source_alpha(self):
        source = Image.new("RGBA", (180, 120), (11, 22, 33, 200))
        session = MagicMock()
        session.predict.return_value = [Image.new("L", source.size, 255)]
        options = service._parse_removal_options('{"version":1,"preset":"hair"}')
        tile_sizes = []

        def fake_remove(tile, **kwargs):
            self.assertTrue(kwargs["alpha_matting"])
            tile_sizes.append(tile.size)
            return Image.new("RGBA", tile.size, (99, 88, 77, 128))

        with patch.object(service, "remove", side_effect=fake_remove):
            output = service._remove_background(png(source), session, options, 4096)

        session.predict.assert_called_once()
        self.assertGreater(len(tile_sizes), 1)
        self.assertTrue(all(width * height <= 4096 for width, height in tile_sizes))
        with Image.open(io.BytesIO(output)) as result:
            result.load()
            self.assertEqual(result.size, source.size)
            self.assertTrue(all(alpha in (100, 101) for alpha in result.getchannel("A").getextrema()))

    def test_tiled_alpha_matting_discards_overlap_seams(self):
        source = Image.new("RGBA", (180, 120), (20, 30, 40, 255))
        masks = [Image.new("L", source.size, 255)]
        options = service._parse_removal_options('{"version":1,"preset":"hair"}')

        def fake_remove(tile, **_kwargs):
            result = Image.new("RGBA", tile.size, (20, 30, 40, 200))
            pixels = result.load()
            for x in range(tile.width):
                pixels[x, 0] = (255, 0, 0, 0)
                pixels[x, tile.height - 1] = (255, 0, 0, 0)
            for y in range(tile.height):
                pixels[0, y] = (255, 0, 0, 0)
                pixels[tile.width - 1, y] = (255, 0, 0, 0)
            return result

        with patch.object(service, "remove", side_effect=fake_remove):
            result = service._remove_with_tiled_alpha_matting(source, masks, options, 4096)
        # Internal crop borders live only in discarded overlap. Only the true
        # image perimeter may contain the synthetic red/transparent border.
        self.assertEqual(result.getpixel((64, 64)), (20, 30, 40, 200))
        self.assertEqual(result.getpixel((128, 64)), (20, 30, 40, 200))

    def test_clean_mask_is_post_processed_once_before_alpha_tiles(self):
        source = Image.new("RGB", (180, 120), (20, 30, 40))
        session = MagicMock()
        session.predict.return_value = [Image.new("L", source.size, 255)]
        options = service._parse_removal_options(
            '{"version":2,"preset":"hair","cleanMask":true}'
        )
        tile_calls = []

        def fake_remove(tile, **kwargs):
            tile_calls.append(kwargs)
            return Image.new("RGBA", tile.size, (20, 30, 40, 255))

        with patch.object(service, "post_process", wraps=service.post_process) as official_post_process, patch.object(
            service, "remove", side_effect=fake_remove
        ):
            service._remove_background(png(source), session, options, 4096)

        official_post_process.assert_called_once()
        self.assertEqual(official_post_process.call_args.args[0].shape, (120, 180))
        self.assertGreater(len(tile_calls), 1)
        self.assertTrue(all(call["post_process_mask"] is False for call in tile_calls))

    def test_standard_full_mask_preserves_existing_source_alpha_once(self):
        source = Image.new("RGBA", (4, 4), (10, 20, 30, 128))
        session = MagicMock()
        session.predict.return_value = [Image.new("L", source.size, 255)]
        output = service._remove_background(png(source), session, service._parse_removal_options(None), 4096)
        with Image.open(io.BytesIO(output)) as result:
            self.assertEqual(result.getpixel((0, 0))[3], 128)

    def test_color_output_composites_requested_rgba_background(self):
        source = Image.new("RGB", (4, 4), (200, 10, 10))
        session = MagicMock()
        session.predict.return_value = [Image.new("L", source.size, 0)]
        options = service._parse_removal_options(
            '{"version":2,"outputMode":"color","backgroundColor":[12,34,56,78]}'
        )
        with patch.object(service, "remove", return_value=Image.new("RGBA", source.size, 0)), patch.object(
            service, "apply_background_color", wraps=service.apply_background_color
        ) as official_bgcolor:
            output = service._remove_background(png(source), session, options, 4096)
        official_bgcolor.assert_called_once_with(ANY, (12, 34, 56, 78))
        with Image.open(io.BytesIO(output)) as result:
            self.assertEqual(result.getpixel((0, 0)), (12, 34, 56, 78))

    def test_alpha_tile_boxes_cover_the_image_without_total_pixel_cap(self):
        boxes = service._alpha_tile_boxes(4096, 4096, 1_048_576, 10)
        self.assertGreater(len(boxes), 1)
        cores = [core for _crop, core in boxes]
        self.assertEqual(cores[0][:2], (0, 0))
        self.assertEqual(max(core[2] for core in cores), 4096)
        self.assertEqual(max(core[3] for core in cores), 4096)
        self.assertTrue(all((crop[2] - crop[0]) * (crop[3] - crop[1]) <= 1_048_576 for crop, _core in boxes))


class ConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_inference_modes_share_the_single_global_slot(self):
        state = service.RuntimeState(
            model_name="silueta",
            concurrency=1,
            alpha_matting_concurrency=1,
            timeout_seconds=120,
            queue_timeout_seconds=2,
            internal_token="",
            gate=asyncio.Semaphore(1),
            alpha_matting_gate=asyncio.Semaphore(1),
        )
        alpha = service._parse_removal_options('{"version":1,"preset":"hair"}')
        standard = service._parse_removal_options(None)
        high_memory = service._parse_removal_options('{"version":3,"model":"isnet-general-use"}')
        ordinary = await service._acquire_inference_gates(state, standard)
        waiting_alpha = asyncio.create_task(service._acquire_inference_gates(state, alpha))
        await asyncio.sleep(0)
        self.assertFalse(waiting_alpha.done())
        ordinary[0].release()
        alpha_gates = await waiting_alpha
        self.assertEqual(len(alpha_gates), 2)

        waiting_high_memory = asyncio.create_task(service._acquire_inference_gates(state, high_memory))
        await asyncio.sleep(0)
        self.assertFalse(waiting_high_memory.done())
        for gate in reversed(alpha_gates):
            gate.release()
        high_memory_gates = await waiting_high_memory
        self.assertEqual(len(high_memory_gates), 2)
        for gate in reversed(high_memory_gates):
            gate.release()

    async def test_legacy_mask_pipeline_still_uses_the_single_global_slot(self):
        state = service.RuntimeState(
            model_name="u2net",
            concurrency=1,
            alpha_matting_concurrency=1,
            timeout_seconds=120,
            queue_timeout_seconds=1,
            internal_token="",
            gate=asyncio.Semaphore(1),
            alpha_matting_gate=asyncio.Semaphore(1),
        )
        mask = service._parse_removal_options('{"version":1,"preset":"hair","outputMask":true}')
        self.assertFalse(mask.uses_alpha_matting)
        acquired = await service._acquire_inference_gates(state, mask)
        self.assertEqual(len(acquired), 1)
        waiting_standard = asyncio.create_task(
            service._acquire_inference_gates(state, service._parse_removal_options(None))
        )
        await asyncio.sleep(0)
        self.assertFalse(waiting_standard.done())
        acquired[0].release()
        standard_gates = await waiting_standard
        standard_gates[0].release()

    async def test_http_route_rejects_non_transparent_outputs(self):
        state = service.RuntimeState(
            "silueta",
            1,
            1,
            120,
            1,
            "",
            model_ready=True,
            gate=asyncio.Semaphore(1),
            alpha_matting_gate=asyncio.Semaphore(1),
        )
        service.app.state.rembg = state

        for index, options in enumerate(
            (
                '{"version":2,"outputMode":"mask"}',
                '{"version":2,"outputMode":"color","backgroundColor":[0,0,0,255]}',
            )
        ):
            with self.subTest(options=options):
                request = service.Request(
                    {
                        "type": "http",
                        "app": service.app,
                        "headers": [
                            (service.TASK_ID_HEADER.encode(), f"non-transparent-{index}".encode()),
                            (service.OPTIONS_HEADER.encode(), options.encode()),
                        ],
                    }
                )
                with self.assertRaises(HTTPException) as caught:
                    await service.remove_background(request)
                self.assertEqual(caught.exception.status_code, 400)
                self.assertEqual(
                    caught.exception.detail,
                    "Background removal only supports transparent PNG output",
                )
                self.assertFalse(state.active_requests)

    async def test_cancelled_inference_waits_for_subprocess_cleanup(self):
        state = service.RuntimeState("u2net", 1, 1, 120, 1, "")
        entered = threading.Event()
        cleaned = threading.Event()

        def fake_runner(*args):
            cancel_event = args[-1]
            entered.set()
            cancel_event.wait(timeout=2)
            cleaned.set()
            raise service.InferenceCancelledError()

        with patch.object(service, "_run_inference_process", side_effect=fake_runner):
            task = asyncio.create_task(service._run_inference(b"image", state, service._parse_removal_options(None)))
            await asyncio.to_thread(entered.wait, 1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertTrue(cleaned.is_set())

    async def test_task_cancellation_waits_for_running_inference_cleanup(self):
        state = service.RuntimeState("u2net", 1, 1, 120, 1, "")
        entered = threading.Event()
        cleaned = threading.Event()

        def fake_runner(*args):
            cancel_event = args[-1]
            entered.set()
            cancel_event.wait(timeout=2)
            cleaned.set()
            raise service.InferenceCancelledError()

        async def run_registered_request():
            request_task = asyncio.current_task()
            self.assertIsNotNone(request_task)
            await service._register_active_request(state, "task-running", request_task)
            try:
                await service._run_inference(b"image", state, service._parse_removal_options(None))
            finally:
                await service._unregister_active_request(state, "task-running", request_task)

        with patch.object(service, "_run_inference_process", side_effect=fake_runner):
            task = asyncio.create_task(run_registered_request())
            await asyncio.to_thread(entered.wait, 1)
            self.assertTrue(await service._cancel_active_request(state, "task-running"))

        self.assertTrue(task.cancelled())
        self.assertTrue(cleaned.is_set())
        self.assertNotIn("task-running", state.active_requests)

    async def test_managed_route_cancellation_returns_conflict_without_leaking_request(self):
        state = service.RuntimeState(
            "u2net",
            1,
            1,
            120,
            1,
            "",
            model_ready=True,
            gate=asyncio.Semaphore(1),
            alpha_matting_gate=asyncio.Semaphore(1),
        )
        service.app.state.rembg = state
        entered = asyncio.Event()

        async def wait_for_cancellation(_request):
            entered.set()
            await asyncio.Event().wait()

        request = service.Request(
            {
                "type": "http",
                "app": service.app,
                "headers": [(service.TASK_ID_HEADER.encode(), b"task-route")],
            }
        )
        with patch.object(service, "_read_body", side_effect=wait_for_cancellation):
            task = asyncio.create_task(service.remove_background(request))
            await entered.wait()
            self.assertTrue(await service._cancel_active_request(state, "task-route"))
            response = await task

        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.body), {"detail": "Background removal task was cancelled"})
        self.assertFalse(task.cancelled())
        self.assertNotIn("task-route", state.active_requests)

    async def test_cancellation_tombstone_rejects_a_late_request(self):
        state = service.RuntimeState("u2net", 1, 1, 120, 1, "")
        self.assertFalse(await service._cancel_active_request(state, "task-before-start"))

        request_task = asyncio.current_task()
        self.assertIsNotNone(request_task)
        with self.assertRaises(HTTPException) as caught:
            await service._register_active_request(state, "task-before-start", request_task)

        self.assertEqual(caught.exception.status_code, 409)

    async def test_cancellation_is_idempotent_after_a_queued_request_stops(self):
        state = service.RuntimeState("u2net", 1, 1, 120, 1, "")
        queued = asyncio.Event()

        async def wait_in_queue():
            request_task = asyncio.current_task()
            self.assertIsNotNone(request_task)
            await service._register_active_request(state, "task-queued", request_task)
            try:
                queued.set()
                await asyncio.Event().wait()
            finally:
                await service._unregister_active_request(state, "task-queued", request_task)

        task = asyncio.create_task(wait_in_queue())
        await queued.wait()
        self.assertTrue(await service._cancel_active_request(state, "task-queued"))
        self.assertTrue(task.cancelled())
        self.assertFalse(await service._cancel_active_request(state, "task-queued"))

    async def test_cancel_endpoint_requires_internal_authentication(self):
        state = service.RuntimeState("u2net", 1, 1, 120, 1, "secret")
        service.app.state.rembg = state
        request = service.Request({"type": "http", "app": service.app, "headers": []})

        with self.assertRaises(HTTPException) as caught:
            await service.cancel_background_removal("task-auth", request)

        self.assertEqual(caught.exception.status_code, 401)


class ProcessIsolationTests(unittest.TestCase):
    def test_stop_process_terminates_then_kills_and_joins(self):
        process = MagicMock()
        process.is_alive.side_effect = [True, True, False]
        service._stop_process(process)
        process.terminate.assert_called_once_with()
        process.kill.assert_called_once_with()
        self.assertEqual(process.join.call_count, 3)

    def test_readiness_uses_a_short_lived_spawned_process(self):
        context = MagicMock()
        process = context.Process.return_value
        process.is_alive.return_value = False
        process.exitcode = 0
        with patch.object(service.multiprocessing, "get_context", return_value=context):
            service._check_model_process("u2net", 1)
        context.Process.assert_called_once_with(target=service._model_check_entry, args=("u2net", ANY), name="rembg-readiness")
        process.start.assert_called_once_with()
        process.join.assert_called()

    def test_process_runner_rejects_missing_output(self):
        context = MagicMock()
        process = context.Process.return_value
        process.is_alive.return_value = False
        process.exitcode = 0
        with patch.object(service.multiprocessing, "get_context", return_value=context):
            with self.assertRaisesRegex(RuntimeError, "produced no output"):
                service._run_inference_process(b"image", "u2net", service._parse_removal_options(None), 4096, 1)
        process.start.assert_called_once_with()

    def test_process_runner_timeout_reclaims_child(self):
        context = MagicMock()
        process = context.Process.return_value
        process.is_alive.side_effect = [True, True, False, False]
        process.exitcode = None
        with patch.object(service.multiprocessing, "get_context", return_value=context):
            with patch.object(service.time, "monotonic", side_effect=[0, 2]):
                with self.assertRaises(TimeoutError):
                    service._run_inference_process(b"image", "u2net", service._parse_removal_options(None), 4096, 1)
        process.terminate.assert_called_once_with()
        process.join.assert_called()


if __name__ == "__main__":
    unittest.main()
