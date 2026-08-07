"use client";

import { Alert, Button } from "antd";
import { RefreshCw } from "lucide-react";

export function WorkbenchHistoryLoadError({ error, loading, onRetry }: { error: string; loading: boolean; onRetry: () => void }) {
    if (!error) return null;
    return (
        <Alert
            className="mb-3"
            type="error"
            showIcon
            message="生成记录加载失败，现有记录已保留"
            description={error}
            action={
                <Button size="small" icon={<RefreshCw className="size-3.5" />} loading={loading} onClick={onRetry}>
                    重试
                </Button>
            }
        />
    );
}
