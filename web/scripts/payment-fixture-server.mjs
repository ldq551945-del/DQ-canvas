import { createSign } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

export function createPaymentFixtureServer(options = {}) {
    const requests = [];
    const payplyOrders = new Map();
    const server = createServer(async (request, response) => {
        try {
            const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
            const body = await readRequestBody(request);
            requests.push({ method: request.method || "GET", path: url.pathname, headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : value || ""])), body });
            await handlePaymentRequest({ request, response, url, body, options, payplyOrders });
        } catch (error) {
            sendJson(response, 500, { error: { message: error instanceof Error ? error.message : "payment fixture failed" } });
        }
    });
    return { server, requests };
}

async function handlePaymentRequest({ request, response, url, body, options, payplyOrders }) {
    if (request.method === "GET" && url.pathname === "/health") return sendJson(response, 200, { ok: true });
    if (request.method === "GET" && url.pathname === "/payply/query") return handlePayplyQuery(response, url, payplyOrders);
    if (request.method === "GET" && url.pathname === "/payply/refund-query") return sendJson(response, 200, { data: { status: "success", refundId: url.searchParams.get("refundId") || "payply_refund_fixture" } });
    if (request.method !== "POST") return sendJson(response, 405, { error: { message: "method not allowed" } });
    if (url.pathname === "/stripe/v1/checkout/sessions") return sendJson(response, 200, { id: "cs_fixture", url: "https://checkout.fixture/stripe", expires_at: Math.floor(Date.now() / 1000) + 1800 });
    if (url.pathname === "/stripe/v1/refunds") return sendJson(response, 200, { id: "re_fixture", status: "succeeded" });
    if (url.pathname === "/wechat/v3/pay/transactions/native") return sendSignedWechat(response, 200, { code_url: "weixin://wxpay/bizpayurl?pr=fixture" }, options.wechatPlatformPrivateKey);
    if (url.pathname === "/wechat/v3/refund/domestic/refunds") return sendSignedWechat(response, 200, { refund_id: "wx_refund_fixture", status: "SUCCESS" }, options.wechatPlatformPrivateKey);
    if (url.pathname === "/payply/checkout") return handlePayplyCheckout(response, body, payplyOrders);
    if (url.pathname === "/payply/refund") return sendJson(response, 200, { data: { status: "success", refundId: "payply_refund_fixture" } });
    if (url.pathname === "/alipay/gateway.do") return handleAlipay(response, body, options.alipayPrivateKey);
    return sendJson(response, 404, { error: { message: `payment fixture route not found: ${url.pathname}` } });
}

function handlePayplyCheckout(response, body, payplyOrders) {
    const payload = parseObject(body.toString("utf8"));
    const orderId = String(payload.orderId || "");
    const orderNo = String(payload.orderNo || "");
    const snapshot = {
        orderId,
        orderNo,
        amountCents: Number(payload.amountCents),
        currency: String(payload.currency || "").toUpperCase(),
    };
    if (orderId) payplyOrders.set(`id:${orderId}`, snapshot);
    if (orderNo) payplyOrders.set(`no:${orderNo}`, snapshot);
    return sendJson(response, 200, { data: { paymentUrl: "https://checkout.fixture/payply", tradeId: "payply_trade_fixture", paymentId: "payply_payment_fixture" } });
}

function handlePayplyQuery(response, url, payplyOrders) {
    const orderId = url.searchParams.get("orderId") || "";
    const orderNo = url.searchParams.get("orderNo") || "";
    const snapshot = payplyOrders.get(`id:${orderId}`) || payplyOrders.get(`no:${orderNo}`);
    if (!snapshot || !Number.isFinite(snapshot.amountCents) || !snapshot.currency) return sendJson(response, 404, { error: { message: "PayPly fixture order not found" } });
    return sendJson(response, 200, {
        status: "succeeded",
        orderId: snapshot.orderId,
        orderNo: snapshot.orderNo,
        providerTradeId: url.searchParams.get("tradeId") || "payply_trade_fixture",
        providerPaymentId: url.searchParams.get("paymentId") || "payply_payment_fixture",
        amountCents: snapshot.amountCents,
        currency: snapshot.currency,
        paidAt: new Date().toISOString(),
    });
}

function handleAlipay(response, body, privateKey) {
    if (!privateKey) throw new Error("Alipay fixture private key is required");
    const params = new URLSearchParams(body.toString("utf8"));
    const bizContent = parseObject(params.get("biz_content"));
    if (params.get("method") === "alipay.trade.precreate") {
        const result = { code: "10000", msg: "Success", out_trade_no: bizContent.out_trade_no, trade_no: "alipay_trade_fixture", qr_code: "https://checkout.fixture/alipay-qr" };
        return sendSignedAlipay(response, "alipay_trade_precreate_response", result, privateKey);
    }
    if (params.get("method") === "alipay.trade.refund") {
        const result = { code: "10000", msg: "Success", out_trade_no: bizContent.out_trade_no, trade_no: bizContent.trade_no, out_request_no: bizContent.out_request_no };
        return sendSignedAlipay(response, "alipay_trade_refund_response", result, privateKey);
    }
    return sendJson(response, 400, { error: { message: "unsupported Alipay method" } });
}

function sendSignedAlipay(response, key, result, privateKey) {
    const sign = createSign("RSA-SHA256").update(JSON.stringify(result), "utf8").sign(privateKey, "base64");
    sendJson(response, 200, { [key]: result, sign });
}

function sendSignedWechat(response, status, value, privateKey) {
    if (!privateKey) throw new Error("WeChat platform fixture private key is required");
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = "wechat-fixture-response";
    const bytes = Buffer.from(JSON.stringify(value));
    const signature = createSign("RSA-SHA256")
        .update(`${timestamp}\n${nonce}\n${bytes.toString("utf8")}\n`, "utf8")
        .sign(privateKey, "base64");
    sendJsonBytes(response, status, bytes, {
        "wechatpay-timestamp": timestamp,
        "wechatpay-nonce": nonce,
        "wechatpay-signature": signature,
    });
}

async function readRequestBody(request) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    return Buffer.concat(chunks);
}

function parseObject(value) {
    try {
        const parsed = JSON.parse(value || "{}");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function sendJson(response, status, value) {
    const bytes = Buffer.from(JSON.stringify(value));
    sendJsonBytes(response, status, bytes);
}

function sendJsonBytes(response, status, bytes, headers = {}) {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": bytes.length, "cache-control": "no-store", ...headers });
    response.end(bytes);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
    const port = Number(process.env.DQ_PAYMENT_FIXTURE_PORT) || 4020;
    const host = process.env.DQ_PAYMENT_FIXTURE_HOST || "127.0.0.1";
    const fixture = createPaymentFixtureServer({
        alipayPrivateKey: process.env.DQ_PAYMENT_FIXTURE_ALIPAY_PRIVATE_KEY,
        wechatPlatformPrivateKey: process.env.DQ_PAYMENT_FIXTURE_WECHAT_PLATFORM_PRIVATE_KEY,
    });
    fixture.server.listen(port, host, () => console.log(`Payment fixture ready at http://${host}:${port}`));
}
