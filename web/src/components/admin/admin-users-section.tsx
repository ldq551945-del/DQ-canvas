"use client";

import { Button, Grid, Input, Popconfirm, Table } from "antd";
import { Plus, Search, Trash2 } from "lucide-react";

import { Panel, PanelHeader } from "@/components/admin/admin-panel";
import type { AdminDashboardController } from "./use-admin-dashboard-controller";
import { USER_PAGE_SIZE } from "./use-admin-dashboard-controller";

export function AdminUsersSection({ controller }: { controller: AdminDashboardController }) {
    const { currentUser, userSearch, setUserSearch, selectedUserIds, setSelectedUserIds, bulkDeletingUsers, activeSection, filteredUsers, usersLoading, userPage, setUserPage, userTotal, bulkDeleteUsers, openCreateUserEditor, userColumns } = controller;
    const screens = Grid.useBreakpoint();
    if (activeSection !== "users") return null;
    return (
        <Panel>
            <PanelHeader
                title="用户管理"
                description="调整角色、账号状态和积分余额。"
                actions={
                    <Button icon={<Plus className="size-4" />} onClick={openCreateUserEditor}>
                        新增用户
                    </Button>
                }
            />
            <div className="border-b border-stone-200 bg-stone-50/45 p-4 sm:p-5 dark:border-stone-800 dark:bg-stone-900/20">
                <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
                    <Input
                        allowClear
                        className="w-full min-w-0 sm:max-w-2xl xl:max-w-3xl"
                        prefix={<Search className="size-4 text-stone-400" />}
                        placeholder="搜索昵称、用户名、邮箱、角色或状态"
                        value={userSearch}
                        onChange={(event) => setUserSearch(event.target.value)}
                    />
                    <div className="flex w-full flex-wrap items-center justify-between gap-2 xl:w-auto xl:justify-end">
                        <span className="inline-flex h-8 shrink-0 items-center rounded-md border border-stone-200 bg-white px-2.5 text-xs font-medium text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300">
                            已选 <strong className="mx-1 text-stone-950 dark:text-stone-100">{selectedUserIds.length}</strong>
                            <span className="mx-1 text-stone-300 dark:text-stone-700">/</span>共 <strong className="ml-1 text-stone-950 dark:text-stone-100">{userTotal}</strong>
                        </span>
                        <Popconfirm title="批量删除选中用户？" description="会逐个清理用户会话、积分和额度记录；当前账号和最后一个管理员会被系统阻止删除。" okText="删除" cancelText="取消" onConfirm={() => void bulkDeleteUsers()}>
                            <Button danger icon={<Trash2 className="size-4" />} disabled={!selectedUserIds.length} loading={bulkDeletingUsers}>
                                批量删除
                            </Button>
                        </Popconfirm>
                    </div>
                </div>
            </div>
            <Table
                className="admin-users-table"
                rowKey="id"
                columns={userColumns}
                dataSource={filteredUsers}
                loading={usersLoading}
                pagination={{ current: userPage, pageSize: USER_PAGE_SIZE, total: userTotal, showSizeChanger: false, hideOnSinglePage: true, onChange: setUserPage }}
                rowSelection={{
                    selectedRowKeys: selectedUserIds,
                    onChange: (keys) => setSelectedUserIds(keys.map(String)),
                    getCheckboxProps: (record) => ({
                        disabled: record.id === currentUser.id,
                        title: record.id === currentUser.id ? "不能选择当前登录账号" : undefined,
                    }),
                }}
                scroll={screens.sm ? { x: 1250 } : undefined}
                size="middle"
            />
        </Panel>
    );
}
