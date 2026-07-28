"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "antd";

import { listBillingCoupons, listBillingOrders, listBillingProducts, type BillingOrder, type BillingProduct, type CouponTemplate, type UserCoupon } from "@/services/api/billing";
import { listPointRecords, type PointRecord } from "@/services/api/points";
import { useUserStore, type LocalUser } from "@/stores/use-user-store";

import { ORDER_PAGE_SIZE, RECORD_PAGE_SIZE, type ProfileSectionKey } from "./profile-elements";

export function useProfileData(activeSection: ProfileSectionKey) {
    const { message } = App.useApp();
    const setUser = useUserStore((state) => state.setUser);
    const [products, setProducts] = useState<BillingProduct[]>([]);
    const [productsLoaded, setProductsLoaded] = useState(false);
    const [productsLoading, setProductsLoading] = useState(false);
    const [coupons, setCoupons] = useState<UserCoupon[]>([]);
    const [couponTemplates, setCouponTemplates] = useState<CouponTemplate[]>([]);
    const [couponsTotal, setCouponsTotal] = useState(0);
    const [couponsLoaded, setCouponsLoaded] = useState(false);
    const [couponsLoading, setCouponsLoading] = useState(false);
    const [orders, setOrders] = useState<BillingOrder[]>([]);
    const [ordersTotal, setOrdersTotal] = useState(0);
    const [ordersPage, setOrdersPage] = useState(1);
    const [ordersLoadedPage, setOrdersLoadedPage] = useState<number | null>(null);
    const [ordersLoading, setOrdersLoading] = useState(false);
    const [pointRecords, setPointRecords] = useState<PointRecord[]>([]);
    const [pointRecordsTotal, setPointRecordsTotal] = useState(0);
    const [pointRecordsPage, setPointRecordsPage] = useState(1);
    const [pointRecordsLoadedPage, setPointRecordsLoadedPage] = useState<number | null>(null);
    const [pointRecordsLoading, setPointRecordsLoading] = useState(false);
    const [consumeRecords, setConsumeRecords] = useState<PointRecord[]>([]);
    const [consumeRecordsTotal, setConsumeRecordsTotal] = useState(0);
    const [consumeRecordsPage, setConsumeRecordsPage] = useState(1);
    const [consumeRecordsLoadedPage, setConsumeRecordsLoadedPage] = useState<number | null>(null);
    const [consumeRecordsLoading, setConsumeRecordsLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const productsRequest = useRef(false);
    const couponsRequest = useRef(false);
    const ordersRequestPage = useRef<number | null>(null);
    const pointsRequestPage = useRef<number | null>(null);
    const consumptionRequestPage = useRef<number | null>(null);

    const loadProducts = useCallback(async () => {
        if (productsRequest.current) return;
        productsRequest.current = true;
        setProductsLoading(true);
        try {
            const payload = await listBillingProducts();
            setProducts(payload.products || []);
            setProductsLoaded(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "充值套餐加载失败");
        } finally {
            productsRequest.current = false;
            setProductsLoading(false);
        }
    }, [message]);

    const loadOrders = useCallback(
        async (page: number) => {
            if (ordersRequestPage.current !== null) return;
            ordersRequestPage.current = page;
            setOrdersLoading(true);
            try {
                const payload = await listBillingOrders({ page, pageSize: ORDER_PAGE_SIZE });
                setOrders(payload.orders || []);
                setOrdersTotal(payload.total || 0);
                setOrdersLoadedPage(page);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "订单记录加载失败");
            } finally {
                if (ordersRequestPage.current === page) ordersRequestPage.current = null;
                setOrdersLoading(false);
            }
        },
        [message],
    );

    const loadCoupons = useCallback(async () => {
        if (couponsRequest.current) return;
        couponsRequest.current = true;
        setCouponsLoading(true);
        try {
            const payload = await listBillingCoupons({ page: 1, pageSize: 100 });
            setCoupons(payload.coupons || []);
            setCouponTemplates(payload.templates || []);
            setCouponsTotal(payload.total || 0);
            setCouponsLoaded(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "优惠券加载失败");
        } finally {
            couponsRequest.current = false;
            setCouponsLoading(false);
        }
    }, [message]);

    const loadPointRecords = useCallback(
        async (page: number) => {
            if (pointsRequestPage.current !== null) return;
            pointsRequestPage.current = page;
            setPointRecordsLoading(true);
            try {
                const payload = await listPointRecords({ page, pageSize: RECORD_PAGE_SIZE });
                setPointRecords(payload.records);
                setPointRecordsTotal(payload.total);
                setPointRecordsLoadedPage(page);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "积分记录加载失败");
            } finally {
                if (pointsRequestPage.current === page) pointsRequestPage.current = null;
                setPointRecordsLoading(false);
            }
        },
        [message],
    );

    const loadConsumeRecords = useCallback(
        async (page: number) => {
            if (consumptionRequestPage.current !== null) return;
            consumptionRequestPage.current = page;
            setConsumeRecordsLoading(true);
            try {
                const payload = await listPointRecords({ page, pageSize: RECORD_PAGE_SIZE, direction: "debit" });
                setConsumeRecords(payload.records);
                setConsumeRecordsTotal(payload.total);
                setConsumeRecordsLoadedPage(page);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "消费记录加载失败");
            } finally {
                if (consumptionRequestPage.current === page) consumptionRequestPage.current = null;
                setConsumeRecordsLoading(false);
            }
        },
        [message],
    );

    const needsOrders = activeSection === "overview" || activeSection === "orders";
    const ordersTargetPage = activeSection === "overview" ? 1 : ordersPage;
    const needsPoints = activeSection === "overview" || activeSection === "points";
    const pointsTargetPage = activeSection === "overview" ? 1 : pointRecordsPage;

    useEffect(() => {
        if (activeSection === "billing" && !productsLoaded) void loadProducts();
    }, [activeSection, loadProducts, productsLoaded]);

    useEffect(() => {
        if (activeSection === "coupons" && !couponsLoaded) void loadCoupons();
    }, [activeSection, couponsLoaded, loadCoupons]);

    useEffect(() => {
        if (needsOrders && ordersLoadedPage !== ordersTargetPage) void loadOrders(ordersTargetPage);
    }, [loadOrders, needsOrders, ordersLoadedPage, ordersTargetPage]);

    useEffect(() => {
        if (needsPoints && pointRecordsLoadedPage !== pointsTargetPage) void loadPointRecords(pointsTargetPage);
    }, [loadPointRecords, needsPoints, pointRecordsLoadedPage, pointsTargetPage]);

    useEffect(() => {
        if (activeSection === "consume" && consumeRecordsLoadedPage !== consumeRecordsPage) void loadConsumeRecords(consumeRecordsPage);
    }, [activeSection, consumeRecordsLoadedPage, consumeRecordsPage, loadConsumeRecords]);

    const refreshUser = useCallback(async () => {
        try {
            const response = await fetch("/api/auth/session", { cache: "no-store" });
            const payload = (await response.json()) as { user?: LocalUser | null };
            if (payload.user) setUser(payload.user);
        } catch {
            // The visible section refresh remains useful if the session refresh is temporarily unavailable.
        }
    }, [setUser]);

    const refresh = useCallback(async () => {
        setRefreshing(true);
        try {
            const requests: Promise<void>[] = [refreshUser()];
            if (activeSection === "overview") requests.push(loadOrders(1), loadPointRecords(1));
            else if (activeSection === "billing") requests.push(loadProducts());
            else if (activeSection === "coupons") requests.push(loadCoupons());
            else if (activeSection === "orders") requests.push(loadOrders(ordersPage));
            else if (activeSection === "consume") requests.push(loadConsumeRecords(consumeRecordsPage));
            else if (activeSection === "points") requests.push(loadPointRecords(pointRecordsPage));
            await Promise.all(requests);
        } finally {
            setRefreshing(false);
        }
    }, [activeSection, consumeRecordsPage, loadConsumeRecords, loadCoupons, loadOrders, loadPointRecords, loadProducts, ordersPage, pointRecordsPage, refreshUser]);

    return {
        products: { items: products, loading: productsLoading || (activeSection === "billing" && !productsLoaded), refresh: loadProducts },
        coupons: { items: coupons, templates: couponTemplates, total: couponsTotal, loading: couponsLoading || (activeSection === "coupons" && !couponsLoaded), refresh: loadCoupons },
        orders: { items: orders, total: ordersTotal, page: ordersPage, setPage: setOrdersPage, loading: ordersLoading || (needsOrders && ordersLoadedPage !== ordersTargetPage) },
        points: { items: pointRecords, total: pointRecordsTotal, page: pointRecordsPage, setPage: setPointRecordsPage, loading: pointRecordsLoading || (needsPoints && pointRecordsLoadedPage !== pointsTargetPage) },
        consumption: {
            items: consumeRecords,
            total: consumeRecordsTotal,
            page: consumeRecordsPage,
            setPage: setConsumeRecordsPage,
            loading: consumeRecordsLoading || (activeSection === "consume" && consumeRecordsLoadedPage !== consumeRecordsPage),
        },
        loading: refreshing || productsLoading || couponsLoading || ordersLoading || pointRecordsLoading || consumeRecordsLoading,
        refresh,
    };
}
